import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { boneFrames, RIG_BONE_COUNT, RIG_BONES, skiMark, skinMatrices, type BoneFrame, type RigBone } from "./skier-rig";
import { decodeStandardMotion, motionPointsAt, STANDARD_MOTION_IDS, type StandardMotion, type StandardMotionId } from "./standard-motion";

const folder = join(process.cwd(), "public", "standard-motions");
const load = (id: StandardMotionId): StandardMotion => decodeStandardMotion(JSON.parse(readFileSync(join(folder, `${id}.json`), "utf8")));

/** Moves a point by a skinning matrix, column by column. */
function moved(matrices: Float32Array, bone: number, p: readonly number[]) {
  const m = matrices.subarray(bone * 16, bone * 16 + 16);
  return [0, 1, 2].map(row => m[row] * p[0] + m[4 + row] * p[1] + m[8 + row] * p[2] + m[12 + row]);
}

const parseMesh = () => {
  const file = readFileSync(join(folder, "skier-mesh.bin"));
  const buffer = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
  const headerLength = new DataView(buffer).getUint32(4, true);
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 8, headerLength)));
  let offset = 8 + headerLength;
  const take = (bytes: number) => { const start = offset; offset += bytes + (-bytes & 3); return start; };
  const parts = header.parts.map((part: { name: string; material: string; vertices: number; indices: number; wideIndices: boolean }) => {
    const position = new Int16Array(buffer, take(part.vertices * 6), part.vertices * 3);
    const normal = new Int8Array(buffer, take(part.vertices * 3), part.vertices * 3);
    const color = new Uint8Array(buffer, take(part.vertices * 3), part.vertices * 3);
    const bones = new Uint8Array(buffer, take(part.vertices * 4), part.vertices * 4);
    const weights = new Uint8Array(buffer, take(part.vertices * 4), part.vertices * 4);
    const indices = part.wideIndices ? new Uint32Array(buffer, take(part.indices * 4), part.indices) : new Uint16Array(buffer, take(part.indices * 2), part.indices);
    return { ...part, position, normal, color, bones, weights, indexes: indices };
  });
  return { header, parts, end: offset, size: buffer.byteLength };
};

