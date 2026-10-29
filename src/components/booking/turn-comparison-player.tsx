"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Pause, Play, Repeat, ScanSearch, StepBack, StepForward } from "lucide-react";
import { bodyHeight, decodeCompactPose, jointCenter, poseAt, referenceTimeAt, smoothPose, turnManifestSchema,
  type DecodedPose, type PoseSample, type TurnManifest } from "@/lib/freeski/report-v2";
import type { ReferenceStatus } from "@/lib/freeski/scorecard";
import { metricInsight } from "@/lib/freeski/metric-insight";
import { clientFetch } from "@/lib/client-fetch";
import { cn } from "@/lib/utils";

const USER_COLOR = "#ff9f1c";
const STANDARD_COLOR = "#2fd17a";
const FOCUS_COLOR = "#ffffff";
const SKI_COLOR = "rgba(255, 255, 255, 0.85)";
const SPEEDS = [0.25, 0.5, 1] as const;
const FRAME_STEP = 1 / 60;

/** What the score card says about this turn. */
export type TurnMeta = { number: number; direction: "left" | "right" | "unknown"; role: "start" | "middle" | "end";
  score: number | null; scored: boolean };

type Loaded = {
  manifest: TurnManifest;
  user: DecodedPose; userHeight: number | null;
  /** FreeSki's synthesized standard: already in the user's time base, direction, height and hips. */
  standard: DecodedPose | null;
  /** A reviewed platform reference with its own timing, drawn on the stage only. */
  reviewed: DecodedPose | null; reviewedHeight: number | null;
};

async function json(url: string, signal?: AbortSignal) {
  const response = await clientFetch(url, { cache: "no-store", signal });
  if (!response.ok) throw new Error("resource-unavailable");
  return response.json();
}

function fitCanvas(canvas: HTMLCanvasElement) {
  const ratio = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(canvas.clientWidth * ratio)), height = Math.max(1, Math.round(canvas.clientHeight * ratio));
  if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
  return ratio;
}

type Mapper = (point: number[]) => readonly [number, number];

function drawSkeleton(context: CanvasRenderingContext2D, pose: DecodedPose, sample: PoseSample, map: Mapper, color: string, width: number) {
  context.lineCap = "round";
  context.lineJoin = "round";
  // A soft dark outline keeps the lines readable over bright snow.
  for (const pass of [0, 1] as const) {
    context.strokeStyle = pass === 0 ? "rgba(0, 0, 0, 0.35)" : color;
    context.lineWidth = pass === 0 ? width * 1.9 : width;
    context.beginPath();
    for (const [a, b] of pose.connections) {
      if (!sample.observed[a] || !sample.observed[b]) continue;
      const [x1, y1] = map(sample.frame[a]), [x2, y2] = map(sample.frame[b]);
      context.moveTo(x1, y1);
      context.lineTo(x2, y2);
    }
    context.stroke();
  }
  context.fillStyle = color;
  sample.frame.forEach((point, k) => {
    if (!sample.observed[k]) return;
    const [x, y] = map(point);
    context.beginPath();
    context.arc(x, y, width * 0.8, 0, Math.PI * 2);
    context.fill();
  });
}

/** Thick, slightly extended lines along the body segments a metric is about. */
function drawFocus(context: CanvasRenderingContext2D, pose: DecodedPose, sample: PoseSample, map: Mapper, lines: [string, string][], color: string, width: number) {
  context.lineCap = "round";
  context.strokeStyle = color;
  context.lineWidth = width;
  context.setLineDash([]);
  for (const [a, b] of lines) {
    const i = pose.jointNames.indexOf(a), j = pose.jointNames.indexOf(b);
    if (i < 0 || j < 0 || !sample.observed[i] || !sample.observed[j]) continue;
    const [x1, y1] = map(sample.frame[i]), [x2, y2] = map(sample.frame[j]);
    const dx = x2 - x1, dy = y2 - y1;
    context.beginPath();
    context.moveTo(x1 - dx * 0.2, y1 - dy * 0.2);
    context.lineTo(x2 + dx * 0.2, y2 + dy * 0.2);
    context.stroke();
  }
}

