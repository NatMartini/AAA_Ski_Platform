"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Pause, Play } from "lucide-react";
import { decodeStandardMotion, motionBones, type StandardMotion, type StandardMotionId } from "@/lib/freeski/standard-motion";
import type { DiagramKind } from "@/lib/freeski/technique-faults";
import { backView, edgeChange, G, hipTravel, shapedPath, topView, type BackView, type FaultVariant, type Flat, type Side, type TopView } from "@/lib/freeski/technique-forces";
import { clientFetch } from "@/lib/client-fetch";
import { cn } from "@/lib/utils";

/**
 * The pictures of the movement explanations: the standard skier beside the same skier making the fault, with the
 * forces on them through two linked turns, and charts of what the video measures. All drawn from the standard motion.
 */

const STANDARD = "#1a9c64", FAULT = "#e9791a", PUSH = "#2f6ad0", WARN = "#d63b3b", NET = "#8b5cf6";

/** The standard motion an explanation draws, loaded once per id. */
export function useStandardMotion(id: StandardMotionId | null) {
  const [motion, setMotion] = useState<StandardMotion | null>(null);
  useEffect(() => {
    if (!id) return;
    const controller = new AbortController();
    void (async () => {
      const response = await clientFetch(`/standard-motions/${id}.json`, { signal: controller.signal });
      if (!response.ok) throw new Error("motion-unavailable");
      const decoded = decodeStandardMotion(await response.json());
      if (!controller.signal.aborted) setMotion(decoded);
    })().catch(() => undefined);
    return () => controller.abort();
  }, [id]);
  return motion && motion.id === id ? motion : null;
}

/** Time through two linked turns, in turns: 0 to 1 the right turn, 1 to 2 the left one. */
function useTurnTime(motion: StandardMotion, start: number) {
  const [time, setTime] = useState(start);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (!playing) return;
    let frame = 0, last = performance.now();
    const step = (now: number) => {
      // Slower than skied, so the forces can be followed.
      const turns = (now - last) / 1000 / (motion.motion.durationSec * 3);
      last = now;
      setTime(value => (value + turns) % 2);
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [playing, motion]);
  return { time, setTime, playing, setPlaying };
}
const turnAt = (time: number) => ({ phase: time - Math.floor(time), mirrored: Math.floor(time) % 2 === 1 });

function TurnTimeBar({ zh, motion, time, onTime, playing, onPlaying }: {
  zh: boolean; motion: StandardMotion; time: number; onTime: (time: number) => void; playing: boolean; onPlaying: (playing: boolean) => void;
}) {
  const apex = motion.motion.apexPhase;
  const marks: [number, string][] = [[0, zh ? "换刃" : "Edge change"], [apex, zh ? "右弯弯中" : "Right turn"], [1, zh ? "换刃" : "Edge change"],
    [1 + apex, zh ? "左弯弯中" : "Left turn"]];
  return <div className="flex items-start gap-2">
    <button type="button" onClick={() => onPlaying(!playing)} aria-label={playing ? (zh ? "暂停" : "Pause") : (zh ? "播放两个弯" : "Play two turns")}
      className="press flex size-9 shrink-0 items-center justify-center rounded-full border border-border bg-surface text-ink-2 hover:text-ink">
      {playing ? <Pause className="size-4" aria-hidden /> : <Play className="size-4" aria-hidden />}</button>
    <div className="min-w-0 flex-1">
      <input type="range" min={0} max={1.995} step={.005} value={time} aria-label={zh ? "转弯进度" : "Turn progress"}
        onChange={event => { onPlaying(false); onTime(Number(event.target.value)); }} className="block h-6 w-full accent-[var(--accent)]" />
      <div className="relative h-5">{marks.map(([at, label]) => <button key={at} type="button" onClick={() => { onPlaying(false); onTime(at); }}
        style={{ left: `${at / 2 * 100}%` }}
        className={cn("absolute -translate-x-1/2 whitespace-nowrap rounded px-1 text-[11px] text-ink-3 hover:text-ink", at === 0 && "translate-x-0")}>{label}</button>)}</div>
    </div>
  </div>;
}

