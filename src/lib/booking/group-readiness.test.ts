import { describe, expect, it } from "vitest";
import { areBookingWaiversValid, isAttendeeWaiverValid, type AttendeeWaiverState, type BookingWaiverState } from "./group-readiness";

const lessonStartAt = new Date("2027-01-15T15:10:00Z");
function attendee(ordinal: number, isMinor = false): AttendeeWaiverState {
  const participantId = `person-${ordinal}`;
  const accountId = isMinor ? "guardian" : `account-${ordinal}`;
  return {
    ordinal, isMinor, accountId, participantId, waiverId: `waiver-${ordinal}`,
    participant: { isMinor, accountId },
    waiver: {
      id: `waiver-${ordinal}`, participantId, coachId: "coach", signerUserId: accountId,
      signerRole: isMinor ? "GUARDIAN" : "PARTICIPANT",
      season: "2026-27", templateVersion: 1, participantWasMinor: isMinor,
      signedAt: new Date("2026-10-05T15:00:00Z"), revokedAt: null,
    },
  };
}
function booking(attendees = [attendee(1), attendee(2), attendee(3)]): BookingWaiverState {
  return {
    headcount: 3, coachId: "coach", lessonStartAt, participantId: attendees[0]?.participantId ?? null,
    participant: attendees[0]?.participant ?? null,
    waiverId: attendees[0]?.waiverId ?? null, waiver: attendees[0]?.waiver ?? null, attendees,
  };
}
describe("group waiver readiness", () => {
  it("accepts a complete group and the legacy one-person record", () => {
    expect(areBookingWaiversValid(booking())).toBe(true);
    expect(areBookingWaiversValid({ ...booking(), headcount: 1, attendees: [] })).toBe(true);
  });
  it("requires every person, even after the purchaser signs", () => {
    expect(areBookingWaiversValid(booking([attendee(1), attendee(2)]))).toBe(false);
    expect(areBookingWaiversValid(booking([attendee(1), { ...attendee(2), waiver: null }, attendee(3)]))).toBe(false);
  });
  it("allows a guardian to sign separately for two different children", () => {
    expect(areBookingWaiversValid(booking([attendee(1), attendee(2, true), attendee(3, true)]))).toBe(true);
  });
  it("rejects duplicate roster positions and duplicate learners", () => {
    expect(areBookingWaiversValid(booking([attendee(1), attendee(2), attendee(2)]))).toBe(false);
    expect(areBookingWaiversValid(booking([attendee(1), attendee(2), { ...attendee(2), ordinal: 3 }]))).toBe(false);
    expect(areBookingWaiversValid(booking([attendee(1), attendee(2), { ...attendee(3), ordinal: 4 }]))).toBe(false);
  });
  it.each([
    { revokedAt: new Date() }, { season: "2025-26" }, { templateVersion: 0 },
    { participantId: "another-person" }, { coachId: "another-coach" },
    { signerUserId: "another-signer" }, { signerRole: "GUARDIAN" as const },
    { participantWasMinor: true }, { id: "another-waiver" },
  ])("rejects a stale or incorrectly attached signature: %j", (change) => {
    const row = attendee(2);
    row.waiver = { ...row.waiver!, ...change };
    expect(isAttendeeWaiverValid(row, booking())).toBe(false);
    expect(areBookingWaiversValid(booking([attendee(1), row, attendee(3)]))).toBe(false);
  });
  it("fails closed after the participant's age or account changes", () => {
    expect(isAttendeeWaiverValid({ ...attendee(2), participant: { isMinor: true, accountId: "account-2" } }, booking())).toBe(false);
    expect(isAttendeeWaiverValid({ ...attendee(2), participant: { isMinor: false, accountId: "someone-else" } }, booking())).toBe(false);
    expect(areBookingWaiversValid({ ...booking(), lessonStartAt: new Date("2027-08-01T15:00:00Z") })).toBe(false);
  });
});