/** Each ski as a line through heel and big toe, extended both ways, so parallel and edging read at a glance. */
function drawSkis(context: CanvasRenderingContext2D, pose: DecodedPose, sample: PoseSample, map: Mapper, color: string, width: number) {
  context.lineCap = "round";
  context.strokeStyle = color;
  context.lineWidth = width;
  for (const side of ["left", "right"]) {
    const heel = pose.jointNames.indexOf(`${side}_heel`), toe = pose.jointNames.indexOf(`${side}_bigtoe`);
    if (heel < 0 || toe < 0 || !sample.observed[heel] || !sample.observed[toe]) continue;
    const [hx, hy] = map(sample.frame[heel]), [tx, ty] = map(sample.frame[toe]);
    const dx = tx - hx, dy = ty - hy;
    if (Math.hypot(dx, dy) < width) continue;
    context.beginPath();
    context.moveTo(hx - dx * 1.2, hy - dy * 1.2);
    context.lineTo(tx + dx * 2.2, ty + dy * 2.2);
    context.stroke();
  }
}

/** The hips' path through the turn so far: what the tempo, rhythm and completion metrics look at. */
function drawHipTrail(context: CanvasRenderingContext2D, pose: DecodedPose, from: number, to: number, map: Mapper, color: string, width: number) {
  const points: [number, number][] = [];
  for (let t = from; t <= to; t += 1 / 30) {
    const hip = jointCenter(pose, poseAt(pose, t), "left_hip", "right_hip");
    if (hip) points.push(map(hip) as [number, number]);
  }
  if (points.length < 2) return;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.strokeStyle = color;
  context.lineWidth = width;
  context.setLineDash([width * 2, width * 2]);
  context.beginPath();
  points.forEach(([x, y], index) => index === 0 ? context.moveTo(x, y) : context.lineTo(x, y));
  context.stroke();
  context.setLineDash([]);
}

/**
 * Pose pixels onto a canvas laid over an object-contain video of the same aspect ratio, through the
 * follow camera: the video is scaled by `camera.zoom` and shifted so (camera.x, camera.y), a point
 * in unzoomed canvas fractions, sits at the centre.
 */
function videoMapper(canvas: HTMLCanvasElement, pose: DecodedPose, camera: Camera): Mapper {
  const [width, height] = pose.resolution ?? [canvas.width, canvas.height];
  const scale = Math.min(canvas.width / width, canvas.height / height);
  const left = (canvas.width - width * scale) / 2, top = (canvas.height - height * scale) / 2;
  const { tx, ty } = cameraShift(camera, canvas.width, canvas.height);
  return (point) => [tx + (left + point[0] * scale) * camera.zoom, ty + (top + point[1] * scale) * camera.zoom];
}

/** Translation that centres the camera point, clamped so the zoomed video always covers the frame. */
function cameraShift(camera: Camera, width: number, height: number) {
  const tx = Math.min(0, Math.max(width - width * camera.zoom, width / 2 - camera.x * width * camera.zoom));
  const ty = Math.min(0, Math.max(height - height * camera.zoom, height / 2 - camera.y * height * camera.zoom));
  return { tx, ty };
}

/** Hips pinned to the stage centre at a fixed body size, so only posture changes are visible. */
function stageMapper(canvas: HTMLCanvasElement, pose: DecodedPose, sample: PoseSample, height: number | null): Mapper | null {
  const hip = jointCenter(pose, sample, "left_hip", "right_hip");
  if (!hip || !height) return null;
  const unit = canvas.height * 0.5 / height, cx = canvas.width / 2, cy = canvas.height * 0.47;
  return (point) => [cx + (point[0] - hip[0]) * unit, cy + (point[1] - hip[1]) * unit];
}

/** Where the skier is in a pose sample: bounding-box centre and height, in pose pixels. */
function subjectBox(sample: PoseSample): { cx: number; cy: number; height: number } | null {
  let top = Infinity, bottom = -Infinity, left = Infinity, right = -Infinity;
  sample.frame.forEach((point, k) => {
    if (!sample.observed[k]) return;
    top = Math.min(top, point[1]); bottom = Math.max(bottom, point[1]);
    left = Math.min(left, point[0]); right = Math.max(right, point[0]);
  });
  return Number.isFinite(top) && bottom > top ? { cx: (left + right) / 2, cy: (top + bottom) / 2, height: bottom - top } : null;
}

