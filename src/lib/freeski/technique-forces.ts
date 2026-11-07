import { motionPointsAt, snowLevelAt, type StandardMotion } from "./standard-motion";

/**
 * Pictures of the forces through a turn and of the common faults, for the movement explanations. Display only:
 * the standard is a generated motion, a fault is the standard with one thing changed, and the forces are the
 * textbook ones for a skier in balance on the standard's arc, not a measurement of the student.
 */

type Vec = [number, number, number];
/** A point or vector in a picture's plane, in metres (or m/s² for a force per kilogram). */
export type Flat = [number, number];
export type Side = "left" | "right";

const add = (a: Vec, b: Vec): Vec => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: Vec, s: number): Vec => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec, b: Vec): Vec => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: Vec): Vec => { const length = Math.hypot(...a) || 1; return [a[0] / length, a[1] / length, a[2] / length]; };
const mean = (points: Vec[]): Vec => scale(points.reduce(add, [0, 0, 0]), 1 / points.length);
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
const smooth = (from: number, to: number, x: number) => { const t = clamp((x - from) / (to - from), 0, 1); return t * t * (3 - 2 * t); };
const other = (side: Side): Side => side === "left" ? "right" : "left";
const DEG = Math.PI / 180;
export const G = 9.81;

/** `p` turned by `angle` about the axis `axis` (a unit vector) through `pivot`. */
function rotate(p: Vec, pivot: Vec, axis: Vec, angle: number): Vec {
  const v = sub(p, pivot), cos = Math.cos(angle), sin = Math.sin(angle), along = dot(axis, v), c = cross(axis, v);
  return add(pivot, [v[0] * cos + c[0] * sin + axis[0] * along * (1 - cos), v[1] * cos + c[1] * sin + axis[1] * along * (1 - cos),
    v[2] * cos + c[2] * sin + axis[2] * along * (1 - cos)]);
}
/** The angle from `a` to `b` about `axis`, both seen across the plane square to it. */
function angleAbout(a: Vec, b: Vec, axis: Vec) {
  const flat = (v: Vec) => sub(v, scale(axis, dot(v, axis)));
  const p = flat(a), q = flat(b);
  return Math.atan2(dot(axis, cross(p, q)), dot(p, q));
}

/** A curve of the motion at a phase, straight between its samples; 0 when the motion has none. */
export function curveAt(motion: StandardMotion, name: string, phase: number): number {
  const curve = motion.curves[name];
  if (!curve?.length) return 0;
  if (curve.length === 1) return curve[0];
  const position = clamp(phase, 0, 1) * (curve.length - 1), i = Math.min(curve.length - 2, Math.floor(position));
  return curve[i] + (curve[i + 1] - curve[i]) * (position - i);
}

export type FaultVariant = "correct" | "upper_body" | "tipping_inside" | "inside_lag" | "flat_edges";

const UPPER = ["nose", "left_eye", "right_eye", "left_ear", "right_ear", "left_shoulder", "right_shoulder", "left_elbow", "right_elbow",
  "left_wrist", "right_wrist", "left_pole_tip", "right_pole_tip"];
const FOOT = ["ankle", "bigtoe", "smalltoe", "heel", "ski_tip_a", "ski_tip_b", "ski_tail_a", "ski_tail_b"];
const CORNERS = ["ski_tip_a", "ski_tip_b", "ski_tail_a", "ski_tail_b"];
/** How far past the skis a leading upper body turns into the turn. */
const LEAD = 12 * DEG;

/** Reads and writes named points of one frame. */
function frameOf(motion: StandardMotion, points: Float64Array) {
  const get = (name: string): Vec => { const k = motion.index[name] * 3; return [points[k], points[k + 1], points[k + 2]]; };
  const set = (name: string, p: Vec) => { const k = motion.index[name] * 3; points[k] = p[0]; points[k + 1] = p[1]; points[k + 2] = p[2]; };
  const mid = (a: string, b: string) => scale(add(get(a), get(b)), .5);
  /** Which way the skis run over the snow: their mean heading, level with the slope. */
  const travel = (): Vec => {
    const heading = (side: string) => sub(get(`${side}_ski_tip_a`), get(`${side}_ski_tail_a`));
    const h = add(heading("left"), heading("right"));
    return unit([h[0], h[1], 0]);
  };
  const ski = (side: Side) => mean(CORNERS.map(part => get(`${side}_${part}`)));
  return { get, set, mid, travel, ski };
}

