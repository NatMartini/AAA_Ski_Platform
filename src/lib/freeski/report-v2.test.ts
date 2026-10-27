import { describe, expect, it } from "vitest";
import { coachingReportSchema, decodeCompactPose, fittedGhost,modelAssessmentSchema, poseFrameAt,referenceTimeAt,turnManifestSchema,type DecodedPose } from "./report-v2";

it("maps reviewed intermediate phases without confusing warped playback with tempo",()=>{
  const manifest=turnManifestSchema.parse({version:1,turnId:"turn_0",startMs:1000,endMs:5000,background:null,userPose:"user-pose",referencePose:"reference-pose",referenceStatus:"reviewed_platform_reference",experimental:true,
    alignment:{schema_version:"turn_alignment.v1",original_time:{user_start:1,reference_start:10,user_duration:4,reference_duration:8,status:"source_time",supports_precise_tempo_comparison:true},
      phase_aligned:{user_times:[1,2,5],reference_times:[10,14,18],phase_labels:["start","apex","end"],method:"reviewed_piecewise_linear",phase_detection:"reviewed_manual",time_warped:true,supports_tempo_diagnosis:false},ghost:{eligible:true,reasons:[]},technique_comparison_authorized:false}});
  expect(referenceTimeAt(manifest.alignment!,1.5,true)).toBe(12);
  expect(referenceTimeAt(manifest.alignment!,1.5,false)).toBe(10.5);
  expect(referenceTimeAt(manifest.alignment!,99,true)).toBe(18);
  expect(turnManifestSchema.safeParse({...manifest,alignment:{...manifest.alignment,phase_aligned:{...manifest.alignment!.phase_aligned,reference_times:[10,9,18]}}}).success).toBe(false);
});
it("fits a display ghost from explicit observed hips and shoulders only",()=>{
  const base:DecodedPose={times:[0],frames:[[[0,20,1],[20,20,1],[0,0,1],[20,0,1]]],observed:[[true,true,true,true]],connections:[[0,1]],resolution:[100,100],jointNames:["left_hip","right_hip","left_shoulder","right_shoulder"]};
  const user={...base,frames:[base.frames[0].map(p=>[p[0]*2+20,p[1]*2+10,p[2]])]};
  expect(fittedGhost(base,0,user,0)?.frames).toEqual(user.frames);
  expect(fittedGhost({...base,jointNames:[]},0,user,0)).toBeNull();
  expect(fittedGhost({...base,observed:[[false,true,true,true]]},0,user,0)).toBeNull();
});

function pack() {
  const xy = Buffer.alloc(32); [10, 20, 30, 40, 50, 60, 70, 80].forEach((n, i) => xy.writeInt32LE(n, i * 4));
  const times = Buffer.alloc(16); times.writeDoubleLE(4, 0); times.writeDoubleLE(4.5, 8);
  return { schema_version: "compact_pose.v1", frame_count: 2, joint_count: 2, coordinate_space: "analysis_pixels",
    coordinate_step: .125, joint_names: ["left_knee", "right_knee"], connections: [[0, 1]], resolution: [640, 360],
    layout: { xy: "int32-le/frame/joint/xy", confidence: "uint8/frame/joint", timestamps: "float64-le/seconds",
      observed: "uint8/frame/joint/0_missing_1_observed", missing: "observed==0" },
    xy_b64: xy.toString("base64"), confidence_b64: Buffer.from([51, 255, 255, 0]).toString("base64"),
    observed_b64: Buffer.from([1, 1, 1, 0]).toString("base64"), timestamps_b64: times.toString("base64") };
}

