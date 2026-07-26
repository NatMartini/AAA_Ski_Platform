import { describe, expect, it } from "vitest";
import {
  LEVELS,
  SKILLS,
  csiaLabel,
  isLevelKey,
  levelRank,
  sanitizeLevelKeys,
  sanitizeSkillKeys,
  skillLabel,
  skillsForTrack,
  skillsByTier,
} from "./skills";

describe("skill catalogue", () => {
  it("has unique keys", () => {
    const keys = SKILLS.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("labels both languages for every skill", () => {
    for (const skill of SKILLS) {
      expect(skill.zh.trim().length).toBeGreaterThan(0);
      expect(skill.en.trim().length).toBeGreaterThan(0);
    }
  });

  it("falls back to the raw key for an unknown one, rather than dropping it", () => {
    // Old bookings must keep rendering if a skill is ever retired.
    expect(skillLabel("no_such_skill", "en")).toBe("no_such_skill");
  });

  it("still labels retired keys, for rows the migration never saw", () => {
    expect(skillLabel("box_rail", "en")).toBe("Boxes & rails");
    expect(skillLabel("spins", "zh")).toBe("转体(180 / 360)");
  });

  it("lists each track in CSIA syllabus order, easiest first", () => {
    const tiers = skillsForTrack("alpine").map((s) => s.tier);
    expect([...tiers].sort((a, b) => a - b)).toEqual(tiers);
  });

  it("groups by certification level without losing or duplicating anything", () => {
    for (const track of ["alpine", "park"] as const) {
      const grouped = skillsByTier(track).flatMap((g) => g.skills);
      expect(grouped).toEqual(skillsForTrack(track));
    }
  });

  it("keeps every manoeuvre separate — no combined entries", () => {
    // "Boxes & rails" or "180 / 360" in one chip is what this replaced.
    for (const skill of SKILLS) {
      expect(skill.zh).not.toMatch(/[/／]/);
      expect(skill.key).not.toMatch(/_(and|or)_/);
    }
  });

  it("covers the park manoeuvres the CSIA park guides teach", () => {
    const park = new Set(skillsForTrack("park").map((s) => s.key));
    for (const key of ["grab", "spin_grab", "box", "rail", "spin_180", "spin_360"]) {
      expect(park.has(key)).toBe(true);
    }
  });
});

describe("sanitizeSkillKeys", () => {
  it("drops anything not in the catalogue", () => {
    expect(sanitizeSkillKeys(["carving", "<script>", "wedge"])).toEqual([
      "carving",
      "wedge",
    ]);
  });

  it("de-duplicates", () => {
    expect(sanitizeSkillKeys(["carving", "carving"])).toEqual(["carving"]);
  });
});

describe("levels", () => {
  it("ranks lowest first and without ties", () => {
    const ranks = LEVELS.map((l) => l.rank);
    expect(new Set(ranks).size).toBe(ranks.length);
    expect(levelRank("first_time")).toBeLessThan(levelRank("advanced"));
  });

  it("ranks an unknown key at zero so it sorts below everything real", () => {
    expect(levelRank("nonsense")).toBe(0);
    expect(isLevelKey("nonsense")).toBe(false);
  });

  it("sanitizes level keys the same way as skills", () => {
    expect(sanitizeLevelKeys(["beginner", "nope"])).toEqual(["beginner"]);
  });
});

describe("csiaLabel", () => {
  it("omits a certification the coach does not hold", () => {
    expect(csiaLabel(null, null, "en")).toEqual([]);
    expect(csiaLabel(2, null, "en")).toEqual(["CSIA Level 2"]);
  });

  it("lists both when the coach holds both", () => {
    expect(csiaLabel(3, 1, "zh")).toEqual(["CSIA 3 级", "CSIA Park 1 级"]);
  });
});
