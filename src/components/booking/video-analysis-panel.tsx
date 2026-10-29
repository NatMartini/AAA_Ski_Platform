"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { clientFetch } from "@/lib/client-fetch";
import { clientRandomUUID } from "@/lib/browser-helpers";
import { formatMoneyShort } from "@/lib/pricing";
import type { Locale } from "@/i18n/routing";
import { Link, useRouter } from "@/i18n/navigation";
import { formatTorontoShortDateTime } from "@/lib/time";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { SegmentedTabs } from "@/components/ui/tabs";
import { FieldError, Hint, Input, Label, Select } from "@/components/ui/field";
import { Camera, Check, ChevronRight, CircleAlert, Film, Loader2, MessageSquareText, RefreshCw, Upload, Wand2 } from "lucide-react";
import { CoachVideoFeedback } from "./coach-video-feedback";
import { VideoCard, analysisJobLabel, jobStatusBadge, videoStatus, type VideoStatus } from "./video-card";
import type { AnalysisJobView, AnalysisPurchaseView, AnalysisVideoView, VideoAnalysisView } from "./video-analysis-types";
import { includedAnalysisCredits } from "@/lib/video-analysis/quota";
import { FREESKI_CURRENT_LEVELS, parseFreeSkiActionId, submittedFreeSkiActionId, type FreeSkiCurrentLevel } from "@/lib/freeski/actions";
import { FILMING_GUIDE, filmingWarnings, readVideoMetadata, type FilmingWarning, type VideoMeta } from "@/lib/video-analysis/precheck";

type Filter = "all" | VideoStatus;

/**
 * The video library for one credit source: a personal wallet or one lesson.
 * Videos are cards filtered by where their newest analysis stands; uploading
 * and choosing what to analyse happen in dialogs, and each finished analysis
 * opens on its own report page.
 */
