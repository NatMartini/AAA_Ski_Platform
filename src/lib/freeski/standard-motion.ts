import { z } from "zod";
import { bodyHeight, jointCenter, poseAt, type DecodedPose, type PoseSample } from "./report-v2";
import type { Scorecard } from "./scorecard";
import { skiMark } from "./skier-rig";

/**
 * The generated standard motions (scripts/standard-motion, public/standard-motions): a 3D skier for
 * one right turn per CSIA action and level, whose left turn is its mirror. Here they are projected
 * from the camera that filmed a student's turn and timed to that turn, for display only.
 */
export const STANDARD_MOTION_IDS = ["demonstration_parallel-l1", "demonstration_parallel-l2", "demonstration_parallel-l3", "demonstration_parallel-l4",
  "intro_parallel-l2", "free_run-l2", "short_turn-l2", "short_turn-l3", "short_turn-l4", "advanced_parallel-l3", "expert_parallel-l4",
  "bumps-l3", "bumps-l4", "braquage-l3", "hop_turn-l3", "hop_turn-l4", "expert_all_terrain-l4", "expert_corridor-l4", "javelin-l4"] as const;
export type StandardMotionId = (typeof STANDARD_MOTION_IDS)[number];

/** The motions by action, in the order a student meets them. */
export const STANDARD_MOTION_GROUPS = [
  { action: "demonstration_parallel", zh: "示范平行弯", en: "Demonstration parallel", levels: [1, 2, 3, 4] },
  { action: "intro_parallel", zh: "入门平行弯", en: "Intro to parallel", levels: [2] },
  { action: "short_turn", zh: "小回转", en: "Short turns", levels: [2, 3, 4] },
  { action: "free_run", zh: "自由滑行", en: "Free run", levels: [2] },
  { action: "advanced_parallel", zh: "进阶平行弯", en: "Advanced parallel", levels: [3] },
  { action: "expert_parallel", zh: "专家平行弯", en: "Expert parallel", levels: [4] },
  { action: "bumps", zh: "蘑菇地形", en: "Bumps", levels: [3, 4] },
  { action: "braquage", zh: "原地小弯", en: "Braquage", levels: [3] },
  { action: "hop_turn", zh: "跳跃转弯", en: "Hop turns", levels: [3, 4] },
  { action: "javelin", zh: "标枪转弯", en: "Javelin turns", levels: [4] },
  { action: "expert_all_terrain", zh: "专家全地形", en: "Expert all terrain", levels: [4] },
  { action: "expert_corridor", zh: "定宽走廊", en: "Expert corridor", levels: [4] },
] as const;

const metricCheck = z.object({ value: z.number(), p25: z.number(), median: z.number(), p75: z.number(), polarity: z.string(), score: z.number(),
  band: z.string(), counted: z.boolean().optional(), shown: z.boolean().optional() });
const motionSchema = z.object({
  schema: z.literal("standard_motion.v1"), id: z.enum(STANDARD_MOTION_IDS), action: z.string(), level: z.number().int().min(1).max(4),
  name: z.object({ zh: z.string(), en: z.string() }),
  csia: z.object({ speed: z.string(), performance: z.string(), pitch: z.string(), surface: z.string(), sizeM: z.tuple([z.number(), z.number()]).nullable(),
    qualitiesZh: z.array(z.string()), source: z.string() }),
  notesZh: z.array(z.string()),
  motion: z.object({ durationSec: z.number().positive(), speedMs: z.number().positive(), pitchDeg: z.number(), turnWidthM: z.number(),
    apexPhase: z.number().min(0).max(1), headingDeg: z.number(), elevationDeg: z.number() }),
  body: z.object({ heightM: z.number(), skiLengthM: z.number(), poleLengthM: z.number() }),
  points: z.array(z.string()).min(23).max(40), jointCount: z.number().int(),
  frames: z.array(z.array(z.number().int())).min(2).max(240),
  curves: z.record(z.string(), z.array(z.number())),
  verification: z.object({ reference: z.string(), otherLevel: z.boolean(), clips: z.number(), turns: z.number(), fitRmsBodyHeights: z.number(),
    overall: z.number().nullable(), turnsScored: z.number(), metrics: z.record(z.string(), metricCheck), shownInBand: z.number(), shownCount: z.number(), seamM: z.number() }),
}).refine(raw => raw.frames.every(frame => frame.length === raw.points.length * 3), "Invalid frame layout");

