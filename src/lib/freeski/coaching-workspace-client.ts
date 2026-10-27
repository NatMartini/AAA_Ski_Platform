
export type Phase = "start" | "initiation" | "apex" | "completion" | "end";
export type Anchor = { phase: Phase; time_sec: number };
export type Turn = { turn_id: string; start_time: number; end_time: number };
export type Annotation = { turn_id: string; phase_anchors: Anchor[]; camera_view: string; direction: string; mirror_state: string; phase_anchors_reviewed: boolean };
export type WorkspaceState = {
  schema_version: "coaching_workspace.v1"; job_id: string; revision: number; action?: string;
  actor: { id: string; can_review: boolean }; consent: { allowed: boolean; can_change: boolean };
  turns: Turn[]; annotations: Annotation[]; selected_references: { turn_id: string; version_id: string; status: string }[];
};
export type ReferenceItem = {
  reference_id: string; revision: number; state: string; owner_id: string; version: string | null;
  metadata: { title: string; action: string; learning_stage: string; camera_view: string; direction: string; mirror_state: string;
    start_time: number; end_time: number; phase_anchors: Anchor[]; license?: { basis: string } };
};
export type PublishedReference = { version: string; reference_id: string; metadata: ReferenceItem["metadata"] };
export type ExportState = { exportId: string; state: "queued" | "running" | "ready" | "failed" | "cancelled" | "expired"; format: "mp4" | "webp" };
export type ObservationState={status:string;observationId:string|null;summary:{feature_count:number;event_count:number;feature_ids:string[];
  availability:Record<string,"available"|"unavailable">;sampling:{coverage_fraction:number|null;observed_frame_count:number|null;source_frame_count:number|null}}|null};

export function parseObservationState(value:unknown):ObservationState {
  const row=object(value),summary=row.summary==null?null:object(row.summary);
  if(row.schema_version!=="observation_job.v1"||typeof row.jobId!=="string"||!/^[a-f0-9]{32}$/.test(row.jobId)||
    !["not_requested","unavailable","queued","running","ready","failed","cancelled"].includes(row.status as string)||
    row.observationId!==null&&(typeof row.observationId!=="string"||!/^ob_[a-f0-9]{64}$/.test(row.observationId)))throw Error("invalid-observations");
  if(!summary)return {status:row.status as string,observationId:row.observationId as string|null,summary:null};
  if(summary.schema_version!=="observation_summary.v1"||!Number.isSafeInteger(summary.feature_count)||(summary.feature_count as number)<0||(summary.feature_count as number)>512||
    !Number.isSafeInteger(summary.event_count)||(summary.event_count as number)<0||!Array.isArray(summary.feature_ids)||summary.feature_ids.length>512||
    summary.feature_ids.some(f=>typeof f!=="string"||!/^[a-z][a-z0-9_]{0,100}$/.test(f)))throw Error("invalid-observations");
  const availability:Record<string,"available"|"unavailable">={},raw=object(summary.availability),sampling=object(summary.sampling);
  for(const key of ["camera_motion","persistent_identity","equipment","research_3d"])if(raw[key]==="available"||raw[key]==="unavailable")availability[key]=raw[key];
  const count=(v:unknown)=>Number.isSafeInteger(v)&&(v as number)>=0&&(v as number)<=100000000?v as number:null;
  return {status:row.status as string,observationId:row.observationId as string|null,summary:{feature_count:summary.feature_count as number,event_count:summary.event_count as number,
    feature_ids:summary.feature_ids as string[],availability,sampling:{coverage_fraction:finite(sampling.coverage_fraction)&&sampling.coverage_fraction>=0&&sampling.coverage_fraction<=1?sampling.coverage_fraction:null,
      observed_frame_count:count(sampling.observed_frame_count),source_frame_count:count(sampling.source_frame_count)}}};
}
export const PHASES: Phase[] = ["start", "initiation", "apex", "completion", "end"];
export const VIEWS = ["unknown", "front", "rear", "left_side", "right_side", "oblique_front", "oblique_rear"] as const;
export const STAGES = ["unknown", "snowplow_glide_stop", "linked_snowplow", "stem_matching", "parallel"] as const;
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const turnId = (value: unknown): value is string => typeof value === "string" && /^turn_[0-9]{1,5}$/.test(value);
const versionId = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);

function anchors(value: unknown): Anchor[] {
  if (!Array.isArray(value) || value.length > 12) throw new Error("invalid-workspace");
  let last = -Infinity, previous = -1;
  return value.map(raw => {
    const row = object(raw), phase = PHASES.indexOf(row.phase as Phase);
    if (phase <= previous || phase < 0 || !finite(row.time_sec) || row.time_sec <= last) throw new Error("invalid-workspace");
    previous = phase; last = row.time_sec;
    return { phase: row.phase as Phase, time_sec: row.time_sec };
  });
}

