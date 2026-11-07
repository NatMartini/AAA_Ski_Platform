import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { bodyHeight, jointCenter, poseAt, type DecodedPose } from "./report-v2";
import { bumpField, cameraAxes, decodeStandardMotion, fitView, motionBones, motionMarks, motionPointsAt, pairedSkiDirections, phaseAt, projectPoint, skiLine, skiSplayLimit, SKI_PER_FOOT, smoothedFootVectors, snowLevelAt,
  standardMotionId, standardPoseForTurn, STANDARD_MOTION_GROUPS, STANDARD_MOTION_IDS, turnPoint, viewName, type StandardMotion, type StandardMotionId, type ViewCamera } from "./standard-motion";

const folder = join(process.cwd(), "public", "standard-motions");
const raw = (id: string) => JSON.parse(readFileSync(join(folder, `${id}.json`), "utf8"));
const library = new Map<string, StandardMotion>();
const load = (id: StandardMotionId) => {
  if (!library.has(id)) library.set(id, decodeStandardMotion(raw(id)));
  return library.get(id)!;
};
const point = (motion: StandardMotion, points: ArrayLike<number>, name: string): [number, number, number] => {
  const k = motion.index[name];
  return [points[k * 3], points[k * 3 + 1], points[k * 3 + 2]];
};
const distance = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const phases = Array.from({ length: 21 }, (_, i) => i / 20);

/** A student's pose as FreeSki would report it, filmed from a known camera. */
function filmed(motion: StandardMotion, camera: ViewCamera, mirrored: boolean, start = 10, duration = motion.motion.durationSec, seed = 1): DecodedPose {
  const axes = cameraAxes(camera), joints = motion.points.slice(0, 23);
  const times = Array.from({ length: Math.round(duration * 30) + 1 }, (_, i) => start + i / 30);
  let state = seed;
  const noise = () => { state = (state * 1664525 + 1013904223) % 4294967296; return state / 4294967296 - .5; };
  const frames = times.map(time => {
    const points = motionPointsAt(motion, (time - start) / duration, mirrored);
    return joints.map((_, k) => {
      const p = projectPoint(points, k, axes);
      return [960 + p[0] * 350 + noise() * 6, 500 + p[1] * 350 + noise() * 6, .9];
    });
  });
  return { times, frames, observed: frames.map(frame => frame.map(() => true)), connections: motionBones(motion).filter(pair => pair.every(k => k < 23)), resolution: [1920, 1080], jointNames: joints };
}

