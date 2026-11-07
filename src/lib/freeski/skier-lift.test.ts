import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { DecodedPose } from "./report-v2";
import { liftedAt, liftedMarks, liftUserPose } from "./skier-lift";
import { cameraAxes, decodeStandardMotion, fitView, motionPointsAt, projectPoint, type FittedView, type StandardMotion, type StandardMotionId, type ViewCamera } from "./standard-motion";

const folder = join(process.cwd(), "public", "standard-motions");
const load = (id: StandardMotionId): StandardMotion => decodeStandardMotion(JSON.parse(readFileSync(join(folder, `${id}.json`), "utf8")));
const PIXELS_PER_METRE = 350;

/** A student's pose as FreeSki would report it, filmed from a known camera. */
function filmed(motion: StandardMotion, camera: ViewCamera, mirrored: boolean, jitter = 0): DecodedPose {
  const axes = cameraAxes(camera), joints = motion.points.slice(0, 23), start = 10, duration = motion.motion.durationSec;
  const times = Array.from({ length: Math.round(duration * 30) + 1 }, (_, i) => start + i / 30);
  let state = 7;
  const noise = () => { state = (state * 1664525 + 1013904223) % 4294967296; return (state / 4294967296 - .5) * jitter; };
  const frames = times.map(time => {
    const points = motionPointsAt(motion, Math.min(1, (time - start) / duration), mirrored);
    return joints.map((_, k) => {
      const p = projectPoint(points, k, axes);
      return [960 + p[0] * PIXELS_PER_METRE + noise(), 500 + p[1] * PIXELS_PER_METRE + noise(), .9];
    });
  });
  return { times, frames, observed: frames.map(frame => frame.map(() => true)), connections: [], resolution: [1920, 1080], jointNames: joints };
}

const timingOf = (motion: StandardMotion) => ({ start: 10, end: 10 + motion.motion.durationSec, apex: 10 + motion.motion.durationSec * motion.motion.apexPhase, role: "middle" as const });
const named = (lift: { index: Readonly<Record<string, number>> }, frame: ArrayLike<number>, name: string) => {
  const k = lift.index[name] * 3;
  return [frame[k], frame[k + 1], frame[k + 2]];
};
const mid = (a: number[], b: number[]) => a.map((value, c) => (value + b[c]) / 2);
const distance = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

