import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCoach } from "@/lib/auth/require-user";
import { rateLimitOrRespond } from "@/lib/rate-limit";
import { fieldErrors, reviewSchema } from "@/lib/validators";
import { accessForPackage, loadPackage } from "@/lib/package-store";
import { deletePaymentProofIfUnreferenced } from "@/lib/payment-proof";
import { sendPackageReviewed } from "@/lib/booking/notify";
import { toLocale } from "@/i18n/routing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The coach who was paid confirms or rejects the screenshot. Confirming makes
 * the hours spendable with that coach.
 */
export async function POST(
  req: Request,
  ctx: RouteContext<"/api/packages/[code]/review">,
) {
  const limited = rateLimitOrRespond(req, "write", "package-review");
  if (limited) return limited;

  const r = await requireCoach();
  if (!r.ok) return r.response;

  const { code } = await ctx.params;
  const pkg = await loadPackage(code);
  if (!pkg) return NextResponse.json({ error: "not-found" }, { status: 404 });

  // Being a coach is not enough — it has to be the coach who was paid.
  const access = accessForPackage(pkg, r.user);
  if (!access.isPayee) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (!access.canReview) {
    return NextResponse.json({ error: "invalid-state" }, { status: 409 });
  }

  const parsed = reviewSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation", fields: fieldErrors(parsed.error) },
      { status: 400 },
    );
  }
  const { action, note } = parsed.data;
  const rejectedProofKey = action === "reject" ? pkg.paymentProofKey : null;

  // Compare-and-set, so two reviews (or a review racing a cancellation) cannot
  // overwrite whichever decision committed first.
  const reviewed = await prisma.lessonPackage.updateMany({
    where: {
      id: pkg.id,
      status: pkg.status,
      paymentProofKey: pkg.paymentProofKey,
    },
    data: {
      status: action === "confirm" ? "ACTIVE" : "PAYMENT_REJECTED",
      reviewedById: r.user.id,
      reviewedAt: new Date(),
      reviewNote: note?.trim() || null,
      ...(action === "reject"
        ? { paymentProofKey: null, paymentSubmittedAt: null }
        : {}),
    },
  });
  if (reviewed.count !== 1) {
    return NextResponse.json({ error: "state-changed" }, { status: 409 });
  }

  if (rejectedProofKey) {
    await deletePaymentProofIfUnreferenced(rejectedProofKey).catch(() => false);
  }

  await sendPackageReviewed({
    code: pkg.code,
    to: pkg.account.email,
    approved: action === "confirm",
    note: note?.trim() || null,
    locale: toLocale(req.headers.get("x-locale") ?? undefined),
  }).catch(() => null);

  return NextResponse.json({ ok: true });
}