/** One zoom for the whole turn, from the skier's median height, so the picture never pumps. */
function followZoom(pose: DecodedPose, start: number, end: number): number {
  const heights = pose.times.flatMap((time, i) => {
    if (time < start || time > end) return [];
    const box = subjectBox({ frame: pose.frames[i], observed: pose.frames[i].map((p, k) => pose.observed[i][k] && p[2] >= .3) });
    return box ? [box.height / (pose.resolution?.[1] ?? 1)] : [];
  }).sort((a, b) => a - b);
  const median = heights.length ? heights[Math.floor(heights.length / 2)] : 0;
  return median > 0 ? Math.max(1, Math.min(3, 0.6 / median)) : 1;
}

type Camera = { x: number; y: number; zoom: number };

function targetName(target: string, zh: boolean) {
  const level = /^level([1-4])$/.exec(target)?.[1];
  if (level) return zh ? `CSIA ${level} 级通过示范` : `CSIA Level ${level} pass examples`;
  if (target === "expert") return zh ? "专家示范" : "expert examples";
  if (target === "advanced") return zh ? "进阶示范" : "advanced examples";
  return zh ? "CSIA 示范" : "CSIA examples";
}

/**
 * One judged turn, edge change to edge change. Left: the clip with the skier's skeleton locked to
 * each presented video frame. Right: the skier (orange) against the standard skeleton (green) with
 * hips pinned, animated every display frame. Skeletons are interpolated between pose samples and
 * lightly smoothed, so they move as smoothly as the screen allows.
 */
