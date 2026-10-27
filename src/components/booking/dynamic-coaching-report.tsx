"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { coachingReportSchema, decodeCompactPose, poseFrameAt, turnManifestSchema,
  type CoachingReport, type DecodedPose, type TurnManifest } from "@/lib/freeski/report-v2";
import { CoachingWorkspace } from "./coaching-workspace";
import { AnalysisTeaching } from "./analysis-teaching";
import { AnalysisKeyframes } from "./analysis-keyframes";
import { AnalysisExplainer } from "./analysis-explainer";
import { referenceTarget, turnLabel as numberedTurn } from "./analysis-scorecard";
import { withoutOverallScore } from "@/lib/freeski/scorecard";
import { referenceTimeAt,fittedGhost } from "@/lib/freeski/report-v2";
import type { ReferenceStatus } from "@/lib/freeski/scorecard";
import { clientFetch } from "@/lib/client-fetch";

type Playback = { manifest: TurnManifest; user: DecodedPose; reference: DecodedPose | null };
const poseBounds = new WeakMap<DecodedPose, { minX: number; minY: number; width: number; height: number }>();

async function json(url: string, signal?: AbortSignal) {
  const response = await clientFetch(url, { cache: "no-store", signal });
  if (!response.ok) throw new Error("resource-unavailable");
  return response.json();
}

function drawPose(canvas: HTMLCanvasElement, pose: DecodedPose, time: number, onVideo: boolean,color?:string) {
  const context = canvas.getContext("2d");
  if (!context) return;
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(canvas.clientWidth * ratio));
  canvas.height = Math.max(1, Math.round(canvas.clientHeight * ratio));
  context.clearRect(0, 0, canvas.width, canvas.height);
  const index = poseFrameAt(pose, time), frame = pose.frames[index];
  const visible = (i: number) => pose.observed[index][i] && frame[i][2] >= .3;
  let minX = 0, minY = 0, width = pose.resolution?.[0] ?? 1, height = pose.resolution?.[1] ?? 1;
  if (!onVideo || !pose.resolution) {
    let bounds = poseBounds.get(pose);
    if (!bounds) {
      let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
      pose.frames.forEach((f, i) => f.forEach((p, j) => { if (pose.observed[i][j] && p[2] >= .3) {
        left = Math.min(left, p[0]); top = Math.min(top, p[1]); right = Math.max(right, p[0]); bottom = Math.max(bottom, p[1]);
      } }));
      if (!Number.isFinite(left)) return;
      bounds = { minX: left, minY: top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
      poseBounds.set(pose, bounds);
    }
    ({ minX, minY, width, height } = bounds);
  }
  const padding = onVideo ? 0 : 18 * ratio;
  const scale = Math.min((canvas.width - 2 * padding) / width, (canvas.height - 2 * padding) / height);
  const offsetX = (canvas.width - width * scale) / 2, offsetY = (canvas.height - height * scale) / 2;
  const point = (i: number) => [(frame[i][0] - minX) * scale + offsetX, (frame[i][1] - minY) * scale + offsetY];
  context.lineWidth = 2.5 * ratio; context.strokeStyle = color??(onVideo ? "#48b8ff" : "#13a878"); context.fillStyle = context.strokeStyle;
  for (const [a, b] of pose.connections) {
    if (!visible(a) || !visible(b)) continue;
    const start = point(a), end = point(b);
    context.beginPath(); context.moveTo(start[0], start[1]); context.lineTo(end[0], end[1]); context.stroke();
  }
  frame.forEach((_, i) => { if (visible(i)) { const p = point(i); context.beginPath(); context.arc(p[0], p[1], 3 * ratio, 0, 2 * Math.PI); context.fill(); } });
}

