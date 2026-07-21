import { describe, expect, it } from "vitest";
import {
  ageAt,
  CURRENT_TEMPLATE_VERSION,
  isMinorAt,
  resolveWaiver,
  type WaiverRecord,
} from "./validity";
import { dateKeyToDbDate, torontoWallTimeToUtc } from "../time";

function waiver(over: Partial<WaiverRecord> = {}): WaiverRecord {
  return {
    id: "w1",
    season: "2025-26",
    templateVersion: CURRENT_TEMPLATE_VERSION,
    participantWasMinor: false,
    revokedAt: null,
    signedAt: new Date("2026-01-08T18:00:00Z"),
    ...over,
  };
}

const ADULT_DOB = dateKeyToDbDate("1990-01-01");
const JAN_LESSON = torontoWallTimeToUtc("2026-01-15", 9);

describe("ageAt", () => {
  it("counts whole years", () => {
    expect(ageAt(dateKeyToDbDate("2008-02-01"), torontoWallTimeToUtc("2026-01-15", 9))).toBe(17);
    expect(ageAt(dateKeyToDbDate("2008-02-01"), torontoWallTimeToUtc("2026-03-15", 9))).toBe(18);
  });

  it("treats the birthday itself as the new age", () => {
    expect(ageAt(dateKeyToDbDate("2008-02-01"), torontoWallTimeToUtc("2026-02-01", 9))).toBe(18);
    expect(ageAt(dateKeyToDbDate("2008-02-01"), torontoWallTimeToUtc("2026-01-31", 9))).toBe(17);
  });

  it("does not vary with the hour of the lesson", () => {
    const dob = dateKeyToDbDate("2008-02-01");
    const morning = torontoWallTimeToUtc("2026-02-01", 9);
    const evening = torontoWallTimeToUtc("2026-02-01", 20);
    expect(ageAt(dob, morning)).toBe(ageAt(dob, evening));
  });
});

describe("isMinorAt", () => {
  it("uses the lesson date, not today", () => {
    const dob = dateKeyToDbDate("2008-02-01");
    expect(isMinorAt(dob, torontoWallTimeToUtc("2026-01-15", 9))).toBe(true);
    expect(isMinorAt(dob, torontoWallTimeToUtc("2026-03-15", 9))).toBe(false);
  });
});

describe("resolveWaiver", () => {
  it("requires a signature when nothing is on file", () => {
    const r = resolveWaiver({
      waivers: [],
      participantBirthDate: ADULT_DOB,
      lessonStartAt: JAN_LESSON,
    });
    expect(r).toMatchObject({ needsSigning: true, reason: "none", season: "2025-26" });
  });

  it("reuses a signature from earlier in the same season", () => {
    const r = resolveWaiver({
      waivers: [waiver()],
      participantBirthDate: ADULT_DOB,
      lessonStartAt: JAN_LESSON,
    });
    expect(r.needsSigning).toBe(false);
  });

  it("does not reuse a signature from a different season", () => {
    const r = resolveWaiver({
      waivers: [waiver({ season: "2024-25" })],
      participantBirthDate: ADULT_DOB,
      lessonStartAt: JAN_LESSON,
    });
    expect(r).toMatchObject({ needsSigning: true, reason: "none" });
  });

  it("requires re-signing when the major template version moved", () => {
    const r = resolveWaiver({
      waivers: [waiver({ templateVersion: CURRENT_TEMPLATE_VERSION - 1 })],
      participantBirthDate: ADULT_DOB,
      lessonStartAt: JAN_LESSON,
    });
    expect(r).toMatchObject({ needsSigning: true, reason: "superseded" });
  });

  it("ignores revoked signatures", () => {
    const r = resolveWaiver({
      waivers: [waiver({ revokedAt: new Date("2026-01-10T00:00:00Z") })],
      participantBirthDate: ADULT_DOB,
      lessonStartAt: JAN_LESSON,
    });
    expect(r).toMatchObject({ needsSigning: true, reason: "revoked" });
  });

  it("picks the most recent live signature when several exist", () => {
    const older = waiver({ id: "old", signedAt: new Date("2025-12-05T00:00:00Z") });
    const newer = waiver({ id: "new", signedAt: new Date("2026-01-05T00:00:00Z") });
    const r = resolveWaiver({
      waivers: [older, newer],
      participantBirthDate: ADULT_DOB,
      lessonStartAt: JAN_LESSON,
    });
    expect(r).toMatchObject({ needsSigning: false });
    if (!r.needsSigning) expect(r.waiver.id).toBe("new");
  });

  it("throws rather than guess when the lesson is out of season", () => {
    expect(() =>
      resolveWaiver({
        waivers: [],
        participantBirthDate: ADULT_DOB,
        lessonStartAt: torontoWallTimeToUtc("2026-07-21", 9),
      }),
    ).toThrow(/outside any ski season/);
  });
});

describe("resolveWaiver: aging out of a guardian signature", () => {
  // Signed by a parent in December while the child was 17; the child turns 18
  // on 2026-02-01.
  const dob = dateKeyToDbDate("2008-02-01");
  const guardianSigned = waiver({ participantWasMinor: true });

  it("still covers lessons taken while they are a minor", () => {
    const r = resolveWaiver({
      waivers: [guardianSigned],
      participantBirthDate: dob,
      lessonStartAt: torontoWallTimeToUtc("2026-01-15", 9),
    });
    expect(r.needsSigning).toBe(false);
  });

  it("stops covering lessons taken after their 18th birthday", () => {
    const r = resolveWaiver({
      waivers: [guardianSigned],
      participantBirthDate: dob,
      lessonStartAt: torontoWallTimeToUtc("2026-03-15", 9),
    });
    expect(r).toMatchObject({ needsSigning: true, reason: "aged-out" });
  });

  it("leaves a self-signed adult waiver alone", () => {
    const r = resolveWaiver({
      waivers: [waiver({ participantWasMinor: false })],
      participantBirthDate: dob,
      lessonStartAt: torontoWallTimeToUtc("2026-03-15", 9),
    });
    expect(r.needsSigning).toBe(false);
  });
});