describe("lifting a filmed skier into 3D", () => {
  const motion = load("demonstration_parallel-l3");
  const camera: ViewCamera = { azimuth: 180, elevation: 10, slope: motion.motion.pitchDeg };
  const view: FittedView = { camera, mirrored: false, error: 0 };
  const timing = timingOf(motion);
  const user = filmed(motion, camera, false);
  const lift = liftUserPose(user, motion, view, timing)!;
  const axes = cameraAxes(camera);

  it("keeps what the camera saw: every joint is where the film has it", () => {
    let worst = 0;
    lift.times.forEach((time, s) => {
      const i = user.times.indexOf(time), frame = lift.frames[s];
      const hip = mid(named(lift, frame, "left_hip"), named(lift, frame, "right_hip"));
      const hipPixels = mid(user.frames[i][user.jointNames.indexOf("left_hip")], user.frames[i][user.jointNames.indexOf("right_hip")]);
      for (const name of ["left_knee", "right_knee", "left_ankle", "right_ankle", "left_elbow", "right_wrist", "left_shoulder"]) {
        const j = user.jointNames.indexOf(name), p = named(lift, frame, name), d = [p[0] - hip[0], p[1] - hip[1], p[2] - hip[2]];
        const x = d[0] * axes.right[0] + d[1] * axes.right[1] + d[2] * axes.right[2];
        const y = -(d[0] * axes.up[0] + d[1] * axes.up[1] + d[2] * axes.up[2]);
        worst = Math.max(worst, Math.hypot(x - (user.frames[i][j][0] - hipPixels[0]) / PIXELS_PER_METRE, y - (user.frames[i][j][1] - hipPixels[1]) / PIXELS_PER_METRE));
      }
    });
    expect(worst).toBeLessThan(.02);
  });

  it("recovers the real skier when the prior is the right one", () => {
    let worst = 0;
    lift.times.forEach((time, s) => {
      const phase = (time - 10) / motion.motion.durationSec, truth = motionPointsAt(motion, Math.min(1, phase));
      const frame = lift.frames[s], at = (name: string) => [truth[motion.index[name] * 3], truth[motion.index[name] * 3 + 1], truth[motion.index[name] * 3 + 2]];
      const hip = mid(named(lift, frame, "left_hip"), named(lift, frame, "right_hip")), hipTruth = mid(at("left_hip"), at("right_hip"));
      for (const name of ["left_knee", "right_knee", "left_ankle", "right_ankle", "left_shoulder", "right_shoulder", "left_elbow", "right_elbow"]) {
        const p = named(lift, frame, name), q = at(name);
        worst = Math.max(worst, distance([p[0] - hip[0], p[1] - hip[1], p[2] - hip[2]], [q[0] - hipTruth[0], q[1] - hipTruth[1], q[2] - hipTruth[2]]));
      }
    });
    expect(worst).toBeLessThan(.09);
  });

  it("keeps the bones their length and the ski under the foot", () => {
    for (const frame of lift.frames) {
      const a = (name: string) => named(lift, frame, name);
      expect(distance(a("left_hip"), a("left_knee"))).toBeGreaterThan(.40);
      expect(distance(a("left_hip"), a("left_knee"))).toBeLessThan(.49);
      expect(distance(a("right_knee"), a("right_ankle"))).toBeGreaterThan(.39);
      expect(distance(a("right_knee"), a("right_ankle"))).toBeLessThan(.48);
      expect(distance(a("left_ski_tip_a"), a("left_ski_tail_a"))).toBeCloseTo(1.7, 2);
      // The ankle stays where the boot holds it.
      expect(distance(a("left_ankle"), mid(a("left_ski_tip_a"), a("left_ski_tail_b")))).toBeLessThan(.2);
    }
  });

  it("stands the lower ski on the snow", () => {
    for (const frame of lift.frames) {
      let low = Infinity;
      for (const side of ["left", "right"]) for (const corner of ["tip_a", "tip_b", "tail_a", "tail_b"]) low = Math.min(low, named(lift, frame, `${side}_ski_${corner}`)[2]);
      expect(Math.abs(low)).toBeLessThan(.06);
    }
  });

  it("reads the skis' direction from the feet", () => {
    let worst = 0;
    lift.times.forEach((time, s) => {
      const truth = motionPointsAt(motion, Math.min(1, (time - 10) / motion.motion.durationSec)), frame = lift.frames[s];
      const k = (name: string) => motion.index[name] * 3;
      const wanted = Math.atan2(truth[k("left_ski_tip_a")] - truth[k("left_ski_tail_a")], truth[k("left_ski_tip_a") + 1] - truth[k("left_ski_tail_a") + 1]);
      const tip = named(lift, frame, "left_ski_tip_a"), tail = named(lift, frame, "left_ski_tail_a");
      worst = Math.max(worst, Math.abs(Math.atan2(tip[0] - tail[0], tip[1] - tail[1]) - wanted));
    });
    expect(worst * 180 / Math.PI).toBeLessThan(25);
  });

  it("keeps a parallel pair of skis from crossing when one foot's keypoints swing", () => {
    const swung = filmed(motion, camera, false);
    const heel = swung.jointNames.indexOf("right_heel"), toe = swung.jointNames.indexOf("right_bigtoe");
    // The right toe keypoint jumps sideways by a foot's length, as on a small, blurred skier.
    swung.frames = swung.frames.map((frame, i) => frame.map((point, k) => k === toe && i % 2 === 0 ? [point[0] + (frame[toe][0] - frame[heel][0] > 0 ? -60 : 60), point[1], point[2]] : point));
    const result = liftUserPose(swung, motion, view, timing)!;
    const heading = (frame: ArrayLike<number>, side: string) => {
      const tip = named(result, frame, `${side}_ski_tip_a`), tail = named(result, frame, `${side}_ski_tail_a`);
      return Math.atan2(tip[0] - tail[0], tip[1] - tail[1]);
    };
    for (const frame of result.frames) {
      const gap = heading(frame, "left") - heading(frame, "right");
      expect(Math.abs(Math.atan2(Math.sin(gap), Math.cos(gap))) * 180 / Math.PI).toBeLessThan(12.5);
    }
  });

  it("takes the picture's scale from the bones, so a taller stance looks taller rather than shrunk", () => {
    // The same skier filmed from further away: the same 3D pose comes back.
    const far = filmed(motion, camera, false);
    far.frames = far.frames.map(frame => frame.map(([x, y, c]) => [x * .5, y * .5, c]));
    const small = liftUserPose(far, motion, view, timing)!;
    const a = named(small, small.frames[10], "left_knee"), b = named(lift, lift.frames[10], "left_knee");
    expect(distance(a, b)).toBeLessThan(.02);
  });

  it("stays whole when the film misses the face and a hand", () => {
    const partial = filmed(motion, camera, false);
    const hidden = new Set(["nose", "left_eye", "right_eye", "left_ear", "right_ear", "right_wrist"].map(name => partial.jointNames.indexOf(name)));
    partial.observed = partial.observed.map(row => row.map((seen, k) => seen && !hidden.has(k)));
    const result = liftUserPose(partial, motion, view, timing)!;
    for (const frame of result.frames) for (const value of frame) expect(Number.isFinite(value)).toBe(true);
    const frame = result.frames[12];
    const neck = distance(mid(named(result, frame, "left_ear"), named(result, frame, "right_ear")), mid(named(result, frame, "left_shoulder"), named(result, frame, "right_shoulder")));
    expect(neck).toBeLessThan(.3);
  });

  it("works with another action as its prior, from behind, and when turning the other way", () => {
    const other = load("short_turn-l3");
    const rear: ViewCamera = { azimuth: 12, elevation: 14, slope: other.motion.pitchDeg };
    const film = filmed(other, rear, true, 3);
    const prior = load("demonstration_parallel-l2");
    const timingOther = { start: 10, end: 10 + other.motion.durationSec };
    const fitted = fitView(prior, film, timingOther)!;
    const result = liftUserPose(film, prior, fitted, timingOther)!;
    expect(result).not.toBeNull();
    for (const frame of result.frames) for (const value of frame) expect(Number.isFinite(value)).toBe(true);
    const rearAxes = cameraAxes(fitted.camera), frame = result.frames[6];
    const shoulders = (name: string) => named(result, frame, name);
    const across = (a: number[], b: number[]) => (b[0] - a[0]) * rearAxes.right[0] + (b[1] - a[1]) * rearAxes.right[1] + (b[2] - a[2]) * rearAxes.right[2];
    // From behind the skier's right is on the picture's right.
    expect(across(shoulders("left_shoulder"), shoulders("right_shoulder"))).toBeGreaterThan(0);
  });

  it("is null without a body to lift", () => {
    const empty: DecodedPose = { ...user, observed: user.observed.map(row => row.map(() => false)) };
    expect(liftUserPose(empty, motion, view, timing)).toBeNull();
  });
});