describe("the generated library", () => {
  it("has one file for each action and level the site lists", () => {
    const files = readdirSync(folder).filter(name => name.endsWith(".json") && name !== "index.json").map(name => name.replace(/\.json$/, "")).sort();
    expect(files).toEqual([...STANDARD_MOTION_IDS].sort());
    expect(STANDARD_MOTION_GROUPS.flatMap(group => group.levels.map(level => `${group.action}-l${level}`)).sort()).toEqual([...STANDARD_MOTION_IDS].sort());
    const index = JSON.parse(readFileSync(join(folder, "index.json"), "utf8"));
    expect(index.motions.map((motion: { id: string }) => motion.id).sort()).toEqual([...STANDARD_MOTION_IDS].sort());
  });

  it.each(STANDARD_MOTION_IDS)("%s is one body with real skis, joining the next turn without a seam", id => {
    const motion = load(id);
    const lengths = (a: string, b: string) => phases.map(phase => { const p = motionPointsAt(motion, phase); return distance(point(motion, p, a), point(motion, p, b)); });
    for (const [a, b, metres] of [["left_knee", "left_ankle", .43], ["right_knee", "right_hip", .44], ["left_elbow", "left_wrist", .27], ["right_shoulder", "right_elbow", .29]] as const) {
      for (const length of lengths(a, b)) expect(length).toBeCloseTo(metres, 1);
      expect(Math.max(...lengths(a, b)) - Math.min(...lengths(a, b))).toBeLessThan(.012);
    }
    for (const length of lengths("left_ski_tip_a", "left_ski_tail_a")) expect(length).toBeCloseTo(1.7, 1);
    const end = motionPointsAt(motion, 1), next = motionPointsAt(motion, 0, true);
    const centre = (p: Float64Array) => point(motion, p, "left_ankle").map((v, c) => (v + point(motion, p, "right_ankle")[c]) / 2);
    const [a, b] = [centre(end), centre(next)];
    for (const name of motion.points) {
      const from = point(motion, end, name).map((v, c) => v - a[c]), to = point(motion, next, name).map((v, c) => v - b[c]);
      expect(distance(from, to), name).toBeLessThan(.006);
    }
  });

  it.each(STANDARD_MOTION_IDS)("%s stands the way a skier stands, seen from the side too", id => {
    const motion = load(id);
    const angle = (a: number[], b: number[], c: number[]) => {
      const u = a.map((v, i) => v - b[i]), w = c.map((v, i) => v - b[i]);
      return Math.acos((u[0] * w[0] + u[1] * w[1] + u[2] * w[2]) / (Math.hypot(...u) * Math.hypot(...w))) * 180 / Math.PI;
    };
    for (const phase of phases) {
      const p = motionPointsAt(motion, phase), at = (name: string) => point(motion, p, name);
      for (const side of ["left", "right"]) {
        // Knees and elbows are never locked.
        expect(angle(at(`${side}_hip`), at(`${side}_knee`), at(`${side}_ankle`))).toBeLessThan(157);
        expect(angle(at(`${side}_shoulder`), at(`${side}_elbow`), at(`${side}_wrist`))).toBeLessThan(142);
        // The boot holds the shin forward.
        const tip = [0, 1, 2].map(c => (at(`${side}_ski_tip_a`)[c] + at(`${side}_ski_tip_b`)[c]) / 2), tail = [0, 1, 2].map(c => (at(`${side}_ski_tail_a`)[c] + at(`${side}_ski_tail_b`)[c]) / 2);
        const length = distance(tip, tail), heading = tip.map((v, c) => (v - tail[c]) / length);
        const shin = at(`${side}_knee`).map((v, c) => v - at(`${side}_ankle`)[c]);
        const lean = Math.asin((shin[0] * heading[0] + shin[1] * heading[1] + shin[2] * heading[2]) / Math.hypot(...shin)) * 180 / Math.PI;
        expect(lean, `${side} shin at ${phase}`).toBeGreaterThan(3);
        // Boot, binding and ski are one rigid piece.
        expect(distance(at(`${side}_ankle`), tip)).toBeCloseTo(Math.hypot(.92, .15), 1);
        const pole = distance(at(`${side}_wrist`), at(`${side}_pole_tip`));
        expect(pole).toBeCloseTo(1.2, 2);
        expect(at(`${side}_pole_tip`)[2]).toBeGreaterThan(snowLevelAt(motion, phase) - .25);
      }
      // Hips over the boots.
      const hip = at("left_hip").map((v, c) => (v + at("right_hip")[c]) / 2), ankle = at("left_ankle").map((v, c) => (v + at("right_ankle")[c]) / 2);
      expect(Math.hypot(hip[0] - ankle[0], hip[1] - ankle[1])).toBeLessThan(.75);
    }
  });

  it.each(STANDARD_MOTION_IDS)("%s keeps a ski's low edge on the snow unless the guide lifts it", id => {
    const motion = load(id);
    const lifted = Math.max(...motion.curves.insideLiftM, ...(motion.curves.hopM ?? [0]));
    for (const [i, phase] of phases.entries()) {
      const p = motionPointsAt(motion, phase), level = snowLevelAt(motion, phase);
      const low = Math.min(...["left_ski_tip_a", "left_ski_tip_b", "left_ski_tail_a", "left_ski_tail_b"].map(name => point(motion, p, name)[2]));
      expect(low - level, `phase ${i}`).toBeGreaterThan(-.012);
      if (!lifted) expect(low - level, `phase ${i}`).toBeLessThan(.012);
    }
  });

  it("shades bumps only where the snow really has them", () => {
    expect(bumpField(load("demonstration_parallel-l3"))).toBeNull();
    expect(snowLevelAt(load("demonstration_parallel-l3"), .4)).toBe(0);
    const bumps = load("bumps-l3"), field = bumpField(bumps)!, curve = bumps.curves.snowHeightM;
    expect(field.height).toBeGreaterThan(.1);
    expect(field.spacing).toBeGreaterThan(3);
    // Moguls are metres apart, not a run's long turns.
    expect(field.spacing).toBeLessThan(8);
    expect(Math.max(...curve) - Math.min(...curve)).toBeGreaterThan(.05);
    expect(snowLevelAt(bumps, 0)).toBeCloseTo(curve[0], 3);
    expect(snowLevelAt(bumps, 1)).toBeCloseTo(curve.at(-1)!, 3);
  });

  it("marks the snow where the skis went, wide where they skid and narrow where they carve", () => {
    const widest = (id: StandardMotionId) => Math.max(...motionMarks(load(id), 1, false).flatMap(mark => mark.map(row => row[2])));
    expect(widest("braquage-l3")).toBeGreaterThan(widest("expert_parallel-l4"));
    const [left, right] = motionMarks(load("demonstration_parallel-l3"), .5, false);
    expect(left).toHaveLength(29);
    expect(right).toHaveLength(29);
    // Heading down the slope.
    expect(left[28][1]).toBeGreaterThan(left[0][1]);
  });

  it.each(STANDARD_MOTION_IDS)("%s reads as a pass under FreeSki's own scoring", id => {
    const { verification } = load(id);
    expect(verification.overall).toBeGreaterThanOrEqual(85);
    expect(verification.turnsScored).toBeGreaterThanOrEqual(8);
    // Against other levels' demonstrations a tempo set by that level's guide cannot sit in band.
    expect(verification.shownInBand).toBeGreaterThanOrEqual(verification.shownCount - 1);
    expect(verification.fitRmsBodyHeights).toBeLessThan(.08);
    expect(verification.seamM).toBeLessThan(.01);
  });

  it("keeps skis parallel where the guide says so, and only there do they part", () => {
    const heading = (motion: StandardMotion, phase: number, side: string) => {
      const p = motionPointsAt(motion, phase);
      const tip = point(motion, p, `${side}_ski_tip_a`), tail = point(motion, p, `${side}_ski_tail_a`);
      return Math.atan2(tip[0] - tail[0], tip[1] - tail[1]) * 180 / Math.PI;
    };
    for (const id of ["short_turn-l3", "demonstration_parallel-l3", "expert_parallel-l4", "braquage-l3"] as const) {
      for (const phase of phases) expect(Math.abs(heading(load(id), phase, "left") - heading(load(id), phase, "right")), `${id} at ${phase}`).toBeLessThan(5);
    }
    // Intro to parallel: the skis match below the fall line, not before.
    const intro = load("intro_parallel-l2");
    expect(Math.abs(heading(intro, .5, "left") - heading(intro, .5, "right"))).toBeGreaterThan(10);
    expect(Math.abs(heading(intro, .92, "left") - heading(intro, .92, "right"))).toBeLessThan(5);
    // Javelin: the lifted inside ski stays where it was while the outside ski steers under it, then comes back.
    const javelin = load("javelin-l4");
    expect(Math.abs(heading(javelin, .6, "left") - heading(javelin, .6, "right"))).toBeGreaterThan(12);
    expect(Math.abs(heading(javelin, .98, "left") - heading(javelin, .98, "right"))).toBeLessThan(5);
  });

  it("gives each special run the movement that defines it", () => {
    const javelin = load("javelin-l4"), hop = load("hop_turn-l3"), braquage = load("braquage-l3"), bumps = load("bumps-l3");
    expect(Math.max(...javelin.curves.insideLiftM)).toBeGreaterThan(.15);
    expect(javelin.curves.insideLiftM[0]).toBeLessThan(.02);
    expect(Math.max(...hop.curves.hopM)).toBeGreaterThan(.05);
    expect(hop.curves.hopM[10]).toBe(0);
    // Braquage: the skis swing, the centre of mass goes down the fall line without an arc.
    expect(braquage.motion.turnWidthM).toBeLessThan(1);
    expect(braquage.motion.headingDeg).toBeGreaterThan(20);
    // Bumps: the legs absorb what the snow does.
    expect(Math.max(...bumps.curves.snowHeightM) - Math.min(...bumps.curves.snowHeightM)).toBeGreaterThan(.1);
    expect(raw("hop_turn-l4").verification.otherLevel).toBe(true);
  });
});

