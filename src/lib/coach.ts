import { prisma } from "./prisma";
import type { CoachProfile } from "@prisma/client";
import type { SlotRules } from "./slots";

/** The subset of a coach profile that booking needs. */
export type CoachRules = SlotRules & {
  hourlyRateCents: number;
  handoverDiscountCents: number;
};

export function rulesFor(profile: CoachProfile): CoachRules {
  return {
    minHours: profile.minHours,
    maxHours: profile.maxHours,
    leadTimeHours: profile.leadTimeHours,
    hourlyRateCents: profile.hourlyRateCents,
    handoverDiscountCents: profile.handoverDiscountCents,
  };
}

/**
 * A coach can take bookings only once they have set a rate and written a
 * cancellation policy in both languages. The policy is shown on the review
 * page and frozen onto the booking, so "no policy" would mean a student
 * agreeing to blank terms.
 */
export function canAcceptBookings(profile: CoachProfile): boolean {
  return (
    profile.isPublished &&
    profile.hourlyRateCents > 0 &&
    Boolean(profile.cancellationPolicyZh?.trim()) &&
    Boolean(profile.cancellationPolicyEn?.trim()) &&
    hasAnyPaymentMethod(profile)
  );
}

export function hasAnyPaymentMethod(profile: CoachProfile): boolean {
  return (
    (profile.emtEnabled && Boolean(profile.emtEmail)) ||
    (profile.wechatPayEnabled && Boolean(profile.wechatPayQrKey)) ||
    (profile.alipayEnabled && Boolean(profile.alipayQrKey))
  );
}

/** Why a coach is not bookable yet, for the coach's own settings page. */
export function setupGaps(profile: CoachProfile): string[] {
  const gaps: string[] = [];
  if (profile.hourlyRateCents <= 0) gaps.push("hourlyRate");
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
    where: { isPublished: true },
    include: { user: { select: { id: true, name: true, image: true } } },
    orderBy: { displayName: "asc" },
  });

  const ready = coaches.filter(canAcceptBookings);
  if (!resortSlug) return ready;

  // Only show coaches who have at least one upcoming day at this resort.
  const withDays = await prisma.coachDay.findMany({
    where: {
      resort: { slug: resortSlug },
      date: { gte: startOfToday() },
      coachId: { in: ready.map((c) => c.userId) },
    },
    select: { coachId: true },
    distinct: ["coachId"],
  });
  const allowed = new Set(withDays.map((d) => d.coachId));
  return ready.filter((c) => allowed.has(c.userId));
}

/**
 * Picks a coach for a student who would rather not choose one.
 *
 * Preference order:
 *  1. coaches who list the student's level as one they teach;
 *  2. among those, the one with the fewest live bookings, so the two of them
 *     stay roughly even rather than one taking everything;
 *  3. name, purely so the result is stable when everything else ties.
 *
 * A coach who has not filled in `teachableLevels` at all is treated as
 * teaching everything — an empty list means "not configured", not "teaches
 * nothing", and the alternative would silently make them unbookable.
 */
export async function pickCoachForLevel(
  resortSlug: string,
  level: string | null,
): Promise<string | null> {
  const coaches = await listBookableCoaches(resortSlug);
  if (coaches.length === 0) return null;

  const matching = level
    ? coaches.filter(
        (c) => c.teachableLevels.length === 0 || c.teachableLevels.includes(level),
      )
    : coaches;
  const pool = matching.length > 0 ? matching : coaches;
  if (pool.length === 1) return pool[0].userId;

  const loads = await prisma.booking.groupBy({
    by: ["coachId"],
    where: {
      coachId: { in: pool.map((c) => c.userId) },
      status: { notIn: ["CANCELLED", "COMPLETED"] },
    },
    _count: { _all: true },
  });
  const loadBy = new Map(loads.map((l) => [l.coachId, l._count._all]));

  return [...pool].sort((a, b) => {
    const d = (loadBy.get(a.userId) ?? 0) - (loadBy.get(b.userId) ?? 0);
    return d !== 0 ? d : a.displayName.localeCompare(b.displayName);
  })[0].userId;
}

/** UTC midnight of today, matching how @db.Date columns are stored. */
function startOfToday(): Date {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}
