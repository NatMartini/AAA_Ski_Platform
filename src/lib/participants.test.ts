import { describe, expect, it } from "vitest";
import {
  checkSelfServeParticipant,
  identityKey,
  requiredSignerRole,
} from "./participants";

describe("identityKey", () => {
  /*
   * Pinned on purpose. The 20260725220000_rehash_participant_identity
   * migration recomputes these values in SQL, so the two implementations have
   * to agree byte for byte — if this function ever changes, that migration
   * (and any future re-key) has to change with it.
   */
  it("produces a stable 32-character hex key", () => {
    expect(identityKey("Wei Zhang")).toBe("c36de78b9d394e35039100080b3d5a75");
    expect(identityKey("小明")).toBe("df3ea25a4369305a82412d479a21bd5e");
    expect(identityKey("testing")).toMatch(/^[0-9a-f]{32}$/);
  });

  it("collapses spacing, case and punctuation", () => {
    const a = identityKey("Xiao Ming");
    expect(identityKey("  xiao   ming ")).toBe(a);
    expect(identityKey("Xiao-Ming")).toBe(a);
    expect(identityKey("XIAO MING")).toBe(a);
  });

  it("separates different people", () => {
    expect(identityKey("Xiao Ming")).not.toBe(identityKey("Xiao Hong"));
  });

  it("handles CJK names", () => {
    const a = identityKey("小明");
    expect(identityKey(" 小明 ")).toBe(a);
    expect(identityKey("小红")).not.toBe(a);
  });
});

describe("checkSelfServeParticipant", () => {
  it("allows the account holder", () => {
    expect(checkSelfServeParticipant({ isMinor: false, isSelf: true })).toEqual({
      ok: true,
    });
  });

  it("allows a minor under the account holder's care", () => {
    expect(checkSelfServeParticipant({ isMinor: true, isSelf: false })).toEqual({
      ok: true,
    });
  });

  it("refuses another adult", () => {
    // Nobody can sign a waiver on behalf of another adult, so this has to be
    // blocked structurally rather than warned about.
    expect(checkSelfServeParticipant({ isMinor: false, isSelf: false })).toEqual(
      { ok: false, reason: "adult-not-self" },
    );
  });

  it("allows the account holder to be a minor themselves", () => {
    expect(checkSelfServeParticipant({ isMinor: true, isSelf: true })).toEqual({
      ok: true,
    });
  });
});

describe("requiredSignerRole", () => {
  it("routes minors to a guardian and adults to themselves", () => {
    expect(requiredSignerRole(true)).toBe("GUARDIAN");
    expect(requiredSignerRole(false)).toBe("PARTICIPANT");
  });
});
