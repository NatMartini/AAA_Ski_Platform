"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bone, Pause, Play } from "lucide-react";
import { bumpField, cameraAxes, decodeStandardMotion, motionBones, motionMarks, motionPointsAt, projectPoint, snowLevelAt, STANDARD_MOTION_GROUPS,
  type CameraAxes, type StandardMotion, type StandardMotionId } from "@/lib/freeski/standard-motion";
import { clientFetch } from "@/lib/client-fetch";
import { cn } from "@/lib/utils";
import { drawBones, drawSkierFigure, fineBonesUnit, STANDARD_BONES, STANDARD_STYLE, type Figure, type Point } from "./skier-figure";
import type { Ribbon, Shot, SkierFigure, SkierStage } from "./skier-stage";

const VIEWS = [
  { key: "front", zh: "正面", en: "Front", azimuth: 180, elevation: 9 },
  { key: "rear", zh: "背面", en: "Behind", azimuth: 0, elevation: 9 },
  { key: "side", zh: "侧面", en: "Side", azimuth: 90, elevation: 8 },
  { key: "above", zh: "高处", en: "From above", azimuth: 20, elevation: 42 },
] as const;
const SPEEDS = [1, .5, .25] as const;
const TRACK_TURNS = 5;

/** Across and down the slope from one edge change to the next, for a right turn. */
function turnAdvance(motion: StandardMotion) {
  const centre = (points: Float64Array) => {
    const { left_ankle: l, right_ankle: r } = motion.index;
    return [(points[l * 3] + points[r * 3]) / 2, (points[l * 3 + 1] + points[r * 3 + 1]) / 2];
  };
  const a = centre(motionPointsAt(motion, 0)), b = centre(motionPointsAt(motion, 1));
  return { across: b[0] - a[0], down: b[1] - a[1] };
}

/** Where turn number `n` starts on the slope. Odd turns are left turns, mirrored. */
function turnOrigin(n: number, advance: { across: number; down: number }) {
  return [((n % 2) + 2) % 2 === 1 ? advance.across : 0, n * advance.down, 0];
}

function motionFigure(motion: StandardMotion, points: Float64Array, axes: CameraAxes, toCanvas: (p: [number, number]) => Point, unit: number): Figure {
  const at = (name: string): Point | null => {
    const k = motion.index[name];
    return k === undefined ? null : toCanvas(projectPoint(points, k, axes));
  };
  const depth = (k: number) => points[k * 3] * axes.forward[0] + points[k * 3 + 1] * axes.forward[1] + points[k * 3 + 2] * axes.forward[2];
  const { left_shoulder: ls, right_shoulder: rs, nose, left_ear: le, right_ear: re } = motion.index;
  const corners = (side: string) => [`${side}_ski_tip_a`, `${side}_ski_tip_b`, `${side}_ski_tail_b`, `${side}_ski_tail_a`].map(name => at(name)!);
  return { at, unit, nearLeft: depth(ls) < depth(rs), facing: depth(nose) < (depth(le) + depth(re)) / 2,
    skis: { left: corners("left"), right: corners("right") }, poles: { left: at("left_pole_tip"), right: at("right_pole_tip") } };
}

/** The marks both skis left, turn by turn, as ribbons on the snow relative to (`u`, `v`). */
function skiRibbons(motion: StandardMotion, n: number, phase: number, advance: { across: number; down: number }, u: number, v: number): Ribbon[] {
  const ribbons: Ribbon[] = [];
  for (let turn = n - TRACK_TURNS; turn <= n; turn++) {
    const shift = turnOrigin(turn, advance), last = turn === n ? phase : 1;
    if (last <= 0) continue;
    for (const mark of motionMarks(motion, last, turn % 2 !== 0)) {
      ribbons.push({ points: mark.map(([x, y, half]) => [x + shift[0] - u, y + shift[1] - v, half]), alpha: .78 * (1 - (n - turn) / (TRACK_TURNS + 1)) });
    }
  }
  return ribbons;
}

const STAGE_FRAME_HEIGHT = 3.1;

