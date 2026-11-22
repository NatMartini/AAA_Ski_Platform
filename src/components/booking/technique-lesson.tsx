"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Bone, Move3d, Pause, Play, RotateCcw } from "lucide-react";
import { skiMark } from "@/lib/freeski/skier-rig";
import { bumpField, cameraAxes, motionBones, snowLevelAt, turnAdvance, turnOrigin, type CameraAxes, type StandardMotion } from "@/lib/freeski/standard-motion";
import { forces3D, G, headings, rotationAt, variantPointsAt, type FaultVariant, type Vec } from "@/lib/freeski/technique-forces";
import type { Fault } from "@/lib/freeski/technique-faults";
import { LESSON_STEPS, LESSONS, STEP_NAMES, type Lesson, type LessonStep, type LessonView } from "@/lib/freeski/technique-lessons";
import { linkedPath, pathAt, pathForces, pathMarks, pathPose, type LinkedPath } from "@/lib/freeski/technique-paths";
import { cn } from "@/lib/utils";
import { drawBones, fineBonesUnit, STANDARD_BONES, USER_BONES, type Point } from "./skier-figure";
import type { Ribbon, Shot, SkierFigure, SkierStage } from "./skier-stage";
import type { PathLine, StageOverlay } from "./stage-overlays";
import { useOrbit } from "./use-orbit";

/**
 * A problem explained in 3D: the generated standard (green) and the same skier with the fault (orange), with the forces
 * on them drawn as arrows whose size is the force. Four steps, as a coach would take them — what it looks like, why,
 * what to do, side by side — played one after another or picked by hand; the viewer can turn the camera at any time.
 */

const FAULT_COLOR = "#e9791a", STANDARD_COLOR = "#1a9c64", PUSH = "#2f6ad0", WARN = "#d63b3b", GRAVITY = "#525866", CENTRE = "#151a23", SKIS_TURN = "#2f6ad0", CHEST_TURN = "#8b5cf6";
/** The height of the picture around one skier, metres. */
const FRAME = 3.1;
/** Metres of arrow per m/s² of force per kilogram. */
const FORCE = .09;
const SPEEDS = [1, .5, .25] as const;
const TRACK_TURNS = 4;
const MARK_STEPS = 48;
const DEG = Math.PI / 180;
const PRESETS = [
  { key: "front", zh: "正面", en: "Front", azimuth: 180, elevation: 9 },
  { key: "rear", zh: "背面", en: "Behind", azimuth: 0, elevation: 9 },
  { key: "side", zh: "侧面", en: "Side", azimuth: 90, elevation: 8 },
  { key: "above", zh: "高处", en: "Above", azimuth: 15, elevation: 60 },
] as const;

type Role = "fault" | "correct";
type Tone = "dark" | "warn" | "good" | "push";
type Label = { at: Vec; text: string; tone: Tone };
type Bar = { low: Vec; high: Vec; now: Vec; color: string; text: string };
type Built = {
  points: Float64Array; snowAt: [number, number]; hipZ: number; snowLevel: number; bumps: ReturnType<typeof bumpField>;
  ribbons: Ribbon[]; overlays: StageOverlay[]; labels: Label[]; bars: Bar[]; paths?: PathLine[]; piste?: { centre: number; halfWidth: number } | null;
  caption: string;
};

type Corners = { tips: [number, number][]; tails: [number, number][] };
type PoseData = { kind: "pose"; advance: { across: number; down: number }; turns: Map<string, Record<"left" | "right", Corners>>; hips: Map<FaultVariant, { low: number; high: number }> };
type PathData = { kind: "path"; paths: Record<Role, LinkedPath>; marks: Record<Role, [number, number, number][][]>; pisteHalf: number; centres: Record<Role, number>; frame: number };

const add = (a: Vec, b: Vec): Vec => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec, s: number): Vec => [a[0] * s, a[1] * s, a[2] * s];
const size = (a: Vec) => Math.hypot(a[0], a[1], a[2]);

function at(motion: StandardMotion, points: ArrayLike<number>, name: string): Vec {
  const k = motion.index[name] * 3;
  return [points[k], points[k + 1], points[k + 2]];
}
const middle = (motion: StandardMotion, points: ArrayLike<number>, a: string, b: string) => scale(add(at(motion, points, a), at(motion, points, b)), .5);
function skiCentre(motion: StandardMotion, points: ArrayLike<number>, side: "left" | "right"): Vec {
  return scale(["tip_a", "tip_b", "tail_a", "tail_b"].map(corner => at(motion, points, `${side}_ski_${corner}`)).reduce(add), .25);
}

