import { z } from "zod";
import { FreeSkiError, requestFreeSkiSeason } from "../freeski/adapter";

/**
 * FreeSki's side of a season update, as this site reads it. FreeSki keeps the demonstration videos and does the two
 * steps that need its compute identity: reading the movement out of new videos and rebuilding the scoring reference
 * ("references"), and rebuilding action recognition from the newly published standards ("recognizer").
 */
const stage = z.enum(["references", "recognizer"]);
const runId = z.string().regex(/^[a-f0-9]{32}$/);
const count = z.number().int().nonnegative();
const publication = { source: z.enum(["season", "shipped"]), publishedAt: z.string().max(40).nullable() };

/** The season API this site was written against; a FreeSki without it is running an earlier draft. */
export const MATERIALS_SCHEMA = "freeski_season_materials.v1";

export const materialsSchema = z.object({
  schema_version: z.literal(MATERIALS_SCHEMA),
  guides: z.array(z.object({ file: z.string().max(400), bytes: z.number().nonnegative(), modified: z.string().max(40) })).max(500),
  groups: z.array(z.object({ level: z.number().int().min(1).max(4), action: z.string().max(60), folder: z.string().max(120),
    clips: count, gold: count, extracted: count, pass: count, unscored: count, open: z.boolean() })).max(400),
  unknown: z.array(z.string().max(200)).max(400),
  calibration: z.object({ builtAt: z.string().max(40).nullish(), groups: count, kind: z.string().max(40).nullish(), ...publication }).nullable(),
  // The standard motions FreeSki scores against: this site's, as the last update handed them over, or the shipped set.
  standards: z.object({ count, fingerprint: z.string().max(64), ...publication }).nullable().optional(),
  recognizer: z.object({ builtAt: z.string().max(40).nullish(), actions: z.array(z.string().max(60)).max(200), ...publication }).nullable(),
});
export type SeasonMaterials = z.infer<typeof materialsSchema>;

export const seasonRunSchema = z.object({ runId, stage, status: z.enum(["queued", "running", "done", "failed"]), step: z.string().max(40),
  progress: z.number().min(0).max(1).nullable(), detail: z.record(z.string(), z.unknown()), error: z.string().max(80).nullable(),
  log: z.array(z.string().max(400)).max(200) });
export type SeasonRun = z.infer<typeof seasonRunSchema>;
const startedSchema = z.object({ runId, stage });

export type FreeSkiSeasonClient = {
  /** Null where FreeSki does not offer the season API. */
  materials(signal?: AbortSignal): Promise<SeasonMaterials | null>;
  /** The run this request started, or with `busy` the one FreeSki already has under way (it does one at a time). Null without the season API. */
  rebuild(stage: SeasonRun["stage"], requestKey: string, signal?: AbortSignal): Promise<{ runId: string; stage: SeasonRun["stage"]; busy: boolean } | null>;
  /** Null when FreeSki no longer knows the run. */
  run(runId: string, signal?: AbortSignal): Promise<SeasonRun | null>;
};

function read<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new FreeSkiError("analysis-invalid-response");
  return parsed.data;
}

export const freeSkiSeason: FreeSkiSeasonClient = {
  async materials(signal) {
    const response = await requestFreeSkiSeason({ resource: "materials" }, signal);
    if (!response) return null;
    if (response.status !== 200) throw new FreeSkiError("analysis-invalid-response");
    return read(materialsSchema, response.body);
  },
  async rebuild(stageName, requestKey, signal) {
    const response = await requestFreeSkiSeason({ resource: "rebuild", stage: stageName, requestKey }, signal);
    if (!response) return null;
    if (response.status !== 202 && response.status !== 409) throw new FreeSkiError("analysis-invalid-response");
    return { ...read(startedSchema, response.body), busy: response.status === 409 };
  },
  async run(id, signal) {
    const response = await requestFreeSkiSeason({ resource: "run", runId: id }, signal);
    if (!response || response.status === 404) return null;
    if (response.status !== 200) throw new FreeSkiError("analysis-invalid-response");
    return read(seasonRunSchema, response.body);
  },
};
