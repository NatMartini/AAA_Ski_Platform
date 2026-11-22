import { z } from "zod";
import { parseFreeSkiActionId } from "../freeski/actions";
import { seasonMotionId, type CsiaSeason } from "../freeski/csia-season";
import { STANDARD_MOTION_GROUPS, STANDARD_MOTION_IDS } from "../freeski/standard-motion";

/**
 * A season's action list as the admin edits it (the "update the actions" page) and as it is kept
 * (seasons/csia/<season>.json). What is typed here ends up in JSON, a Markdown table and the page, so names are one
 * line without markup.
 */
const plain = (max: number) => z.string().trim().min(1).max(max).regex(/^[^\u0000-\u001f\u007f|<>`\\]+$/);
const level = z.number().int().min(1).max(4);
const SEASON = /^(20\d\d)-(\d\d)$/;

export const seasonListSchema = z.object({
  season: z.string().regex(SEASON),
  guides: z.array(z.object({ level, file: plain(120), edition: plain(80) })).min(1).max(12),
  actions: z.array(z.object({ level, action: z.string().regex(/^[a-z][a-z0-9_]{1,39}$/), zh: plain(40), en: plain(60), guide: plain(80) })).min(1).max(60),
});
export type SeasonList = z.infer<typeof seasonListSchema>;
export const seasonFileSchema = seasonListSchema.extend({ from: z.string().regex(/^\d{4}-\d\d-\d\d$/), to: z.string().regex(/^\d{4}-\d\d-\d\d$/) });

/** A season runs from June to the end of May, like the time videos are kept; null for a name that is not two consecutive years. */
export function seasonDates(season: string): { from: string; to: string } | null {
  const match = SEASON.exec(season);
  if (!match || Number(match[2]) !== (Number(match[1]) + 1) % 100) return null;
  return { from: `${match[1]}-06-01`, to: `${Number(match[1]) + 1}-05-31` };
}

export type ListProblem = { code: "season" } | { code: "duplicate" | "not-generated"; id: string } | { code: "guide-missing"; level: number };

/**
 * Why a list cannot be run. An action and level outside the known ones has no generation rules and no scoring yet:
 * that takes development, not a button.
 */
export function listProblems(list: SeasonList): ListProblem[] {
  const problems: ListProblem[] = seasonDates(list.season) ? [] : [{ code: "season" }];
  const seen = new Set<string>();
  for (const entry of list.actions) {
    const id = seasonMotionId(entry);
    if (seen.has(id)) problems.push({ code: "duplicate", id });
    seen.add(id);
    if (!(STANDARD_MOTION_IDS as readonly string[]).includes(id) || !parseFreeSkiActionId(`certification:level${entry.level}:${entry.action}`))
      problems.push({ code: "not-generated", id });
  }
  for (const used of [...new Set(list.actions.map(entry => entry.level))].sort())
    if (!list.guides.some(guide => guide.level === used)) problems.push({ code: "guide-missing", level: used });
  return problems;
}

/** Every action and level the site can generate and score, for adding to a list. */
export const KNOWN_ACTIONS = STANDARD_MOTION_GROUPS.flatMap(group =>
  group.levels.map(known => ({ id: `${group.action}-l${known}`, action: group.action as string, level: known as number, zh: group.zh as string, en: group.en as string })));

export const toSeasonFile = (list: SeasonList): CsiaSeason => ({ season: list.season, ...(seasonDates(list.season) ?? { from: "", to: "" }), guides: list.guides, actions: list.actions });
export const toSeasonList = (season: CsiaSeason): SeasonList => ({ season: season.season, guides: season.guides.map(guide => ({ ...guide })), actions: season.actions.map(entry => ({ ...entry })) });

/** The file as it is kept in the repository: one guide and one action per line, so a season's changes read as a short diff. */
export function formatSeasonFile(season: CsiaSeason): string {
  const row = (fields: Record<string, unknown>) => `    { ${Object.entries(fields).map(([key, value]) => `${JSON.stringify(key)}: ${JSON.stringify(value)}`).join(", ")} }`;
  return ["{", `  "season": ${JSON.stringify(season.season)},`, `  "from": ${JSON.stringify(season.from)},`, `  "to": ${JSON.stringify(season.to)},`,
    '  "guides": [', season.guides.map(guide => row({ level: guide.level, file: guide.file, edition: guide.edition })).join(",\n"), "  ],",
    '  "actions": [', season.actions.map(entry => row({ level: entry.level, action: entry.action, zh: entry.zh, en: entry.en, guide: entry.guide })).join(",\n"), "  ]",
    "}", ""].join("\n");
}

export type MotionGroup = { action: string; zh: string; en: string; levels: number[] };

/**
 * The season's actions as the standards library lists them: one row per action, in the order the list first names it.
 * A row is named by the list where every level uses one name, otherwise by the action's general name.
 */
export function seasonMotionGroups(season: Pick<CsiaSeason, "actions">): MotionGroup[] {
  const groups = new Map<string, MotionGroup & { names: Set<string> }>();
  for (const entry of season.actions) {
    const group = groups.get(entry.action) ?? { action: entry.action, zh: entry.zh, en: entry.en, levels: [], names: new Set<string>() };
    if (!group.levels.includes(entry.level)) group.levels.push(entry.level);
    group.names.add(`${entry.zh}\n${entry.en}`);
    groups.set(entry.action, group);
  }
  return [...groups.values()].map(({ names, ...group }) => {
    const general = STANDARD_MOTION_GROUPS.find(known => known.action === group.action);
    return { ...group, ...(names.size > 1 && general ? { zh: general.zh, en: general.en } : {}), levels: group.levels.sort((a, b) => a - b) };
  });
}
