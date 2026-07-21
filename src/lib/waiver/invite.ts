import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { prisma } from "../prisma";
import { baseUrl } from "../mail";
import type { Locale } from "@/i18n/routing";

/**
 * One-time signing links for coach-created bookings.
 *
 * The coach books a slot for a student who may not have an account yet. The
 * student then has to sign for themselves, because nobody can sign a waiver on
 * behalf of another adult.
 *
 * The link is not the authorisation on its own. Opening it still requires
 * signing in with Google, and the signed-in address must match the address the
 * coach issued it to. That binding is what makes the signature attributable to
 * a real, verified person — without it, "whoever had the URL" would be the only
 * evidence of who signed.
 *
 * Only the SHA-256 of the token is stored, so a database leak does not hand
 * over working links.
 */

export const INVITE_TTL_DAYS = 7;

export function generateInviteToken(): string {
  // 256 bits: not brute-forceable, and not worth rate-limiting around.
  return randomBytes(32).toString("base64url");
}

export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function inviteUrl(token: string, locale: Locale): string {
  return `${baseUrl()}/${locale}/w/${token}`;
}

export type InviteCheck =
  | { ok: true; bookingId: string; bookingCode: string; email: string }
  | { ok: false; reason: "invalid" | "email-mismatch"; expected?: string };

/**
 * Validates a token and, if an email is supplied, that it belongs to the person
 * the link was issued to.
 *
 * Expired, already-used and non-existent tokens all return the same "invalid",
 * so the response cannot be used to probe which links exist.
 */
export async function checkInvite(
  token: string,
  signedInEmail?: string,
): Promise<InviteCheck> {
  if (!token || token.length > 200) return { ok: false, reason: "invalid" };

  const invite = await prisma.waiverInvite.findUnique({
    where: { tokenHash: hashInviteToken(token) },
    include: { booking: { select: { id: true, code: true, status: true } } },
  });

  if (!invite) return { ok: false, reason: "invalid" };
  if (invite.usedAt) return { ok: false, reason: "invalid" };
  if (invite.expiresAt.getTime() < Date.now()) {
    return { ok: false, reason: "invalid" };
  }
  if (invite.booking.status !== "AWAITING_WAIVER") {
    return { ok: false, reason: "invalid" };
  }

  if (signedInEmail !== undefined) {
    const a = Buffer.from(invite.email.trim().toLowerCase());
    const b = Buffer.from(signedInEmail.trim().toLowerCase());
    const match = a.length === b.length && timingSafeEqual(a, b);
    if (!match) {
      // Told plainly, because the usual cause is a student signed into a
      // different Google account and the coach can simply reissue.
      return { ok: false, reason: "email-mismatch", expected: invite.email };
    }
  }

  return {
    ok: true,
    bookingId: invite.booking.id,
    bookingCode: invite.booking.code,
    email: invite.email,
  };
}

export async function createInvite(input: {
  bookingId: string;
  email: string;
}): Promise<string> {
  const token = generateInviteToken();
  const expiresAt = new Date(
    Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000,
  );

  await prisma.waiverInvite.upsert({
    where: { bookingId: input.bookingId },
    update: {
      tokenHash: hashInviteToken(token),
      email: input.email.trim().toLowerCase(),
      expiresAt,
      usedAt: null,
      resentCount: { increment: 1 },
    },
    create: {
      bookingId: input.bookingId,
      tokenHash: hashInviteToken(token),
      email: input.email.trim().toLowerCase(),
      expiresAt,
    },
  });

  return token;
}

export async function consumeInvite(bookingId: string): Promise<void> {
  await prisma.waiverInvite.update({
    where: { bookingId },
    data: { usedAt: new Date() },
  });
}