/** A ski's tilt in degrees: positive onto this turn's edges, negative still on the last turn's. */
function signedEdge(motion: StandardMotion, points: ArrayLike<number>, side: "left" | "right", mirrored: boolean) {
  const tipA = at(motion, points, `${side}_ski_tip_a`), tipB = at(motion, points, `${side}_ski_tip_b`), tail = at(motion, points, `${side}_ski_tail_a`);
  const heading = Math.atan2(tipA[0] - tail[0], tipA[1] - tail[1]), right = [Math.cos(heading), -Math.sin(heading)];
  const aRight = (tipA[0] - tipB[0]) * right[0] + (tipA[1] - tipB[1]) * right[1] > 0;
  const [leftCorner, rightCorner] = aRight ? [tipB, tipA] : [tipA, tipB];
  const tilt = Math.atan2(leftCorner[2] - rightCorner[2], Math.hypot(tipA[0] - tipB[0], tipA[1] - tipB[1])) / DEG;
  return mirrored ? -tilt : tilt;
}

function prepare(motion: StandardMotion, lesson: Lesson): PoseData | PathData {
  if (lesson.kind === "path") {
    const duration = motion.motion.durationSec;
    const turns = lesson.path === "uneven" ? [1, .55, 1.45, .7, 1.3, .8] : [1, 1, 1, 1, 1, 1];
    const paths: Record<Role, LinkedPath> = {
      fault: linkedPath(motion, lesson.path === "uneven" ? "round" : "z", turns.map(share => share * duration)),
      correct: linkedPath(motion, "round", turns.map(() => duration)),
    };
    const centre = (path: LinkedPath) => { const xs = path.samples.map(sample => sample.x); return (Math.max(...xs) + Math.min(...xs)) / 2; };
    const width = Math.max(paths.fault.width, paths.correct.width);
    return { kind: "path", paths, marks: { fault: pathMarks(motion, paths.fault), correct: pathMarks(motion, paths.correct) },
      pisteHalf: Math.max(15, Math.ceil(width * 2.2 / 5) * 5) / 2, centres: { fault: centre(paths.fault), correct: centre(paths.correct) },
      frame: Math.max(10, Math.min(42, motion.motion.speedMs * duration * 1.5)) };
  }
  const variants: FaultVariant[] = ["correct", lesson.variant];
  const turns = new Map<string, Record<"left" | "right", Corners>>(), hips = new Map<FaultVariant, { low: number; high: number }>();
  for (const variant of variants) {
    for (const mirrored of [false, true]) {
      const corners: Record<"left" | "right", Corners> = { left: { tips: [], tails: [] }, right: { tips: [], tails: [] } };
      for (let i = 0; i <= MARK_STEPS; i++) {
        const points = variantPointsAt(motion, i / MARK_STEPS, mirrored, variant);
        for (const side of ["left", "right"] as const) {
          const tip = middle(motion, points, `${side}_ski_tip_a`, `${side}_ski_tip_b`), tail = middle(motion, points, `${side}_ski_tail_a`, `${side}_ski_tail_b`);
          corners[side].tips.push([tip[0], tip[1]]);
          corners[side].tails.push([tail[0], tail[1]]);
        }
      }
      turns.set(`${variant}|${mirrored}`, corners);
    }
    const heights = Array.from({ length: 25 }, (_, i) => {
      const points = variantPointsAt(motion, i / 24, false, variant);
      return middle(motion, points, "left_hip", "right_hip")[2] - snowLevelAt(motion, i / 24);
    });
    hips.set(variant, { low: Math.min(...heights), high: Math.max(...heights) });
  }
  return { kind: "pose", advance: turnAdvance(motion), turns, hips };
}