/** The side whose ski is on the outside of a turn: a right turn's outside ski is the left one. */
export const outsideSide = (mirrored: boolean): Side => mirrored ? "right" : "left";

/** Lower or raise a set of points so the lowest of `corners` sits where it was. */
function keepOnSnow(f: ReturnType<typeof frameOf>, names: string[], corners: string[], before: number) {
  const low = Math.min(...corners.map(name => f.get(name)[2]));
  for (const name of names) { const p = f.get(name); f.set(name, [p[0], p[1], p[2] + before - low]); }
}

/**
 * The standard at a phase of a right turn (`mirrored` for a left one), changed into a fault:
 * - upper_body: the shoulders and arms turn past where the skis point, into the turn, the hips part way;
 * - tipping_inside: the upper body tilts in line with the legs, the hip angle into the turn gone;
 * - inside_lag: the inside lower leg stays more upright, its ski flatter than the outside one;
 * - flat_edges: the whole skier stands up toward the slope's perpendicular, the skis flatter.
 */
export function variantPointsAt(motion: StandardMotion, phase: number, mirrored: boolean, variant: FaultVariant): Float64Array {
  const points = motionPointsAt(motion, phase, mirrored);
  if (variant === "correct") return points;
  const f = frameOf(motion, points), h = f.travel(), pelvis = f.mid("left_hip", "right_hip");
  const outside = outsideSide(mirrored), inside = other(outside);
  if (variant === "upper_body") {
    // The chest faces square to the shoulder line; the outside ski shows where the skis point.
    const shoulders = sub(f.get("right_shoulder"), f.get("left_shoulder"));
    const facing: Vec = [-shoulders[1], shoulders[0], 0], ski = sub(f.get(`${outside}_ski_tip_a`), f.get(`${outside}_ski_tail_a`));
    // A right turn turns clockwise seen from above, so into it is a negative angle about the snow's normal.
    const angle = angleAbout(facing, [ski[0], ski[1], 0], [0, 0, 1]) + (mirrored ? LEAD : -LEAD);
    for (const name of UPPER) f.set(name, rotate(f.get(name), pelvis, [0, 0, 1], angle));
    for (const name of ["left_hip", "right_hip"]) f.set(name, rotate(f.get(name), pelvis, [0, 0, 1], angle * .5));
  } else if (variant === "tipping_inside") {
    const legs = sub(pelvis, f.mid("left_ankle", "right_ankle")), torso = sub(f.mid("left_shoulder", "right_shoulder"), pelvis);
    // Only the sideways tilt, into line with the legs like a stick: the torso keeps its forward lean.
    const angle = angleAbout(torso, legs, h);
    for (const name of UPPER) f.set(name, rotate(f.get(name), pelvis, h, angle));
  } else if (variant === "inside_lag") {
    const knee = f.get(`${inside}_knee`), shin = sub(f.get(`${inside}_ankle`), knee);
    const names = FOOT.map(part => `${inside}_${part}`), corners = CORNERS.map(part => `${inside}_${part}`);
    const before = Math.min(...corners.map(name => f.get(name)[2]));
    const angle = -.55 * angleAbout([0, 0, -1], shin, h);
    for (const name of names) f.set(name, rotate(f.get(name), knee, h, angle));
    keepOnSnow(f, names, corners, before);
  } else if (variant === "flat_edges") {
    const all = Object.keys(motion.index), corners = ["left", "right"].flatMap(side => CORNERS.map(part => `${side}_${part}`));
    const before = Math.min(...corners.map(name => f.get(name)[2]));
    const base: Vec = [...f.mid("left_ankle", "right_ankle").slice(0, 2), 0] as Vec;
    const angle = -.55 * angleAbout([0, 0, 1], sub(pelvis, f.mid("left_ankle", "right_ankle")), h);
    for (const name of all) f.set(name, rotate(f.get(name), base, h, angle));
    keepOnSnow(f, all, corners, before);
  }
  return points;
}

// Shares of body mass by segment, each placed at the middle of its joints (a textbook split, rounded).
const SEGMENTS: [string[], number][] = [
  [["nose", "left_ear", "right_ear"], .07],
  [["left_shoulder", "right_shoulder", "left_hip", "right_hip"], .43],
  [["left_elbow", "right_elbow", "left_wrist", "right_wrist"], .1],
  [["left_hip", "right_hip", "left_knee", "right_knee"], .2],
  [["left_knee", "right_knee", "left_ankle", "right_ankle"], .12],
];

