import type { ReactNode } from "react";
import { CheckCircle2, ChevronRight, CircleAlert, Clock3, FileText, Loader2, Trash2, Upload, Wand2 } from "lucide-react";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FREESKI_CURRENT_LEVELS, getFreeSkiActionOption, parseFreeSkiActionId } from "@/lib/freeski/actions";
import { formatTorontoShortDateTime } from "@/lib/time";
import { analysisReasonText, readAnalysisResult } from "./video-analysis-result";
import { AnalysisProgress } from "./analysis-progress";
import type { AnalysisJobView, AnalysisVideoView, VideoAnalysisView } from "./video-analysis-types";

// A job waiting for compute never times out; only a completed analysis uses its credit.
export const COMPUTE_WAIT = {
  compute_offline: ["分析算力暂时不在线，任务已保留，恢复后自动开始。等待不算超时，分析完成才扣次数。",
    "Analysis compute is offline for now. Your job is kept and starts automatically when it is back. Waiting never times out, and a credit is used only when the analysis completes."],
  waiting_for_compute: ["正在等待分析算力，空出后自动开始。等待不算超时，分析完成才扣次数。",
    "Waiting for analysis compute; it starts automatically when compute is free. Waiting never times out, and a credit is used only when the analysis completes."],
} as const;

/** Where a video stands, from its newest analysis. */
export type VideoStatus = "new" | "processing" | "done" | "failed";

export function videoStatus(latest: AnalysisJobView | undefined): VideoStatus {
  if (!latest) return "new";
  if (latest.status === "QUEUED" || latest.status === "RUNNING") return "processing";
  return latest.status === "SUCCEEDED" ? "done" : "failed";
}

export function jobStatusBadge(status: AnalysisJobView["status"] | null, zh: boolean): { label: string; tone: BadgeTone } {
  switch (status) {
    case "QUEUED": return { label: zh ? "排队中" : "Queued", tone: "accent" };
    case "RUNNING": return { label: zh ? "分析中" : "Analyzing", tone: "accent" };
    case "SUCCEEDED": return { label: zh ? "分析已完成" : "Analysis complete", tone: "success" };
    case "FAILED": return { label: zh ? "未成功" : "Not graded", tone: "danger" };
    default: return { label: zh ? "待分析" : "Not analyzed", tone: "neutral" };
  }
}

/** "平行式 · 目前 CSIA 2 级": the catalog action, its certification group and the skier's level. */
export function analysisJobLabel(actionId: string | undefined, actions: VideoAnalysisView["actions"], zh: boolean): string | null {
  if (!actionId) return null;
  const selection = parseFreeSkiActionId(actionId);
  const action = actions.find((candidate) => candidate.id === selection?.catalogId) ?? getFreeSkiActionOption(actionId);
  if (!action) return null;
  const level = FREESKI_CURRENT_LEVELS.find((candidate) => candidate.id === selection?.currentLevel);
  return [
    action.pathType === "certification" ? (zh ? action.groupZh : action.groupEn) : null,
    zh ? action.labelZh : action.labelEn,
    level ? level.id === "none" ? (zh ? level.labelZh : level.labelEn) : zh ? `目前 ${level.labelZh}` : `Currently ${level.labelEn}` : null,
  ].filter(Boolean).join(" · ");
}

function when(value: string | null | undefined, locale: Locale) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : <time dateTime={date.toISOString()}>{formatTorontoShortDateTime(date, locale)}</time>;
}

/** Minutes from submission to the end of the analysis, when both are known. */
function duration(job: AnalysisJobView, zh: boolean) {
  if (!job.finishedAt) return null;
  const minutes = Math.round((new Date(job.finishedAt).getTime() - new Date(job.createdAt).getTime()) / 60_000);
  if (!Number.isFinite(minutes) || minutes < 0) return null;
  return minutes < 1 ? (zh ? "用时不到 1 分钟" : "under a minute") : zh ? `用时 ${minutes} 分钟` : `${minutes} min`;
}