/** An arrow in pixels. */
function Arrow({ from, to, color, width = 2.5, dashed = false, halo = false }: { from: Flat; to: Flat; color: string; width?: number; dashed?: boolean; halo?: boolean }) {
  const dx = to[0] - from[0], dy = to[1] - from[1], length = Math.hypot(dx, dy);
  if (length < 3) return null;
  const ux = dx / length, uy = dy / length, head = Math.min(9, length * .45), base: Flat = [to[0] - ux * head, to[1] - uy * head];
  const tip = `${to[0]},${to[1]} ${base[0] - uy * head * .5},${base[1] + ux * head * .5} ${base[0] + uy * head * .5},${base[1] - ux * head * .5}`;
  return <g>
    {/* A halo in the background colour keeps an arrow readable where it crosses the skier. */}
    {halo && <g stroke="var(--surface)" strokeWidth={3} strokeLinejoin="round" fill="var(--surface)">
      <line x1={from[0]} y1={from[1]} x2={base[0]} y2={base[1]} strokeWidth={width + 3} strokeLinecap="round" />
      <polygon points={tip} />
    </g>}
    <line x1={from[0]} y1={from[1]} x2={base[0]} y2={base[1]} stroke={color} strokeWidth={width} strokeLinecap="round" strokeDasharray={dashed ? "5 4" : undefined} />
    <polygon points={tip} fill={color} />
  </g>;
}

/** A panel's caption: its name with a colour dot, then its lines. */
function Caption({ tone, title, children }: { tone: string; title: string; children?: ReactNode }) {
  return <div className="space-y-0.5 text-xs leading-snug">
    <p className="flex items-center gap-1.5 font-semibold"><span className="size-2.5 shrink-0 rounded-full" style={{ background: tone }} aria-hidden />{title}</p>
    {children}
  </div>;
}

const BACK = { width: 240, height: 236, base: 192, force: .052 };

/** One skier seen from behind with the snow's push on each ski, gravity, and the push that carries them round the arc. */
type Frame = { x: number; scale: number; top: number };

/** One scale for both panels through both turns, so the skier stays in the picture however far they lean. */
function backFrame(motion: StandardMotion, variant: FaultVariant): Frame {
  let low = 0, high = 0, top = 1.8;
  for (let i = 0; i < 24; i++) {
    const { phase, mirrored } = turnAt(i / 12);
    for (const shown of ["correct", variant] as const) {
      const view = backView(motion, phase, mirrored, shown);
      for (const [x, y] of [...view.points, view.cop]) { low = Math.min(low, x); high = Math.max(high, x); top = Math.max(top, y); }
    }
  }
  const scale = Math.min(84, (BACK.width - 16) / Math.max(.5, high - low), (BACK.base - 18) / top);
  return { scale, x: BACK.width / 2 - (low + high) / 2 * scale, top };
}

