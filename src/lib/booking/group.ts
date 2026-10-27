/** Every group member has an individually attributable waiver. */
import { canonicalParticipantName } from "../participant-identity";
export const MAX_SUPPORTED_HEADCOUNT = 3;

export type AdditionalAttendee = { fullName: string; email: string; isMinor: boolean };

export function attendeeIdentity(fullName: string, email: string): string {
  return `${canonicalParticipantName(fullName)}\0${email.trim().toLowerCase()}`;
}