export function centreOfMass(motion: StandardMotion, points: Float64Array): Vec {
  const f = frameOf(motion, points);
  const total = SEGMENTS.reduce((sum, [, share]) => sum + share, 0);
  return scale(SEGMENTS.reduce((sum, [names, share]) => add(sum, scale(mean(names.map(f.get)), share)), [0, 0, 0] as Vec), 1 / total);
}

/**
 * The outside ski's share of the snow's push for a skier in balance: even at the edge change, then mostly on the
 * outside ski from early in the turn through its end, as the guides teach; all of it while the inside ski is lifted.
 */
export function balancedShare(motion: StandardMotion, phase: number) {
  if (curveAt(motion, "insideLiftM", phase) > .03) return 1;
  return .5 + .3 * smooth(0, .3, phase) * (1 - smooth(.85, 1, phase));
}

export type BackView = {
  /** Every point of the motion by its index, seen from behind along the skis: [across, up] in metres, + across toward the skier's right. */
  points: Flat[];
  com: Flat;
  /** Where the snow's push meets the snow: the centre of pressure. */
  cop: Flat;
  /**
   * Per kilogram, in m/s²: gravity, the snow's push, and the part of their sum across the skis' travel, toward the
   * turn's centre: what carries the skier round the arc (the rest of the sum is the body rising and sinking).
   */
  gravity: Flat; push: Flat; turning: Flat;
  /** Each ski's cross-section, drawn wider than a ski so its tilt shows: the end on the snow first. */
  skis: Record<Side, [Flat, Flat]>;
  /** Each ski's share of the push. */
  load: Record<Side, number>;
  outside: Side;
  /**
   * Whether the skis can give the push: "on" the skis; beyond the outside ski, so the skis slide "out" of the arc;
   * beyond the inside ski, so the skier falls "in"; or in the "air".
   */
  holds: "on" | "out" | "in" | "air";
  /** Each ski's tilt off the snow, degrees. */
  edge: Record<Side, number>;
  /** The snow's surface: a point on it and its direction. Gravity points straight down, so a traverse shows the slope falling away. */
  snow: { through: Flat; along: Flat };
};

const STEP = .02;
/** How wide a ski's cross-section is drawn. */
const PLATE = .22;

/**
 * The standard (or a fault) at a phase seen from behind, with the forces. The push is the one a skier in balance needs
 * on the standard's arc, from where the balanced share puts it between the skis through the standard's centre of mass;
 * a fault keeps that push, since the arc is the same, so its own centre of mass moves where the push meets the snow.
 */
