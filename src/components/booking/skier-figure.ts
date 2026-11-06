/**
 * Draws a skier on a canvas: a person with volume, skis and poles, with the skeleton on top.
 * Everything is given as canvas points by joint name, so a student's filmed pose and a generated
 * standard draw the same way.
 */
export type Point = readonly [number, number];
export type Figure = {
  /** Canvas position of a joint, or null where it was not seen. */
  at: (name: string) => Point | null;
  /** Canvas pixels per shoulder-to-ankle height: limb thickness follows it. */
  unit: number;
  /** Draws the side further from the camera first. */
  nearLeft: boolean;
  /** Face toward the camera: goggles show. */
  facing: boolean;
  /** Ski corners as tip-a, tip-b, tail-b, tail-a, or a tail-to-tip line for a filmed skier. */
  skis: { left: Point[] | null; right: Point[] | null };
  poles?: { left: Point | null; right: Point | null };
};

export type FigureStyle = { jacket: string; pants: string; boot: string; helmet: string; ski: string; skiEdge: string; pole: string; bones: string };

export const USER_STYLE: FigureStyle = { jacket: "#ff9f1c", pants: "#d97a0c", boot: "#7c4405", helmet: "#ffd08a", ski: "#ffe9c9", skiEdge: "#b56a10", pole: "#f7d9a8", bones: "rgba(90, 44, 0, 0.75)" };
export const STANDARD_STYLE: FigureStyle = { jacket: "#2fd17a", pants: "#17a35a", boot: "#0b5c33", helmet: "#a9f0ca", ski: "#d8fbe7", skiEdge: "#0e7a44", pole: "#b9f2d3", bones: "rgba(0, 62, 32, 0.75)" };

function capsule(context: CanvasRenderingContext2D, a: Point, ra: number, b: Point, rb: number) {
  const dx = b[0] - a[0], dy = b[1] - a[1], length = Math.hypot(dx, dy);
  const angle = Math.atan2(dy, dx);
  context.beginPath();
  if (length <= Math.abs(ra - rb)) {
    const big = ra > rb ? a : b;
    context.arc(big[0], big[1], Math.max(ra, rb), 0, Math.PI * 2);
  } else {
    const spread = Math.acos((ra - rb) / length);
    context.arc(a[0], a[1], ra, angle + spread, angle - spread);
    context.arc(b[0], b[1], rb, angle - spread, angle + spread);
    context.closePath();
  }
  context.fill();
}

function limb(context: CanvasRenderingContext2D, a: Point | null, ra: number, b: Point | null, rb: number) {
  if (a && b) capsule(context, a, ra, b, rb);
}

function drawSki(context: CanvasRenderingContext2D, ski: Point[] | null, figure: Figure, style: FigureStyle) {
  if (!ski) return;
  const { unit } = figure;
  context.lineJoin = "round";
  context.lineCap = "round";
  if (ski.length === 2) {
    // Only a line is known for a filmed ski.
    context.strokeStyle = style.skiEdge;
    context.lineWidth = unit * .05;
    context.beginPath(); context.moveTo(ski[0][0], ski[0][1]); context.lineTo(ski[1][0], ski[1][1]); context.stroke();
    context.strokeStyle = style.ski;
    context.lineWidth = unit * .03;
    context.beginPath(); context.moveTo(ski[0][0], ski[0][1]); context.lineTo(ski[1][0], ski[1][1]); context.stroke();
    return;
  }
  const [tipA, tipB, tailB, tailA] = ski;
  // Rounded shovel: the tip's corners draw together in front of the ski.
  const tip: Point = [(tipA[0] + tipB[0]) / 2 + (tipA[0] + tipB[0] - tailA[0] - tailB[0]) * .035, (tipA[1] + tipB[1]) / 2 + (tipA[1] + tipB[1] - tailA[1] - tailB[1]) * .035];
  context.beginPath();
  context.moveTo(tailA[0], tailA[1]);
  context.lineTo(tipA[0], tipA[1]);
  context.quadraticCurveTo(tip[0], tip[1], tipB[0], tipB[1]);
  context.lineTo(tailB[0], tailB[1]);
  context.closePath();
  // An edged ski seen from the side is thin: the outline keeps it visible.
  context.strokeStyle = style.skiEdge;
  context.lineWidth = unit * .035;
  context.stroke();
  context.fillStyle = style.ski;
  context.fill();
}

