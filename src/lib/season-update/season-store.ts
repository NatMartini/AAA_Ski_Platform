import { readFileSync } from "node:fs";
import path from "node:path";
import { CURRENT_SEASON, type CsiaSeason } from "../freeski/csia-season";
import { listProblems, seasonFileSchema } from "./season-list";

export const seasonsDir = (root = process.cwd()) => path.join(/* turbopackIgnore: true */ root, "seasons", "csia");

/**
 * The season the site is on: the list the last "update the actions" run published (seasons/csia/current.json names its
 * file), else the one shipped with the code. Read on each request, so a published season shows without a restart; a
 * pointer or file that cannot be trusted falls back to the shipped season instead of breaking the pages.
 */
export function readCurrentSeason(dir = seasonsDir()): CsiaSeason {
  try {
    const pointer = JSON.parse(readFileSync(/* turbopackIgnore: true */ path.join(dir, "current.json"), "utf8")) as { season?: unknown };
    if (typeof pointer.season !== "string" || !/^20\d\d-\d\d$/.test(pointer.season)) return CURRENT_SEASON;
    const season = seasonFileSchema.parse(JSON.parse(readFileSync(/* turbopackIgnore: true */ path.join(dir, `${pointer.season}.json`), "utf8")));
    return season.season === pointer.season && listProblems(season).length === 0 ? season : CURRENT_SEASON;
  } catch {
    return CURRENT_SEASON;
  }
}
