import type { PackageStatus } from "@prisma/client";
import { prisma } from "./prisma";
import type { ActiveUser } from "./auth/require-user";
import {
  hoursUsed,
  isOfferOnSale,
  packageTotalHours,
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
  adjustments: {
    select: {
      id: true,
      hours: true,
      reason: true,
      createdAt: true,
      createdBy: { select: { name: true, email: true } },
    },
    orderBy: { createdAt: "asc" as const },
  },
} as const;

/** Hours a loaded package has left: bought, plus adjustments, less spent. */
export function hoursLeft(
  pkg: {
    hours: number;
    adjustments: { hours: number }[];
    bookings: Parameters<typeof hoursUsed>[0];
  },
  now = new Date(),
): number {
  return Math.max(0, packageTotalHours(pkg) - hoursUsed(pkg.bookings, now));
}

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

/**
 * Paid packages this account could spend at this resort, with hours left.
 * Any coach can teach from a package, whoever was paid for it.
 */
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
      hoursLeft: hoursLeft(p, now),
    }))
    .filter((p) => p.hoursLeft > 0);
}

export type PackageAccess = {
  isBuyer: boolean;
  /** The coach who was paid, or an admin. */
  isPayee: boolean;
  /** The buyer or the coach who was paid: the two sides of the payment. */
  isParty: boolean;
  /** Any coach on the site. Coaches can see each other's packages. */
  isAnyCoach: boolean;
  /** Everything about it, screenshot included. The buyer and any coach. */
  canView: boolean;
  canPay: boolean;
  canReview: boolean;
  canCancel: boolean;
  /** Add or take away hours: the coach who sold it, once it is paid. */
  canAdjust: boolean;
};

/**
 * Who may do what with a package. Like a booking code, the package code is a
 * label read out over WeChat, never a secret: every request is authorised
 * against the row.
 *
 * The coaches share one set of books, so any coach can read any package,
 * screenshot included. Acting on it — paying, reviewing, cancelling,
 * adjusting hours — stays with the buyer and the coach they paid.
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
    isAnyCoach: isCoach,
    canView: isParty || isCoach,
    // The coach may also upload a screenshot the student sent over WeChat. A
    // rejected proof can always be replaced; the first one must arrive while
    // the early-bird price is still on offer.
    canPay:
      isParty &&
      (pkg.status === "PAYMENT_REJECTED" ||
        (pkg.status === "AWAITING_PAYMENT" && onSale)),
    canReview: isPayee && pkg.status === "PENDING_PAYMENT_REVIEW",
    canAdjust: isPayee && pkg.status === "ACTIVE",
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
