import { prisma } from "../prisma";
import type { ActiveUser } from "../auth/require-user";
import type { Locale } from "@/i18n/routing";
import { baseUrl } from "../mail";
import { bookingInclude, accessFor, loadBooking } from "./access";
import { areBookingWaiversValid, isAttendeeWaiverValid } from "./group-readiness";
import { buildCoachInvitationEmail } from "./invitation-email";
import { generateInviteToken, inviteFields, inviteUrl } from "../waiver/invite";
import { expireElapsedHold, isSelfServeHoldExpired } from "./hold";
import type { CreatedAttendeeInvite } from "./create";
import type { Prisma } from "@prisma/client";

/** Prevent revocation from racing a payment or final signing transition. */
export async function lockBookingWaivers(tx: Prisma.TransactionClient, bookingId: string) {
  await tx.$queryRaw`SELECT "id" FROM "Waiver" WHERE "id" IN (
    SELECT "waiverId" FROM "Booking" WHERE "id" = ${bookingId}
    UNION SELECT "waiverId" FROM "BookingAttendee" WHERE "bookingId" = ${bookingId}
  ) ORDER BY "id" FOR SHARE`;
}

export function attendeeInvitation(input: CreatedAttendeeInvite, code: string, coachName: string, locale: Locale) {
  const signingUrl = inviteUrl(input.token, locale);
  return {
    attendeeId: input.attendeeId, ordinal: input.ordinal, fullName: input.fullName,
    email: input.email, isMinor: input.isMinor, signingUrl,
    invitation: buildCoachInvitationEmail({ code, to: input.email, studentName: input.fullName,
      isMinor: input.isMinor, coachName, signingUrl, expiresAt: input.expiresAt,
      groupSigningOnly: true,
      ...(input.ordinal === 1 ? { bookingUrl: `${baseUrl()}/${locale}/booking/${code}` } : {}),
    }),
  };
}

/** Only order managers see the whole roster; an invited guest sees their own rows. */
export async function loadAttendeeRoster(code: string, user: ActiveUser) {
  const booking = await loadBooking(code);
  if (!booking) return { ok: false, reason: "not-found" } as const;
  const access = accessFor(booking, user);
  const isManager = access.isCustomer || access.isCoach;
  const canManage = isManager && ["HOLD", "AWAITING_WAIVER"].includes(booking.status) &&
    !isSelfServeHoldExpired(booking, new Date());
  const ownRows = booking.attendees.filter((a) =>
    a.accountId === user.id || a.email.toLowerCase() === user.email.trim().toLowerCase());
  if (!isManager && !access.isAnyCoach && ownRows.length === 0) return { ok: false, reason: "forbidden" } as const;
  const rows = isManager || access.isAnyCoach ? booking.attendees : ownRows;
  return { ok: true, canManage, allSigned: areBookingWaiversValid(booking),
    attendees: rows.map((a) => {
      const signed = isAttendeeWaiverValid(a, booking);
      return { id: a.id, ordinal: a.ordinal, fullName: a.fullName, email: a.email,
        isMinor: a.isMinor, signed, signedAt: signed ? a.waiver!.signedAt : null,
        canInvite: canManage && !signed && (a.ordinal > 1 || booking.createdByCoach),
        canReadPdf: access.isAnyCoach || a.accountId === user.id };
    }),
  } as const;
}

/** Cancellation, signing and reissue serialize on the same booking row. */
export async function reissueAttendeeInvite(code: string, attendeeId: string, user: ActiveUser, locale: Locale) {
  const booking = await loadBooking(code);
  if (!booking) return { ok: false, reason: "not-found" } as const;
  const access = accessFor(booking, user);
  if (!access.isCustomer && !access.isCoach) return { ok: false, reason: "forbidden" } as const;
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Booking" WHERE "id" = ${booking.id} FOR UPDATE`;
    const current = await tx.booking.findUnique({ where: { id: booking.id }, include: bookingInclude });
    if (!current) return { ok: false, reason: "not-found" } as const;
    const currentAccess = accessFor(current, user);
    if (!currentAccess.isCustomer && !currentAccess.isCoach) return { ok: false, reason: "forbidden" } as const;
    const now = new Date();
    if (current.status === "EXPIRED" || isSelfServeHoldExpired(current, now)) {
      await expireElapsedHold(tx, current.id, now);
      return { ok: false, reason: "expired" } as const;
    }
    const attendee = current.attendees.find((a) => a.id === attendeeId);
    if (!attendee) return { ok: false, reason: "not-found" } as const;
    if (!["HOLD", "AWAITING_WAIVER"].includes(current.status) ||
        isAttendeeWaiverValid(attendee, current) ||
        (attendee.ordinal === 1 && !current.createdByCoach)) {
      return { ok: false, reason: "not-invitable" } as const;
    }
    const token = generateInviteToken();
    const fields = inviteFields(attendee.email, token, now);
    if (current.holdExpiresAt && fields.expiresAt > current.holdExpiresAt) fields.expiresAt = current.holdExpiresAt;
    if (attendee.ordinal === 1) {
      await tx.waiverInvite.upsert({ where: { bookingId: current.id },
        update: { ...fields, usedAt: null, sentAt: null, resentCount: { increment: 1 } },
        create: { bookingId: current.id, ...fields } });
    } else {
      await tx.bookingAttendee.update({ where: { id: attendee.id }, data: {
        inviteTokenHash: fields.tokenHash, inviteExpiresAt: fields.expiresAt, inviteUsedAt: null,
      } });
    }
    const invitation = attendeeInvitation({ attendeeId: attendee.id, ordinal: attendee.ordinal,
      fullName: attendee.fullName, email: attendee.email, isMinor: attendee.isMinor,
      token, expiresAt: fields.expiresAt }, code, current.coach.name ?? current.coach.email, locale);
    return { ok: true, code, ...invitation } as const;
  });
}