export type StandardMotion = Omit<z.infer<typeof motionSchema>, "frames"> & {
  /** phases × points × xyz in metres, slope coordinates: across (+ is the skier's right), down the fall line, off the snow. */
  data: Float64Array; phaseCount: number; pointCount: number; mirror: number[]; index: Record<string, number>;
};

export function decodeStandardMotion(raw: unknown): StandardMotion {
  const { frames, ...parsed } = motionSchema.parse(raw);
  const pointCount = parsed.points.length, phaseCount = frames.length;
  const data = new Float64Array(phaseCount * pointCount * 3);
  frames.forEach((frame, i) => frame.forEach((value, j) => { data[i * pointCount * 3 + j] = value / 1000; }));
  const index = Object.fromEntries(parsed.points.map((name, i) => [name, i]));
  const swap = (name: string) => name.startsWith("left_") ? `right_${name.slice(5)}` : name.startsWith("right_") ? `left_${name.slice(6)}` : name;
  return { ...parsed, data, phaseCount, pointCount, index, mirror: parsed.points.map(name => index[swap(name)] ?? index[name]) };
}

/** Which standard a score card was compared with. Null when the action has no generated motion. */
export function standardMotionId(card: Pick<Scorecard, "action" | "level" | "calibration">): StandardMotionId | null {
  const target = card.calibration.reference_target ?? null;
  const fromTarget = /^level([1-4])$/.exec(target ?? "")?.[1] ?? (target === "expert" ? "4" : target === "advanced" ? "3" : null);
  const level = fromTarget ?? /^level([1-4])$/.exec(card.level ?? "")?.[1] ?? null;
  if (!level) return null;
  const action = card.action === "parallel" ? "demonstration_parallel"
    : card.action === "carving" ? (level === "4" ? "expert_parallel" : "advanced_parallel") : card.action;
  const id = `${action}-l${level}`;
  return (STANDARD_MOTION_IDS as readonly string[]).includes(id) ? id as StandardMotionId : null;
}

/** All points at a phase of the turn, as (x, y, z) triples; `mirrored` gives the left turn. */
export function motionPointsAt(motion: StandardMotion, phase: number, mirrored = false): Float64Array {
  const { data, phaseCount, pointCount, mirror } = motion;
  const position = Math.max(0, Math.min(1, phase)) * (phaseCount - 1);
  const i = Math.min(phaseCount - 2, Math.floor(position)), alpha = position - i;
  const out = new Float64Array(pointCount * 3);
  for (let k = 0; k < pointCount; k++) {
    const source = mirrored ? mirror[k] : k;
    for (let c = 0; c < 3; c++) {
      const a = data[(i * pointCount + source) * 3 + c], b = data[((i + 1) * pointCount + source) * 3 + c];
      out[k * 3 + c] = a + (b - a) * alpha;
    }
    if (mirrored) out[k * 3] = -out[k * 3];
  }
  return out;
}

/** The marks both skis leave over part of a turn, in the slope coordinates of that turn. */
export function motionMarks(motion: StandardMotion, to: number, mirrored: boolean, steps = 28) {
  return (["left", "right"] as const).map(side => {
    const corner = (name: string) => motion.index[`${side}_ski_${name}`] * 3;
    const tipA = corner("tip_a"), tipB = corner("tip_b"), tailA = corner("tail_a"), tailB = corner("tail_b");
    const tips: [number, number][] = [], tails: [number, number][] = [];
    for (let step = 0; step <= steps; step++) {
      const frame = motionPointsAt(motion, to * step / steps, mirrored);
      tips.push([(frame[tipA] + frame[tipB]) / 2, (frame[tipA + 1] + frame[tipB + 1]) / 2]);
      tails.push([(frame[tailA] + frame[tailB]) / 2, (frame[tailA + 1] + frame[tailB + 1]) / 2]);
    }
    return skiMark(tips, tails);
  });
}

/** How high the snow is under the skier at a phase: only bumps are not flat. Metres above the slope's plane. */
export function snowLevelAt(motion: StandardMotion, phase: number) {
  const curve = motion.curves.snowHeightM;
  if (!curve?.length) return 0;
  const position = Math.max(0, Math.min(1, phase)) * (curve.length - 1), i = Math.min(curve.length - 2, Math.floor(position));
  return curve[i] + (curve[i + 1] - curve[i]) * (position - i);
}

/** The bump field a motion rides, for shading the snow: one bump per turn. Null on a smooth slope. */
export function bumpField(motion: StandardMotion) {
  const curve = motion.curves.snowHeightM;
  if (!curve?.some(value => Math.abs(value) > .01)) return null;
  // Moguls are taller than what the skis' short path over them shows; their shading is for reading the terrain.
  return { spacing: motion.motion.speedMs * motion.motion.durationSec * .92, height: Math.max(.16, (Math.max(...curve) - Math.min(...curve)) / 2) };
}

