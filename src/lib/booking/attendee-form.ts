export type AdditionalAttendeeInput = { fullName: string; email: string; isMinor: boolean };

/** Preserve retained people while never submitting hidden, removed attendees. */
export function resizeAdditionalAttendees(current: AdditionalAttendeeInput[], headcount: number): AdditionalAttendeeInput[] {
  const count = Math.max(0, Math.min(3, Math.trunc(headcount)) - 1);
  return Array.from({ length: count }, (_, index) => current[index] ?? { fullName: "", email: "", isMinor: false });
}

export function additionalAttendeesComplete(attendees: AdditionalAttendeeInput[]): boolean {
  return attendees.every((attendee) => attendee.fullName.trim().length > 0 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(attendee.email.trim()));
}

export function normalizeAdditionalAttendees(attendees: AdditionalAttendeeInput[]): AdditionalAttendeeInput[] {
  return attendees.map((attendee) => ({
    fullName: attendee.fullName.trim(), email: attendee.email.trim().toLowerCase(), isMinor: attendee.isMinor,
  }));
}
