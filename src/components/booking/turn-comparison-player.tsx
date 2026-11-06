"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Bone, Pause, Play, Repeat, ScanSearch, StepBack, StepForward } from "lucide-react";
import { bodyHeight, decodeCompactPose, jointCenter, poseAt, poseFrameAt, referenceTimeAt, smoothPose, turnManifestSchema,
  type DecodedPose, type PoseSample, type TurnManifest } from "@/lib/freeski/report-v2";
import type { ReferenceStatus } from "@/lib/freeski/scorecard";
import { retryWhileStarting } from "@/lib/freeski/startup-retry";
import { metricInsight } from "@/lib/freeski/metric-insight";
import { bumpField, cameraAxes, decodeStandardMotion, fitView, motionMarks, motionPointsAt, phaseAt, skiLine, smoothedFootVectors, snowLevelAt, standardPoseForTurn, turnPoint, viewName,
  type FittedView, type StandardMotion, type StandardMotionId, type StandardPose, type TurnTiming } from "@/lib/freeski/standard-motion";
import { liftedAt, liftedMarks, liftUserPose, type LiftedPose } from "@/lib/freeski/skier-lift";
import { Link } from "@/i18n/navigation";
import { clientFetch } from "@/lib/client-fetch";
import { cn } from "@/lib/utils";
import { drawBones, drawSkierFigure, fineBonesUnit, STANDARD_BONES, STANDARD_STYLE, USER_BONES, USER_STYLE, type Figure, type FigureStyle, type Point } from "./skier-figure";
import type { Ribbon, Shot, SkierFigure, SkierStage } from "./skier-stage";

const USER_COLOR = "#ff9f1c";
const STANDARD_COLOR = "#2fd17a";
const FOCUS_COLOR = "#ffffff";
const SKI_COLOR = "rgba(255, 255, 255, 0.85)";
const STANDARD_SKI_COLOR = "rgba(47, 209, 122, 0.8)";
// A ski (1.70 m) against the shoulder-to-ankle height (about 1.15 m), the longest it can look.
const SKI_PER_HEIGHT = 1.5;
const SPEEDS = [0.25, 0.5, 1] as const;
const FRAME_STEP = 1 / 60;
// Lifting a filmed skier into 3D needs some standard to say which way each bone points, even when none is shown.
const FALLBACK_MOTION: StandardMotionId = "demonstration_parallel-l2";
const SCENE_FRAME_HEIGHT = 3.1;

/** What the score card says about this turn. */
export type TurnMeta = { number: number; direction: "left" | "right" | "unknown"; role: "start" | "middle" | "end";
  score: number | null; scored: boolean };

type Feet = { left: ([number, number] | null)[]; right: ([number, number] | null)[] };
type Loaded = {
  manifest: TurnManifest;
  user: DecodedPose; userHeight: number | null; userFeet: Feet;
  /** The generated standard motion behind `standard`, when there is one. */
  motion: StandardMotion | null;
  /** A standard already in the user's time base, direction, height and hips. */
  standard: DecodedPose | StandardPose | null;
  /** The student as a 3D skier, under the camera that filmed them. */
  lift: LiftedPose | null; liftMotion: StandardMotion | null; view: FittedView | null; timing: TurnTiming;
  /** A reviewed platform reference with its own timing, drawn on the stage only. */
  reviewed: DecodedPose | null; reviewedHeight: number | null;
};