function BackViewSvg({ motion, view, frame, tone, zh, label }: { motion: StandardMotion; view: BackView; frame: Frame; tone: string; zh: boolean; label: string }) {
  const { width, height, base, force } = BACK, { x, scale } = frame;
  // Crop the sky above the highest the skier gets.
  const sky = Math.max(0, Math.floor(base - frame.top * scale - 16));
  const px = (p: Flat): Flat => [x + p[0] * scale, base - p[1] * scale];
  const at = (name: string) => px(view.points[motion.index[name]]);
  const along = (from: Flat, vector: Flat, size: number): Flat => [from[0] + vector[0] * size * scale, from[1] - vector[1] * size * scale];
  const head = (["nose", "left_ear", "right_ear"].map(name => view.points[motion.index[name]]))
    .reduce<Flat>((sum, p) => [sum[0] + p[0] / 3, sum[1] + p[1] / 3], [0, 0]);
  const snowA = px([view.snow.through[0] - view.snow.along[0] * 3, view.snow.through[1] - view.snow.along[1] * 3]);
  const snowB = px([view.snow.through[0] + view.snow.along[0] * 3, view.snow.through[1] + view.snow.along[1] * 3]);
  const com = px(view.com), cop = px(view.cop), holds = view.holds === "on" || view.holds === "air";
  const reach: Flat = [com[0] + (com[0] - cop[0]) * .3, com[1] + (com[1] - cop[1]) * .3];
  const torso = ["left_shoulder", "right_shoulder", "right_hip", "left_hip"].map(at);
  const inside: Side = view.outside === "left" ? "right" : "left";
  return <svg viewBox={`0 ${sky} ${width} ${height - sky}`} className="block h-auto w-full" role="img" aria-label={label}>
    <polygon points={`${snowA[0]},${snowA[1]} ${snowB[0]},${snowB[1]} ${snowB[0]},${height + 40} ${snowA[0]},${height + 40}`} fill="var(--surface-2)" stroke="var(--border-strong)" />
    {(["left", "right"] as Side[]).map(side => <g key={side}>
      <line x1={at(`${side}_wrist`)[0]} y1={at(`${side}_wrist`)[1]} x2={at(`${side}_pole_tip`)[0]} y2={at(`${side}_pole_tip`)[1]} stroke="var(--ink-3)" strokeWidth={1.5} />
    </g>)}
    <polygon points={torso.map(p => p.join(",")).join(" ")} fill={tone} fillOpacity={.9} />
    {motionBones(motion).map(([a, b], i) => {
      const p = px(view.points[a]), q = px(view.points[b]);
      return <line key={i} x1={p[0]} y1={p[1]} x2={q[0]} y2={q[1]} stroke={tone} strokeWidth={4.5} strokeLinecap="round" />;
    })}
    <circle cx={px(head)[0]} cy={px(head)[1]} r={9.5} fill={tone} />
    {(["left", "right"] as Side[]).map(side => {
      const [a, b] = view.skis[side].map(px);
      return <line key={side} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke="var(--ink)" strokeWidth={5} strokeLinecap="round" />;
    })}
    {view.holds !== "air" && <line x1={cop[0]} y1={cop[1]} x2={reach[0]} y2={reach[1]} stroke={holds ? PUSH : WARN} strokeWidth={1.5} strokeDasharray="4 4" />}
    {(["left", "right"] as Side[]).map(side => {
      const from = px(view.skis[side][0]), share = view.load[side];
      const to = along(from, view.push, share * force);
      return share > .02 && <Arrow key={side} from={from} to={to} color={PUSH} width={2 + share * 3} halo />;
    })}
    <Arrow from={com} to={along(com, view.gravity, force)} color="var(--ink-2)" halo />
    <text x={along(com, view.gravity, force)[0] + 6} y={along(com, view.gravity, force)[1] + 4} fontSize={12} fill="var(--ink-2)">{zh ? "重力" : "gravity"}</text>
    {view.holds !== "air" && <Arrow from={com} to={along(com, view.turning, force)} color={NET} width={2} dashed halo />}
    <circle cx={com[0]} cy={com[1]} r={5} fill="var(--surface)" stroke="var(--ink)" strokeWidth={1.5} />
    <path d={`M${com[0] - 5},${com[1]} h10 M${com[0]},${com[1] - 5} v10`} stroke="var(--ink)" strokeWidth={1.2} />
    {view.holds !== "air" && <circle cx={cop[0]} cy={cop[1]} r={4} fill={holds ? PUSH : WARN} />}
    {(["left", "right"] as Side[]).map(side => {
      // Each ski's name and load under it, the outside one toward the outside of the turn so the two never meet.
      const p = px(view.skis[side][0]), outward = (side === view.outside ? 1 : -1) * Math.sign(px(view.skis[view.outside][0])[0] - px(view.skis[inside][0])[0] || 1);
      return <text key={side} x={p[0] + outward * 10} y={Math.min(height - 4, p[1] + 20)} textAnchor={outward > 0 ? "start" : "end"} fontSize={13} fontWeight={700}
        fill={view.holds === "air" ? "var(--ink-3)" : PUSH}>{side === view.outside ? (zh ? "外" : "out") : (zh ? "内" : "in")} {Math.round(view.load[side] * 100)}%</text>;
    })}
  </svg>;
}

function backLines(view: BackView, zh: boolean) {
  const inside: Side = view.outside === "left" ? "right" : "left";
  const load = `${zh ? "外侧板" : "Outside ski"} ${Math.round(view.load[view.outside] * 100)}% · ${zh ? "内侧板" : "inside"} ${Math.round(view.load[inside] * 100)}%`;
  const edge = `${zh ? "立刃 外" : "Edges: out"} ${Math.round(view.edge[view.outside])}° · ${zh ? "内" : "in"} ${Math.round(view.edge[inside])}°`;
  const warning = view.holds === "out" ? (zh ? "合力落在外侧板之外：板子撑不住，向外滑" : "The push lands outside the outside ski: the skis cannot hold it and slide out")
    : view.holds === "in" ? (zh ? "合力落在内侧板之内：人往弯里倒" : "The push lands inside the inside ski: the skier falls into the turn")
    : view.holds === "air" ? (zh ? "腾空：雪面没有推力" : "In the air: no push from the snow") : null;
  return <>
    <p className="text-ink-2" data-numeric>{load}</p>
    <p className="text-ink-3" data-numeric>{edge}</p>
    {warning && <p className="font-semibold" style={{ color: WARN }}>{warning}</p>}
  </>;
}