export function parseWorkspace(value: unknown): WorkspaceState {
  const row = object(value), actor = object(row.actor), consent = object(row.consent);
  if (row.schema_version !== "coaching_workspace.v1" || typeof row.job_id !== "string" || !/^[a-f0-9]{32}$/.test(row.job_id) ||
      !Number.isSafeInteger(row.revision) || (row.revision as number) < 0 || typeof actor.id !== "string" || actor.id.length > 200 ||
      typeof actor.can_review !== "boolean" || typeof consent.allowed !== "boolean" || typeof consent.can_change !== "boolean" ||
      !Array.isArray(row.turns) || row.turns.length > 2000 || !Array.isArray(row.annotations) || row.annotations.length > 2000 ||
      !Array.isArray(row.selected_references) || row.selected_references.length > 2000) throw new Error("invalid-workspace");
  const turns = row.turns.map(raw => {
    const t = object(raw);
    if (!turnId(t.turn_id) || !finite(t.start_time) || !finite(t.end_time) || t.start_time < 0 || t.end_time <= t.start_time) throw new Error("invalid-workspace");
    return { turn_id: t.turn_id, start_time: t.start_time, end_time: t.end_time };
  });
  const annotations = row.annotations.map(raw => {
    const a = object(raw);
    if (!turnId(a.turn_id) || !VIEWS.includes(a.camera_view as typeof VIEWS[number]) ||
        !["left", "right", "unknown"].includes(a.direction as string) || !["original", "mirrored", "unknown"].includes(a.mirror_state as string)) throw new Error("invalid-workspace");
    return { turn_id: a.turn_id, phase_anchors: anchors(a.phase_anchors), camera_view: a.camera_view as string,
      direction: a.direction as string, mirror_state: a.mirror_state as string, phase_anchors_reviewed: a.phase_anchors_reviewed === true };
  });
  const selected_references = row.selected_references.map(raw => {
    const s = object(raw);
    if (!turnId(s.turn_id) || !versionId(s.version_id) || !["available", "unavailable"].includes(s.status as string)) throw new Error("invalid-workspace");
    return { turn_id: s.turn_id, version_id: s.version_id, status: s.status as string };
  });
  return { schema_version: "coaching_workspace.v1", job_id: row.job_id, revision: row.revision as number,
    ...(typeof row.action === "string" && /^[a-z][a-z0-9_]{0,63}$/.test(row.action) ? { action: row.action } : {}),
    actor: { id: actor.id, can_review: actor.can_review }, consent: { allowed: consent.allowed, can_change: consent.can_change },
    turns, annotations, selected_references };
}

function metadata(value: unknown, isPublic: boolean): ReferenceItem["metadata"] {
  const row = object(value);
  if (typeof row.action !== "string" || !/^[a-z][a-z0-9_]{0,63}$/.test(row.action) ||
      !STAGES.includes(row.learning_stage as typeof STAGES[number]) || !VIEWS.includes(row.camera_view as typeof VIEWS[number]) ||
      !["left","right","unknown"].includes(row.direction as string) || !["unknown","original","mirrored"].includes(row.mirror_state as string) ||
      !finite(row.start_time) || !finite(row.end_time) || row.start_time < 0 || row.end_time <= row.start_time ||
      (!isPublic && (typeof row.title !== "string" || row.title.length > 160))) throw new Error("invalid-reference");
  const license = object(row.license);
  return { title: isPublic ? "" : row.title as string, action: row.action, learning_stage: row.learning_stage as string,
    camera_view: row.camera_view as string, direction: row.direction as string, mirror_state: row.mirror_state as string,
    start_time: row.start_time, end_time: row.end_time, phase_anchors: anchors(row.phase_anchors),
    ...(["owned","explicit_permission"].includes(license.basis as string) ? { license: { basis: license.basis as string } } : {}) };
}

export function parseReferenceItems(value: unknown): ReferenceItem[] {
  const items = object(value).items;
  if (!Array.isArray(items) || items.length > 200) throw new Error("invalid-reference");
  return items.map(raw => {
    const item = object(raw);
    if (item.schema_version !== "reference_item.v1" || typeof item.reference_id !== "string" || !/^ref_[a-f0-9]{32}$/.test(item.reference_id) ||
        !Number.isSafeInteger(item.revision) || (item.revision as number) < 1 || typeof item.owner_id !== "string" ||
        !["draft","submitted","approved","published","withdrawn","rejected"].includes(item.state as string)) throw new Error("invalid-reference");
    return { reference_id: item.reference_id, revision: item.revision as number, state: item.state as string, owner_id: item.owner_id,
      version: versionId(item.version) ? item.version : null, metadata: metadata(item.metadata, false) };
  });
}

