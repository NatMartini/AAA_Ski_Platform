import {
  BackSide, BufferAttribute, BufferGeometry, Color, DataTexture, DirectionalLight, DoubleSide, Float32BufferAttribute, LinearFilter,
  LinearMipmapLinearFilter, Matrix4, Mesh, MeshPhysicalMaterial, MeshStandardMaterial, NeutralToneMapping, PCFShadowMap, PerspectiveCamera, PlaneGeometry, PMREMGenerator,
  RepeatWrapping, RGBAFormat, Scene, ShaderMaterial, ShadowMaterial, Skeleton, SkinnedMesh, SphereGeometry, SRGBColorSpace, Bone, UnsignedByteType, Vector2, Vector3, WebGLRenderer,
  type Material, type Texture,
} from "three";
import { clientFetch } from "@/lib/client-fetch";
import { boneFrames, RIG_BONE_COUNT, skinMatrices, type BoneFrame, type RigBone, type Vec3 } from "@/lib/freeski/skier-rig";

/**
 * The 3D stage: a skier in ski clothes on a snow slope, in sunlight, drawn with WebGL. World coordinates
 * are slope coordinates in metres: x across the slope (+ is the right of someone looking downhill),
 * y down the fall line, z off the snow, with the snow at z = 0. The scene stays near the origin; `snowAt`
 * says where on the mountain the origin is, so the snow passes under the skier.
 */
type AssetPart = { name: string; material: string; geometry: BufferGeometry };
export type SkierAsset = { parts: AssetPart[]; rest: BoneFrame[] };

export type SkierLook = { jacket: string; trim: string; trousers: string; helmet: string; lens: string };
export const USER_LOOK: SkierLook = { jacket: "#e9791a", trim: "#7d3d10", trousers: "#2b2c31", helmet: "#eceef1", lens: "#d4641c" };
export const STANDARD_LOOK: SkierLook = { jacket: "#1a9c64", trim: "#0f5a40", trousers: "#232d3d", helmet: "#eceef1", lens: "#2f6ad0" };

let assetRequest: Promise<SkierAsset> | null = null;

function parseAsset(buffer: ArrayBuffer): SkierAsset {
  const view = new DataView(buffer);
  const headerLength = view.getUint32(4, true);
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 8, headerLength))) as {
    positionScale: number; points: string[]; bind: number[][];
    parts: { name: string; material: string; vertices: number; indices: number; wideIndices: boolean }[];
  };
  let offset = 8 + headerLength;
  const take = <T extends ArrayBufferView>(make: (start: number) => T, bytes: number) => {
    const array = make(offset);
    offset += bytes + (-bytes & 3);
    return array;
  };
  const parts = header.parts.map(part => {
    const raw = take(start => new Int16Array(buffer, start, part.vertices * 3), part.vertices * 6);
    const position = new Float32Array(part.vertices * 3);
    for (let i = 0; i < position.length; i++) position[i] = raw[i] / header.positionScale;
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(position, 3));
    geometry.setAttribute("normal", new BufferAttribute(take(start => new Int8Array(buffer, start, part.vertices * 3), part.vertices * 3), 3, true));
    geometry.setAttribute("color", new BufferAttribute(take(start => new Uint8Array(buffer, start, part.vertices * 3), part.vertices * 3), 3, true));
    geometry.setAttribute("skinIndex", new BufferAttribute(take(start => new Uint8Array(buffer, start, part.vertices * 4), part.vertices * 4), 4));
    geometry.setAttribute("skinWeight", new BufferAttribute(take(start => new Uint8Array(buffer, start, part.vertices * 4), part.vertices * 4), 4, true));
    const index = part.wideIndices
      ? take(start => new Uint32Array(buffer, start, part.indices), part.indices * 4)
      : take(start => new Uint16Array(buffer, start, part.indices), part.indices * 2);
    geometry.setIndex(new BufferAttribute(index, 1));
    return { name: part.name, material: part.material, geometry };
  });
  const bind = new Float64Array(header.bind.flat());
  return { parts, rest: boneFrames(bind, Object.fromEntries(header.points.map((name, i) => [name, i]))) };
}

export function loadSkierAsset(): Promise<SkierAsset> {
  return assetRequest ??= clientFetch("/standard-motions/skier-mesh.bin").then(async response => {
    if (!response.ok) throw new Error("skier-mesh-unavailable");
    return parseAsset(await response.arrayBuffer());
  }).catch(error => { assetRequest = null; throw error; });
}