export function backView(motion: StandardMotion, phase: number, mirrored: boolean, variant: FaultVariant): BackView {
  const correct = motionPointsAt(motion, phase, mirrored), c = frameOf(motion, correct);
  const points = variant === "correct" ? correct : variantPointsAt(motion, phase, mirrored, variant), f = frameOf(motion, points);
  const h = c.travel(), right: Vec = [h[1], -h[0], 0];
  const outside = outsideSide(mirrored), inside = other(outside), level = snowLevelAt(motion, phase);
  const origin = scale(add(c.ski("left"), c.ski("right")), .5);
  // The plane square to the skis' travel: across, + to the skier's right, and up off the snow.
  const plane = (p: Vec): Flat => [dot(sub(p, origin), right), p[2] - level];

  const slope = motion.motion.pitchDeg * DEG;
  const gravity: Flat = [G * Math.sin(slope) * right[1], -G * Math.cos(slope)];
  const comCorrect = plane(centreOfMass(motion, correct)), skisCorrect = { left: plane(c.ski("left")), right: plane(c.ski("right")) };
  const target = skisCorrect[inside][0] + (skisCorrect[outside][0] - skisCorrect[inside][0]) * balancedShare(motion, phase);
  // Square to the snow the push carries the weight and the body's rise and fall.
  const at = clamp(phase, STEP, 1 - STEP), dt = STEP * motion.motion.durationSec;
  const height = (p: number) => centreOfMass(motion, motionPointsAt(motion, p, mirrored))[2] - snowLevelAt(motion, p);
  const rise = (height(at + STEP) - 2 * height(at) + height(at - STEP)) / (dt * dt);
  const airborne = curveAt(motion, "hopM", phase) > .03;
  const normal = airborne ? 0 : Math.max(0, G * Math.cos(slope) + rise);
  const push: Flat = [normal * (comCorrect[0] - target) / Math.max(.05, comCorrect[1]), normal];

  const com = plane(centreOfMass(motion, points)), skis = { left: plane(f.ski("left")), right: plane(f.ski("right")) };
  const copAcross = normal > 0 ? com[0] - push[0] * com[1] / push[1] : (skis.left[0] + skis.right[0]) / 2;
  const width = skis[outside][0] - skis[inside][0] || 1e-6;
  const share = (copAcross - skis[inside][0]) / width, margin = .05 / Math.abs(width);
  const holds = airborne ? "air" : share > 1 + margin ? "out" : share < -margin ? "in" : "on";
  const onOutside = airborne ? 0 : clamp(share, 0, 1);

  // Turn the picture so gravity points straight down.
  const tilt = Math.atan2(gravity[0], -gravity[1]), cos = Math.cos(-tilt), sin = Math.sin(-tilt);
  const turn = (v: Flat): Flat => [v[0] * cos - v[1] * sin, v[0] * sin + v[1] * cos];
  const plate = (side: Side): [Flat, Flat] => {
    const across = (name: string) => sub(f.get(`${side}_ski_${name}_b`), f.get(`${side}_ski_${name}_a`));
    const d = add(across("tip"), across("tail")), u = [dot(d, right), d[2]], length = Math.hypot(u[0], u[1]) || 1;
    const middle = skis[side], half: Flat = [u[0] / length * PLATE / 2, u[1] / length * PLATE / 2];
    let a: Flat = [middle[0] - half[0], middle[1] - half[1]], b: Flat = [middle[0] + half[0], middle[1] + half[1]];
    const lift = Math.max(0, -Math.min(a[1], b[1]));
    a = [a[0], a[1] + lift]; b = [b[0], b[1] + lift];
    return a[1] <= b[1] ? [turn(a), turn(b)] : [turn(b), turn(a)];
  };
  const edge = (side: Side) => {
    const a = f.get(`${side}_ski_tip_a`), b = f.get(`${side}_ski_tip_b`);
    return Math.atan2(Math.abs(a[2] - b[2]), Math.hypot(a[0] - b[0], a[1] - b[1])) / DEG;
  };
  const flat: Flat[] = [];
  for (let k = 0; k < motion.pointCount; k++) flat.push(turn(plane([points[k * 3], points[k * 3 + 1], points[k * 3 + 2]])));
  return {
    points: flat, com: turn(com), cop: turn([copAcross, 0]), gravity: turn(gravity), push: turn(push),
    turning: turn([push[0] + gravity[0], 0]),
    skis: { left: plate("left"), right: plate("right") }, outside, holds,
    load: outside === "left" ? { left: onOutside, right: airborne ? 0 : 1 - onOutside } : { left: airborne ? 0 : 1 - onOutside, right: onOutside },
    edge: { left: edge("left"), right: edge("right") },
    snow: { through: turn([0, 0]), along: turn([1, 0]) },
  };
}

export type TopView = {
  /** Seen from above with the fall line down the picture: [across, down] in metres, centred between the skis and the shoulders. */
  skis: Record<Side, [Flat, Flat]>;
  hips: [Flat, Flat]; shoulders: [Flat, Flat];
  /** Where the chest faces, and where the skis point, as unit directions. */
  chest: Flat; travel: Flat;
  /**
   * Degrees the chest faces outside of where the skis point: positive is the separation the guides ask for, the upper
   * body facing more down the hill than the skis; negative is the upper body leading into the turn.
   */
  separation: number;
};