function MotionStage({ motion, zh }: { motion: StandardMotion; zh: boolean }) {
  const [view, setView] = useState<(typeof VIEWS)[number]>(VIEWS[0]);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(.5);
  const [playing, setPlaying] = useState(true);
  const [bones, setBones] = useState(true);
  const [mode, setMode] = useState<"loading" | "scene" | "flat">("loading");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<{ stage: SkierStage; figure: SkierFigure; project: typeof import("./skier-stage").shotToCanvas } | null>(null);
  const sliderRef = useRef<HTMLInputElement>(null);
  const clock = useRef(0);
  const live = useRef({ view, speed, playing, bones, mode });
  useEffect(() => { live.current = { view, speed, playing, bones, mode }; }, [view, speed, playing, bones, mode]);
  const drawn = useRef("");
  const advance = useMemo(() => turnAdvance(motion), [motion]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const box = boxRef.current;
      if (!box) return;
      const library = await import("./skier-stage");
      const stage = await library.SkierStage.create(box);
      if (!stage) { if (alive) setMode("flat"); return; }
      if (!alive) { stage.dispose(); return; }
      stageRef.current = { stage, figure: stage.figure(library.STANDARD_LOOK, { poles: true }), project: library.shotToCanvas };
      drawn.current = "";
      setMode("scene");
    })().catch(() => { if (alive) setMode("flat"); /* Without the mesh or WebGL, the flat drawing. */ });
    return () => { alive = false; stageRef.current?.stage.dispose(); stageRef.current = null; };
  }, []);

  const draw = useCallback((seconds: number) => {
    const canvas = canvasRef.current, context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const ratio = window.devicePixelRatio || 1;
    const width = Math.round(canvas.clientWidth * ratio), height = Math.round(canvas.clientHeight * ratio);
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    const axes = cameraAxes({ azimuth: live.current.view.azimuth, elevation: live.current.view.elevation, slope: motion.motion.pitchDeg });
    const duration = motion.motion.durationSec;
    const n = Math.floor(seconds / duration), phase = seconds / duration - n, mirrored = n % 2 === 1;
    const origin = turnOrigin(n, advance);
    const points = motionPointsAt(motion, phase, mirrored);
    for (let k = 0; k < motion.pointCount; k++) for (let c = 0; c < 3; c++) points[k * 3 + c] += origin[c];
    const { left_hip: lh, right_hip: rh } = motion.index;
    const label = phase < .08 || phase > .94 ? (zh ? "换刃" : "Edge change") : Math.abs(phase - motion.motion.apexPhase) < .08 ? (zh ? "弯顶" : "Apex") : phase < motion.motion.apexPhase ? (zh ? "进弯" : "Entering") : (zh ? "出弯" : "Finishing");
    const caption = () => {
      context.font = `600 ${13 * ratio}px sans-serif`;
      context.fillText(`${mirrored ? (zh ? "左转" : "Left turn") : (zh ? "右转" : "Right turn")} · ${label}`, 14 * ratio, height - 14 * ratio);
    };

    const scene = stageRef.current;
    if (scene?.stage.usable) {
      // Nothing moved, nothing to draw: a paused stage should not keep the graphics card busy.
      const key = `${seconds}|${live.current.view.key}|${live.current.bones}|${width}x${height}`;
      if (key === drawn.current) return;
      drawn.current = key;
      // The scene follows the hips across the slope; height stays true, so the snow stays at z = 0.
      const u = (points[lh * 3] + points[rh * 3]) / 2, v = (points[lh * 3 + 1] + points[rh * 3 + 1]) / 2, hipZ = (points[lh * 3 + 2] + points[rh * 3 + 2]) / 2;
      const local = points.slice();
      for (let k = 0; k < motion.pointCount; k++) { local[k * 3] -= u; local[k * 3 + 1] -= v; }
      scene.figure.setPose(local, motion.index);
      const below = STAGE_FRAME_HEIGHT * .05;
      const shot: Shot = { rect: { x: 0, y: 0, width: 1, height: 1 }, axes, slopeDeg: motion.motion.pitchDeg, frameHeight: STAGE_FRAME_HEIGHT,
        focus: [-axes.up[0] * below, -axes.up[1] * below, hipZ - axes.up[2] * below], snowAt: [u, v], figures: [scene.figure],
        ribbons: skiRibbons(motion, n, phase, advance, u, v), groomed: !bumpField(motion), snowLevel: snowLevelAt(motion, phase), bumps: bumpField(motion) };
      scene.stage.render([shot]);
      context.clearRect(0, 0, width, height);
      if (live.current.bones) {
        const toCanvas = scene.project(shot, width, height);
        const at = (k: number) => toCanvas(local[k * 3], local[k * 3 + 1], local[k * 3 + 2]);
        drawBones(context, motionBones(motion).map(([p, q]) => [at(p), at(q)] as const), Array.from({ length: 18 }, (_, k) => at(k + 5)), STANDARD_BONES, fineBonesUnit(height, ratio));
      }
      context.fillStyle = "rgba(20, 30, 45, 0.82)";
      caption();
      return;
    }

    // The 3D skier is on its way: no flat one in the meantime.
    if (live.current.mode === "loading") { context.clearRect(0, 0, width, height); return; }
    const a = projectPoint(points, lh, axes), b = projectPoint(points, rh, axes);
    const hipX = (a[0] + b[0]) / 2, hipY = (a[1] + b[1]) / 2;
    const unit = height * .4, metre = unit / 1.15, cx = width / 2, cy = height * .4;
    const toCanvas = (p: [number, number]): Point => [cx + (p[0] - hipX) * metre, cy + (p[1] - hipY) * metre];

    context.clearRect(0, 0, width, height);
    // Marks fixed on the snow, so the slope visibly passes under the skier.
    const hipWorld = [(points[lh * 3] + points[rh * 3]) / 2, (points[lh * 3 + 1] + points[rh * 3 + 1]) / 2];
    context.fillStyle = "rgba(255, 255, 255, 0.13)";
    const cell = 1.6;
    for (let i = -14; i <= 14; i++) for (let j = -14; j <= 14; j++) {
      const gu = Math.round(hipWorld[0] / cell) + i, gv = Math.round(hipWorld[1] / cell) + j;
      const seed = Math.sin(gu * 12.9898 + gv * 78.233) * 43758.5453, jitter = seed - Math.floor(seed);
      const [x, y] = toCanvas(projectPoint([gu * cell + jitter * cell, gv * cell + (jitter * 7 % 1) * cell, 0], 0, axes));
      if (x > -10 && x < width + 10 && y > -10 && y < height + 10) { context.beginPath(); context.arc(x, y, 1.3 * ratio, 0, Math.PI * 2); context.fill(); }
    }
    // The tracks the skis have left: the turn's shape on the snow.
    const { left_ski_tip_a: la, left_ski_tail_a: lt, right_ski_tip_a: ra, right_ski_tail_a: rt } = motion.index;
    context.lineCap = "round";
    context.lineJoin = "round";
    for (const [tip, tail] of [[la, lt], [ra, rt]]) {
      for (let turn = n - TRACK_TURNS; turn <= n; turn++) {
        const shift = turnOrigin(turn, advance);
        context.strokeStyle = `rgba(160, 205, 255, ${.34 * (1 - (n - turn) / (TRACK_TURNS + 1))})`;
        context.lineWidth = 1.6 * ratio;
        context.beginPath();
        const last = turn === n ? phase : 1;
        for (let step = 0; step <= 24; step++) {
          const at = last * step / 24;
          const frame = motionPointsAt(motion, at, turn % 2 !== 0);
          const world = [(frame[tip * 3] + frame[tail * 3]) / 2 + shift[0], (frame[tip * 3 + 1] + frame[tail * 3 + 1]) / 2 + shift[1], 0];
          const [x, y] = toCanvas(projectPoint(world, 0, axes));
          if (step === 0) context.moveTo(x, y); else context.lineTo(x, y);
        }
        context.stroke();
      }
    }
    const figure = motionFigure(motion, points, axes, toCanvas, unit);
    drawSkierFigure(context, figure, STANDARD_STYLE);
    drawBones(context, motionBones(motion).map(([p, q]) => [figure.at(motion.points[p]), figure.at(motion.points[q])] as const),
      motion.points.slice(5, 23).map(name => figure.at(name)), STANDARD_STYLE.bones, unit);
    context.fillStyle = "rgba(255, 255, 255, 0.82)";
    caption();
  }, [motion, advance, zh]);

  useEffect(() => {
    let frame = 0, last = performance.now();
    const tick = (wall: number) => {
      const dt = Math.min(.1, (wall - last) / 1000);
      last = wall;
      if (live.current.playing) clock.current += dt * live.current.speed;
      draw(clock.current);
      // The slider covers a left and a right turn, then the skier carries on down the slope.
      const loop = motion.motion.durationSec * 2;
      if (sliderRef.current && live.current.playing) sliderRef.current.value = String(Math.round(((clock.current % loop) / loop) * 1000));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [draw, motion]);

  return <div className="space-y-2">
    <div ref={boxRef} className={cn("relative aspect-video overflow-hidden rounded-xl", mode === "flat" ? "bg-[#0d1524]" : "bg-[#e6edf5]", mode === "loading" && "animate-pulse")}>
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" aria-label={zh ? `${motion.level} 级${motion.name.zh}的标准动作` : `Standard ${motion.name.en}, Level ${motion.level}`} />
    </div>
    <input ref={sliderRef} type="range" min={0} max={1000} defaultValue={0} className="w-full accent-[var(--accent)]" aria-label={zh ? "两个弯里的位置" : "Position across two turns"}
      onChange={event => { setPlaying(false); clock.current = Number(event.target.value) / 1000 * motion.motion.durationSec * 2; }} />
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" onClick={() => setPlaying(value => !value)} aria-label={playing ? (zh ? "暂停" : "Pause") : (zh ? "播放" : "Play")}
        className="press flex size-10 items-center justify-center rounded-full bg-accent text-accent-foreground">
        {playing ? <Pause className="size-4" aria-hidden /> : <Play className="size-4 translate-x-px" aria-hidden />}
      </button>
      <div role="group" aria-label={zh ? "观察角度" : "Viewing angle"} className="flex rounded-lg border border-border bg-surface-2 p-0.5">
        {VIEWS.map(option => <button key={option.key} type="button" aria-pressed={view.key === option.key} onClick={() => setView(option)}
          className={cn("min-h-8 rounded-md px-2.5 text-xs font-semibold", view.key === option.key ? "bg-surface text-ink shadow-[var(--shadow-sm)]" : "text-ink-3 hover:text-ink")}>{zh ? option.zh : option.en}</button>)}
      </div>
      <div role="group" aria-label={zh ? "播放速度" : "Playback speed"} className="flex rounded-lg border border-border bg-surface-2 p-0.5">
        {SPEEDS.map(value => <button key={value} type="button" aria-pressed={speed === value} onClick={() => setSpeed(value)}
          className={cn("min-h-8 rounded-md px-2.5 text-xs font-semibold", speed === value ? "bg-surface text-ink shadow-[var(--shadow-sm)]" : "text-ink-3 hover:text-ink")}>{value}×</button>)}
      </div>
      <button type="button" aria-pressed={bones} onClick={() => setBones(value => !value)}
        className={cn("press flex min-h-9 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold", bones ? "bg-accent-soft text-accent" : "text-ink-3 hover:bg-surface-2")}>
        <Bone className="size-3.5" aria-hidden />{zh ? "骨架" : "Skeleton"}
      </button>
    </div>
  </div>;
}

const SPEED_NAMES: Record<string, [string, string]> = { slow: ["慢速", "Slow"], intermediate: ["中速", "Intermediate"], advanced: ["进阶速度", "Advanced"], expert: ["专家速度", "Expert"] };
const PERFORMANCE_NAMES: Record<string, [string, string]> = { steered: ["转向", "Steered"], carved: ["刻滑", "Carved"], skidded: ["搓雪", "Skidded"] };
const METRIC_NAMES: Record<string, [string, string]> = {
  turn_tempo: ["换弯节奏（次/分）", "Turn tempo (per min)"], rotation_rate: ["旋转速率（度/秒）", "Rotation rate (deg/s)"], upper_body_quiet_index: ["上身稳定", "Quiet upper body"],
  parallel_skis: ["双板平行", "Parallel skis"], turn_closure: ["收弯完成度", "Turn closure"], turn_completion_direction: ["收弯方向", "Turn completion"], rhythm_continuity: ["节奏连贯", "Rhythm continuity"],
  edge_angle: ["立刃角度（估算，度）", "Edge angle (estimate, deg)"], edge_change_sync: ["换刃同步（估算，秒）", "Edge change timing (estimate, s)"], flexion_range: ["屈伸幅度（估算）", "Flexion range (estimate)"], inner_ski_lift_pct: ["内板抬起（%）", "Inside ski lift (%)"],
};
const CURVES: { key: string; zh: string; en: string; digits?: number }[] = [
  { key: "headingDeg", zh: "雪板方向（度，0 是山下线）", en: "Ski heading (deg, 0 = fall line)" },
  { key: "leftEdgeDeg", zh: "外侧板立刃（度）", en: "Outside ski edge (deg)" },
  { key: "rightEdgeDeg", zh: "内侧板立刃（度）", en: "Inside ski edge (deg)" },
  { key: "bodyLeanDeg", zh: "身体内倾（度）", en: "Body lean (deg)" },
  { key: "pelvisYawDeg", zh: "髋部朝向（度）", en: "Hip direction (deg)" },
  { key: "shoulderYawDeg", zh: "肩部朝向（度）", en: "Shoulder direction (deg)" },
  { key: "hipHeightM", zh: "髋高（米）", en: "Hip height (m)", digits: 2 },
  { key: "stanceWidthM", zh: "两板间距（米）", en: "Ski spacing (m)", digits: 2 },
  { key: "insideLiftM", zh: "内侧板抬起（米）", en: "Inside ski lift (m)", digits: 2 },
  { key: "wedgeDeg", zh: "两板夹角（度）", en: "Angle between skis (deg)" },
];
const COLUMNS = [0, 5, 10, 15, 20];

function MotionData({ motion, zh }: { motion: StandardMotion; zh: boolean }) {
  const { verification: check, motion: numbers, csia, curves } = motion;
  const rows = Object.entries(check.metrics).filter(([, row]) => row.shown);
  const used = CURVES.filter(curve => curves[curve.key] && curves[curve.key].some(value => Math.abs(value) > .004));
  return <div className="space-y-5">
    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
      {[[zh ? "每个弯用时" : "Per turn", `${numbers.durationSec.toFixed(2)} ${zh ? "秒" : "s"}`],
        [zh ? "弯的宽度" : "Turn width", `${numbers.turnWidthM} ${zh ? "米" : "m"}`],
        [zh ? "雪板最大转向" : "Max ski heading", `±${Math.round(numbers.headingDeg)}°`],
        [zh ? "速度、方式" : "Speed, style", `${(SPEED_NAMES[csia.speed] ?? [csia.speed, csia.speed])[zh ? 0 : 1]} · ${(PERFORMANCE_NAMES[csia.performance] ?? [csia.performance, csia.performance])[zh ? 0 : 1]}`]].map(([label, value]) =>
        <div key={label}><dt className="text-xs text-ink-3">{label}</dt><dd className="font-semibold" data-numeric>{value}</dd></div>)}
    </dl>
    <section className="space-y-1.5">
      <h3 className="text-sm font-semibold">{zh ? "指南要求" : "What the guide asks"} <span className="font-normal text-ink-3">{csia.source}</span></h3>
      <ul className="list-disc space-y-0.5 pl-5 text-sm text-ink-2">{csia.qualitiesZh.map(item => <li key={item}>{item}</li>)}</ul>
      {motion.notesZh.map(note => <p key={note} className="text-sm text-ink-2">{note}</p>)}
    </section>
    <section className="space-y-1.5">
      <h3 className="text-sm font-semibold">{zh ? "这串数据（一个右转，从换刃到换刃）" : "The data (one right turn, edge change to edge change)"}</h3>
      <div className="overflow-x-auto"><table className="w-full min-w-[30rem] text-left text-xs">
        <thead className="text-ink-3"><tr><th className="py-1 pr-3 font-medium">{zh ? "进度" : "Progress"}</th>{COLUMNS.map(i => <th key={i} className="px-2 py-1 text-right font-medium">{i * 5}%</th>)}</tr></thead>
        <tbody>{used.map(curve => <tr key={curve.key} className="border-t border-border">
          <td className="py-1 pr-3 text-ink-2">{zh ? curve.zh : curve.en}</td>
          {COLUMNS.map(i => <td key={i} className="px-2 py-1 text-right" data-numeric>{curves[curve.key][i].toFixed(curve.digits ?? 0)}</td>)}
        </tr>)}</tbody>
      </table></div>
    </section>
    <section className="space-y-1.5">
      <h3 className="text-sm font-semibold">{zh ? "FreeSki 自己的评分代码怎么评它" : "How FreeSki's own scoring reads it"}
        {check.overall !== null && <span className="ml-2 rounded-full bg-success-bg px-2 py-0.5 text-xs font-semibold text-success" data-numeric>{Math.round(check.overall)}</span>}</h3>
      <div className="overflow-x-auto"><table className="w-full min-w-[30rem] text-left text-xs">
        <thead className="text-ink-3"><tr><th className="py-1 pr-3 font-medium">{zh ? "指标" : "Metric"}</th><th className="px-2 py-1 text-right font-medium">{zh ? "这串数据" : "This data"}</th><th className="px-2 py-1 text-right font-medium">{zh ? "示范常见范围" : "Demonstrations' usual range"}</th><th className="px-2 py-1 text-right font-medium">{zh ? "分" : "Score"}</th></tr></thead>
        <tbody>{rows.map(([key, row]) => <tr key={key} className="border-t border-border">
          <td className="py-1 pr-3 text-ink-2">{(METRIC_NAMES[key] ?? [key, key])[zh ? 0 : 1]}</td>
          <td className="px-2 py-1 text-right" data-numeric>{row.value < 1 ? row.value.toFixed(2) : row.value.toFixed(0)}</td>
          <td className="px-2 py-1 text-right text-ink-3" data-numeric>{row.p75 < 1 ? `${row.p25.toFixed(2)} – ${row.p75.toFixed(2)}` : `${row.p25.toFixed(0)} – ${row.p75.toFixed(0)}`}</td>
          <td className={cn("px-2 py-1 text-right font-semibold", row.score < 75 && "text-amber")} data-numeric>{Math.round(row.score)}</td>
        </tr>)}</tbody>
      </table></div>
      <p className="text-xs leading-relaxed text-ink-3">{check.otherLevel
        ? (zh ? "FreeSki 没有这个级别的示范，这里和相邻级别的示范比，换弯节奏不计入。" : "FreeSki has no demonstration at this level, so this compares with the nearest level; turn tempo is left out.")
        : (zh ? `对比 ${check.clips} 段示范的 ${check.turns} 个弯。收弯和节奏三项读画面里的髋部轨迹，受镜头影响。` : `Compared with ${check.turns} turns from ${check.clips} demonstration clip${check.clips === 1 ? "" : "s"}. The turn-shape and rhythm metrics read the hip path in the picture, which the camera affects.`)}</p>
    </section>
  </div>;
}

/** The generated standard motions: pick an action and level, watch it from any side, read its numbers. */
export function StandardMotionViewer({ zh, initial }: { zh: boolean; initial: StandardMotionId }) {
  const [id, setId] = useState<StandardMotionId>(initial);
  const [motion, setMotion] = useState<StandardMotion | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      const response = await clientFetch(`/standard-motions/${id}.json`, { signal: controller.signal });
      if (!response.ok) throw new Error("motion-unavailable");
      const decoded = decodeStandardMotion(await response.json());
      if (!controller.signal.aborted) { setMotion(decoded); setError(false); }
    })().catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [id]);
  const shown = motion?.id === id ? motion : null;

  return <div className="grid gap-5 lg:grid-cols-[15rem_1fr]">
    <label className="block space-y-1 text-sm font-medium lg:hidden">
      {zh ? "动作和级别" : "Action and level"}
      <select value={id} onChange={event => setId(event.target.value as StandardMotionId)} className="block min-h-11 w-full rounded-lg border border-border bg-surface px-3 text-base">
        {STANDARD_MOTION_GROUPS.flatMap(group => group.levels.map(level => <option key={`${group.action}-l${level}`} value={`${group.action}-l${level}`}>
          {zh ? `${group.zh} · ${level} 级` : `${group.en} · Level ${level}`}</option>))}
      </select>
    </label>
    <nav aria-label={zh ? "动作和级别" : "Actions and levels"} className="hidden space-y-1 lg:sticky lg:top-24 lg:block lg:self-start">
      {STANDARD_MOTION_GROUPS.map(group => <div key={group.action} className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 hover:bg-surface-2">
        <span className="text-sm font-medium">{zh ? group.zh : group.en}</span>
        <span className="flex shrink-0 gap-1">{group.levels.map(level => {
          const value = `${group.action}-l${level}` as StandardMotionId;
          return <button key={level} type="button" aria-pressed={id === value} onClick={() => setId(value)} aria-label={zh ? `${group.zh} ${level} 级` : `${group.en} Level ${level}`}
            className={cn("press min-h-8 min-w-8 rounded-md text-xs font-semibold", id === value ? "bg-accent text-accent-foreground" : "bg-surface-2 text-ink-2 hover:text-ink")}>L{level}</button>;
        })}</span>
      </div>)}
    </nav>
    <div className="min-w-0 space-y-4">
      {error && <p role="status" className="text-sm text-ink-3">{zh ? "这个动作的数据暂时打不开。" : "This motion could not be loaded."}</p>}
      {!shown && !error && <div className="aspect-video w-full animate-pulse rounded-xl bg-surface-2" aria-label={zh ? "正在加载" : "Loading"} />}
      {shown && <>
        <h2 className="text-lg font-semibold">{zh ? `${shown.level} 级 · ${shown.name.zh}` : `Level ${shown.level} · ${shown.name.en}`}</h2>
        <MotionStage key={shown.id} motion={shown} zh={zh} />
        <MotionData motion={shown} zh={zh} />
      </>}
    </div>
  </div>;
}
