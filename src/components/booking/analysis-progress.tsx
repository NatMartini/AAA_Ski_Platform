import { Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type Addon = "pending" | "running" | "ready" | "unavailable" | "failed" | null | undefined;
/** How far the tier's outputs have got while a scored analysis is being completed (prepare.ts). */
export type OutputProgress = { teaching: Addon; explainer: Addon; keyframes?: { ready: number; total: number } | null };

/**
 * Where an analysis is on its way to a full report: queued, scored, then everything its tier shows — the written
 * explanation and, from the deep tier up, the key frames and the explainer video. The report appears once all are made.
 * Typical times are what the test deployment measured (about 2 minutes to score, 3 for the text).
 */
export function AnalysisProgress({ status, progress, computeWait, teaching, explainer, outputs, media = true, zh, compact }: {
  status: "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED";
  progress?: number | null;
  computeWait?: string | null;
  teaching?: Addon; explainer?: Addon;
  /** Set while a scored analysis is being completed: the stages after scoring are live. */
  outputs?: OutputProgress | null;
  /** Whether the tier has key frames and the explainer video. */
  media?: boolean;
  zh: boolean; compact?: boolean;
}) {
  if (status === "FAILED") return null;
  type Stage = { label: string; state: "done" | "active" | "todo" | "skipped"; detail?: string };
  const completing = outputs !== undefined && status === "RUNNING";
  const scoring: Stage["state"] = status === "SUCCEEDED" || completing ? "done" : status === "RUNNING" ? "active" : "todo";
  const stages: Stage[] = [
    { label: zh ? "排队" : "Queued", state: status === "QUEUED" ? "active" : "done",
      detail: status === "QUEUED" ? (computeWait ? (zh ? "等待算力" : "waiting for compute") : (zh ? "等待开始" : "about to start")) : undefined },
    { label: zh ? "识别骨架并评分" : "Skeleton & scoring", state: scoring,
      detail: scoring === "active" ? (progress !== null && progress !== undefined ? `${Math.round(progress * 100)}%` : (zh ? "通常约 2 分钟" : "usually about 2 min")) : undefined },
  ];
  const names = { teaching: zh ? "写讲解" : "Explanation", frames: zh ? "生成关键帧" : "Key frames", explainer: zh ? "生成讲解视频" : "Explainer video" };
  const addon = (value: Addon, label: string, typical: string): Stage => ({ label,
    state: value === "ready" ? "done" : value === "pending" || value === "running" ? "active" : value === "unavailable" || value === "failed" ? "skipped" : "todo",
    detail: value === "pending" || value === "running" ? typical : value === "failed" ? (zh ? "这次没生成" : "not generated") : undefined });
  if (completing) {
    // Asked for but not yet looked at counts as under way.
    // The paid tiers write the deepest explanation, which takes a model several times longer than the short ones.
    stages.push(addon(outputs?.teaching ?? "pending", names.teaching, media ? (zh ? "这一档写得最细，可能要十几分钟" : "the most detailed one; can take over ten minutes")
      : zh ? "通常约 3 分钟" : "usually about 3 min"));
    if (media) {
      const frames = outputs?.keyframes;
      stages.push(!frames ? { label: names.frames, state: "active" } : frames.total === 0 ? { label: names.frames, state: "skipped" }
        : { label: names.frames, state: frames.ready >= frames.total ? "done" : "active", detail: frames.ready >= frames.total ? undefined : `${frames.ready}/${frames.total}` });
      stages.push(addon(outputs?.explainer ?? "pending", names.explainer, zh ? "通常约 2 分钟" : "usually about 2 min"));
    }
  } else if (status === "SUCCEEDED") {
    stages.push(addon(teaching, names.teaching, zh ? "通常约 3 分钟" : "usually about 3 min"));
    // An analysis whose tier has no explainer video has no such stage.
    if (explainer) stages.push(addon(explainer, names.explainer, zh ? "通常约 2 分钟" : "usually about 2 min"));
  } else {
    stages.push({ label: names.teaching, state: "todo" });
    if (media) stages.push({ label: names.frames, state: "todo" }, { label: names.explainer, state: "todo" });
  }
  const allDone = stages.every(stage => stage.state === "done" || stage.state === "skipped");
  if (allDone && compact) return null;
  return <ol className={cn("flex flex-wrap items-center gap-x-1 gap-y-1", compact ? "text-[11px]" : "text-xs")} aria-label={zh ? "分析进度" : "Analysis progress"}>
    {stages.map((stage, index) => <li key={stage.label} className="flex items-center gap-1">
      <span className={cn("flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold",
        stage.state === "done" ? "bg-success-bg text-success" : stage.state === "active" ? "bg-accent-soft text-accent"
          : stage.state === "skipped" ? "bg-surface-2 text-ink-3 line-through" : "bg-surface-2 text-ink-3")}>
        {stage.state === "done" ? <Check className="size-3" aria-hidden /> : stage.state === "active" ? <Loader2 className="size-3 animate-spin" aria-hidden /> : null}
        {stage.label}{stage.detail && <span className="font-normal opacity-80"> · {stage.detail}</span>}
      </span>
      {index < stages.length - 1 && <span aria-hidden className="text-ink-3">›</span>}
    </li>)}
  </ol>;
}
