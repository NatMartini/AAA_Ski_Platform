import { z } from "zod";

export const MAX_SESSION_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const MAX_SESSION_CLOCK_SKEW_MS = 5 * 60 * 1000;
const emailSchema = z.string().email().max(254);

export function normalizedAuthEmail(value: unknown): string | null {
  const parsed = emailSchema.safeParse(value);
  return parsed.success ? parsed.data.toLowerCase() : null;
}

/** Auth.js validates the OIDC signature; this guards the email identity claim. */
export function verifiedGoogleEmail(account: unknown, profile: unknown, userEmail: unknown): string | null {
  if (!account || typeof account !== "object" || !profile || typeof profile !== "object") return null;
  const provider = account as Record<string, unknown>;
  const identity = profile as Record<string, unknown>;
  if (provider.provider !== "google" || (provider.type !== "oidc" && provider.type !== "oauth")
    || identity.email_verified !== true || typeof identity.sub !== "string" || !identity.sub
    || identity.sub !== provider.providerAccountId) return null;
  const email = normalizedAuthEmail(identity.email);
  return email && email === normalizedAuthEmail(userEmail) ? email : null;
}

export function inspectSessionIssuedAt(value: unknown, now = Date.now()):
  { kind: "ok"; issuedAt: number; raw: string } | { kind: "invalid" } | { kind: "expired" } {
  if (typeof value !== "string" || !value) return { kind: "invalid" };
  const issuedAt = Date.parse(value);
  if (!Number.isFinite(issuedAt) || issuedAt > now + MAX_SESSION_CLOCK_SKEW_MS) return { kind: "invalid" };
  if (now - issuedAt > MAX_SESSION_AGE_MS) return { kind: "expired" };
  return { kind: "ok", issuedAt, raw: value };
}

/** Reject legacy cookies on both session reads and Auth.js account-link reads. */
export function hasVerifiedSessionClaims(token: Record<string, unknown> | null, now = Date.now()): boolean {
  if (!token) return false;
  if (typeof token.uid !== "string" || !token.uid.trim() || token.sub !== token.uid) return false;
  const verified = normalizedAuthEmail(token.verifiedGoogleEmail);
  return Boolean(verified && verified === normalizedAuthEmail(token.email)
    && inspectSessionIssuedAt(token.tokenIssuedAt, now).kind === "ok");
}