/** A skeleton whose matrices are written directly, one free frame per bone. */
class DirectSkeleton extends Skeleton {
  constructor() {
    super(Array.from({ length: RIG_BONE_COUNT }, () => new Bone()), Array.from({ length: RIG_BONE_COUNT }, () => new Matrix4()));
    this.computeBoneTexture();
  }
  override update() { if (this.boneTexture) this.boneTexture.needsUpdate = true; }
}

function skierMaterials(look: SkierLook): Record<string, Material> {
  const fabric = (color: string, roughness: number, sheen: number) => new MeshPhysicalMaterial({ color, roughness, sheen, sheenRoughness: .6, sheenColor: new Color(color).lerp(new Color("#ffffff"), .35), vertexColors: true });
  return {
    jacket: fabric(look.jacket, .62, .55),
    jacket_trim: fabric(look.trim, .62, .55),
    trousers: fabric(look.trousers, .78, .22),
    gaiter: new MeshStandardMaterial({ color: "#3a3f49", roughness: .95, vertexColors: true }),
    helmet: new MeshPhysicalMaterial({ color: look.helmet, roughness: .42, clearcoat: .6, clearcoatRoughness: .28, vertexColors: true }),
    frame: new MeshStandardMaterial({ color: "#1a1b20", roughness: .5, vertexColors: true }),
    lens: new MeshPhysicalMaterial({ color: look.lens, metalness: 1, roughness: .08, clearcoat: 1, clearcoatRoughness: .04, envMapIntensity: 1.5, vertexColors: true }),
    glove: new MeshStandardMaterial({ color: "#1b1c21", roughness: .66, vertexColors: true }),
    boot: new MeshPhysicalMaterial({ color: "#16181d", roughness: .34, clearcoat: .8, clearcoatRoughness: .22, vertexColors: true }),
    metal: new MeshStandardMaterial({ color: "#c2c6cc", metalness: .95, roughness: .32, vertexColors: true }),
    binding: new MeshStandardMaterial({ color: "#34373e", metalness: .35, roughness: .44, vertexColors: true }),
    ski: new MeshPhysicalMaterial({ color: "#ffffff", roughness: .4, clearcoat: .45, clearcoatRoughness: .22, vertexColors: true, side: DoubleSide }),
    pole: new MeshStandardMaterial({ color: "#ffffff", metalness: .3, roughness: .42, vertexColors: true }),
  };
}

const NO_POLE_BONES: readonly RigBone[] = ["left_hand", "right_hand", "left_pole", "right_pole"];

/** One skier in the scene: its own clothes and bones. */
export class SkierFigure {
  readonly meshes: SkinnedMesh[] = [];
  private readonly depthOnly: SkinnedMesh[] = [];
  private readonly materials: Material[];
  private readonly skeleton = new DirectSkeleton();
  private readonly depthMaterial = new MeshStandardMaterial({ colorWrite: false });
  private readonly colors: Color[];
  private readonly ghostColor: Color;
  private alpha = 1;

  constructor(private readonly asset: SkierAsset, look: SkierLook, scene: Scene, private readonly poles: boolean) {
    const materials = skierMaterials(look);
    this.materials = Object.values(materials);
    this.colors = this.materials.map(material => (material as MeshStandardMaterial).color.clone());
    this.ghostColor = new Color(look.jacket);
    const identity = new Matrix4();
    for (const part of asset.parts) {
      if (!poles && part.material === "pole") continue;
      const mesh = new SkinnedMesh(part.geometry, materials[part.material]);
      mesh.bind(this.skeleton, identity);
      mesh.frustumCulled = false;
      mesh.castShadow = true;
      // A lens is too small and too curved to shade itself cleanly.
      mesh.receiveShadow = part.material !== "lens";
      mesh.visible = false;
      this.meshes.push(mesh);
      scene.add(mesh);
      const depth = new SkinnedMesh(part.geometry, this.depthMaterial);
      depth.bind(this.skeleton, identity);
      depth.frustumCulled = false;
      depth.visible = false;
      depth.renderOrder = -1;
      this.depthOnly.push(depth);
      scene.add(depth);
    }
  }

  /** Pose from named points in scene coordinates. */
  setPose(points: ArrayLike<number>, index: Readonly<Record<string, number>>) {
    skinMatrices(boneFrames(points, index), this.asset.rest, this.skeleton.boneMatrices!, this.poles ? [] : NO_POLE_BONES);
  }

