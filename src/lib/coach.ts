import { prisma } from "./prisma";
import type { CoachProfile, CoachRate } from "@prisma/client";
import type { SlotRules } from "./slots";
import { offeredRates } from "./rates";
import { dateKeyToDbDate, toDateKey } from "./time";

/** A coach profile together with its rate card. */
export type CoachProfileWithRates = CoachProfile & { rates: CoachRate[] };

export function rulesFor(profile: CoachProfile): SlotRules {
  return {
    minHours: profile.minHours,
    maxHours: profile.maxHours,
    leadTimeHours: profile.leadTimeHours,
  };
}

/**
 * A coach can take bookings only once they have priced at least one lesson
 * type and written a cancellation policy in both languages. The policy is
 * shown on the review page and frozen onto the booking, so "no policy" would
 * mean a student agreeing to blank terms.
 */
export function canAcceptBookings(profile: CoachProfileWithRates): boolean {
  return (
    profile.isPublished &&
    offeredRates(profile.rates).length > 0 &&
    Boolean(profile.cancellationPolicyZh?.trim()) &&
    Boolean(profile.cancellationPolicyEn?.trim()) &&
    hasAnyPaymentMethod(profile)
  );
}

export function hasAnyPaymentMethod(profile: CoachProfile): boolean {
  return (
    (profile.emtEnabled && Boolean(profile.emtEmail)) ||
    (profile.wechatPayEnabled && Boolean(profile.wechatPayQrKey || profile.wechatId)) ||
    (profile.alipayEnabled && Boolean(profile.alipayQrKey))
  );
}

/** Why a coach is not bookable yet, for the coach's own settings page. */
export function setupGaps(profile: CoachProfileWithRates): string[] {
  const gaps: string[] = [];
  if (offeredRates(profile.rates).length === 0) gaps.push("rates");
  if (!profile.cancellationPolicyZh?.trim()) gaps.push("cancellationPolicyZh");
  if (!profile.cancellationPolicyEn?.trim()) gaps.push("cancellationPolicyEn");
  if (!hasAnyPaymentMethod(profile)) gaps.push("paymentMethod");
  if (!profile.isPublished) gaps.push("published");
  return gaps;
}

export async function getCoachProfile(userId: string) {
  return prisma.coachProfile.findUnique({ where: { userId } });
}

/** Coaches a student may book: published and fully set up. */
export async function listBookableCoaches(resortSlug?: string) {
  const coaches = await prisma.coachProfile.findMany({
    where: { isPublished: true, user: { disabledAt: null, role: { in: ["COACH", "ADMIN"] } } },
    include: {
      user: { select: { id: true, name: true, image: true } },
      rates: true,
    },
    orderBy: { displayName: "asc" },
  });

  const ready = coaches.filter(canAcceptBookings);
  if (!resortSlug) return ready;

  // Only show coaches who have at least one upcoming day at this resort.
  const withDays = await prisma.coachDay.findMany({
    where: {
      resort: { slug: resortSlug, isActive: true },
      date: { gte: startOfToday() },
      coachId: { in: ready.map((c) => c.userId) },
    },
    select: { coachId: true },
    distinct: ["coachId"],
  });
  const allowed = new Set(withDays.map((d) => d.coachId));
  return ready.filter((c) => allowed.has(c.userId));
}

/** Compatibility wrapper: a recommendation needs a specific place and time. */
export async function pickCoachForLevel(
  resortSlug: string,
  level: string | null,
  slot?: { dateKey: string; startHour: number; hours: number },
  userId?: string,
): Promise<string | null> {
  if (!slot) return null;
  const { recommendCoaches } = await import("./booking/recommendation");
  const coaches = await recommendCoaches({ resortSlug, ...slot, level }, userId);
  return coaches[0]?.userId ?? null;
}

/** UTC midnight of today, matching how @db.Date columns are stored. */
function startOfToday(): Date {
  return dateKeyToDbDate(toDateKey(new Date()));
}