async function json(url: string, signal?: AbortSignal) {
  // A turn opened after the idle FreeSki service stopped waits for it to start again, instead of losing the turn or its standard.
  const response = await retryWhileStarting(() => clientFetch(url, { cache: "no-store", signal }), { signal });
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

/** A filmed skier's skis, as long as a ski is and pointing the way the foot does. */
function userSkis(pose: DecodedPose, sample: PoseSample, feet: Feet, time: number, height: number | null) {
  const frame = poseFrameAt(pose, time), longest = (height ?? 200) * SKI_PER_HEIGHT;
  return { left: skiLine(pose, sample, "left", feet.left[frame], longest), right: skiLine(pose, sample, "right", feet.right[frame], longest) };
}

function drawSkiLines(context: CanvasRenderingContext2D, skis: ReturnType<typeof userSkis>, map: Mapper, color: string, width: number) {
  context.lineCap = "round";
  context.strokeStyle = color;
  context.lineWidth = width;
  for (const ski of [skis.left, skis.right]) {
    if (!ski) continue;
    const [x1, y1] = map(ski.tail), [x2, y2] = map(ski.tip);
    context.beginPath();
    context.moveTo(x1, y1);
    context.lineTo(x2, y2);
    context.stroke();
  }
}

const isGenerated = (pose: DecodedPose | StandardPose): pose is StandardPose => "nearLeft" in pose;

function jointReader(pose: DecodedPose, sample: PoseSample, map: Mapper) {
  return (name: string): Point | null => {
    const index = pose.jointNames.indexOf(name);
    return index >= 0 && sample.observed[index] ? map(sample.frame[index]) : null;
  };
}

/** A generated standard has ski corners and pole tips; everything else comes from the joints. */
function standardFigure(pose: StandardPose, sample: PoseSample, map: Mapper, time: number, unit: number): Figure {
  const at = jointReader(pose, sample, map), frame = poseFrameAt(pose, time);
  const corners = (side: string) => {
    const points = [`${side}_ski_tip_a`, `${side}_ski_tip_b`, `${side}_ski_tail_b`, `${side}_ski_tail_a`].map(at);
    return points.every(Boolean) ? points as Point[] : null;
  };
  return { at, unit, nearLeft: pose.nearLeft[frame], facing: pose.facing[frame], skis: { left: corners("left"), right: corners("right") },
    poles: { left: at("left_pole_tip"), right: at("right_pole_tip") } };
}

function userFigure(pose: DecodedPose, sample: PoseSample, map: Mapper, feet: Feet, time: number, height: number | null, unit: number, nearLeft: boolean): Figure {
  const at = jointReader(pose, sample, map), skis = userSkis(pose, sample, feet, time, height);
  const left = at("left_shoulder"), right = at("right_shoulder");
  const line = (ski: { tail: [number, number]; tip: [number, number] } | null) => ski ? [map(ski.tail), map(ski.tip)] as Point[] : null;
  return { at, unit, nearLeft, facing: Boolean(at("nose")) && Boolean(left && right && left[0] > right[0]),
    skis: { left: line(skis.left), right: line(skis.right) } };
}

/** The person, skis and poles, with the skeleton the analysis reads drawn on top. */
function drawSkier(context: CanvasRenderingContext2D, pose: DecodedPose, figure: Figure, style: FigureStyle) {
  drawSkierFigure(context, figure, style);
  const named = pose.jointNames.slice(0, 23).map(name => figure.at(name));
  drawBones(context, pose.connections.map(([a, b]) => [figure.at(pose.jointNames[a]), figure.at(pose.jointNames[b])] as const),
    named.filter((_, k) => k >= 5), style.bones, figure.unit);
}

type Scene3D = { stage: SkierStage; user: SkierFigure; standard: SkierFigure; toCanvas: typeof import("./skier-stage").shotToCanvas };

/** A pose's joints where a shot shows them, as a sample the skeleton drawing can read. The helmet hides the face's joints, and skis and poles are there to see. */
function shownSample(names: readonly string[], points: ArrayLike<number>, index: Readonly<Record<string, number>>, toCanvas: (x: number, y: number, z: number) => [number, number]): PoseSample {
  const frame: number[][] = [], observed: boolean[] = [];
  for (const [position, name] of names.entries()) {
    const k = index[name];
    if (k === undefined || position < 5 || position >= 23) { frame.push([0, 0, 0]); observed.push(false); continue; }
    const [x, y] = toCanvas(points[k * 3], points[k * 3 + 1], points[k * 3 + 2]);
    frame.push([x, y, 1]);
    observed.push(true);
  }
  return { frame, observed };
}

/** Fine lines over a 3D skier, enough to read the skeleton without hiding the person. */
function drawFigureBones(context: CanvasRenderingContext2D, pose: DecodedPose, sample: PoseSample, color: string, ratio: number) {
  const at = (k: number): Point | null => sample.observed[k] ? [sample.frame[k][0], sample.frame[k][1]] : null;
  drawBones(context, pose.connections.map(([a, b]) => [at(a), at(b)] as const), sample.frame.map((_, k) => at(k)), color, fineBonesUnit(context.canvas.height, ratio));
}

const hipsOf = (points: ArrayLike<number>, index: Readonly<Record<string, number>>) => {
  const a = index.left_hip * 3, b = index.right_hip * 3;
  return [(points[a] + points[b]) / 2, (points[a + 1] + points[b + 1]) / 2, (points[a + 2] + points[b + 2]) / 2];
};

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

/** Where object-contain puts a picture of this resolution in a box, in the box's pixels. */
function containBox(resolution: readonly [number, number] | null | undefined, width: number, height: number) {
  const [w, h] = resolution ?? [width, height];
  const scale = Math.min(width / w, height / h);
  return { left: (width - w * scale) / 2, top: (height - h * scale) / 2, width: w * scale, height: h * scale, scale };
}
type Picture = ReturnType<typeof containBox>;

/**
 * Pose pixels onto a canvas laid over an object-contain video of the same aspect ratio, through the
 * follow camera: the video is scaled by `camera.zoom` and shifted so (camera.x, camera.y), a point
 * in fractions of the picture, sits at the centre.
 */
function videoMapper(canvas: HTMLCanvasElement, pose: DecodedPose, camera: Camera): Mapper {
  const picture = containBox(pose.resolution, canvas.width, canvas.height);
  const { tx, ty } = cameraShift(camera, canvas.width, canvas.height, picture);
  return (point) => [tx + (picture.left + point[0] * picture.scale) * camera.zoom, ty + (picture.top + point[1] * picture.scale) * camera.zoom];
}

/**
 * Translation that puts the camera point at the centre, clamped to the picture rather than the video
 * element around it: a picture that covers the frame keeps covering it, and one narrower or shorter than
 * the frame (a phone held upright) stays wholly in view instead of sliding its black bars over the frame.
 */
function cameraShift(camera: Camera, width: number, height: number, picture: Picture) {
  const axis = (frame: number, offset: number, extent: number, at: number) => {
    const want = frame / 2 - (offset + at * extent) * camera.zoom;
    const near = -offset * camera.zoom, far = frame - (offset + extent) * camera.zoom;
    return extent * camera.zoom >= frame ? Math.min(near, Math.max(far, want)) : Math.max(near, Math.min(far, want));
  };
  return { tx: axis(width, picture.left, picture.width, camera.x), ty: axis(height, picture.top, picture.height, camera.y) };
}

/** Hips pinned at a place on the stage at a fixed body size, so only posture changes are visible. */
function stageMapper(canvas: HTMLCanvasElement, pose: DecodedPose, sample: PoseSample, height: number | null, slot: StageSlot): Mapper | null {
  const hip = jointCenter(pose, sample, "left_hip", "right_hip");
  if (!hip || !height) return null;
  const unit = canvas.height * slot.size / height, cx = canvas.width * slot.x, cy = canvas.height * 0.42;
  return (point) => [cx + (point[0] - hip[0]) * unit, cy + (point[1] - hip[1]) * unit];
}

type StageSlot = { x: number; size: number };
const OVERLAY_SLOT: StageSlot = { x: .5, size: .46 };
const SIDE_SLOTS: { user: StageSlot; standard: StageSlot } = { user: { x: .27, size: .4 }, standard: { x: .73, size: .4 } };

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

/**
 * One zoom for the whole turn, from the skier's median height as a share of the picture's, so the picture
 * never pumps. The share is kept to zoom an upright phone picture further, as long as the skier still fits.
 */
function followZoom(pose: DecodedPose, start: number, end: number): { zoomTarget: number; skier: number } {
  const heights = pose.times.flatMap((time, i) => {
    if (time < start || time > end) return [];
    const box = subjectBox({ frame: pose.frames[i], observed: pose.frames[i].map((p, k) => pose.observed[i][k] && p[2] >= .3) });
    return box ? [box.height / (pose.resolution?.[1] ?? 1)] : [];
  }).sort((a, b) => a - b);
  const median = heights.length ? heights[Math.floor(heights.length / 2)] : 0;
  return { zoomTarget: median > 0 ? Math.max(1, Math.min(3, 0.6 / median)) : 1, skier: median };
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
export function TurnComparisonPlayer({ base, turnId, zh, comparison, meta, focusMetric = null, motionId = null }: {
  base: string; turnId: string; zh: boolean; comparison?: ReferenceStatus; meta?: TurnMeta;
  /** The generated standard for the action and level this report compared with. */
  motionId?: StandardMotionId | null;
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
  const [layout, setLayout] = useState<"side" | "overlay">("side");
  const [bones, setBones] = useState(true);
  const [sceneMode, setSceneMode] = useState<"loading" | "scene" | "flat">("loading");
  const videoRef = useRef<HTMLVideoElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const fillRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLCanvasElement>(null);
  const stageBoxRef = useRef<HTMLDivElement>(null);
  const scene = useRef<Scene3D | null>(null);
  const sceneDrawn = useRef("");
  const headRef = useRef<HTMLDivElement>(null);
  const timeRef = useRef<HTMLSpanElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  // Media time at a wall-clock instant, advancing at `rate`: lets the stage move between video frames.
  const clock = useRef({ time: 0, wall: 0, rate: 0 });
  // The media time of the frame on screen, and the smoothed follow camera.
  const presented = useRef(0);
  const camera = useRef<Camera & { zoomTarget: number; skier: number; snap: boolean }>({ x: .5, y: .5, zoom: 1, zoomTarget: 1, skier: 0, snap: true });
  // The 3D stage needs this turn's poses in 3D. A standard FreeSki supplied as a skeleton only has no 3D to show, so that stays flat.
  const wantsScene = Boolean(data?.lift && (data.motion || (!data.standard && !data.reviewed)));
  const stageMode = wantsScene ? sceneMode : "flat";
  const settings = useRef({ loop, ghost, follow, focusMetric, layout, bones, stageMode });
  useEffect(() => { settings.current = { loop, ghost, follow, focusMetric, layout, bones, stageMode }; }, [loop, ghost, follow, focusMetric, layout, bones, stageMode]);
  const layer = useRef<HTMLCanvasElement | null>(null);
  const metaRole = meta?.role;

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      const manifest = turnManifestSchema.parse(await json(`${base}/turns/${turnId}`, controller.signal));
      const [user, rawMotion] = await Promise.all([
        json(`${base}/assets/user-pose?turn_id=${turnId}`, controller.signal),
        json(`/standard-motions/${motionId ?? FALLBACK_MOTION}.json`, controller.signal).catch(() => null),
      ]);
      if (controller.signal.aborted) return;
      const userPose = smoothPose(decodeCompactPose(user));
      const bounds = { start: manifest.startMs / 1000, end: manifest.endMs / 1000, apex: manifest.apexMs === undefined ? null : manifest.apexMs / 1000, role: manifest.role ?? metaRole };
      const motion = rawMotion ? decodeStandardMotion(rawMotion) : null;
      const view = motion ? fitView(motion, userPose, bounds) : null;
      // FreeSki's window may run from one turn's deepest lean to the next; the fit found where the student changed edges.
      const timing = view?.edge !== null && view?.edge !== undefined ? { ...bounds, edge: view.edge } : bounds;
      const generated = motionId && motion && view ? standardPoseForTurn(motion, userPose, timing, view) : null;
      const lift = motion && view ? liftUserPose(userPose, motion, view, timing) : null;
      // Without a generated standard, whatever FreeSki offers for this turn.
      const [standard, reviewed] = generated ? [null, null] : await Promise.all([
        manifest.standardPose ? json(`${base}/assets/standard-pose?turn_id=${turnId}`, controller.signal).catch(() => null) : null,
        !manifest.standardPose && manifest.referencePose
          ? json(`${base}/assets/reference-pose?turn_id=${turnId}`, controller.signal).catch(() => null) : null,
      ]);
      if (controller.signal.aborted) return;
      const reviewedPose = reviewed ? smoothPose(decodeCompactPose(reviewed)) : null;
      clock.current = { time: manifest.startMs / 1000, wall: performance.now(), rate: 0 };
      setData({ manifest, user: userPose, userHeight: bodyHeight(userPose), motion: generated ? motion : null, lift, liftMotion: motion, view, timing,
        userFeet: { left: smoothedFootVectors(userPose, "left"), right: smoothedFootVectors(userPose, "right") },
        standard: generated ?? (standard ? smoothPose(decodeCompactPose(standard)) : null),
        reviewed: reviewedPose, reviewedHeight: reviewedPose ? bodyHeight(reviewedPose) : null });
    })().catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [base, turnId, motionId, metaRole]);

  const start = data ? data.manifest.startMs / 1000 : 0, end = data ? data.manifest.endMs / 1000 : 0;
  const hasVideo = Boolean(data?.manifest.background) && !videoError;
  useEffect(() => {
    if (data) camera.current = { ...camera.current, ...followZoom(data.user, start, end), snap: true };
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
      const pose = data.standard, sample = poseAt(pose, time), map = videoMapper(canvas, pose, view);
      drawSkeleton(context, pose, sample, map, STANDARD_COLOR, 2.5 * ratio);
      if (isGenerated(pose)) {
        const at = jointReader(pose, sample, map);
        context.lineCap = "round";
        context.strokeStyle = STANDARD_SKI_COLOR;
        context.lineWidth = 2 * ratio;
        for (const side of ["left", "right"]) {
          const tip = at(`${side}_ski_tip_a`), tail = at(`${side}_ski_tail_a`);
          if (tip && tail) { context.beginPath(); context.moveTo(tail[0], tail[1]); context.lineTo(tip[0], tip[1]); context.stroke(); }
        }
      }
    }
    const sample = poseAt(data.user, time), map = videoMapper(canvas, data.user, view);
    const focus = settings.current.focusMetric ? metricInsight(settings.current.focusMetric) : null;
    if (focus?.hipPath) drawHipTrail(context, data.user, start, time, map, FOCUS_COLOR, 2 * ratio);
    drawSkeleton(context, data.user, sample, map, USER_COLOR, 3 * ratio);
    drawSkiLines(context, userSkis(data.user, sample, data.userFeet, time, data.userHeight), map, SKI_COLOR, 2 * ratio);
    if (focus?.lines.length) drawFocus(context, data.user, sample, map, focus.lines, FOCUS_COLOR, 5 * ratio);
  }, [data, start]);

  /** Both skiers in 3D on the snow, under the camera that filmed the student, hips pinned so only posture moves. */
  const drawScene = useCallback((time: number, canvas: HTMLCanvasElement, context: CanvasRenderingContext2D, ratio: number, world: Scene3D) => {
    const { lift, liftMotion, view, timing, motion } = data!;
    if (!lift || !liftMotion || !view) return;
    // Nothing moved, nothing to draw: a paused stage should not keep the graphics card busy.
    const key = `${time}|${settings.current.layout}|${settings.current.bones}|${settings.current.focusMetric}|${canvas.width}x${canvas.height}`;
    if (key === sceneDrawn.current) return;
    sceneDrawn.current = key;
    const axes = cameraAxes(view.camera);
    const student = liftedAt(lift, time);
    const userHips = hipsOf(student.points, lift.index);
    world.user.setPose(student.points, lift.index);
    const below = SCENE_FRAME_HEIGHT * .05;
    const aimAt = (hipZ: number): [number, number, number] => [-axes.up[0] * below, -axes.up[1] * below, hipZ - axes.up[2] * below];
    const base = { axes, slopeDeg: view.camera.slope, frameHeight: SCENE_FRAME_HEIGHT };
    const userRibbons: Ribbon[] = liftedMarks(lift, time, student.snowAt).map(points => ({ points, alpha: .75 }));
    let standardPoints: Float64Array | null = null, snowAt: [number, number] = [0, 0], standardRibbons: Ribbon[] = [];
    if (motion) {
      const at = turnPoint(phaseAt(time, timing, motion), view.mirrored);
      standardPoints = motionPointsAt(motion, at.phase, at.mirrored);
      const hips = hipsOf(standardPoints, motion.index);
      // Before the edge change the standard is still in the turn before, whose slope coordinates end where this turn's begin.
      const shift = at.mirrored === view.mirrored ? [0, 0] : (() => {
        const end = hipsOf(motionPointsAt(motion, 1, at.mirrored), motion.index), next = hipsOf(motionPointsAt(motion, 0, view.mirrored), motion.index);
        return [next[0] - end[0], next[1] - end[1]];
      })();
      snowAt = [hips[0] + shift[0], hips[1] + shift[1]];
      for (let k = 0; k < motion.pointCount; k++) { standardPoints[k * 3] -= hips[0]; standardPoints[k * 3 + 1] -= hips[1]; }
      standardRibbons = at.phase > 0 ? motionMarks(motion, at.phase, at.mirrored).map(mark => ({ points: mark.map(([x, y, half]) => [x - hips[0], y - hips[1], half]), alpha: .75 })) : [];
    }
    const together = settings.current.layout === "overlay" || !standardPoints;
    const shots: Shot[] = [];
    if (together) {
      if (standardPoints && motion) {
        // Hips on the student's hips.
        const lift = userHips[2] - hipsOf(standardPoints, motion.index)[2];
        for (let k = 0; k < motion.pointCount; k++) standardPoints[k * 3 + 2] += lift;
        world.standard.setPose(standardPoints, motion.index);
      }
      world.standard.setAlpha(.55);
      shots.push({ ...base, rect: { x: 0, y: 0, width: 1, height: 1 }, focus: aimAt(userHips[2]), snowAt: student.snowAt, figures: [world.user], ghost: standardPoints ? world.standard : null, ribbons: userRibbons });
    } else if (standardPoints && motion) {
      world.standard.setPose(standardPoints, motion.index);
      world.standard.setAlpha(1);
      const hipZ = hipsOf(standardPoints, motion.index)[2], bumps = bumpField(motion);
      shots.push({ ...base, rect: { x: 0, y: 0, width: .5, height: 1 }, focus: aimAt(userHips[2]), snowAt: student.snowAt, figures: [world.user], groomed: !bumps, bumps, ribbons: userRibbons });
      shots.push({ ...base, rect: { x: .5, y: 0, width: .5, height: 1 }, focus: aimAt(hipZ), snowAt, figures: [world.standard], groomed: !bumps, bumps,
        snowLevel: snowLevelAt(motion, turnPoint(phaseAt(time, timing, motion), view.mirrored).phase), ribbons: standardRibbons });
    }
    world.stage.render(shots);

    context.clearRect(0, 0, canvas.width, canvas.height);
    if (shots.length === 2) {
      context.fillStyle = "rgba(255, 255, 255, 0.9)";
      context.fillRect(canvas.width / 2 - ratio, 0, ratio * 2, canvas.height);
    }
    const focus = settings.current.focusMetric ? metricInsight(settings.current.focusMetric) : null;
    const identity: Mapper = point => [point[0], point[1]];
    const show = settings.current.bones;
    const userSample = shownSample(data!.user.jointNames, student.points, lift.index, world.toCanvas(shots[0], canvas.width, canvas.height));
    if (standardPoints && motion && data!.standard) {
      const sample = shownSample(data!.standard.jointNames, standardPoints, motion.index, world.toCanvas(shots[shots.length - 1], canvas.width, canvas.height));
      if (show) drawFigureBones(context, data!.standard, sample, STANDARD_BONES, ratio);
      if (focus?.lines.length) drawFocus(context, data!.standard, sample, identity, focus.lines, "rgba(120, 255, 170, 0.9)", 4 * ratio);
    }
    if (show) drawFigureBones(context, data!.user, userSample, USER_BONES, ratio);
    if (focus?.lines.length) drawFocus(context, data!.user, userSample, identity, focus.lines, FOCUS_COLOR, 4 * ratio);
  }, [data]);

  const drawStage = useCallback((time: number) => {
    const canvas = stageRef.current;
    if (!canvas || !data) return;
    const ratio = fitCanvas(canvas), context = canvas.getContext("2d");
    if (!context) return;
    if (scene.current?.stage.usable) { drawScene(time, canvas, context, ratio, scene.current); return; }
    context.clearRect(0, 0, canvas.width, canvas.height);
    // The 3D skiers are on their way: no flat ones in the meantime.
    if (settings.current.stageMode === "loading") return;
    context.strokeStyle = "rgba(255, 255, 255, 0.08)";
    context.lineWidth = ratio;
    context.beginPath();
    context.moveTo(canvas.width / 2, 0);
    context.lineTo(canvas.width / 2, canvas.height);
    context.stroke();
    const user = poseAt(data.user, time);
    const focus = settings.current.focusMetric ? metricInsight(settings.current.focusMetric) : null;
    const side = settings.current.layout === "side" && Boolean(data.standard || data.reviewed);
    const userSlot = side ? SIDE_SLOTS.user : OVERLAY_SLOT, standardSlot = side ? SIDE_SLOTS.standard : OVERLAY_SLOT;
    // Figures are composed on their own layer, so a see-through figure does not show its own overlaps.
    const paint = (alpha: number, draw: (target: CanvasRenderingContext2D) => void) => {
      if (alpha >= 1) { draw(context); return; }
      const sheet = layer.current ??= document.createElement("canvas");
      if (sheet.width !== canvas.width || sheet.height !== canvas.height) { sheet.width = canvas.width; sheet.height = canvas.height; }
      const target = sheet.getContext("2d");
      if (!target) return;
      target.clearRect(0, 0, sheet.width, sheet.height);
      draw(target);
      context.globalAlpha = alpha;
      context.drawImage(sheet, 0, 0);
      context.globalAlpha = 1;
    };
    let nearLeft = true;
    if (data.standard && isGenerated(data.standard)) nearLeft = data.standard.nearLeft[poseFrameAt(data.standard, time)];
    if (data.standard) {
      const pose = data.standard, sample = poseAt(pose, time), map = stageMapper(canvas, pose, sample, data.userHeight, standardSlot);
      if (map) {
        const unit = canvas.height * standardSlot.size;
        paint(side ? 1 : .62, target => {
          if (isGenerated(pose)) drawSkier(target, pose, standardFigure(pose, sample, map, time, unit), STANDARD_STYLE);
          else {
            drawSkeleton(target, pose, sample, map, STANDARD_COLOR, 4 * ratio);
            drawSkiLines(target, userSkis(pose, sample, { left: smoothedFootVectors(pose, "left"), right: smoothedFootVectors(pose, "right") }, time, data.userHeight), map, STANDARD_SKI_COLOR, 2 * ratio);
          }
        });
        if (focus?.lines.length) drawFocus(context, pose, sample, map, focus.lines, "rgba(120, 255, 170, 0.9)", 5 * ratio);
      }
    } else if (data.reviewed) {
      const { manifest, reviewed } = data;
      const fraction = Math.max(0, Math.min(1, (time - start) / Math.max(1e-6, end - start)));
      const referenceTime = manifest.alignment ? referenceTimeAt(manifest.alignment, time, true)
        : reviewed.times[0] + fraction * (reviewed.times.at(-1)! - reviewed.times[0]);
      const sample = poseAt(reviewed, referenceTime), map = stageMapper(canvas, reviewed, sample, data.reviewedHeight, standardSlot);
      if (map) drawSkeleton(context, reviewed, sample, map, STANDARD_COLOR, 4 * ratio);
    }
    const map = stageMapper(canvas, data.user, user, data.userHeight, userSlot);
    if (map) {
      const unit = canvas.height * userSlot.size;
      paint(side ? 1 : .92, target => drawSkier(target, data.user, userFigure(data.user, user, map, data.userFeet, time, data.userHeight, unit, nearLeft), USER_STYLE));
      if (focus?.lines.length) drawFocus(context, data.user, user, map, focus.lines, FOCUS_COLOR, 5 * ratio);
    }
  }, [data, start, end, drawScene]);

  // The 3D stage, once this turn's poses are in. Without WebGL or the mesh, the flat drawing.
  useEffect(() => {
    if (!wantsScene) return;
    let alive = true;
    void (async () => {
      const box = stageBoxRef.current;
      if (!box) return;
      const library = await import("./skier-stage");
      const stage = await library.SkierStage.create(box);
      if (!stage) { if (alive) setSceneMode("flat"); return; }
      if (!alive) { stage.dispose(); return; }
      scene.current = { stage, user: stage.figure(library.USER_LOOK, { poles: false }), standard: stage.figure(library.STANDARD_LOOK, { poles: true }), toCanvas: library.shotToCanvas };
      sceneDrawn.current = "";
      setSceneMode("scene");
    })().catch(() => { if (alive) setSceneMode("flat"); });
    return () => { alive = false; scene.current?.stage.dispose(); scene.current = null; };
  }, [wantsScene]);

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
    if (!element || !canvas || !data || !canvas.clientWidth || !canvas.clientHeight) return;
    const picture = containBox(data.user.resolution, canvas.clientWidth, canvas.clientHeight);
    // A picture narrower than the frame (a phone held upright) is zoomed until it fills the frame, as long as the skier still fits.
    const cover = Math.min(4, Math.max(canvas.clientWidth / picture.width, canvas.clientHeight / picture.height));
    const fits = view.skier > 0 ? .85 * canvas.clientHeight / (view.skier * picture.height) : 1;
    const zoom = settings.current.follow ? Math.max(view.zoomTarget, Math.min(cover, fits)) : 1;
    const box = subjectBox(poseAt(data.user, time));
    const [width, height] = data.user.resolution ?? [1, 1];
    const target = settings.current.follow && box ? { x: box.cx / width, y: box.cy / height } : { x: .5, y: .5 };
    const ease = view.snap ? 1 : 1 - Math.exp(-dt / 0.35);
    view.x += (target.x - view.x) * ease;
    view.y += (target.y - view.y) * ease;
    view.zoom += (zoom - view.zoom) * (view.snap ? 1 : 1 - Math.exp(-dt / 0.25));
    view.snap = false;
    const { tx, ty } = cameraShift(view, canvas.clientWidth, canvas.clientHeight, picture);
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
  useEffect(() => { drawOverlay(now()); drawStage(now()); }, [ghost, focusMetric, layout, bones, drawOverlay, drawStage, now]);

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
  // Where the student changed edges, when FreeSki's window does not start there (it can run lean to lean).
  const edge = data.timing.edge !== null && data.timing.edge !== undefined && data.timing.edge > start && data.timing.edge < end
    ? (data.timing.edge - start) / (end - start) : null;
  const generated = data.standard && isGenerated(data.standard) ? data.standard : null;
  const viewLabel = generated && { front: zh ? "正面" : "the front", rear: zh ? "背面" : "behind", side: zh ? "侧面" : "the side" }[viewName(generated.camera.azimuth)];
  const comparisonLabel = generated && data.motion
    ? (zh ? `绿色是按 CSIA 指南和示范数据生成的 ${data.motion.level} 级${data.motion.name.zh}（不是真人）。已按你这个弯的机位（看起来是从${viewLabel}拍的）、转弯方向、身高和进度对齐：标准用时约 ${data.motion.motion.durationSec.toFixed(2)} 秒，你用了 ${(end - start).toFixed(2)} 秒。`
      : `Green is a generated Level ${data.motion.level} ${data.motion.name.en.toLowerCase()} built from the CSIA guide and demonstration data, not a real skier. It is matched to this turn's camera (it looks filmed from ${viewLabel}), direction, height and progress: the standard takes about ${data.motion.motion.durationSec.toFixed(2)} s, you took ${(end - start).toFixed(2)} s.`)
    : data.standard
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

    <div className={cn("grid gap-3", hasVideo && "md:grid-cols-2")}>
      {hasVideo && <div ref={frameRef} className="relative aspect-video overflow-hidden rounded-xl bg-black">
        <video ref={videoRef} src={`${base}/assets/background?turn_id=${turnId}`} muted playsInline preload="auto"
          className="h-full w-full origin-top-left object-contain will-change-transform" onError={() => setVideoError(true)}
          onLoadedMetadata={() => { const element = videoRef.current; if (element) { element.currentTime = start; element.playbackRate = speed; } }}
          onLoadedData={() => { void videoRef.current?.play().catch(() => {}); }} />
        <canvas ref={overlayRef} className="pointer-events-none absolute inset-0 h-full w-full" />
        <span className="pointer-events-none absolute left-3 top-3 rounded-full bg-black/55 px-2.5 py-1 text-xs font-semibold text-white">{zh ? "你的滑行" : "Your run"}</span>
      </div>}
      <div ref={stageBoxRef} className={cn("relative aspect-video overflow-hidden rounded-xl", stageMode === "flat" ? "bg-[#0d1524]" : "bg-[#e6edf5]", stageMode === "loading" && "animate-pulse")}>
        <canvas ref={stageRef} className="absolute inset-0 h-full w-full" aria-label={zh ? "你与标准动作的人物、雪板和骨架对比" : "You against the standard: body, skis and skeleton"} />
        {focusMetric && metricInsight(focusMetric) && <span className="pointer-events-none absolute bottom-3 left-3 rounded-full bg-black/50 px-2.5 py-1 text-xs font-semibold text-white">
          {zh ? "白线：这项指标看的身体线" : "White: the body lines this metric measures"}</span>}
        <span className="pointer-events-none absolute left-3 top-3 flex items-center gap-1.5 rounded-full bg-black/40 px-2.5 py-1 text-xs font-semibold text-white"><span className="size-2 rounded-full" style={{ background: USER_COLOR }} />{zh ? "你" : "You"}</span>
        {(data.standard || data.reviewed) && <span className={cn("pointer-events-none absolute top-3 flex items-center gap-1.5 rounded-full bg-black/40 px-2.5 py-1 text-xs font-semibold text-white", layout === "side" ? "left-[calc(50%+0.75rem)]" : "left-16")}><span className="size-2 rounded-full" style={{ background: STANDARD_COLOR }} />{zh ? "标准动作" : "Standard"}</span>}
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
        {apex !== null && edge === null && <div className="absolute top-1/2 h-3 w-0.5 -translate-y-1/2 bg-ink-3" style={{ left: `${apex * 100}%` }} />}
        {edge !== null && <div className="absolute top-1/2 h-3 w-0.5 -translate-y-1/2 bg-ink-3" style={{ left: `${edge * 100}%` }} />}
        <div ref={headRef} className="absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface bg-accent shadow-[var(--shadow-sm)]" style={{ left: "0%" }} />
      </div>
      {edge !== null ? <div className="relative h-4 text-[11px] font-medium text-ink-3">
          <span className="absolute left-0">{zh ? "上一个弯" : "Previous turn"}</span>
          <span className="absolute -translate-x-1/2 whitespace-nowrap" style={{ left: `${Math.min(80, Math.max(20, edge * 100))}%` }}>{zh ? "换刃" : "Edge change"}</span>
          <span className="absolute right-0">{zh ? "这个弯" : "This turn"}</span>
        </div>
        : <div className="flex justify-between text-[11px] font-medium text-ink-3">
          <span>{zh ? "换刃（入弯）" : "Edge change in"}</span>
          {apex !== null && <span>{zh ? "弯顶" : "Apex"}</span>}
          <span>{zh ? "换刃（出弯）" : "Edge change out"}</span>
        </div>}
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
        <button type="button" aria-pressed={bones} onClick={() => setBones((value) => !value)}
          className={cn("press flex min-h-9 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold", bones ? "bg-accent-soft text-accent" : "text-ink-3 hover:bg-surface-2")}>
          <Bone className="size-3.5" aria-hidden />{zh ? "骨架" : "Skeleton"}
        </button>
        {(data.standard || data.reviewed) && <div role="group" aria-label={zh ? "对比方式" : "Comparison layout"} className="flex rounded-lg border border-border bg-surface-2 p-0.5">
          {([["side", zh ? "并排" : "Side by side"], ["overlay", zh ? "叠加" : "Overlay"]] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={layout === value} onClick={() => setLayout(value)}
            className={cn("min-h-8 rounded-md px-2.5 text-xs font-semibold", layout === value ? "bg-surface text-ink shadow-[var(--shadow-sm)]" : "text-ink-3 hover:text-ink")}>{label}</button>)}
        </div>}
        {data.standard && hasVideo && <label className="flex min-h-9 items-center gap-1.5 px-1 text-xs font-semibold text-ink-2">
          <input type="checkbox" checked={ghost} onChange={(event) => setGhost(event.target.checked)} />{zh ? "在视频上叠加标准骨架" : "Show the standard on the video"}
        </label>}
        <span ref={timeRef} className="ml-auto text-xs text-ink-3" data-numeric />
      </div>
    </div>

    <p className="text-xs leading-relaxed text-ink-3">{comparisonLabel} {data.lift && (zh ? "橙色人物按视频里的骨架还原：上下左右来自视频，前后深度和雪板是推算的。" : "The orange skier is rebuilt from the skeleton in your video: across and up come from the video, depth and skis are estimated.")} {zh ? "画面对比会受拍摄角度影响，不代表考官评分。" : "Camera angle affects this comparison, and it is not an examiner's assessment."}
      {generated && data.motion && <Link href={{ pathname: "/video-analysis/standards", query: { motion: data.motion.id } }} className="ml-1 font-semibold text-accent underline underline-offset-2">{zh ? "看这个动作的完整标准" : "See the full standard"}</Link>}</p>
  </div>;
}
