import {
  BufferAttribute, BufferGeometry, CatmullRomCurve3, Color, ConeGeometry, CylinderGeometry, DoubleSide, Float32BufferAttribute, InstancedMesh, Matrix4, Mesh,
  MeshBasicMaterial, MeshStandardMaterial, Quaternion, ShaderMaterial, SphereGeometry, TorusGeometry, TubeGeometry, Vector3, type Material, type Object3D, type Scene,
} from "three";
import type { Vec3 } from "@/lib/freeski/skier-rig";

/**
 * What the 3D lessons draw over the skier, in the stage's slope coordinates (metres; z off the snow): force arrows, the
 * centre of mass, a spiral around the body for rotation passed up (or down) through it, and rings for how far a part
 * of the body turns. Arrows show through the body faintly, so a force behind the skier is never lost.
 */
export type StageArrow = { kind: "arrow"; from: Vec3; vector: Vec3; color: string; width?: number };
export type StageBall = { kind: "ball"; at: Vec3; radius: number; color: string };
/** A spiral from `from` (its lower end) to `to`, winding clockwise or not seen from `to`, its colour flowing up or down. */
export type StageSpiral = { kind: "spiral"; from: Vec3; to: Vec3; color: string; clockwise: boolean; upward: boolean; flow: number };
/** A ring round `axis` through `centre`, from the direction `start` round by `arc` radians (positive counter-clockwise seen from the axis' tip). */
export type StageRing = { kind: "ring"; centre: Vec3; axis: Vec3; start: Vec3; radius: number; arc: number; color: string; flow: number };
export type StageOverlay = StageArrow | StageBall | StageSpiral | StageRing;

/** A coloured line painted on the snow: a path, its points across and down the slope in scene metres. */
export type PathLine = { points: readonly (readonly [number, number])[]; color: string; width: number; alpha?: number; dashed?: boolean };

const SPIRAL_RADIUS = .42, SPIRAL_HEIGHT = 1.25, SPIRAL_TURNS = 1.25;
const UP = new Vector3(0, 1, 0);