describe("dynamic pose interoperability", () => {
  it("accepts a safe model name but rejects paths and URLs in public provenance", () => {
    const model = { schema_version: "coaching_diagnosis.v1", learning_stage_candidate: "unknown",
      interpretation_status: "observation_only", reliability: { schema_version: "coaching_reliability.v1", gate_version: "observation-gate-20261023-v1",
        typed_semantics: true, grading_enabled: false, model_free_text_published: false, whole_video_assessed: false, scope: [], reasons: [] },
      summary_zh: "待确认", summary_en: "Uncertain", dimensions: [], findings: [], limitations: ["Uncalibrated"],
      experimental: true, prompt_version: "test-v1", evidence_id: "ev_test", included_turn_ids: [],
      model_provenance: { model: "Qwen-test.gguf", request_id: "chatcmpl-test", project: "ski-platform-text" } };
    expect(modelAssessmentSchema.safeParse(model).success).toBe(true);
    for (const name of ["J:/private/model.gguf", "J:\\private\\model.gguf", "/private/model.gguf", "https://provider/model"]) {
      expect(modelAssessmentSchema.safeParse({ ...model, model_provenance: { ...model.model_provenance, model: name } }).success).toBe(false);
    }
  });
  it("keeps dynamic turns but withholds old free text without a semantic gate", () => {
    const raw = { version: 2, deploymentId: "test-instance", jobId: "a".repeat(32), measurementStatus: "ready",
      modelStatus: "ready", modelAssessment: { summary_zh: "未经校验的全片断言" }, modelError: null,
      referenceAvailability: {}, turns: [], evidenceId: null };
    expect(coachingReportSchema.parse(raw).modelAssessment).toBeNull();
  });
  it("withholds malformed or obsolete text addons without losing valid dynamic turns", () => {
    const model = { schema_version: "coaching_diagnosis.v1", learning_stage_candidate: "unknown", interpretation_status: "observation_only",
      reliability: { schema_version: "coaching_reliability.v1", gate_version: "observation-gate-20261023-v1", typed_semantics: true,
        grading_enabled: false, model_free_text_published: false, whole_video_assessed: false, scope: [], reasons: [] },
      summary_zh: "观察", summary_en: "Observation", dimensions: [], findings: [], limitations: [], experimental: true,
      prompt_version: "test-v1", evidence_id: "ev_test", included_turn_ids: [], exercises: [] };
    const raw = { version: 2, deploymentId: "test-instance", jobId: "a".repeat(32), measurementStatus: "ready", modelStatus: "ready",
      modelAssessment: model, modelError: null, referenceAvailability: {}, evidenceId: null,
      turns: [{ turnId: "turn_0", startMs: 100, endMs: 2000, referenceAvailable: false }] };
    expect(coachingReportSchema.parse(raw).modelAssessment).not.toBeNull();
    for (const addon of [
      { ...model, interpretation_status: "future_mode" },
      { ...model, reliability: { ...model.reliability, gate_version: "old_gate" } },
      { ...model, dimensions: [null] },
      { ...model, findings: [42] },
      { ...model, summary_zh: { text: "malformed" } },
      { ...model, model_provenance: { model: "J:/private/model.gguf", request_id: null, project: "test" } },
    ]) {
      const parsed = coachingReportSchema.parse({ ...raw, modelAssessment: addon });
      expect(parsed.modelAssessment).toBeNull();
      expect(parsed.turns).toEqual(raw.turns);
    }
  });
  it("still rejects invalid report identity or media metadata when the text addon is invalid", () => {
    const raw = { version: 2, deploymentId: "test-instance", jobId: "a".repeat(32), measurementStatus: "ready", modelStatus: "ready",
      modelAssessment: { summary_zh: "legacy" }, modelError: null, referenceAvailability: {}, evidenceId: null,
      turns: [{ turnId: "turn_0", startMs: 100, endMs: 2000, referenceAvailable: false }] };
    expect(coachingReportSchema.safeParse({ ...raw, jobId: "../private" }).success).toBe(false);
    expect(coachingReportSchema.safeParse({ ...raw, turns: [{ ...raw.turns[0], startMs: "invalid" }] }).success).toBe(false);
  });
  it("keeps which standard skeleton the keyframes drew, separately from the turn player's reference", () => {
    const raw = { version: 2, deploymentId: "test-instance", jobId: "a".repeat(32), measurementStatus: "ready", modelStatus: "ready",
      modelAssessment: null, modelError: null, referenceAvailability: {}, evidenceId: null,
      turns: [{ turnId: "turn_0", startMs: 100, endMs: 2000, referenceAvailable: false, comparisonReference: "auto_matched_unreviewed" }] };
    expect(coachingReportSchema.parse(raw).turns[0]).toMatchObject({ referenceAvailable: false, comparisonReference: "auto_matched_unreviewed" });
    // An unknown value is dropped rather than shown; reports from before the field existed still parse.
    const unknown = coachingReportSchema.parse({ ...raw, turns: [{ ...raw.turns[0], comparisonReference: "guessed" }] });
    expect(unknown.turns[0].comparisonReference).toBeUndefined();
    const legacy = { turnId: "turn_0", startMs: 100, endMs: 2000, referenceAvailable: false };
    expect(coachingReportSchema.parse({ ...raw, turns: [legacy] }).turns[0].comparisonReference).toBeUndefined();
  });
  it("does not allow observation mode to publish technical grades or claimed causes", () => {
    const model = { schema_version: "coaching_diagnosis.v1", learning_stage_candidate: "unknown", interpretation_status: "observation_only",
      reliability: { schema_version: "coaching_reliability.v1", gate_version: "observation-gate-20261023-v1", typed_semantics: true,
        grading_enabled: false, model_free_text_published: false, whole_video_assessed: false, scope: [], reasons: [] },
      summary_zh: "观察", summary_en: "Observation", dimensions: [], findings: [], limitations: [], experimental: true,
      prompt_version: "test-v1", evidence_id: "ev_test", included_turn_ids: [], exercises: [] };
    expect(modelAssessmentSchema.safeParse(model).success).toBe(true);
    expect(modelAssessmentSchema.safeParse({ ...model, learning_stage_candidate: "parallel_turns" }).success).toBe(false);
    expect(modelAssessmentSchema.safeParse({ ...model, reliability: { ...model.reliability, grading_enabled: true } }).success).toBe(false);
    expect(modelAssessmentSchema.safeParse({ ...model, dimensions: [{ dimension: "coordination", assessment: "needs_attention", explanation_zh: "假设", explanation_en: "Assumed", evidence_ids: ["turn_0:knee"] }] }).success).toBe(false);
    expect(modelAssessmentSchema.safeParse({ ...model, findings: [{ finding_id: "f1", turn_id: "turn_0", observation_zh: "观察", observation_en: "Observed", hypothesis_zh: "未经核实原因", hypothesis_en: null, evidence_ids: ["turn_0:knee"], exercise_ids: [], priority: "primary" }] }).success).toBe(false);
  });
  it("decodes little-endian quantized coordinates without conflating confidence with missing", () => {
    const decoded = decodeCompactPose(pack());
    expect(decoded.frames[0][0]).toEqual([1.25, 2.5, .2]);
    expect(decoded.observed).toEqual([[true, true], [true, false]]);
    expect(decoded.times).toEqual([4, 4.5]);
    expect(poseFrameAt(decoded, 3)).toBe(0); expect(poseFrameAt(decoded, 4.4)).toBe(0); expect(poseFrameAt(decoded, 99)).toBe(1);
  });
  it.each(["layout", "length", "connections", "time", "mask", "budget"])("rejects invalid %s instead of guessing", kind => {
    const raw = pack();
    if (kind === "layout") raw.layout.xy = "float32-guessed";
    if (kind === "length") raw.xy_b64 = "AAAA";
    if (kind === "connections") raw.connections = [[0, 20]];
    if (kind === "time") { const times = Buffer.alloc(16); times.writeDoubleLE(4); times.writeDoubleLE(3,8); raw.timestamps_b64 = times.toString("base64"); }
    if (kind === "mask") raw.observed_b64 = Buffer.from([1,2,1,0]).toString("base64");
    if (kind === "budget") raw.frame_count = 99_999_999;
    expect(() => decodeCompactPose(raw)).toThrow();
  });
  it("keeps pending/no-reference reports readable and strips unrelated metadata", () => {
    const raw = { version: 2, deploymentId: "test-instance", jobId: "a".repeat(32), measurementStatus: "ready",
      modelStatus: "retry_wait", modelAssessment: null, modelError: "model-waiting", referenceAvailability: { knowledge: "not_loaded" },
      turns: [], evidenceId: null, file_path: "J:/private/secret" };
    expect(coachingReportSchema.parse(raw)).not.toHaveProperty("file_path");
  });
  it.each(["length", "reversed", "outside"])("rejects invalid %s alignment", kind => {
    const manifest = { version: 1, turnId: "turn_0", startMs: 4000, endMs: 6000, background: "background", userPose: "user-pose",
      referencePose: "reference-pose", referenceStatus: "available_unverified", experimental: true, alignment: {
        original_time: { user_start: 4, reference_start: 10, user_duration: 2, reference_duration: 3, status: "estimated_reference_time", supports_precise_tempo_comparison: false },
        phase_aligned: { user_times: [4,6], reference_times: [10,13], method: "linear_whole_turn_visualization", phase_detection: "not_implemented", supports_tempo_diagnosis: false } } };
    expect(turnManifestSchema.safeParse(manifest).success).toBe(true);
    if (kind === "length") manifest.alignment.phase_aligned.reference_times.push(15);
    if (kind === "reversed") manifest.alignment.phase_aligned.user_times = [6,4];
    if (kind === "outside") manifest.alignment.phase_aligned.reference_times = [10,15];
    expect(turnManifestSchema.safeParse(manifest).success).toBe(false);
  });
});
