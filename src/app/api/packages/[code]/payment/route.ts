import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/require-user";
import { rateLimitOrRespond } from "@/lib/rate-limit";
import { fieldErrors, packagePaymentSchema } from "@/lib/validators";
import { accessForPackage, loadPackage } from "@/lib/package-store";
import { KEY_PREFIX, objectExists } from "@/lib/storage";
import {
  deletePaymentProofIfUnreferenced,
  withPackageProofLock,
} from "@/lib/payment-proof";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The buyer (or the coach, on their behalf) submits proof of payment. */
export async function POST(
  req: Request,
  ctx: RouteContext<"/api/packages/[code]/payment">,
) {
  const limited = rateLimitOrRespond(req, "write", "package-payment");
  if (limited) return limited;

  const r = await requireUser();
  if (!r.ok) return r.response;

  const { code } = await ctx.params;
  const pkg = await loadPackage(code);
  if (!pkg) return NextResponse.json({ error: "not-found" }, { status: 404 });

  const access = accessForPackage(pkg, r.user);
  if (!access.canView) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (!access.canPay) {
    return NextResponse.json({ error: "invalid-state" }, { status: 409 });
  }

  const parsed = packagePaymentSchema.safeParse(
    await req.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation", fields: fieldErrors(parsed.error) },
      { status: 400 },
    );
  }
  const d = parsed.data;

  // The key must be one this package's upload produced, or a caller could
  // point their order at somebody else's stored screenshot.
  const expectedPrefix = `${KEY_PREFIX.packageProof(pkg.id)}/`;
  if (!d.proofKey.startsWith(expectedPrefix) || d.proofKey.includes("..")) {
    return NextResponse.json({ error: "invalid-proof-key" }, { status: 400 });
  }

  const submittedAt = new Date();
  const attached = await withPackageProofLock(pkg.id, async (tx) => {
    // Re-read under the lock: a review or cancellation may have landed since.
    const current = await tx.lessonPackage.findUnique({
      where: { id: pkg.id },
      select: { status: true, paymentProofKey: true },
    });
    if (
      !current ||
      !["AWAITING_PAYMENT", "PAYMENT_REJECTED"].includes(current.status)
    ) {
      return { kind: "invalid-state" } as const;
    }
    // A cleanup may have removed a stale upload; never point at a missing file.
    if (!(await objectExists(d.proofKey))) {
      return { kind: "proof-not-found" } as const;
    }
    await tx.lessonPackage.update({
      where: { id: pkg.id },
      data: {
        status: "PENDING_PAYMENT_REVIEW",
        paymentMethod: d.method,
        paymentProofKey: d.proofKey,
        paymentReference: d.reference?.trim() || null,
        paymentSubmittedAt: submittedAt,
        reviewNote: null,
      },
    });
    return {
      kind: "attached",
      previousProofKey: current.paymentProofKey,
    } as const;
  });
  if (attached.kind === "invalid-state") {
    return NextResponse.json({ error: "invalid-state" }, { status: 409 });
  }
  if (attached.kind === "proof-not-found") {
    return NextResponse.json({ error: "proof-not-found" }, { status: 400 });
  }

  if (attached.previousProofKey && attached.previousProofKey !== d.proofKey) {
    await deletePaymentProofIfUnreferenced(attached.previousProofKey).catch(
      () => false,
    );
  }

  return NextResponse.json({ ok: true });
}
