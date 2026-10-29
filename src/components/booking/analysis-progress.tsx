import { Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type Addon = "pending" | "running" | "ready" | "unavailable" | "failed" | null | undefined;

/**
 * Where an analysis is on its way to a full report. The scoring stage comes from the job and
 * FreeSki's progress; the teaching and explainer stages only once the report is being read.
 * Typical times are what the test deployment measured (about 2 minutes to score, 3 for the text).
 */
export function AnalysisProgress({ status, progress, computeWait, teaching, explainer, zh, compact }: {
  status: "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED";
  progress?: number | null;
  computeWait?: string | null;
  teaching?: Addon; explainer?: Addon;
  zh: boolean; compact?: boolean;
}) {
  if (status === "FAILED") return null;
  type Stage = { label: string; state: "done" | "active" | "todo" | "skipped"; detail?: string };
  const scoring: Stage["state"] = status === "SUCCEEDED" ? "done" : status === "RUNNING" ? "active" : "todo";
  const stages: Stage[] = [
    { label: zh ? "排队" : "Queued", state: status === "QUEUED" ? "active" : "done",
      detail: status === "QUEUED" ? (computeWait ? (zh ? "等待算力" : "waiting for compute") : (zh ? "等待开始" : "about to start")) : undefined },
    { label: zh ? "识别骨架并评分" : "Skeleton & scoring", state: scoring,
      detail: scoring === "active" ? (progress !== null && progress !== undefined ? `${Math.round(progress * 100)}%` : (zh ? "通常约 2 分钟" : "usually about 2 min")) : undefined },
  ];
  if (status === "SUCCEEDED") {
    const addon = (value: Addon, label: string, typical: string): Stage => ({ label,
      state: value === "ready" ? "done" : value === "pending" || value === "running" ? "active" : value === "unavailable" || value === "failed" ? "skipped" : "todo",
      detail: value === "pending" || value === "running" ? typical : value === "failed" ? (zh ? "这次没生成" : "not generated") : undefined });
    stages.push(addon(teaching, zh ? "写讲解" : "Explanation", zh ? "通常约 3 分钟" : "usually about 3 min"));
    stages.push(addon(explainer, zh ? "生成讲解视频" : "Explainer video", zh ? "通常约 2 分钟" : "usually about 2 min"));
  } else {
    stages.push({ label: zh ? "写讲解" : "Explanation", state: "todo" }, { label: zh ? "生成讲解视频" : "Explainer video", state: "todo" });
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