describe("which standard a report compared with", () => {
  const calibration = (target: string | null) => ({ reference_generation: "g", reference_clip_count: 38, matched_reference_count: 1, reference_target: target }) as never;
  it("follows the example set the score card names", () => {
    expect(standardMotionId({ action: "short_turn", level: "level3", calibration: calibration("level3") })).toBe("short_turn-l3");
    expect(standardMotionId({ action: "demonstration_parallel", level: null, calibration: calibration("level4") })).toBe("demonstration_parallel-l4");
    expect(standardMotionId({ action: "demonstration_parallel", level: null, calibration: calibration("advanced") })).toBe("demonstration_parallel-l3");
    expect(standardMotionId({ action: "short_turn", level: null, calibration: calibration("expert") })).toBe("short_turn-l4");
    expect(standardMotionId({ action: "carving", level: null, calibration: calibration("expert") })).toBe("expert_parallel-l4");
    expect(standardMotionId({ action: "carving", level: null, calibration: calibration("level3") })).toBe("advanced_parallel-l3");
    expect(standardMotionId({ action: "javelin", level: "level4", calibration: calibration(null) })).toBe("javelin-l4");
  });
  it("offers nothing rather than a wrong motion", () => {
    expect(standardMotionId({ action: "short_turn", level: null, calibration: calibration(null) })).toBeNull();
    expect(standardMotionId({ action: "white_pass", level: "level4", calibration: calibration("level4") })).toBeNull();
    expect(standardMotionId({ action: "javelin", level: "level2", calibration: calibration("level2") })).toBeNull();
  });
});

