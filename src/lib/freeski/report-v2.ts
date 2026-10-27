import { z } from "zod";
import { addonStatusSchema, citedTeaching, referenceStatusSchema, scorecardSchema, teachingSchema } from "./scorecard";

const identifier = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,199}$/);
const text = z.string().max(2400);
const evidenceIds = z.array(identifier).max(12);
const dimension = z.object({ dimension: z.enum(["projected_posture", "coordination", "rhythm", "consistency", "goal_execution"]),
  assessment: z.enum(["strength", "developing", "needs_attention", "insufficient_evidence"]),
  explanation_zh: text, explanation_en: text, evidence_ids: evidenceIds });
const finding = z.object({ finding_id: identifier, turn_id: z.string().regex(/^turn_\d{1,5}$/),
  observation_zh: text, observation_en: text, hypothesis_zh: text.nullable().optional(), hypothesis_en: text.nullable().optional(),
  evidence_ids: evidenceIds, reference_segment_id: identifier.nullable().optional(), exercise_ids: z.array(identifier).max(5),
  priority: z.enum(["primary", "secondary"]) });
const reliability = z.object({ schema_version: z.literal("coaching_reliability.v1"),
  gate_version: z.literal("observation-gate-20261023-v1"), typed_semantics: z.boolean(),
  grading_enabled: z.literal(false), model_free_text_published: z.literal(false), whole_video_assessed: z.literal(false),
  scope: z.array(z.object({ turn_id: z.string().regex(/^turn_\d{1,5}$/), start_time: z.number().finite().nonnegative().nullable(),
    end_time: z.number().finite().nonnegative().nullable(), time_status: z.enum(["source_pts", "estimated", "unknown"]).optional() })).max(20),
  reasons: z.array(z.enum(["unreviewed_reference", "uncalibrated_image_plane", "unmatched_bilateral_context",
    "unobserved_ski_axes", "unverified_movement_class", "unverified_feature_semantics"])).max(6) });
export const modelAssessmentSchema = z.object({ schema_version: z.literal("coaching_diagnosis.v1"),
  interpretation_status: z.literal("observation_only"), reliability,
  learning_stage_candidate: z.enum(["snowplow_glide_stop", "linking_snowplow", "wedge_to_parallel", "parallel_turns", "unknown"]),
  summary_zh: text, summary_en: text, dimensions: z.array(dimension).max(5), findings: z.array(finding).max(8),
  limitations: z.array(z.string().max(1600)).max(12), experimental: z.literal(true), prompt_version: identifier,
  evidence_id: identifier, included_turn_ids: z.array(identifier).max(20),
  model_provenance: z.object({ model: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_. -]{0,199}$/).nullable(),
    request_id: z.string().regex(/^[A-Za-z0-9._:-]{1,200}$/).nullable(), project: identifier }).optional(),
  exercises: z.array(z.object({ id: identifier, name_zh: z.string().max(160).optional(), name_en: z.string().max(200).optional(),
    description_zh: z.string().max(1200).optional(), description_en: z.string().max(1200).optional(),
    terrain: z.string().max(200).optional(), source: z.literal("platform_rule_catalogue") })).max(4).optional() }).refine(model =>
      model.learning_stage_candidate === "unknown" && model.dimensions.every(item => item.assessment === "insufficient_evidence") &&
      model.findings.every(item => item.hypothesis_zh == null && item.hypothesis_en == null && item.exercise_ids.length === 0) &&
      (model.exercises?.length ?? 0) === 0, "Observation-only results cannot publish grades, causes or prescriptions");
export const coachingReportSchema = z.object({ version: z.literal(2), deploymentId: identifier,
  jobId: z.string().regex(/^[a-f0-9]{32}$/), measurementStatus: z.string().max(40),
  modelStatus: z.enum(["pending", "running", "ready", "retry_wait", "unavailable", "cancelled"]),
  // Text is an optional addon: an obsolete or malformed gate must not hide valid media.
  modelAssessment: modelAssessmentSchema.nullable().catch(null), modelError: z.string().max(80).nullable(),
  referenceAvailability: z.object({ knowledge: z.string().max(50).optional(), demonstration: z.string().max(50).optional(),
    numeric_calibration: z.string().max(50).optional() }), evidenceId: identifier.nullable(),
  turns: z.array(z.object({ turnId: z.string().regex(/^turn_\d{1,5}$/), startMs: z.number().finite().nonnegative(),
    // referenceAvailable: the turn player can stream a reviewed reference pose. comparisonReference: which
    // standard skeleton the keyframes and explainer drew for the turn (auto-matched CSIA examples have no public pose).
    endMs: z.number().finite().nonnegative(), referenceAvailable: z.boolean(),
    comparisonReference: referenceStatusSchema.optional().catch(undefined) })).max(100),
  // Contract v1 addons. Each fails closed to null on its own so media stays usable.
  scorecard: scorecardSchema.nullable().catch(null),
  teachingStatus: addonStatusSchema.nullable().catch(null),
  teaching: teachingSchema.transform(citedTeaching).nullable().catch(null),
  explainerStatus: addonStatusSchema.nullable().catch(null) });