/** One skier of a pose lesson at a moment: the body, its tracks and what is drawn over it. */
function buildPose(motion: StandardMotion, data: PoseData, lesson: Lesson, variant: FaultVariant, seconds: number,
  show: { forces: boolean; observe: boolean }, axes: CameraAxes, zh: boolean): Built {
  const duration = motion.motion.durationSec, n = Math.floor(seconds / duration), phase = seconds / duration - n, mirrored = n % 2 === 1;
  const origin = turnOrigin(n, data.advance), raw = variantPointsAt(motion, phase, mirrored, variant);
  const hips = middle(motion, raw, "left_hip", "right_hip");
  const u = hips[0] + origin[0], v = hips[1] + origin[1];
  const points = raw.slice();
  for (let k = 0; k < motion.pointCount; k++) { points[k * 3] += origin[0] - u; points[k * 3 + 1] += origin[1] - v; }
  const scene = (p: Vec): Vec => [p[0] + origin[0] - u, p[1] + origin[1] - v, p[2]];
  const level = snowLevelAt(motion, phase);

  // The skis' marks over the last turns, a smear where the skis slide.
  const ribbons: Ribbon[] = [];
  for (let turn = Math.max(0, n - TRACK_TURNS); turn <= n; turn++) {
    const shift = turnOrigin(turn, data.advance), corners = data.turns.get(`${variant}|${turn % 2 === 1}`)!, last = turn === n ? phase : 1;
    const steps = Math.floor(last * MARK_STEPS);
    if (steps < 1) continue;
    for (const side of ["left", "right"] as const) {
      const mark = skiMark(corners[side].tips.slice(0, steps + 1), corners[side].tails.slice(0, steps + 1));
      const slides = variant === "flat_edges", outside = (turn % 2 === 1) === (side === "right");
      ribbons.push({ alpha: .78 * (1 - (n - turn) / (TRACK_TURNS + 1)), points: mark.map(([x, y, half], i) => [x + shift[0] - u, y + shift[1] - v,
        slides ? Math.max(half, (outside ? .06 + .26 * Math.sin(Math.PI * i / MARK_STEPS) : .04 + .14 * Math.sin(Math.PI * i / MARK_STEPS))) : half]) });
    }
  }

  const overlays: StageOverlay[] = [], labels: Label[] = [], bars: Bar[] = [];
  const layers = new Set(lesson.layers), forces = forces3D(motion, phase, mirrored, variant);
  const name = (side: "left" | "right") => side === forces.outside ? (zh ? "外脚" : "Outside foot") : (zh ? "内脚" : "Inside foot");
  const outward = (side: "left" | "right"): Vec => {
    const heading = headings(motion, raw).skis, sign = side === "right" ? 1 : -1;
    return [Math.cos(heading) * .17 * sign, -Math.sin(heading) * .17 * sign, 0];
  };
  if (layers.has("feet") && show.forces && !show.observe) {
    for (const side of ["left", "right"] as const) {
      const ski = forces.skis[side];
      if (ski.load < .03) continue;
      const from = add(scene(ski.centre), outward(side)), vector = scale(ski.force, FORCE);
      overlays.push({ kind: "arrow", from, vector, color: PUSH, width: .018 + .026 * ski.load });
      labels.push({ at: add(from, vector), tone: "push", text: zh ? `${name(side)} ${(size(ski.force) / G).toFixed(1)} 倍体重` : `${name(side)} ${(size(ski.force) / G).toFixed(1)}× weight` });
    }
  }
  if (layers.has("push") && !show.observe) {
    overlays.push({ kind: "ball", at: scene(forces.com), radius: .065, color: CENTRE });
    labels.push({ at: add(scene(forces.com), [0, 0, .12]), tone: "dark", text: zh ? "重心" : "Centre of mass" });
    if (show.forces) {
      const bad = forces.holds === "in" || forces.holds === "out";
      overlays.push({ kind: "arrow", from: scene(forces.cop), vector: scale(forces.push, FORCE), color: bad ? WARN : PUSH, width: .02 });
      overlays.push({ kind: "arrow", from: scene(forces.com), vector: scale(forces.gravity, FORCE * .8), color: GRAVITY, width: .013 });
      if (bad) labels.push({ at: scene(forces.cop), tone: "warn", text: forces.holds === "out" ? (zh ? "合力落在外板外侧：打滑" : "Push outside the outside ski: it slides")
        : (zh ? "合力压在内板上：外板发飘" : "Push on the inside ski: the outside one goes light") });
    }
  }
  if (layers.has("rotation")) {
    const turning = rotationAt(motion, phase, mirrored, variant), ankles = middle(motion, raw, "left_ankle", "right_ankle"), shoulders = middle(motion, raw, "left_shoulder", "right_shoulder");
    // Within a few degrees the upper body simply goes with the skis, as a long turn's does.
    const separation = Math.round(turning.separation);
    labels.push({ at: scene(add(shoulders, [0, 0, .42])), tone: separation > 5 ? "good" : separation < -5 ? "warn" : "dark",
      text: separation > 5 ? (zh ? `上身朝山下 ${separation}°` : `Upper body ${separation}° down the hill`)
        : separation < -5 ? (zh ? `上身领先雪板 ${-separation}°` : `Upper body ${-separation}° ahead of the skis`) : (zh ? "上身跟着雪板" : "Upper body with the skis") });
    if (show.forces && !show.observe) {
      // A ring's arc is how far that part turns in the next second and a half.
      const facing = headings(motion, raw), arc = (rate: number) => Math.max(-1.8 * Math.PI, Math.min(1.8 * Math.PI, -rate * 1.5));
      overlays.push({ kind: "spiral", from: scene([ankles[0], ankles[1], level + .1]), to: scene(add(shoulders, [0, 0, .08])), color: variant === "correct" ? STANDARD_COLOR : WARN,
        clockwise: !mirrored, upward: variant === "correct", flow: seconds * 1.6 });
      overlays.push({ kind: "ring", centre: scene([ankles[0], ankles[1], level + .28]), axis: [0, 0, 1], start: [Math.sin(facing.skis), Math.cos(facing.skis), 0], radius: .5,
        arc: arc(turning.skis), color: SKIS_TURN, flow: seconds * 2 });
      overlays.push({ kind: "ring", centre: scene(shoulders), axis: [0, 0, 1], start: [Math.sin(facing.chest), Math.cos(facing.chest), 0], radius: .38,
        arc: arc(turning.chest), color: CHEST_TURN, flow: seconds * 2 });
      const perSecond = (rate: number) => Math.round(Math.abs(rate) / DEG);
      // Each ring's reading beside it, on the picture's right.
      labels.push({ at: add(scene([ankles[0], ankles[1], level + .2]), scale(axes.right, .9)), tone: "push", text: zh ? `雪板转动 ${perSecond(turning.skis)}°/秒` : `Skis turning ${perSecond(turning.skis)}°/s` });
      labels.push({ at: add(scene(shoulders), scale(axes.right, .8)), tone: "dark", text: zh ? `上身转动 ${perSecond(turning.chest)}°/秒` : `Upper body turning ${perSecond(turning.chest)}°/s` });
    }
  }
  if (layers.has("edges")) {
    for (const side of ["left", "right"] as const) {
      const edge = Math.round(signedEdge(motion, raw, side, mirrored)), place = add(add(scene(skiCentre(motion, raw, side)), scale(outward(side), 2.4)), [0, 0, .12]);
      labels.push({ at: place, tone: edge < 0 ? "warn" : "dark", text: edge < 0 ? (zh ? `旧刃 ${-edge}°` : `Old edge ${-edge}°`) : (zh ? `立刃 ${edge}°` : `Edge ${edge}°`) });
    }
  }
  if (layers.has("hips")) {
    const range = data.hips.get(variant)!, side = scale(axes.right, .62), base = add([0, 0, level], side);
    bars.push({ low: add(base, [0, 0, range.low]), high: add(base, [0, 0, range.high]), now: add(base, [0, 0, hips[2] - level]), color: variant === "correct" ? STANDARD_COLOR : FAULT_COLOR,
      text: zh ? `髋高变化 ${Math.round((range.high - range.low) * 100)} 厘米` : `Hips move ${Math.round((range.high - range.low) * 100)} cm` });
  }

  const stage = phase < .08 || phase > .94 ? (zh ? "换刃" : "Edge change") : Math.abs(phase - motion.motion.apexPhase) < .08 ? (zh ? "弯顶" : "Apex")
    : phase < motion.motion.apexPhase ? (zh ? "进弯" : "Entering") : (zh ? "出弯" : "Finishing");
  return { points, snowAt: [u, v], hipZ: hips[2], snowLevel: level, bumps: bumpField(motion), ribbons, overlays, labels, bars,
    caption: `${mirrored ? (zh ? "左转" : "Left turn") : (zh ? "右转" : "Right turn")} · ${stage}` };
}