  /** See-through and all in the jacket's colour, so it reads as a guide over the other skier, without showing its own overlaps. */
  setAlpha(alpha: number) {
    if (alpha === this.alpha) return;
    this.alpha = alpha;
    this.materials.forEach((material, i) => {
      material.transparent = alpha < 1;
      material.opacity = alpha;
      (material as MeshStandardMaterial).color.copy(this.colors[i]);
      if (alpha < 1) (material as MeshStandardMaterial).color.lerp(this.ghostColor, .7);
      material.needsUpdate = true;
    });
  }

  show(visible: boolean) {
    for (const mesh of this.meshes) mesh.visible = visible;
    for (const mesh of this.depthOnly) mesh.visible = visible && this.alpha < 1;
  }

  dispose() {
    for (const material of this.materials) material.dispose();
    this.depthMaterial.dispose();
    this.skeleton.boneTexture?.dispose();
  }
}

/** Soft undulations in rgb (slope across, slope along, height), fine grain in alpha; repeats seamlessly, filters with distance. */
function snowTile(size = 512) {
  const height = new Float32Array(size * size);
  let seed = 12345;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let cells = 4, amount = 1; cells <= 256; cells *= 2, amount *= .56) {
    const lattice = Float32Array.from({ length: cells * cells }, random);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const fx = x / size * cells, fy = y / size * cells, ix = Math.floor(fx), iy = Math.floor(fy);
      const tx = fx - ix, ty = fy - iy, sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
      const at = (i: number, j: number) => lattice[((j + cells) % cells) * cells + ((i + cells) % cells)];
      height[y * size + x] += amount * (at(ix, iy) * (1 - sx) * (1 - sy) + at(ix + 1, iy) * sx * (1 - sy) + at(ix, iy + 1) * (1 - sx) * sy + at(ix + 1, iy + 1) * sx * sy);
    }
  }
  let low = Infinity, high = -Infinity;
  for (const value of height) { low = Math.min(low, value); high = Math.max(high, value); }
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const at = (i: number, j: number) => (height[((j + size) % size) * size + ((i + size) % size)] - low) / (high - low);
    const k = (y * size + x) * 4;
    data[k] = Math.max(0, Math.min(255, 128 + (at(x + 1, y) - at(x - 1, y)) * 2400));
    data[k + 1] = Math.max(0, Math.min(255, 128 + (at(x, y + 1) - at(x, y - 1)) * 2400));
    data[k + 2] = at(x, y) * 255;
    data[k + 3] = random() * 255;
  }
  const texture = new DataTexture(data, size, size, RGBAFormat, UnsignedByteType);
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.magFilter = LinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

const SKY_FUNCTIONS = /* glsl */`
  vec3 skyColor(vec3 dir, vec3 up) {
    float e = dot(dir, up);
    vec3 zenith = vec3(.20, .42, .82), mid = vec3(.46, .68, .95), horizon = vec3(.86, .92, .98);
    vec3 sky = mix(horizon, mid, smoothstep(.0, .22, e));
    return mix(sky, zenith, smoothstep(.15, .85, e));
  }
`;

