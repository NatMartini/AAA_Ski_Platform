import type { PackageStatus } from "@prisma/client";
import { prisma } from "./prisma";
import type { ActiveUser } from "./auth/require-user";
import {
  hoursUsed,
  isOfferOnSale,
  PACKAGE_CONSUMING_STATUSES,
} from "./packages";
import { OCCUPYING_STATUSES } from "./booking/state";
import { isSelfServeHoldExpired } from "./booking/hold";
import { toDateKey } from "./time";

/**
 * Database access for lesson packages. The rules themselves live in
 * packages.ts, which stays free of Prisma so it can be unit-tested directly.
 */

const usageInclude = {
  bookings: {
    where: { status: { in: PACKAGE_CONSUMING_STATUSES } },
    select: {
      code: true,
      hours: true,
      status: true,
      holdExpiresAt: true,
      coachId: true,
      startAt: true,
      participantNameSnapshot: true,
    },
    orderBy: { startAt: "asc" as const },
  },
} as const;

export const packageInclude = {
  ...usageInclude,
  resort: { select: { id: true, slug: true, nameEn: true, nameZh: true } },
  account: { select: { id: true, email: true, name: true } },
  payeeCoach: { select: { id: true, email: true, name: true } },
} as const;

export async function loadPackage(code: string) {
  return prisma.lessonPackage.findUnique({
    where: { code },
    include: packageInclude,
  });
}

export type LoadedPackage = NonNullable<Awaited<ReturnType<typeof loadPackage>>>;

/** Paid packages this account could spend at a resort, with hours left. */
export async function usablePackages(
  accountId: string,
  resortId: string,
  now = new Date(),
) {
  const packages = await prisma.lessonPackage.findMany({
    where: { accountId, resortId, status: "ACTIVE" },
    include: usageInclude,
    orderBy: { createdAt: "asc" },
  });
  return packages
    .map((p) => ({
      id: p.id,
      code: p.code,
      lessonType: p.lessonType,
      season: p.season,
      hoursLeft: p.hours - hoursUsed(p.bookings, now),
    }))
    .filter((p) => p.hoursLeft > 0);
}

export type PackageAccess = {
  isBuyer: boolean;
  /** The coach who was paid, or an admin. */
  isPayee: boolean;
  /** The buyer or the coach who was paid: the two sides of the payment. */
  isParty: boolean;
  /** Hours, lessons and status. Any coach, since any coach can teach from it. */
  canView: boolean;
  /** The payment screenshot, which may show bank details. Parties only. */
  canSeeProof: boolean;
  canPay: boolean;
  canReview: boolean;
  canCancel: boolean;
};

/**
 * Who may do what with a package. Like a booking code, the package code is a
 * label read out over WeChat, never a secret: every request is authorised
 * against the row.
 *
 * Every coach can read a package — its hours can be spent with any of them,
 * so each needs to see what a student has left. Everything to do with the
 * payment itself (the screenshot, paying, reviewing, cancelling) stays with
 * the buyer and the coach they paid.
 */
export function packageAccessFor(
  pkg: { accountId: string; payeeCoachId: string; status: PackageStatus },
  user: ActiveUser,
  /** Nobody pays for an unpaid order once the offer has come off sale. */
  onSale: boolean,
  hasLiveBookings: boolean,
): PackageAccess {
  const isBuyer = pkg.accountId === user.id;
  const isPayee = pkg.payeeCoachId === user.id || user.role === "ADMIN";
  const isParty = isBuyer || isPayee;
  const isCoach = user.role === "COACH" || user.role === "ADMIN";
  return {
    isBuyer,
    isPayee,
    isParty,
    canView: isParty || isCoach,
    canSeeProof: isParty,
    // The coach may also upload a screenshot the student sent over WeChat. A
    // rejected proof can always be replaced; the first one must arrive while
    // the early-bird price is still on offer.
    canPay:
      isParty &&
      (pkg.status === "PAYMENT_REJECTED" ||
        (pkg.status === "AWAITING_PAYMENT" && onSale)),
    canReview: isPayee && pkg.status === "PENDING_PAYMENT_REVIEW",
    // The buyer can withdraw an order they have not paid for. Once money may
    // have moved only the coach who holds it cancels, because a refund happens
    // person to person and cancelling here just stops the hours being spent.
    // Hours already booked must be cancelled on those bookings first.
    canCancel:
      !hasLiveBookings &&
      ((isPayee && pkg.status !== "CANCELLED") ||
        (isBuyer &&
          (pkg.status === "AWAITING_PAYMENT" ||
            pkg.status === "PAYMENT_REJECTED"))),
  };
}

/** Access for a loaded package, working out sale window and live bookings. */
export function accessForPackage(
  pkg: LoadedPackage,
  user: ActiveUser,
  now = new Date(),
): PackageAccess {
  const hasLiveBookings = pkg.bookings.some(
    (b) =>
      OCCUPYING_STATUSES.includes(b.status) && !isSelfServeHoldExpired(b, now),
  );
  return packageAccessFor(
    pkg,
    user,
    isOfferOnSale(pkg.offerKey, pkg.season, toDateKey(now)),
    hasLiveBookings,
  );
}