export function JobNotes({ job, zh }: { job: AnalysisJobView; zh: boolean }) {
  const queueReason = job.status === "QUEUED" && typeof job.queueReason === "string" ? job.queueReason.trim() : null;
  const computeWait = job.status === "QUEUED" && job.computeWait && Object.hasOwn(COMPUTE_WAIT, job.computeWait) ? COMPUTE_WAIT[job.computeWait] : null;
  if (!queueReason && !computeWait) return null;
  return <div className="space-y-1 rounded-lg bg-accent-soft/60 px-3 py-2 text-xs leading-relaxed text-ink-2">
    {computeWait && <p>{computeWait[zh ? 0 : 1]}</p>}
    {queueReason && <p className="break-words">{zh ? "排队原因：" : "Waiting reason: "}{queueReason}</p>}
  </div>;
}

export function VideoCard({ video, jobs, locale, actions, reportHref, showAnalyze, canAnalyze, busyAnalyzing, canDelete, deleteDisabled, onAnalyze, onDelete, feedback }: {
  video: AnalysisVideoView;
  /** This video's analyses, newest first. */
  jobs: AnalysisJobView[];
  locale: Locale;
  actions: VideoAnalysisView["actions"];
  reportHref: (jobId: string) => string;
  showAnalyze: boolean;
  canAnalyze: boolean;
  busyAnalyzing: boolean;
  canDelete: boolean;
  deleteDisabled: boolean;
  onAnalyze: () => void;
  onDelete: () => void;
  feedback?: ReactNode;
}) {
  const zh = locale === "zh";
  const latest = jobs[0];
  const status = videoStatus(latest);
  const pending = status === "processing";
  const supported = video.analysisSupported ?? video.contentType !== "video/webm";
  const badge = jobStatusBadge(latest?.status ?? null, zh);
  const label = analysisJobLabel(latest?.actionId, actions, zh);
  const result = latest?.status === "FAILED" ? readAnalysisResult(latest.result) : null;
  const reason = analysisReasonText(result?.gradingReason ?? null, zh);
  const tips = (zh ? result?.coachingZh : result?.coachingEn)?.slice(0, 2) ?? [];
  const hasReport = latest && latest.result !== null && latest.result !== undefined && (latest.status === "SUCCEEDED" || latest.status === "FAILED");

  return <li className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-[var(--shadow-sm)]">
    <div className="relative bg-black">
      <video controls preload="metadata" playsInline src={video.url} className="aspect-video w-full object-contain" />
      <Badge tone={badge.tone} dot className="pointer-events-none absolute left-3 top-3 shadow-[var(--shadow-sm)]">{badge.label}</Badge>
    </div>
    <div className="flex flex-1 flex-col gap-3 p-4">
      <div className="space-y-1">
        <h3 className="break-words font-semibold">{video.caption || (zh ? "未命名视频" : "Untitled video")}</h3>
        {label && <p className="text-sm text-ink-2" data-job-label>{label}</p>}
        {!supported && <p className="text-sm text-ink-3">{zh ? "此视频可观看；分析请上传 MP4 或 MOV。" : "This video can be viewed. Upload MP4 or MOV for analysis."}</p>}
      </div>

      <ol className="space-y-1.5 border-l-2 border-border pl-3 text-xs text-ink-2">
        {video.uploadedAt && <li className="flex flex-wrap items-center gap-1.5"><Upload className="size-3.5 text-ink-3" aria-hidden />{zh ? "上传" : "Uploaded"} · {when(video.uploadedAt, locale)}</li>}
        {latest && <li className="flex flex-wrap items-center gap-1.5"><Wand2 className="size-3.5 text-ink-3" aria-hidden />{zh ? "提交分析" : "Submitted"} · {when(latest.createdAt, locale)}</li>}
        {pending && <li className="flex items-center gap-1.5 font-semibold text-accent"><Loader2 className="size-3.5 animate-spin" aria-hidden />{badge.label}…</li>}
        {pending && <li><AnalysisProgress status={latest!.status} progress={latest!.progress} computeWait={latest!.computeWait} zh={zh} compact /></li>}
        {latest?.finishedAt && <li className={`flex flex-wrap items-center gap-1.5 ${status === "done" ? "font-semibold text-success" : ""}`}>
          {status === "done" ? <CheckCircle2 className="size-3.5" aria-hidden /> : <CircleAlert className="size-3.5 text-danger" aria-hidden />}
          {status === "done" ? (zh ? "分析完成" : "Analysis finished") : (zh ? "分析结束" : "Ended")} · {when(latest.finishedAt, locale)}
          {duration(latest, zh) && <span className="font-normal text-ink-3">（{duration(latest, zh)}）</span>}
        </li>}
        {!latest && <li className="flex items-center gap-1.5 text-ink-3"><Clock3 className="size-3.5" aria-hidden />{zh ? "还没有分析" : "Not analyzed yet"}</li>}
      </ol>

      {latest && <JobNotes job={latest} zh={zh} />}

      {status === "failed" && <div className="space-y-1 rounded-lg bg-danger-bg px-3 py-2 text-xs leading-relaxed">
        <p className="font-semibold text-danger">{zh ? "分析失败，次数未扣除" : "Analysis failed; no credit used"}</p>
        {reason && <p className="text-ink-2">{reason}</p>}
        {tips.map((tip, index) => <p key={index} className="text-ink-2">{tip}</p>)}
      </div>}

      <div className="mt-auto flex flex-wrap gap-2 pt-1">
        {hasReport && <Button asChild size="sm" variant={status === "done" ? "primary" : "secondary"}>
          <Link href={reportHref(latest.id)}><FileText aria-hidden />{status === "done" ? (zh ? "查看报告" : "View report") : (zh ? "查看详情" : "View details")}</Link>
        </Button>}
        {showAnalyze && <Button size="sm" variant={latest ? "secondary" : "primary"} disabled={!canAnalyze || pending || !supported} onClick={onAnalyze}>
          {pending || busyAnalyzing ? <Loader2 className="animate-spin" aria-hidden /> : <Wand2 aria-hidden />}
          {pending ? zh ? "正在分析" : "Analysis in progress" : zh ? "分析这个视频" : "Analyze this video"}
        </Button>}
        {canDelete && <Button size="sm" variant="ghost" disabled={deleteDisabled || pending} onClick={onDelete}><Trash2 aria-hidden />{zh ? "删除视频" : "Delete video"}</Button>}
      </div>

      {jobs.length > 1 && <details className="group rounded-lg border border-border">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-xs font-semibold text-ink-2">
          {zh ? `全部分析记录（${jobs.length}）` : `All analyses (${jobs.length})`}
          <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" aria-hidden />
        </summary>
        <ul className="divide-y divide-border border-t border-border">
          {jobs.map((job) => {
            const jobBadge = jobStatusBadge(job.status, zh);
            const jobLabel = analysisJobLabel(job.actionId, actions, zh);
            return <li key={job.id} className="space-y-1 px-3 py-2 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                {jobLabel && <span className="font-semibold text-ink" data-job-label>{jobLabel}</span>}
                <Badge tone={jobBadge.tone}>{jobBadge.label}</Badge>
              </div>
              <p className="text-ink-3">{zh ? "提交" : "Submitted"} {when(job.createdAt, locale)}{job.finishedAt ? <> · {zh ? "结束" : "ended"} {when(job.finishedAt, locale)}</> : null}</p>
              <JobNotes job={job} zh={zh} />
              {job.result !== null && job.result !== undefined && (job.status === "SUCCEEDED" || job.status === "FAILED") && <Link href={reportHref(job.id)} className="font-semibold text-accent hover:underline">{zh ? "查看这次报告" : "Open this report"}</Link>}
            </li>;
          })}
        </ul>
      </details>}

      {feedback}
    </div>
  </li>;
}