export function parsePublishedReferences(value: unknown): PublishedReference[] {
  const items = object(value).items;
  if (!Array.isArray(items) || items.length > 200) throw new Error("invalid-reference");
  return items.map(raw => {
    const item = object(raw);
    if (item.schema_version !== "reference_manifest.v1" || !versionId(item.version) || typeof item.reference_id !== "string" ||
        !/^ref_[a-f0-9]{32}$/.test(item.reference_id) || item.review_status !== "independently_approved" ||
        item.official_csia_numeric_standard !== false || item.technical_scoring_authorized !== false) throw new Error("invalid-reference");
    return { version: item.version, reference_id: item.reference_id, metadata: metadata(item.metadata, true) };
  });
}

export function parseExportState(value: unknown): ExportState {
  const row = object(value);
  if (row.version !== 1 || typeof row.exportId !== "string" || !/^[a-f0-9]{32}$/.test(row.exportId) ||
      !["queued","running","ready","failed","cancelled","expired"].includes(row.state as string) || !["mp4","webp"].includes(row.format as string)) throw new Error("invalid-export");
  return { exportId: row.exportId, state: row.state as ExportState["state"], format: row.format as ExportState["format"] };
}

export function phasePayload(workspace: WorkspaceState, turn: Turn, values: Record<Phase,string>, context: { camera_view: string; direction: string; mirror_state: string }) {
  const list: Anchor[] = [];
  for (const phase of PHASES) {
    const raw = values[phase].trim();
    if (!raw && phase !== "start" && phase !== "end") continue;
    const time = phase === "start" ? turn.start_time : phase === "end" ? turn.end_time : Number(raw);
    if (!raw || !Number.isFinite(time) || time < turn.start_time || time > turn.end_time || (list.length > 0 && time <= list[list.length-1].time_sec)) throw new Error("invalid-phases");
    list.push({ phase, time_sec: time });
  }
  if (!VIEWS.includes(context.camera_view as typeof VIEWS[number]) || !["left","right","unknown"].includes(context.direction) ||
      !["unknown","original","mirrored"].includes(context.mirror_state)) throw new Error("invalid-phases");
  return { expected_revision: workspace.revision, turn_id: turn.turn_id, phase_anchors: list, ...context };
}

export function referenceDraft(workspace: WorkspaceState, turn: Turn, title: string, learningStage: string, action: string, licenseBasis: string) {
  const saved = workspace.annotations.find(row => row.turn_id === turn.turn_id);
  if (!workspace.consent.allowed || !workspace.consent.can_change || !saved || !title.trim() || title.length > 160 ||
      !STAGES.includes(learningStage as typeof STAGES[number]) || !/^[a-z][a-z0-9_]{0,63}$/.test(action) ||
      !["owned","explicit_permission"].includes(licenseBasis)) throw new Error("draft-not-ready");
  return { split: "reference", title: title.trim(), action, learning_stage: learningStage, camera_view: saved.camera_view,
    direction: saved.direction, mirror_state: saved.mirror_state, start_time: turn.start_time, end_time: turn.end_time,
    phase_anchors: saved.phase_anchors, license: { confirmed: true, basis: licenseBasis, allow_public_display: true } };
}

export function samePrincipal(a: string, b: string) {
  const normalized = (value: string) => value.replace(/^aaa:(owner|coach):([A-Za-z0-9_-]{8,96})$/, "aaa:$2");
  return normalized(a) === normalized(b);
}

export function canIndependentlyReview(workspace: WorkspaceState, item: ReferenceItem) {
  return workspace.actor.can_review && item.state === "submitted" && !samePrincipal(workspace.actor.id,item.owner_id);
}

export function exportPayload(turn: Turn, options: { format: string; mode: string; speed: number; timing: string; start: string; end: string }, clientRequestId: string, hasReference: boolean) {
  const start = Number(options.start), end = Number(options.end);
  if (!options.start.trim() || !options.end.trim() || !Number.isFinite(start) || !Number.isFinite(end) ||
      !["mp4","webp"].includes(options.format) || !["user_only","reviewed_comparison"].includes(options.mode) ||
      ![.25,.5,1].includes(options.speed) || !["original","phase"].includes(options.timing) ||
      options.mode === "reviewed_comparison" && !hasReference || start < turn.start_time || end > turn.end_time ||
      end <= start || end-start > 8.00000001 || (end-start)/options.speed > 20.00000001 ||
      !/^[A-Za-z0-9][A-Za-z0-9:._-]{0,159}$/.test(clientRequestId)) throw new Error("invalid-export-window");
  return { client_request_id: clientRequestId, turn_id: turn.turn_id, format: options.format, mode: options.mode,
    speed: options.speed, timing: options.timing, start_time: start, end_time: end };
}

