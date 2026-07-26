import { createHash } from "node:crypto";

/**
 * Rules that stop one person's waiver being credited to another.
 *
 * The root protection is structural: a Waiver row is keyed to a Participant,
 * so a parent who signed for themselves simply has no row for their child and
 * the lookup misses. These functions add the rest:
 *
 *   1. Participants are picked explicitly from a list, never inferred.
 *   2. Minor status is a stored flag on the participant, applied server side.
 *      A client-supplied value is only trusted when creating a participant, and
 *      never overrides the stored one at booking time.
 *   3. A minor's waiver must be signed by their guardian — the account holder.
 *   4. Self-serve booking refuses to create an adult who is not the account
 *      holder, because no adult can sign a waiver for another adult.
 *   5. Changing the minor flag retires a waiver signed under the old value
 *      (handled in resolveWaiver).
 */

/**
 * Deduplication key for a participant within one account.
 *
 * Prevents someone adding "Xiao Ming" twice and using the second, waiver-free
 * copy. Cross-account duplicates are allowed on purpose: separated parents each
 * keep their own record, and each needs their own signature.
 *
 * Name only, since dates of birth are no longer collected. That makes the key
 * coarser — one account cannot hold two people with the same name — which is
 * the safe direction to err: it forces a rename rather than silently creating a
 * second, unsigned identity.
 */
export function identityKey(fullName: string): string {
  const normalized = fullName
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    // Strip punctuation and spacing so "Xiao-Ming" and "xiao ming" collide.
    .replace(/[.,'’\-_\s]/g, "");
  return createHash("sha256").update(normalized).digest("hex").slice(0, 32);
}

export type ParticipantCheck =
  | { ok: true }
  | { ok: false; reason: "adult-not-self" };

/**
 * Whether this participant may be booked through the self-serve flow.
 *
 * Coaches are not bound by this: they can create a booking for anyone, but the
 * adult student still has to sign for themselves via the signing link.
 */
export function checkSelfServeParticipant(input: {
  isMinor: boolean;
  isSelf: boolean;
}): ParticipantCheck {
  if (!input.isMinor && !input.isSelf) {
    return { ok: false, reason: "adult-not-self" };
  }
  return { ok: true };
}

/**
 * Who must sign. Never trust the client for this — it comes from the stored
 * participant row.
 */
export function requiredSignerRole(
  isMinor: boolean,
): "PARTICIPANT" | "GUARDIAN" {
  return isMinor ? "GUARDIAN" : "PARTICIPANT";
}

export function participantErrorMessage(
  reason: "adult-not-self",
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
