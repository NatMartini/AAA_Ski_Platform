import { createHash } from "node:crypto";
import { isMinorAt } from "./waiver/validity";
import { dateKeyToDbDate, type DateKey } from "./time";

/**
 * Rules that stop one person's waiver being credited to another.
 *
 * The root protection is structural: a Waiver row is keyed to a Participant,
 * so a parent who signed for themselves simply has no row for their child and
 * the lookup misses. These functions add the rest:
 *
 *   1. Participants are picked explicitly from a list, never inferred.
 *   2. Minor status is derived from date of birth on the *lesson* date, server
 *      side. A client-supplied "isMinor" is ignored entirely.
 *   3. A minor's waiver must be signed by their guardian — the account holder.
 *   4. Self-serve booking refuses to create an adult who is not the account
 *      holder, because no adult can sign a waiver for another adult.
 *   5. Once a minor turns 18, the guardian's signature stops applying (handled
 *      in resolveWaiver).
 */

/**
 * Deduplication key for a participant within one account.
 *
 * Prevents someone adding "Xiao Ming / 2015-03-02" twice and using the second,
 * waiver-free copy. Cross-account duplicates are allowed on purpose: separated
 * parents each keep their own record, and each needs their own signature.
 */
export function identityKey(fullName: string, birthDate: DateKey): string {
  const normalized = fullName
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    // Strip punctuation and spacing so "Xiao-Ming" and "xiao ming" collide.
    .replace(/[.,'’\-_\s]/g, "");
  return createHash("sha256")
    .update(`${normalized}|${birthDate}`)
    .digest("hex")
    .slice(0, 32);
}

export type ParticipantCheck =
  | { ok: true; isMinor: boolean }
  | { ok: false; reason: "adult-not-self" };

/**
 * Whether this participant may be booked through the self-serve flow.
 *
 * Coaches are not bound by this: they can create a booking for anyone, but the
 * adult student still has to sign for themselves via the signing link.
 */
export function checkSelfServeParticipant(input: {
  birthDate: Date;
  isSelf: boolean;
  lessonStartAt: Date;
}): ParticipantCheck {
  const isMinor = isMinorAt(input.birthDate, input.lessonStartAt);
  if (!isMinor && !input.isSelf) {
    return { ok: false, reason: "adult-not-self" };
  }
  return { ok: true, isMinor };
}

/**
 * Who must sign, given the participant's age at the lesson.
 * Never trust the client for this.
 */
export function requiredSignerRole(
  birthDate: Date,
  lessonStartAt: Date,
): "PARTICIPANT" | "GUARDIAN" {
  return isMinorAt(birthDate, lessonStartAt) ? "GUARDIAN" : "PARTICIPANT";
}

/** A date of birth in the future, or implying an implausible age, is a typo. */
export function isPlausibleBirthDate(birthDate: DateKey, now = new Date()): boolean {
  const dob = dateKeyToDbDate(birthDate).getTime();
  if (dob > now.getTime()) return false;
  const years = (now.getTime() - dob) / (365.25 * 24 * 3600 * 1000);
  return years <= 110;
}

export function participantErrorMessage(
  reason: ParticipantCheck extends { ok: false; reason: infer R } ? R : never,
  locale: "en" | "zh",
): string {
  const messages = {
    "adult-not-self": {
      en: "Adult students must book and sign with their own Google account, so they cannot be added here.",
      zh: "成年学员需使用本人的 Google 账号预定并签署免责协议,无法代为添加。",
    },
  } as const;
  return messages[reason][locale];
}
