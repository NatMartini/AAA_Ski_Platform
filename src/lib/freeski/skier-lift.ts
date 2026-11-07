import { bodyHeight, type DecodedPose } from "./report-v2";
import { skiMark } from "./skier-rig";
import { cameraAxes, phaseAt, skiSplayLimit, smoothedFootVectors, standardHeight, turnPointsAt, type FittedView, type StandardMotion, type TurnTiming } from "./standard-motion";

/**
 * A filmed skier lifted out of the picture, so the same 3D person can stand in for them, for display only.
 * The picture fixes where every joint is across and up. Only depth is worked out: each bone keeps its length,
 * which says how far it points toward or away from the camera, and the standard at the same moment of the
 * turn says which of the two. Seen from the camera the lifted skier therefore matches what was filmed.
 */
export type LiftedPose = {
  times: number[];
  /** Per sample, xyz per point: slope coordinates, hips above the origin, snow at z = 0. */
  frames: Float64Array[];
  index: Readonly<Record<string, number>>;
  /** Where on the mountain the hips would be, so the snow passes under them the way the skis point. */
  snowAt: [number, number][];
};

type Vec = [number, number, number];
const SIDES = ["left", "right"] as const;
const JOINTS = ["nose", "left_eye", "right_eye", "left_ear", "right_ear", "left_shoulder", "right_shoulder", "left_elbow", "right_elbow", "left_wrist", "right_wrist",
  "left_hip", "right_hip", "left_knee", "right_knee", "left_ankle", "right_ankle", "left_bigtoe", "left_smalltoe", "left_heel", "right_bigtoe", "right_smalltoe", "right_heel"];
const SKI_CORNERS = ["ski_tip_a", "ski_tip_b", "ski_tail_a", "ski_tail_b"];
const POINTS = [...JOINTS, ...SIDES.flatMap(side => SKI_CORNERS.map(corner => `${side}_${corner}`))];
const INDEX = Object.fromEntries(POINTS.map((name, i) => [name, i]));

// Parents before children. "hips", "shoulders" and "head" are the middles of the two joints beside them.
const BONES: readonly (readonly [string, string])[] = [["left_hip", "hips"], ["right_hip", "hips"], ["left_knee", "left_hip"], ["left_ankle", "left_knee"], ["right_knee", "right_hip"],
  ["right_ankle", "right_knee"], ["shoulders", "hips"], ["left_shoulder", "shoulders"], ["right_shoulder", "shoulders"], ["left_elbow", "left_shoulder"], ["left_wrist", "left_elbow"],
  ["right_elbow", "right_shoulder"], ["right_wrist", "right_elbow"], ["head", "shoulders"]];
const MIDDLES: Readonly<Record<string, readonly [string, string]>> = { hips: ["left_hip", "right_hip"], shoulders: ["left_shoulder", "right_shoulder"], head: ["left_ear", "right_ear"] };
const HEAD_POINTS = ["nose", "left_eye", "right_eye", "left_ear", "right_ear"];

// The rigid boot and ski, as in scripts/standard-motion/skier_model.py.
const ANKLE_HEIGHT = .15, ANKLE_BACK = .02, HEEL_BACK = .09, TOE_FRONT = .16, SKI_FORWARD = .9, SKI_BACK = .8, SKI_HALF = .045, FOOT_LENGTH = HEEL_BACK + TOE_FRONT, MAX_ROLL = 1.25;

// A limb looks its full length at some point in a turn, so its longest look against its real length gives the picture's
// scale. Limbs can only look shorter than they are, so the limbs that give a small scale are the ones to trust; not the
// very smallest, which a close camera or a stray keypoint inflates. Filmed turns put the answer within about 15% below
// to 25% above what the standard's height would say.
const SCALE_BONES: readonly (readonly [string, string])[] = [["left_hip", "left_knee"], ["right_hip", "right_knee"], ["left_knee", "left_ankle"], ["right_knee", "right_ankle"],
  ["left_shoulder", "left_elbow"], ["right_shoulder", "right_elbow"], ["left_elbow", "left_wrist"], ["right_elbow", "right_wrist"]];