describe("the skinning matrices", () => {
  const motion = load("demonstration_parallel-l3");
  const rest = boneFrames(motionPointsAt(motion, .5), motion.index);

  it("leave the rest pose where it is", () => {
    const out = new Float32Array(RIG_BONE_COUNT * 16);
    skinMatrices(rest, rest, out);
    for (let bone = 0; bone < RIG_BONE_COUNT; bone++) {
      const p = moved(out, bone, [.3, -.7, 1.1]);
      expect(p[0]).toBeCloseTo(.3, 4);
      expect(p[1]).toBeCloseTo(-.7, 4);
      expect(p[2]).toBeCloseTo(1.1, 4);
    }
  });

  it("carry a vertex rigidly when the whole skier moves", () => {
    const angle = .7, c = Math.cos(angle), s = Math.sin(angle);
    const move = (p: readonly number[]) => [c * p[0] - s * p[1] + 2, s * p[0] + c * p[1] - 1, p[2] + .5];
    const points = motionPointsAt(motion, .5), turned = new Float64Array(points.length);
    for (let k = 0; k < motion.pointCount; k++) turned.set(move([points[k * 3], points[k * 3 + 1], points[k * 3 + 2]]), k * 3);
    const out = new Float32Array(RIG_BONE_COUNT * 16);
    skinMatrices(boneFrames(turned, motion.index), rest, out);
    for (let bone = 0; bone < RIG_BONE_COUNT; bone++) {
      const expected = move([.1, .2, .9]), p = moved(out, bone, [.1, .2, .9]);
      for (let axis = 0; axis < 3; axis++) expect(p[axis]).toBeCloseTo(expected[axis], 3);
    }
  });

  it("stretch a limb along its length when a person's proportions differ", () => {
    const pose: BoneFrame[] = rest.map(frame => ({ ...frame }));
    const thigh = RIG_BONES.indexOf("left_thigh");
    pose[thigh] = { ...pose[thigh], length: pose[thigh].length! * 1.1 };
    const out = new Float32Array(RIG_BONE_COUNT * 16);
    skinMatrices(pose, rest, out);
    const hip = rest[thigh].o, knee = rest[RIG_BONES.indexOf("left_shin")].o;
    const p = moved(out, thigh, knee);
    expect(Math.hypot(p[0] - hip[0], p[1] - hip[1], p[2] - hip[2])).toBeCloseTo(rest[thigh].length! * 1.1, 3);
    const at = moved(out, thigh, hip);
    expect(Math.hypot(at[0] - hip[0], at[1] - hip[1], at[2] - hip[2])).toBeLessThan(1e-5);
  });

  it("keep a locked hand on its forearm when there are no pole tips to hold", () => {
    const withoutPoles = Object.fromEntries(Object.entries(motion.index).filter(([name]) => !name.endsWith("pole_tip")));
    const pose = boneFrames(motionPointsAt(motion, .2), withoutPoles);
    const locked: RigBone[] = ["left_hand", "right_hand", "left_pole", "right_pole"];
    const out = new Float32Array(RIG_BONE_COUNT * 16);
    skinMatrices(pose, rest, out, locked);
    const hand = RIG_BONES.indexOf("left_hand"), forearm = RIG_BONES.indexOf("left_forearm");
    expect(Array.from(out.subarray(hand * 16, hand * 16 + 16))).toEqual(Array.from(out.subarray(forearm * 16, forearm * 16 + 16)));
  });

  it.each(STANDARD_MOTION_IDS)("%s has proper bone axes all through the turn, either way round", id => {
    const motion = load(id);
    for (const mirrored of [false, true]) for (let i = 0; i <= 20; i++) {
      for (const frame of boneFrames(motionPointsAt(motion, i / 20, mirrored), motion.index)) {
        const { x, y, z } = frame;
        const dot = (a: readonly number[], b: readonly number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
        expect(dot(x, x)).toBeCloseTo(1, 6);
        expect(dot(y, y)).toBeCloseTo(1, 6);
        expect(dot(z, z)).toBeCloseTo(1, 6);
        expect(dot(x, y)).toBeCloseTo(0, 6);
        expect(dot(y, z)).toBeCloseTo(0, 6);
        // Right-handed: never a mirror image of the mesh.
        expect(x[0] * (y[1] * z[2] - y[2] * z[1]) + x[1] * (y[2] * z[0] - y[0] * z[2]) + x[2] * (y[0] * z[1] - y[1] * z[0])).toBeCloseTo(1, 6);
      }
    }
  });
});

describe("a ski's mark on the snow", () => {
  it("is a clean line when the ski goes where it points and a swath when it goes sideways", () => {
    const along = Array.from({ length: 10 }, (_, i) => i * .2);
    const carved = skiMark(along.map(v => [0, v + .9]), along.map(v => [0, v - .8]));
    const skidded = skiMark(along.map(v => [.9, v]), along.map(v => [-.8, v]));
    expect(carved[5][2]).toBeCloseTo(.022, 3);
    expect(skidded[5][2]).toBeGreaterThan(.4);
  });
});

describe("the mesh file", () => {
  const mesh = parseMesh();

  it("holds every part, and nothing after them", () => {
    expect(mesh.header.bones).toEqual([...RIG_BONES]);
    expect(mesh.end).toBe(mesh.size);
    expect(statSync(join(folder, "skier-mesh.bin")).size).toBeLessThan(2_500_000);
    for (const name of ["jacket", "trousers", "helmet", "goggle_lens", "left_glove", "right_boot", "left_ski", "right_pole"]) expect(mesh.parts.map((part: { name: string }) => part.name)).toContain(name);
  });

  it("is a person's size, standing on the skis", () => {
    let top = -Infinity, bottom = Infinity;
    for (const part of mesh.parts) for (let i = 2; i < part.position.length; i += 3) {
      top = Math.max(top, part.position[i] / mesh.header.positionScale);
      bottom = Math.min(bottom, part.position[i] / mesh.header.positionScale);
    }
    expect(bottom).toBeGreaterThan(-.02);
    expect(bottom).toBeLessThan(.02);
    // A skier in a skiing stance, helmet on.
    expect(top).toBeGreaterThan(1.55);
    expect(top).toBeLessThan(1.95);
  });

  it("has whole weights on real bones and faces on real vertices", () => {
    for (const part of mesh.parts) {
      for (let v = 0; v < part.vertices; v++) {
        expect(part.weights[v * 4] + part.weights[v * 4 + 1] + part.weights[v * 4 + 2] + part.weights[v * 4 + 3]).toBe(255);
        for (let k = 0; k < 4; k++) expect(part.bones[v * 4 + k]).toBeLessThan(RIG_BONE_COUNT);
      }
      for (const index of part.indexes) expect(index).toBeLessThan(part.vertices);
    }
  });

  it("gives each garment to the right bones", () => {
    const bonesOf = (name: string) => {
      const part = mesh.parts.find((candidate: { name: string }) => candidate.name === name);
      const used = new Set<string>();
      for (let i = 0; i < part.bones.length; i++) if (part.weights[i] > 0) used.add(RIG_BONES[part.bones[i]]);
      return used;
    };
    expect([...bonesOf("helmet")]).toEqual(["head"]);
    expect([...bonesOf("left_ski")]).toEqual(["left_foot"]);
    expect([...bonesOf("right_cuff")]).toEqual(["right_shin"]);
    for (const bone of ["pelvis", "abdomen", "chest", "left_upper_arm", "left_forearm", "right_upper_arm", "right_forearm"]) expect(bonesOf("jacket"), bone).toContain(bone);
    for (const bone of ["pelvis", "left_thigh", "left_shin", "right_thigh", "right_shin"]) expect(bonesOf("trousers"), bone).toContain(bone);
  });

  it("faces outward, with normals that agree with its faces", () => {
    for (const part of mesh.parts) {
      if (part.name.endsWith("ski") || part.name.endsWith("pole") || part.name.endsWith("pocket") || part.name.endsWith("buckles") || part.name === "zip") continue;
      let agree = 0, total = 0;
      for (let f = 0; f < part.indexes.length; f += 3) {
        const [a, b, c] = [part.indexes[f], part.indexes[f + 1], part.indexes[f + 2]];
        const p = (i: number) => [part.position[i * 3], part.position[i * 3 + 1], part.position[i * 3 + 2]];
        const [pa, pb, pc] = [p(a), p(b), p(c)];
        const u = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]], v = [pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]];
        const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
        const m = [part.normal[a * 3], part.normal[a * 3 + 1], part.normal[a * 3 + 2]];
        if (n[0] * m[0] + n[1] * m[1] + n[2] * m[2] > 0) agree++;
        total++;
      }
      expect(agree / total, part.name).toBeGreaterThan(.9);
    }
  });
});
