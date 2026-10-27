import { describe, expect, it } from "vitest";
import { coachCanTeachRequestedSkills, coachSkillOptions, customSkillLabel, parseCustomSkills, requestedSkillLabel, sanitizeCoachRequestedSkills, skillOptionsUnion, snapshotRequestedSkills } from "./custom-skills";
import { customSkillsSchema, createBookingSchema } from "./validators";

const id = "32fe21ac-0762-40ed-a7cc-90882b0fd6a2";
const focus = { id, key: `custom:${id}`, zh: "  单脚控板  ", en: "" };

describe("coach-defined practice focus", () => {
  it("keeps stable keys and Chinese fallback while rejecting invalid JSON identities", () => {
    expect(parseCustomSkills([focus, focus, { ...focus, key: "custom:somebody-else" }, { ...focus, zh: "  " }]))
      .toEqual([{ id, key: focus.key, zh: "单脚控板", en: "" }]);
    expect(customSkillLabel(focus.key, "en", [focus])).toBe("单脚控板");
    expect(parseCustomSkills(null)).toEqual([]);
  });

  it("rejects forged keys, duplicate identities and excessive catalogues at the settings boundary", () => {
    expect(customSkillsSchema.safeParse([focus]).success).toBe(true);
    expect(customSkillsSchema.safeParse([{ ...focus, key: "wedge" }]).success).toBe(false);
    expect(customSkillsSchema.safeParse([focus, focus]).success).toBe(false);
    expect(customSkillsSchema.safeParse([{ ...focus, zh: " " }]).success).toBe(false);
    expect(customSkillsSchema.safeParse(Array(21).fill(focus)).success).toBe(false);
  });

  it("accepts only the selected coach's custom keys without dropping legitimate UUID keys", () => {
    const profile = { teachableSkills: ["wedge"], customSkills: [focus] };
    expect(sanitizeCoachRequestedSkills(["wedge", focus.key, focus.key, "custom:forged", "arbitrary"], profile))
      .toEqual(["wedge", focus.key]);
    expect(sanitizeCoachRequestedSkills([focus.key], { customSkills: [] })).toEqual([]);
    expect(createBookingSchema.safeParse({ coachId: "coach", date: "2026-12-20", startHour: 9, hours: 2,
      lessonType: "riding", participantId: "self", headcount: 1, requestedSkills: [focus.key] }).success).toBe(true);
  });

  it("freezes bilingual names so later rename/removal cannot rewrite historical orders", () => {
    const profile = { customSkills: [focus] };
    const snapshot = snapshotRequestedSkills([focus.key, "wedge"], profile);
    profile.customSkills = [{ ...focus, zh: "改名", en: "Renamed" }];
    expect(requestedSkillLabel(focus.key, "zh", snapshot)).toBe("单脚控板");
    expect(requestedSkillLabel(focus.key, "en", snapshot)).toBe("单脚控板");
    expect(customSkillLabel(focus.key, "en", profile.customSkills)).toBe("Renamed");
    expect(requestedSkillLabel("wedge", "zh", [])).toBe("犁式");
    expect(customSkillLabel(focus.key, "en", [{ ...focus, zh: "中文新名称" }])).toBe("中文新名称");
  });

  it("builds a day-specific union while respecting advertised builtin options", () => {
    const profile = { teachableSkills: ["wedge"], customSkills: [focus] };
    expect(coachSkillOptions(profile).map((skill) => skill.key)).toEqual(["wedge", focus.key]);
    expect(skillOptionsUnion([profile, profile]).map((skill) => skill.key)).toEqual(["wedge", focus.key]);
    expect(coachSkillOptions({ teachableSkills: [], customSkills: [] })).toEqual([]);
  });
  it("does not infer any builtin capability from an empty or missing configuration", () => {
    expect(coachCanTeachRequestedSkills(["wedge"], {})).toBe(false);
    expect(coachCanTeachRequestedSkills(["wedge"], { teachableSkills: [], customSkills: [focus] })).toBe(false);
    expect(coachSkillOptions({ teachableSkills: [], customSkills: [focus] }).map((skill) => skill.key)).toEqual([focus.key]);
    expect(coachCanTeachRequestedSkills([focus.key], { teachableSkills: [], customSkills: [focus] })).toBe(true);
  });
  it("requires all selected builtin and custom actions, even if most match", () => {
    const profile = { teachableSkills: ["wedge", "parallel"], customSkills: [focus] };
    expect(coachCanTeachRequestedSkills(["wedge", "parallel", focus.key], profile)).toBe(true);
    expect(coachCanTeachRequestedSkills(["wedge", "spin_360"], profile)).toBe(false);
    expect(coachCanTeachRequestedSkills(["wedge", "custom:removed"], profile)).toBe(false);
  });
  it("permits no-focus hour balancing and retains unknown legacy-key sanitization", () => {
    expect(coachCanTeachRequestedSkills([], {})).toBe(true);
    expect(coachCanTeachRequestedSkills(["old-unknown-key"], {})).toBe(true);
    expect(sanitizeCoachRequestedSkills(["old-unknown-key"], {})).toEqual([]);
  });
  it("recognizes only the migrated meanings of an explicitly configured legacy coach profile", () => {
    const stored = ["park_intro", "box_rail"];
    const profile = { teachableSkills: stored, customSkills: [] };
    expect(new Set(coachSkillOptions(profile).map((skill) => skill.key))).toEqual(new Set(["jibbing", "box", "rail"]));
    expect(coachCanTeachRequestedSkills(["jibbing", "box", "rail"], profile)).toBe(true);
    expect(coachCanTeachRequestedSkills(["jibbing", "spin_360"], profile)).toBe(false);
    expect(stored).toEqual(["park_intro", "box_rail"]);
  });
});
