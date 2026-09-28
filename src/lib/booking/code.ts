import { randomInt } from "node:crypto";

/**
 * Short human-facing booking reference, e.g. "SKI-8F3K2M".
 *
 * Read aloud over WeChat and typed into an e-Transfer memo, so the alphabet
 * drops the characters people confuse: no O/0, I/1, or U (which is easy to
 * mishear as "you" in a voice message).
 *
 * It is a *label*, not a secret — every lookup by code is still authorised.
 */
const ALPHABET = "ABCDEFGHJKLMNPQRSTVWXYZ23456789";
const LENGTH = 6;

export function generateBookingCode(): string {
  let out = "";
  for (let i = 0; i < LENGTH; i++) {
    out += ALPHABET[randomInt(ALPHABET.length)];
  }
  return `SKI-${out}`;
}

/** Same alphabet for a lesson package, e.g. "PKG-8F3K2M". */
export function generatePackageCode(): string {
  return generateBookingCode().replace(/^SKI-/, "PKG-");
}

export function isBookingCode(value: string): boolean {
  return new RegExp(`^SKI-[${ALPHABET}]{${LENGTH}}$`).test(value);
}