const SMOOTH = [1, 2, 3, 2, 1];

function smoothed(values: readonly number[]) {
  return values.map((_, i) => {
    let total = 0, weight = 0;
    SMOOTH.forEach((w, k) => {
      const j = i + k - 2;
      if (j >= 0 && j < values.length) { total += values[j] * w; weight += w; }
    });
    return total / weight;
  });
}

/**
 * How far a bone points away from the camera in each sample: its size is fixed by its length and how long it
 * looks; its sign follows the prior, without flipping back and forth when the bone lies across the picture.
 */
function boneDepths(lengths: readonly number[], length: number, prior: readonly number[]) {
  const size = lengths.map(seen => Math.sqrt(Math.max(length * length - seen * seen, 0)));
  const count = size.length;
  const cost = [[0, 0]];
  const from: number[][] = [[0, 0]];
  for (let i = 0; i < count; i++) {
    const row = [0, 0], back = [0, 0];
    for (const sign of [0, 1]) {
      const z = sign ? size[i] : -size[i], own = (z - prior[i]) ** 2;
      if (i === 0) { row[sign] = own; continue; }
      const previous = [-size[i - 1], size[i - 1]].map((before, k) => cost[i][k] + 3 * (z - before) ** 2);
      back[sign] = previous[1] < previous[0] ? 1 : 0;
      row[sign] = own + previous[back[sign]];
    }
    cost.push(row);
    from.push(back);
  }
  const out = new Array<number>(count);
  let sign = cost[count][1] < cost[count][0] ? 1 : 0;
  for (let i = count - 1; i >= 0; i--) {
    out[i] = sign ? size[i] : -size[i];
    sign = from[i + 1][sign];
  }
  return smoothed(out);
}