describe("timing to a student's turn", () => {
  const motion = { motion: { durationSec: 2, apexPhase: .4 } } as StandardMotion;
  it("maps edge change to edge change and apex to apex", () => {
    const timing = { start: 10, end: 11, apex: 10.75, role: "middle" as const };
    expect(phaseAt(10, timing, motion)).toBe(0);
    expect(phaseAt(10.75, timing, motion)).toBeCloseTo(.4);
    expect(phaseAt(11, timing, motion)).toBeCloseTo(1);
    expect(phaseAt(10.375, timing, motion)).toBeCloseTo(.2);
    expect(phaseAt(10.5, { start: 10, end: 11 }, motion)).toBeCloseTo(.5);
  });
  it("runs a start or end part at the standard's own pace from its one real edge change", () => {
    expect(phaseAt(11, { start: 5, end: 11, role: "start" }, motion)).toBe(1);
    expect(phaseAt(10, { start: 5, end: 11, role: "start" }, motion)).toBeCloseTo(.5);
    expect(phaseAt(6, { start: 5, end: 11, role: "start" }, motion)).toBe(0);
    expect(phaseAt(5, { start: 5, end: 11, role: "end" }, motion)).toBe(0);
    expect(phaseAt(6, { start: 5, end: 11, role: "end" }, motion)).toBeCloseTo(.5);
    expect(phaseAt(9, { start: 5, end: 11, role: "end" }, motion)).toBe(1);
  });
});

