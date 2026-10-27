import { resolveWaiver, type WaiverRecord } from "../waiver/validity";

type AttachedWaiver = WaiverRecord & {
  participantId: string;
  coachId: string;
  signerUserId: string;
  signerRole: "PARTICIPANT" | "GUARDIAN";
};

type AttachedParticipant = {
  isMinor: boolean;
  accountId: string;
};

export type AttendeeWaiverState = {
  ordinal: number;
  isMinor: boolean;
  accountId: string | null;
  participantId: string | null;
  waiverId: string | null;
  participant: AttachedParticipant | null;
  waiver: AttachedWaiver | null;
};

export type BookingWaiverState = {
  headcount: number;
  coachId: string;
  lessonStartAt: Date;
  participantId: string | null;
  participant: AttachedParticipant | null;
  waiverId: string | null;
  waiver: AttachedWaiver | null;
  attendees?: readonly AttendeeWaiverState[];
};

/** The signer and the current participant must still match the signed record. */
export function isAttendeeWaiverValid(
  attendee: AttendeeWaiverState,
  booking: Pick<BookingWaiverState, "coachId" | "lessonStartAt">,
): boolean {
  const { waiver, participant } = attendee;
  if (
    !waiver || !participant || !attendee.accountId || !attendee.participantId ||
    waiver.id !== attendee.waiverId ||
    waiver.participantId !== attendee.participantId ||
    waiver.coachId !== booking.coachId ||
    waiver.signerUserId !== attendee.accountId ||
    participant.accountId !== attendee.accountId ||
    participant.isMinor !== attendee.isMinor ||
    waiver.signerRole !== (attendee.isMinor ? "GUARDIAN" : "PARTICIPANT")
  ) return false;

  try {
    return !resolveWaiver({
      waivers: [waiver],
      participantIsMinor: participant.isMinor,
      lessonStartAt: booking.lessonStartAt,
    }).needsSigning;
  } catch {
    return false;
  }
}

/** Payment and confirmation require a complete, currently valid roster. */
export function areBookingWaiversValid(booking: BookingWaiverState): boolean {
  if (!Number.isInteger(booking.headcount) || booking.headcount < 1 || booking.headcount > 3) return false;
  if (booking.headcount === 1) {
    return isAttendeeWaiverValid({
      ordinal: 1,
      isMinor: booking.participant?.isMinor ?? false,
      accountId: booking.participant?.accountId ?? null,
      participantId: booking.participantId,
      participant: booking.participant,
      waiverId: booking.waiverId,
      waiver: booking.waiver,
    }, booking);
  }

  const attendees = booking.attendees ?? [];
  if (attendees.length !== booking.headcount) return false;
  if (new Set(attendees.map((a) => a.ordinal)).size !== booking.headcount) return false;
  if (new Set(attendees.map((a) => a.participantId)).size !== booking.headcount) return false;
  const primary = attendees.find((attendee) => attendee.ordinal === 1);
  if (!primary || primary.participantId !== booking.participantId || primary.waiverId !== booking.waiverId) return false;
  return attendees.every((attendee) =>
    Number.isInteger(attendee.ordinal) && attendee.ordinal >= 1 &&
    attendee.ordinal <= booking.headcount && isAttendeeWaiverValid(attendee, booking),
  );
}