const TOP = { width: 220, height: 210, x: 110, y: 105, scale: 64 };

function TopViewSvg({ view, tone, zh, label }: { view: TopView; tone: string; zh: boolean; label: string }) {
  const { width, height, x, y, scale } = TOP;
  const px = (p: Flat): Flat => [x + p[0] * scale, y + p[1] * scale];
  const middle = (a: Flat, b: Flat): Flat => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const chestFrom = px(middle(...view.shoulders)), chestTo: Flat = [chestFrom[0] + view.chest[0] * .7 * scale, chestFrom[1] + view.chest[1] * .7 * scale];
  const skiFrom = px([0, 0]), skiTo: Flat = [skiFrom[0] + view.travel[0] * 1.25 * scale, skiFrom[1] + view.travel[1] * 1.25 * scale];
  return <svg viewBox={`0 0 ${width} ${height}`} className="block h-auto w-full" role="img" aria-label={label}>
    <rect width={width} height={height} rx={10} fill="var(--surface-2)" />
    <g opacity={.75}><Arrow from={[width - 16, 18]} to={[width - 16, 62]} color="var(--ink-3)" width={1.5} /></g>
    <text x={width - 22} y={14} textAnchor="end" fontSize={11} fill="var(--ink-3)">{zh ? "山下" : "downhill"}</text>
    {(["left", "right"] as Side[]).map(side => {
      const [tail, tip] = view.skis[side].map(px);
      return <line key={side} x1={tail[0]} y1={tail[1]} x2={tip[0]} y2={tip[1]} stroke="var(--ink)" strokeWidth={6} strokeLinecap="round" />;
    })}
    <Arrow from={skiFrom} to={skiTo} color="var(--ink-3)" width={1.5} dashed />
    <line x1={px(view.hips[0])[0]} y1={px(view.hips[0])[1]} x2={px(view.hips[1])[0]} y2={px(view.hips[1])[1]} stroke={tone} strokeOpacity={.6} strokeWidth={6} strokeLinecap="round" />
    <line x1={px(view.shoulders[0])[0]} y1={px(view.shoulders[0])[1]} x2={px(view.shoulders[1])[0]} y2={px(view.shoulders[1])[1]} stroke={tone} strokeWidth={8} strokeLinecap="round" />
    <Arrow from={chestFrom} to={chestTo} color={tone} width={3} />
  </svg>;
}

function separationLine(view: TopView, zh: boolean) {
  const degrees = Math.round(Math.abs(view.separation));
  if (view.separation >= 3) return zh ? `胸口比雪板更朝山下 ${degrees}°（上下身分离）` : `Chest faces ${degrees}° more downhill than the skis (separation)`;
  if (view.separation <= -3) return zh ? `胸口转进弯里，领先雪板 ${degrees}°` : `Chest turned ${degrees}° into the turn, ahead of the skis`;
  return zh ? "胸口和雪板朝同一个方向" : "Chest and skis face the same way";
}