describe("a filmed pair of skis", () => {
  const angle = (v: [number, number] | null) => Math.atan2(v![1], v![0]);
  const unit = (radians: number, length = 1): [number, number] => [Math.cos(radians) * length, Math.sin(radians) * length];

  it("pulls skis that point too far apart back toward their mean, keeping each one's length", () => {
    const paired = pairedSkiDirections(unit(.5), unit(-.1, 2), 12);
    expect((angle(paired.left) - angle(paired.right)) * 180 / Math.PI).toBeCloseTo(12);
    expect((angle(paired.left) + angle(paired.right)) / 2).toBeCloseTo(.2);
    expect(Math.hypot(...paired.right!)).toBeCloseTo(2);
  });

  it("leaves a plausible pair and a lone ski alone, and lets a wedge or a javelin turn spread further", () => {
    expect(pairedSkiDirections(unit(.1), unit(0), 12)).toEqual({ left: unit(.1), right: unit(0) });
    expect(pairedSkiDirections(unit(.6), null, 12)).toEqual({ left: unit(.6), right: null });
    expect([skiSplayLimit("short_turn"), skiSplayLimit("intro_parallel"), skiSplayLimit("javelin")]).toEqual([12, 25, 40]);
  });

  it("reads a pair pointing opposite ways as one foot's heel and toe swapped", () => {
    const paired = pairedSkiDirections(unit(0, 2), unit(Math.PI - .05), 12);
    expect(angle(paired.right)).toBeCloseTo(0);
    expect(Math.hypot(...paired.right!)).toBeCloseTo(1);
  });
});

describe("matching the student's camera", () => {
  const near = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);
  it.each([
    ["short_turn-l2", 180, false], ["short_turn-l2", 180, true], ["short_turn-l2", 0, true], ["demonstration_parallel-l3", 180, true],
    ["demonstration_parallel-l3", 0, false], ["expert_parallel-l4", 200, false], ["braquage-l3", 10, true], ["javelin-l4", 170, true],
  ] as const)("finds %s filmed from azimuth %i, mirrored %s", (id, azimuth, mirrored) => {
    const motion = load(id);
    const user = filmed(motion, { azimuth, elevation: 8, slope: motion.motion.pitchDeg }, mirrored);
    const view = fitView(motion, user, { start: 10, end: 10 + motion.motion.durationSec, apex: 10 + motion.motion.apexPhase * motion.motion.durationSec, role: "middle" });
    expect(view).not.toBeNull();
    expect(view!.mirrored).toBe(mirrored);
    expect(near(view!.camera.azimuth, azimuth)).toBeLessThan(25);
    expect(view!.error).toBeLessThan(.01);
  });

  it.each([["short_turn-l2", .3, false], ["short_turn-l2", .5, true], ["demonstration_parallel-l3", .4, false]] as const)(
    "finds %s's edge change at %s of a window that runs from one turn's deepest lean to the next", (id, share, mirrored) => {
      const motion = load(id), duration = motion.motion.durationSec, camera = { azimuth: 190, elevation: 8, slope: motion.motion.pitchDeg };
      // Filmed as two runs of the standard joined at the edge change: the end of the turn before, then this turn.
      const before = filmed(motion, camera, !mirrored, 10 - (1 - share) * duration, duration);
      const after = filmed(motion, camera, mirrored, 10 + share * duration, duration);
      const edge = 10 + share * duration, start = 10, end = 10 + duration;
      const keep = (pose: DecodedPose, from: number, to: number) => pose.times.flatMap((time, i) => time >= from && time < to ? [i] : []);
      const a = keep(before, start, edge), b = keep(after, edge, end + .001);
      const user: DecodedPose = { ...after, times: [...a.map(i => before.times[i]), ...b.map(i => after.times[i])],
        frames: [...a.map(i => before.frames[i]), ...b.map(i => after.frames[i])], observed: [...a.map(i => before.observed[i]), ...b.map(i => after.observed[i])] };
      const view = fitView(motion, user, { start, end, role: "middle" })!;
      expect(view.mirrored).toBe(mirrored);
      expect(Math.abs((view.edge! - edge) / duration)).toBeLessThan(.08);
      // Before the edge change the standard is in the turn before, the other way round.
      expect(turnPoint(phaseAt(start + .02, { start, end, edge: view.edge }, motion), view.mirrored).mirrored).toBe(!mirrored);
      expect(turnPoint(phaseAt(end - .02, { start, end, edge: view.edge }, motion), view.mirrored).mirrored).toBe(mirrored);
    });

  it("takes an edge change FreeSki measured as it is and fits only the camera and direction around it", () => {
    const motion = load("short_turn-l2"), duration = motion.motion.durationSec;
    const user = filmed(motion, { azimuth: 190, elevation: 8, slope: motion.motion.pitchDeg }, true);
    const view = fitView(motion, user, { start: 10, end: 10 + duration, role: "middle", edge: 10 + .4 * duration })!;
    expect(view.edge).toBeCloseTo(10 + .4 * duration);
  });

  it("keeps a window that does run edge change to edge change", () => {
    const motion = load("short_turn-l2");
    const user = filmed(motion, { azimuth: 190, elevation: 8, slope: motion.motion.pitchDeg }, true);
    expect(fitView(motion, user, { start: 10, end: 10 + motion.motion.durationSec, role: "middle" })!.edge ?? null).toBeNull();
  });

  it("shows the standard at the student's hips and height, on the student's clock", () => {
    const motion = load("short_turn-l3");
    const other = load("short_turn-l2");
    const user = filmed(other, { azimuth: 180, elevation: 8, slope: 16 }, false, 20, 1.5);
    const timing = { start: 20, end: 21.5, role: "middle" as const };
    const view = fitView(motion, user, timing)!;
    const pose = standardPoseForTurn(motion, user, timing, view)!;
    expect(viewName(view.camera.azimuth)).toBe("front");
    expect(view.mirrored).toBe(false);
    expect(pose.times[0]).toBe(20);
    expect(pose.times.at(-1)).toBeCloseTo(21.5);
    expect(pose.jointNames).toContain("left_ski_tip_a");
    expect(pose.jointNames).toContain("right_pole_tip");
    expect(bodyHeight(pose)! / bodyHeight(user)!).toBeCloseTo(1, 1);
    for (const time of [20.2, 20.75, 21.3]) {
      const a = jointCenter(pose, poseAt(pose, time), "left_hip", "right_hip")!, b = jointCenter(user, poseAt(user, time), "left_hip", "right_hip")!;
      expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeLessThan(4);
    }
    expect(pose.nearLeft).toHaveLength(pose.times.length);
    expect(pose.facing.every(Boolean)).toBe(true);
  });

  it("names the view for the student", () => {
    expect([180, 150, 220, 0, 30, 340, 90, 270].map(viewName)).toEqual(["front", "front", "front", "rear", "rear", "rear", "side", "side"]);
  });

  it("gives up on a pose with no usable body", () => {
    const motion = load("short_turn-l2");
    const user = filmed(motion, { azimuth: 180, elevation: 8, slope: 16 }, false);
    const blind = { ...user, observed: user.observed.map(frame => frame.map(() => false)) };
    expect(fitView(motion, blind, { start: 10, end: 11 })).toBeNull();
  });
});

