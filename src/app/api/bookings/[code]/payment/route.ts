import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/require-user";
import { rateLimitOrRespond } from "@/lib/rate-limit";
import { fieldErrors, paymentProofSchema } from "@/lib/validators";
import { accessFor, loadBooking } from "@/lib/booking/access";
import { assertTransition } from "@/lib/booking/state";
import { KEY_PREFIX, objectExists } from "@/lib/storage";
import {
  deletePaymentProofIfUnreferenced,
  withPaymentProofLock,
} from "@/lib/payment-proof";
import {
  expireElapsedHold,
  isSelfServeHoldExpired,
} from "@/lib/booking/hold";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  ctx: RouteContext<"/api/bookings/[code]/payment">,
) {
  const limited = rateLimitOrRespond(req, "write", "payment");
  if (limited) return limited;

  const r = await requireUser();
  if (!r.ok) return r.response;

  const { code } = await ctx.params;
  const booking = await loadBooking(code);
  if (!booking) return NextResponse.json({ error: "not-found" }, { status: 404 });

  const access = accessFor(booking, r.user);
  if (!access.canView) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (!access.canPay) {
    return NextResponse.json({ error: "invalid-state" }, { status: 409 });
  }
  const submittedAt = new Date();
  if (isSelfServeHoldExpired(booking, submittedAt)) {
    await expireElapsedHold(prisma, booking.id, submittedAt);
    return NextResponse.json({ error: "expired" }, { status: 409 });
  }
  // A waiver must be on file first — that was the whole point of the sequence.
  if (!booking.waiverId) {
    return NextResponse.json({ error: "waiver-required" }, { status: 409 });
  }

  const parsed = paymentProofSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation", fields: fieldErrors(parsed.error) },
      { status: 400 },
    );
  }
  const d = parsed.data;

  // The key must be one this booking's upload produced. Without this check a
  // caller could point their booking at somebody else's stored screenshot.
  const expectedPrefix = `${KEY_PREFIX.proof(booking.id)}/`;
  if (!d.proofKey.startsWith(expectedPrefix) || d.proofKey.includes("..")) {
    return NextResponse.json({ error: "invalid-proof-key" }, { status: 400 });
  }

  assertTransition(booking.status, "PENDING_PAYMENT_REVIEW");

  const attached = await withPaymentProofLock(booking.id, async (tx) => {
    // Re-read while holding the row lock. The hold sweeper uses the same row,
    // so it cannot expire this booking between this check and the update.
    const current = await tx.booking.findUnique({
      where: { id: booking.id },
      select: {
        status: true,
        holdExpiresAt: true,
        waiverId: true,
        paymentProofKey: true,
      },
    });
    if (!current || current.status === "EXPIRED") {
      return { kind: "expired" } as const;
    }
    if (isSelfServeHoldExpired(current, submittedAt)) {
      await expireElapsedHold(tx, booking.id, submittedAt);
      return { kind: "expired" } as const;
    }
    if (
      !["AWAITING_PAYMENT", "PAYMENT_REJECTED"].includes(current.status) ||
      !current.waiverId
    ) {
      return { kind: "invalid-state" } as const;
    }

    // An orphan cleanup may have removed a stale upload before this request
    // reached the database. Never create a row which points at a missing file.
    if (!(await objectExists(d.proofKey))) {
      return { kind: "proof-not-found" } as const;
    }

    await tx.booking.update({
      where: { id: booking.id },
      data: {
        status: "PENDING_PAYMENT_REVIEW",
        paymentMethod: d.method,
        paymentProofKey: d.proofKey,
        paymentReference: d.reference?.trim() || null,
        paymentSubmittedAt: submittedAt,
        proofUploadedBy: access.isCustomer ? "CUSTOMER" : "COACH",
        // Clear any previous rejection note so the coach sees a clean submission.
        reviewNote: null,
      },
    });
    return {
      kind: "attached",
      previousProofKey: current.paymentProofKey,
    } as const;
  });
  if (attached.kind === "expired") {
    return NextResponse.json({ error: "expired" }, { status: 409 });
  }
  if (attached.kind === "invalid-state") {
    return NextResponse.json({ error: "invalid-state" }, { status: 409 });
  }
  if (attached.kind === "proof-not-found") {
    return NextResponse.json({ error: "proof-not-found" }, { status: 400 });
  }

  // Usually null after a rejection, but this also makes retries/replacements
  // safe if a prior flow left a different key attached. Cleanup failure does
  // not undo a valid payment submission; the retention job retries it later.
  if (
    attached.previousProofKey &&
    attached.previousProofKey !== d.proofKey
  ) {
    await deletePaymentProofIfUnreferenced(attached.previousProofKey).catch(
      () => false,
    );
  }

  return NextResponse.json({ ok: true });
}
