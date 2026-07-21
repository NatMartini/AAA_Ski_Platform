import type { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { renderWaiverPdf } from "./render";
import {
  acknowledgementIds,
  TEMPLATE_REVISION,
  TEMPLATE_VERSION,
  templateHash,
  type WaiverVariant,
} from "./template-v1";
import { CURRENT_TEMPLATE_VERSION, isMinorAt } from "./validity";
import { seasonOf } from "../season";
import { buildKey, KEY_PREFIX, writeObject, sha256 } from "../storage";
import { dbDateToDateKey } from "../time";
import type { LoadedBooking } from "../booking/access";

/**
 * Records a signature and produces the signed PDF.
 *
 * The whole thing is one transaction: either the waiver row, the PDF and the
 * booking's new status all land, or none of them do. A signature recorded
 * without its PDF, or a PDF with no record, would both be worse than a clean
 * failure the signer can retry.
 *
 * Waiver rows are never updated after this. A correction means signing again
 * and revoking the old one, which is what makes the stored record defensible.
 */

export type SignInput = {
  booking: LoadedBooking;
  participantId: string;
  participantName: string;
  participantBirthDate: Date;
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
        | "already-signed";
    };

export async function signWaiver(input: SignInput): Promise<SignResult> {
  const { booking } = input;

  const season = seasonOf(booking.lessonStartAt);
  if (!season) return { ok: false, reason: "off-season" };

  // Age is derived from the date of birth against the lesson date, server
  // side. Whatever the client believes about who should sign is ignored.
  const participantIsMinor = isMinorAt(
    input.participantBirthDate,
    booking.lessonStartAt,
  );
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

  const hash = templateHash(variant);
  const signedAt = new Date();

  const pdf = await renderWaiverPdf({
    variant,
    bookingCode: booking.code,
    coachName: booking.coach.name ?? booking.coach.email,
    resortName: booking.resort.nameEn,
    lessonStartAt: booking.lessonStartAt,
    lessonEndAt: booking.lessonEndAt,
    totalCents: booking.totalCents,
    currency: booking.currency,
    season,
    participantName: input.participantName,
    participantBirthDate: dbDateToDateKey(input.participantBirthDate),
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

      // Attach to this booking and to any other live booking with the same
      // coach this season, so the student is not asked to sign twice.
      await tx.booking.updateMany({
        where: {
          participantId: input.participantId,
          coachId: booking.coachId,
          waiverId: null,
          status: { in: ["HOLD", "AWAITING_WAIVER", "AWAITING_PAYMENT"] },
        },
        data: { waiverId: created.id },
      });

      await tx.booking.update({
        where: { id: booking.id },
        data: { waiverId: created.id, status: "AWAITING_PAYMENT" },
      });

      return created;
    });

    return { ok: true, waiverId: waiver.id };
  } catch (err) {
    // Unique on (participant, coach, season, templateVersion): a second signature
    // for the same season is a duplicate submit, not a new agreement.
    if ((err as { code?: string }).code === "P2002") {
      return { ok: false, reason: "already-signed" };
    }
    throw err;
  }
}

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