export function liftUserPose(user: DecodedPose, motion: StandardMotion, view: FittedView, timing: TurnTiming): LiftedPose | null {
  const height = bodyHeight(user);
  if (!height) return null;
  const axes = cameraAxes(view.camera);
  const dot = (a: readonly number[], b: readonly number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const margin = .3;
  const samples = user.times.flatMap((time, i) => time >= timing.start - margin && time <= timing.end + margin ? [i] : []);
  if (samples.length < 2) return null;
  const times = samples.map(i => user.times[i]);
  const phases = times.map(time => phaseAt(time, timing, motion));
  const priors = phases.map(phase => turnPointsAt(motion, phase, view.mirrored));
  const byHeight = standardHeight(motion, phases, view.mirrored, axes) / height;
  const ratios = SCALE_BONES.flatMap(([a, b]) => {
    const i = user.jointNames.indexOf(a), j = user.jointNames.indexOf(b), ka = motion.index[a] * 3, kb = motion.index[b] * 3;
    if (i < 0 || j < 0) return [];
    const looks = samples.flatMap(sample => user.observed[sample][i] && user.observed[sample][j] && user.frames[sample][i][2] >= .3 && user.frames[sample][j][2] >= .3
      ? [Math.hypot(user.frames[sample][i][0] - user.frames[sample][j][0], user.frames[sample][i][1] - user.frames[sample][j][1])] : []).sort((p, q) => p - q);
    if (looks.length < 5) return [];
    return [Math.hypot(priors[0][ka] - priors[0][kb], priors[0][ka + 1] - priors[0][kb + 1], priors[0][ka + 2] - priors[0][kb + 2]) / looks[Math.floor(looks.length * .9)]];
  }).sort((p, q) => p - q);
  const scale = ratios.length >= 3 ? Math.max(byHeight * .85, Math.min(byHeight * 1.25, ratios[2])) : byHeight;

  const prior3D = (name: string, s: number): Vec => {
    const middle = MIDDLES[name];
    if (middle) {
      const a = prior3D(middle[0], s), b = prior3D(middle[1], s);
      return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
    }
    const k = motion.index[name];
    return [priors[s][k * 3], priors[s][k * 3 + 1], priors[s][k * 3 + 2]];
  };
  const priorDelta = (child: string, parent: string, s: number) => {
    const a = prior3D(child, s), b = prior3D(parent, s), d: Vec = [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    return { x: dot(d, axes.right), y: dot(d, axes.up), z: dot(d, axes.forward) };
  };

  // Picture metres relative to the hips, x right and y up, per sample.
  const picture = (name: string, s: number): [number, number] | null => {
    const i = samples[s], k = user.jointNames.indexOf(name);
    if (k < 0 || !user.observed[i][k] || user.frames[i][k][2] < .3) return null;
    return [user.frames[i][k][0], user.frames[i][k][1]];
  };
  const middlePicture = (name: string, s: number) => {
    const [a, b] = MIDDLES[name], pa = picture(a, s), pb = picture(b, s);
    return pa && pb ? [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2] as [number, number] : null;
  };
  // Where the hips are not seen, the last place they were: the rest of the body is kept relative to them.
  const hipPixels: ([number, number] | null)[] = samples.map((_, s) => middlePicture("hips", s));
  const firstHip = hipPixels.find(Boolean);
  if (!firstHip) return null;
  let lastHip: [number, number] = firstHip;
  const flat = (x: number, y: number, s: number): [number, number] => {
    const hip = hipPixels[s] ?? lastHip;
    return [(x - hip[0]) * scale, -(y - hip[1]) * scale];
  };

  const xy: Record<string, [number, number][]> = { hips: samples.map(() => [0, 0]) };
  const depth: Record<string, number[]> = { hips: samples.map(() => 0) };
  for (const [child, parent] of BONES) {
    const length = (() => { const a = prior3D(child, 0), b = prior3D(parent, 0); return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]); })();
    const row: [number, number][] = [];
    samples.forEach((_, s) => {
      lastHip = hipPixels[s] ?? lastHip;
      const seen = MIDDLES[child] ? middlePicture(child, s) : picture(child, s);
      if (seen) {
        const at = flat(seen[0], seen[1], s);
        // Nothing stretches a neck: a head further than it can be comes back along the neck.
        const dx = at[0] - xy[parent][s][0], dy = at[1] - xy[parent][s][1], seenLength = Math.hypot(dx, dy);
        row.push(child === "head" && seenLength > length ? [xy[parent][s][0] + dx / seenLength * length, xy[parent][s][1] + dy / seenLength * length] : at);
      } else {
        // Unseen: where the standard has it relative to its parent.
        const d = priorDelta(child, parent, s);
        row.push([xy[parent][s][0] + d.x, xy[parent][s][1] + d.y]);
      }
    });
    xy[child] = row;
    const dz = boneDepths(row.map((p, s) => Math.hypot(p[0] - xy[parent][s][0], p[1] - xy[parent][s][1])), length, samples.map((_, s) => priorDelta(child, parent, s).z));
    depth[child] = dz.map((z, s) => depth[parent][s] + z);
  }

  const world = (x: number, y: number, z: number): Vec => [
    x * axes.right[0] + y * axes.up[0] + z * axes.forward[0],
    x * axes.right[1] + y * axes.up[1] + z * axes.forward[1],
    x * axes.right[2] + y * axes.up[2] + z * axes.forward[2]];
  const placed = (name: string, s: number) => world(xy[name][s][0], xy[name][s][1], depth[name][s]);

  // Which way each foot points on the snow. The foot's picture length gives its depth, like a bone.
  const footVectors = { left: smoothedFootVectors(user, "left"), right: smoothedFootVectors(user, "right") };
  const headings: Record<(typeof SIDES)[number], number[]> = { left: [], right: [] };
  for (const side of SIDES) {
    const tip = motion.index[`${side}_ski_tip_a`], tail = motion.index[`${side}_ski_tail_a`];
    const priorFlat = samples.map((_, s) => [priors[s][tip * 3] - priors[s][tail * 3], priors[s][tip * 3 + 1] - priors[s][tail * 3 + 1], 0]);
    const seen = samples.map((i): [number, number] => {
      const foot = footVectors[side][i];
      return foot ? [foot[0] * scale, -foot[1] * scale] : [NaN, NaN];
    });
    const dz = boneDepths(seen.map(f => Number.isNaN(f[0]) ? FOOT_LENGTH : Math.hypot(f[0], f[1])), FOOT_LENGTH, priorFlat.map(d => dot(d, axes.forward) / Math.hypot(d[0], d[1]) * FOOT_LENGTH));
    const angles = seen.map((f, s) => {
      const d = Number.isNaN(f[0]) ? priorFlat[s] : world(f[0], f[1], dz[s]);
      return Math.atan2(d[0], d[1]);
    });
    // Unwrapped, then smoothed: a ski is stiff and a small foot's keypoints are noisy.
    for (let s = 1; s < angles.length; s++) angles[s] = angles[s - 1] + Math.atan2(Math.sin(angles[s] - angles[s - 1]), Math.cos(angles[s] - angles[s - 1]));
    headings[side] = smoothed(smoothed(angles));
  }
  // Even smoothed, one noisy foot swings its ski past the other: the action says how far apart a pair may point.
  const splay = skiSplayLimit(motion.action) * Math.PI / 180;
  headings.left.forEach((left, s) => {
    const right = headings.right[s], gap = Math.atan2(Math.sin(left - right), Math.cos(left - right));
    const mean = right + gap / 2, half = Math.max(-splay, Math.min(splay, gap)) / 2;
    headings.left[s] = mean + half;
    headings.right[s] = mean - half;
  });

  const frames = samples.map((_, s) => {
    const frame = new Float64Array(POINTS.length * 3);
    const put = (name: string, p: readonly number[]) => { const k = INDEX[name]; frame[k * 3] = p[0]; frame[k * 3 + 1] = p[1]; frame[k * 3 + 2] = p[2]; };
    for (const name of ["left_shoulder", "right_shoulder", "left_elbow", "right_elbow", "left_wrist", "right_wrist", "left_hip", "right_hip", "left_knee", "right_knee", "left_ankle", "right_ankle"]) put(name, placed(name, s));
    // The head is rigid: seen points where there are any, the standard's depth around the head's middle.
    const head = { x: xy.head[s][0], y: xy.head[s][1], z: depth.head[s] };
    for (const name of HEAD_POINTS) {
      const d = priorDelta(name, "head", s), seen = picture(name, s);
      lastHip = hipPixels[s] ?? lastHip;
      const inPicture = seen ? flat(seen[0], seen[1], s) : [head.x + d.x, head.y + d.y];
      put(name, world(inPicture[0], inPicture[1], head.z + d.z));
    }
    return frame;
  });

  // Skis under the ankles, rolled with the shins, and the snow under the lower ski.
  const lowest = samples.map((_, s) => {
    let low = Infinity;
    for (const side of SIDES) {
      const psi = headings[side][s], h: Vec = [Math.sin(psi), Math.cos(psi), 0], x: Vec = [Math.cos(psi), -Math.sin(psi), 0];
      const k = placed(`${side}_knee`, s), a = placed(`${side}_ankle`, s);
      const shin = [k[0] - a[0], k[1] - a[1], k[2] - a[2]];
      const roll = Math.max(-MAX_ROLL, Math.min(MAX_ROLL, Math.atan2(dot(shin, x), Math.max(shin[2], 1e-6))));
      const n: Vec = [x[0] * Math.sin(roll), x[1] * Math.sin(roll), Math.cos(roll)], across: Vec = [x[0] * Math.cos(roll), x[1] * Math.cos(roll), -Math.sin(roll)];
      const base: Vec = [a[0] - n[0] * ANKLE_HEIGHT + h[0] * ANKLE_BACK, a[1] - n[1] * ANKLE_HEIGHT + h[1] * ANKLE_BACK, a[2] - n[2] * ANKLE_HEIGHT + h[2] * ANKLE_BACK];
      const outer = side === "left" ? -1 : 1;
      const at = (forward: number, sideways: number, up: number): Vec => [
        base[0] + h[0] * forward + across[0] * sideways + n[0] * up, base[1] + h[1] * forward + across[1] * sideways + n[1] * up, base[2] + h[2] * forward + across[2] * sideways + n[2] * up];
      const frame = frames[s], put = (name: string, p: Vec) => { const j = INDEX[name]; frame[j * 3] = p[0]; frame[j * 3 + 1] = p[1]; frame[j * 3 + 2] = p[2]; };
      put(`${side}_ski_tip_a`, at(SKI_FORWARD, outer * SKI_HALF, 0));
      put(`${side}_ski_tip_b`, at(SKI_FORWARD, -outer * SKI_HALF, 0));
      put(`${side}_ski_tail_a`, at(-SKI_BACK, outer * SKI_HALF, 0));
      put(`${side}_ski_tail_b`, at(-SKI_BACK, -outer * SKI_HALF, 0));
      put(`${side}_heel`, at(-HEEL_BACK, 0, .03));
      put(`${side}_bigtoe`, at(TOE_FRONT, -outer * .02, .03));
      put(`${side}_smalltoe`, at(TOE_FRONT * .8, outer * .05, .03));
      low = Math.min(low, base[2] - SKI_HALF * Math.abs(Math.sin(roll)));
    }
    return low;
  });
  const snow = smoothed(smoothed(lowest));
  frames.forEach((frame, s) => { for (let k = 0; k < POINTS.length; k++) frame[k * 3 + 2] -= snow[s]; });

  // The hips travel the way the skis point, at the standard's speed.
  const snowAt: [number, number][] = [];
  let u = 0, v = 0;
  times.forEach((time, s) => {
    if (s > 0) {
      const dt = time - times[s - 1], psi = (headings.left[s] + headings.right[s]) / 2;
      const dx = Math.sin(psi) * .85, dy = Math.cos(psi) * .85 + .15, size = Math.hypot(dx, dy) || 1;
      u += dx / size * motion.motion.speedMs * dt;
      v += dy / size * motion.motion.speedMs * dt;
    }
    snowAt.push([u, v]);
  });
  return { times, frames, index: INDEX, snowAt };
}