describe("between samples", () => {
  const motion = load("short_turn-l2");
  const camera: ViewCamera = { azimuth: 180, elevation: 10, slope: motion.motion.pitchDeg };
  const lift = liftUserPose(filmed(motion, camera, false), motion, { camera, mirrored: false, error: 0 }, timingOf(motion))!;

  it("moves points in a straight line and holds at both ends", () => {
    const a = lift.frames[3], b = lift.frames[4], middle = liftedAt(lift, (lift.times[3] + lift.times[4]) / 2);
    for (let k = 0; k < a.length; k++) expect(middle.points[k]).toBeCloseTo((a[k] + b[k]) / 2, 8);
    expect(Array.from(liftedAt(lift, -5).points)).toEqual(Array.from(lift.frames[0]));
    expect(Array.from(liftedAt(lift, 999).points)).toEqual(Array.from(lift.frames.at(-1)!));
  });

  it("travels down the slope, the way the skis point", () => {
    const first = lift.snowAt[0], last = lift.snowAt.at(-1)!;
    expect(last[1] - first[1]).toBeGreaterThan(motion.motion.speedMs * motion.motion.durationSec * .5);
  });

  it("marks the snow behind the skis, up to the moment shown", () => {
    const time = lift.times[12], here = liftedAt(lift, time).snowAt;
    const marks = liftedMarks(lift, time, here);
    expect(marks).toHaveLength(2);
    expect(marks[0]).toHaveLength(13);
    // The newest mark is close to the skier, the oldest further up the slope.
    expect(Math.hypot(marks[0][12][0], marks[0][12][1])).toBeLessThan(1.5);
    expect(marks[0][0][1]).toBeLessThan(marks[0][12][1]);
  });
});
