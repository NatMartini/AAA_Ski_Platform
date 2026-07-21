import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCoach } from "@/lib/auth/require-user";
import { rateLimitOrRespond } from "@/lib/rate-limit";
import { fieldErrors, reviewSchema } from "@/lib/validators";
import { accessFor, loadBooking } from "@/lib/booking/access";
import { assertTransition } from "@/lib/booking/state";
import { sendPaymentReviewed } from "@/lib/booking/notify";
import { toLocale } from "@/i18n/routing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The coach confirms or rejects a payment screenshot. */
export async function POST(
  req: Request,
  ctx: RouteContext<"/api/bookings/[code]/review">,
) {
  const limited = rateLimitOrRespond(req, "write", "review");
  if (limited) return limited;

  const r = await requireCoach();
  if (!r.ok) return r.response;

  const { code } = await ctx.params;
  const booking = await loadBooking(code);
  if (!booking) return NextResponse.json({ error: "not-found" }, { status: 404 });

  // Being a coach is not enough — it has to be this booking's coach.
  const access = accessFor(booking, r.user);
  if (!access.isCoach) {
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

  const next = action === "confirm" ? "CONFIRMED" : "PAYMENT_REJECTED";
  assertTransition(booking.status, next);

  await prisma.booking.update({
    where: { id: booking.id },
    data: {
      status: next,
      reviewedById: r.user.id,
      reviewedAt: new Date(),
      reviewNote: note?.trim() || null,
      // On rejection drop the screenshot reference so the student uploads a
      // fresh one rather than the coach re-reviewing the same image. The slot
      // stays held throughout.
      ...(action === "reject"
        ? { paymentProofKey: null, paymentSubmittedAt: null }
        : {}),
    },
  });

  const to = booking.account?.email ?? booking.inviteEmail;
  if (to) {
    await sendPaymentReviewed({
      code: booking.code,
      to,
      approved: action === "confirm",
      note: note?.trim() || null,
      locale: toLocale(req.headers.get("x-locale") ?? undefined),
    }).catch(() => null);
  }

  return NextResponse.json({ ok: true, status: next });
}
