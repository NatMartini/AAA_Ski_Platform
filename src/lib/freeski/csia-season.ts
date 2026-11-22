import current from "../../../seasons/csia/2026-27.json";

/**
 * The current ski season's CSIA actions, as the owner lists them each year from that season's candidate guides
 * (seasons/csia/README.md says how). The standard motions and the action labels follow this list.
 */
export type SeasonAction = { level: number; action: string; zh: string; en: string; guide: string };
export type CsiaSeason = { season: string; from: string; to: string; guides: { level: number; file: string; edition: string }[]; actions: SeasonAction[] };

export const CURRENT_SEASON: CsiaSeason = current;

/** The standard motion generated for a season action. */
export const seasonMotionId = (entry: Pick<SeasonAction, "action" | "level">) => `${entry.action}-l${entry.level}`;
