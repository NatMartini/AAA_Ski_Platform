import { skiMark } from "./skier-rig";
import { motionPointsAt, type StandardMotion } from "./standard-motion";
import { balancedShare, G, headings, type Vec } from "./technique-forces";

/**
 * Linked turns down a slope for the 3D lessons on turn shape and rhythm: the standard's speed and heading swing, turned
 * either steadily ("round") or late and all at once ("z"), each turn as long as asked. Display only: the body is the
 * standard's, turned to follow the path, and the forces are the textbook ones for that path, not a measurement.
 */
export type PathShape = "round" | "z";

export type PathSample = {
  /** Seconds from the start. */
  time: number;
  /** The hips over the snow, metres: across (+ the skier's right looking downhill) and down the fall line. */
  x: number; y: number;
  /** Where the path heads, radians from the fall line, + toward +x. */
  heading: number;
  turn: number; mirrored: boolean;
  /** Progress through the turn, and the standard's phase shown for the body. */
  t: number; phase: number;
  /** The snow's push across the skis' travel, per kilogram (m/s²), toward the turn's centre along `inward`. */
  lateral: number; inward: [number, number];
  /** The snow's push square to the slope, per kilogram. */
  normal: number;
  /** How far the skis point past the path, radians: a pivoted, skidding ski. */
  skid: number;
  /** The outside ski's share of the push. */
  outsideShare: number;
};

export type LinkedPath = { shape: PathShape; samples: PathSample[]; duration: number; width: number; peakLateral: number };

const DEG = Math.PI / 180;
const RATE = 60;
/** Where in a "z" turn the skis are pivoted round: the middle of the turn, about a third of it. */
const PIVOT = [.32, .68] as const;
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
const smooth = (from: number, to: number, x: number) => { const t = clamp((x - from) / (to - from), 0, 1); return t * t * (3 - 2 * t); };
const smoothSlope = (from: number, to: number, x: number) => { const t = clamp((x - from) / (to - from), 0, 1); return 6 * t * (1 - t) / (to - from); };

/** Linked turns, the first a right turn, each lasting `durations[n]` seconds. */
export function linkedPath(motion: StandardMotion, shape: PathShape, durations: readonly number[]): LinkedPath {
  const speed = motion.motion.speedMs, slope = motion.motion.pitchDeg * DEG;
  const swing = clamp(motion.motion.headingDeg, 15, 75) * DEG * (shape === "z" ? .72 : 1);
  // A right turn's heading, from across to the left to across to the right, and its rate per unit of the turn.
  const heading = (t: number) => shape === "round" ? -swing * Math.cos(Math.PI * t) : -swing * (1 - 2 * smooth(PIVOT[0], PIVOT[1], t));
  const turning = (t: number) => shape === "round" ? swing * Math.PI * Math.sin(Math.PI * t) : 2 * swing * smoothSlope(PIVOT[0], PIVOT[1], t);
  const samples: PathSample[] = [];
  let x = 0, y = 0, time = 0;
  durations.forEach((duration, turn) => {
    const mirrored = turn % 2 === 1, sign = mirrored ? -1 : 1, steps = Math.max(8, Math.round(duration * RATE));
    for (let i = turn === 0 ? 0 : 1; i <= steps; i++) {
      const t = i / steps;
      if (samples.length) {
        const middle = sign * heading((i - .5) / steps), dt = duration / steps;
        x += speed * Math.sin(middle) * dt;
        y += speed * Math.cos(middle) * dt;
        time += dt;
      }
      const psi = sign * heading(t), rate = sign * turning(t) / duration;
      // The turn's centre is to the right of the travel while the heading swings right, to the left otherwise.
      const right: [number, number] = [Math.cos(psi), -Math.sin(psi)], inward: [number, number] = sign > 0 ? right : [-right[0], -right[1]];
      // The snow gives what the turn needs beyond what gravity's pull down the slope already gives toward the centre.
      const lateral = speed * Math.abs(rate) - G * Math.sin(slope) * inward[1];
      const phase = shape === "round" ? t : smooth(.3, .7, t);
      const skid = shape === "z" ? sign * 22 * DEG * smooth(PIVOT[0], .5, t) * (1 - smooth(.5, PIVOT[1], t)) : 0;
      samples.push({ time, x, y, heading: psi, turn, mirrored, t, phase, lateral, inward, normal: G * Math.cos(slope), skid, outsideShare: balancedShare(motion, phase) });
    }
  });
  const xs = samples.map(sample => sample.x);
  return { shape, samples, duration: time, width: Math.max(...xs) - Math.min(...xs), peakLateral: Math.max(...samples.map(sample => Math.abs(sample.lateral))) };
}