/** The standard and a fault side by side, through two linked turns. */
function SkierPair({ motion, zh, kind, faultName }: { motion: StandardMotion; zh: boolean; kind: "upper_body" | "tipping_inside" | "inside_lag" | "flat_edges"; faultName: string }) {
  const clock = useTurnTime(motion, kind === "upper_body" ? .8 : motion.motion.apexPhase);
  const { phase, mirrored } = turnAt(clock.time);
  const variant: FaultVariant = kind;
  const frame = useMemo(() => backFrame(motion, variant), [motion, variant]);
  const standardName = zh ? "标准动作" : "The standard";
  if (kind === "upper_body") {
    const good = topView(motion, phase, mirrored, "correct"), bad = topView(motion, phase, mirrored, variant);
    return <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5"><TopViewSvg view={good} tone={STANDARD} zh={zh} label={standardName} />
          <Caption tone={STANDARD} title={standardName}><p className="text-ink-2">{separationLine(good, zh)}</p></Caption></div>
        <div className="space-y-1.5"><TopViewSvg view={bad} tone={FAULT} zh={zh} label={faultName} />
          <Caption tone={FAULT} title={faultName}><p className="text-ink-2">{separationLine(bad, zh)}</p></Caption></div>
      </div>
      <p className="text-xs text-ink-3">{zh ? "从上往下看：黑线是雪板，粗彩线是肩，淡彩线是髋，箭头是胸口朝向，虚线是雪板方向。"
        : "From above: black lines are the skis, the thick coloured line the shoulders, the pale one the hips; the arrow is where the chest faces, the dashed line where the skis point."}</p>
      <TurnTimeBar zh={zh} motion={motion} time={clock.time} onTime={clock.setTime} playing={clock.playing} onPlaying={clock.setPlaying} />
    </div>;
  }
  const good = backView(motion, phase, mirrored, "correct"), bad = backView(motion, phase, mirrored, variant);
  return <div className="space-y-3">
    <div className="grid grid-cols-2 gap-3">
      <div className="space-y-1.5"><BackViewSvg motion={motion} view={good} frame={frame} tone={STANDARD} zh={zh} label={standardName} />
        <Caption tone={STANDARD} title={standardName}>{backLines(good, zh)}</Caption></div>
      <div className="space-y-1.5"><BackViewSvg motion={motion} view={bad} frame={frame} tone={FAULT} zh={zh} label={faultName} />
        <Caption tone={FAULT} title={faultName}>{backLines(bad, zh)}</Caption></div>
    </div>
    <ForceKey zh={zh} />
    <TurnTimeBar zh={zh} motion={motion} time={clock.time} onTime={clock.setTime} playing={clock.playing} onPlaying={clock.setPlaying} />
  </div>;
}

function ForceKey({ zh }: { zh: boolean }) {
  const item = (color: string, text: string, dashed = false) => <span className="inline-flex items-center gap-1.5">
    <svg width={22} height={8} aria-hidden><line x1={1} y1={4} x2={21} y2={4} stroke={color} strokeWidth={2.5} strokeDasharray={dashed ? "4 3" : undefined} /></svg>{text}</span>;
  return <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-3">
    {item(PUSH, zh ? "雪面对每只板的推力（粗细=承重）" : "The snow's push on each ski (width = load)")}
    {item("var(--ink-2)", zh ? "重力" : "Gravity")}
    {item(NET, zh ? "两者合起来指向弯心：让人转弯的力" : "Together, toward the turn's centre: what turns the skier", true)}
    <span>{zh ? "⊕ 重心 · 圆点：合力落在雪面的位置。从背后看，按标准动作的弧线算的示意，不是你的测量值。"
      : "⊕ centre of mass · dot: where the push meets the snow. Seen from behind; worked out for the standard's arc as an illustration, not your measurement."}</span>
  </p>;
}

