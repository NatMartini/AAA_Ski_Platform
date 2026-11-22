"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Move3d, Pause, Play, RotateCcw } from "lucide-react";
import { clientFetch } from "@/lib/client-fetch";
import { decodeCompactPose, smoothPose, turnManifestSchema } from "@/lib/freeski/report-v2";
import { curveEvenness, runHeadings, runTrack, type RunTrack } from "@/lib/freeski/run-track";
import { liftUserPose, type LiftedPose } from "@/lib/freeski/skier-lift";
import { cameraAxes, decodeStandardMotion, fitView, windowEdge, type StandardMotion, type StandardMotionId } from "@/lib/freeski/standard-motion";
import { retryWhileStarting } from "@/lib/freeski/startup-retry";
import { linkedPath, pathAt, type LinkedPath } from "@/lib/freeski/technique-paths";
import { cn } from "@/lib/utils";
import type { Shot, SkierStage } from "./skier-stage";
import type { PathLine, StageOverlay } from "./stage-overlays";
import { useOrbit, type Orbit } from "./use-orbit";

/**
 * The whole run seen from above on a piste: the student's path, worked out from the skis' heading in each filmed turn,
 * against round turns of the same timing. The size is an estimate (the speed is not in the video); the shape — how
 * evenly each turn swings round — is what to read.
 */

const USER = "#e9791a", STANDARD = "#1a9c64";
const FALLBACK_MOTION: StandardMotionId = "demonstration_parallel-l2";
const VIEW: Orbit = { azimuth: 0, elevation: 68, zoom: 1 };

type Loaded = { motion: StandardMotion; track: RunTrack; standard: LinkedPath; standardEvenness: number };

async function json(url: string, signal: AbortSignal) {
  const response = await retryWhileStarting(() => clientFetch(url, { cache: "no-store", signal }), { signal });
  if (!response.ok) throw new Error("resource-unavailable");
  return response.json();
}

async function load(base: string, turns: readonly { turnId: string }[], motionId: StandardMotionId | null, signal: AbortSignal): Promise<Loaded | null> {
  const motion = decodeStandardMotion(await json(`/standard-motions/${motionId ?? FALLBACK_MOTION}.json`, signal));
  const parts: { start: number; end: number; lift: LiftedPose }[] = [];
  // A few turns at a time: the service sends each turn's skeleton separately.
  for (let i = 0; i < turns.length; i += 3) {
    const batch = await Promise.all(turns.slice(i, i + 3).map(async ({ turnId }) => {
      const manifest = turnManifestSchema.parse(await json(`${base}/turns/${turnId}`, signal));
      const user = smoothPose(decodeCompactPose(await json(`${base}/assets/user-pose?turn_id=${turnId}`, signal)));
      const start = manifest.startMs / 1000, end = manifest.endMs / 1000;
      const edge = windowEdge(manifest);
      const bounds = { start, end, apex: manifest.apexMs === undefined ? null : manifest.apexMs / 1000, role: manifest.role, edge };
      const view = fitView(motion, user, bounds);
      if (!view) return null;
      const lift = liftUserPose(user, motion, view, view.edge !== null && view.edge !== undefined ? { ...bounds, edge: view.edge } : bounds);
      return lift ? { start, end, lift } : null;
    }));
    for (const part of batch) if (part) parts.push(part);
  }
  const track = runTrack(runHeadings(parts), motion.motion.speedMs);
  if (!track || track.turns.length === 0) return null;
  // Round turns with the student's own timing, so only the shape differs.
  const standard = linkedPath(motion, "round", track.turns.map(turn => turn.to - turn.from));
  return { motion, track, standard, standardEvenness: curveEvenness(motion.curves.headingDeg ?? []) };
}