function drawArm(context: CanvasRenderingContext2D, figure: Figure, style: FigureStyle, side: "left" | "right") {
  const { unit } = figure;
  const shoulder = figure.at(`${side}_shoulder`), elbow = figure.at(`${side}_elbow`), wrist = figure.at(`${side}_wrist`);
  const tip = figure.poles?.[side] ?? null;
  if (wrist && tip) {
    context.strokeStyle = style.pole;
    context.lineCap = "round";
    context.lineWidth = Math.max(1, unit * .012);
    context.beginPath(); context.moveTo(wrist[0], wrist[1]); context.lineTo(tip[0], tip[1]); context.stroke();
    // The basket, a little above the tip.
    const bx = tip[0] + (wrist[0] - tip[0]) * .09, by = tip[1] + (wrist[1] - tip[1]) * .09;
    context.lineWidth = Math.max(1, unit * .016);
    const nx = -(wrist[1] - tip[1]), ny = wrist[0] - tip[0], n = Math.hypot(nx, ny) || 1;
    context.beginPath(); context.moveTo(bx - nx / n * unit * .03, by - ny / n * unit * .03); context.lineTo(bx + nx / n * unit * .03, by + ny / n * unit * .03); context.stroke();
  }
  context.fillStyle = style.jacket;
  limb(context, shoulder, unit * .055, elbow, unit * .043);
  limb(context, elbow, unit * .043, wrist, unit * .034);
  if (wrist) {
    context.fillStyle = style.boot;
    context.beginPath(); context.arc(wrist[0], wrist[1], unit * .036, 0, Math.PI * 2); context.fill();
  }
}

function drawLeg(context: CanvasRenderingContext2D, figure: Figure, style: FigureStyle, side: "left" | "right") {
  const { unit } = figure;
  const hip = figure.at(`${side}_hip`), knee = figure.at(`${side}_knee`), ankle = figure.at(`${side}_ankle`);
  const heel = figure.at(`${side}_heel`), toe = figure.at(`${side}_bigtoe`);
  context.fillStyle = style.pants;
  limb(context, hip, unit * .085, knee, unit * .06);
  limb(context, knee, unit * .06, ankle, unit * .05);
  context.fillStyle = style.boot;
  limb(context, ankle, unit * .05, heel, unit * .04);
  limb(context, ankle, unit * .05, toe, unit * .036);
  limb(context, heel, unit * .036, toe, unit * .034);
}