const originalTime = z.object({ user_start: z.number().finite(), reference_start: z.number().finite(),
  user_duration: z.number().finite().nonnegative(), reference_duration: z.number().finite().nonnegative(),
  status: z.string().max(80), supports_precise_tempo_comparison: z.boolean() });
const phaseMap = z.object({ user_times: z.array(z.number().finite()).min(2).max(100),
  reference_times: z.array(z.number().finite()).min(2).max(100), method: z.enum(["linear_whole_turn_visualization","reviewed_piecewise_linear"]),
  phase_detection: z.enum(["not_implemented","unavailable","reviewed_manual"]), phase_labels:z.array(z.enum(["start","initiation","apex","completion","end"])).max(12).optional(),
  time_warped:z.literal(true).optional(),supports_tempo_diagnosis: z.literal(false) }).refine(map =>
    map.user_times.length === map.reference_times.length &&
    map.user_times.every((value, index) => index === 0 || value > map.user_times[index - 1]) &&
    map.reference_times.every((value, index) => index === 0 || value > map.reference_times[index - 1]) &&
    map.reference_times.at(-1)! > map.reference_times[0] &&
    (map.method!=="reviewed_piecewise_linear" || map.phase_detection==="reviewed_manual"&&map.phase_labels?.length===map.user_times.length) &&
    (map.method!=="linear_whole_turn_visualization"||map.user_times.length===2&&map.phase_detection!=="reviewed_manual"), "Invalid monotone alignment");
export const turnManifestSchema = z.object({ version: z.literal(1), turnId: z.string().regex(/^turn_\d{1,5}$/),
  startMs: z.number().finite().nonnegative(), endMs: z.number().finite().nonnegative(),
  background: z.literal("background").nullable(), userPose: z.literal("user-pose"),
  referencePose: z.literal("reference-pose").nullable(),
  alignment: z.object({ schema_version:z.literal("turn_alignment.v1").optional(),original_time: originalTime, phase_aligned: phaseMap,
    ghost:z.object({eligible:z.boolean(),reasons:z.array(z.string().max(120)).max(12)}).optional(),technique_comparison_authorized:z.literal(false).optional() }).nullable(),
  referenceStatus: z.string().max(80), experimental: z.literal(true) }).refine(manifest => {
    if (manifest.endMs <= manifest.startMs) return false;
    if (!manifest.alignment) return manifest.referencePose === null;
    const { original_time: original, phase_aligned: phase } = manifest.alignment;
    const epsilon = .002;
    return manifest.referencePose !== null && original.user_duration > 0 && original.reference_duration > 0 &&
      Math.abs(original.user_start - manifest.startMs / 1000) <= epsilon &&
      Math.abs(original.user_start + original.user_duration - manifest.endMs / 1000) <= epsilon &&
      Math.abs(phase.user_times[0] - original.user_start) <= epsilon &&
      Math.abs(phase.user_times.at(-1)! - original.user_start - original.user_duration) <= epsilon &&
      Math.abs(phase.reference_times[0] - original.reference_start) <= epsilon &&
      Math.abs(phase.reference_times.at(-1)! - original.reference_start - original.reference_duration) <= epsilon;
  }, "Alignment is outside the source turn");
export type CoachingReport = z.infer<typeof coachingReportSchema>;
export type TurnManifest = z.infer<typeof turnManifestSchema>;

/** Reviewed phases are monotone visualization anchors; time warping never establishes tempo. */
export function referenceTimeAt(alignment: NonNullable<TurnManifest["alignment"]>, time:number, phase:boolean):number {
  const original=alignment.original_time,map=alignment.phase_aligned;
  if(!phase)return Math.min(original.reference_start+original.reference_duration,Math.max(original.reference_start,original.reference_start+time-original.user_start));
  const ts=map.user_times,refs=map.reference_times;
  if(time<=ts[0])return refs[0];
  for(let i=1;i<ts.length;i++)if(time<=ts[i])return refs[i-1]+(time-ts[i-1])/(ts[i]-ts[i-1])*(refs[i]-refs[i-1]);
  return refs.at(-1)!;
}

export type DecodedPose = { times: number[]; frames: number[][][]; observed: boolean[][];
  connections: number[][]; resolution: [number, number] | null; jointNames: string[] };

