import type { BookingStatus, PackageStatus } from "@prisma/client";
import { OCCUPYING_STATUSES } from "./booking/state";
import { isSelfServeHoldExpired } from "./booking/hold";
import { earlyBirdWindow } from "./rates";
import type { Season } from "./season";
import type { DateKey } from "./time";

/**
 * Prepaid lesson-hour packages ("课时包").
 *
 * From the price sheet: at Blue Mountain, four hours of ski lessons for $180,
 * with any coach, early bird only. The buyer pays one coach of their choosing;
 * the hours can then be spent with any coach — two hours with Kevin and two
 * with Alisa is fine — so the coach who was paid may owe part of it to the
 * coach who taught. `settlementFor` works that out.
 *
 * Offers are a code constant, like the lesson-type catalogue. The price, hours
 * and season are copied onto each purchase, so changing an offer never
 * rewrites a package somebody has already bought.
 *
 * Hours are never stored as a running counter. What is left is always derived
 * from the bookings that point at the package, so a booking that expires or is
 * cancelled gives its hours back with no extra bookkeeping.
 */

export type PackageOffer = {
  key: string;
  resortSlug: string;
  lessonType: string;
  hours: number;
  priceCents: number;
  zh: string;
  en: string;
};

export const PACKAGE_OFFERS: PackageOffer[] = [
  {
    key: "blue-mountain-4h",
    resortSlug: "blue-mountain",
    lessonType: "riding",
    hours: 4,
    priceCents: 18000,
    zh: "蓝山 4 小时滑行课课时包",
    en: "Blue Mountain 4-hour ski lesson package",
  },
];

/**
 * Bookings in these statuses have spent their package hours. Everything that
 * holds a slot, plus lessons already taught; EXPIRED and CANCELLED hand the
 * hours back.
 */
export const PACKAGE_CONSUMING_STATUSES: BookingStatus[] = [
  ...OCCUPYING_STATUSES,
  "COMPLETED",
];

export function findOffer(key: string): PackageOffer | null {
  return PACKAGE_OFFERS.find((o) => o.key === key) ?? null;
}

export function offerLabel(key: string, locale: "zh" | "en"): string {
  const offer = findOffer(key);
  if (!offer) return key;
  return locale === "zh" ? offer.zh : offer.en;
}

/**
 * The offers a student can buy today, and the season the hours are for.
 *
 * Every current offer is an early-bird one: it goes on sale for a season the
 * day the previous one ends and comes off sale after 1 December.
 */
export function offersOnSale(today: DateKey): {
  season: Season;
  lastDay: DateKey;
  offers: PackageOffer[];
} {
  const window = earlyBirdWindow(today);
  return {
    season: window.season,
    lastDay: window.lastDay,
    offers: window.active ? PACKAGE_OFFERS : [],
  };
}

/** Whether an order for `offerKey` in `season` could still be paid today. */
export function isOfferOnSale(
  offerKey: string,
  season: string,
  today: DateKey,
): boolean {
  const sale = offersOnSale(today);
  return sale.season === season && sale.offers.some((o) => o.key === offerKey);
}

/**
 * Hours already spent (or held) from a package. A self-serve hold whose timer
 * has run out is not counted even before the sweeper marks it EXPIRED.
 */
export function hoursUsed(
  bookings: {
    hours: number;
    status: BookingStatus;
    holdExpiresAt?: Date | null;
  }[],
  now: Date = new Date(),
): number {
  return bookings
    .filter((b) => PACKAGE_CONSUMING_STATUSES.includes(b.status))
    .filter(
      (b) =>
        !isSelfServeHoldExpired(
          { status: b.status, holdExpiresAt: b.holdExpiresAt ?? null },
          now,
        ),
    )
    .reduce((sum, b) => sum + b.hours, 0);
}

export type PackageForUse = {
  status: PackageStatus;
  resortId: string;
  lessonType: string;
  season: string;
  hours: number;
  hoursUsed: number;
};

export type PackageUseRefusal =
  | "package-not-active"
  | "package-wrong-resort"
  | "package-wrong-lesson-type"
  | "package-wrong-season"
  | "package-group"
  | "package-insufficient-hours";

/**
 * Whether a package can pay for a lesson. A package covers a whole booking or
 * none of it — mixing prepaid hours and cash on one booking would make both
 * the payment review and the coaches' settlement ambiguous.
 */