function TurnPlayer({ base, turnId, zh, comparison }: { base: string; turnId: string; zh: boolean; comparison?: ReferenceStatus }) {
  const [playback, setPlayback] = useState<Playback | null>(null);
  const [error, setError] = useState(false);
  const [videoError, setVideoError] = useState(false);
  const [speed, setSpeed] = useState(.5);
  const [ghost,setGhost]=useState(false);const ghostCanvas=useRef<HTMLCanvasElement>(null);
  const [mode, setMode] = useState<"original" | "normalized">("normalized");
  const [skeletonTime, setSkeletonTime] = useState(0), [skeletonPlaying, setSkeletonPlaying] = useState(false);
  const video = useRef<HTMLVideoElement>(null), userCanvas = useRef<HTMLCanvasElement>(null), referenceCanvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      const manifest = turnManifestSchema.parse(await json(`${base}/turns/${turnId}`, controller.signal));
      const [user, reference] = await Promise.all([
        json(`${base}/assets/user-pose?turn_id=${turnId}`, controller.signal),
        manifest.referencePose ? json(`${base}/assets/reference-pose?turn_id=${turnId}`, controller.signal) : null,
      ]);
      if (!controller.signal.aborted) { setSkeletonTime(manifest.startMs / 1000); setPlayback({ manifest, user: decodeCompactPose(user), reference: reference ? decodeCompactPose(reference) : null }); }
    })().catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [base, turnId]);

  const redraw = useCallback(() => {
    if (!playback) return;
    const t = video.current?.currentTime ?? skeletonTime, { user, reference, manifest } = playback;
    if (userCanvas.current) drawPose(userCanvas.current, user, t, true);
    if (reference && referenceCanvas.current) {
      const refStart = reference.times[0], refEnd = reference.times.at(-1)!;
      const fraction = Math.max(0, Math.min(1, (t - manifest.startMs / 1000) / ((manifest.endMs - manifest.startMs) / 1000)));
      const refTime = manifest.alignment ? referenceTimeAt(manifest.alignment,t,mode==="normalized") : refStart + fraction * (refEnd-refStart);
      drawPose(referenceCanvas.current, reference, Math.max(refStart, Math.min(refEnd, refTime)), false);
      if(ghost&&manifest.alignment?.ghost?.eligible&&ghostCanvas.current){
        const fitted=fittedGhost(reference,refTime,user,t);
        const ctx=ghostCanvas.current.getContext("2d");ctx?.clearRect(0,0,ghostCanvas.current.width,ghostCanvas.current.height);
        if(fitted)drawPose(ghostCanvas.current,fitted,t,true,"#21d998");
      }
    }
  }, [playback, mode, skeletonTime,ghost]);

  useEffect(() => { redraw(); }, [redraw]);
  useEffect(() => {
    if (!playback || playback.manifest.background && !videoError || !skeletonPlaying) return;
    let frame = 0, last = performance.now();
    const tick = (now: number) => {
      const elapsed = Math.min(.1, (now - last) / 1000) * speed; last = now;
      setSkeletonTime(time => Math.min(playback.manifest.endMs / 1000, time + elapsed));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick); return () => cancelAnimationFrame(frame);
  }, [playback, skeletonPlaying, speed, videoError]);

  useEffect(() => {
    const element = video.current;
    if (!element || !playback) return;
    let frame = 0, disposed = false;
    const callback = () => { if (disposed) return; redraw(); frame = element.requestVideoFrameCallback ? element.requestVideoFrameCallback(callback) : window.requestAnimationFrame(callback); };
    callback();
    element.addEventListener("seeked", redraw); element.addEventListener("loadeddata", redraw); window.addEventListener("resize", redraw);
    return () => { disposed = true; if (element.cancelVideoFrameCallback) element.cancelVideoFrameCallback(frame); else window.cancelAnimationFrame(frame);
      element.removeEventListener("seeked", redraw); element.removeEventListener("loadeddata", redraw); window.removeEventListener("resize", redraw); };
  }, [playback, redraw]);
  useEffect(() => { if (video.current) video.current.playbackRate = speed; }, [speed, playback]);

  if (error) return <p role="status" className="text-sm text-ink-3">{zh ? "动态资源暂不可用，原分析结果仍可查看。" : "Dynamic resources are temporarily unavailable. The base report remains available."}</p>;
  if (!playback) return <p className="text-sm text-ink-3">{zh ? "正在加载这个弯…" : "Loading this turn…"}</p>;
  const { manifest } = playback;
  return <div className="space-y-3">
    <div className="flex flex-wrap items-center gap-3 text-sm">
      <label>{zh ? "播放速度 " : "Playback "}<select value={speed} onChange={e => setSpeed(Number(e.target.value))} className="rounded border border-border bg-surface px-2 py-1">
        <option value={.25}>0.25×</option><option value={.5}>0.5×</option><option value={1}>1×</option></select></label>
      {playback.reference && <label>{zh ? "对比方式 " : "Comparison "}<select value={mode} onChange={e => setMode(e.target.value as typeof mode)} className="rounded border border-border bg-surface px-2 py-1">
        <option value="normalized">{manifest.alignment?.phase_aligned.method==="reviewed_piecewise_linear"?(zh?"已审核阶段对齐":"Reviewed phase alignment"):(zh ? "整弯归一" : "Normalized whole turn")}</option><option value="original">{zh ? "原时间" : "Source time"}</option></select></label>}
      <span className="text-ink-3">{zh ? "用户原弯用时" : "Original user turn"}: {((manifest.endMs - manifest.startMs) / 1000).toFixed(2)}s</span>
    </div>
    {playback.reference&&manifest.alignment?.ghost?.eligible&&<label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={ghost} onChange={e=>setGhost(e.target.checked)}/>{zh?"归一骨架叠加（仅画面示意，不代表空间标定）":"Fit reference skeleton over your video (visual only; no 3D calibration)"}</label>}
    <div className={`grid gap-3 ${playback.reference ? "md:grid-cols-2" : ""}`}>
      <div>
        <p className="mb-1 text-xs text-ink-3">{zh ? "你的滑行与本人骨架" : "Your skiing and skeleton"}</p>
        <div className="relative aspect-video overflow-hidden rounded-lg bg-black">
          {manifest.background && !videoError ? <video ref={video} src={`${base}/assets/background?turn_id=${turnId}`} controls playsInline preload="metadata" className="h-full w-full object-contain" onError={() => setVideoError(true)}
            onLoadedMetadata={() => { if (video.current) { video.current.currentTime = manifest.startMs / 1000; video.current.playbackRate = speed; } }}
            onPlay={() => { if (video.current && (video.current.currentTime >= manifest.endMs / 1000 || video.current.currentTime < manifest.startMs / 1000)) video.current.currentTime = manifest.startMs / 1000; }}
            onTimeUpdate={() => { if (video.current) {
              if (video.current.currentTime < manifest.startMs / 1000) video.current.currentTime = manifest.startMs / 1000;
              if (video.current.currentTime >= manifest.endMs / 1000) { video.current.pause(); if (video.current.currentTime > manifest.endMs / 1000 + .03) video.current.currentTime = manifest.endMs / 1000; }
            } redraw(); }} /> : null}
          <canvas ref={userCanvas} className="pointer-events-none absolute inset-0 h-full w-full" />{ghost&&manifest.alignment?.ghost?.eligible&&<canvas ref={ghostCanvas} className="pointer-events-none absolute inset-0 h-full w-full" aria-label={zh?"已审核参考的归一骨架叠加":"Fitted reviewed reference skeleton"}/>}
        </div>
        {(!manifest.background || videoError) && <div className="mt-2 space-y-2 text-sm"><p className="text-xs text-ink-3">{zh ? "视频代理暂不可用，先播放动态骨架。" : "Video proxy unavailable; skeleton playback is available."}</p>
          <button type="button" className="text-accent underline" onClick={() => { if (skeletonTime >= manifest.endMs / 1000) setSkeletonTime(manifest.startMs / 1000); setSkeletonPlaying(value => !value); }}>{skeletonPlaying ? (zh ? "暂停" : "Pause") : (zh ? "播放骨架" : "Play skeleton")}</button>
          <input aria-label={zh ? "骨架播放位置" : "Skeleton position"} className="w-full" type="range" min={manifest.startMs / 1000} max={manifest.endMs / 1000} step={.01} value={skeletonTime} onChange={e => setSkeletonTime(Number(e.target.value))} /></div>}
      </div>
      {playback.reference && <div><p className="mb-1 text-xs text-ink-3">{manifest.referenceStatus==="reviewed_platform_reference"?(zh ? "参考骨架 · 平台已审核示范" : "Reference skeleton · reviewed platform example"):(zh?"参考骨架 · 尚未核实":"Reference skeleton · unverified")}</p>
        <canvas ref={referenceCanvas} className="aspect-video w-full rounded-lg bg-surface-2" /></div>}
    </div>
    <p className="text-xs leading-relaxed text-ink-3">{!playback.reference ? comparison === "not_available"
        ? (zh ? "这个弯没有匹配的标准动作，只显示你自己的动态。" : "This turn has no matching standard example; only your own movement is shown.")
      // Auto-matched CSIA examples are drawn into keyframes and the explainer, but their poses are not published.
      : comparison === "auto_matched_unreviewed"
        ? (zh ? "暂无审核过的参考示范，这里只播放你自己的动态；关键帧和慢动作讲解里的绿色骨架是自动匹配的 CSIA 示范（未审核）。"
          : "No reviewed reference is available, so only your own movement plays here; the green skeleton in the key frames and explainer is an automatically matched CSIA example (unreviewed).")
      : (zh ? "暂无审核过的参考示范，先查看本人动态；后续参考数据会独立发布。" : "No reviewed reference is available. Your own movement remains visible.")
      : mode === "normalized" ? (zh ? "对齐画面可能变速；阶段以独立审核的人工标注为准。不能用变速后的画面判断谁转得更快。" : "Aligned playback may be time warped. Phases require independently reviewed annotations; warped playback cannot establish which turn was faster.")
      : (zh ? "双方按相同全局倍率播放；参考时间可能来自历史估计，暂不用于精确节奏诊断。" : "Both use the same global playback rate. Historical reference timing may be estimated and is not used for precise tempo assessment.")}</p>
  </div>;
}

