import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { ArrowLeft, CheckCircle2, CircleAlert, FileVideo, Loader2, Upload, Wand2 } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { toLocale } from "@/i18n/routing";
import { requireUserPage } from "@/lib/auth/require-user";
import { getAccountVideoAnalysisState } from "@/lib/video-analysis/account-service";
import { getVideoAnalysisState } from "@/lib/video-analysis/service";
import { AnalysisDomainError } from "@/lib/video-analysis/quota";
import { formatTorontoShortDateTime } from "@/lib/time";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader, SectionHeading } from "@/components/ui/page-header";
import { AutoRefresh } from "@/components/auto-refresh";
import { AnalysisProgress } from "@/components/booking/analysis-progress";
import { readAnalysisResult, VideoAnalysisResult } from "@/components/booking/video-analysis-result";
import { comparableScorecards } from "@/lib/freeski/metric-insight";
import { CoachVideoFeedback } from "@/components/booking/coach-video-feedback";
import { JobNotes, analysisJobLabel, jobStatusBadge } from "@/components/booking/video-card";
import type { VideoAnalysisView } from "@/components/booking/video-analysis-types";

/**
 * One analysis on its own page: the clip, when it was uploaded, submitted
 * and finished, and FreeSki's report. The job is looked up inside the
 * viewer's own wallet or lesson, so an id from elsewhere is simply not found.
 */
export default async function AnalysisReportPage({ params, searchParams }: PageProps<"/[locale]/video-analysis/report/[jobId]">) {
  const { locale, jobId } = await params;
  setRequestLocale(locale);
  const query = await searchParams;
  const lesson = typeof query.lesson === "string" && query.lesson ? query.lesson : null;
  const user = await requireUserPage({ locale, callbackPath: `/${locale}/video-analysis/report/${encodeURIComponent(jobId)}${lesson ? `?lesson=${encodeURIComponent(lesson)}` : ""}` });
  const loc = toLocale(locale);
  const zh = loc === "zh";

  let state;
  try {
    state = lesson ? await getVideoAnalysisState(lesson, user) : await getAccountVideoAnalysisState(user);
  } catch (error) {
    if (error instanceof AnalysisDomainError) notFound();
    throw error;
  }
  // Match the API's JSON DTO for dates passed into client components.
  const view = JSON.parse(JSON.stringify(state)) as VideoAnalysisView;
  const job = view.jobs.find((candidate) => candidate.id === jobId);
  if (!job) notFound();
  const video = view.videos.find((candidate) => candidate.id === job.videoId) ?? null;
  // The student's previous finished analysis of the same action, when the same scoring produced both.
  const current = readAnalysisResult(job.result)?.scorecard ?? null;
  const previous = current ? view.jobs.filter((candidate) => candidate.id !== job.id && candidate.status === "SUCCEEDED" && candidate.actionId === job.actionId &&
      candidate.finishedAt && job.finishedAt && candidate.finishedAt < job.finishedAt)
    .sort((a, b) => b.finishedAt!.localeCompare(a.finishedAt!))
    .find((candidate) => { const card = readAnalysisResult(candidate.result)?.scorecard; return card ? comparableScorecards(current, card) : false; }) ?? null : null;
  const label = analysisJobLabel(job.actionId, view.actions, zh);
  const badge = jobStatusBadge(job.status, zh);
  const pending = job.status === "QUEUED" || job.status === "RUNNING";
  const back = lesson ? `/video-analysis?lesson=${encodeURIComponent(lesson)}#workspace` : "/video-analysis?source=account#workspace";
  const when = (value: string | null | undefined) => value ? formatTorontoShortDateTime(new Date(value), loc) : null;

  return (
    <div className="space-y-6">
      {pending && <AutoRefresh />}
      {pending && <AnalysisProgress status={job.status} progress={job.progress} computeWait={job.computeWait} zh={zh} />}
      <Link href={back} className="inline-flex min-h-9 items-center gap-1.5 text-sm font-semibold text-ink-2 hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden />{zh ? "返回视频库" : "Back to video library"}
      </Link>
      <PageHeader
        icon={<FileVideo aria-hidden />}
        tone="video"
        eyebrow={video?.caption || (zh ? "未命名视频" : "Untitled video")}
        title={label ?? (zh ? "分析报告" : "Analysis report")}
        actions={<Badge tone={badge.tone} dot className="text-sm">{badge.label}</Badge>}
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="overflow-hidden rounded-2xl border border-border bg-black">
          {video
            ? <video controls preload="metadata" playsInline src={video.url} className="aspect-video w-full object-contain" />
            : <p className="flex aspect-video items-center justify-center p-6 text-sm text-white/70">{zh ? "这个视频已删除，报告仍保留。" : "This video was deleted; its report is kept."}</p>}
        </div>
        <Card className="space-y-4 self-start">
          <h2 className="text-base">{zh ? "时间线" : "Timeline"}</h2>
          <ol className="space-y-3 text-sm">
            {video?.uploadedAt && <Step icon={<Upload aria-hidden />} label={zh ? "上传视频" : "Video uploaded"} time={when(video.uploadedAt)} />}
            <Step icon={<Wand2 aria-hidden />} label={zh ? "提交分析" : "Submitted for analysis"} time={when(job.createdAt)} />
            {pending && <Step icon={<Loader2 className="animate-spin" aria-hidden />} label={badge.label} time={zh ? "完成后本页自动更新" : "This page updates when it finishes"} highlight />}
            {job.finishedAt && <Step
              icon={job.status === "SUCCEEDED" ? <CheckCircle2 aria-hidden /> : <CircleAlert aria-hidden />}
              label={job.status === "SUCCEEDED" ? (zh ? "分析完成" : "Analysis finished") : (zh ? "分析失败，次数未扣除" : "Analysis failed; no credit used")}
              time={when(job.finishedAt)} highlight />}
          </ol>
          <JobNotes job={job} zh={zh} />
        </Card>
      </div>

      {job.result !== null && job.result !== undefined && (job.status === "SUCCEEDED" || job.status === "FAILED") && (
        <section className="space-y-3">
          <SectionHeading title={zh ? "分析报告" : "Analysis report"} />
          {previous && <p className="text-xs text-ink-3">{zh ? `和上一次（${when(previous.finishedAt)}）的同一动作分析对比。` : `Compared with your previous analysis of this action (${when(previous.finishedAt)}).`}</p>}
          <VideoAnalysisResult result={job.result} locale={loc} dynamicReportBase={`/api/video-analysis/reports/${lesson ? "booking" : "account"}/${job.id}`}
            previousResult={previous?.result ?? null} expanded />
        </section>
      )}

      {video && (!lesson || user.role === "CUSTOMER") && (
        <CoachVideoFeedback locale={loc} videoId={video.id} bookingCode={lesson ?? undefined} personal={!lesson} />
      )}
    </div>
  );
}

function Step({ icon, label, time, highlight }: { icon: React.ReactNode; label: string; time: string | null; highlight?: boolean }) {
  return (
    <li className="flex items-start gap-3">
      <span className={`flex size-8 shrink-0 items-center justify-center rounded-full [&_svg]:size-4 ${highlight ? "bg-cat-video-soft text-cat-video" : "bg-surface-2 text-ink-3"}`}>{icon}</span>
      <span className="min-w-0 pt-1">
        <span className="block font-semibold">{label}</span>
        {time && <span className="block text-xs text-ink-3">{time}</span>}
      </span>
    </li>
  );
}
