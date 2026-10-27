import { describe, expect, it } from "vitest";
import { FREESKI_ACTIONS, getFreeSkiActionOption, isFreeSkiActionId, isSubmittableFreeSkiActionId, normalizeFreeSkiCatalog,
  parseFreeSkiActionId, submittedFreeSkiActionId } from "./actions";

describe("FreeSki catalog identity and availability", () => {
  it("keeps compatibility labels disabled while recognizing historical selections", () => {
    expect(FREESKI_ACTIONS.every((action) => !action.available)).toBe(true);
    expect(getFreeSkiActionOption("carving")).toMatchObject({ id: "carving", available: false });
    expect(getFreeSkiActionOption(undefined)).toBeNull();
    expect(isFreeSkiActionId("carving")).toBe(true);
    expect(isFreeSkiActionId("custom:coach-move")).toBe(false);
  });

  it("retains path, level, canonical action and authoritative family in durable IDs", () => {
    expect(parseFreeSkiActionId("certification:level3:hop_turn")).toEqual({
      id: "certification:level3:hop_turn", actionName: "hop_turn", pathType: "certification",
      level: "level3", currentLevel: null, catalogId: "certification:level3:hop_turn", skillFamily: "tactic", isLegacyAlias: false,
    });
    expect(parseFreeSkiActionId("certification:level4:bumps")?.skillFamily).toBe("mogul");
    expect(parseFreeSkiActionId("certification:level4:expert_parallel")?.skillFamily).toBe("carving");
    expect(parseFreeSkiActionId("short_turn")).toMatchObject({ pathType: "improvement", level: null });
    expect(parseFreeSkiActionId("certification:level3:short_turn")).toMatchObject({ pathType: "certification", level: "level3" });
  });

  it("carries the skier's current level on improvement ids and keeps the catalog entry separate", () => {
    expect(parseFreeSkiActionId("improvement:level2:short_turn")).toEqual({
      id: "improvement:level2:short_turn", actionName: "short_turn", pathType: "improvement",
      level: null, currentLevel: "level2", catalogId: "short_turn", skillFamily: "short_turn", isLegacyAlias: false,
    });
    expect(parseFreeSkiActionId("improvement:none:parallel")).toMatchObject({ currentLevel: "none", catalogId: "parallel" });
    // Stored before the level was asked: still readable, no longer submittable.
    expect(parseFreeSkiActionId("parallel")).toMatchObject({ currentLevel: null, catalogId: "parallel" });
    expect(isSubmittableFreeSkiActionId("parallel")).toBe(false);
    expect(isSubmittableFreeSkiActionId("improvement:level4:parallel")).toBe(true);
    expect(isSubmittableFreeSkiActionId("certification:level2:short_turn")).toBe(true);
    expect(getFreeSkiActionOption("improvement:level1:carving")).toMatchObject({ id: "improvement:level1:carving", labelZh: "刻滑" });
  });

  it("builds the submitted id from a catalog choice and the skier's level", () => {
    expect(submittedFreeSkiActionId("short_turn", "level3")).toBe("improvement:level3:short_turn");
    expect(submittedFreeSkiActionId("short_turn", null)).toBeNull();
    expect(submittedFreeSkiActionId("certification:level2:short_turn", null)).toBe("certification:level2:short_turn");
    expect(submittedFreeSkiActionId("certification:level2:short_turn", "level1")).toBe("certification:level2:short_turn");
    expect(submittedFreeSkiActionId("improvement:level2:short_turn", "level3")).toBeNull();
    expect(submittedFreeSkiActionId("invented", "level1")).toBeNull();
  });

  it.each([null, {}, "", "expert_all_terrain", "certification:level0:short_turn",
    "certification:level5:demonstration_parallel", "certification:level1:short_turn",
    "certification:level2:hop_turn", "certification:level3:expert_parallel",
    "certification:level2:__proto__", "certification:level2:custom_move",
    "certification:level2:short_turn:extra", "certification:level2:../parallel",
    "improvement:level5:parallel", "improvement:expert:parallel", "improvement:level2:hop_turn", "improvement:level2:"])("rejects unknown or invalid selections %j", (id) => {
    expect(parseFreeSkiActionId(id)).toBeNull();
    expect(isFreeSkiActionId(id)).toBe(false);
  });

  it("uses only actual catalog entries with explicit true availability", () => {
    const result = normalizeFreeSkiCatalog({
      rubric_system: "csia",
      improvement: { skills: [{ id: "parallel", available: true }, { id: "short_turn", available: "true" },
        { id: "carving" }, { id: "bumps", available: false }, { id: "coach_custom", available: true },
        { id: "improvement:level2:carving", available: true }] },
      certification: { levels: {
        level2: { actions: ["demonstration_parallel", "free_run", "unknown"],
          availability: { demonstration_parallel: true, free_run: 1, unknown: true } },
        level3: { actions: ["hop_turn"], availability: { hop_turn: true } },
      } },
    });
    expect(result.map((option) => option.id)).toEqual([
      "parallel", "short_turn", "carving", "bumps", "certification:level2:demonstration_parallel",
      "certification:level2:free_run", "certification:level3:hop_turn",
    ]);
    expect(result.filter((option) => option.available).map((option) => option.id)).toEqual([
      "parallel", "certification:level2:demonstration_parallel", "certification:level3:hop_turn",
    ]);
    expect(result.some((option) => option.id === "certification:level1:demonstration_parallel")).toBe(false);
  });

  it("preserves all known legacy catalog entries as unavailable instead of fabricating replacement rows", () => {
    const levels = {
      level1: { actions: ["parallel"], availability: { parallel: true } },
      level2: { actions: ["short_radius"], availability: { short_radius: true } },
      level3: { actions: ["advanced_short_radius", "hop_to_hop"], availability: { advanced_short_radius: true, hop_to_hop: true } },
      level4: { actions: ["expert_bumps", "expert_short_turn", "javelin_turns"],
        availability: { expert_bumps: true, expert_short_turn: true, javelin_turns: true } },
    };
    const result = normalizeFreeSkiCatalog({ rubric_system: "csia", certification: { levels } });
    expect(result).toHaveLength(7);
    expect(result.every((option) => !option.available)).toBe(true);
    expect(result.map((option) => option.id)).toContain("certification:level4:javelin_turns");
    expect(parseFreeSkiActionId("certification:level3:hop_to_hop")).toMatchObject({ actionName: "hop_turn", isLegacyAlias: true });
    expect(result.find((option) => option.id === "certification:level1:parallel")?.labelZh).toBe("示范平行弯");
  });

  it("never enables beginner names through historical certification aliases", () => {
    const result = normalizeFreeSkiCatalog({ rubric_system: "csia",
      improvement: { skills: [{ id: "snowplow", available: true }, { id: "linking_turns", available: true }] },
      certification: { levels: { level1: {
        actions: ["wedge_basic", "linking_snowplow", "linking_parallel"],
        availability: { wedge_basic: true, linking_snowplow: true, linking_parallel: true },
      } } },
    });
    expect(result.map((option) => option.id)).toEqual([
      "certification:level1:wedge_basic", "certification:level1:linking_snowplow", "certification:level1:linking_parallel",
    ]);
    expect(result.every((option) => !option.available)).toBe(true);
  });

  it("keeps trusted labels and discards unknown levels, inconsistent action levels and unsupported rubrics", () => {
    expect(normalizeFreeSkiCatalog({ rubric_system: "casi", improvement: { skills: [{ id: "parallel", available: true }] } })).toEqual([]);
    expect(normalizeFreeSkiCatalog({ improvement: { skills: [{ id: "parallel", available: true }] } })).toEqual([]);
    expect(normalizeFreeSkiCatalog({ rubric_system: "csia", rubric: { name: "casi" }, improvement: { skills: [{ id: "parallel", available: true }] } })).toEqual([]);
    const result = normalizeFreeSkiCatalog({
      rubric_system: "csia",
      improvement: { skills: [{ id: "parallel", label: "<script>private</script>", available: true }] },
      certification: { levels: {
        level1: { actions: ["short_turn"], availability: { short_turn: true } },
        level5: { actions: ["demonstration_parallel"], availability: { demonstration_parallel: true } },
      } },
    });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ labelZh: "平行式转弯", labelEn: "Parallel turns", groupZh: "技术提升" });
    expect(JSON.stringify(result)).not.toContain("script");
  });

  it.each([null, undefined, {}, [], "bad response", { improvement: { skills: {} } },
    { certification: { levels: { level2: { actions: "short_turn" } } } }])("does not open a static fallback for malformed data %j", (raw) => {
    expect(normalizeFreeSkiCatalog(raw)).toEqual([]);
  });
});