/** One skier of a path lesson: down the piste on its path, with the snow's push on each foot. */
function buildPath(motion: StandardMotion, data: PathData, role: Role, seconds: number, show: { forces: boolean; observe: boolean }, zh: boolean, frame: number): Built {
  const path = data.paths[role], sample = pathAt(path, seconds), points = pathPose(motion, sample);
  let index = 0;
  while (index + 1 < path.samples.length && path.samples[index + 1].time <= sample.time) index++;
  const here = (x: number, y: number): [number, number] => [x - sample.x, y - sample.y];
  const ribbons: Ribbon[] = data.marks[role].map(mark => ({ alpha: .85, points: mark.slice(0, index + 1).map(([x, y, half]) => [...here(x, y), half] as [number, number, number]) }));
  const color = role === "fault" ? FAULT_COLOR : STANDARD_COLOR;
  const paths: PathLine[] = [
    { points: path.samples.slice(0, index + 1).map(s => here(s.x, s.y)), color, width: Math.max(.08, frame * .012), alpha: .9 },
    { points: path.samples.slice(index).map(s => here(s.x, s.y)), color, width: Math.max(.06, frame * .008), alpha: .55, dashed: true },
  ];
  // The piste's edges, painted faintly so its width reads from above.
  const centre = data.centres[role] - sample.x;
  for (const side of [-1, 1]) paths.push({ points: [[centre + side * data.pisteHalf, -80], [centre + side * data.pisteHalf, 80]], color: "#7b8ba3", width: Math.max(.06, frame * .006), alpha: .65, dashed: true });
  const overlays: StageOverlay[] = [], labels: Label[] = [];
  labels.push({ at: [centre + data.pisteHalf - 2.5, -frame * .18, 0], tone: "dark", text: zh ? `雪道宽 ${data.pisteHalf * 2} 米` : `Piste ${data.pisteHalf * 2} m` });
  // From far away the skier is small: a ring on the snow round them.
  if (frame > 14) overlays.push({ kind: "ring", centre: [0, 0, .05], axis: [0, 0, 1], start: [1, 0, 0], radius: frame * .03, arc: 2 * Math.PI * .97, color, flow: seconds });
  if (show.forces && !show.observe) {
    const forces = pathForces(motion, points, sample), heading = sample.heading + sample.skid, scaleUp = Math.sqrt(Math.max(1, frame / 12));
    for (const side of ["left", "right"] as const) {
      const foot = forces.feet[side];
      if (foot.share < .03) continue;
      const sign = side === "right" ? 1 : -1, from = add(foot.centre, [Math.cos(heading) * .17 * sign, -Math.sin(heading) * .17 * sign, 0]);
      const vector = scale(foot.force, FORCE * scaleUp);
      overlays.push({ kind: "arrow", from, vector, color: PUSH, width: (.018 + .026 * foot.share) * scaleUp });
      const outside = side === forces.outside;
      labels.push({ at: add(from, vector), tone: "push", text: zh ? `${outside ? "外脚" : "内脚"} ${(size(foot.force) / G).toFixed(1)} 倍体重` : `${outside ? "Outside" : "Inside"} ${(size(foot.force) / G).toFixed(1)}× weight` });
    }
  }
  const hips = middle(motion, points, "left_hip", "right_hip");
  return { points, snowAt: [sample.x, sample.y], hipZ: hips[2], snowLevel: 0, bumps: null, ribbons, overlays, labels, bars: [], paths,
    piste: { centre, halfWidth: data.pisteHalf },
    caption: zh ? `第 ${sample.turn + 1} 个弯 · ${sample.mirrored ? "左转" : "右转"}` : `Turn ${sample.turn + 1} · ${sample.mirrored ? "left" : "right"}` };
}

function roundRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.arcTo(x + width, y, x + width, y + height, radius);
  context.arcTo(x + width, y + height, x, y + height, radius);
  context.arcTo(x, y + height, x, y, radius);
  context.arcTo(x, y, x + width, y, radius);
  context.closePath();
}

const TONES: Record<Tone, string> = { dark: "rgba(20, 26, 36, 0.8)", warn: "rgba(206, 52, 52, 0.94)", good: "rgba(22, 140, 90, 0.94)", push: "rgba(37, 90, 190, 0.92)" };

type Rect = { left: number; top: number; width: number; height: number };

/** A short label on a dark pill, kept inside its part of the picture and clear of the labels already there. */
function pill(context: CanvasRenderingContext2D, [x, y]: readonly [number, number], text: string, tone: Tone, ratio: number, box: { left: number; right: number; top: number; bottom: number }, placed: Rect[]) {
  context.font = `600 ${11.5 * ratio}px system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif`;
  const width = context.measureText(text).width + 12 * ratio, height = 19 * ratio;
  const left = Math.max(box.left + 4 * ratio, Math.min(box.right - width - 4 * ratio, x - width / 2));
  let top = Math.max(box.top + 4 * ratio, Math.min(box.bottom - height - 4 * ratio, y - height - 6 * ratio));
  const hits = (t: number) => placed.some(r => left < r.left + r.width && r.left < left + width && t < r.top + r.height && r.top < t + height);
  for (let i = 0; i < 6 && hits(top); i++) top = Math.min(box.bottom - height - 4 * ratio, top + height + 3 * ratio);
  placed.push({ left, top, width, height });
  context.fillStyle = TONES[tone];
  roundRect(context, left, top, width, height, 6 * ratio);
  context.fill();
  context.fillStyle = "#ffffff";
  context.textBaseline = "middle";
  context.fillText(text, left + 6 * ratio, top + height / 2 + ratio * .5);
}

