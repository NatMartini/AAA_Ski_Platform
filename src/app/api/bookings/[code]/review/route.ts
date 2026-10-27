import { readJsonBodyOrResponse } from "@/lib/request-body";
import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { requireCoach } from "@/lib/auth/require-user";
import { rateLimitOrRespond } from "@/lib/rate-limit";
import { bookingReviewSchema, fieldErrors } from "@/lib/validators";
import { accessFor, bookingInclude, loadBooking } from "@/lib/booking/access";
import { areBookingWaiversValid } from "@/lib/booking/group-readiness";
import { lockBookingWaivers } from "@/lib/booking/attendees";
import { assertTransition } from "@/lib/booking/state";
import { stageOf } from "@/lib/booking/lesson";
import { sendPaymentReviewed } from "@/lib/booking/notify";
import { toLocale } from "@/i18n/routing";
import {
  deletePaymentProofIfUnreferenced,
  withPaymentProofLock,
} from "@/lib/payment-proof";
import { expireElapsedHold, isSelfServeHoldExpired } from "@/lib/booking/hold";

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
  const jsonBody = await readJsonBodyOrResponse(req);
  if (!jsonBody.ok) return jsonBody.response;
  const parsed = bookingReviewSchema.safeParse(jsonBody.data);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation", fields: fieldErrors(parsed.error) },
      { status: 400 },
    );
  }
  const { action, note, manualReceipt, expectedUpdatedAt } = parsed.data;
  if (booking.updatedAt.toISOString() !== expectedUpdatedAt) {
    return NextResponse.json({ error: "state-changed" }, { status: 409 });
  }
  const canReview = manualReceipt
    ? ["AWAITING_PAYMENT", "PAYMENT_REJECTED"].includes(booking.status)
    : access.canReview;
  if (!canReview) {
    return NextResponse.json({ error: "invalid-state" }, { status: 409 });
  }
  if (!areBookingWaiversValid(booking)) {
    return NextResponse.json({ error: "waiver-required" }, { status: 409 });
  }

  const next = action === "confirm" ? "CONFIRMED" : "PAYMENT_REJECTED";
  assertTransition(booking.status, next);

  // What this screenshot covers. On a deposit booking the first cleared
  // payment is one hour's fee, and the booking is CONFIRMED with a balance
  // still owing — the coach settles that in person and records it separately.
  const paidCents =
    stageOf(booking) === "DEPOSIT"
      ? Math.min(booking.depositCents, booking.totalCents)
      : booking.totalCents;
  const discardedProofKey = action === "reject" || manualReceipt
    ? booking.paymentProofKey : null;
  const reviewedAt = new Date();

  // Match the exact submission too: WeChat has no proof key, so a rejected
  // claim followed by a new claim can return to the same status and null key.
  const update = {
    where: {
      id: booking.id,
      status: booking.status,
      paymentProofKey: booking.paymentProofKey,
      paymentSubmittedAt: booking.paymentSubmittedAt,
      updatedAt: booking.updatedAt,
      waiverId: booking.waiverId,
      waiver: { revokedAt: null },
    },
    data: {
      status: next,
      reviewedById: r.user.id,
      reviewedAt,
      reviewNote: note?.trim() || null,
      ...(action === "confirm" ? { amountPaidCents: paidCents } : {}),
      // On rejection drop the screenshot reference so the student uploads a
      // fresh one rather than the coach re-reviewing the same image. The slot
      // stays held throughout.
      ...(action === "reject"
        ? { paymentProofKey: null, paymentSubmittedAt: null }
        : {}),
      ...(manualReceipt ? {
        paymentMethod: manualReceipt.method,
        paymentReference: manualReceipt.reference?.trim() || null,
        paymentProofKey: null,
        paymentSubmittedAt: reviewedAt,
        proofUploadedBy: "COACH" as const,
      } : {}),
    },
  } satisfies Prisma.BookingUpdateManyArgs;
  const reviewed = await withPaymentProofLock(booking.id, async (tx) => {
        await lockBookingWaivers(tx, booking.id);
        const current = await tx.booking.findUnique({
          where: { id: booking.id },
          include: bookingInclude,
        });
        const now = new Date();
        if (!current || current.status === "EXPIRED") {
          return { count: 0, error: "expired" };
        }
        if (isSelfServeHoldExpired(current, now)) {
          await expireElapsedHold(tx, booking.id, now);
          return { count: 0, error: "expired" };
        }
        if (!areBookingWaiversValid(current)) {
          return { count: 0, error: "waiver-required" };
        }
        return tx.booking.updateMany(update);
      });
  if ("error" in reviewed) {
    return NextResponse.json({ error: reviewed.error }, { status: 409 });
  }
  if (reviewed.count !== 1) {
    return NextResponse.json({ error: "state-changed" }, { status: 409 });
  }

  // The row no longer points at a rejected screenshot. Remove the private file
  // too, but only after re-checking under the same per-booking lock used when a
  // proof is attached. A failed filesystem cleanup is retried by retention.
  if (discardedProofKey) {
    await deletePaymentProofIfUnreferenced(discardedProofKey).catch(() => false);
  }

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
