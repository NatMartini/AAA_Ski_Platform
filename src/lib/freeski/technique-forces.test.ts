import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { decodeStandardMotion } from "./standard-motion";
import { backView, balancedShare, edgeChange, hipTravel, shapedPath, topView } from "./technique-forces";

const motion = (id: string) => decodeStandardMotion(JSON.parse(readFileSync(join(process.cwd(), "public", "standard-motions", `${id}.json`), "utf8")));

describe("technique forces", () => {
  const short = motion("short_turn-l2"), apex = short.motion.apexPhase;

  it("balances the standard mostly on the outside ski, the same way in either turn", () => {
    for (const mirrored of [false, true]) {
      const view = backView(short, apex, mirrored, "correct");
      expect(view.holds).toBe("on");
      expect(view.outside).toBe(mirrored ? "right" : "left");
      expect(view.load[view.outside]).toBeCloseTo(balancedShare(short, apex), 2);
      expect(view.load.left + view.load.right).toBeCloseTo(1, 5);
      // The picture turns so gravity points straight down; the snow pushes up off the snow.
      expect(view.gravity[0]).toBeCloseTo(0, 6);
      expect(view.push[1]).toBeGreaterThan(0);
    }
    expect(balancedShare(short, 0)).toBeCloseTo(.5, 5);
    expect(balancedShare(short, 1)).toBeCloseTo(.5, 5);
  });

  it("moves the weight onto the inside ski when the skier tips in", () => {
    for (const mirrored of [false, true]) {
      const good = backView(short, apex, mirrored, "correct"), bad = backView(short, apex, mirrored, "tipping_inside");
      expect(bad.load[bad.outside]).toBeLessThan(good.load[good.outside] - .3);
    }
  });

  it("leaves flat skis unable to hold the arc and the lagging inside ski flatter", () => {
    expect(backView(short, apex, false, "flat_edges").holds).toBe("out");
    const good = backView(short, apex, false, "correct"), lag = backView(short, apex, false, "inside_lag");
    expect(lag.edge.right).toBeLessThan(good.edge.right - 15);
    expect(lag.edge.left).toBeCloseTo(good.edge.left, 5);
  });

  it("shows the chest facing downhill of the skis, and turned into the turn when the upper body leads", () => {
    for (const mirrored of [false, true]) {
      expect(topView(short, .8, mirrored, "correct").separation).toBeGreaterThan(15);
      expect(topView(short, .8, mirrored, "upper_body").separation).toBeLessThan(-5);
    }
  });

  it("needs a much bigger sideways force for a Z turn than for a round one", () => {
    const round = shapedPath(short, "round"), z = shapedPath(short, "z");
    expect(round.sideways).toHaveLength(round.points.length);
    expect(round.times).toHaveLength(round.points.length);
    expect(Math.max(...z.sideways)).toBeGreaterThan(1.8 * Math.max(...round.sideways));
  });

  it("keeps the edges apart longer when one ski changes late, and stiff hips hardly move", () => {
    const opposite = (lag: number) => edgeChange(short, lag).filter(({ left, right }) => Math.abs(left) > 2 && Math.abs(right) > 2 && Math.sign(left) !== Math.sign(right)).length;
    expect(opposite(.12)).toBeGreaterThan(opposite(0) + 3);
    const hips = hipTravel(short), range = (values: number[]) => Math.max(...values) - Math.min(...values);
    expect(range(hips.map(sample => sample.stiff))).toBeCloseTo(range(hips.map(sample => sample.flexing)) * .25, 5);
  });

  it("draws every standard motion without breaking", () => {
    for (const id of ["demonstration_parallel-l1", "braquage-l3", "hop_turn-l3", "javelin-l4", "bumps-l4"]) {
      const m = motion(id);
      for (const phase of [0, .25, m.motion.apexPhase, .9]) {
        const view = backView(m, phase, false, "tipping_inside");
        expect([...view.com, ...view.cop, ...view.push].every(Number.isFinite)).toBe(true);
        expect(view.load.left + view.load.right).toBeLessThanOrEqual(1 + 1e-9);
      }
    }
  });
});
