import { prisma } from "../prisma";
import type { ActiveUser } from "../auth/require-user";

/**
 * Loads a booking and decides what the caller may do with it.
 *
 * Every route that takes a booking code goes through here. The code itself is
 * a short label people read out loud, so it is never treated as a secret —
 * authorisation is always checked against the row.
 */
export const bookingInclude = {
  coach: { select: { id: true, name: true, email: true } },
  resort: true,
  coachDay: true,
  participant: true,
  account: { select: { id: true, email: true, name: true } },
  waiver: true,
  waiverInvite: true,
} as const;

export type BookingAccess = {
  isCustomer: boolean;
  isCoach: boolean;
  canView: boolean;
  canPay: boolean;
  canReview: boolean;
  canCancel: boolean;
};

export async function loadBooking(code: string) {
  return prisma.booking.findUnique({
    where: { code },
    include: bookingInclude,
  });
}

export type LoadedBooking = NonNullable<Awaited<ReturnType<typeof loadBooking>>>;

export function accessFor(
  booking: LoadedBooking,
  user: ActiveUser,
): BookingAccess {
  const isCustomer = booking.accountId != null && booking.accountId === user.id;
  const isCoach = booking.coachId === user.id || user.role === "ADMIN";
  const canView = isCustomer || isCoach;

  return {
    isCustomer,
    isCoach,
    canView,
    // The coach may also upload a proof on the student's behalf — students
    // often e-transfer and then send a screenshot over WeChat instead.
    canPay:
      canView &&
      ["AWAITING_PAYMENT", "PAYMENT_REJECTED"].includes(booking.status),
    canReview:
      isCoach && ["PENDING_PAYMENT_REVIEW"].includes(booking.status),
    canCancel:
      canView &&
      !["CANCELLED", "EXPIRED", "COMPLETED"].includes(booking.status),
  };
}
