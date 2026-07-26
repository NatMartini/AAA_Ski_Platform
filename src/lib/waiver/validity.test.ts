import { describe, expect, it } from "vitest";
import {
  CURRENT_TEMPLATE_VERSION,
  resolveWaiver,
  type WaiverRecord,
} from "./validity";
import { torontoWallTimeToUtc } from "../time";

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

const JAN_LESSON = torontoWallTimeToUtc("2026-01-15", 9);

describe("resolveWaiver", () => {
  it("requires a signature when nothing is on file", () => {
    const r = resolveWaiver({
      waivers: [],
      participantIsMinor: false,
      lessonStartAt: JAN_LESSON,
    });
    expect(r).toMatchObject({ needsSigning: true, reason: "none", season: "2025-26" });
  });

  it("reuses a signature from earlier in the same season", () => {
    const r = resolveWaiver({
      waivers: [waiver()],
      participantIsMinor: false,
      lessonStartAt: JAN_LESSON,
    });
    expect(r.needsSigning).toBe(false);
  });

  it("does not reuse a signature from a different season", () => {
    const r = resolveWaiver({
      waivers: [waiver({ season: "2024-25" })],
      participantIsMinor: false,
      lessonStartAt: JAN_LESSON,
    });
    expect(r).toMatchObject({ needsSigning: true, reason: "none" });
  });

  it("requires re-signing when the major template version moved", () => {
    const r = resolveWaiver({
      waivers: [waiver({ templateVersion: CURRENT_TEMPLATE_VERSION - 1 })],
      participantIsMinor: false,
      lessonStartAt: JAN_LESSON,
    });
    expect(r).toMatchObject({ needsSigning: true, reason: "superseded" });
  });

  it("ignores revoked signatures", () => {
    const r = resolveWaiver({
      waivers: [waiver({ revokedAt: new Date("2026-01-10T00:00:00Z") })],
      participantIsMinor: false,
      lessonStartAt: JAN_LESSON,
    });
    expect(r).toMatchObject({ needsSigning: true, reason: "revoked" });
  });

  it("picks the most recent live signature when several exist", () => {
    const older = waiver({ id: "old", signedAt: new Date("2025-12-05T00:00:00Z") });
    const newer = waiver({ id: "new", signedAt: new Date("2026-01-05T00:00:00Z") });
    const r = resolveWaiver({
      waivers: [older, newer],
      participantIsMinor: false,
      lessonStartAt: JAN_LESSON,
    });
    expect(r).toMatchObject({ needsSigning: false });
    if (!r.needsSigning) expect(r.waiver.id).toBe("new");
  });

  it("throws rather than guess when the lesson is out of season", () => {
    expect(() =>
      resolveWaiver({
        waivers: [],
        participantIsMinor: false,
        lessonStartAt: torontoWallTimeToUtc("2026-07-21", 9),
      }),
    ).toThrow(/outside any ski season/);
  });
});

describe("resolveWaiver: guardian signature and the minor flag", () => {
  const guardianSigned = waiver({ participantWasMinor: true });

  it("covers a participant who is still a minor", () => {
    const r = resolveWaiver({
      waivers: [guardianSigned],
      participantIsMinor: true,
      lessonStartAt: JAN_LESSON,
    });
    expect(r.needsSigning).toBe(false);
  });

  it("stops covering them once they are marked an adult", () => {
    // This is what replaces the old date-of-birth "aged out" check: flipping
    // the flag retires the guardian's signature.
    const r = resolveWaiver({
      waivers: [guardianSigned],
      participantIsMinor: false,
      lessonStartAt: JAN_LESSON,
    });
    expect(r).toMatchObject({ needsSigning: true, reason: "aged-out" });
  });

  it("requires a guardian when an adult-signed waiver is corrected to a minor", () => {
    const r = resolveWaiver({
      waivers: [waiver({ participantWasMinor: false })],
      participantIsMinor: true,
      lessonStartAt: JAN_LESSON,
    });
    expect(r).toMatchObject({ needsSigning: true, reason: "now-minor" });
  });

  it("leaves a self-signed adult waiver alone", () => {
    const r = resolveWaiver({
      waivers: [waiver({ participantWasMinor: false })],
      participantIsMinor: false,
      lessonStartAt: JAN_LESSON,
    });
    expect(r.needsSigning).toBe(false);
  });
});