const FLOW_SHADER = {
  vertexShader: /* glsl */`
    varying vec2 vUv;
    varying vec3 vNormal;
    void main() { vUv = uv; vNormal = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
  fragmentShader: /* glsl */`
    uniform vec3 uColor;
    uniform float uFlow, uDirection, uArc;
    varying vec2 vUv;
    varying vec3 vNormal;
    void main() {
      if (vUv.x > uArc) discard;
      vec3 n = normalize(vNormal);
      if (!gl_FrontFacing) n = -n;
      float light = .6 + .4 * max(dot(n, normalize(vec3(.35, .8, .5))), 0.);
      // Bright bands travelling along the tube: the way the turning is passed on.
      float band = smoothstep(.55, .95, fract(vUv.x * 6. - uFlow * uDirection));
      gl_FragColor = vec4(uColor * light + vec3(1.) * band * .5, 1.);
      #include <colorspace_fragment>
    }`,
};

function flowMaterial() {
  return new ShaderMaterial({ ...FLOW_SHADER, side: DoubleSide, toneMapped: false,
    uniforms: { uColor: { value: new Color() }, uFlow: { value: 0 }, uDirection: { value: 1 }, uArc: { value: 1 } } });
}

const PATH_SHADER = {
  vertexShader: /* glsl */`
    attribute vec4 aColor;
    attribute vec3 aLine;
    varying vec4 vColor;
    varying vec3 vLine;
    void main() { vColor = aColor; vLine = aLine; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
  fragmentShader: /* glsl */`
    varying vec4 vColor;
    varying vec3 vLine;
    void main() {
      float edge = 1. - smoothstep(.62, 1., abs(vLine.x));
      float dash = vLine.z > .5 ? step(.42, fract(vLine.y / 1.4)) : 1.;
      float alpha = vColor.a * edge * dash;
      if (alpha < .01) discard;
      gl_FragColor = vec4(vColor.rgb, alpha);
      #include <colorspace_fragment>
    }`,
};

const MAX_PATH_VERTICES = 8000;
const MAX_POLES = 64;

type ArrowParts = { shaft: Mesh; head: Mesh; shaftThrough: Mesh; headThrough: Mesh };
type SpiralParts = { tube: Mesh; head: Mesh; material: ShaderMaterial };
type RingParts = { ring: Mesh; head: Mesh; material: ShaderMaterial };

export class OverlayLayer {
  private readonly shaft = new CylinderGeometry(1, 1, 1, 14).translate(0, .5, 0);
  private readonly cone = new ConeGeometry(1, 1, 18).translate(0, .5, 0);
  private readonly sphere = new SphereGeometry(1, 24, 16);
  private readonly helix: BufferGeometry;
  private readonly torus = new TorusGeometry(1, .05, 8, 96);
  private readonly materials = new Map<string, Material>();
  private readonly arrows: ArrowParts[] = [];
  private readonly balls: Mesh[] = [];
  private readonly spirals: SpiralParts[] = [];
  private readonly rings: RingParts[] = [];
  private used = { arrows: 0, balls: 0, spirals: 0, rings: 0 };
  private readonly matrix = new Matrix4();
  private readonly quaternion = new Quaternion();
  private readonly vector = new Vector3();

  readonly pathGeometry = new BufferGeometry();
  readonly paths: Mesh;
  private readonly pathMaterial = new ShaderMaterial({ ...PATH_SHADER, transparent: true, depthWrite: false, toneMapped: false, side: DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  readonly poles: InstancedMesh;
  private readonly poleGeometry: BufferGeometry;
  private readonly poleMaterial = new MeshStandardMaterial({ vertexColors: true, roughness: .55 });

  constructor(private readonly scene: Scene) {
    const points: Vector3[] = [];
    for (let i = 0; i <= 120; i++) {
      const y = i / 120, angle = 2 * Math.PI * SPIRAL_TURNS * y;
      points.push(new Vector3(SPIRAL_RADIUS * Math.cos(angle), y * SPIRAL_HEIGHT, SPIRAL_RADIUS * Math.sin(angle)));
    }
    this.helix = new TubeGeometry(new CatmullRomCurve3(points), 180, .03, 10);

    this.pathGeometry.setAttribute("position", new Float32BufferAttribute(new Float32Array(MAX_PATH_VERTICES * 3), 3));
    this.pathGeometry.setAttribute("aColor", new Float32BufferAttribute(new Float32Array(MAX_PATH_VERTICES * 4), 4));
    this.pathGeometry.setAttribute("aLine", new Float32BufferAttribute(new Float32Array(MAX_PATH_VERTICES * 3), 3));
    this.pathGeometry.setIndex(new BufferAttribute(new Uint16Array(MAX_PATH_VERTICES * 3), 1));
    this.paths = new Mesh(this.pathGeometry, this.pathMaterial);
    this.paths.frustumCulled = false;
    this.paths.renderOrder = 12;
    this.paths.visible = false;
    scene.add(this.paths);

    // A piste-edge pole: orange, its top black.
    this.poleGeometry = new CylinderGeometry(.028, .028, 1.4, 10).translate(0, .7, 0).rotateX(Math.PI / 2);
    const position = this.poleGeometry.getAttribute("position");
    const colors = new Float32Array(position.count * 3), orange = new Color("#f06a14"), black = new Color("#1b1d22");
    for (let i = 0; i < position.count; i++) (position.getZ(i) > 1.05 ? black : orange).toArray(colors, i * 3);
    this.poleGeometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
    this.poles = new InstancedMesh(this.poleGeometry, this.poleMaterial, MAX_POLES);
    this.poles.castShadow = true;
    this.poles.frustumCulled = false;
    this.poles.count = 0;
    scene.add(this.poles);
  }

  private material(color: string, through: boolean) {
    const key = `${color}|${through}`;
    let material = this.materials.get(key);
    if (!material) {
      material = through
        ? new MeshBasicMaterial({ color, transparent: true, opacity: .34, depthTest: false, depthWrite: false, toneMapped: false })
        : new MeshStandardMaterial({ color, emissive: color, emissiveIntensity: .38, roughness: .45 });
      this.materials.set(key, material);
    }
    return material;
  }

  private add(object: Object3D, order: number) {
    object.renderOrder = order;
    object.visible = false;
    this.scene.add(object);
    return object;
  }

  /** Hide everything from the last shot; the next shot adds its own. */
  begin() {
    for (const parts of this.arrows) for (const mesh of Object.values(parts)) mesh.visible = false;
    for (const ball of this.balls) ball.visible = false;
    for (const spiral of this.spirals) spiral.tube.visible = spiral.head.visible = false;
    for (const ring of this.rings) ring.ring.visible = ring.head.visible = false;
    this.used = { arrows: 0, balls: 0, spirals: 0, rings: 0 };
  }

  show(overlays: readonly StageOverlay[]) {
    for (const overlay of overlays) {
      if (overlay.kind === "arrow") this.arrow(overlay);
      else if (overlay.kind === "ball") this.ball(overlay);
      else if (overlay.kind === "spiral") this.spiral(overlay);
      else this.ring(overlay);
    }
  }

  private place(mesh: Mesh, at: Vector3, direction: Vector3, width: number, length: number) {
    this.quaternion.setFromUnitVectors(UP, direction);
    mesh.position.copy(at);
    mesh.quaternion.copy(this.quaternion);
    mesh.scale.set(width, length, width);
    mesh.visible = true;
  }

  private arrow({ from, vector, color, width = .022 }: StageArrow) {
    const length = Math.hypot(vector[0], vector[1], vector[2]);
    if (length < .02) return;
    let parts = this.arrows[this.used.arrows];
    if (!parts) {
      parts = { shaft: this.add(new Mesh(this.shaft), 30) as Mesh, head: this.add(new Mesh(this.cone), 30) as Mesh,
        shaftThrough: this.add(new Mesh(this.shaft), 60) as Mesh, headThrough: this.add(new Mesh(this.cone), 60) as Mesh };
      this.arrows.push(parts);
    }
    this.used.arrows++;
    const direction = new Vector3(vector[0] / length, vector[1] / length, vector[2] / length), start = new Vector3(from[0], from[1], from[2]);
    const head = Math.min(length * .42, width * 6), shaft = Math.max(.001, length - head);
    parts.shaft.material = parts.head.material = this.material(color, false);
    parts.shaftThrough.material = parts.headThrough.material = this.material(color, true);
    this.place(parts.shaft, start, direction, width, shaft);
    this.place(parts.shaftThrough, start, direction, width, shaft);
    const tipBase = start.clone().addScaledVector(direction, shaft);
    this.place(parts.head, tipBase, direction, width * 2.7, head);
    this.place(parts.headThrough, tipBase, direction, width * 2.7, head);
  }

  private ball({ at, radius, color }: StageBall) {
    let mesh = this.balls[this.used.balls];
    if (!mesh) { mesh = this.add(new Mesh(this.sphere), 31) as Mesh; this.balls.push(mesh); }
    this.used.balls++;
    mesh.material = this.material(color, false);
    mesh.position.set(at[0], at[1], at[2]);
    mesh.scale.setScalar(radius);
    mesh.visible = true;
  }

  private spiral({ from, to, color, clockwise, upward, flow }: StageSpiral) {
    let parts = this.spirals[this.used.spirals];
    if (!parts) {
      const material = flowMaterial();
      parts = { tube: this.add(new Mesh(this.helix, material), 29) as Mesh, head: this.add(new Mesh(this.cone), 29) as Mesh, material };
      this.spirals.push(parts);
    }
    this.used.spirals++;
    const axis = new Vector3(to[0] - from[0], to[1] - from[1], to[2] - from[2]), height = axis.length();
    if (height < .1) return;
    axis.divideScalar(height);
    (parts.material.uniforms.uColor.value as Color).set(color);
    parts.material.uniforms.uFlow.value = flow;
    parts.material.uniforms.uDirection.value = upward ? 1 : -1;
    parts.material.uniforms.uArc.value = 1.01;
    // Built as it is, the helix winds clockwise seen from its top as it rises; mirrored, the other way.
    this.quaternion.setFromUnitVectors(UP, axis);
    parts.tube.position.set(from[0], from[1], from[2]);
    parts.tube.quaternion.copy(this.quaternion);
    parts.tube.scale.set(clockwise ? 1 : -1, height / SPIRAL_HEIGHT, 1);
    parts.tube.visible = true;
    parts.tube.updateMatrixWorld();
    // The arrowhead where the turning arrives: the top end, or the bottom end when it is passed down.
    const at = (y: number) => {
      const angle = 2 * Math.PI * SPIRAL_TURNS * y;
      return new Vector3(SPIRAL_RADIUS * Math.cos(angle), y * SPIRAL_HEIGHT, SPIRAL_RADIUS * Math.sin(angle)).applyMatrix4(parts.tube.matrixWorld);
    };
    const end = upward ? 1 : 0, before = upward ? .985 : .015;
    const tip = at(end), direction = tip.clone().sub(at(before)).normalize();
    parts.head.material = this.material(color, false);
    this.place(parts.head, tip, direction, .08, .22);
  }

  private ring({ centre, axis, start, radius, arc, color, flow }: StageRing) {
    if (Math.abs(arc) < .03) return;
    let parts = this.rings[this.used.rings];
    if (!parts) {
      const material = flowMaterial();
      parts = { ring: this.add(new Mesh(this.torus, material), 29) as Mesh, head: this.add(new Mesh(this.cone), 29) as Mesh, material };
      this.rings.push(parts);
    }
    this.used.rings++;
    const z = new Vector3(...axis).normalize();
    const x = new Vector3(...start).addScaledVector(z, -new Vector3(...start).dot(z)).normalize();
    const y = new Vector3().crossVectors(z, x).multiplyScalar(arc < 0 ? -1 : 1);
    const sweep = Math.min(Math.abs(arc), 2 * Math.PI * .97);
    (parts.material.uniforms.uColor.value as Color).set(color);
    parts.material.uniforms.uFlow.value = flow;
    parts.material.uniforms.uDirection.value = 1;
    parts.material.uniforms.uArc.value = sweep / (2 * Math.PI);
    this.matrix.makeBasis(x, y, z).scale(new Vector3(radius, radius, radius)).setPosition(centre[0], centre[1], centre[2]);
    parts.ring.matrixAutoUpdate = false;
    parts.ring.matrix.copy(this.matrix);
    parts.ring.matrixWorldNeedsUpdate = true;
    parts.ring.visible = true;
    const tip = new Vector3(centre[0], centre[1], centre[2]).addScaledVector(x, radius * Math.cos(sweep)).addScaledVector(y, radius * Math.sin(sweep));
    const tangent = x.clone().multiplyScalar(-Math.sin(sweep)).addScaledVector(y, Math.cos(sweep)).normalize();
    parts.head.material = this.material(color, false);
    this.place(parts.head, tip.addScaledVector(tangent, -.02), tangent, .045, .11);
  }

  /** Lines painted on the snow, `level` metres above the slope's plane. */
  setPaths(paths: readonly PathLine[], level: number) {
    const position = this.pathGeometry.getAttribute("position") as BufferAttribute;
    const colour = this.pathGeometry.getAttribute("aColor") as BufferAttribute;
    const line = this.pathGeometry.getAttribute("aLine") as BufferAttribute;
    const index = this.pathGeometry.getIndex()!;
    const c = new Color();
    let vertex = 0, element = 0;
    for (const path of paths) {
      const { points } = path;
      if (points.length < 2 || vertex + points.length * 2 > MAX_PATH_VERTICES) continue;
      c.set(path.color);
      let along = 0;
      for (let i = 0; i < points.length; i++) {
        const [x, y] = points[i];
        if (i > 0) along += Math.hypot(x - points[i - 1][0], y - points[i - 1][1]);
        const previous = points[Math.max(0, i - 1)], next = points[Math.min(points.length - 1, i + 1)];
        const dx = next[0] - previous[0], dy = next[1] - previous[1], length = Math.hypot(dx, dy) || 1;
        const ax = -dy / length * path.width / 2, ay = dx / length * path.width / 2;
        for (const side of [-1, 1]) {
          position.setXYZ(vertex, x + ax * side, y + ay * side, .012);
          colour.setXYZW(vertex, c.r, c.g, c.b, path.alpha ?? .9);
          line.setXYZ(vertex, side, along, path.dashed ? 1 : 0);
          vertex++;
        }
        if (i > 0) {
          (index.array as Uint16Array).set([vertex - 4, vertex - 3, vertex - 1, vertex - 4, vertex - 1, vertex - 2], element);
          element += 6;
        }
      }
    }
    position.needsUpdate = colour.needsUpdate = line.needsUpdate = index.needsUpdate = true;
    this.pathGeometry.setDrawRange(0, element);
    this.paths.position.z = level;
    this.paths.visible = element > 0;
  }

  /** Poles along both edges of a piste running down the fall line, centred at `centre` across, `offset` down the slope. */
  setPoles(piste: { centre: number; halfWidth: number; offset: number } | null, level: number, reach = 60, spacing = 10) {
    if (!piste) { this.poles.count = 0; return; }
    let count = 0;
    const first = Math.ceil((-reach + piste.offset) / spacing), last = Math.floor((reach + piste.offset) / spacing);
    for (let k = first; k <= last && count + 2 <= MAX_POLES; k++) {
      for (const side of [-1, 1]) {
        this.matrix.makeTranslation(piste.centre + side * piste.halfWidth, k * spacing - piste.offset, level);
        this.poles.setMatrixAt(count++, this.matrix);
      }
    }
    this.poles.count = count;
    this.poles.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    for (const geometry of [this.shaft, this.cone, this.sphere, this.helix, this.torus, this.pathGeometry, this.poleGeometry]) geometry.dispose();
    for (const material of this.materials.values()) material.dispose();
    for (const spiral of this.spirals) spiral.material.dispose();
    for (const ring of this.rings) ring.material.dispose();
    this.pathMaterial.dispose();
    this.poleMaterial.dispose();
    this.poles.dispose();
  }
}