describe("a filmed skier's skis", () => {
  const pose: DecodedPose = {
    times: [0, 1 / 30, 2 / 30], connections: [], resolution: [1920, 1080], jointNames: ["left_heel", "left_bigtoe"],
    observed: [[true, true], [true, true], [true, true]],
    frames: [[[100, 100, 1], [130, 100, 1]], [[100, 100, 1], [160, 100, 1]], [[100, 100, 1], [130, 100, 1]]],
  };
  it("averages the foot's direction, because small feet are noisy and skis are stiff", () => {
    const vectors = smoothedFootVectors(pose, "left");
    expect(vectors[1]![0]).toBeCloseTo(40);
    expect(smoothedFootVectors({ ...pose, jointNames: ["x", "y"] }, "left")).toEqual([null, null, null]);
  });
  it("is as long as a ski compared with the foot, within the longest it can look", () => {
    const sample = { frame: pose.frames[0], observed: [true, true] };
    const ski = skiLine(pose, sample, "left", [30, 0], 10000)!;
    expect(ski.tip[0] - ski.tail[0]).toBeCloseTo(30 * SKI_PER_FOOT);
    expect(ski.tip[0]).toBeGreaterThan(130);
    expect(ski.tail[0]).toBeLessThan(100);
    const capped = skiLine(pose, sample, "left", [30, 0], 100)!;
    expect(capped.tip[0] - capped.tail[0]).toBeCloseTo(100);
    expect(skiLine(pose, sample, "left", null, 100)).toBeNull();
    expect(skiLine(pose, sample, "right", [30, 0], 100)).toBeNull();
  });
});