export type ViewCamera = { azimuth: number; elevation: number; slope: number };
type Vector = [number, number, number];
const cross = (a: Vector, b: Vector): Vector => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: Vector, b: Vector) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Azimuth about the slope normal (0 from behind, 180 from the front), elevation above the slope; the picture's up follows gravity. */
export function cameraAxes({ azimuth, elevation, slope }: ViewCamera) {
  const a = azimuth * Math.PI / 180, e = elevation * Math.PI / 180, s = slope * Math.PI / 180;
  const forward: Vector = [Math.sin(a) * Math.cos(e), Math.cos(a) * Math.cos(e), -Math.sin(e)];
  const world: Vector = [0, -Math.sin(s), Math.cos(s)];
  const along = dot(world, forward);
  const raw: Vector = [world[0] - along * forward[0], world[1] - along * forward[1], world[2] - along * forward[2]];
  const length = Math.hypot(...raw) || 1;
  const up: Vector = [raw[0] / length, raw[1] / length, raw[2] / length];
  return { right: cross(forward, up), up, forward };
}

export type CameraAxes = ReturnType<typeof cameraAxes>;

/** A world point's picture coordinates: x to the picture's right, y down the picture, metres. */
export function projectPoint(points: ArrayLike<number>, k: number, axes: CameraAxes): [number, number] {
  const x = points[k * 3], y = points[k * 3 + 1], z = points[k * 3 + 2];
  return [x * axes.right[0] + y * axes.right[1] + z * axes.right[2], -(x * axes.up[0] + y * axes.up[1] + z * axes.up[2])];
}

export type TurnTiming = { start: number; end: number; apex?: number | null; role?: "start" | "middle" | "end" };

/**
 * Where in the standard's turn a moment of the student's turn falls. A whole turn maps edge change to
 * edge change, apex to apex. A start or end part has one real edge change, so it runs at the standard's
 * own pace from that end.
 */
export function phaseAt(time: number, timing: TurnTiming, motion: Pick<StandardMotion, "motion">): number {
  const { start, end, apex, role } = timing;
  const pace = motion.motion.durationSec;
  if (role === "start") return Math.max(0, Math.min(1, 1 - (end - time) / pace));
  if (role === "end") return Math.max(0, Math.min(1, (time - start) / pace));
  const middle = motion.motion.apexPhase;
  if (apex !== null && apex !== undefined && apex > start && apex < end) {
    return time <= apex ? Math.max(0, (time - start) / (apex - start) * middle) : Math.min(1, middle + (time - apex) / (end - apex) * (1 - middle));
  }
  return Math.max(0, Math.min(1, (time - start) / Math.max(1e-6, end - start)));
}

const FIT_JOINTS = ["left_shoulder", "right_shoulder", "left_hip", "right_hip", "left_knee", "right_knee", "left_ankle", "right_ankle", "left_wrist", "right_wrist"];
const FIT_SAMPLES = 16;

export type FittedView = { camera: ViewCamera; mirrored: boolean; error: number };

/** Median shoulder-to-ankle height in the picture, in metres, under this camera. */
export function standardHeight(motion: StandardMotion, phases: number[], mirrored: boolean, axes: CameraAxes) {
  const heights = phases.map(phase => {
    const points = motionPointsAt(motion, phase, mirrored);
    const a = projectPoint(points, motion.index.left_shoulder, axes), b = projectPoint(points, motion.index.right_shoulder, axes);
    const c = projectPoint(points, motion.index.left_ankle, axes), d = projectPoint(points, motion.index.right_ankle, axes);
    return Math.hypot((a[0] + b[0] - c[0] - d[0]) / 2, (a[1] + b[1] - c[1] - d[1]) / 2);
  }).sort((p, q) => p - q);
  return heights[Math.floor(heights.length / 2)] || 1;
}

/**
 * The camera and turn direction under which the standard looks most like what was filmed, by trying
 * them: the joint labels tell front from behind, the lean tells the direction.
 */