export function VideoAnalysisPanel({ locale, bookingCode, bookedHours, completed, isCustomer, isOwnCoach, canUpload, initialVideos, initialView, accountId }: {
  locale: Locale;
  bookingCode: string;
  bookedHours: number;
  completed: boolean;
  isCustomer: boolean;
  isOwnCoach: boolean;
  canUpload: boolean;
  initialVideos: AnalysisVideoView[];
  initialView?: VideoAnalysisView;
  /** An account wallet has its own API and never uses a synthetic lesson. */
  accountId?: string;
}) {
  const zh = locale === "zh";
  const router = useRouter();
  const [view, setView] = useState<VideoAnalysisView | null>(initialView ?? null);
  const [caption, setCaption] = useState("");
  const [actionId, setActionId] = useState("");
  const [currentLevel, setCurrentLevel] = useState<FreeSkiCurrentLevel | "">("");
  const [quantity, setQuantity] = useState("1");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState(false);
  const [sessionChanged, setSessionChanged] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [uploadOpen, setUploadOpen] = useState(false);
  // A chosen file whose pre-check raised warnings waits here until the student decides.
  const [checked, setChecked] = useState<{ file: File; meta: VideoMeta; warnings: FilmingWarning[] } | null>(null);
  const [checking, setChecking] = useState(false);
  const [analyzeVideoId, setAnalyzeVideoId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const requestKeys = useRef(new Map<string, string>());
  const refreshVersion = useRef(0);
  const lastQuota = useRef(initialView ? JSON.stringify(initialView.quota) : null);
  const personal = Boolean(accountId);
  const base = personal ? "/api/video-analysis" : `/api/bookings/${bookingCode}/analysis`;
  const videosBase = personal ? "/api/video-analysis/videos" : `/api/bookings/${bookingCode}/videos`;

  const refresh = useCallback(async (signal?: AbortSignal) => {
    const version = ++refreshVersion.current;
    const response = await clientFetch(base, { cache: "no-store", signal });
    const body = await response.json().catch(() => null) as VideoAnalysisView | null;
    if (signal?.aborted || version !== refreshVersion.current) return;
    if (response.status === 401 || response.status === 403 || (personal && body?.ok && body.accountId !== accountId)) {
      setSessionChanged(true);
      setView(null);
      router.refresh();
      return;
    }
    if (!response.ok || !body?.ok || !body.quota || !Array.isArray(body.videos)) {
      setRefreshError(true);
      return;
    }
    setView(body);
    setActionId((current) => body.actions.some((action) => action.id === current && action.available === true) ? current : "");
    setRefreshError(false);
    const quotaSnapshot = JSON.stringify(body.quota);
    if (lastQuota.current !== null && quotaSnapshot !== lastQuota.current) router.refresh();
    lastQuota.current = quotaSnapshot;
  }, [base, router, personal, accountId]);

  const hasPending = view?.jobs.some((job) => job.status === "QUEUED" || job.status === "RUNNING") ?? false;
  useEffect(() => {
    const controller = new AbortController();
    const initialRefresh = window.setTimeout(() => void refresh(controller.signal), 0);
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void refresh(controller.signal); }, hasPending ? 5000 : 20000);
    const onVisible = () => { if (document.visibilityState === "visible") void refresh(controller.signal); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { controller.abort(); window.clearTimeout(initialRefresh); window.clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [refresh, hasPending, completed, canUpload]);

  function requestKey(operation: string) {
    if (!requestKeys.current.has(operation)) requestKeys.current.set(operation, clientRandomUUID());
    return requestKeys.current.get(operation)!;
  }

  function failure(code: string | undefined) {
    if (code === "network-error") return zh ? "连接中断，请先刷新检查是否已提交，再重试。" : "The connection was interrupted. Refresh to check whether it was submitted before retrying.";
    if (code === "too-large") return zh ? "视频最大 200MB，请压缩后上传。" : "Videos must be 200MB or smaller. Compress the clip and try again.";
    if (code === "bad-type" || code === "bad-content") return zh ? "请上传有效的 MP4、MOV 或 WebM 视频。" : "Upload a valid MP4, MOV or WebM video.";
    if (code === "too-many") return zh ? "视频数量已达上限，请先删除不需要的视频。" : "The video limit has been reached. Remove an unused clip first.";
    if (code === "quota-not-granted") return zh ? "请先联系教练发放分析次数。" : "Ask your coach to issue analysis credits first.";
    if (code === "quota-exhausted" || code === "insufficient-credits") return personal ? (zh ? "可用分析次数不足，请等待处理结果或联系教练发放次数。" : "No analysis credits are available. Wait for pending results or contact your coach for credits.") : (zh ? "可用分析次数不足，请等待正在处理的结果，或购买额外次数。" : "No analysis credits are available. Wait for pending results or purchase extra credits.");
    if (code === "lesson-not-completed") return zh ? "课程确认完成后才解锁分析额度。" : "Analysis credits unlock once the lesson is marked completed.";
    if (code === "analysis-in-progress" || code === "video-in-use") return zh ? "这个视频正在分析，请等待结果后再操作。" : "This video is being analyzed. Wait for its result before continuing.";
    if (code === "unsupported-video") return zh ? "此视频可观看；分析请上传 MP4 或 MOV。" : "This video can be viewed. Upload MP4 or MOV for analysis.";
    if (code === "unsupported-action") return zh ? "这个动作当前未开放分析，请刷新后选择已开放的动作。次数未扣除。" : "This action is not available for analysis. Refresh and choose an available action. No credit was used.";
    if (code === "service-unavailable" || code === "service-not-configured") return zh ? "分析服务暂不可用，次数未扣除。请稍后刷新重试。" : "The analysis service is unavailable. No credit was used. Refresh and try again later.";
    if (code === "price-not-configured" || code === "wechat-unavailable") return zh ? "教练尚未设置额外分析价格或微信收款方式，请联系教练。" : "The coach has not configured extra analysis pricing or WeChat payment. Contact your coach.";
    if (code === "purchase-not-configured") return zh ? "教练尚未设置额外分析价格或微信收款方式，请联系教练。" : "The coach has not configured extra analysis pricing or WeChat payment. Contact your coach.";
    if (code === "price-changed") return zh ? "分析价格已变化，已刷新最新价格。请核对后重新生成订单。" : "The analysis price changed. The latest price has been refreshed; check it before creating another order.";
    if (code === "state-changed") return zh ? "付款订单已更新，已刷新当前状态。请重新核对后再审核。" : "The payment order changed. Its current status has been refreshed; check it again before reviewing.";
    return zh ? "操作未完成，请刷新检查当前状态后重试。" : "The action could not be completed. Refresh to check its current status before retrying.";
  }

  async function mutate(operation: string, path: string, body: unknown = {}, method = "POST") {
    if (busy) return false;
    setBusy(operation);
    setError(null);
    setMessage(null);
    try {
      const response = await clientFetch(path, { method, headers: { "content-type": "application/json", "x-locale": locale }, body: method === "DELETE" ? undefined : JSON.stringify(body) });
      const data = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) {
        setError(failure(data.error));
        await refresh();
        return false;
      }
      requestKeys.current.delete(operation);
      await refresh();
      return true;
    } finally {
      setBusy(null);
    }
  }

  /** Read the clip's size and length first; warn before a credit is spent on footage that will not score. */
  async function inspect(file: File) {
    if (busy || checking) return;
    setError(null);
    if (file.size > 200 * 1024 * 1024) { setError(failure("too-large")); return; }
    if (!["video/mp4", "video/quicktime", "video/webm"].includes(file.type)) { setError(failure("bad-type")); return; }
    setChecking(true);
    try {
      const meta = await readVideoMetadata(file);
      const warnings = filmingWarnings(meta);
      if (warnings.length) setChecked({ file, meta, warnings });
      else await upload(file);
    } finally {
      setChecking(false);
    }
  }

  async function upload(file: File) {
    if (busy) return;
    setChecked(null);
    if (file.size > 200 * 1024 * 1024) { setError(failure("too-large")); return; }
    if (!["video/mp4", "video/quicktime", "video/webm"].includes(file.type)) { setError(failure("bad-type")); return; }
    setBusy("upload");
    setError(null);
    setMessage(null);
    try {
      const form = new FormData();
      form.set("file", file);
      if (accountId) form.set("expectedAccountId", accountId);
      if (caption.trim()) form.set("caption", caption.trim());
      const response = await clientFetch(videosBase, { method: "POST", body: form });
      const data = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) {
        setError(failure(data.error));
        if (response.status === 401 || response.status === 403 || (personal && data.error === "state-changed")) {
          setSessionChanged(true);
          setView(null);
          router.refresh();
        }
        // A changed account may have no grants; the wallet response still
        // identifies it and clears the previous account's private state.
        if (personal) await refresh();
        return;
      }
      setCaption("");
      setUploadOpen(false);
      setFilter("all");
      setMessage(zh ? "视频已上传。点“分析这个视频”选择动作并提交分析。" : "Video uploaded. Press Analyze this video to choose an action and submit it.");
      await refresh();
    } finally {
      setBusy(null);
    }
  }

  async function analyze(videoId: string) {
    if (!actionId) { setError(zh ? "请先选择视频中的练习动作。" : "Choose the action shown in the video first."); return; }
    if (!view?.actions.some((action) => action.id === actionId && action.available === true)) {
      setError(failure("unsupported-action"));
      return;
    }
    const submitted = submittedFreeSkiActionId(actionId, currentLevel || null);
    if (!submitted) { setError(zh ? "请先选择你目前的 CSIA 级别。" : "Choose your current CSIA level first."); return; }
    const operation = `analyze:${videoId}:${submitted}`;
    if (await mutate(operation, base, { videoId, actionId: submitted, requestKey: requestKey(operation), ...(accountId ? { expectedAccountId: accountId } : {}) })) {
      setAnalyzeVideoId(null);
      setFilter("all");
      setMessage(zh ? "已提交分析，完成后这里会自动更新。" : "Analysis submitted. This page updates when it finishes.");
    }
  }

  async function purchase() {
    const count = /^\d+$/.test(quantity) ? Number(quantity) : NaN;
    if (!Number.isInteger(count) || count < 1 || count > 50) { setError(zh ? "请选择 1–50 次额外分析。" : "Choose between 1 and 50 extra analyses."); return; }
    const operation = `purchase:${count}`;
    if (await mutate(operation, `${base}/purchases`, { quantity: count, expectedUnitPriceCents: view?.price?.unitCents, requestKey: requestKey(operation) })) setMessage(zh ? "已生成额外次数订单，请按订单金额通过微信付款。" : "Your extra-credit order is ready. Pay its stated amount by WeChat.");
  }

  const videos = useMemo(() => [...(view?.videos ?? initialVideos)]
    .sort((left, right) => (right.uploadedAt ?? "").localeCompare(left.uploadedAt ?? "")), [view, initialVideos]);
  const jobsByVideo = useMemo(() => {
    const grouped = new Map<string, AnalysisJobView[]>();
    for (const job of view?.jobs ?? []) {
      if (!job.videoId) continue;
      grouped.set(job.videoId, [...(grouped.get(job.videoId) ?? []), job]);
    }
    for (const list of grouped.values()) list.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    return grouped;
  }, [view]);
  // A deleted clip keeps its analyses; list them so their reports stay reachable.
  const orphanJobs = (view?.jobs ?? []).filter((job) => !job.videoId || !videos.some((video) => video.id === job.videoId));
  const statusOf = (video: AnalysisVideoView) => videoStatus(jobsByVideo.get(video.id)?.[0]);
  const counts = { all: videos.length, new: 0, processing: 0, done: 0, failed: 0 } as Record<Filter, number>;
  for (const video of videos) counts[statusOf(video)]++;
  const shown = filter === "all" ? videos : videos.filter((video) => statusOf(video) === filter);

  const hasSupportedVideo = videos.some((video) => video.analysisSupported ?? video.contentType !== "video/webm");
  const active = view?.quota.active ?? completed;
  const totalFree = active ? view?.quota.freeTotal ?? includedAnalysisCredits(bookedHours) : includedAnalysisCredits(bookedHours);
  const serviceReady = Boolean(view?.service.configured && view.service.available);
  const canAct = isCustomer || isOwnCoach;
  const anyActionAvailable = view?.actions.some((action) => action.available === true) ?? false;
  // Opening the analyse dialog for a clip; the dialog then requires an action (and level).
  const canStart = Boolean(canAct && view?.canAnalyze && active && serviceReady && anyActionAvailable && !busy);
  const selectedActionAvailable = view?.actions.some((action) => action.id === actionId && action.available === true) ?? false;
  const needsLevel = selectedActionAvailable && parseFreeSkiActionId(actionId)?.pathType === "improvement";
  const canRun = Boolean(canStart && analyzeVideoId && selectedActionAvailable && (!needsLevel || currentLevel));
  const parallelAvailable = view?.actions.some((action) => action.id === "parallel" && action.pathType === "improvement" && action.available === true) ?? false;
  const uploadAllowed = canUpload && (view?.canUpload ?? true);
  const beginnerStages = [
    { zh: "犁式滑行 / 停止", en: "Snowplow gliding / stopping" },
    { zh: "连续犁式转弯", en: "Linked snowplow turns" },
    { zh: "半犁式并腿", en: "Wedge-to-parallel" },
    { zh: "平行式转弯", en: "Parallel turns" },
  ];
  const actionGroups = new Map<string, { label: string; actions: VideoAnalysisView["actions"][number][] }>();
  for (const action of view?.actions ?? []) {
    const key = `${action.pathType}:${action.level ?? ""}`;
    if (!actionGroups.has(key)) actionGroups.set(key, { label: zh ? action.groupZh : action.groupEn, actions: [] });
    actionGroups.get(key)!.actions.push(action);
  }
  const analyzeVideo = videos.find((video) => video.id === analyzeVideoId) ?? null;
  const reportHref = (jobId: string) => `/video-analysis/report/${encodeURIComponent(jobId)}${personal ? "" : `?lesson=${encodeURIComponent(bookingCode)}`}`;
  const uploadLabel = personal ? (zh ? "上传滑雪视频" : "Upload skiing video") : (zh ? "上传课程视频" : "Upload lesson video");

  if (sessionChanged) return <div className="space-y-2 rounded-2xl border border-border bg-surface p-5"><h2 className="font-semibold">{zh ? "登录状态已变化" : "Your sign-in changed"}</h2><p role="alert" className="text-sm text-ink-2">{zh ? "正在重新检查订单访问权限。请重新登录后查看视频。" : "Booking access is being checked again. Sign in again to view videos."}</p></div>;

  return <section className="space-y-4" aria-label={personal ? (zh ? "我的视频" : "My videos") : (zh ? "课程视频" : "Lesson videos")}>
    <div className="flex flex-wrap items-start justify-between gap-4 rounded-2xl border border-border bg-surface p-4 shadow-[var(--shadow-sm)] sm:p-5">
      <div className="min-w-0 space-y-1">
        <h3 className="flex items-center gap-2 font-semibold"><Film className="size-4 text-cat-video" aria-hidden />{personal ? (zh ? "我的 FreeSki 视频分析" : "My FreeSki video analysis") : (zh ? "课程视频与分析" : "Lesson videos and analysis")}</h3>
        <p className="text-sm font-medium">{personal ? (zh ? `教练累计发放 ${view?.quota.grantTotal ?? 0} 次` : `${view?.quota.grantTotal ?? 0} credits issued by coaches`) : (zh ? `本节 ${bookedHours} 小时课包含 ${totalFree} 次共享免费分析` : `This ${bookedHours}-hour lesson includes ${totalFree} shared free analyses`)}</p>
        {!active ? <p role="status" className="text-sm text-ink-2">{zh ? "待课程完成后解锁。请教练在授课结束后确认课程已完成。" : "Credits unlock after the lesson is completed. Ask the coach to mark it completed after the teaching time ends."}</p>
          : view ? <p className="text-sm text-ink-2" data-numeric>{zh ? `可用 ${view.quota.remaining} 次 · 已使用 ${view.quota.used} 次 · 处理中 ${view.quota.reserved} 次 · 已购 ${view.quota.paidTotal} 次` : `${view.quota.remaining} available · ${view.quota.used} used · ${view.quota.reserved} processing · ${view.quota.paidTotal} purchased`}</p>
            : <p className="text-sm text-ink-3">{zh ? "正在读取可用额度…" : "Loading available credits…"}</p>}
        <Hint>{personal ? (zh ? "个人视频和报告默认仅你本人可见，可逐个授权教练人工点评。MP4、MOV 可分析，每个文件最大 200MB。分析失败或无法评分不扣次数。" : "Personal videos and reports are visible only to you unless you authorize a coach review for a clip. MP4 and MOV can be analysed; 200MB per file. Failed or ungradable analyses do not use a credit.") : (zh ? "视频及结果仅本订单学员和当前本课教练可见。额度由本订单共享，不按人数增加。MP4、MOV 可分析，WebM 只能观看；每个文件最大 200MB。" : "Videos and results are visible to this booking's student and current lesson coach. Credits are shared by this booking and do not multiply with group size. MP4 and MOV can be analysed; WebM can only be viewed; 200MB per file.")}</Hint>
        {personal && !view?.canUpload && <p className="text-sm text-ink-2">{zh ? "联系教练发放次数后，即可上传和分析视频。" : "Contact your coach for credits to start uploading and analysing clips."}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="sm" disabled={Boolean(busy)} onClick={() => void refresh()}><RefreshCw aria-hidden />{zh ? "刷新分析" : "Refresh analysis"}</Button>
        {uploadAllowed && <Button disabled={Boolean(busy)} onClick={() => { setError(null); setUploadOpen(true); }}>{busy === "upload" ? <Loader2 className="animate-spin" aria-hidden /> : <Upload aria-hidden />}{uploadLabel}</Button>}
      </div>
    </div>

    {view && !serviceReady && <Notice>{zh ? "视频分析服务暂未就绪，可先上传视频，服务恢复后再提交分析。" : "Video analysis is not ready. You can upload clips now and submit them when the service is available."}</Notice>}
    {view && !view.actions.length && <Notice>{zh ? "FreeSki 动作目录暂不可用，请稍后刷新。当前无法提交新的分析，已有结果仍可查看。" : "The FreeSki action catalog is temporarily unavailable. Refresh later to submit a new analysis; existing results remain available."}</Notice>}
    {refreshError && <Notice role="alert">{zh ? "暂时无法刷新分析状态。页面保留上次结果，请恢复网络后点击刷新。" : "Analysis status could not be refreshed. Your last results are kept; reconnect and press Refresh analysis."}</Notice>}
    {message && <p role="status" className="flex items-center gap-2 rounded-xl bg-success-bg px-4 py-3 text-sm font-medium text-success"><Check className="size-4 shrink-0" aria-hidden />{message}</p>}
    {!analyzeVideoId && !uploadOpen && <FieldError>{error}</FieldError>}

    {videos.length > 0 && <SegmentedTabs label={zh ? "按分析状态筛选" : "Filter by analysis status"} value={filter} onChange={setFilter} items={[
      { key: "all", label: zh ? "全部" : "All", count: counts.all },
      { key: "new", label: zh ? "待分析" : "Not analyzed", count: counts.new },
      { key: "processing", label: zh ? "分析中" : "In progress", count: counts.processing },
      { key: "done", label: zh ? "已完成" : "Done", count: counts.done },
      { key: "failed", label: zh ? "未成功" : "Not graded", count: counts.failed },
    ]} />}

    {videos.length === 0 ? <EmptyState icon={<Film aria-hidden />}
      title={personal ? (zh ? "还没有上传视频。" : "No videos uploaded yet.") : (zh ? "还没有课程视频。" : "No lesson videos yet.")}
      description={uploadAllowed ? (zh ? "上传一段完整的滑行片段，然后选择视频里的动作提交分析。" : "Upload a complete run, then choose the action shown to submit it for analysis.") : undefined}
      action={uploadAllowed ? <Button variant="secondary" onClick={() => setUploadOpen(true)}><Upload aria-hidden />{uploadLabel}</Button> : undefined} />
      : shown.length === 0 ? <EmptyState title={zh ? "这个分类下没有视频。" : "No videos in this group."} />
      : <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{shown.map((video) => {
        const jobs = jobsByVideo.get(video.id) ?? [];
        return <VideoCard key={video.id} video={video} jobs={jobs} locale={locale} actions={view?.actions ?? []} reportHref={reportHref}
          showAnalyze={canAct} canAnalyze={canStart} busyAnalyzing={Boolean(busy?.startsWith(`analyze:${video.id}:`))}
          canDelete={video.canDelete} deleteDisabled={Boolean(busy)}
          onAnalyze={() => { setError(null); setAnalyzeVideoId(video.id); }}
          onDelete={() => { if (window.confirm(zh ? "确定删除这个视频？" : "Delete this video?")) void mutate(`delete:${video.id}`, `${videosBase}/${video.id}`, {}, "DELETE"); }}
          feedback={isCustomer ? <details className="group rounded-lg border border-border">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-xs font-semibold text-ink-2">
              <span className="flex items-center gap-1.5"><MessageSquareText className="size-3.5" aria-hidden />{zh ? "教练人工点评" : "Human coach feedback"}</span>
              <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" aria-hidden />
            </summary>
            <div className="border-t border-border p-2"><CoachVideoFeedback locale={locale} videoId={video.id} bookingCode={bookingCode} personal={personal} /></div>
          </details> : undefined} />;
      })}</ul>}

    {orphanJobs.length > 0 && <details className="group rounded-2xl border border-border bg-surface shadow-[var(--shadow-sm)]">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-sm font-semibold text-ink-2">
        {zh ? `已删除视频的分析记录（${orphanJobs.length}）` : `Analyses of deleted videos (${orphanJobs.length})`}
        <ChevronRight className="size-4 transition-transform group-open:rotate-90" aria-hidden />
      </summary>
      <ul className="divide-y divide-border border-t border-border">{orphanJobs.map((job) => {
        const jobBadge = jobStatusBadge(job.status, zh);
        return <li key={job.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{analysisJobLabel(job.actionId, view?.actions ?? [], zh) ?? (zh ? "分析" : "Analysis")}</span>
            <Badge tone={jobBadge.tone}>{jobBadge.label}</Badge>
            <span className="text-xs text-ink-3">{formatTorontoShortDateTime(new Date(job.createdAt), locale)}</span>
          </span>
          {job.result !== null && job.result !== undefined && (job.status === "SUCCEEDED" || job.status === "FAILED") && <Link href={reportHref(job.id)} className="text-sm font-semibold text-accent hover:underline">{zh ? "查看报告" : "View report"}</Link>}
        </li>;
      })}</ul>
    </details>}

    {active && !personal && <div className="space-y-4 rounded-2xl border border-border bg-surface p-4 shadow-[var(--shadow-sm)] sm:p-5">
      <div className="space-y-1"><h3 className="font-semibold">{zh ? "额外分析次数" : "Extra analysis credits"}</h3><Hint>{zh ? "通过微信付款后通知教练，教练核对到账后才增加额度。每笔订单保留下单时的价格。" : "Pay by WeChat and notify your coach. Credits are added after the coach checks receipt. Each order keeps its original price."}</Hint></div>
      {!view ? <Hint>{zh ? "正在读取购买信息…" : "Loading purchase details…"}</Hint> : !view.price ? <p className="text-sm text-ink-3">{zh ? "教练尚未设置额外分析价格或微信收款，暂不能购买。" : "Extra analysis pricing or WeChat payment has not been configured. Purchases are unavailable."}</p> : <p className="text-sm font-semibold">{zh ? "每次" : "Per analysis"} {formatMoneyShort(view.price.unitCents)} CAD</p>}
      {isCustomer && view?.canPurchase && view.price && <div className="flex flex-wrap items-end gap-3"><div className="w-28 space-y-2"><Label htmlFor={`analysis-quantity-${bookingCode}`}>{zh ? "购买次数" : "Credits"}</Label><Input id={`analysis-quantity-${bookingCode}`} type="number" min={1} max={50} step={1} value={quantity} disabled={Boolean(busy)} onChange={(event) => setQuantity(event.target.value)} /></div><Button variant="secondary" disabled={Boolean(busy)} onClick={() => void purchase()}>{busy?.startsWith("purchase:") && <Loader2 className="animate-spin" aria-hidden />}{zh ? "生成微信付款订单" : "Create WeChat payment order"}</Button></div>}
      {view && isCustomer && view.price && !view.payment.wechatEnabled && <p className="text-sm text-ink-3">{zh ? "教练暂未启用微信收款，请联系教练。" : "The coach has not enabled WeChat payment. Contact your coach."}</p>}
      {view?.purchases.map((purchase) => <AnalysisPurchase key={purchase.id} purchase={purchase} locale={locale} isCustomer={isCustomer} canReview={isOwnCoach && view.canReview} payment={view.payment} busy={Boolean(busy)} onAction={(path, body) => mutate(`order:${purchase.id}`, `${base}/purchases/${purchase.id}/${path}`, body)} />)}
    </div>}

    {uploadAllowed && <Dialog open={uploadOpen} onClose={() => { setUploadOpen(false); setChecked(null); }} closeLabel={zh ? "关闭" : "Close"} title={uploadLabel}
      description={zh ? "MP4、MOV 可分析，WebM 只能观看；每个文件最大 200MB。上传后再选择视频里的动作提交分析。" : "MP4 and MOV can be analysed; WebM can only be viewed. 200MB per file. Choose the action to analyse after uploading."}>
      <section aria-label={zh ? "拍摄指南" : "Filming guide"} className="space-y-2 rounded-xl border border-border bg-surface-2 p-3.5">
        <p className="flex items-center gap-2 text-sm font-semibold"><Camera className="size-4 text-cat-video" aria-hidden />{zh ? "怎么拍分析才准" : "How to film for an accurate analysis"}</p>
        <ol className="list-decimal space-y-1 pl-5 text-sm text-ink-2">{FILMING_GUIDE.map((rule, index) => <li key={index}>{zh ? rule.zh : rule.en}</li>)}</ol>
      </section>
      {checked ? <div role="status" className="space-y-3 rounded-xl border border-amber-border bg-amber-bg p-3.5">
        <p className="text-sm font-semibold text-amber">{zh ? "这段视频可能分析不准" : "This clip may not analyse well"}</p>
        <p className="text-xs text-ink-2">{checked.file.name}{checked.meta.durationSec !== null ? ` · ${checked.meta.durationSec.toFixed(0)} s` : ""}{checked.meta.width && checked.meta.height ? ` · ${checked.meta.width}×${checked.meta.height}` : ""}</p>
        <ul className="list-disc space-y-1 pl-5 text-sm text-ink-2">{checked.warnings.map((warning) => <li key={warning.code}>{zh ? warning.zh : warning.en}</li>)}</ul>
        <p className="text-xs text-ink-3">{zh ? "可以照常上传；分析失败或无法评分不扣次数。" : "You can still upload it; a failed or ungradable analysis does not use a credit."}</p>
      </div> : null}
      <div className="space-y-2"><Label htmlFor={`analysis-caption-${bookingCode}`}>{zh ? "视频说明（选填）" : "Video caption (optional)"}</Label><Input id={`analysis-caption-${bookingCode}`} value={caption} maxLength={200} placeholder={zh ? "例如：蓝山 · 第二趟平行式" : "e.g. Blue Mountain, second parallel run"} disabled={Boolean(busy)} onChange={(event) => setCaption(event.target.value)} /></div>
      <input ref={fileRef} type="file" accept="video/mp4,video/quicktime,video/webm" className="hidden" aria-label={personal ? (zh ? "选择滑雪视频" : "Choose a skiing video") : (zh ? "选择课程视频" : "Choose a lesson video")} onChange={(event) => { const file = event.target.files?.[0]; if (file) void inspect(file); event.target.value = ""; }} />
      <FieldError>{uploadOpen ? error : null}</FieldError>
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" onClick={() => { setUploadOpen(false); setChecked(null); }}>{zh ? "取消" : "Cancel"}</Button>
        {checked ? <>
          <Button variant="secondary" disabled={Boolean(busy)} onClick={() => { setChecked(null); fileRef.current?.click(); }}>{zh ? "换一段视频" : "Choose another clip"}</Button>
          <Button disabled={Boolean(busy)} onClick={() => void upload(checked.file)}>{busy === "upload" ? <Loader2 className="animate-spin" aria-hidden /> : <Upload aria-hidden />}{zh ? "仍然上传" : "Upload anyway"}</Button>
        </> : <Button disabled={Boolean(busy) || checking} onClick={() => fileRef.current?.click()}>{busy === "upload" || checking ? <Loader2 className="animate-spin" aria-hidden /> : <Upload aria-hidden />}{busy === "upload" ? (zh ? "正在上传…" : "Uploading…") : checking ? (zh ? "正在检查视频…" : "Checking the clip…") : (zh ? "选择视频并上传" : "Choose a video and upload")}</Button>}
      </div>
    </Dialog>}

    {canAct && <Dialog open={analyzeVideoId !== null} onClose={() => setAnalyzeVideoId(null)} closeLabel={zh ? "关闭" : "Close"}
      title={zh ? "提交分析" : "Submit for analysis"}
      description={analyzeVideo ? `${analyzeVideo.caption || (zh ? "未命名视频" : "Untitled video")}` : undefined}>
      <section aria-labelledby={`analysis-learning-path-${bookingCode}`} className="space-y-3 rounded-xl border border-border bg-surface-2 p-3.5">
        <h3 id={`analysis-learning-path-${bookingCode}`} className="text-sm font-semibold">{zh ? "从新手到平行式" : "From first turns to parallel"}</h3>
        <ol className="grid gap-2 sm:grid-cols-2">
          {beginnerStages.map((stage, index) => <li key={stage.en} className="space-y-0.5 rounded-lg border border-border bg-surface p-2.5">
            <p className="text-sm font-semibold"><span className="mr-2 text-accent">{index + 1}</span>{zh ? stage.zh : stage.en}</p>
            <p className="text-xs text-ink-3">{index < 3 ? zh ? "暂未开放分析" : "Analysis not available yet" : !view ? zh ? "正在读取开放状态…" : "Checking availability…" : parallelAvailable ? zh ? "技术提升 · 已开放" : "Improvement · Available" : zh ? "暂未开放分析" : "Analysis not available yet"}</p>
          </li>)}
        </ol>
        <Hint>{zh ? `FreeSki 当前可评分的新手进阶动作从平行式转弯开始。前三阶段暂未开放自动分析，${personal ? "个人视频可以先上传保留，仍仅你本人可见" : "课程视频仍可上传给教练查看"}。请按视频里实际做出的动作选择。` : `FreeSki's currently supported beginner progression starts at parallel turns. Automated analysis is not available for the first three stages; ${personal ? "you can upload personal clips to keep them, visible only to you" : "lesson clips can still be uploaded for your coach to review"}. Choose the movement actually shown.`}</Hint>
        {parallelAvailable && <Button variant="secondary" size="sm" disabled={Boolean(busy) || !hasSupportedVideo || !serviceReady} onClick={() => setActionId("parallel")}>
          {selectedActionAvailable && actionId === "parallel" ? <Check aria-hidden /> : <Wand2 aria-hidden />}{selectedActionAvailable && actionId === "parallel" ? zh ? "已选择平行式转弯" : "Parallel turns selected" : zh ? "选择平行式转弯分析" : "Choose parallel-turn analysis"}
        </Button>}
      </section>
      {view?.actions.length ? <div className="space-y-2">
        <Label htmlFor={`analysis-action-${bookingCode}`}>{zh ? "视频中的练习动作" : "Action shown in the video"}</Label>
        <Select id={`analysis-action-${bookingCode}`} value={selectedActionAvailable ? actionId : ""} disabled={Boolean(busy) || !hasSupportedVideo || !anyActionAvailable} onChange={(event) => setActionId(event.target.value)}>
          <option value="">{zh ? "请选择动作" : "Choose an action"}</option>
          {[...actionGroups.entries()].map(([key, group]) => <optgroup key={key} label={group.label}>
            {group.actions.map((action) => <option key={action.id} value={action.id} disabled={action.available !== true}>{zh ? action.labelZh : action.labelEn}{action.available !== true ? zh ? "（暂未开放）" : " (Not available)" : ""}</option>)}
          </optgroup>)}
        </Select>
        <Hint>{zh ? "动作与开放状态同步自 FreeSki。日常练习请选择「技术提升」；CSIA 考证动作供备考学员使用。" : "Actions and availability are synced from FreeSki. Choose Improvement for everyday practice; CSIA certification actions are for exam preparation."}</Hint>
        {needsLevel && <div className="space-y-2 pt-2">
          <Label htmlFor={`analysis-level-${bookingCode}`}>{zh ? "你目前的 CSIA 级别" : "Your current CSIA level"}</Label>
          <Select id={`analysis-level-${bookingCode}`} value={currentLevel} disabled={Boolean(busy)} onChange={(event) => setCurrentLevel(event.target.value as FreeSkiCurrentLevel | "")}>
            <option value="">{zh ? "请选择级别" : "Choose a level"}</option>
            {FREESKI_CURRENT_LEVELS.map((level) => <option key={level.id} value={level.id}>{zh ? level.labelZh : level.labelEn}</option>)}
          </Select>
          <Hint>{zh ? "技术提升和高你一级的 CSIA 通过示范对比：还没考级对比 1 级，1 级对比 2 级，依此类推；4 级对比专家示范。报告里会写明实际对比的示范。" : "Improvement compares you with CSIA pass examples one level above yours: no level compares with Level 1, Level 1 with Level 2, and so on; Level 4 compares with expert examples. The report states which examples were used."}</Hint>
        </div>}
      </div> : null}
      <FieldError>{analyzeVideoId ? error : null}</FieldError>
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" onClick={() => setAnalyzeVideoId(null)}>{zh ? "取消" : "Cancel"}</Button>
        <Button disabled={!canRun} onClick={() => { if (analyzeVideoId) void analyze(analyzeVideoId); }}>{busy?.startsWith("analyze:") ? <Loader2 className="animate-spin" aria-hidden /> : <Wand2 aria-hidden />}{zh ? "开始分析" : "Start analysis"}</Button>
      </div>
    </Dialog>}
  </section>;
}

function Notice({ children, role = "status" }: { children: React.ReactNode; role?: "status" | "alert" }) {
  return <p role={role} className="flex items-start gap-2 rounded-xl border border-amber-border bg-amber-bg px-4 py-3 text-sm text-amber">
    <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />{children}
  </p>;
}

function AnalysisPurchase({ purchase, locale, isCustomer, canReview, payment, busy, onAction }: {
  purchase: AnalysisPurchaseView;
  locale: Locale;
  isCustomer: boolean;
  canReview: boolean;
  payment: VideoAnalysisView["payment"];
  busy: boolean;
  onAction: (path: string, body: unknown) => Promise<boolean>;
}) {
  const zh = locale === "zh";
  const [note, setNote] = useState("");
  const [reference, setReference] = useState("");
  const [needReason, setNeedReason] = useState(false);
  const pending = purchase.status === "PENDING_PAYMENT_REVIEW";
  const payable = purchase.status === "AWAITING_PAYMENT" || purchase.status === "PAYMENT_REJECTED";
  const labels = { AWAITING_PAYMENT: zh ? "待微信付款" : "Awaiting WeChat payment", PENDING_PAYMENT_REVIEW: zh ? "待教练核对到账" : "Awaiting coach receipt check", PAYMENT_REJECTED: zh ? "付款未通过" : "Payment rejected", CONFIRMED: zh ? "已确认，额度已增加" : "Confirmed; credits added", CANCELLED: zh ? "已取消" : "Cancelled" };
  return <div className="space-y-3 rounded-xl border border-border bg-surface-2 p-4">
    <p className="text-sm font-semibold">{zh ? `${purchase.quantity} 次额外分析` : `${purchase.quantity} extra analyses`} · {formatMoneyShort(purchase.totalCents)} <span className="text-ink-3">({formatMoneyShort(purchase.unitPriceCents)} × {purchase.quantity})</span></p>
    <p role="status" className="text-sm text-ink-2">{labels[purchase.status]}</p>
    {purchase.reviewNote && <p className="break-words text-sm text-amber">{zh ? "教练备注：" : "Coach note: "}{purchase.reviewNote}</p>}
    {isCustomer && payable && <div className="space-y-3">
      <p className="text-sm">{zh ? "请通过微信付款给" : "Pay by WeChat to"} <strong>{payment.coachName}</strong> · {zh ? "付款备注" : "Payment reference"}: <span className="break-all font-mono">{purchase.id}</span></p>
      {payment.wechatQrUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={payment.wechatQrUrl} alt={zh ? "教练微信收款码" : "Coach WeChat payment QR"} className="max-h-60 max-w-full rounded-xl border border-border object-contain" />
      )}
      {payment.wechatId && <p className="break-words text-sm">{zh ? "微信号：" : "WeChat ID: "}{payment.wechatId}</p>}
      <div className="space-y-2"><Label htmlFor={`analysis-reference-${purchase.id}`}>{zh ? "付款备注或参考号（选填）" : "Payment note or reference (optional)"}</Label><Input id={`analysis-reference-${purchase.id}`} value={reference} maxLength={120} disabled={busy} onChange={(event) => setReference(event.target.value)} /></div>
      <div className="flex flex-wrap gap-2"><Button disabled={busy} onClick={() => void onAction("payment", { reference: reference.trim() || undefined })}>{zh ? "我已用微信付款，通知教练" : "I paid by WeChat; notify coach"}</Button><Button variant="ghost" disabled={busy} onClick={() => void onAction("cancel", {})}>{zh ? "取消购买" : "Cancel purchase"}</Button></div>
    </div>}
    {canReview && (pending || payable) && <div className="space-y-3">
      <Hint>{zh ? "请先在微信中核对实际到账金额。确认后增加次数，驳回不会增加额度。" : "Check the amount actually received in WeChat first. Confirmation adds credits; rejection does not."}</Hint>
      <div className="space-y-2"><Label htmlFor={`analysis-review-note-${purchase.id}`}>{zh ? "审核备注（驳回时必填）" : "Review note (required for rejection)"}</Label><Input id={`analysis-review-note-${purchase.id}`} value={note} maxLength={500} disabled={busy} onChange={(event) => { setNote(event.target.value); setNeedReason(false); }} /></div>
      <div className="flex flex-wrap gap-2"><Button disabled={busy} onClick={() => void onAction("review", { action: "confirm", expectedUpdatedAt: purchase.updatedAt, note: note.trim() || undefined, ...(payable ? { manualReceipt: { method: "WECHAT" } } : {}) })}><Check aria-hidden />{zh ? "已核对微信到账，确认收款" : "WeChat receipt checked; confirm"}</Button>{pending && <Button variant="secondary" disabled={busy} onClick={() => { if (!note.trim()) { setNeedReason(true); return; } void onAction("review", { action: "reject", expectedUpdatedAt: purchase.updatedAt, note: note.trim() }); }}>{zh ? "驳回付款" : "Reject payment"}</Button>}</div>
      <FieldError>{needReason ? zh ? "请填写驳回原因。" : "Enter a reason for rejecting payment." : null}</FieldError>
    </div>}
  </div>;
}