/** Round turns beside Z turns, with the sideways push each needs along the way. */
function TurnShapeChart({ motion, zh }: { motion: StandardMotion; zh: boolean }) {
  const shapes = useMemo(() => ({ round: shapedPath(motion, "round", 2), z: shapedPath(motion, "z", 2) }), [motion]);
  const width = 320, pathHeight = 200, chartTop = 222, chartHeight = 70;
  const across = Math.max(...[...shapes.round.points, ...shapes.z.points].map(p => Math.abs(p[0]))) || 1;
  const down = Math.max(...[...shapes.round.points, ...shapes.z.points].map(p => p[1])) || 1;
  const peak = Math.max(...shapes.z.sideways, ...shapes.round.sideways) / G;
  const top = Math.max(1, Math.ceil(peak));
  const draw = (shape: "round" | "z", centre: number, tone: string) => {
    const { points, sideways } = shapes[shape];
    const px = points.map(([x, y]): Flat => [centre + x / across * 58, 12 + y / down * (pathHeight - 20)]);
    return <g>
      <polyline points={px.map(p => p.join(",")).join(" ")} fill="none" stroke={tone} strokeWidth={3} strokeLinejoin="round" />
      {px.map((p, i) => {
        if (i === 0 || i === px.length - 1 || i % 4 !== 0) return null;
        const bend: Flat = [px[i + 1][0] - 2 * p[0] + px[i - 1][0], px[i + 1][1] - 2 * p[1] + px[i - 1][1]], length = Math.hypot(...bend);
        const size = Math.min(48, sideways[i] / G * 16);
        if (length < 1e-3 || size < 3) return null;
        return <Arrow key={i} from={p} to={[p[0] + bend[0] / length * size, p[1] + bend[1] / length * size]} color={PUSH} width={1.8} />;
      })}
    </g>;
  };
  const line = (shape: "round" | "z", tone: string) => {
    const { sideways, times } = shapes[shape], end = times[times.length - 1] || 1;
    return <polyline points={sideways.map((value, i) => `${16 + times[i] / end * (width - 24)},${chartTop + chartHeight - value / G / top * chartHeight}`).join(" ")}
      fill="none" stroke={tone} strokeWidth={2} />;
  };
  const ratio = Math.max(...shapes.z.sideways) / Math.max(1e-6, Math.max(...shapes.round.sideways));
  return <div className="space-y-2">
    <svg viewBox={`0 0 ${width} ${chartTop + chartHeight + 18}`} className="block h-auto w-full max-w-md" role="img"
      aria-label={zh ? "圆弧弯和 Z 字弯的路线与侧向力" : "Round and Z-shaped turns with their sideways force"}>
      <text x={80} y={10} textAnchor="middle" fontSize={12} fontWeight={700} fill={STANDARD}>{zh ? "圆弧弯" : "Round"}</text>
      <text x={240} y={10} textAnchor="middle" fontSize={12} fontWeight={700} fill={FAULT}>{zh ? "Z 字弯" : "Z-shaped"}</text>
      {draw("round", 80, STANDARD)}
      {draw("z", 240, FAULT)}
      <line x1={16} y1={chartTop + chartHeight} x2={width - 8} y2={chartTop + chartHeight} stroke="var(--border-strong)" />
      <line x1={16} y1={chartTop + chartHeight - chartHeight / top} x2={width - 8} y2={chartTop + chartHeight - chartHeight / top} stroke="var(--border)" strokeDasharray="3 3" />
      <text x={18} y={chartTop + chartHeight - chartHeight / top - 3} fontSize={10} fill="var(--ink-3)">1 g</text>
      <text x={18} y={chartTop - 4} fontSize={11} fill="var(--ink-3)">{zh ? "雪板要承受的侧向力，随时间" : "Sideways force on the skis over time"}</text>
      {line("round", STANDARD)}
      {line("z", FAULT)}
    </svg>
    <p className="text-xs text-ink-3">{zh ? `蓝色箭头是保持在这条线上需要的侧向力。Z 字弯把转向挤在一瞬间，最大侧向力约是圆弧弯的 ${ratio.toFixed(1)} 倍：刃抓不住，板子就横着擦雪。示意，按标准动作的速度和用时画。`
      : `Blue arrows are the sideways push needed to stay on the line. A Z turn crams the turning into a moment, so its peak sideways force is about ${ratio.toFixed(1)}× a round turn's: the edges cannot hold it and the skis skid. An illustration at the standard's speed and timing.`}</p>
  </div>;
}

/** Each turn's duration: the student's turns against the standard's steady tempo, or an illustration of each. */
function RhythmChart({ motion, zh, durations }: { motion: StandardMotion; zh: boolean; durations?: number[] | null }) {
  const standard = motion.motion.durationSec;
  const yours = durations && durations.length >= 3 ? durations.slice(0, 16) : null;
  const rows: { name: string; tone: string; values: number[] }[] = yours
    ? [{ name: zh ? "你的每个弯" : "Your turns", tone: FAULT, values: yours }]
    : [{ name: zh ? "稳定" : "Steady", tone: STANDARD, values: Array(6).fill(standard) },
      { name: zh ? "不稳" : "Uneven", tone: FAULT, values: [1, 1.4, .75, 1.25, .8, 1.35].map(share => share * standard) }];
  const width = 320, rowHeight = 86, top = Math.max(standard * 1.6, ...rows.flatMap(row => row.values)) * 1.05;
  return <div className="space-y-2">
    <svg viewBox={`0 0 ${width} ${rows.length * rowHeight + 6}`} className="block h-auto w-full max-w-md" role="img" aria-label={zh ? "每个弯的用时" : "Each turn's duration"}>
      {rows.map((row, r) => {
        const base = r * rowHeight + rowHeight - 14, slot = (width - 70) / row.values.length;
        const y = (value: number) => base - value / top * (rowHeight - 26);
        return <g key={row.name}>
          <text x={0} y={base - (rowHeight - 26) / 2} fontSize={12} fontWeight={700} fill={row.tone}>{row.name}</text>
          {row.values.map((value, i) => <rect key={i} x={64 + i * slot + slot * .15} y={y(value)} width={slot * .7} height={base - y(value)} rx={2} fill={row.tone} fillOpacity={.85} />)}
          <line x1={62} y1={y(standard)} x2={width} y2={y(standard)} stroke={STANDARD} strokeWidth={1.5} strokeDasharray="5 4" />
          <line x1={62} y1={base} x2={width} y2={base} stroke="var(--border-strong)" />
        </g>;
      })}
    </svg>
    <p className="text-xs text-ink-3" data-numeric>{yours
      ? (zh ? `柱子是你每个弯的用时，最快 ${Math.min(...yours).toFixed(1)} 秒、最慢 ${Math.max(...yours).toFixed(1)} 秒；绿色虚线是标准动作的 ${standard.toFixed(1)} 秒。用时差得越多，每个弯的受力越不一样。`
        : `Bars are your turns' durations, ${Math.min(...yours).toFixed(1)} s to ${Math.max(...yours).toFixed(1)} s; the green dashed line is the standard's ${standard.toFixed(1)} s. The more they differ, the more each turn's forces differ.`)
      : (zh ? `柱子是每个弯的用时，绿色虚线是标准动作的 ${standard.toFixed(1)} 秒。` : `Bars are each turn's duration; the green dashed line is the standard's ${standard.toFixed(1)} s.`)}</p>
  </div>;
}