export function fitView(motion: StandardMotion, user: DecodedPose, timing: TurnTiming): FittedView | null {
  const height = bodyHeight(user);
  if (!height) return null;
  const times = Array.from({ length: FIT_SAMPLES }, (_, i) => timing.start + (i + .5) / FIT_SAMPLES * (timing.end - timing.start));
  const joints = FIT_JOINTS.map(name => ({ user: user.jointNames.indexOf(name), standard: motion.index[name] })).filter(j => j.user >= 0);
  const seen = times.flatMap(time => {
    const sample = poseAt(user, time);
    const hip = jointCenter(user, sample, "left_hip", "right_hip");
    if (!hip) return [];
    return [{ phase: phaseAt(time, timing, motion), offsets: joints.map(j => sample.observed[j.user]
      ? [(sample.frame[j.user][0] - hip[0]) / height, (sample.frame[j.user][1] - hip[1]) / height] : null) }];
  });
  if (seen.length < 4) return null;
  const phases = seen.map(row => row.phase);
  const tryView = (camera: ViewCamera, mirrored: boolean) => {
    const axes = cameraAxes(camera), scale = standardHeight(motion, phases, mirrored, axes);
    let total = 0, count = 0;
    for (const row of seen) {
      const points = motionPointsAt(motion, row.phase, mirrored);
      const a = projectPoint(points, motion.index.left_hip, axes), b = projectPoint(points, motion.index.right_hip, axes);
      const hx = (a[0] + b[0]) / 2, hy = (a[1] + b[1]) / 2;
      joints.forEach((joint, j) => {
        const offset = row.offsets[j];
        if (!offset) return;
        const p = projectPoint(points, joint.standard, axes);
        total += ((p[0] - hx) / scale - offset[0]) ** 2 + ((p[1] - hy) / scale - offset[1]) ** 2;
        count++;
      });
    }
    return count ? total / count : Infinity;
  };
  let best: FittedView | null = null;
  const consider = (azimuth: number, elevation: number, mirrored: boolean) => {
    const camera = { azimuth: (azimuth + 360) % 360, elevation, slope: motion.motion.pitchDeg };
    const error = tryView(camera, mirrored);
    if (!best || error < best.error) best = { camera, mirrored, error };
  };
  for (const mirrored of [false, true]) for (let azimuth = 0; azimuth < 360; azimuth += 15) for (const elevation of [4, 14, 26]) consider(azimuth, elevation, mirrored);
  const coarse = best as FittedView | null;
  if (!coarse) return null;
  for (let step = -10; step <= 10; step += 5) for (const change of [-4, 0, 4]) consider(coarse.camera.azimuth + step, Math.max(0, coarse.camera.elevation + change), coarse.mirrored);
  return best;
}

export type ViewName = "front" | "rear" | "side";
export function viewName(azimuth: number): ViewName {
  const a = ((azimuth % 360) + 360) % 360;
  return a >= 135 && a <= 225 ? "front" : a <= 45 || a >= 315 ? "rear" : "side";
}

export type StandardPose = DecodedPose & {
  /** Per sample: is the skier's left side nearer the camera, is the face toward it, for drawing order. */
  nearLeft: boolean[]; facing: boolean[];
  camera: ViewCamera; mirrored: boolean;
};

const DEFAULT_BONES = [["left_shoulder", "right_shoulder"], ["left_shoulder", "left_elbow"], ["left_elbow", "left_wrist"], ["right_shoulder", "right_elbow"],
  ["right_elbow", "right_wrist"], ["left_shoulder", "left_hip"], ["right_shoulder", "right_hip"], ["left_hip", "right_hip"], ["left_hip", "left_knee"],
  ["left_knee", "left_ankle"], ["right_hip", "right_knee"], ["right_knee", "right_ankle"], ["left_ankle", "left_heel"], ["left_heel", "left_bigtoe"],
  ["right_ankle", "right_heel"], ["right_heel", "right_bigtoe"]] as const;

export const motionBones = (motion: StandardMotion) => DEFAULT_BONES.map(([a, b]) => [motion.index[a], motion.index[b]]);

/**
 * The standard in the student's pose form: their clock, their camera, their height, their hips. Every
 * consumer of a DecodedPose (interpolation, the stage's hip pinning, the overlay on the video) can use it.
 */
