import { seasonOf, type Season } from "../season";
import { dbDateToDateKey, toDateKey, type DateKey } from "../time";

/**
 * Decides whether a booking needs a fresh waiver signature.
 *
 * The rule is one signature per participant, per coach, per season. Because a
 * waiver is keyed to the *participant*, a parent who has signed for themselves
 * has not thereby signed for their child — those are different rows and the
 * lookup simply misses.
 *
 * This module is deliberately pure: the caller does the query and passes the
 * candidate row in. That keeps the age and season rules unit-testable without a
 * database.
 */

export const ADULT_AGE = 18;

/** Bump when the legal text changes materially: everyone re-signs. */
export const CURRENT_TEMPLATE_VERSION = 1;
/** Bump for typo fixes: existing signatures stay valid. */
export const CURRENT_TEMPLATE_REVISION = 1;

export type WaiverRecord = {
  id: string;
  season: string;
  templateVersion: number;
  participantWasMinor: boolean;
  revokedAt: Date | null;
  signedAt: Date;
};

export type ResolveInput = {
  /** Candidate waivers for this participant + coach. Unfiltered is fine. */
  waivers: WaiverRecord[];
  /** Participant's date of birth, as stored in the date-only column. */
  participantBirthDate: Date;
  /** Start of the lesson being booked. */
  lessonStartAt: Date;
};

export type ResolveResult =
  | { needsSigning: false; waiver: WaiverRecord; season: Season }
  | { needsSigning: true; reason: ResolveReason; season: Season };

export type ResolveReason =
  | "none" // never signed for this coach this season
  | "superseded" // signed, but the legal text has since changed
  | "revoked" // the signature was withdrawn
  | "aged-out"; // signed by a guardian, participant is now an adult

/** True if the participant is under 18 *on the day of the lesson*. */
export function isMinorAt(birthDate: Date, at: Date): boolean {
  return ageAt(birthDate, at) < ADULT_AGE;
}

/**
 * Whole years old on a given day, in Toronto terms. Both values are reduced to
 * calendar dates first so a lesson at 9am and one at 4pm never disagree.
 */
export function ageAt(birthDate: Date, at: Date): number {
  const born = splitKey(dbDateToDateKey(birthDate));
  const on = splitKey(toDateKey(at));

  let age = on.year - born.year;
  const hadBirthday =
    on.month > born.month ||
    (on.month === born.month && on.day >= born.day);
  if (!hadBirthday) age -= 1;
  return age;
}

export function resolveWaiver(input: ResolveInput): ResolveResult {
  const { waivers, participantBirthDate, lessonStartAt } = input;

  const season = seasonOf(lessonStartAt);
  if (!season) {
    // Callers gate on isWithinSeason before getting here; if that check is ever
    // dropped, fail closed rather than silently reusing a neighbouring season.
    throw new Error(
      `Lesson ${lessonStartAt.toISOString()} falls outside any ski season`,
    );
  }

  const forSeason = waivers.filter((w) => w.season === season);
  if (forSeason.length === 0) {
    return { needsSigning: true, reason: "none", season };
  }

  const currentVersion = forSeason.filter(
    (w) => w.templateVersion === CURRENT_TEMPLATE_VERSION,
  );
  if (currentVersion.length === 0) {
    return { needsSigning: true, reason: "superseded", season };
  }

  const live = currentVersion.filter((w) => w.revokedAt === null);
  if (live.length === 0) {
    return { needsSigning: true, reason: "revoked", season };
  }

  // Most recent wins if somehow there are several.
  const waiver = live.reduce((a, b) => (a.signedAt >= b.signedAt ? a : b));

  // A guardian's signature covers a child, not the adult that child becomes.
  // Once they turn 18 they have to sign for themselves.
  if (waiver.participantWasMinor && !isMinorAt(participantBirthDate, lessonStartAt)) {
    return { needsSigning: true, reason: "aged-out", season };
  }

  return { needsSigning: false, waiver, season };
}

export function resolveReasonMessage(
  reason: ResolveReason,
  locale: "en" | "zh",
): string {
  const messages: Record<ResolveReason, { en: string; zh: string }> = {
    none: {
      en: "A liability waiver is required before your first lesson with this coach this season.",
      zh: "本雪季首次预定该教练,需先签署免责协议。",
    },
    superseded: {
      en: "The waiver has been updated since you last signed, so a new signature is needed.",
      zh: "免责协议已更新,需要重新签署。",
    },
    revoked: {
      en: "Your previous waiver is no longer on file. Please sign again.",
      zh: "此前的免责协议已作废,请重新签署。",
    },
    "aged-out": {
      en: "This participant is now 18 or older, so they must sign the waiver themselves.",
      zh: "该学员已满 18 岁,须由本人签署免责协议。",
    },
  };
  return messages[reason][locale];
}

function splitKey(key: DateKey) {
  const [year, month, day] = key.split("-").map(Number);
  return { year, month, day };
}