/** Both skis' edge angles across an edge change, together and with the downhill ski a beat late. */
function EdgeTimingChart({ motion, zh }: { motion: StandardMotion; zh: boolean }) {
  const together = useMemo(() => edgeChange(motion), [motion]), late = useMemo(() => edgeChange(motion, .12), [motion]);
  const top = Math.max(10, ...together.flatMap(sample => [Math.abs(sample.left), Math.abs(sample.right)]));
  const panel = (samples: typeof together, tone: string, title: string, offset: number) => {
    const width = 150, height = 120, mid = 70;
    const x = (t: number) => offset + 6 + (t - samples[0].t) / (samples[samples.length - 1].t - samples[0].t) * (width - 12);
    const y = (edge: number) => mid - edge / top * 46;
    const crossed = samples.filter(sample => Math.sign(sample.left) !== Math.sign(sample.right) && Math.abs(sample.left) > 2 && Math.abs(sample.right) > 2);
    return <g>
      <text x={offset + width / 2} y={12} textAnchor="middle" fontSize={12} fontWeight={700} fill={tone}>{title}</text>
      {crossed.length > 0 && <rect x={x(crossed[0].t)} y={20} width={Math.max(2, x(crossed[crossed.length - 1].t) - x(crossed[0].t))} height={height - 20} fill={WARN} fillOpacity={.14} />}
      {crossed.length > 0 && <text x={(x(crossed[0].t) + x(crossed[crossed.length - 1].t)) / 2} y={height + 10} textAnchor="middle" fontSize={10} fill={WARN}>{zh ? "两板反向立刃" : "Opposite edges"}</text>}
      <line x1={offset + 6} y1={mid} x2={offset + width - 6} y2={mid} stroke="var(--border-strong)" />
      <line x1={x(0)} y1={20} x2={x(0)} y2={height} stroke="var(--border)" strokeDasharray="3 3" />
      <polyline points={samples.map(sample => `${x(sample.t)},${y(sample.left)}`).join(" ")} fill="none" stroke={tone} strokeWidth={2.2} />
      <polyline points={samples.map(sample => `${x(sample.t)},${y(sample.right)}`).join(" ")} fill="none" stroke={tone} strokeWidth={2.2} strokeDasharray="5 3" />
    </g>;
  };
  return <div className="space-y-2">
    <svg viewBox="0 0 320 136" className="block h-auto w-full max-w-md" role="img" aria-label={zh ? "换刃时两只板的立刃角" : "Both skis' edge angles at the edge change"}>
      {panel(together, STANDARD, zh ? "两板同时换刃" : "Together", 0)}
      {panel(late, FAULT, zh ? "下方板慢一拍" : "Downhill ski late", 170)}
    </svg>
    <p className="text-xs text-ink-3">{zh ? "实线是左板、虚线是右板的立刃角，横线以上是右弯的刃、以下是左弯的刃，竖虚线是换刃。红色那段两只板立在相反的刃上，各往一边切，板子会分开或者互相顶住。"
      : "Solid is the left ski's edge angle, dashed the right's; above the line is the right turn's edges, below the left turn's, and the dotted line is the edge change. In the red stretch the skis stand on opposite edges and cut apart or block each other."}</p>
  </div>;
}