const ENVIRONMENT_SHADER = {
  vertexShader: /* glsl */`
    varying vec3 vDir;
    void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
  fragmentShader: /* glsl */`
    varying vec3 vDir;
    ${SKY_FUNCTIONS}
    void main() {
      vec3 dir = normalize(vDir);
      vec3 sky = skyColor(dir, vec3(0., 0., 1.)) * 1.25;
      // Snow lights everything from below.
      vec3 snow = vec3(.94, .96, 1.) * (.85 + .25 * dir.z);
      gl_FragColor = vec4(mix(snow, sky, smoothstep(-.03, .03, dir.z)), 1.);
    }`,
};

const BACKDROP_SHADER = {
  vertexShader: /* glsl */`
    varying vec2 vNdc;
    void main() { vNdc = position.xy; gl_Position = vec4(position.xy, 1., 1.); }`,
  fragmentShader: /* glsl */`
    uniform mat4 uCameraWorld, uProjectionInverse;
    uniform vec3 uUp;
    uniform sampler2D uTile;
    varying vec2 vNdc;
    ${SKY_FUNCTIONS}
    float ridge(float a, float scale, float seed) {
      return textureLod(uTile, vec2(a * scale, seed), 1.).b * .6 + textureLod(uTile, vec2(a * scale * 3., seed + .31), 1.).b * .4;
    }
    void main() {
      vec4 view = uProjectionInverse * vec4(vNdc, 1., 1.);
      vec3 dir = normalize(mat3(uCameraWorld) * (view.xyz / view.w));
      vec3 color = skyColor(dir, uUp);
      // Heights are measured from where the slope's plane meets the sky, so the far side always has a ridge line.
      float e = dir.z;
      float a = atan(dir.x, dir.y) / 6.28318;
      // Thin high cloud.
      vec2 cloud = dir.xy / max(.14, e + .25);
      float wisp = smoothstep(.42, .78, textureLod(uTile, cloud * .045 + .3, 1.).b);
      color = mix(color, vec3(.96, .975, 1.), wisp * .5 * smoothstep(.03, .2, e));
      // Two ranges of mountains, the far one paler, then the forest at the top of the run.
      float far = .03 + .17 * pow(ridge(a, 2., .12), 1.7);
      if (e < far) {
        // Rock shows through the snow in streaks, more of it low down.
        float rock = textureLod(uTile, vec2(a * 37., e * 3.), .5).b * .7 + textureLod(uTile, vec2(a * 110., e * 9.), .5).b * .3;
        float snowy = smoothstep(.30, .56, rock + (e / far - .5) * .3);
        color = mix(vec3(.68, .75, .86), vec3(.90, .94, .99), snowy);
      }
      float near = .012 + .11 * pow(ridge(a, 5., .77), 2.2);
      if (e < near) {
        float rock = textureLod(uTile, vec2(a * 61., e * 5.), .5).b * .7 + textureLod(uTile, vec2(a * 190., e * 14.), .5).b * .3;
        float snowy = smoothstep(.30, .56, rock + (e / near - .5) * .32);
        color = mix(vec3(.52, .60, .72), vec3(.93, .96, 1.), snowy);
      }
      float trees = .005 + .010 * ridge(a, 41., .41) + .004 * ridge(a, 263., .63);
      if (e < trees) color = mix(vec3(.25, .35, .38), vec3(.36, .45, .50), smoothstep(.0, trees, e));
      // The air thickens low down.
      color = mix(color, vec3(.80, .87, .96), .42 * (1. - smoothstep(.0, .05, e)));
      gl_FragColor = vec4(color, 1.);
      #include <colorspace_fragment>
    }`,
};

const SNOW_SHADER = {
  vertexShader: /* glsl */`
    varying vec3 vWorld;
    void main() { vec4 world = modelMatrix * vec4(position, 1.); vWorld = world.xyz; gl_Position = projectionMatrix * viewMatrix * world; }`,
  fragmentShader: /* glsl */`
    uniform sampler2D uTile;
    uniform vec2 uSnowAt;
    uniform vec3 uSun;
    uniform float uGroomed;
    uniform vec2 uBumps;
    varying vec3 vWorld;
    const mat2 TURN_A = mat2(.80, .60, -.60, .80);
    const mat2 TURN_B = mat2(.38, .92, -.92, .38);
    // An old ski track, a pair of grooves, curving down the slope.
    float oldTrack(vec2 w, float across, float reach, float wave, float phase, float width) {
      float line = across + reach * sin(w.y * wave + phase);
      float d = abs(abs(w.x - line) - .1);
      return 1. - smoothstep(width * .35, width, d);
    }
    void main() {
      vec2 w = vWorld.xy + uSnowAt;
      float dist = length(vWorld - cameraPosition);
      vec4 broad = texture2D(uTile, w / 17.);
      vec4 middle = texture2D(uTile, TURN_A * w / 3.1 + .37);
      vec4 fine = texture2D(uTile, TURN_B * w / .73 + .71);
      vec2 slope = (broad.rg - .5) * .5 + ((middle.rg - .5) * TURN_A) * .34 + ((fine.rg - .5) * TURN_B) * .22;
      // Moguls in staggered rows, so the snow's relief passes under the skis as they ride them.
      if (uBumps.x > 0.) {
        float k = 6.28318 / uBumps.x, lateral = k * .62;
        float row = sin(w.y * k), across = .62 + .38 * cos(w.x * lateral + floor(w.y / uBumps.x) * 3.14159);
        slope += vec2(-.38 * sin(w.x * lateral) * row * lateral, cos(w.y * k) * across * k) * uBumps.y;
      }
      // A groomed slope's corduroy, fading before it can shimmer.
      float pitch = .036;
      float pixel = fwidth(w.x) + fwidth(w.y);
      float showCord = uGroomed * (1. - smoothstep(pitch * .2, pitch * .55, pixel)) * (.55 + .45 * middle.b);
      slope.x += sin((w.x + (broad.b - .5) * .05) * 6.28318 / pitch) * .05 * showCord;
      // Tracks of skiers who came earlier.
      float tracks = 0.;
      tracks = max(tracks, oldTrack(w, 6.1, 3.6, .29, 1.1, .022));
      tracks = max(tracks, oldTrack(w, -9.4, 4.8, .21, 2.7, .022));
      tracks = max(tracks, oldTrack(w, 16.8, 2.8, .37, .4, .02));
      tracks = max(tracks, oldTrack(w, -2.2, 6.4, .17, 4.2, .024));
      tracks = max(tracks, oldTrack(w, -19., 3.9, .26, 5.3, .02));
      tracks *= uGroomed * (1. - smoothstep(.05, .35, pixel)) * (.35 + .65 * middle.b);
      vec3 n = normalize(vec3(-slope, 1.));
      float sun = clamp(dot(n, uSun) / max(uSun.z, .35), 0., 1.25);
      vec3 shade = vec3(.70, .79, .94) * .9, lit = vec3(1., .985, .955);
      vec3 color = mix(shade, lit, sun * .86) * (.955 + .045 * broad.b);
      color = mix(color, color * vec3(.82, .88, .96), tracks * .7);
      // Ice crystals catching the sun.
      vec3 toEye = normalize(cameraPosition - vWorld);
      float glint = texture2D(uTile, TURN_A * w / .23 + toEye.xy * .07).a;
      color += vec3(pow(glint, 60.)) * .5 * (1. - smoothstep(12., 40., dist));
      // The air.
      float haze = 1. - exp(-pow(dist / 520., 1.3));
      color = mix(color, vec3(.80, .87, .96), haze);
      gl_FragColor = vec4(color, 1.);
      #include <colorspace_fragment>
    }`,
};

const TRACK_SHADER = {
  vertexShader: /* glsl */`
    attribute vec4 aTrack;
    varying vec4 vTrack;
    varying vec2 vWorld;
    void main() { vTrack = aTrack; vWorld = (modelMatrix * vec4(position, 1.)).xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D uTile;
    uniform vec2 uSnowAt;
    uniform vec3 uSun;
    varying vec4 vTrack;
    varying vec2 vWorld;
    void main() {
      vec2 w = vWorld + uSnowAt;
      float rough = texture2D(uTile, w / 1.3).b - .5;
      float c = vTrack.x;
      float alpha = vTrack.y * (1. - smoothstep(.55, 1., abs(c) + rough * .5));
      // The groove's walls: the one facing the sun is lit, the other in shade.
      float wall = c * dot(vTrack.zw, uSun.xy) * 1.5;
      vec3 color = mix(vec3(.62, .72, .89), vec3(1., .995, .975), clamp(.42 + wall + rough * .4, 0., 1.));
      gl_FragColor = vec4(color, alpha);
      #include <colorspace_fragment>
    }`,
};

const MAX_TRACK_VERTICES = 4000;

/** A ski's mark on the snow: centre line and half width per point, faded as a whole. */
export type Ribbon = { points: readonly (readonly [number, number, number])[]; alpha: number };

export type Shot = {
  /** Part of the canvas, in fractions, from the top left. */
  rect: { x: number; y: number; width: number; height: number };
  axes: { right: Vec3; up: Vec3; forward: Vec3 };
  slopeDeg: number;
  /** The point the camera looks at, and how many metres the frame's height covers there. */
  focus: Vec3;
  frameHeight: number;
  /** Where on the mountain the scene's origin is. */
  snowAt: readonly [number, number];
  figures: readonly SkierFigure[];
  /** Drawn see-through over everything else. */
  ghost?: SkierFigure | null;
  ribbons?: readonly Ribbon[];
  groomed?: boolean;
  /** Bumps: how high the snow is under the skier right now, and the bumps' spacing down the slope, shading the snow. */
  snowLevel?: number;
  bumps?: { spacing: number; height: number } | null;
};

const CAMERA_DISTANCE = 8;

/** A scene point's position in canvas pixels for a shot. */
export function shotToCanvas(shot: Shot, width: number, height: number) {
  const { right, up, forward } = shot.axes;
  const half = shot.frameHeight / 2 / CAMERA_DISTANCE;
  const rect = { x: shot.rect.x * width, y: shot.rect.y * height, width: shot.rect.width * width, height: shot.rect.height * height };
  const aspect = rect.width / rect.height;
  const camera: Vec3 = [shot.focus[0] - forward[0] * CAMERA_DISTANCE, shot.focus[1] - forward[1] * CAMERA_DISTANCE, shot.focus[2] - forward[2] * CAMERA_DISTANCE];
  return (x: number, y: number, z: number): [number, number] => {
    const qx = x - camera[0], qy = y - camera[1], qz = z - camera[2];
    const depth = qx * forward[0] + qy * forward[1] + qz * forward[2];
    const sx = (qx * right[0] + qy * right[1] + qz * right[2]) / (depth * half * aspect);
    const sy = (qx * up[0] + qy * up[1] + qz * up[2]) / (depth * half);
    return [rect.x + (sx + 1) / 2 * rect.width, rect.y + (1 - sy) / 2 * rect.height];
  };
}

export class SkierStage {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(20, 1, .5, 9000);
  private readonly sun = new DirectionalLight("#fff3e2", 3.3);
  private readonly tile: Texture;
  private readonly environment: Texture;
  private readonly snow: Mesh;
  private readonly snowShadow: Mesh;
  private readonly backdrop: Mesh;
  private readonly tracks: Mesh;
  private readonly trackGeometry = new BufferGeometry();
  private readonly figures: SkierFigure[] = [];
  private readonly snowMaterial: ShaderMaterial;
  private readonly backdropMaterial: ShaderMaterial;
  private readonly trackMaterial: ShaderMaterial;
  // Pulled toward the camera: it lies exactly on the snow and must not lose to it frame by frame.
  private readonly shadowMaterial = new ShadowMaterial({ color: "#3d5f9c", opacity: .62, toneMapped: false, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  private readonly size = new Vector2();
  private disposed = false;
  private lost = false;
  private lastFrame = 0;
  private frames = 0;
  private slowFrames = 0;

  private constructor(private readonly canvas: HTMLCanvasElement, private readonly asset: SkierAsset) {
    this.renderer = new WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: "high-performance" });
    const renderer = this.renderer;
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = NeutralToneMapping;
    renderer.toneMappingExposure = 1;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = PCFShadowMap;
    renderer.autoClear = false;
    renderer.setScissorTest(true);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    canvas.addEventListener("webglcontextlost", () => { this.lost = true; canvas.style.display = "none"; });

    this.tile = snowTile();
    this.tile.anisotropy = renderer.capabilities.getMaxAnisotropy();

    // The light that fills the skier from the sky and from the snow.
    const pmrem = new PMREMGenerator(renderer);
    const dome = new Scene();
    const domeMaterial = new ShaderMaterial({ ...ENVIRONMENT_SHADER, side: BackSide, depthWrite: false, toneMapped: false });
    const domeMesh = new Mesh(new SphereGeometry(50, 32, 16), domeMaterial);
    dome.add(domeMesh);
    this.environment = pmrem.fromScene(dome, 0, 1, 100).texture;
    domeMaterial.dispose();
    domeMesh.geometry.dispose();
    pmrem.dispose();
    this.scene.environment = this.environment;
    this.scene.environmentIntensity = .72;

    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.left = -3.2; this.sun.shadow.camera.right = 3.2;
    this.sun.shadow.camera.top = 3.2; this.sun.shadow.camera.bottom = -3.2;
    this.sun.shadow.camera.near = 1; this.sun.shadow.camera.far = 30;
    this.sun.shadow.bias = -.0004;
    this.sun.shadow.normalBias = .018;
    this.sun.shadow.radius = 5;
    this.scene.add(this.sun, this.sun.target);

    this.backdropMaterial = new ShaderMaterial({ ...BACKDROP_SHADER, depthTest: false, depthWrite: false, toneMapped: false,
      uniforms: { uCameraWorld: { value: new Matrix4() }, uProjectionInverse: { value: new Matrix4() }, uUp: { value: new Vector3(0, 0, 1) }, uTile: { value: this.tile } } });
    const triangle = new BufferGeometry();
    triangle.setAttribute("position", new Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    this.backdrop = new Mesh(triangle, this.backdropMaterial);
    this.backdrop.frustumCulled = false;
    this.backdrop.renderOrder = -100;
    this.scene.add(this.backdrop);

    this.snowMaterial = new ShaderMaterial({ ...SNOW_SHADER, toneMapped: false,
      uniforms: { uTile: { value: this.tile }, uSnowAt: { value: new Float32Array(2) }, uSun: { value: new Vector3(0, 0, 1) }, uGroomed: { value: 1 }, uBumps: { value: new Float32Array(2) } } });
    const ground = new PlaneGeometry(9000, 9000);
    this.snow = new Mesh(ground, this.snowMaterial);
    this.snow.frustumCulled = false;
    this.snow.renderOrder = -50;
    this.scene.add(this.snow);
    this.snow.updateMatrixWorld();
    this.snowShadow = new Mesh(ground, this.shadowMaterial);
    this.snowShadow.receiveShadow = true;
    this.snowShadow.frustumCulled = false;
    this.snowShadow.renderOrder = 20;
    this.scene.add(this.snowShadow);

    this.trackGeometry.setAttribute("position", new Float32BufferAttribute(new Float32Array(MAX_TRACK_VERTICES * 3), 3));
    this.trackGeometry.setAttribute("aTrack", new Float32BufferAttribute(new Float32Array(MAX_TRACK_VERTICES * 4), 4));
    this.trackGeometry.setIndex(new BufferAttribute(new Uint16Array(MAX_TRACK_VERTICES * 3), 1));
    this.trackMaterial = new ShaderMaterial({ ...TRACK_SHADER, transparent: true, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
      uniforms: { uTile: { value: this.tile }, uSnowAt: this.snowMaterial.uniforms.uSnowAt, uSun: this.snowMaterial.uniforms.uSun } });
    this.tracks = new Mesh(this.trackGeometry, this.trackMaterial);
    this.tracks.frustumCulled = false;
    this.tracks.renderOrder = 10;
    this.scene.add(this.tracks);
  }

  /** A stage filling this element on a canvas of its own, or null where WebGL is not available. */
  static async create(container: HTMLElement): Promise<SkierStage | null> {
    const asset = await loadSkierAsset();
    const canvas = document.createElement("canvas");
    canvas.setAttribute("aria-hidden", "true");
    canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%";
    try {
      const stage = new SkierStage(canvas, asset);
      container.prepend(canvas);
      return stage;
    } catch {
      return null;
    }
  }

  /** False once the browser has taken the GPU away: the caller goes back to its flat drawing. */
  get usable() { return !this.disposed && !this.lost; }

  figure(look: SkierLook, options: { poles: boolean }) {
    const figure = new SkierFigure(this.asset, look, this.scene, options.poles);
    this.figures.push(figure);
    return figure;
  }

  private fitSize() {
    const width = Math.max(1, this.canvas.clientWidth), height = Math.max(1, this.canvas.clientHeight);
    const size = this.renderer.getSize(this.size);
    if (size.x !== width || size.y !== height) this.renderer.setSize(width, height, false);
    return { width, height };
  }

  private setRibbons(ribbons: readonly Ribbon[]) {
    const position = this.trackGeometry.getAttribute("position") as BufferAttribute;
    const track = this.trackGeometry.getAttribute("aTrack") as BufferAttribute;
    const index = this.trackGeometry.getIndex()!;
    let vertex = 0, element = 0;
    for (const ribbon of ribbons) {
      const { points } = ribbon;
      if (points.length < 2 || vertex + points.length * 2 > MAX_TRACK_VERTICES) continue;
      for (let i = 0; i < points.length; i++) {
        const [x, y, half] = points[i];
        const previous = points[Math.max(0, i - 1)], next = points[Math.min(points.length - 1, i + 1)];
        const dx = next[0] - previous[0], dy = next[1] - previous[1], length = Math.hypot(dx, dy) || 1;
        const ax = -dy / length, ay = dx / length;
        // A clean groove shows strongly; a wide smear of skidded snow only just.
        const alpha = ribbon.alpha * Math.max(.3, Math.min(1, .05 / half));
        position.setXYZ(vertex, x + ax * half, y + ay * half, .002);
        track.setXYZW(vertex, -1, alpha, ax, ay);
        position.setXYZ(vertex + 1, x - ax * half, y - ay * half, .002);
        track.setXYZW(vertex + 1, 1, alpha, ax, ay);
        if (i > 0) {
          (index.array as Uint16Array).set([vertex - 2, vertex - 1, vertex + 1, vertex - 2, vertex + 1, vertex], element);
          element += 6;
        }
        vertex += 2;
      }
    }
    position.needsUpdate = true;
    track.needsUpdate = true;
    index.needsUpdate = true;
    this.trackGeometry.setDrawRange(0, element);
  }

  private aim(shot: Shot, width: number, height: number) {
    const { right, up, forward } = shot.axes;
    const rectWidth = shot.rect.width * width, rectHeight = shot.rect.height * height;
    const camera = this.camera;
    camera.fov = 2 * Math.atan(shot.frameHeight / 2 / CAMERA_DISTANCE) * 180 / Math.PI;
    camera.aspect = rectWidth / rectHeight;
    camera.position.set(shot.focus[0] - forward[0] * CAMERA_DISTANCE, shot.focus[1] - forward[1] * CAMERA_DISTANCE, shot.focus[2] - forward[2] * CAMERA_DISTANCE);
    camera.up.set(up[0], up[1], up[2]);
    camera.lookAt(shot.focus[0], shot.focus[1], shot.focus[2]);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    // The sun stays over the camera's shoulder, so the skier is well lit from every side.
    const sun = new Vector3(right[0] * -.5 + up[0] * .72 - forward[0] * .48, right[1] * -.5 + up[1] * .72 - forward[1] * .48, right[2] * -.5 + up[2] * .72 - forward[2] * .48).normalize();
    this.sun.target.position.set(shot.focus[0], shot.focus[1], Math.max(.5, shot.focus[2] - .3));
    this.sun.position.copy(this.sun.target.position).addScaledVector(sun, 14);
    this.sun.target.updateMatrixWorld();
    this.sun.updateMatrixWorld();
    (this.snowMaterial.uniforms.uSun.value as Vector3).copy(sun);
    const slope = shot.slopeDeg * Math.PI / 180;
    (this.backdropMaterial.uniforms.uCameraWorld.value as Matrix4).copy(camera.matrixWorld);
    (this.backdropMaterial.uniforms.uProjectionInverse.value as Matrix4).copy(camera.projectionMatrixInverse);
    (this.backdropMaterial.uniforms.uUp.value as Vector3).set(0, -Math.sin(slope), Math.cos(slope));
    // The noise repeats, so wrap well before floats lose the fine grain.
    (this.snowMaterial.uniforms.uSnowAt.value as Float32Array).set([shot.snowAt[0] % 1012, shot.snowAt[1] % 1012]);
    this.snowMaterial.uniforms.uGroomed.value = shot.groomed === false ? 0 : 1;
    (this.snowMaterial.uniforms.uBumps.value as Float32Array).set(shot.bumps ? [shot.bumps.spacing, shot.bumps.height] : [0, 0]);
    this.snow.position.z = this.snowShadow.position.z = this.tracks.position.z = shot.snowLevel ?? 0;
  }

  /** A slower device gets fewer pixels rather than a jerky picture. */
  private keepUp() {
    const now = performance.now(), gap = now - this.lastFrame;
    this.lastFrame = now;
    // Paused, or in the background: says nothing about the device.
    if (gap > 250) return;
    this.frames++;
    if (gap > 32) this.slowFrames++;
    if (this.frames < 40) return;
    const ratio = this.renderer.getPixelRatio();
    if (this.slowFrames > 24 && ratio > 1) this.renderer.setPixelRatio(Math.max(1, ratio - .5));
    this.frames = this.slowFrames = 0;
  }

  render(shots: readonly Shot[]) {
    if (!this.usable) return;
    this.keepUp();
    const { width, height } = this.fitSize();
    for (const shot of shots) {
      const x = shot.rect.x * width, w = shot.rect.width * width, h = shot.rect.height * height, y = height - shot.rect.y * height - h;
      this.renderer.setViewport(x, y, w, h);
      this.renderer.setScissor(x, y, w, h);
      this.renderer.clear(true, true, true);
      this.aim(shot, width, height);
      this.setRibbons(shot.ribbons ?? []);
      for (const figure of this.figures) figure.show(shot.figures.includes(figure));
      this.backdrop.visible = this.snow.visible = this.snowShadow.visible = true;
      this.tracks.visible = Boolean(shot.ribbons?.length);
      this.renderer.render(this.scene, this.camera);
      if (shot.ghost) {
        this.renderer.clearDepth();
        for (const figure of this.figures) figure.show(figure === shot.ghost);
        this.backdrop.visible = this.snow.visible = this.snowShadow.visible = this.tracks.visible = false;
        this.renderer.render(this.scene, this.camera);
      }
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const figure of this.figures) figure.dispose();
    for (const part of this.asset.parts) part.geometry.dispose();
    this.tile.dispose();
    this.environment.dispose();
    this.snow.geometry.dispose();
    this.backdrop.geometry.dispose();
    this.snowMaterial.dispose();
    this.backdropMaterial.dispose();
    this.shadowMaterial.dispose();
    this.trackGeometry.dispose();
    this.trackMaterial.dispose();
    this.sun.shadow.map?.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.canvas.remove();
  }
}
