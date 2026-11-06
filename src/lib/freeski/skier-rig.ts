/**
 * The bones of the 3D skier, worked out from a motion's named points. The mesh
 * (scripts/standard-motion/build_skier_mesh.py) is weighted to these bones in one stance; any other pose
 * moves it by the change from that stance. Every bone is a free frame in the world, so a limb can also
 * stretch a little along its length when a filmed person's proportions differ from the mesh's.
 */
export const RIG_BONES = ["pelvis", "abdomen", "chest", "neck", "head",
  "left_upper_arm", "left_forearm", "left_hand", "right_upper_arm", "right_forearm", "right_hand",
  "left_thigh", "left_shin", "left_foot", "right_thigh", "right_shin", "right_foot", "left_pole", "right_pole"] as const;
export type RigBone = (typeof RIG_BONES)[number];
export const RIG_BONE_COUNT = RIG_BONES.length;

export type Vec3 = readonly [number, number, number];
/** A bone's axes in the world; `length` is what the bone spans here, for the stretch along its z axis. */
export type BoneFrame = { o: Vec3; x: Vec3; y: Vec3; z: Vec3; length?: number };

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const size = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const unit = (a: Vec3): Vec3 => scale(a, 1 / (size(a) || 1));
const mix = (a: Vec3, b: Vec3, t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
/** `a` made square to the unit vector `axis`. */
const square = (a: Vec3, axis: Vec3) => unit(sub(a, scale(axis, dot(a, axis))));

/** How far past the wrist the pole runs through the fist. */
export const FIST_REACH = .07;

/**
 * The mark a ski leaves on the snow, from where its tip and tail were: a line and a half width per step. A ski
 * going where it points cuts a clean line; one going sideways smears a swath as wide as it is sideways.
 */
export function skiMark(tips: readonly (readonly [number, number])[], tails: readonly (readonly [number, number])[]): [number, number, number][] {
  const places = tips.map((tip, i): [number, number] => [tails[i][0] + (tip[0] - tails[i][0]) * .12, tails[i][1] + (tip[1] - tails[i][1]) * .12]);
  return places.map(([x, y], i) => {
    const before = places[Math.max(0, i - 1)], after = places[Math.min(places.length - 1, i + 1)];
    const hx = tips[i][0] - tails[i][0], hy = tips[i][1] - tails[i][1], dx = after[0] - before[0], dy = after[1] - before[1];
    const sideways = Math.abs(hx * dy - hy * dx) / ((Math.hypot(hx, hy) * Math.hypot(dx, dy)) || 1);
    return [x, y, Math.max(.022, Math.min(.5, sideways * .55))];
  });
}

function blended(a: BoneFrame, b: BoneFrame, o: Vec3): BoneFrame {
  const x = unit(add(a.x, b.x)), z = square(add(a.z, b.z), x);
  return { o, x, y: cross(z, x), z };
}

/**
 * Every bone from a pose's points. `points` are xyz triples and `index` names them. Without pole tips the
 * hands stay locked to the forearms and the pole bones are left where their forearms are.
 */
export function boneFrames(points: ArrayLike<number>, index: Readonly<Record<string, number>>): BoneFrame[] {
  const at = (name: string): Vec3 => {
    const k = index[name];
    return [points[k * 3], points[k * 3 + 1], points[k * 3 + 2]];
  };
  const hips = mix(at("left_hip"), at("right_hip"), .5), shoulders = mix(at("left_shoulder"), at("right_shoulder"), .5), ears = mix(at("left_ear"), at("right_ear"), .5);
  const pelvisX = unit(sub(at("right_hip"), at("left_hip"))), pelvisZ = square(sub(shoulders, hips), pelvisX);
  const pelvis: BoneFrame = { o: hips, x: pelvisX, y: cross(pelvisZ, pelvisX), z: pelvisZ };
  const chestX = unit(sub(at("right_shoulder"), at("left_shoulder"))), chestZ = square(sub(shoulders, hips), chestX);
  const chest: BoneFrame = { o: shoulders, x: chestX, y: cross(chestZ, chestX), z: chestZ };
  const headX = unit(sub(at("right_ear"), at("left_ear"))), headZ = unit(cross(headX, sub(at("nose"), ears)));
  const head: BoneFrame = { o: ears, x: headX, y: cross(headZ, headX), z: headZ };
  const frames: Partial<Record<RigBone, BoneFrame>> = {
    pelvis, chest, head, abdomen: blended(pelvis, chest, mix(hips, shoulders, .5)), neck: blended(chest, head, mix(shoulders, ears, .55)),
  };

  for (const side of ["left", "right"] as const) {
    // Foot and ski are one rigid piece. Corner "a" is the ski's outer corner.
    const tipA = at(`${side}_ski_tip_a`), tipB = at(`${side}_ski_tip_b`), tailA = at(`${side}_ski_tail_a`), tailB = at(`${side}_ski_tail_b`);
    const skiY = unit(sub(mix(tipA, tipB, .5), mix(tailA, tailB, .5)));
    const skiX = square(side === "left" ? sub(tipB, tipA) : sub(tipA, tipB), skiY);
    frames[`${side}_foot`] = { o: mix(mix(tipA, tipB, .5), mix(tailA, tailB, .5), .5), x: skiX, y: skiY, z: cross(skiX, skiY) };

    // The leg bends in the plane of hip, knee and ankle; a straight leg falls back on the way the foot points.
    const hip = at(`${side}_hip`), knee = at(`${side}_knee`), ankle = at(`${side}_ankle`);
    const leg = unit(sub(ankle, hip)), kneeOut = sub(knee, hip), front = add(sub(kneeOut, scale(leg, dot(kneeOut, leg))), scale(skiY, .02));
    const thighZ = unit(sub(hip, knee)), thighY = square(front, thighZ);
    frames[`${side}_thigh`] = { o: hip, x: cross(thighY, thighZ), y: thighY, z: thighZ, length: size(sub(hip, knee)) };
    const shinZ = unit(sub(knee, ankle)), shinY = square(front, shinZ);
    frames[`${side}_shin`] = { o: knee, x: cross(shinY, shinZ), y: shinY, z: shinZ, length: size(sub(knee, ankle)) };

    // The arm's hinge likewise; a straight arm falls back on the chest.
    const shoulder = at(`${side}_shoulder`), elbow = at(`${side}_elbow`), wrist = at(`${side}_wrist`);
    const hinge = add(cross(sub(elbow, shoulder), sub(wrist, elbow)), scale(chestX, .01));
    const upperZ = unit(sub(shoulder, elbow)), upperX = square(hinge, upperZ);
    frames[`${side}_upper_arm`] = { o: shoulder, x: upperX, y: cross(upperZ, upperX), z: upperZ, length: size(sub(shoulder, elbow)) };
    const foreZ = unit(sub(elbow, wrist)), foreX = square(hinge, foreZ);
    const forearm: BoneFrame = { o: elbow, x: foreX, y: cross(foreZ, foreX), z: foreZ, length: size(sub(elbow, wrist)) };
    frames[`${side}_forearm`] = forearm;

    const tipIndex = index[`${side}_pole_tip`];
    if (tipIndex === undefined) {
      frames[`${side}_hand`] = forearm;
      frames[`${side}_pole`] = forearm;
      continue;
    }
    // The fist closes around the pole.
    const tip = at(`${side}_pole_tip`), pole = unit(sub(tip, wrist)), back = square(sub(elbow, wrist), pole);
    const handY = cross(back, pole);
    frames[`${side}_hand`] = { o: wrist, x: pole, y: handY, z: back };
    const fist = sub(wrist, scale(back, FIST_REACH)), poleZ = unit(sub(tip, fist)), poleX = square(handY, poleZ);
    frames[`${side}_pole`] = { o: fist, x: poleX, y: cross(poleZ, poleX), z: poleZ, length: size(sub(tip, fist)) };
  }
  return RIG_BONES.map(name => frames[name]!);
}

/** Bone-from-world for a rest frame: an array of 12 (rotation rows and translation). */
function inverseRest(frame: BoneFrame) {
  const { x, y, z, o } = frame;
  return [x[0], x[1], x[2], -dot(x, o), y[0], y[1], y[2], -dot(y, o), z[0], z[1], z[2], -dot(z, o)];
}

/**
 * Skinning matrices, column by column, for a pose against the rest pose: a vertex moves rigidly with its
 * bone and stretches along the bone's z axis. A hand locked to its forearm takes the forearm's matrix,
 * since the rest pose's hand frame does not follow the forearm.
 */
export function skinMatrices(pose: readonly BoneFrame[], rest: readonly BoneFrame[], out: Float32Array, locked: readonly RigBone[] = []) {
  pose.forEach((frame, i) => {
    let bone = frame, restBone = rest[i];
    const name = RIG_BONES[i];
    if (locked.includes(name)) {
      const forearm = RIG_BONES.indexOf(name.replace(/_(hand|pole)$/, "_forearm") as RigBone);
      bone = pose[forearm];
      restBone = rest[forearm];
    }
    const inv = inverseRest(restBone);
    const stretch = bone.length && restBone.length ? bone.length / restBone.length : 1;
    const { x, y, z, o } = bone;
    const zx = z[0] * stretch, zy = z[1] * stretch, zz = z[2] * stretch;
    const at = i * 16;
    for (let c = 0; c < 4; c++) {
      const a = inv[c], b = inv[4 + c], d = inv[8 + c];
      out[at + c * 4] = x[0] * a + y[0] * b + zx * d + (c === 3 ? o[0] : 0);
      out[at + c * 4 + 1] = x[1] * a + y[1] * b + zy * d + (c === 3 ? o[1] : 0);
      out[at + c * 4 + 2] = x[2] * a + y[2] * b + zz * d + (c === 3 ? o[2] : 0);
      out[at + c * 4 + 3] = c === 3 ? 1 : 0;
    }
  });
}
