import { z } from "zod";

const actionName = z.string().regex(/^[a-z_]{1,40}$/);
const level = z.enum(["level1", "level2", "level3", "level4"]);
const alternatives = z.array(z.object({ action: actionName, probability: z.number().min(0).max(1) })).max(3);

/**
 * What FreeSki recognised when the action was left open (freeski_action_recognition.v1, FreeSki c754c1c): the action and
 * level it scored, how sure it was, and the next likeliest. "fallback" means too few whole turns to tell, scored as a
 * demonstration parallel; the student is then best asked to choose.
 */
export const actionRecognitionSchema = z.object({
  schema_version: z.literal("freeski_action_recognition.v1"),
  status: z.enum(["recognized", "fallback"]),
  reason: z.string().max(40).nullable().optional(),
  action: actionName,
  level: level.nullable().optional(),
  level_source: z.string().max(40).nullable().optional(),
  confidence: z.number().min(0).max(1).nullable().optional(),
  alternatives: alternatives.optional(),
  turns: z.number().int().min(0).max(10_000).nullable().optional(),
}).transform(raw => ({ status: raw.status, reason: raw.reason ?? null, action: raw.action, level: raw.level ?? null,
  levelSource: raw.level_source ?? null, confidence: raw.confidence ?? null, alternatives: raw.alternatives ?? [], turns: raw.turns ?? null }));

export type ActionRecognition = z.output<typeof actionRecognitionSchema>;

/** The same, as the site stores it with the analysis result. */
export const storedRecognitionSchema: z.ZodType<ActionRecognition> = z.object({
  status: z.enum(["recognized", "fallback"]), reason: z.string().max(40).nullable(), action: actionName, level: level.nullable(),
  levelSource: z.string().max(40).nullable(), confidence: z.number().min(0).max(1).nullable(), alternatives, turns: z.number().int().min(0).max(10_000).nullable(),
});
