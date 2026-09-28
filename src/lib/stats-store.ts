import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import type { StatBooking, StatPackage } from "./stats";

/**
 * Loads the rows stats.ts works on. Kept apart from the calculations so those
 * stay free of Prisma and can be unit-tested directly.
 */

const bookingSelect = {
  code: true,
  coachId: true,
  accountId: true,
  participantNameSnapshot: true,
  inviteName: true,
  status: true,
  paymentPlan: true,
  lessonType: true,
  resortId: true,
  earlyBird: true,
  hours: true,
  startAt: true,
  endAt: true,
  totalCents: true,
  amountPaidCents: true,
  holdExpiresAt: true,
} satisfies Prisma.BookingSelect;

type BookingRow = Prisma.BookingGetPayload<{ select: typeof bookingSelect }>;

export function toStatBooking(b: BookingRow): StatBooking {
  return {
    ...b,
    participantName: b.participantNameSnapshot ?? b.inviteName,
  };
}

export async function loadStatBookings(
  where: Prisma.BookingWhereInput = {},
): Promise<StatBooking[]> {
  const rows = await prisma.booking.findMany({
    where,
    select: bookingSelect,
    orderBy: { startAt: "asc" },
  });
  return rows.map(toStatBooking);
}

export async function loadStatPackages(
  where: Prisma.LessonPackageWhereInput = {},
): Promise<StatPackage[]> {
  return prisma.lessonPackage.findMany({
    where,
    select: {
      code: true,
      accountId: true,
      payeeCoachId: true,
      status: true,
      season: true,
      hours: true,
      priceCents: true,
      bookings: {
        select: { coachId: true, hours: true, status: true, holdExpiresAt: true },
      },
    },
  });
}

/**
 * Every coach, in a fixed order (by name), so a coach keeps the same row and
 * the same chart colour however the numbers move.
 */
export async function loadCoaches() {
  return prisma.coachProfile.findMany({
    select: { userId: true, displayName: true },
    orderBy: [{ displayName: "asc" }, { createdAt: "asc" }],
  });
}