export function DynamicCoachingReport({ base, zh }: { base: string; zh: boolean }) {
  const [open, setOpen] = useState(false), [report, setReport] = useState<CoachingReport | null>(null);
  const [selected, setSelected] = useState<string | null>(null), [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout>; let attempts = 0;
    const load = async () => {
      try {
        const value = coachingReportSchema.parse(await json(`${base}/report`, controller.signal));
        if (controller.signal.aborted) return;
        setReport(value); setUnavailable(false);
        const waiting = ["pending", "running", "retry_wait"].includes(value.modelStatus) ||
          value.teachingStatus === "pending" || value.teachingStatus === "running";
        if (waiting && attempts++ < 120) timer = setTimeout(() => void load(), 5000);
      } catch { if (!controller.signal.aborted) { setReport(null); setSelected(null); setUnavailable(true); } }
    };
    void load(); return () => { controller.abort(); clearTimeout(timer); };
  }, [base, open]);
  const model = report?.modelAssessment;
  // The overall score is withheld on the site, so prose quoting it is hidden too.
  const teaching = report?.teaching ? withoutOverallScore(report.teaching, report.scorecard?.overall.score ?? null) : null;
  const turnLabel = (turnId: string) => report?.turns.some(turn => turn.turnId === turnId) ? numberedTurn(turnId, zh) : null;
  // Keyframes and the explainer draw the examples the scorecard compared; name them the same way.
  const target = report?.scorecard ? referenceTarget(report.scorecard) : null;
  return <div className="border-t border-border pt-3">
    <button type="button" className="text-sm font-semibold text-accent underline underline-offset-4" onClick={() => setOpen(value => !value)}>
      {zh ? "FreeSki 自动评价与逐弯动态对比" : "FreeSki assessment and dynamic turn comparison"}</button>
    {open && <div className="mt-3 space-y-4">
      {unavailable ? <p className="text-sm text-ink-3">{zh ? "此报告暂未提供动态分析；已有技术评分和建议仍保留。" : "Dynamic analysis is not available for this report. Existing scores and advice remain available."}</p>
        : !report ? <p className="text-sm text-ink-3">{zh ? "正在读取分析…" : "Loading analysis…"}</p> : <>
          {report.explainerStatus && report.explainerStatus !== "unavailable" && <AnalysisExplainer base={base} zh={zh} target={target} />}
          {teaching ? <AnalysisTeaching teaching={teaching} zh={zh} turnLabel={turnLabel} onSelectTurn={setSelected} />
          : report.teachingStatus === "pending" || report.teachingStatus === "running"
            ? <p className="text-sm text-ink-3">{zh ? "动作解释生成中，评分和动态对比已经可以查看。" : "The explanation is being written; scores and turn playback are already available."}</p>
          : <><p className="text-xs text-ink-3">{zh ? "二维数据观察 · 尚无已核实的标准参照，技术判断需教练核实" : "Image-plane observations · no verified standard comparison; technique judgments need coach review"}</p>
          {model ? <div className="space-y-3">
            {model.model_provenance?.model && <p className="break-all text-xs text-ink-3">{zh ? "协助选取观察的模型：" : "Model assisting evidence selection: "}{model.model_provenance.model}</p>}
            <p className="text-sm leading-relaxed">{zh ? model.summary_zh : model.summary_en}</p>
            {model.dimensions.map(d => <p key={d.dimension} className="text-sm text-ink-2">{zh ? d.explanation_zh : d.explanation_en}</p>)}
            {model.findings.map(f => <div key={f.finding_id} className="rounded-lg bg-surface p-3 text-sm"><p>{zh ? f.observation_zh : f.observation_en}</p>
              {(zh ? f.hypothesis_zh : f.hypothesis_en) && <p className="mt-1 text-ink-3">{zh ? "可能原因：" : "Possible cause: "}{zh ? f.hypothesis_zh : f.hypothesis_en}</p>}
              <button type="button" className="mt-2 text-accent underline" onClick={() => setSelected(f.turn_id)}>{zh ? "查看这个弯" : "View this turn"}</button></div>)}
            {model.exercises?.map(exercise => <div key={exercise.id} className="rounded-lg border border-border p-3 text-sm"><p className="font-semibold">{zh ? exercise.name_zh : exercise.name_en}</p><p className="mt-1 text-ink-2">{zh ? exercise.description_zh : exercise.description_en}</p></div>)}
            <ul className="space-y-1 text-xs text-ink-3">{model.limitations.map((l, i) => <li key={i}>{l}</li>)}</ul></div>
            : <p className="text-sm text-ink-3">{["pending", "running", "retry_wait"].includes(report.modelStatus)
              ? (zh ? "计算证据已保存，自动评价正在排队或生成；无需等待教练。" : "Evidence is saved; automated assessment is queued or generating. It does not wait for a coach.")
              : (zh ? "自动评价暂不可用，基础计算和可用动态片段仍可查看。" : "Automated assessment is unavailable; base calculations and available turns remain accessible.")}</p>}</>}
          {report.turns.length > 0 && <div className="flex flex-wrap gap-2">{report.turns.map(turn => <button type="button" key={turn.turnId}
            className={`rounded-full border px-3 py-1 text-sm ${selected === turn.turnId ? "border-accent bg-accent text-white" : "border-border"}`}
            onClick={() => setSelected(value => value === turn.turnId ? null : turn.turnId)}>{numberedTurn(turn.turnId, zh)}</button>)}</div>}
          {selected && report.turns.some(t => t.turnId === selected) && <>
            <TurnPlayer key={`${base}:${selected}`} base={base} turnId={selected} zh={zh}
              comparison={report.turns.find(turn => turn.turnId === selected)?.comparisonReference} />
            <AnalysisKeyframes key={`${base}:${selected}:keyframes`} base={base} turnId={selected} zh={zh} target={target} /></>}
        </>}
    </div>}
  <CoachingWorkspace base={base} zh={zh}/></div>;
}