/** The hips' height through two turns, flexing and extending against stiff legs. */
function FlexionChart({ motion, zh }: { motion: StandardMotion; zh: boolean }) {
  const samples = useMemo(() => hipTravel(motion), [motion]);
  const low = Math.min(...samples.map(sample => sample.flexing)), high = Math.max(...samples.map(sample => sample.flexing));
  const span = Math.max(.05, high - low), width = 320, height = 130;
  const x = (t: number) => 14 + t / 2 * (width - 28), y = (value: number) => 22 + (high + span * .1 - value) / (span * 1.2) * (height - 40);
  // Where the first turn is lowest and highest: most turns flex through the middle and extend to change edges, bumps the other way round.
  const first = samples.filter(sample => sample.t <= 1);
  const lowest = first.reduce((a, b) => b.flexing < a.flexing ? b : a), highest = first.reduce((a, b) => b.flexing > a.flexing ? b : a);
  const atChange = (t: number) => Math.min(t, 1 - t) < .2;
  return <div className="space-y-2">
    <svg viewBox={`0 0 ${width} ${height}`} className="block h-auto w-full max-w-md" role="img" aria-label={zh ? "两个弯里髋的高度" : "Hip height through two turns"}>
      {[0, 1, 2].map(t => <g key={t}><line x1={x(t)} y1={16} x2={x(t)} y2={height - 16} stroke="var(--border)" strokeDasharray="3 3" />
        <text x={x(t)} y={height - 4} textAnchor={t === 0 ? "start" : t === 2 ? "end" : "middle"} fontSize={10} fill="var(--ink-3)">{zh ? "换刃" : "edge change"}</text></g>)}
      <polyline points={samples.map(sample => `${x(sample.t)},${y(sample.flexing)}`).join(" ")} fill="none" stroke={STANDARD} strokeWidth={2.5} />
      <polyline points={samples.map(sample => `${x(sample.t)},${y(sample.stiff)}`).join(" ")} fill="none" stroke={FAULT} strokeWidth={2.5} />
      <text x={Math.max(40, x(lowest.t))} y={y(low) + 14} textAnchor="middle" fontSize={11} fill={STANDARD}>
        {atChange(lowest.t) ? (zh ? "换刃时屈腿吸收" : "flex at the change") : (zh ? "弯中屈腿" : "flex in the turn")}</text>
      <text x={Math.max(40, x(highest.t + (atChange(highest.t) && highest.t < .5 ? 1 : 0)))} y={14} textAnchor="middle" fontSize={11} fill={STANDARD}>
        {atChange(highest.t) ? (zh ? "换刃时伸展" : "extend to change") : (zh ? "弯中伸展" : "extend in the turn")}</text>
    </svg>
    <p className="text-xs text-ink-3" data-numeric>{zh ? `绿线是标准动作髋的高度，上下约 ${Math.round(span * 100)} 厘米；橙线是腿太直的样子，几乎不动。屈伸让压力在弯中慢慢建立，换刃时把重心送过雪板。`
      : `Green is the standard's hip height, moving about ${Math.round(span * 100)} cm; orange is stiff legs, hardly moving. Flexing and extending builds the pressure through the turn and sends the centre of mass across the skis at the change.`}</p>
  </div>;
}

/** The picture for a problem, drawn from a standard motion. */
export function TechniqueDiagram({ kind, motion, zh, faultName, durations }: {
  kind: DiagramKind; motion: StandardMotion; zh: boolean; faultName: string; durations?: number[] | null;
}) {
  if (kind === "upper_body" || kind === "tipping_inside" || kind === "inside_lag" || kind === "flat_edges")
    return <SkierPair motion={motion} zh={zh} kind={kind} faultName={faultName} />;
  if (kind === "turn_shape") return <TurnShapeChart motion={motion} zh={zh} />;
  if (kind === "rhythm") return <RhythmChart motion={motion} zh={zh} durations={durations} />;
  if (kind === "edge_timing") return <EdgeTimingChart motion={motion} zh={zh} />;
  return <FlexionChart motion={motion} zh={zh} />;
}