export function TechniqueLesson({ fault, motion, zh, fallback }: { fault: Fault; motion: StandardMotion; zh: boolean; fallback?: ReactNode }) {
  const lesson = LESSONS[fault.id];
  const [step, setStep] = useState<LessonStep>("look");
  const [auto, setAuto] = useState(true);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(.5);
  const [forces, setForces] = useState(true);
  const [bones, setBones] = useState(false);
  const [mode, setMode] = useState<"loading" | "scene" | "flat">("loading");
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { orbit, live: orbitRef, moved, setOrbit } = useOrbit(boxRef, lesson.views.look);
  const stageRef = useRef<{ stage: SkierStage; figures: Record<Role, SkierFigure>; project: typeof import("./skier-stage").shotToCanvas } | null>(null);
  const data = useMemo(() => prepare(motion, lesson), [motion, lesson]);
  const duration = motion.motion.durationSec;
  // Start a few turns down the slope, so there are tracks behind the skier from the first frame.
  const clock = useRef(TRACK_TURNS * duration);
  const stepStart = useRef(TRACK_TURNS * duration);
  const visible = useRef(true);
  const drawn = useRef("");
  const live = useRef({ step, playing, speed, forces, bones, auto });
  useEffect(() => { live.current = { step, playing, speed, forces, bones, auto }; }, [step, playing, speed, forces, bones, auto]);
  const stepLength = (lesson.kind === "path" ? 2.4 : 2) * duration;

  useEffect(() => {
    let alive = true;
    void (async () => {
      const box = boxRef.current;
      if (!box) return;
      const library = await import("./skier-stage");
      const stage = await library.SkierStage.create(box);
      if (!stage) { if (alive) setMode("flat"); return; }
      if (!alive) { stage.dispose(); return; }
      stageRef.current = { stage, figures: { fault: stage.figure(library.USER_LOOK, { poles: true }), correct: stage.figure(library.STANDARD_LOOK, { poles: true }) }, project: library.shotToCanvas };
      drawn.current = "";
      setMode("scene");
    })().catch(() => { if (alive) setMode("flat"); /* Without the mesh or WebGL, the flat pictures. */ });
    return () => { alive = false; stageRef.current?.stage.dispose(); stageRef.current = null; };
  }, []);

  // Off screen, nothing to draw: the graphics card is left alone.
  useEffect(() => {
    const box = boxRef.current;
    if (!box || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => { visible.current = entry.isIntersecting; });
    observer.observe(box);
    return () => observer.disconnect();
  }, [mode]);

  // Each step starts from its own camera, at the start of a turn.
  useEffect(() => {
    setOrbit(lesson.views[step]);
    stepStart.current = clock.current;
    drawn.current = "";
  }, [step, lesson, setOrbit]);

  const draw = useCallback((seconds: number) => {
    const canvas = canvasRef.current, context = canvas?.getContext("2d"), scene = stageRef.current;
    if (!canvas || !context) return;
    const ratio = window.devicePixelRatio || 1;
    const width = Math.round(canvas.clientWidth * ratio), height = Math.round(canvas.clientHeight * ratio);
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    if (!scene?.stage.usable) { context.clearRect(0, 0, width, height); return; }
    const now = live.current, view = orbitRef.current;
    const key = `${seconds}|${view.azimuth}|${view.elevation}|${view.zoom}|${now.step}|${now.forces}|${now.bones}|${width}x${height}`;
    if (key === drawn.current) return;
    drawn.current = key;

    const axes = cameraAxes({ azimuth: view.azimuth, elevation: view.elevation, slope: motion.motion.pitchDeg });
    const roles: Role[] = now.step === "look" || now.step === "why" ? ["fault"] : now.step === "fix" ? ["correct"] : ["fault", "correct"];
    const show = { forces: now.forces, observe: now.step === "look" };
    const frame = (data.kind === "path" && !lesson.views[now.step].close ? data.frame : FRAME) * view.zoom, distance = 8 * frame / FRAME;
    const parts = roles.map((role, i) => {
      const built = data.kind === "path" ? buildPath(motion, data, role, seconds, show, zh, frame)
        : buildPose(motion, data, lesson, role === "fault" ? lesson.variant : "correct", seconds, show, axes, zh);
      const figure = scene.figures[role];
      figure.setPose(built.points, motion.index);
      const below = frame * .05;
      const shot: Shot = { rect: { x: i / roles.length, y: 0, width: 1 / roles.length, height: 1 }, axes, slopeDeg: motion.motion.pitchDeg, frameHeight: frame, distance,
        focus: [-axes.up[0] * below, -axes.up[1] * below, built.hipZ - axes.up[2] * below], snowAt: built.snowAt, figures: [figure], ribbons: built.ribbons,
        overlays: built.overlays, paths: built.paths, piste: built.piste, groomed: !built.bumps, bumps: built.bumps, snowLevel: built.snowLevel, shadowAt: [0, 0, built.hipZ] };
      return { role, built, shot };
    });
    scene.stage.render(parts.map(part => part.shot));

    context.clearRect(0, 0, width, height);
    if (parts.length === 2) {
      context.fillStyle = "rgba(255, 255, 255, 0.92)";
      context.fillRect(width / 2 - ratio, 0, ratio * 2, height);
    }
    for (const { role, built, shot } of parts) {
      const toCanvas = scene.project(shot, width, height), map = (p: Vec) => toCanvas(p[0], p[1], p[2]);
      const box = { left: shot.rect.x * width, right: (shot.rect.x + shot.rect.width) * width, top: 30 * ratio, bottom: height - 24 * ratio }, placed: Rect[] = [];
      if (now.bones) {
        const point = (k: number): Point => map([built.points[k * 3], built.points[k * 3 + 1], built.points[k * 3 + 2]]);
        drawBones(context, motionBones(motion).map(([p, q]) => [point(p), point(q)] as const), Array.from({ length: 18 }, (_, k) => point(k + 5)),
          role === "fault" ? USER_BONES : STANDARD_BONES, fineBonesUnit(height, ratio));
      }
      for (const bar of built.bars) {
        const low = map(bar.low), high = map(bar.high), here = map(bar.now);
        context.lineCap = "round";
        context.strokeStyle = bar.color;
        context.globalAlpha = .35;
        context.lineWidth = 10 * ratio;
        context.beginPath(); context.moveTo(low[0], low[1]); context.lineTo(high[0], high[1]); context.stroke();
        context.globalAlpha = 1;
        context.fillStyle = bar.color;
        context.beginPath(); context.arc(here[0], here[1], 6 * ratio, 0, Math.PI * 2); context.fill();
        pill(context, [high[0], high[1] - 4 * ratio], bar.text, "dark", ratio, box, placed);
      }
      for (const label of built.labels) pill(context, map(label.at), label.text, label.tone, ratio, box, placed);
      context.font = `600 ${12 * ratio}px system-ui, sans-serif`;
      context.fillStyle = "rgba(20, 30, 45, 0.82)";
      context.textBaseline = "alphabetic";
      context.fillText(built.caption, box.left + 12 * ratio, height - 12 * ratio);
    }
  }, [data, lesson, motion, orbitRef, zh]);

  useEffect(() => {
    let frame = 0, last = performance.now();
    const tick = (wall: number) => {
      const dt = Math.min(.1, (wall - last) / 1000);
      last = wall;
      const now = live.current;
      if (now.playing && visible.current) clock.current += dt * now.speed;
      if (now.auto && now.playing && now.step !== "compare" && clock.current - stepStart.current > stepLength) {
        const next = LESSON_STEPS[LESSON_STEPS.indexOf(now.step) + 1];
        live.current = { ...now, step: next };
        setStep(next);
      }
      if (visible.current) draw(clock.current);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [draw, stepLength]);

  // A turned camera redraws at once, even while paused.
  useEffect(() => { drawn.current = ""; }, [orbit, forces, bones]);

  if (mode === "flat" && fallback) return <>{fallback}</>;
  const roles: Role[] = step === "look" || step === "why" ? ["fault"] : step === "fix" ? ["correct"] : ["fault", "correct"];
  const tag = (role: Role) => role === "fault" ? (zh ? "问题示意" : "The fault") : (zh ? "标准动作" : "The standard");
  const presetView = (preset: (typeof PRESETS)[number]): LessonView => ({ azimuth: preset.azimuth, elevation: data.kind === "path" && preset.key === "above" ? 62 : preset.elevation, zoom: orbit.zoom });
  const pathInfo = data.kind === "path" ? (zh
    ? `雪道宽 ${data.pisteHalf * 2} 米 · 圆弧弯宽约 ${data.paths.correct.width.toFixed(0)} 米 · ${lesson.path === "z" ? "Z 字弯" : "节奏乱的弯"}宽约 ${data.paths.fault.width.toFixed(0)} 米；侧向力最大：圆弧 ${(data.paths.correct.peakLateral / G).toFixed(1)} 倍体重，${lesson.path === "z" ? "Z 字" : "节奏乱"} ${(data.paths.fault.peakLateral / G).toFixed(1)} 倍`
    : `Piste ${data.pisteHalf * 2} m wide · round turns about ${data.paths.correct.width.toFixed(0)} m wide · ${lesson.path === "z" ? "Z turns" : "uneven turns"} about ${data.paths.fault.width.toFixed(0)} m; largest sideways push: round ${(data.paths.correct.peakLateral / G).toFixed(1)}× weight, ${lesson.path === "z" ? "Z" : "uneven"} ${(data.paths.fault.peakLateral / G).toFixed(1)}×`) : null;

  return <div className="space-y-2">
    <div role="group" aria-label={zh ? "讲解步骤" : "Lesson steps"} className="flex flex-wrap gap-1.5">
      {LESSON_STEPS.map((value, i) => <button key={value} type="button" aria-pressed={step === value} onClick={() => setStep(value)}
        className={cn("press inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold", step === value ? "border-accent bg-accent text-accent-foreground" : "border-border bg-surface text-ink-2 hover:text-ink")}>
        <span className={cn("flex size-4 items-center justify-center rounded-full text-[10px]", step === value ? "bg-white/25" : "bg-surface-2")}>{i + 1}</span>{zh ? STEP_NAMES[value][0] : STEP_NAMES[value][1]}
      </button>)}
    </div>
    <div ref={boxRef} tabIndex={0} aria-label={zh ? `${fault.zh}的 3D 讲解，拖动可以转视角` : `${fault.en} in 3D; drag to turn the view`}
      className={cn("relative aspect-video cursor-grab touch-pan-y overflow-hidden rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-accent active:cursor-grabbing",
        mode === "flat" ? "bg-[#0d1524]" : "bg-[#e6edf5]", mode === "loading" && "animate-pulse")}>
      <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" />
      {mode === "scene" && roles.map((role, i) => <span key={role} className="pointer-events-none absolute top-2.5 flex items-center gap-1.5 rounded-full bg-black/45 px-2.5 py-1 text-xs font-semibold text-white"
        style={{ left: `calc(${(i / roles.length) * 100}% + 0.6rem)` }}>
        <span className="size-2 rounded-full" style={{ background: role === "fault" ? FAULT_COLOR : STANDARD_COLOR }} />{tag(role)}</span>)}
      {mode === "scene" && !moved && <span className="pointer-events-none absolute right-2.5 top-2.5 flex items-center gap-1 rounded-full bg-black/35 px-2.5 py-1 text-[11px] font-medium text-white">
        <Move3d className="size-3.5" aria-hidden />{zh ? "拖动转视角" : "Drag to turn"}</span>}
      {mode === "flat" && <p className="absolute inset-0 flex items-center justify-center p-4 text-center text-sm text-white/70">{zh ? "这个浏览器不能显示 3D 画面。" : "This browser cannot show the 3D view."}</p>}
    </div>
    <p className="min-h-10 text-sm leading-relaxed text-ink">{lesson.captions[step][zh ? 0 : 1]}</p>
    {pathInfo && <p className="text-xs text-ink-3" data-numeric>{pathInfo}</p>}
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" onClick={() => setPlaying(value => !value)} aria-label={playing ? (zh ? "暂停" : "Pause") : (zh ? "播放" : "Play")}
        className="press flex size-9 items-center justify-center rounded-full bg-accent text-accent-foreground">
        {playing ? <Pause className="size-4" aria-hidden /> : <Play className="size-4 translate-x-px" aria-hidden />}
      </button>
      <div role="group" aria-label={zh ? "播放速度" : "Playback speed"} className="flex rounded-lg border border-border bg-surface-2 p-0.5">
        {SPEEDS.map(value => <button key={value} type="button" aria-pressed={speed === value} onClick={() => setSpeed(value)}
          className={cn("min-h-8 rounded-md px-2 text-xs font-semibold", speed === value ? "bg-surface text-ink shadow-[var(--shadow-sm)]" : "text-ink-3 hover:text-ink")}>{value}×</button>)}
      </div>
      <button type="button" aria-pressed={auto} onClick={() => setAuto(value => !value)}
        className={cn("press min-h-9 rounded-lg px-2.5 text-xs font-semibold", auto ? "bg-accent-soft text-accent" : "text-ink-3 hover:bg-surface-2")}>{zh ? "自动讲解" : "Auto-play"}</button>
      <button type="button" aria-pressed={forces} onClick={() => setForces(value => !value)}
        className={cn("press min-h-9 rounded-lg px-2.5 text-xs font-semibold", forces ? "bg-accent-soft text-accent" : "text-ink-3 hover:bg-surface-2")}>{zh ? "受力箭头" : "Forces"}</button>
      <button type="button" aria-pressed={bones} onClick={() => setBones(value => !value)}
        className={cn("press flex min-h-9 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold", bones ? "bg-accent-soft text-accent" : "text-ink-3 hover:bg-surface-2")}>
        <Bone className="size-3.5" aria-hidden />{zh ? "骨架" : "Skeleton"}</button>
      <div role="group" aria-label={zh ? "观察角度" : "Viewing angle"} className="flex rounded-lg border border-border bg-surface-2 p-0.5">
        {PRESETS.map(preset => <button key={preset.key} type="button" onClick={() => setOrbit(presetView(preset), true)}
          className="min-h-8 rounded-md px-2 text-xs font-semibold text-ink-3 hover:text-ink">{zh ? preset.zh : preset.en}</button>)}
      </div>
      <button type="button" onClick={() => setOrbit(lesson.views[step])} aria-label={zh ? "回到这一步的视角" : "Back to this step's view"}
        className="press flex size-9 items-center justify-center rounded-lg text-ink-3 hover:bg-surface-2"><RotateCcw className="size-4" aria-hidden /></button>
    </div>
    <p className="text-[11px] leading-relaxed text-ink-3">{zh
      ? "橙色：犯这个毛病；绿色：标准动作。箭头越长力越大，是示意，不是你的测量值。"
      : "Orange: with the fault; green: the standard. Longer arrows are bigger forces, as an illustration, not your measurement."}</p>
  </div>;
}