export function TurnComparisonPlayer({ base, turnId, zh, comparison, meta, focusMetric = null }: {
  base: string; turnId: string; zh: boolean; comparison?: ReferenceStatus; meta?: TurnMeta;
  /** A scorecard metric whose body lines (or hip path) are highlighted on the skeletons. */
  focusMetric?: string | null;
}) {
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState(false);
  const [videoError, setVideoError] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(0.5);
  const [loop, setLoop] = useState(true);
  const [ghost, setGhost] = useState(false);
  const [follow, setFollow] = useState(true);
  const videoRef = useRef<HTMLVideoElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const fillRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLCanvasElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const timeRef = useRef<HTMLSpanElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  // Media time at a wall-clock instant, advancing at `rate`: lets the stage move between video frames.
  const clock = useRef({ time: 0, wall: 0, rate: 0 });
  // The media time of the frame on screen, and the smoothed follow camera.
  const presented = useRef(0);
  const camera = useRef<Camera & { zoomTarget: number; snap: boolean }>({ x: .5, y: .5, zoom: 1, zoomTarget: 1, snap: true });
  const settings = useRef({ loop, ghost, follow, focusMetric });
  useEffect(() => { settings.current = { loop, ghost, follow, focusMetric }; }, [loop, ghost, follow, focusMetric]);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      const manifest = turnManifestSchema.parse(await json(`${base}/turns/${turnId}`, controller.signal));
      const [user, standard, reviewed] = await Promise.all([
        json(`${base}/assets/user-pose?turn_id=${turnId}`, controller.signal),
        manifest.standardPose ? json(`${base}/assets/standard-pose?turn_id=${turnId}`, controller.signal).catch(() => null) : null,
        !manifest.standardPose && manifest.referencePose
          ? json(`${base}/assets/reference-pose?turn_id=${turnId}`, controller.signal).catch(() => null) : null,
      ]);
      if (controller.signal.aborted) return;
      const userPose = smoothPose(decodeCompactPose(user));
      const reviewedPose = reviewed ? smoothPose(decodeCompactPose(reviewed)) : null;
      clock.current = { time: manifest.startMs / 1000, wall: performance.now(), rate: 0 };
      setData({ manifest, user: userPose, userHeight: bodyHeight(userPose),
        standard: standard ? smoothPose(decodeCompactPose(standard)) : null,
        reviewed: reviewedPose, reviewedHeight: reviewedPose ? bodyHeight(reviewedPose) : null });
    })().catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [base, turnId]);

  const start = data ? data.manifest.startMs / 1000 : 0, end = data ? data.manifest.endMs / 1000 : 0;
  const hasVideo = Boolean(data?.manifest.background) && !videoError;
  useEffect(() => {
    if (data) camera.current = { ...camera.current, zoomTarget: followZoom(data.user, start, end), snap: true };
  }, [data, start, end]);

  const now = useCallback((wall = performance.now()) => {
    const c = clock.current;
    return c.rate ? Math.min(end, c.time + (wall - c.wall) / 1000 * c.rate) : c.time;
  }, [end]);

  const drawOverlay = useCallback((time: number) => {
    const canvas = overlayRef.current;
    if (!canvas || !data) return;
    const ratio = fitCanvas(canvas), context = canvas.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    const view = camera.current;
    if (settings.current.ghost && data.standard) {
      drawSkeleton(context, data.standard, poseAt(data.standard, time), videoMapper(canvas, data.standard, view), STANDARD_COLOR, 2.5 * ratio);
    }
    const sample = poseAt(data.user, time), map = videoMapper(canvas, data.user, view);
    const focus = settings.current.focusMetric ? metricInsight(settings.current.focusMetric) : null;
    if (focus?.hipPath) drawHipTrail(context, data.user, start, time, map, FOCUS_COLOR, 2 * ratio);
    drawSkeleton(context, data.user, sample, map, USER_COLOR, 3 * ratio);
    drawSkis(context, data.user, sample, map, SKI_COLOR, 2 * ratio);
    if (focus?.lines.length) drawFocus(context, data.user, sample, map, focus.lines, FOCUS_COLOR, 5 * ratio);
  }, [data, start]);

  const drawStage = useCallback((time: number) => {
    const canvas = stageRef.current;
    if (!canvas || !data) return;
    const ratio = fitCanvas(canvas), context = canvas.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = "rgba(255, 255, 255, 0.08)";
    context.lineWidth = ratio;
    context.beginPath();
    context.moveTo(canvas.width / 2, 0);
    context.lineTo(canvas.width / 2, canvas.height);
    context.stroke();
    const user = poseAt(data.user, time);
    const focus = settings.current.focusMetric ? metricInsight(settings.current.focusMetric) : null;
    if (data.standard) {
      const sample = poseAt(data.standard, time), map = stageMapper(canvas, data.standard, sample, data.userHeight);
      if (map) {
        drawSkeleton(context, data.standard, sample, map, STANDARD_COLOR, 4 * ratio);
        drawSkis(context, data.standard, sample, map, "rgba(47, 209, 122, 0.7)", 2 * ratio);
        if (focus?.lines.length) drawFocus(context, data.standard, sample, map, focus.lines, "rgba(120, 255, 170, 0.9)", 6 * ratio);
      }
    } else if (data.reviewed) {
      const { manifest, reviewed } = data;
      const fraction = Math.max(0, Math.min(1, (time - start) / Math.max(1e-6, end - start)));
      const referenceTime = manifest.alignment ? referenceTimeAt(manifest.alignment, time, true)
        : reviewed.times[0] + fraction * (reviewed.times.at(-1)! - reviewed.times[0]);
      const sample = poseAt(reviewed, referenceTime), map = stageMapper(canvas, reviewed, sample, data.reviewedHeight);
      if (map) drawSkeleton(context, reviewed, sample, map, STANDARD_COLOR, 4 * ratio);
    }
    const map = stageMapper(canvas, data.user, user, data.userHeight);
    if (map) {
      drawSkeleton(context, data.user, user, map, USER_COLOR, 3.5 * ratio);
      drawSkis(context, data.user, user, map, SKI_COLOR, 2 * ratio);
      if (focus?.lines.length) drawFocus(context, data.user, user, map, focus.lines, FOCUS_COLOR, 6 * ratio);
    }
  }, [data, start, end]);

  const showProgress = useCallback((time: number) => {
    const fraction = Math.max(0, Math.min(1, (time - start) / Math.max(1e-6, end - start)));
    if (headRef.current) headRef.current.style.left = `${fraction * 100}%`;
    if (fillRef.current) fillRef.current.style.width = `${fraction * 100}%`;
    if (timeRef.current) timeRef.current.textContent = `${Math.max(0, time - start).toFixed(2)} / ${(end - start).toFixed(2)} s`;
    trackRef.current?.setAttribute("aria-valuenow", (Math.max(0, time - start)).toFixed(2));
  }, [start, end]);

  const seek = useCallback((time: number) => {
    const target = Math.max(start, Math.min(end, time));
    clock.current = { ...clock.current, time: target, wall: performance.now() };
    presented.current = target;
    camera.current.snap = true;
    if (videoRef.current && hasVideo) videoRef.current.currentTime = target;
    drawOverlay(target);
    drawStage(target);
    showProgress(target);
  }, [start, end, hasVideo, drawOverlay, drawStage, showProgress]);

  // Follow camera: centres the skier's (smoothed) box at one zoom for the turn; eases instead of jumping.
  const moveCamera = useCallback((time: number, dt: number) => {
    const element = videoRef.current, canvas = overlayRef.current, view = camera.current;
    if (!element || !canvas || !data) return;
    const zoom = settings.current.follow ? view.zoomTarget : 1;
    const box = subjectBox(poseAt(data.user, time));
    const [width, height] = data.user.resolution ?? [1, 1];
    const target = settings.current.follow && box ? { x: box.cx / width, y: box.cy / height } : { x: .5, y: .5 };
    const ease = view.snap ? 1 : 1 - Math.exp(-dt / 0.35);
    view.x += (target.x - view.x) * ease;
    view.y += (target.y - view.y) * ease;
    view.zoom += (zoom - view.zoom) * (view.snap ? 1 : 1 - Math.exp(-dt / 0.25));
    view.snap = false;
    const { tx, ty } = cameraShift(view, canvas.clientWidth, canvas.clientHeight);
    element.style.transform = `translate(${tx}px, ${ty}px) scale(${view.zoom})`;
  }, [data]);

  // Display loop: the stage and progress move every screen refresh; without a video it also keeps time.
  useEffect(() => {
    if (!data) return;
    let frame = 0, last = performance.now();
    const tick = (wall: number) => {
      const c = clock.current;
      if (!hasVideo && c.rate) {
        c.time += (wall - last) / 1000 * c.rate;
        c.wall = wall;
        if (c.time >= end) {
          if (settings.current.loop) c.time = start;
          else { c.time = end; c.rate = 0; setPlaying(false); }
        }
      }
      const dt = Math.min(.1, (wall - last) / 1000);
      last = wall;
      const time = now(wall);
      drawStage(time);
      showProgress(time);
      if (hasVideo) {
        moveCamera(presented.current, dt);
        drawOverlay(presented.current);
      } else drawOverlay(time);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [data, hasVideo, start, end, now, drawStage, drawOverlay, showProgress, moveCamera]);

  // Video clock: the overlay is redrawn for each presented frame at that frame's own media time.
  useEffect(() => {
    const element = videoRef.current;
    if (!element || !data || !hasVideo) return;
    let handle = 0, disposed = false;
    const sync = () => { clock.current = { time: element.currentTime, wall: performance.now(), rate: element.paused ? 0 : element.playbackRate }; };
    const onFrame = (wall: number, metadata?: { mediaTime: number }) => {
      if (disposed) return;
      const media = metadata?.mediaTime ?? element.currentTime;
      clock.current = { time: media, wall, rate: element.paused ? 0 : element.playbackRate };
      presented.current = media;
      if (!element.paused && media >= end - 1 / 120) {
        if (settings.current.loop) element.currentTime = start;
        else element.pause();
      }
      handle = element.requestVideoFrameCallback
        ? element.requestVideoFrameCallback(onFrame)
        : window.requestAnimationFrame((next) => onFrame(next));
    };
    const onSeeked = () => { sync(); presented.current = element.currentTime; };
    const onPlay = () => { if (element.currentTime >= end - 1 / 120 || element.currentTime < start - 0.05) element.currentTime = start; sync(); setPlaying(true); };
    const onPause = () => { sync(); presented.current = element.currentTime; setPlaying(false); };
    const onTime = () => {
      if (element.currentTime < start - 0.05) element.currentTime = start;
      else if (element.currentTime > end + 0.05) { if (settings.current.loop && !element.paused) element.currentTime = start; else { element.pause(); element.currentTime = end; } }
    };
    const onResize = () => { camera.current.snap = true; };
    element.addEventListener("seeked", onSeeked);
    element.addEventListener("play", onPlay);
    element.addEventListener("pause", onPause);
    element.addEventListener("ratechange", sync);
    element.addEventListener("timeupdate", onTime);
    window.addEventListener("resize", onResize);
    onFrame(performance.now());
    return () => {
      disposed = true;
      if (element.cancelVideoFrameCallback) element.cancelVideoFrameCallback(handle); else window.cancelAnimationFrame(handle);
      element.removeEventListener("seeked", onSeeked);
      element.removeEventListener("play", onPlay);
      element.removeEventListener("pause", onPause);
      element.removeEventListener("ratechange", sync);
      element.removeEventListener("timeupdate", onTime);
      window.removeEventListener("resize", onResize);
    };
  }, [data, hasVideo, start, end, now, drawOverlay]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = speed;
    if (!hasVideo && clock.current.rate) clock.current.rate = speed;
  }, [speed, hasVideo, data]);
  useEffect(() => { drawOverlay(now()); drawStage(now()); }, [ghost, focusMetric, drawOverlay, drawStage, now]);

  function toggle() {
    const element = videoRef.current;
    if (hasVideo && element) {
      if (element.paused) void element.play().catch(() => {}); else element.pause();
      return;
    }
    const c = clock.current;
    if (c.rate) { c.time = now(); c.rate = 0; setPlaying(false); }
    else { if (c.time >= end) c.time = start; c.wall = performance.now(); c.rate = speed; setPlaying(true); }
  }

  function step(direction: -1 | 1) {
    const element = videoRef.current;
    if (hasVideo && element && !element.paused) element.pause();
    if (!hasVideo) { clock.current.rate = 0; setPlaying(false); }
    seek(now() + direction * FRAME_STEP);
  }

  function scrub(event: React.PointerEvent<HTMLDivElement>) {
    const track = trackRef.current;
    if (!track) return;
    const box = track.getBoundingClientRect();
    seek(start + Math.max(0, Math.min(1, (event.clientX - box.left) / box.width)) * (end - start));
  }

  if (error) return <p role="status" className="text-sm text-ink-3">{zh ? "这个弯的动态资源暂不可用，评分和文字解释仍可查看。" : "This turn's playback is unavailable. Scores and notes remain available."}</p>;
  if (!data) return <div className="aspect-video w-full animate-pulse rounded-xl bg-surface-2" aria-label={zh ? "正在加载这个弯" : "Loading this turn"} />;

  const { manifest } = data;
  const direction = manifest.direction ?? (meta?.direction !== "unknown" ? meta?.direction : undefined);
  const role = manifest.role ?? meta?.role;
  const apex = manifest.apexMs !== undefined && manifest.apexMs > manifest.startMs && manifest.apexMs < manifest.endMs
    ? (manifest.apexMs - manifest.startMs) / (manifest.endMs - manifest.startMs) : null;
  const comparisonLabel = data.standard
    ? manifest.standard
      ? (zh ? `绿色是按${targetName(manifest.standard.target, true)}生成的标准动作：和你同一转弯方向、同身高，按这个弯的进度对齐${manifest.standard.mirrored ? "（由反方向的示范镜像而来）" : ""}。`
        : `Green is a standard movement generated from ${targetName(manifest.standard.target, false)}: same turn direction and height as you, timed to this turn${manifest.standard.mirrored ? " (mirrored from examples turning the other way)" : ""}.`)
      : (zh ? "绿色是 FreeSki 生成的标准动作：和你同一转弯方向、同身高，按这个弯的进度对齐。" : "Green is FreeSki's generated standard movement: same turn direction and height as you, timed to this turn.")
    : data.reviewed ? (zh ? "绿色是平台审核过的示范，按这个弯的进度对齐。" : "Green is a reviewed platform example, timed to this turn.")
    : comparison === "not_available" ? (zh ? "这个弯没有匹配的标准动作，只显示你自己的动态。" : "This turn has no matching standard; only your own movement is shown.")
    : (zh ? "这个弯暂时没有可对比的标准动作骨架，先看你自己的动态。" : "No standard skeleton is available for this turn yet; your own movement is shown.");

  return <div className="space-y-3">
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      <span className="font-semibold">{zh ? `第 ${meta?.number ?? Number(turnId.slice(5)) + 1} 弯` : `Turn ${meta?.number ?? Number(turnId.slice(5)) + 1}`}</span>
      {direction && <span className="text-ink-2">{direction === "left" ? (zh ? "左转" : "Left turn") : (zh ? "右转" : "Right turn")}</span>}
      <span className="text-ink-3" data-numeric>{zh ? `用时 ${(end - start).toFixed(2)} 秒` : `${(end - start).toFixed(2)} s`}</span>
      {meta?.score !== null && meta?.score !== undefined && meta.scored && <span className="text-ink-3" data-numeric>{zh ? `这个弯 ${Math.round(meta.score)} 分` : `Turn score ${Math.round(meta.score)}`}</span>}
      {role && role !== "middle" && <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-semibold text-ink-2">{role === "start" ? (zh ? "起步弯" : "Start turn") : (zh ? "收尾弯" : "End turn")}</span>}
      {meta && !meta.scored && <span className="rounded-full bg-amber-bg px-2 py-0.5 text-xs font-semibold text-amber">{zh ? "不计分" : "Not scored"}</span>}
    </div>

    <div className={cn("grid gap-3", hasVideo && "md:grid-cols-[3fr_2fr]")}>
      {hasVideo && <div ref={frameRef} className="relative aspect-video overflow-hidden rounded-xl bg-black">
        <video ref={videoRef} src={`${base}/assets/background?turn_id=${turnId}`} muted playsInline preload="auto"
          className="h-full w-full origin-top-left object-contain will-change-transform" onError={() => setVideoError(true)}
          onLoadedMetadata={() => { const element = videoRef.current; if (element) { element.currentTime = start; element.playbackRate = speed; } }}
          onLoadedData={() => { void videoRef.current?.play().catch(() => {}); }} />
        <canvas ref={overlayRef} className="pointer-events-none absolute inset-0 h-full w-full" />
        <span className="pointer-events-none absolute left-3 top-3 rounded-full bg-black/55 px-2.5 py-1 text-xs font-semibold text-white">{zh ? "你的滑行" : "Your run"}</span>
      </div>}
      <div className="relative aspect-video overflow-hidden rounded-xl bg-[#0d1524]">
        <canvas ref={stageRef} className="absolute inset-0 h-full w-full" aria-label={zh ? "你与标准动作的骨架对比" : "Your skeleton against the standard"} />
        {focusMetric && metricInsight(focusMetric) && <span className="pointer-events-none absolute bottom-3 left-3 rounded-full bg-white/15 px-2.5 py-1 text-xs font-semibold text-white">
          {zh ? "白线：这项指标看的身体线" : "White: the body lines this metric measures"}</span>}
        <div className="pointer-events-none absolute left-3 top-3 flex gap-2 text-xs font-semibold text-white">
          <span className="flex items-center gap-1.5 rounded-full bg-black/40 px-2.5 py-1"><span className="size-2 rounded-full" style={{ background: USER_COLOR }} />{zh ? "你" : "You"}</span>
          {(data.standard || data.reviewed) && <span className="flex items-center gap-1.5 rounded-full bg-black/40 px-2.5 py-1"><span className="size-2 rounded-full" style={{ background: STANDARD_COLOR }} />{zh ? "标准动作" : "Standard"}</span>}
        </div>
      </div>
    </div>

    <div className="space-y-2">
      <div ref={trackRef} role="slider" tabIndex={0} aria-label={zh ? "这个弯的播放位置" : "Position in this turn"}
        aria-valuemin={0} aria-valuemax={Math.round((end - start) * 100) / 100} aria-valuenow={0}
        className="relative h-8 cursor-pointer touch-none select-none"
        onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); if (hasVideo) videoRef.current?.pause(); else { clock.current.rate = 0; setPlaying(false); } scrub(event); }}
        onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) scrub(event); }}
        onKeyDown={(event) => { if (event.key === "ArrowLeft") { event.preventDefault(); step(-1); } if (event.key === "ArrowRight") { event.preventDefault(); step(1); } }}>
        <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-border-strong/70" />
        <div ref={fillRef} className="absolute left-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-accent" style={{ width: "0%" }} />
        {apex !== null && <div className="absolute top-1/2 h-3 w-0.5 -translate-y-1/2 bg-ink-3" style={{ left: `${apex * 100}%` }} />}
        <div ref={headRef} className="absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface bg-accent shadow-[var(--shadow-sm)]" style={{ left: "0%" }} />
      </div>
      <div className="flex justify-between text-[11px] font-medium text-ink-3">
        <span>{zh ? "换刃（入弯）" : "Edge change in"}</span>
        {apex !== null && <span>{zh ? "弯顶" : "Apex"}</span>}
        <span>{zh ? "换刃（出弯）" : "Edge change out"}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={toggle} aria-label={playing ? (zh ? "暂停" : "Pause") : (zh ? "播放" : "Play")}
          className="press flex size-10 items-center justify-center rounded-full bg-accent text-accent-foreground">
          {playing ? <Pause className="size-4" aria-hidden /> : <Play className="size-4 translate-x-px" aria-hidden />}
        </button>
        <button type="button" onClick={() => step(-1)} aria-label={zh ? "后退一帧" : "Back one frame"} className="press flex size-9 items-center justify-center rounded-lg text-ink-2 hover:bg-surface-2"><StepBack className="size-4" aria-hidden /></button>
        <button type="button" onClick={() => step(1)} aria-label={zh ? "前进一帧" : "Forward one frame"} className="press flex size-9 items-center justify-center rounded-lg text-ink-2 hover:bg-surface-2"><StepForward className="size-4" aria-hidden /></button>
        <div role="group" aria-label={zh ? "播放速度" : "Playback speed"} className="flex rounded-lg border border-border bg-surface-2 p-0.5">
          {SPEEDS.map((value) => <button key={value} type="button" aria-pressed={speed === value} onClick={() => setSpeed(value)}
            className={cn("min-h-8 rounded-md px-2.5 text-xs font-semibold", speed === value ? "bg-surface text-ink shadow-[var(--shadow-sm)]" : "text-ink-3 hover:text-ink")}>{value}×</button>)}
        </div>
        <button type="button" aria-pressed={loop} onClick={() => setLoop((value) => !value)}
          className={cn("press flex min-h-9 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold", loop ? "bg-accent-soft text-accent" : "text-ink-3 hover:bg-surface-2")}>
          <Repeat className="size-3.5" aria-hidden />{zh ? "循环" : "Loop"}
        </button>
        {hasVideo && <button type="button" aria-pressed={follow} onClick={() => { setFollow((value) => !value); }}
          className={cn("press flex min-h-9 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold", follow ? "bg-accent-soft text-accent" : "text-ink-3 hover:bg-surface-2")}>
          <ScanSearch className="size-3.5" aria-hidden />{zh ? "跟随放大" : "Follow & zoom"}
        </button>}
        {data.standard && hasVideo && <label className="flex min-h-9 items-center gap-1.5 px-1 text-xs font-semibold text-ink-2">
          <input type="checkbox" checked={ghost} onChange={(event) => setGhost(event.target.checked)} />{zh ? "在视频上叠加标准骨架" : "Show the standard on the video"}
        </label>}
        <span ref={timeRef} className="ml-auto text-xs text-ink-3" data-numeric />
      </div>
    </div>

    <p className="text-xs leading-relaxed text-ink-3">{comparisonLabel} {zh ? "二维画面对比，会受拍摄角度影响，不代表考官评分。" : "A 2D image comparison: camera angle affects it, and it is not an examiner's assessment."}</p>
  </div>;
}
