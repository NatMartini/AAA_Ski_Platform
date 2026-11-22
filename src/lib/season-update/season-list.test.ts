import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CURRENT_SEASON, seasonMotionId } from "../freeski/csia-season";
import { STANDARD_MOTION_IDS } from "../freeski/standard-motion";
import { formatSeasonFile, KNOWN_ACTIONS, listProblems, seasonDates, seasonListSchema, seasonMotionGroups, toSeasonFile, toSeasonList } from "./season-list";
import { readCurrentSeason } from "./season-store";

const shipped = () => toSeasonList(CURRENT_SEASON);

describe("a season's action list", () => {
  it("dates a season from June to the end of May, and only for two consecutive years", () => {
    expect(seasonDates("2026-27")).toEqual({ from: "2026-06-01", to: "2027-05-31" });
    expect(seasonDates("2099-00")).toEqual({ from: "2099-06-01", to: "2100-05-31" });
    for (const name of ["2026-28", "2026-26", "26-27", "2026/27", ""]) expect(seasonDates(name)).toBeNull();
  });

  it("accepts the shipped season and keeps its file exactly as written", () => {
    expect(seasonListSchema.safeParse(shipped()).success).toBe(true);
    expect(listProblems(shipped())).toEqual([]);
    expect(toSeasonFile(shipped())).toEqual(CURRENT_SEASON);
    const file = readFileSync(join(process.cwd(), "seasons", "csia", `${CURRENT_SEASON.season}.json`), "utf8").split("\r\n").join("\n");
    expect(formatSeasonFile(CURRENT_SEASON)).toBe(file);
  });

  it("says why a list cannot be run", () => {
    const list = shipped();
    list.season = "2027-29";
    list.actions.push({ ...list.actions[0] }, { level: 4, action: "moguls_zipper", zh: "拉链线", en: "Zipper line", guide: "L4CG p.1" },
      // Known as an action, but the site has no standard for it at this level.
      { level: 1, action: "short_turn", zh: "小回转", en: "Short turns", guide: "L1CG p.1" });
    list.guides = list.guides.filter(guide => guide.level !== 3);
    expect(listProblems(list)).toEqual([{ code: "season" }, { code: "duplicate", id: seasonMotionId(list.actions[0]) },
      { code: "not-generated", id: "moguls_zipper-l4" }, { code: "not-generated", id: "short_turn-l1" }, { code: "guide-missing", level: 3 }]);
  });

  it("keeps names to one plain line", () => {
    const withName = (zh: string) => seasonListSchema.safeParse({ ...shipped(), actions: [{ ...shipped().actions[0], zh }] }).success;
    expect(withName("示范平行弯（新）")).toBe(true);
    for (const name of ["", "a|b", "<b>", "back`tick", "line\nbreak", "x".repeat(41)]) expect(withName(name), name).toBe(false);
    expect(seasonListSchema.safeParse({ ...shipped(), actions: [{ ...shipped().actions[0], action: "../evil" }] }).success).toBe(false);
    expect(seasonListSchema.safeParse({ ...shipped(), actions: [] }).success).toBe(false);
  });

  it("offers every action the site can generate", () => {
    expect(KNOWN_ACTIONS.map(action => action.id).sort()).toEqual([...STANDARD_MOTION_IDS].sort());
  });

  it("lists the library by action in the list's order, naming a row by the list where its levels agree", () => {
    const groups = seasonMotionGroups(CURRENT_SEASON);
    expect(groups.map(group => group.action).slice(0, 4)).toEqual(["demonstration_parallel", "intro_parallel", "free_run", "short_turn"]);
    expect(groups.find(group => group.action === "demonstration_parallel")).toEqual({ action: "demonstration_parallel", zh: "示范平行弯", en: "Demonstration parallel", levels: [1, 2, 3, 4] });
    // Level 4 calls it "Expert short radius": the row takes the general name.
    expect(groups.find(group => group.action === "short_turn")).toMatchObject({ en: "Short turns", levels: [2, 3, 4] });
    expect(groups.flatMap(group => group.levels.map(level => `${group.action}-l${level}`)).sort()).toEqual(CURRENT_SEASON.actions.map(seasonMotionId).sort());
    const renamed = seasonMotionGroups({ actions: [{ level: 3, action: "braquage", zh: "搓雪小弯", en: "Pivot slips", guide: "x p.1" }] });
    expect(renamed).toEqual([{ action: "braquage", zh: "搓雪小弯", en: "Pivot slips", levels: [3] }]);
  });
});

describe("the season in use", () => {
  const folders: string[] = [];
  const folder = () => {
    const dir = mkdtempSync(join(tmpdir(), "season-"));
    folders.push(dir);
    mkdirSync(dir, { recursive: true });
    return dir;
  };
  afterEach(() => { for (const dir of folders.splice(0)) rmSync(dir, { recursive: true, force: true }); });

  it("is the published list, and the shipped one when nothing trustworthy is published", () => {
    const dir = folder();
    expect(readCurrentSeason(dir)).toBe(CURRENT_SEASON);
    const next = toSeasonFile({ ...shipped(), season: "2027-28", actions: shipped().actions.slice(0, 5) });
    writeFileSync(join(dir, "2027-28.json"), formatSeasonFile(next));
    writeFileSync(join(dir, "current.json"), JSON.stringify({ season: "2027-28" }));
    expect(readCurrentSeason(dir)).toEqual(next);
    // A pointer outside the folder, a missing file, or a list the site cannot show: the shipped season stands.
    for (const pointer of [{ season: "../2027-28" }, { season: "2028-29" }, {}, "nonsense"]) {
      writeFileSync(join(dir, "current.json"), JSON.stringify(pointer));
      expect(readCurrentSeason(dir)).toBe(CURRENT_SEASON);
    }
    writeFileSync(join(dir, "current.json"), JSON.stringify({ season: "2027-28" }));
    writeFileSync(join(dir, "2027-28.json"), formatSeasonFile({ ...next, actions: [{ level: 4, action: "moguls_zipper", zh: "拉链线", en: "Zipper line", guide: "x p.1" }] }));
    expect(readCurrentSeason(dir)).toBe(CURRENT_SEASON);
  });
});