function verdict(evenness: number, standard: number, zh: boolean) {
  const share = Math.round(evenness * 100), reference = Math.round(standard * 100);
  if (evenness >= standard - .08) return zh ? `你的弯平均有 ${share}% 的时间在均匀转向（标准约 ${reference}%）：弯型比较圆。` : `Your turns swing evenly ${share}% of the time (the standard about ${reference}%): round turns.`;
  if (evenness >= .4) return zh ? `你的弯平均只有 ${share}% 的时间在均匀转向（标准约 ${reference}%）：转向偏集中，弯不够圆。` : `Your turns swing evenly only ${share}% of the time (the standard about ${reference}%): the turning is bunched up, the turns not quite round.`;
  return zh ? `你的弯平均只有 ${share}% 的时间在转向（标准约 ${reference}%）：转向挤在弯中间一下，弯偏 Z 字。` : `Your turns swing only ${share}% of the time (the standard about ${reference}%): the turning comes in one burst mid-turn, Z-shaped.`;
}

export function RunTrackView({ base, turns, motionId, zh }: { base: string; turns: readonly { turnId: string }[]; motionId: StandardMotionId | null; zh: boolean }) {
  const [data, setData] = useState<Loaded | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "empty" | "error">("loading");
  const [mode, setMode] = useState<"loading" | "scene" | "flat">("loading");
  const [playing, setPlaying] = useState(true);
  const [width, setWidth] = useState<number | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<{ stage: SkierStage; project: typeof import("./skier-stage").shotToCanvas } | null>(null);
  const { orbit, live: view, moved, setOrbit } = useOrbit(boxRef, VIEW);
  const clock = useRef(0), drawn = useRef("");
  const live = useRef({ playing, width });
  useEffect(() => { live.current = { playing, width }; }, [playing, width]);
  const turnKey = turns.map(turn => turn.turnId).join(",");

  useEffect(() => {
    const controller = new AbortController();
    void load(base, turns, motionId, controller.signal).then(result => {
      if (controller.signal.aborted) return;
      setData(result);
      setState(result ? "ready" : "empty");
    }).catch(() => { if (!controller.signal.aborted) setState("error"); });
    return () => controller.abort();
    // The turns are the same while their ids are.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, turnKey, motionId]);

  useEffect(() => {
    if (state !== "ready") return;
    let alive = true;
    void (async () => {
      const box = boxRef.current;
      if (!box) return;
      const library = await import("./skier-stage");
      const stage = await library.SkierStage.create(box);
      if (!stage) { if (alive) setMode("flat"); return; }
      if (!alive) { stage.dispose(); return; }
      stageRef.current = { stage, project: library.shotToCanvas };
      drawn.current = "";
      setMode("scene");
    })().catch(() => { if (alive) setMode("flat"); });
    return () => { alive = false; stageRef.current?.stage.dispose(); stageRef.current = null; };
  }, [state]);

  const layout = useMemo(() => {
    if (!data) return null;
    const points = data.track.points, middle = <T,>(values: T[]) => values[Math.floor(values.length / 2)];
    const typical = middle(data.track.turns.map(turn => turn.to - turn.from).sort((p, q) => p - q)) ?? 1.5;
    // The path wanders across the slope where the camera fits of the turns disagree; shown against its own middle line it
    // stays on the piste, and each turn keeps its shape.
    const user = points.map((point, i) => {
      let sum = 0, count = 0;
      for (let k = i; k >= 0 && point.time - points[k].time <= typical; k--) { sum += points[k].x; count++; }
      for (let k = i + 1; k < points.length && points[k].time - point.time <= typical; k++) { sum += points[k].x; count++; }
      return { time: point.time - points[0].time, x: point.x - sum / count, y: point.y };
    });
    const xs = data.standard.samples.map(sample => sample.x), centre = (Math.max(...xs) + Math.min(...xs)) / 2;
    const standard = data.standard.samples.map(sample => ({ time: sample.time, x: sample.x - centre, y: sample.y }));
    const width = middle(data.track.turns.map(turn => turn.width).sort((p, q) => p - q)) ?? 0;
    return { user, standard, autoWidth: Math.max(15, Math.ceil(Math.max(width, data.standard.width) * 2.5 / 5) * 5),
      // Close enough to see three or four turns at once, following the skier down.
      frame: Math.max(12, Math.min(50, data.track.length / Math.max(1, data.track.turns.length) * 3.4)) };
  }, [data]);

  const draw = useCallback((seconds: number) => {
    const canvas = canvasRef.current, context = canvas?.getContext("2d"), scene = stageRef.current;
    if (!canvas || !context || !data || !layout) return;
    const ratio = window.devicePixelRatio || 1;
    const pixelsWide = Math.round(canvas.clientWidth * ratio), pixelsHigh = Math.round(canvas.clientHeight * ratio);
    if (canvas.width !== pixelsWide || canvas.height !== pixelsHigh) { canvas.width = pixelsWide; canvas.height = pixelsHigh; }
    if (!scene?.stage.usable) return;
    const camera = view.current, pisteWidth = live.current.width ?? layout.autoWidth;
    const key = `${seconds}|${camera.azimuth}|${camera.elevation}|${camera.zoom}|${pisteWidth}|${pixelsWide}x${pixelsHigh}`;
    if (key === drawn.current) return;
    drawn.current = key;

    // Two markers ride the paths together, turn for turn; the camera follows the student's down the piste.
    const runTime = layout.user.at(-1)!.time, t = runTime > 0 ? seconds % runTime : 0;
    let index = 0;
    while (index + 1 < layout.user.length && layout.user[index + 1].time <= t) index++;
    const here = layout.user[index], standardHere = pathAt(data.standard, t);
    const offset = pisteWidth * .22, follow = here.y;
    const userAt = (x: number, y: number): [number, number] => [x - offset, y - follow];
    const standardAt = (x: number, y: number): [number, number] => [x + offset, y - follow];
    const frame = layout.frame * camera.zoom;
    const paths: PathLine[] = [
      { points: layout.user.map(point => userAt(point.x, point.y)), color: USER, width: Math.max(.12, frame * .009), alpha: .95 },
      { points: layout.standard.map(point => standardAt(point.x, point.y)), color: STANDARD, width: Math.max(.1, frame * .007), alpha: .85, dashed: true },
    ];
    for (const side of [-1, 1]) paths.push({ points: [[side * pisteWidth / 2, -400], [side * pisteWidth / 2, 400]], color: "#7b8ba3", width: Math.max(.08, frame * .004), alpha: .7, dashed: true });
    const standardX = standardHere.x - (Math.max(...data.standard.samples.map(sample => sample.x)) + Math.min(...data.standard.samples.map(sample => sample.x))) / 2;
    const ring = (centre: [number, number], color: string): StageOverlay =>
      ({ kind: "ring", centre: [...centre, .05], axis: [0, 0, 1], start: [1, 0, 0], radius: Math.max(.4, frame * .016), arc: 2 * Math.PI * .97, color, flow: seconds });
    const overlays: StageOverlay[] = [ring(userAt(here.x, here.y), USER), ring(standardAt(standardX, standardHere.y), STANDARD)];
    const axes = cameraAxes({ azimuth: camera.azimuth, elevation: camera.elevation, slope: data.motion.motion.pitchDeg });
    const shot: Shot = { rect: { x: 0, y: 0, width: 1, height: 1 }, axes, slopeDeg: data.motion.motion.pitchDeg, frameHeight: frame, distance: 8 * frame / 3.1,
      focus: [0, 0, 0], snowAt: [0, follow], figures: [], paths, overlays, piste: { centre: 0, halfWidth: pisteWidth / 2 } };
    scene.stage.render([shot]);

    context.clearRect(0, 0, pixelsWide, pixelsHigh);
    const toCanvas = scene.project(shot, pixelsWide, pixelsHigh);
    context.font = `600 ${11 * ratio}px system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif`;
    context.textBaseline = "middle";
    const label = (x: number, y: number, text: string, color: string) => {
      const [px, py] = toCanvas(x, y, 0), w = context.measureText(text).width + 10 * ratio, h = 17 * ratio;
      if (px < -w || px > pixelsWide + w || py < -h || py > pixelsHigh + h) return;
      context.fillStyle = color;
      context.globalAlpha = .9;
      context.beginPath();
      context.roundRect(px - w / 2, py - h / 2, w, h, 5 * ratio);
      context.fill();
      context.globalAlpha = 1;
      context.fillStyle = "#ffffff";
      context.fillText(text, px - w / 2 + 5 * ratio, py + ratio * .5);
    };
    // Each turn's number and how evenly it swung, beside its widest point.
    data.track.turns.forEach((turn, i) => {
      const at = layout.user.find(point => point.time >= turn.apex.time - data.track.points[0].time) ?? layout.user.at(-1)!;
      const [x, y] = userAt(at.x, at.y);
      label(x + (at.x > 0 ? 1.6 : -1.6), y, `${i + 1} · ${Math.round(turn.evenness * 100)}%`, turn.evenness < data.standardEvenness - .15 ? "rgba(190, 70, 20, 0.95)" : "rgba(20, 26, 36, 0.8)");
    });
    label(pisteWidth / 2 - 3, -frame * .3, zh ? `雪道宽 ${pisteWidth} 米` : `Piste ${pisteWidth} m`, "rgba(20, 26, 36, 0.8)");
  }, [data, layout, view, zh]);

  useEffect(() => {
    if (state !== "ready") return;
    let frame = 0, last = performance.now();
    const tick = (wall: number) => {
      const dt = Math.min(.1, (wall - last) / 1000);
      last = wall;
      if (live.current.playing) clock.current += dt * .5;
      draw(clock.current);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [draw, state]);
  useEffect(() => { drawn.current = ""; }, [orbit, width]);

  if (state === "loading") return <div className="aspect-video w-full animate-pulse rounded-xl bg-surface-2" aria-label={zh ? "正在推算滑行轨迹" : "Working out the path"} />;
  if (state !== "ready" || !data || !layout) return <p role="status" className="text-sm text-ink-3">{state === "empty"
    ? (zh ? "这段视频的弯太少或雪板朝向看不清，推算不出滑行轨迹。" : "Too few turns, or the skis' direction too unclear, to work out the path.")
    : (zh ? "滑行轨迹暂时打不开，稍后再试。" : "The path could not be loaded. Try again later.")}</p>;

  const evenness = data.track.turns.reduce((sum, turn) => sum + turn.evenness, 0) / data.track.turns.length;
  const pisteWidth = width ?? layout.autoWidth;
  const widthOf = (turn: { width: number }) => turn.width.toFixed(turn.width < 10 ? 1 : 0);
  return <div className="space-y-2">
    <div ref={boxRef} tabIndex={0} aria-label={zh ? "滑行轨迹俯视图，拖动可以转视角" : "The run from above; drag to turn the view"}
      className={cn("relative aspect-video cursor-grab touch-pan-y overflow-hidden rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-accent active:cursor-grabbing",
        mode === "flat" ? "bg-[#0d1524]" : "bg-[#e6edf5]", mode === "loading" && "animate-pulse")}>
      <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" />
      {mode === "scene" && <div className="pointer-events-none absolute left-2.5 top-2.5 flex flex-wrap gap-1.5 text-xs font-semibold text-white">
        <span className="flex items-center gap-1.5 rounded-full bg-black/45 px-2.5 py-1"><span className="size-2 rounded-full" style={{ background: USER }} />{zh ? "你的轨迹（估算）" : "Your path (estimate)"}</span>
        <span className="flex items-center gap-1.5 rounded-full bg-black/45 px-2.5 py-1"><span className="size-2 rounded-full" style={{ background: STANDARD }} />{zh ? "同样节奏的圆弧弯" : "Round turns, same timing"}</span>
      </div>}
      {mode === "scene" && !moved && <span className="pointer-events-none absolute right-2.5 top-2.5 flex items-center gap-1 rounded-full bg-black/35 px-2.5 py-1 text-[11px] font-medium text-white">
        <Move3d className="size-3.5" aria-hidden />{zh ? "拖动转视角" : "Drag to turn"}</span>}
      {mode === "flat" && <p className="absolute inset-0 flex items-center justify-center p-4 text-center text-sm text-white/70">{zh ? "这个浏览器不能显示 3D 画面。" : "This browser cannot show the 3D view."}</p>}
    </div>
    <div className="flex flex-wrap items-center gap-3">
      <button type="button" onClick={() => setPlaying(value => !value)} aria-label={playing ? (zh ? "暂停" : "Pause") : (zh ? "播放" : "Play")}
        className="press flex size-9 items-center justify-center rounded-full bg-accent text-accent-foreground">
        {playing ? <Pause className="size-4" aria-hidden /> : <Play className="size-4 translate-x-px" aria-hidden />}
      </button>
      <label className="flex min-w-0 flex-1 items-center gap-2 text-xs font-semibold text-ink-2 sm:max-w-sm">
        <span className="shrink-0">{zh ? "雪道宽度" : "Piste width"}</span>
        <input type="range" min={10} max={60} step={5} value={pisteWidth} onChange={event => setWidth(Number(event.target.value))} className="h-9 min-w-0 flex-1 accent-[var(--accent)]" />
        <span className="w-12 shrink-0 text-right" data-numeric>{zh ? `${pisteWidth} 米` : `${pisteWidth} m`}</span>
      </label>
      <button type="button" onClick={() => setOrbit(VIEW)} aria-label={zh ? "回到俯视" : "Back to the view from above"}
        className="press flex size-9 items-center justify-center rounded-lg text-ink-3 hover:bg-surface-2"><RotateCcw className="size-4" aria-hidden /></button>
    </div>
    <p className="text-sm text-ink">{verdict(evenness, data.standardEvenness, zh)}</p>
    <div className="overflow-x-auto"><table className="w-full min-w-[26rem] text-left text-xs">
      <thead className="text-ink-3"><tr>
        <th className="py-1 pr-3 font-medium">{zh ? "弯" : "Turn"}</th>
        <th className="px-2 py-1 text-right font-medium">{zh ? "弯宽（估算）" : "Width (estimate)"}</th>
        <th className="px-2 py-1 text-right font-medium">{zh ? "均匀转向" : "Even swing"}</th>
        <th className="px-2 py-1 text-right font-medium">{zh ? "最快转向" : "Quickest swing"}</th>
      </tr></thead>
      <tbody>{data.track.turns.map((turn, i) => <tr key={turn.from} className="border-t border-border">
        <td className="py-1 pr-3 text-ink-2">{zh ? `${i + 1} · ${turn.direction === "right" ? "右转" : "左转"}` : `${i + 1} · ${turn.direction}`}</td>
        <td className="px-2 py-1 text-right" data-numeric>{zh ? `${widthOf(turn)} 米` : `${widthOf(turn)} m`}</td>
        <td className={cn("px-2 py-1 text-right font-semibold", turn.evenness < data.standardEvenness - .15 && "text-amber")} data-numeric>{Math.round(turn.evenness * 100)}%</td>
        <td className="px-2 py-1 text-right" data-numeric>{zh ? `${Math.round(turn.peakRate)}°/秒` : `${Math.round(turn.peakRate)}°/s`}</td>
      </tr>)}
        <tr className="border-t border-border text-ink-3"><td className="py-1 pr-3">{zh ? "标准圆弧" : "Round standard"}</td>
          <td className="px-2 py-1 text-right" data-numeric>{zh ? `${data.standard.width.toFixed(0)} 米` : `${data.standard.width.toFixed(0)} m`}</td>
          <td className="px-2 py-1 text-right" data-numeric>{Math.round(data.standardEvenness * 100)}%</td><td /></tr>
      </tbody>
    </table></div>
    <p className="text-[11px] leading-relaxed text-ink-3">{zh
      ? "轨迹按视频里每个弯雪板的朝向推算，速度按标准动作假设，所以弯宽和长度是估算；“均匀转向”是一个弯里雪板以至少一半最快速度在转的时间占比，圆弧弯约三分之二，Z 字弯只有中间一小段。雪道宽度可以按你实际滑的雪道调整。"
      : "The path follows the skis' heading in each filmed turn at the standard's speed, so widths and lengths are estimates. “Even swing” is the share of a turn in which the skis turn at half their quickest or more: about two thirds for round turns, a short burst for Z turns. Set the piste width to the run you skied."}</p>
  </div>;
}