/** The standard (or a fault) at a phase seen from above: the skis, hips and shoulders, and how far the chest faces off the skis. */
export function topView(motion: StandardMotion, phase: number, mirrored: boolean, variant: FaultVariant): TopView {
  const f = frameOf(motion, variantPointsAt(motion, phase, mirrored, variant));
  // Leaning into the turn puts the shoulders inside the skis seen from above; centre the picture between them.
  const origin = scale(add(scale(add(f.ski("left"), f.ski("right")), .5), f.mid("left_shoulder", "right_shoulder")), .5);
  // A proper view from above with downhill at the bottom mirrors across: the skier's right shows on the left.
  const flat = (p: Vec): Flat => [-(p[0] - origin[0]), p[1] - origin[1]];
  const ski = (side: Side): [Flat, Flat] => [flat(f.mid(`${side}_ski_tail_a`, `${side}_ski_tail_b`)), flat(f.mid(`${side}_ski_tip_a`, `${side}_ski_tip_b`))];
  const shoulders = sub(f.get("right_shoulder"), f.get("left_shoulder")), facing: Vec = unit([-shoulders[1], shoulders[0], 0]);
  const h = f.travel();
  const separation = angleAbout(h, facing, [0, 0, 1]) / DEG * (mirrored ? -1 : 1);
  return { skis: { left: ski("left"), right: ski("right") }, hips: [flat(f.get("left_hip")), flat(f.get("right_hip"))],
    shoulders: [flat(f.get("left_shoulder")), flat(f.get("right_shoulder"))], chest: [-facing[0], facing[1]], travel: [-h[0], h[1]], separation };
}

export type ShapedPath = {
  /** Over the snow with the fall line down the picture: [across, down] in metres. */
  points: Flat[];
  /** The sideways push each point needs to stay on the path, in m/s², toward the inside of the turn. */
  sideways: number[];
  /** Each point's time, seconds from the start. */
  times: number[];
};

/**
 * Linked turns with the standard's heading swing, speed and duration: "round" turns the heading steadily through the
 * turn; "z" runs straight and turns in a moment at the fall line, without coming as far across the hill.
 */
export function shapedPath(motion: StandardMotion, shape: "round" | "z", turns = 3, steps = 48): ShapedPath {
  const { durationSec: duration, speedMs: speed } = motion.motion;
  const swing = clamp(motion.motion.headingDeg, 15, 75) * DEG * (shape === "z" ? .75 : 1);
  // The heading through one turn, from one side to the other, and how fast it turns (per unit of the turn).
  const heading = (t: number) => shape === "round" ? swing * Math.cos(Math.PI * t) : swing * (1 - 2 * smooth(.35, .65, t));
  const turning = (t: number) => {
    if (shape === "round") return -swing * Math.PI * Math.sin(Math.PI * t);
    const x = clamp((t - .35) / .3, 0, 1);
    return -2 * swing * 6 * x * (1 - x) / .3;
  };
  const points: Flat[] = [[0, 0]], sideways: number[] = [], times: number[] = [0];
  const dt = duration / steps;
  let x = 0, y = 0;
  for (let n = 0; n < turns; n++) {
    const sign = n % 2 === 0 ? 1 : -1;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      if (n > 0 && i === 0) continue;
      if (!(n === 0 && i === 0)) {
        // Midpoint step: the heading half a step back.
        const theta = sign * heading(t - .5 / steps);
        x += speed * Math.sin(theta) * dt; y += speed * Math.cos(theta) * dt;
        points.push([-x, y]); times.push((n + t) * duration);
      }
      sideways.push(Math.abs(speed * turning(t) / duration));
    }
  }
  return { points, sideways: sideways.slice(0, points.length), times };
}

/**
 * Both skis' edge angles across an edge change, from the end of a left turn into a right one, signed: positive on the
 * right turn's edges. `lag` (a share of a turn) holds the old outside ski, the right one, on its old edge that much longer.
 */
export function edgeChange(motion: StandardMotion, lag = 0, span = .45, steps = 60): { t: number; left: number; right: number }[] {
  const signed = (side: Side, t: number) => t >= 0
    ? curveAt(motion, `${side}EdgeDeg`, t)
    : -curveAt(motion, `${other(side)}EdgeDeg`, t + 1);
  return Array.from({ length: steps + 1 }, (_, i) => {
    const t = -span + 2 * span * i / steps;
    return { t, left: signed("left", t), right: signed("right", t - lag) };
  });
}

/** The hips' height through two linked turns, and a stiff skier's: the same middle, a quarter of the travel. */
export function hipTravel(motion: StandardMotion, steps = 48): { t: number; flexing: number; stiff: number }[] {
  const samples = Array.from({ length: 2 * steps + 1 }, (_, i) => {
    const t = i / steps;
    return { t, height: curveAt(motion, "hipHeightM", t <= 1 ? t : t - 1) };
  });
  const middle = samples.reduce((sum, sample) => sum + sample.height, 0) / samples.length;
  return samples.map(({ t, height }) => ({ t, flexing: height, stiff: middle + (height - middle) * .25 }));
}
