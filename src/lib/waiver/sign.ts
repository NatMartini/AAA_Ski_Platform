import type { BookingStatus, Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { renderWaiverPdf } from "./render";
import {
  acknowledgementIds,
  TEMPLATE_REVISION,
  TEMPLATE_VERSION,
  templateHash,
  type WaiverVariant,
} from "./template-v1";
import {
  CURRENT_TEMPLATE_VERSION,
  resolveWaiver,
  type ResolveResult,
} from "./validity";
import { seasonOf, seasonRange, type Season } from "../season";
import {
  buildKey,
  deleteObject,
  KEY_PREFIX,
  writeObject,
  sha256,
} from "../storage";
import { bookingInclude, type LoadedBooking } from "../booking/access";
import { areBookingWaiversValid, isAttendeeWaiverValid } from "../booking/group-readiness";
import { lockBookingWaivers } from "../booking/attendees";
import { isSelfServeHoldExpired } from "../booking/hold";
import { addDaysToDateKey, torontoWallTimeToUtc } from "../time";
import { hashInviteToken } from "./invite";

/**
 * Records a signature and produces the signed PDF.
 *
 * The PDF is staged before the database transaction. Every path where the
 * transaction does not adopt that storage key removes it, so a concurrent
 * reuse or failed state transition cannot leave an orphaned signed document.
 *
 * Signed evidence is immutable. Only revokedAt/revokeReason may be updated;
 * the corrected signature is always a new row with its own PDF and audit data.
 */

export type SignInput = {
  booking: LoadedBooking;
  participantId: string;
  participantName: string;
  /** Stored flag on the participant; never a client-supplied value. */
  participantIsMinor: boolean;
  signerUserId: string;
  signerName: string;
  signerEmail: string;
  typedName: string;
  signatureImage: string; // PNG data URL
  consentToElectronic: boolean;
  agreedCheckboxes: Record<string, true>;
  guardianName: string | null;
  guardianPhone: string | null;
  guardianRelationship: string | null;
  ipAddress: string;
  userAgent: string;
  /** The coach's one-time token, checked and consumed under the booking lock. */
  inviteToken?: string;
  /** Individually invited extra guest, without claiming the purchaser's order. */
  attendeeId?: string;
};

export type SignResult =
  | { ok: true; waiverId: string }
  | {
      ok: false;
      reason:
        | "off-season"
        | "missing-acknowledgement"
        | "missing-guardian-details"
        | "bad-signature"
        | "already-signed"
        | "invalid-invite"
        | "expired";
    };

export async function signWaiver(input: SignInput): Promise<SignResult> {
  const { booking } = input;

  const season = seasonOf(booking.lessonStartAt);
  if (!season) return { ok: false, reason: "off-season" };

  const signedAt = new Date();
  if (isSelfServeHoldExpired(booking, signedAt)) {
    return { ok: false, reason: "expired" };
  }

  // Whatever the client believes about who should sign is ignored: this comes
  // from the stored participant row.
  const participantIsMinor = input.participantIsMinor;
  const variant: WaiverVariant = participantIsMinor ? "guardian" : "adult";

  if (participantIsMinor && !input.guardianName?.trim()) {
    return { ok: false, reason: "missing-guardian-details" };
  }

  // Every clause marked as needing its own acknowledgement must actually have
  // been ticked — this is the "brought to their attention" requirement, so it
  // is enforced rather than assumed.
  const required = acknowledgementIds(variant);
  const missing = required.filter((id) => input.agreedCheckboxes[id] !== true);
  if (missing.length > 0 || !input.consentToElectronic) {
    return { ok: false, reason: "missing-acknowledgement" };
  }

  const png = decodePngDataUrl(input.signatureImage);
  if (!png) return { ok: false, reason: "bad-signature" };

  // A booking created before waiver reuse was wired into createBooking may
  // still reach this endpoint even though a matching signature already
  // exists. Attach it atomically and do not collect a redundant signature.
  try {
    const reused = await prisma.$transaction((tx) =>
      reuseStoredWaiver(tx, input, season),
    );
    if (reused) return { ok: true, waiverId: reused };
  } catch (err) {
    if (err instanceof HoldExpiredError) {
      return { ok: false, reason: "expired" };
    }
    if (err instanceof BookingNoLongerSignableError) {
      return { ok: false, reason: "already-signed" };
    }
    if (err instanceof InviteNoLongerSignableError) {
      return { ok: false, reason: "invalid-invite" };
    }
    throw err;
  }

  const hash = templateHash(variant);
  const pdf = await renderWaiverPdf({
    variant,
    bookingCode: booking.code,
    coachName: booking.coach.name ?? booking.coach.email,
    resortName: booking.resort.nameEn,
    lessonStartAt: booking.lessonStartAt,
    lessonEndAt: booking.lessonEndAt,
    totalCents: booking.totalCents,
    currency: booking.currency,
    packageCode: booking.package?.code ?? null,
    season,
    participantName: input.participantName,
    participantIsMinor,
    signerName: input.signerName,
    signerEmail: input.signerEmail,
    typedName: input.typedName,
    signatureImagePng: png,
    guardianName: input.guardianName,
    guardianRelationship: input.guardianRelationship,
    guardianPhone: input.guardianPhone,
    acknowledgedClauseIds: required,
    consentToElectronic: input.consentToElectronic,
    signedAt,
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
    templateHash: hash,
  });

  const key = buildKey(KEY_PREFIX.waiver(), "pdf");
  const written = await writeObject(key, pdf);

  try {
    const waiver = await prisma.$transaction(async (tx) => {
      const resolved = await resolveStoredWaiver(
        tx,
        input.participantId,
        booking.coachId,
        input.participantIsMinor,
        booking.lessonStartAt,
      );

      // Another request may have signed between the early reuse check and the
      // PDF render. Reuse that active row instead of fighting the unique index.
      if (!resolved.needsSigning) {
        await attachWaiverToBookings(
          tx,
          input,
          resolved.waiver.id,
          season,
        );
        return { id: resolved.waiver.id, created: false };
      }

      // When the participant's stored minor status changes, the existing
      // active agreement was signed by the wrong role. Retire it in the same
      // transaction that creates the corrected signature, preserving both
      // audit records without leaving a gap or two active rows.
      if (resolved.reason === "aged-out" || resolved.reason === "now-minor") {
        const retired = await tx.waiver.updateMany({
          where: { id: resolved.waiver.id, revokedAt: null },
          data: {
            revokedAt: signedAt,
            revokeReason:
              resolved.reason === "aged-out"
                ? "participant-now-adult"
                : "participant-now-minor",
          },
        });
        if (retired.count !== 1) throw new WaiverChangedError();
      }

      const created = await tx.waiver.create({
        data: {
          participantId: input.participantId,
          coachId: booking.coachId,
          season,
          templateVersion: CURRENT_TEMPLATE_VERSION,
          templateRevision: TEMPLATE_REVISION,
          templateHash: hash,
          signerUserId: input.signerUserId,
          signerRole: participantIsMinor ? "GUARDIAN" : "PARTICIPANT",
          signerName: input.signerName,
          typedName: input.typedName,
          signatureImage: input.signatureImage,
          participantWasMinor: participantIsMinor,
          guardianName: input.guardianName,
          guardianEmail: participantIsMinor ? input.signerEmail : null,
          guardianPhone: input.guardianPhone,
          guardianRelationship: input.guardianRelationship,
          consentToElectronic: input.consentToElectronic,
          agreedCheckboxes: input.agreedCheckboxes as Prisma.InputJsonValue,
          signedAt,
          ipAddress: input.ipAddress,
          userAgent: input.userAgent,
          signedPdfKey: written.key,
          signedPdfSha256: sha256(pdf),
        },
        select: { id: true },
      });

      await attachWaiverToBookings(
        tx,
        input,
        created.id,
        season,
        resolved.reason === "aged-out" || resolved.reason === "now-minor"
          ? resolved.waiver.id
          : null,
      );

      return { id: created.id, created: true };
    });

    if (!waiver.created) {
      await deleteObject(written.key).catch(() => undefined);
    }
    return { ok: true, waiverId: waiver.id };
  } catch (err) {
    await deleteObject(written.key).catch(() => undefined);
    if (err instanceof HoldExpiredError) {
      return { ok: false, reason: "expired" };
    }
    if (err instanceof InviteNoLongerSignableError) {
      return { ok: false, reason: "invalid-invite" };
    }
    if (
      err instanceof BookingNoLongerSignableError ||
      err instanceof WaiverChangedError
    ) {
      return { ok: false, reason: "already-signed" };
    }
    // A concurrent signature can win the partial unique index. Resolve again
    // and attach the winner, making duplicate submits idempotent.
    if ((err as { code?: string }).code === "P2002") {
      try {
        const reused = await prisma.$transaction((tx) =>
          reuseStoredWaiver(tx, input, season),
        );
        return reused
          ? { ok: true, waiverId: reused }
          : { ok: false, reason: "already-signed" };
      } catch (retryErr) {
        if (retryErr instanceof HoldExpiredError) {
          return { ok: false, reason: "expired" };
        }
        if (retryErr instanceof InviteNoLongerSignableError) {
          return { ok: false, reason: "invalid-invite" };
        }
        return { ok: false, reason: "already-signed" };
      }
    }
    throw err;
  }
}

async function resolveStoredWaiver(
  tx: Prisma.TransactionClient,
  participantId: string,
  coachId: string,
  participantIsMinor: boolean,
  lessonStartAt: Date,
): Promise<ResolveResult> {
  const waivers = await tx.waiver.findMany({
    where: { participantId, coachId },
    select: {
      id: true,
      season: true,
      templateVersion: true,
      participantWasMinor: true,
      revokedAt: true,
      signedAt: true,
    },
  });
  return resolveWaiver({ waivers, participantIsMinor, lessonStartAt });
}

async function reuseStoredWaiver(
  tx: Prisma.TransactionClient,
  input: SignInput,
  season: Season,
): Promise<string | null> {
  const resolved = await resolveStoredWaiver(
    tx,
    input.participantId,
    input.booking.coachId,
    input.participantIsMinor,
    input.booking.lessonStartAt,
  );
  if (resolved.needsSigning) return null;

  await attachWaiverToBookings(tx, input, resolved.waiver.id, season);
  return resolved.waiver.id;
}

async function attachWaiverToBookings(
  tx: Prisma.TransactionClient,
  input: SignInput,
  waiverId: string,
  season: Season,
  replacesWaiverId: string | null = null,
): Promise<void> {
  if (input.booking.headcount > 1) {
    await attachGroupWaiver(tx, input, waiverId);
    return;
  }
  // PDF rendering can outlive the hold. Check the actual transition time;
  // the signature's earlier evidence timestamp must not extend a reservation.
  const now = new Date();
  if (input.inviteToken) {
    await tx.$queryRaw`
      SELECT "id" FROM "Booking" WHERE "id" = ${input.booking.id} FOR UPDATE
    `;
    const invite = await tx.waiverInvite.findUnique({
      where: { bookingId: input.booking.id },
    });
    if (!invite || invite.usedAt || invite.expiresAt.getTime() <= Date.now() ||
        invite.tokenHash !== hashInviteToken(input.inviteToken) ||
        invite.email !== input.signerEmail.trim().toLowerCase()) {
      throw new InviteNoLongerSignableError();
    }
  }
  // A booking paid for from a lesson package owes nothing, so the signature is
  // the last step: it is confirmed rather than sent on to payment.
  const nextStatus =
    input.booking.paymentPlan === "PACKAGE" ? "CONFIRMED" : "AWAITING_PAYMENT";

  const current = await tx.booking.updateMany({
    where: {
      id: input.booking.id,
      waiverId: null,
      OR: [
        // Coach-created bookings deliberately have no timer.
        { status: "AWAITING_WAIVER", holdExpiresAt: null },
        // The original self-serve deadline still applies after signing.
        { status: "HOLD", holdExpiresAt: { gt: now } },
      ],
    },
    data: {
      waiverId,
      status: nextStatus,
      ...(input.inviteToken ? {
        accountId: input.signerUserId,
        participantId: input.participantId,
        participantNameSnapshot: input.participantName,
      } : {}),
    },
  });

  if (current.count !== 1) {
    const latest = await tx.booking.findUnique({
      where: { id: input.booking.id },
      select: { status: true, holdExpiresAt: true, waiverId: true },
    });
    if (
      latest?.status === "EXPIRED" ||
      (latest && isSelfServeHoldExpired(latest, now))
    ) {
      throw new HoldExpiredError();
    }
    // A concurrent identical request already completed the desired update.
    if (latest?.status === nextStatus && latest.waiverId === waiverId) {
      return;
    }
    throw new BookingNoLongerSignableError();
  }

  if (input.inviteToken) {
    const consumed = await tx.waiverInvite.updateMany({
      where: {
        bookingId: input.booking.id,
        tokenHash: hashInviteToken(input.inviteToken),
        usedAt: null,
      },
      data: { usedAt: new Date() },
    });
    if (consumed.count !== 1) throw new InviteNoLongerSignableError();
  }

  // Cover any other pending lesson for this participant with the same coach
  // in this season. Date bounds prevent a January signature from being
  // attached to next December's booking.
  const range = seasonRange(season);
  const seasonStartsAt = torontoWallTimeToUtc(range.start, 0);
  const afterSeasonEndsAt = torontoWallTimeToUtc(
    addDaysToDateKey(range.end, 1),
    0,
  );
  const others = {
    id: { not: input.booking.id },
    participantId: input.participantId,
    coachId: input.booking.coachId,
    headcount: 1,
    lessonStartAt: { gte: seasonStartsAt, lt: afterSeasonEndsAt },
    status: {
      in: ["HOLD", "AWAITING_WAIVER", "AWAITING_PAYMENT"] as BookingStatus[],
    },
    AND: [
      {
        OR: [
          { waiverId: null },
          ...(replacesWaiverId ? [{ waiverId: replacesWaiverId }] : []),
        ],
      },
      { OR: [{ holdExpiresAt: null }, { holdExpiresAt: { gt: now } }] },
    ],
  } satisfies Prisma.BookingWhereInput;
  await tx.booking.updateMany({
    where: { ...others, paymentPlan: "PACKAGE" },
    data: { waiverId, status: "CONFIRMED" },
  });
  await tx.booking.updateMany({
    where: { ...others, paymentPlan: { not: "PACKAGE" } },
    data: { waiverId, status: "AWAITING_PAYMENT" },
  });
}

async function attachGroupWaiver(tx: Prisma.TransactionClient, input: SignInput, waiverId: string) {
  await tx.$queryRaw`SELECT "id" FROM "Booking" WHERE "id" = ${input.booking.id} FOR UPDATE`;
  const current = await tx.booking.findUnique({ where: { id: input.booking.id }, include: bookingInclude });
  const now = new Date();
  if (!current || current.status === "EXPIRED" || isSelfServeHoldExpired(current, now)) throw new HoldExpiredError();
  if (!["HOLD", "AWAITING_WAIVER"].includes(current.status)) throw new BookingNoLongerSignableError();
  const attendee = current.attendees.find((a) => input.attendeeId ? a.id === input.attendeeId : a.ordinal === 1);
  if (!attendee || attendee.isMinor !== input.participantIsMinor || isAttendeeWaiverValid(attendee, current)) {
    throw new BookingNoLongerSignableError();
  }
  if (current.attendees.some((a) => a.id !== attendee.id && a.participantId === input.participantId)) {
    throw new InviteNoLongerSignableError();
  }
  const normalizedEmail = input.signerEmail.trim().toLowerCase();
  if (input.inviteToken) {
    if (attendee.email !== normalizedEmail) throw new InviteNoLongerSignableError();
    if (attendee.ordinal === 1) {
      const invite = await tx.waiverInvite.findUnique({ where: { bookingId: current.id } });
      if (!invite || invite.usedAt || invite.expiresAt <= now ||
          invite.tokenHash !== hashInviteToken(input.inviteToken) || invite.email !== normalizedEmail) {
        throw new InviteNoLongerSignableError();
      }
      const consumed = await tx.waiverInvite.updateMany({ where: { bookingId: current.id,
        tokenHash: invite.tokenHash, usedAt: null }, data: { usedAt: now } });
      if (consumed.count !== 1) throw new InviteNoLongerSignableError();
    } else {
      if (attendee.inviteUsedAt || !attendee.inviteExpiresAt || attendee.inviteExpiresAt <= now ||
          attendee.inviteTokenHash !== hashInviteToken(input.inviteToken)) throw new InviteNoLongerSignableError();
    }
  } else if (attendee.ordinal !== 1 || current.accountId !== input.signerUserId ||
      attendee.participantId !== input.participantId) {
    throw new InviteNoLongerSignableError();
  }
  await tx.bookingAttendee.update({ where: { id: attendee.id }, data: {
    accountId: input.signerUserId, participantId: input.participantId, waiverId,
    ...(input.inviteToken ? { inviteUsedAt: now } : {}),
  } });
  if (attendee.ordinal === 1) {
    await tx.booking.update({ where: { id: current.id }, data: { waiverId,
      ...(current.createdByCoach && input.inviteToken ? {
        accountId: input.signerUserId, participantId: input.participantId,
        participantNameSnapshot: input.participantName,
      } : {}),
    } });
  }
  await lockBookingWaivers(tx, current.id);
  const signed = await tx.booking.findUnique({ where: { id: current.id }, include: bookingInclude });
  if (signed && areBookingWaiversValid(signed)) {
    await tx.booking.update({ where: { id: current.id }, data: { status: "AWAITING_PAYMENT" } });
  }
}

class HoldExpiredError extends Error {}
class BookingNoLongerSignableError extends Error {}
class WaiverChangedError extends Error {}
class InviteNoLongerSignableError extends Error {}

export { TEMPLATE_VERSION, TEMPLATE_REVISION };

/** Decodes the canvas PNG, rejecting anything that is not actually a PNG. */
function decodePngDataUrl(dataUrl: string): Buffer | null {
  const prefix = "data:image/png;base64,";
  if (!dataUrl.startsWith(prefix)) return null;

  let buf: Buffer;
  try {
    buf = Buffer.from(dataUrl.slice(prefix.length), "base64");
  } catch {
    return null;
  }
  if (buf.length < 8 || buf.length > 3_000_000) return null;

  const isPng =
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a;
  return isPng ? buf : null;
}