/** Strict display-only layout. No guessed joint indexing or native arrays in the report. */
export function decodeCompactPose(raw: unknown): DecodedPose {
  const data = z.object({ schema_version: z.literal("compact_pose.v1"),
    frame_count: z.number().int().min(1).max(6000), joint_count: z.number().int().min(1).max(23),
    coordinate_space: z.literal("analysis_pixels"), coordinate_step: z.number().finite().positive().max(8),
    layout: z.object({ xy: z.literal("int32-le/frame/joint/xy"), confidence: z.literal("uint8/frame/joint"),
      timestamps: z.literal("float64-le/seconds"), observed: z.literal("uint8/frame/joint/0_missing_1_observed"), missing: z.literal("observed==0") }),
    xy_b64: z.string().max(2_000_000), confidence_b64: z.string().max(300_000),
    observed_b64: z.string().max(300_000), timestamps_b64: z.string().max(100_000),
    joint_names: z.array(z.string().max(80)).max(23), connections: z.array(z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()])).max(80),
    resolution: z.tuple([z.number().finite().positive().max(16384), z.number().finite().positive().max(16384)]).nullable(),
  }).parse(raw);
  const bytes = (value: string, length: number) => {
    const decoded = atob(value);
    if (decoded.length !== length) throw new Error("Invalid pose byte length");
    return Uint8Array.from(decoded, c => c.charCodeAt(0));
  };
  const n = data.frame_count, k = data.joint_count;
  if (data.joint_names.length !== k || data.connections.some(([a, b]) => a >= k || b >= k)) throw new Error("Invalid pose joint layout");
  const xyBytes = bytes(data.xy_b64, n * k * 8), timeBytes = bytes(data.timestamps_b64, n * 8);
  const xy = new DataView(xyBytes.buffer), timestamps = new DataView(timeBytes.buffer);
  const confidence = bytes(data.confidence_b64, n * k), masks = bytes(data.observed_b64, n * k);
  const times = Array.from({ length: n }, (_, i) => timestamps.getFloat64(i * 8, true));
  if (times.some((t, i) => !Number.isFinite(t) || i > 0 && t <= times[i - 1])) throw new Error("Invalid pose timeline");
  if (masks.some(value => value !== 0 && value !== 1)) throw new Error("Invalid observation mask");
  return { times, connections: data.connections, resolution: data.resolution, jointNames: data.joint_names,
    observed: Array.from({ length: n }, (_, i) => Array.from({ length: k }, (_, j) => masks[i * k + j] === 1)),
    frames: Array.from({ length: n }, (_, i) => Array.from({ length: k }, (_, j) => {
      const offset = (i * k + j) * 8;
      return [xy.getInt32(offset, true) * data.coordinate_step, xy.getInt32(offset + 4, true) * data.coordinate_step, confidence[i * k + j] / 255];
    })) };
}

export function poseFrameAt(pose: DecodedPose, time: number): number {
  let low = 0, high = pose.times.length - 1;
  while (low < high) { const middle = Math.ceil((low + high) / 2); if (pose.times[middle] <= time) low = middle; else high = middle - 1; }
  return low;
}

/** Display-only hip/torso fit. Explicit joint names are required; never guess indexing. */
export function fittedGhost(reference:DecodedPose, referenceTime:number, user:DecodedPose, userTime:number):DecodedPose|null {
  const ri=poseFrameAt(reference,referenceTime),ui=poseFrameAt(user,userTime),r=reference.frames[ri],u=user.frames[ui];
  const center=(pose:DecodedPose,index:number,frame:number[][],left:string,right:string)=>{
    const a=pose.jointNames.indexOf(left),b=pose.jointNames.indexOf(right);
    if(a<0||b<0||!pose.observed[index][a]||!pose.observed[index][b]||frame[a][2]<.3||frame[b][2]<.3)return null;
    return [(frame[a][0]+frame[b][0])/2,(frame[a][1]+frame[b][1])/2];
  };
  const rh=center(reference,ri,r,"left_hip","right_hip"),rs=center(reference,ri,r,"left_shoulder","right_shoulder"),
    uh=center(user,ui,u,"left_hip","right_hip"),us=center(user,ui,u,"left_shoulder","right_shoulder");
  if(!rh||!rs||!uh||!us)return null;
  const rlength=Math.hypot(rs[0]-rh[0],rs[1]-rh[1]),ulength=Math.hypot(us[0]-uh[0],us[1]-uh[1]);
  const scale=ulength/rlength;if(!Number.isFinite(scale)||scale<.25||scale>4||rlength<1||ulength<1)return null;
  return {...reference,resolution:user.resolution,times:[userTime],observed:[reference.observed[ri]],
    frames:[r.map(p=>[(p[0]-rh[0])*scale+uh[0],(p[1]-rh[1])*scale+uh[1],p[2]])]};
}
