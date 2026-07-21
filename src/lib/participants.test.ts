import { describe, expect, it } from "vitest";
import {
  checkSelfServeParticipant,
  identityKey,
  isPlausibleBirthDate,
  requiredSignerRole,
} from "./participants";
import { dateKeyToDbDate, torontoWallTimeToUtc } from "./time";

const LESSON = torontoWallTimeToUtc("2026-01-15", 9);

describe("identityKey", () => {
  it("collapses spacing, case and punctuation", () => {
    const a = identityKey("Xiao Ming", "2015-03-02");
    expect(identityKey("  xiao   ming ", "2015-03-02")).toBe(a);
    expect(identityKey("Xiao-Ming", "2015-03-02")).toBe(a);
    expect(identityKey("XIAO MING", "2015-03-02")).toBe(a);
  });

  it("separates different people", () => {
    expect(identityKey("Xiao Ming", "2015-03-02")).not.toBe(
      identityKey("Xiao Hong", "2015-03-02"),
    );
    // Same name, different child.
    expect(identityKey("Xiao Ming", "2015-03-02")).not.toBe(
      identityKey("Xiao Ming", "2017-08-11"),
    );
  });

  it("handles CJK names", () => {
    const a = identityKey("小明", "2015-03-02");
    expect(identityKey(" 小明 ", "2015-03-02")).toBe(a);
    expect(identityKey("小红", "2015-03-02")).not.toBe(a);
  });
});

describe("checkSelfServeParticipant", () => {
  it("allows the account holder", () => {
    expect(
      checkSelfServeParticipant({
        birthDate: dateKeyToDbDate("1990-01-01"),
        isSelf: true,
        lessonStartAt: LESSON,
      }),
    ).toEqual({ ok: true, isMinor: false });
  });

  it("allows a minor under the account holder's care", () => {
    expect(
      checkSelfServeParticipant({
        birthDate: dateKeyToDbDate("2015-03-02"),
        isSelf: false,
        lessonStartAt: LESSON,
      }),
    ).toEqual({ ok: true, isMinor: true });
  });

  it("refuses another adult", () => {
    expect(
      checkSelfServeParticipant({
        birthDate: dateKeyToDbDate("1990-01-01"),
        isSelf: false,
        lessonStartAt: LESSON,
      }),
    ).toEqual({ ok: false, reason: "adult-not-self" });
  });

  it("refuses a child who has turned 18 by the lesson date", () => {
    // 17 in January, 18 in March. The January lesson is fine; March is not.
    const dob = dateKeyToDbDate("2008-02-01");
    expect(
      checkSelfServeParticipant({
        birthDate: dob,
        isSelf: false,
        lessonStartAt: torontoWallTimeToUtc("2026-01-15", 9),
      }),
    ).toEqual({ ok: true, isMinor: true });

    expect(
      checkSelfServeParticipant({
        birthDate: dob,
        isSelf: false,
        lessonStartAt: torontoWallTimeToUtc("2026-03-15", 9),
      }),
    ).toEqual({ ok: false, reason: "adult-not-self" });
  });
});

describe("requiredSignerRole", () => {
  it("routes minors to a guardian and adults to themselves", () => {
    expect(requiredSignerRole(dateKeyToDbDate("2015-03-02"), LESSON)).toBe(
      "GUARDIAN",
    );
    expect(requiredSignerRole(dateKeyToDbDate("1990-01-01"), LESSON)).toBe(
      "PARTICIPANT",
    );
  });

  it("switches to self-signing on the 18th birthday", () => {
    const dob = dateKeyToDbDate("2008-02-01");
    expect(
      requiredSignerRole(dob, torontoWallTimeToUtc("2026-01-31", 9)),
    ).toBe("GUARDIAN");
    expect(
      requiredSignerRole(dob, torontoWallTimeToUtc("2026-02-01", 9)),
    ).toBe("PARTICIPANT");
  });
});

describe("isPlausibleBirthDate", () => {
  const now = new Date("2026-07-21T12:00:00Z");

  it("rejects future dates", () => {
    expect(isPlausibleBirthDate("2027-01-01", now)).toBe(false);
  });

  it("rejects implausibly old dates", () => {
    expect(isPlausibleBirthDate("1900-01-01", now)).toBe(false);
  });

  it("accepts ordinary ones", () => {
    expect(isPlausibleBirthDate("1990-01-01", now)).toBe(true);
    expect(isPlausibleBirthDate("2015-03-02", now)).toBe(true);
  });
});
