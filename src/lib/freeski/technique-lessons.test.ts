import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { curveEvenness, runTrack } from "./run-track";
import { decodeStandardMotion, motionPointsAt } from "./standard-motion";
import { FAULTS } from "./technique-faults";
import { forces3D, headings, rotationAt, variantPointsAt } from "./technique-forces";
import { LESSONS, LESSON_STEPS } from "./technique-lessons";
import { linkedPath, pathAt, pathForces, pathPose } from "./technique-paths";

const motion = (id: string) => decodeStandardMotion(JSON.parse(readFileSync(join(process.cwd(), "public", "standard-motions", `${id}.json`), "utf8")));
const parallel = motion("demonstration_parallel-l2");

describe("the 3D lessons", () => {
  it("has a lesson, captions and a camera for every step of every problem", () => {
    for (const fault of FAULTS) {
      const lesson = LESSONS[fault.id];
      expect(lesson.id).toBe(fault.id);
      for (const step of LESSON_STEPS) {
        expect(lesson.captions[step][0].length).toBeGreaterThan(8);
        expect(lesson.captions[step][1].length).toBeGreaterThan(8);
        expect(lesson.views[step].elevation).toBeGreaterThan(0);
      }
    }
  });

  it("splits the snow's push between the skis, the outside one taking more", () => {
    const forces = forces3D(parallel, .5, false, "correct");
    expect(forces.skis.left.load + forces.skis.right.load).toBeCloseTo(1, 5);
    expect(forces.outside).toBe("left");
    expect(forces.skis.left.load).toBeGreaterThan(forces.skis.right.load);
    // The push leans into the turn and carries more than the weight across the snow.
    expect(forces.push[2]).toBeGreaterThan(8);
    expect(Math.hypot(...forces.skis.left.force)).toBeCloseTo(Math.hypot(...forces.push) * forces.skis.left.load, 5);
  });

  it("moves the push onto the inside ski when the skier tips in", () => {
    const upright = forces3D(parallel, .5, false, "correct"), tipped = forces3D(parallel, .5, false, "tipping_inside");
    expect(tipped.skis.left.load).toBeLessThan(upright.skis.left.load);
  });

  it("turns a leading upper body before the skis", () => {
    const leading = rotationAt(parallel, .08, false, "upper_body"), standard = rotationAt(parallel, .08, false, "correct");
    expect(Math.abs(leading.chest)).toBeGreaterThan(Math.abs(leading.skis));
    expect(leading.separation).toBeLessThan(standard.separation - 5);
  });

  it("holds the lagging ski on its old edge only through the edge change", () => {
    const moved = (phase: number) => {
      const lagging = variantPointsAt(parallel, phase, false, "edge_lag"), standard = motionPointsAt(parallel, phase, false);
      const k = parallel.index.right_ski_tip_a * 3;
      return Math.hypot(lagging[k] - standard[k], lagging[k + 1] - standard[k + 1], lagging[k + 2] - standard[k + 2]);
    };
    expect(moved(.04)).toBeGreaterThan(.01);
    expect(moved(.6)).toBeLessThan(1e-9);
  });

  it("keeps stiff legs' hips near one height and their bones their length", () => {
    const range = (variant: "correct" | "stiff") => {
      const heights = Array.from({ length: 21 }, (_, i) => {
        const points = variantPointsAt(parallel, i / 20, false, variant), { left_hip: l, right_hip: r } = parallel.index;
        return (points[l * 3 + 2] + points[r * 3 + 2]) / 2;
      });
      return Math.max(...heights) - Math.min(...heights);
    };
    expect(range("stiff")).toBeLessThan(range("correct") * .6);
    const bone = (points: Float64Array, a: string, b: string) => {
      const i = parallel.index[a] * 3, j = parallel.index[b] * 3;
      return Math.hypot(points[i] - points[j], points[i + 1] - points[j + 1], points[i + 2] - points[j + 2]);
    };
    const stiff = variantPointsAt(parallel, .5, false, "stiff"), standard = motionPointsAt(parallel, .5, false);
    expect(bone(stiff, "left_hip", "left_knee")).toBeCloseTo(bone(standard, "left_hip", "left_knee"), 4);
    expect(bone(stiff, "left_knee", "left_ankle")).toBeCloseTo(bone(standard, "left_knee", "left_ankle"), 4);
  });
});

describe("turn shape on the piste", () => {
  const duration = parallel.motion.durationSec;
  const round = linkedPath(parallel, "round", [duration, duration, duration]), z = linkedPath(parallel, "z", [duration, duration, duration]);

  it("pushes much harder sideways in a Z's pivot than anywhere in a round turn", () => {
    expect(z.peakLateral).toBeGreaterThan(round.peakLateral * 1.3);
    expect(round.width).toBeGreaterThan(3);
  });

  it("turns the standard's body to follow the path, hips at the origin", () => {
    const sample = pathAt(round, duration * 1.4), points = pathPose(parallel, sample);
    expect(headings(parallel, points).skis).toBeCloseTo(sample.heading, 1);
    const { left_hip: l, right_hip: r } = parallel.index;
    expect((points[l * 3] + points[r * 3]) / 2).toBeCloseTo(0, 6);
    const feet = pathForces(parallel, points, sample);
    expect(feet.feet[feet.outside].share).toBeGreaterThan(.5);
  });
});

describe("a run's path from the video", () => {
  const smooth = (a: number, b: number, x: number) => { const u = Math.max(0, Math.min(1, (x - a) / (b - a))); return u * u * (3 - 2 * u); };
  const run = (shape: "round" | "z", tilt = 0) => Array.from({ length: 4 * 45 }, (_, i) => {
    const n = Math.floor(i / 45), t = (i % 45) / 45, sign = n % 2 === 0 ? 1 : -1;
    const degrees = shape === "round" ? -50 * Math.cos(Math.PI * t) : -50 * (1 - 2 * smooth(.4, .6, t));
    return { time: (n + t) * 1.5, heading: sign * degrees * Math.PI / 180 + tilt };
  });

  it("finds whole turns between the heading's extremes and tells round turns from Z turns", () => {
    const round = runTrack(run("round"), 10)!, z = runTrack(run("z"), 10)!;
    expect(round.turns.length).toBe(3);
    expect(round.turns.every(turn => turn.evenness > .55)).toBe(true);
    expect(z.turns.every(turn => turn.evenness < .4)).toBe(true);
    expect(Math.max(...z.turns.map(turn => turn.peakRate))).toBeGreaterThan(Math.max(...round.turns.map(turn => turn.peakRate)));
  });

  it("takes a camera's tilt out, so the run goes down the hill", () => {
    const track = runTrack(run("round", .3), 10)!;
    expect(track.bias).toBeCloseTo(.3, 1);
    expect(Math.abs(track.points.at(-1)!.x)).toBeLessThan(track.length * .15);
  });

  it("rates the standard's heading curve like a round turn", () => {
    expect(curveEvenness(parallel.curves.headingDeg)).toBeGreaterThan(.5);
  });
});
