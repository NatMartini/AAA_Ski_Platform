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
  package: { select: { id: true, code: true, hours: true, priceCents: true } },
} as const;

export type BookingAccess = {
  isCustomer: boolean;
  /** This booking's own coach (or an admin): the one who acts on it. */
  isCoach: boolean;
  /** Any coach on the site. Coaches can see each other's bookings. */
  isAnyCoach: boolean;
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
  const isAnyCoach = user.role === "COACH" || user.role === "ADMIN";
  // The coaches share one set of books, so any coach can read any booking —
  // its payment screenshot and waiver included. Acting on it (paying,
  // reviewing, cancelling) stays with the student and the booking's coach.
  const canView = isCustomer || isAnyCoach;
  const isParty = isCustomer || isCoach;

  return {
    isCustomer,
    isCoach,
    isAnyCoach,
    canView,
    // The coach may also upload a proof on the student's behalf — students
    // often e-transfer and then send a screenshot over WeChat instead.
    canPay:
      isParty &&
      ["AWAITING_PAYMENT", "PAYMENT_REJECTED"].includes(booking.status),
    canReview:
      isCoach && ["PENDING_PAYMENT_REVIEW"].includes(booking.status),
    canCancel:
      isParty &&
      !["CANCELLED", "EXPIRED", "COMPLETED"].includes(booking.status),
  };
}