function drawHead(context: CanvasRenderingContext2D, figure: Figure, style: FigureStyle) {
  const { unit } = figure;
  const earL = figure.at("left_ear"), earR = figure.at("right_ear"), nose = figure.at("nose");
  const shoulderL = figure.at("left_shoulder"), shoulderR = figure.at("right_shoulder"), hipL = figure.at("left_hip"), hipR = figure.at("right_hip");
  const neck: Point | null = shoulderL && shoulderR ? [(shoulderL[0] + shoulderR[0]) / 2, (shoulderL[1] + shoulderR[1]) / 2] : null;
  let centre: Point | null = earL && earR ? [(earL[0] + earR[0]) / 2, (earL[1] + earR[1]) / 2] : earL ?? earR;
  if (!centre && neck && hipL && hipR) {
    // A filmed back of the head often has no face points: it sits above the shoulders along the spine.
    const hx = (hipL[0] + hipR[0]) / 2, hy = (hipL[1] + hipR[1]) / 2, s = Math.hypot(neck[0] - hx, neck[1] - hy) || 1;
    centre = [neck[0] + (neck[0] - hx) / s * unit * .18, neck[1] + (neck[1] - hy) / s * unit * .18];
  }
  if (!centre) return;
  if (neck) {
    context.fillStyle = style.jacket;
    limb(context, neck, unit * .05, centre, unit * .04);
  }
  const radius = unit * .092;
  context.fillStyle = style.helmet;
  context.beginPath(); context.arc(centre[0], centre[1], radius, 0, Math.PI * 2); context.fill();
  if (figure.facing && nose) {
    const gx = centre[0] + (nose[0] - centre[0]) * .75, gy = centre[1] + (nose[1] - centre[1]) * .75 - unit * .008;
    const tilt = earL && earR ? Math.atan2(earR[1] - earL[1], earR[0] - earL[0]) : 0;
    context.save();
    context.translate(gx, gy);
    context.rotate(tilt);
    context.fillStyle = "rgba(12, 22, 38, 0.85)";
    context.beginPath();
    context.ellipse(0, 0, radius * .78, radius * .34, 0, 0, Math.PI * 2);
    context.fill();
    context.restore();
  }
}

function drawTorso(context: CanvasRenderingContext2D, figure: Figure, style: FigureStyle) {
  const { unit } = figure;
  const ls = figure.at("left_shoulder"), rs = figure.at("right_shoulder"), lh = figure.at("left_hip"), rh = figure.at("right_hip");
  if (!ls || !rs || !lh || !rh) return;
  context.fillStyle = style.jacket;
  context.strokeStyle = style.jacket;
  context.lineJoin = "round";
  context.lineWidth = unit * .1;
  context.beginPath();
  context.moveTo(ls[0], ls[1]); context.lineTo(rs[0], rs[1]); context.lineTo(rh[0], rh[1]); context.lineTo(lh[0], lh[1]);
  context.closePath();
  context.fill();
  context.stroke();
  context.fillStyle = style.pants;
  limb(context, lh, unit * .08, rh, unit * .08);
}

/** The whole skier, furthest parts first. */
export function drawSkierFigure(context: CanvasRenderingContext2D, figure: Figure, style: FigureStyle) {
  const far = figure.nearLeft ? "right" : "left", near = figure.nearLeft ? "left" : "right";
  drawSki(context, figure.skis[far], figure, style);
  drawSki(context, figure.skis[near], figure, style);
  drawArm(context, figure, style, far);
  drawLeg(context, figure, style, far);
  drawLeg(context, figure, style, near);
  drawTorso(context, figure, style);
  drawHead(context, figure, style);
  drawArm(context, figure, style, near);
}

/** The `unit` for `drawBones` that gives fine lines over a 3D skier: thinner on a small stage, where the skier is small too. */
export const fineBonesUnit = (canvasHeight: number, ratio: number) => 1.25 / .014 * ratio * Math.max(.55, Math.min(1, canvasHeight / ratio / 320));
export const USER_BONES = "rgba(255, 214, 150, 0.95)";
export const STANDARD_BONES = "rgba(170, 248, 205, 0.95)";

/** Thin lines and joint dots over the figure, so the skeleton the analysis reads stays visible. */
export function drawBones(context: CanvasRenderingContext2D, bones: readonly (readonly [Point | null, Point | null])[], joints: readonly (Point | null)[], color: string, unit: number) {
  context.strokeStyle = color;
  context.fillStyle = color;
  context.lineCap = "round";
  context.lineWidth = Math.max(1, unit * .014);
  context.beginPath();
  for (const [a, b] of bones) {
    if (!a || !b) continue;
    context.moveTo(a[0], a[1]);
    context.lineTo(b[0], b[1]);
  }
  context.stroke();
  const radius = Math.max(1.2, unit * .016);
  for (const joint of joints) {
    if (!joint) continue;
    context.beginPath();
    context.arc(joint[0], joint[1], radius, 0, Math.PI * 2);
    context.fill();
  }
}
