import { seasonOf, type Season } from "../season";

/**
 * Decides whether a booking needs a fresh waiver signature.
 *
 * The rule is one signature per participant, per coach, per season. Because a
 * waiver is keyed to the *participant*, a parent who has signed for themselves
 * has not thereby signed for their child — those are different rows and the
 * lookup simply misses.
 *
 * Age is a stored boolean (`Participant.isMinor`), not a date of birth. That is
 * less personal data for the same decision, but it means the system cannot
 * notice a birthday on its own. The protection that replaces it: a waiver
 * records whether the participant was a minor when it was signed, and if that
 * no longer matches, the waiver stops counting. So when someone flips a
 * participant from minor to adult, the guardian's signature is retired and the
 * now-adult participant is asked to sign for themselves — which is the outcome
 * the date-based check used to produce.
 *
 * This module is deliberately pure: the caller does the query and passes the
 * candidate rows in, so the season and age rules stay unit-testable without a
 * database.
 */

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
  /** Whether the participant is currently recorded as under 18. */
  participantIsMinor: boolean;
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
  | "aged-out" // signed by a guardian, participant is now marked an adult
  | "now-minor"; // signed as an adult, participant is now marked a minor

export function resolveWaiver(input: ResolveInput): ResolveResult {
  const { waivers, participantIsMinor, lessonStartAt } = input;

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
  if (waiver.participantWasMinor && !participantIsMinor) {
    return { needsSigning: true, reason: "aged-out", season };
  }
  // The reverse is a correction rather than a birthday — someone ticked the
  // box wrongly the first time. Either way the wrong person signed, so the
  // guardian has to sign properly.
  if (!waiver.participantWasMinor && participantIsMinor) {
    return { needsSigning: true, reason: "now-minor", season };
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
      en: "This participant is now recorded as 18 or over, so they must sign the waiver themselves.",
      zh: "该学员现已登记为成年,须由本人签署免责协议。",
    },
    "now-minor": {
      en: "This participant is now recorded as under 18, so a parent or guardian must sign.",
      zh: "该学员现已登记为未成年,须由父母或监护人签署。",
    },
  };
  return messages[reason][locale];
}