/** The sample at a time (looping), its place and heading interpolated within its turn. */
export function pathAt(path: LinkedPath, seconds: number): PathSample {
  const { samples } = path, time = ((seconds % path.duration) + path.duration) % path.duration;
  let low = 0, high = samples.length - 1;
  while (low < high) { const middle = Math.ceil((low + high) / 2); if (samples[middle].time <= time) low = middle; else high = middle - 1; }
  const a = samples[low], b = samples[Math.min(samples.length - 1, low + 1)];
  if (b === a || b.turn !== a.turn) return a;
  const k = clamp((time - a.time) / Math.max(1e-6, b.time - a.time), 0, 1), mix = (p: number, q: number) => p + (q - p) * k;
  return { ...a, time, x: mix(a.x, b.x), y: mix(a.y, b.y), heading: mix(a.heading, b.heading), t: mix(a.t, b.t), phase: mix(a.phase, b.phase),
    lateral: mix(a.lateral, b.lateral), skid: mix(a.skid, b.skid), outsideShare: mix(a.outsideShare, b.outsideShare),
    inward: [mix(a.inward[0], b.inward[0]), mix(a.inward[1], b.inward[1])] };
}

/** The standard's body for a sample, turned so its skis point along the path (and past it by the skid), hips at the origin. */
export function pathPose(motion: StandardMotion, sample: PathSample): Float64Array {
  const points = motionPointsAt(motion, sample.phase, sample.mirrored);
  const { left_hip: lh, right_hip: rh } = motion.index;
  const hx = (points[lh * 3] + points[rh * 3]) / 2, hy = (points[lh * 3 + 1] + points[rh * 3 + 1]) / 2;
  // Turning counter-clockwise by alpha takes alpha off a heading measured from the fall line toward +x.
  const alpha = headings(motion, points).skis - (sample.heading + sample.skid), c = Math.cos(alpha), s = Math.sin(alpha);
  for (let k = 0; k < motion.pointCount; k++) {
    const x = points[k * 3] - hx, y = points[k * 3 + 1] - hy;
    points[k * 3] = c * x - s * y;
    points[k * 3 + 1] = s * x + c * y;
  }
  return points;
}

export type PathForces = { feet: Record<"left" | "right", { centre: Vec; force: Vec; share: number }>; outside: "left" | "right" };

/** The snow's push on each ski for a sample, per kilogram, in the pose's coordinates (hips at the origin). */
export function pathForces(motion: StandardMotion, points: Float64Array, sample: PathSample): PathForces {
  const outside = sample.mirrored ? "right" : "left";
  const ski = (side: "left" | "right"): Vec => {
    const corner = (name: string) => motion.index[`${side}_ski_${name}`] * 3;
    const parts = ["tip_a", "tip_b", "tail_a", "tail_b"].map(corner);
    return [0, 1, 2].map(c => parts.reduce((sum, k) => sum + points[k + c], 0) / 4) as Vec;
  };
  const push: Vec = [sample.lateral * sample.inward[0], sample.lateral * sample.inward[1], sample.normal];
  const foot = (side: "left" | "right") => {
    const share = side === outside ? sample.outsideShare : 1 - sample.outsideShare;
    return { centre: ski(side), force: push.map(value => value * share) as Vec, share };
  };
  return { feet: { left: foot("left"), right: foot("right") }, outside };
}

/** Both skis' marks over the whole path, in the path's coordinates, one entry per sample. */
export function pathMarks(motion: StandardMotion, path: LinkedPath) {
  return (["left", "right"] as const).map(side => {
    const tips: [number, number][] = [], tails: [number, number][] = [];
    for (const sample of path.samples) {
      const points = pathPose(motion, sample);
      const corner = (name: string): [number, number] => {
        const a = motion.index[`${side}_ski_${name}_a`] * 3, b = motion.index[`${side}_ski_${name}_b`] * 3;
        return [(points[a] + points[b]) / 2 + sample.x, (points[a + 1] + points[b + 1]) / 2 + sample.y];
      };
      tips.push(corner("tip"));
      tails.push(corner("tail"));
    }
    return skiMark(tips, tails);
  });
}
