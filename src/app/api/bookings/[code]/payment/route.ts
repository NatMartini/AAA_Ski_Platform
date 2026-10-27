import { readJsonBodyOrResponse } from "@/lib/request-body";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/require-user";
import { rateLimitOrRespond } from "@/lib/rate-limit";
import { fieldErrors, paymentProofSchema } from "@/lib/validators";
import { accessFor, bookingInclude, loadBooking } from "@/lib/booking/access";
import { areBookingWaiversValid } from "@/lib/booking/group-readiness";
import { lockBookingWaivers } from "@/lib/booking/attendees";
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
  if (!areBookingWaiversValid(booking)) {
    return NextResponse.json({ error: "waiver-required" }, { status: 409 });
  }

  const jsonBody = await readJsonBodyOrResponse(req);
  if (!jsonBody.ok) return jsonBody.response;
  const parsed = paymentProofSchema.safeParse(jsonBody.data);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation", fields: fieldErrors(parsed.error) },
      { status: 400 },
    );
  }
  const d = parsed.data;
  // WeChat carries no screenshot: the coach sees the money arrive in WeChat
  // and confirms. Anything else has a screenshot and a reference (validated).
  const proofKey = d.method === "WECHAT" ? null : (d.proofKey ?? null);

  // The key must be one this booking's upload produced. Without this check a
  // caller could point their booking at somebody else's stored screenshot.
  const expectedPrefix = `${KEY_PREFIX.proof(booking.id)}/`;
  if (
    proofKey !== null &&
    (!proofKey.startsWith(expectedPrefix) || proofKey.includes(".."))
  ) {
    return NextResponse.json({ error: "invalid-proof-key" }, { status: 400 });
  }

  assertTransition(booking.status, "PENDING_PAYMENT_REVIEW");

  const attached = await withPaymentProofLock(booking.id, async (tx) => {
    await lockBookingWaivers(tx, booking.id);
    // Re-read while holding the row lock. The hold sweeper uses the same row,
    // so it cannot expire this booking between this check and the update.
    const current = await tx.booking.findUnique({
      where: { id: booking.id },
      include: bookingInclude,
    });
    if (!current || current.status === "EXPIRED") {
      return { kind: "expired" } as const;
    }
    if (isSelfServeHoldExpired(current, submittedAt)) {
      await expireElapsedHold(tx, booking.id, submittedAt);
      return { kind: "expired" } as const;
    }
    if (
      !["AWAITING_PAYMENT", "PAYMENT_REJECTED"].includes(current.status)
    ) {
      return { kind: "invalid-state" } as const;
    }
    if (!areBookingWaiversValid(current)) return { kind: "waiver-required" } as const;

    // An orphan cleanup may have removed a stale upload before this request
    // reached the database. Never create a row which points at a missing file.
    if (proofKey !== null && !(await objectExists(proofKey))) {
      return { kind: "proof-not-found" } as const;
    }

    await tx.booking.update({
      where: { id: booking.id },
      data: {
        status: "PENDING_PAYMENT_REVIEW",
        paymentMethod: d.method,
        paymentProofKey: proofKey,
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
  if (attached.kind === "waiver-required") {
    return NextResponse.json({ error: "waiver-required" }, { status: 409 });
  }
  if (attached.kind === "proof-not-found") {
    return NextResponse.json({ error: "proof-not-found" }, { status: 400 });
  }

  // Usually null after a rejection, but this also makes retries/replacements
  // safe if a prior flow left a different key attached. Cleanup failure does
  // not undo a valid payment submission; the retention job retries it later.
  if (
    attached.previousProofKey &&
    attached.previousProofKey !== proofKey
  ) {
    await deletePaymentProofIfUnreferenced(attached.previousProofKey).catch(
      () => false,
    );
  }

  return NextResponse.json({ ok: true });
}