export function standardPoseForTurn(motion: StandardMotion, user: DecodedPose, timing: TurnTiming, view: FittedView, rate = 60): StandardPose | null {
  const height = bodyHeight(user);
  if (!height) return null;
  const axes = cameraAxes(view.camera);
  const count = Math.max(2, Math.min(600, Math.ceil((timing.end - timing.start) * rate) + 1));
  const times = Array.from({ length: count }, (_, i) => timing.start + i / (count - 1) * (timing.end - timing.start));
  const phases = times.map(time => phaseAt(time, timing, motion));
  const scale = height / standardHeight(motion, phases, view.mirrored, axes);
  const frames: number[][][] = [], nearLeft: boolean[] = [], facing: boolean[] = [];
  let hip: [number, number] | null = null;
  const firstHip = times.map(time => jointCenter(user, poseAt(user, time), "left_hip", "right_hip")).find(Boolean) ?? null;
  if (!firstHip) return null;
  const { left_hip: leftHip, right_hip: rightHip, left_shoulder: leftShoulder, right_shoulder: rightShoulder, nose, left_ear: leftEar, right_ear: rightEar } = motion.index;
  const depth = (points: Float64Array, k: number) => points[k * 3] * axes.forward[0] + points[k * 3 + 1] * axes.forward[1] + points[k * 3 + 2] * axes.forward[2];
  times.forEach((time, i) => {
    hip = jointCenter(user, poseAt(user, time), "left_hip", "right_hip") ?? hip ?? firstHip;
    const points = motionPointsAt(motion, phases[i], view.mirrored);
    const a = projectPoint(points, leftHip, axes), b = projectPoint(points, rightHip, axes);
    const hx = (a[0] + b[0]) / 2, hy = (a[1] + b[1]) / 2;
    frames.push(motion.points.map((_, k) => {
      const p = projectPoint(points, k, axes);
      return [hip![0] + (p[0] - hx) * scale, hip![1] + (p[1] - hy) * scale, 1];
    }));
    nearLeft.push(depth(points, leftShoulder) < depth(points, rightShoulder));
    facing.push(depth(points, nose) < (depth(points, leftEar) + depth(points, rightEar)) / 2);
  });
  return { times, frames, observed: frames.map(frame => frame.map(() => true)), connections: motionBones(motion), resolution: user.resolution,
    jointNames: motion.points, nearLeft, facing, camera: view.camera, mirrored: view.mirrored };
}

/** The student's ski, from the foot it is locked to: a boot's sole is parallel to its ski, so foreshortening carries over. */
export const SKI_PER_FOOT = 1.70 / .25;
const SKI_FORWARD_SHARE = .90 / 1.70;

export type SkiLine = { tail: [number, number]; tip: [number, number] };

/** Display-only: foot directions averaged over a short window, because a small foot's keypoints are noisy and a ski is stiff. */
export function smoothedFootVectors(pose: DecodedPose, side: "left" | "right", windowSec = .12): ([number, number] | null)[] {
  const heel = pose.jointNames.indexOf(`${side}_heel`), toe = pose.jointNames.indexOf(`${side}_bigtoe`);
  if (heel < 0 || toe < 0) return pose.times.map(() => null);
  const seen = (i: number) => pose.observed[i][heel] && pose.observed[i][toe] && pose.frames[i][heel][2] >= .3 && pose.frames[i][toe][2] >= .3;
  return pose.times.map((time, i) => {
    let dx = 0, dy = 0, n = 0;
    for (let d = -12; d <= 12; d++) {
      const j = i + d;
      if (j < 0 || j >= pose.times.length || Math.abs(pose.times[j] - time) > windowSec || !seen(j)) continue;
      dx += pose.frames[j][toe][0] - pose.frames[j][heel][0];
      dy += pose.frames[j][toe][1] - pose.frames[j][heel][1];
      n++;
    }
    return n ? [dx / n, dy / n] : null;
  });
}

/** One ski in a pose sample: centred where the foot is, as long as the foot's direction says. */
export function skiLine(pose: DecodedPose, sample: PoseSample, side: "left" | "right", foot: [number, number] | null, maxLength: number): SkiLine | null {
  const heel = pose.jointNames.indexOf(`${side}_heel`), toe = pose.jointNames.indexOf(`${side}_bigtoe`);
  if (heel < 0 || toe < 0 || !foot || !sample.observed[heel] || !sample.observed[toe]) return null;
  const cx = sample.frame[heel][0] + (sample.frame[toe][0] - sample.frame[heel][0]) * .36, cy = sample.frame[heel][1] + (sample.frame[toe][1] - sample.frame[heel][1]) * .36;
  let dx = foot[0] * SKI_PER_FOOT, dy = foot[1] * SKI_PER_FOOT;
  const length = Math.hypot(dx, dy);
  if (length > maxLength) { dx *= maxLength / length; dy *= maxLength / length; }
  return { tip: [cx + dx * SKI_FORWARD_SHARE, cy + dy * SKI_FORWARD_SHARE], tail: [cx - dx * (1 - SKI_FORWARD_SHARE), cy - dy * (1 - SKI_FORWARD_SHARE)] };
}
