import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseFreeSkiActionId } from "./actions";
import { readCurrentSeason } from "../season-update/season-store";
import { seasonMotionId } from "./csia-season";
import { decodeStandardMotion, STANDARD_MOTION_IDS } from "./standard-motion";

/**
 * The yearly check (seasons/csia/README.md): every action of the season in use is known here and has its generated
 * standard. The season in use is the one the last "update the actions" run published, else the shipped one.
 */
const CURRENT_SEASON = readCurrentSeason();
describe(`CSIA season ${CURRENT_SEASON.season}`, () => {
  it.each(CURRENT_SEASON.actions.map(entry => [seasonMotionId(entry), entry] as const))("%s is known and has a generated standard", (id, entry) => {
    expect(parseFreeSkiActionId(`certification:level${entry.level}:${entry.action}`), "the site's action list (src/lib/freeski/actions.ts)").not.toBeNull();
    expect(STANDARD_MOTION_IDS as readonly string[], "the standard motion ids (src/lib/freeski/standard-motion.ts)").toContain(id);
    const file = join(process.cwd(), "public", "standard-motions", `${id}.json`);
    expect(existsSync(file), `public/standard-motions/${id}.json`).toBe(true);
    const motion = decodeStandardMotion(JSON.parse(readFileSync(file, "utf8")));
    expect(motion.level).toBe(entry.level);
    expect(motion.action).toBe(entry.action);
    expect(motion.csia.source).toContain(entry.guide.split(" ")[0]);
  });

  it("lists each action and level once, within the season's dates", () => {
    const ids = CURRENT_SEASON.actions.map(seasonMotionId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(CURRENT_SEASON.from < CURRENT_SEASON.to).toBe(true);
    expect(CURRENT_SEASON.guides.map(guide => guide.level).sort()).toEqual([1, 2, 3, 4]);
  });
});