/** The marks both skis have left up to `time`, around where the hips are at that moment. */
export function liftedMarks(lift: LiftedPose, time: number, here: readonly [number, number]) {
  const shown = lift.times.flatMap((at, s) => at <= time ? [s] : []);
  return SIDES.map(side => {
    const place = (corner: string, s: number): [number, number] => {
      const a = INDEX[`${side}_ski_${corner}_a`] * 3, b = INDEX[`${side}_ski_${corner}_b`] * 3, frame = lift.frames[s];
      return [(frame[a] + frame[b]) / 2 + lift.snowAt[s][0] - here[0], (frame[a + 1] + frame[b + 1]) / 2 + lift.snowAt[s][1] - here[1]];
    };
    return skiMark(shown.map(s => place("tip", s)), shown.map(s => place("tail", s)));
  });
}

/** The lifted pose at any instant: points move linearly between the two surrounding samples. */
export function liftedAt(lift: LiftedPose, time: number) {
  const { times, frames, snowAt } = lift;
  let low = 0, high = times.length - 1;
  while (low < high) { const middle = Math.ceil((low + high) / 2); if (times[middle] <= time) low = middle; else high = middle - 1; }
  const j = Math.min(low + 1, times.length - 1), alpha = j === low ? 0 : Math.max(0, Math.min(1, (time - times[low]) / (times[j] - times[low])));
  const points = new Float64Array(frames[low].length);
  for (let k = 0; k < points.length; k++) points[k] = frames[low][k] + (frames[j][k] - frames[low][k]) * alpha;
  return { points, snowAt: [snowAt[low][0] + (snowAt[j][0] - snowAt[low][0]) * alpha, snowAt[low][1] + (snowAt[j][1] - snowAt[low][1]) * alpha] as [number, number] };
}