export function checkPackageUse(
  pkg: PackageForUse,
  lesson: {
    resortId: string;
    lessonType: string;
    season: string | null;
    hours: number;
    headcount: number;
  },
): { ok: true } | { ok: false; reason: PackageUseRefusal } {
  if (pkg.status !== "ACTIVE") return { ok: false, reason: "package-not-active" };
  if (pkg.resortId !== lesson.resortId) {
    return { ok: false, reason: "package-wrong-resort" };
  }
  if (pkg.lessonType !== lesson.lessonType) {
    return { ok: false, reason: "package-wrong-lesson-type" };
  }
  if (pkg.season !== lesson.season) {
    return { ok: false, reason: "package-wrong-season" };
  }
  // The package price is one-on-one; a group surcharge has nowhere to go.
  if (lesson.headcount !== 1) return { ok: false, reason: "package-group" };
  if (pkg.hours - pkg.hoursUsed < lesson.hours) {
    return { ok: false, reason: "package-insufficient-hours" };
  }
  return { ok: true };
}

/** What `hours` of a package are worth, pro rata, in integer cents. */
export function packageValueCents(
  pkg: { priceCents: number; hours: number },
  hours: number,
): number {
  return Math.round((pkg.priceCents * hours) / pkg.hours);
}

export type SettlementLine = {
  otherCoachId: string;
  /** Hours the other coach taught from packages paid to me. */
  theyTaughtHours: number;
  /** What I hold for those hours and should pass on. */
  iOweCents: number;
  /** Hours I taught from packages paid to the other coach. */
  iTaughtHours: number;
  /** What they hold for my hours and should pass on. */
  owedToMeCents: number;
  /** Positive: they owe me. Negative: I owe them. */
  netCents: number;
};

/**
 * Who owes whom between coaches, from one coach's point of view.
 *
 * Only cross-coach use creates a debt: hours a coach teaches from a package
 * they were paid for themselves are already in their pocket.
 */
export function settlementFor(
  coachId: string,
  packages: {
    payeeCoachId: string;
    priceCents: number;
    hours: number;
    uses: { coachId: string; hours: number }[];
  }[],
): SettlementLine[] {
  const lines = new Map<string, SettlementLine>();
  const line = (otherCoachId: string) => {
    let existing = lines.get(otherCoachId);
    if (!existing) {
      existing = {
        otherCoachId,
        theyTaughtHours: 0,
        iOweCents: 0,
        iTaughtHours: 0,
        owedToMeCents: 0,
        netCents: 0,
      };
      lines.set(otherCoachId, existing);
    }
    return existing;
  };

  for (const pkg of packages) {
    for (const use of pkg.uses) {
      if (use.coachId === pkg.payeeCoachId) continue;
      const value = packageValueCents(pkg, use.hours);
      if (pkg.payeeCoachId === coachId) {
        const l = line(use.coachId);
        l.theyTaughtHours += use.hours;
        l.iOweCents += value;
      } else if (use.coachId === coachId) {
        const l = line(pkg.payeeCoachId);
        l.iTaughtHours += use.hours;
        l.owedToMeCents += value;
      }
    }
  }

  return [...lines.values()].map((l) => ({
    ...l,
    netCents: l.owedToMeCents - l.iOweCents,
  }));
}

// ── Display ──

const STATUS_LABELS: Record<PackageStatus, { zh: string; en: string }> = {
  AWAITING_PAYMENT: { zh: "待付款", en: "Payment needed" },
  PENDING_PAYMENT_REVIEW: { zh: "待教练确认收款", en: "Checking payment" },
  PAYMENT_REJECTED: { zh: "付款未通过", en: "Payment not accepted" },
  ACTIVE: { zh: "可使用", en: "Ready to use" },
  CANCELLED: { zh: "已取消", en: "Cancelled" },
};

export function packageStatusLabel(
  status: PackageStatus,
  locale: "zh" | "en",
): string {
  return STATUS_LABELS[status][locale];
}

/** The booking pill colour token each package state borrows. */
export const PACKAGE_STATUS_TOKEN: Record<PackageStatus, string> = {
  AWAITING_PAYMENT: "payment",
  PENDING_PAYMENT_REVIEW: "checking",
  PAYMENT_REJECTED: "cancelled",
  ACTIVE: "confirmed",
  CANCELLED: "cancelled",
};
