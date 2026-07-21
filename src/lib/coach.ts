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

/** UTC midnight of today, matching how @db.Date columns are stored. */
function startOfToday(): Date {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}
