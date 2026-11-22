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
import { Camera, Check, ChevronRight, CircleAlert, Film, Loader2, MessageSquareText, Plus, RefreshCw, Upload, Wand2 } from "lucide-react";
import { CoachVideoFeedback } from "./coach-video-feedback";
import { VideoCard, analysisJobLabel, jobStatusBadge, videoStatus, type VideoStatus } from "./video-card";
import type { AnalysisJobView, AnalysisPurchaseView, AnalysisVideoView, VideoAnalysisView } from "./video-analysis-types";
import { FREESKI_CURRENT_LEVELS, isExamRecognition, parseFreeSkiActionId, submittedFreeSkiActionId, type FreeSkiCurrentLevel } from "@/lib/freeski/actions";
import { FILMING_GUIDE, filmingWarnings, readVideoMetadata, type FilmingWarning, type VideoMeta } from "@/lib/video-analysis/precheck";
import { DEFAULT_TIER, TIER_HALVES, type AnalysisTier } from "@/lib/video-analysis/tiers";
import { TierPicker } from "./analysis-tier-picker";

type Filter = "all" | VideoStatus;

/**
 * The video library for one credit source: a personal wallet or one lesson.
 * Videos are cards filtered by where their newest analysis stands; uploading
 * and choosing what to analyse happen in dialogs, and each finished analysis
 * opens on its own report page.
 */
export function VideoAnalysisPanel({ locale, bookingCode, completed, isCustomer, isOwnCoach, canUpload, initialVideos, initialView, accountId, initialAnalyze = null }: {
  locale: Locale;
  bookingCode: string;
  bookedHours: number;
  /** Opens the analyse dialog for a clip, correcting a recognised analysis of it when `replacesJobId` is set. */
  initialAnalyze?: { videoId: string; replacesJobId?: string | null } | null;
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
  // A recognised analysis being corrected: its credit is handed back as the new one is taken.
  const [replacesJobId, setReplacesJobId] = useState<string | null>(initialAnalyze?.replacesJobId ?? null);
  const [currentLevel, setCurrentLevel] = useState<FreeSkiCurrentLevel | "">("");
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
  const [analyzeVideoId, setAnalyzeVideoId] = useState<string | null>(initialAnalyze?.videoId ?? null);
  const [tier, setTier] = useState<AnalysisTier>(DEFAULT_TIER);
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
    if (code === "not-replaceable") return zh ? "这次分析不能再改动作了，请重新选动作分析。" : "That analysis can no longer be corrected; analyse the clip again instead.";
    if (code === "free-daily-limit") return zh ? "今天的免费分析次数用完了，可以选深度或完全档，或者明天再来。" : "Today's free analyses are used up. Choose deep or complete, or come back tomorrow.";
    if (code === "invalid-tier") return zh ? "请选择分析档位。" : "Choose an analysis tier.";
    if (code === "untrusted-origin") return zh ? "这个网页的地址和网站地址不一致，服务器没有接受这次提交。请从网站地址重新打开后再试。" : "This page's address does not match the site's, so the server refused the request. Open the site from its own address and try again.";
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
      const data = await response.json().catch(() => ({})) as { error?: string; id?: string };
      if (!response.ok) {
        setError(failure(data.error));
        // A request refused for where it came from says nothing about who is signed in.
        if (response.status === 401 || (response.status === 403 && data.error !== "untrusted-origin") || (personal && data.error === "state-changed")) {
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
      await refresh();
      if (data.id && ready) setAnalyzeVideoId(data.id);
      else setMessage(zh ? "视频已上传，现在还不能提交分析；可以稍后在下面点“分析这个视频”。" : "Video uploaded. It cannot be submitted yet; press Analyze this video below later.");
    } finally {
      setBusy(null);
    }
  }

  async function analyze(videoId: string) {
    const actionId = chosenAction;
    if (!actionId) { setError(zh ? "请先选择视频中的练习动作。" : "Choose the action shown in the video first."); return; }
    if (!view?.actions.some((action) => action.id === actionId && action.available === true)) {
      setError(failure("unsupported-action"));
      return;
    }
    const submitted = submittedFreeSkiActionId(actionId, currentLevel || null);
    if (!submitted) {
      setError(isExamRecognition(parseFreeSkiActionId(actionId)) ? (zh ? "请先选择要考的 CSIA 级别。" : "Choose the CSIA level you are going for first.")
        : zh ? "请先选择你目前的 CSIA 级别。" : "Choose your current CSIA level first.");
      return;
    }
    const operation = `analyze:${videoId}:${submitted}:${tier}`;
    if (await mutate(operation, base, { videoId, actionId: submitted, tier, requestKey: requestKey(operation), ...(accountId ? { expectedAccountId: accountId } : {}),
      ...(replacesJobId ? { replacesJobId } : {}) })) {
      setReplacesJobId(null);
      setAnalyzeVideoId(null);
      setFilter("all");
      setMessage(zh ? "已提交分析，完成后这里会自动更新。" : "Analysis submitted. This page updates when it finishes.");
    }
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
  const serviceReady = Boolean(view?.service.configured && view.service.available);
  const canAct = isCustomer || isOwnCoach;
  const anyActionAvailable = view?.actions.some((action) => action.available === true) ?? false;
  // Opening the analyse dialog for a clip; the dialog then requires an action (and level).
  const ready = Boolean(canAct && view?.canAnalyze && active && serviceReady && anyActionAvailable);
  const canStart = ready && !busy;
  const autoOption = replacesJobId ? null : view?.actions.find((action) => action.id === "auto:improvement" && action.available === true) ?? null;
  const chosenAction = actionId || autoOption?.id || "";
  const selectedActionAvailable = view?.actions.some((action) => action.id === chosenAction && action.available === true) ?? false;
  const chosenSelection = parseFreeSkiActionId(chosenAction);
  // Improvement compares one level up; a recognised run uses the level to pick what to compare with.
  const needsLevel = selectedActionAvailable && (chosenSelection?.pathType === "improvement" || chosenSelection?.actionName === "auto");
  // An exam run left open is recognised among one exam's runs: the level asked for is the exam's.
  const examLevel = isExamRecognition(chosenSelection);
  const levelChosen = examLevel && currentLevel === "none" ? "" : currentLevel;
  // The chosen tier must be open: a free one within today's allowance, a paid one with the credits for it.
  const freeOpen = view?.quota.freeLimit === null || view?.quota.freeLimit === undefined || (view.quota.freeToday ?? 0) < view.quota.freeLimit;
  const tierAllowed = Boolean(view?.unlimited) || (TIER_HALVES[tier] === 0 ? freeOpen : (view?.quota.remainingHalves ?? 0) >= TIER_HALVES[tier]);
  const canRun = Boolean(canStart && analyzeVideoId && selectedActionAvailable && (!needsLevel || levelChosen) && tierAllowed);
  const uploadAllowed = canUpload && (view?.canUpload ?? true);
  const actionGroups = new Map<string, { label: string; actions: VideoAnalysisView["actions"][number][] }>();
  for (const action of view?.actions ?? []) {
    // A correction names the action itself.
    if (replacesJobId && action.id.startsWith("auto:")) continue;
    const key = action.id.startsWith("auto:") ? "auto" : `${action.pathType}:${action.level ?? ""}`;
    if (!actionGroups.has(key)) actionGroups.set(key, { label: zh ? action.groupZh : action.groupEn, actions: [] });
    actionGroups.get(key)!.actions.push(action);
  }
  const analyzeVideo = videos.find((video) => video.id === analyzeVideoId) ?? null;
  const reportHref = (jobId: string) => `/video-analysis/report/${encodeURIComponent(jobId)}${personal ? "" : `?lesson=${encodeURIComponent(bookingCode)}`}`;
  const pdfHref = (jobId: string) => `/api/video-analysis/reports/${personal ? "account" : "booking"}/${encodeURIComponent(jobId)}/pdf?lang=${locale}`;
  // In a lesson only its coach analyses; a student there can still add a clip for the coach.
  const uploadLabel = personal || ready ? (zh ? "分析新视频" : "Analyse a new video") : (zh ? "上传视频" : "Upload a video");

  if (sessionChanged) return <div className="space-y-2 rounded-2xl border border-border bg-surface p-5"><h2 className="font-semibold">{zh ? "登录状态已变化" : "Your sign-in changed"}</h2><p role="alert" className="text-sm text-ink-2">{zh ? "正在重新检查订单访问权限。请重新登录后查看视频。" : "Booking access is being checked again. Sign in again to view videos."}</p></div>;

  return <section className="space-y-4" aria-label={personal ? (zh ? "我的视频" : "My videos") : (zh ? "课程视频" : "Lesson videos")}>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0 space-y-0.5">
        <h2 className="flex items-center gap-2 text-lg font-semibold"><Film className="size-5 text-cat-video" aria-hidden />{personal ? (zh ? "我的分析" : "My analyses") : (zh ? "课程视频与分析" : "Lesson videos and analysis")}</h2>
        {!personal && (view?.unlimited
          ? <p className="text-sm text-ink-2">{zh ? `你是本课教练：分析不限次数${active ? "" : "，课程完成后才能分析"}。` : `As this lesson's coach you analyse without limit${active ? "" : ", once the lesson is completed"}.`}</p>
          : <p className="text-sm text-ink-2">{zh ? "这节课的视频由教练上传和分析，你随时能看；你自己的视频在“我的分析”里分析，用账户里的次数。" : "Your coach uploads and analyses this lesson's videos for you to watch; analyse your own videos under My analyses with your account's credits."}</p>)}
        {personal && !view?.canUpload && <p className="text-sm text-ink-2">{zh ? "联系教练发放次数后，即可上传和分析视频。" : "Contact your coach for credits to start uploading and analysing clips."}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="sm" disabled={Boolean(busy)} onClick={() => void refresh()} aria-label={zh ? "刷新" : "Refresh"}><RefreshCw aria-hidden /></Button>
        {uploadAllowed && <Button disabled={Boolean(busy)} onClick={() => { setError(null); setUploadOpen(true); }}>{busy === "upload" ? <Loader2 className="animate-spin" aria-hidden /> : <Plus aria-hidden />}{uploadLabel}</Button>}
      </div>
    </div>

    {view && !serviceReady && <Notice>{zh ? "视频分析服务暂未就绪，可先上传视频，服务恢复后再提交分析。" : "Video analysis is not ready. You can upload clips now and submit them when the service is available."}</Notice>}
    {view && !view.actions.length && <Notice>{zh ? "FreeSki 动作目录暂不可用，请稍后刷新。当前无法提交新的分析，已有结果仍可查看。" : "The FreeSki action catalog is temporarily unavailable. Refresh later to submit a new analysis; existing results remain available."}</Notice>}
    {refreshError && <Notice role="alert">{zh ? "暂时无法刷新分析状态。页面保留上次结果，请恢复网络后点击刷新。" : "Analysis status could not be refreshed. Your last results are kept; reconnect and press Refresh analysis."}</Notice>}
    {message && <p role="status" className="flex items-center gap-2 rounded-xl bg-success-bg px-4 py-3 text-sm font-medium text-success"><Check className="size-4 shrink-0" aria-hidden />{message}</p>}
    {!analyzeVideoId && !uploadOpen && <FieldError>{error}</FieldError>}

    {videos.length > 4 && <SegmentedTabs label={zh ? "按分析状态筛选" : "Filter by analysis status"} value={filter} onChange={setFilter} items={[
      { key: "all", label: zh ? "全部" : "All", count: counts.all },
      { key: "new", label: zh ? "待分析" : "Not analyzed", count: counts.new },
      { key: "processing", label: zh ? "分析中" : "In progress", count: counts.processing },
      { key: "done", label: zh ? "已完成" : "Done", count: counts.done },
      { key: "failed", label: zh ? "未成功" : "Not graded", count: counts.failed },
    ]} />}

    {videos.length === 0 ? <EmptyState icon={<Film aria-hidden />}
      title={personal ? (zh ? "还没有分析过视频。" : "No videos analysed yet.") : (zh ? "还没有课程视频。" : "No lesson videos yet.")}
      description={uploadAllowed ? (zh ? "点“分析新视频”，选一段完整的滑行片段，再选视频里的动作就能开始。" : "Press Analyse a new video, pick a complete run, then choose the action shown to start.") : undefined}
      action={uploadAllowed ? <Button onClick={() => setUploadOpen(true)}><Plus aria-hidden />{uploadLabel}</Button> : undefined} />
      : shown.length === 0 ? <EmptyState title={zh ? "这个分类下没有视频。" : "No videos in this group."} />
      : <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{shown.map((video) => {
        const jobs = jobsByVideo.get(video.id) ?? [];
        return <VideoCard key={video.id} video={video} jobs={jobs} locale={locale} actions={view?.actions ?? []} reportHref={reportHref} pdfHref={pdfHref}
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
            <span className="font-semibold">{analysisJobLabel(job.actionId, view?.actions ?? [], zh, job.result) ?? (zh ? "分析" : "Analysis")}</span>
            <Badge tone={jobBadge.tone}>{jobBadge.label}</Badge>
            <span className="text-xs text-ink-3">{formatTorontoShortDateTime(new Date(job.createdAt), locale)}</span>
          </span>
          {job.result !== null && job.result !== undefined && (job.status === "SUCCEEDED" || job.status === "FAILED") && <Link href={reportHref(job.id)} className="text-sm font-semibold text-accent hover:underline">{zh ? "查看报告" : "View report"}</Link>}
        </li>;
      })}</ul>
    </details>}

    {active && !personal && isOwnCoach && (view?.purchases.length ?? 0) > 0 && <div className="space-y-4 rounded-2xl border border-border bg-surface p-4 shadow-[var(--shadow-sm)] sm:p-5">
      <div className="space-y-1"><h3 className="font-semibold">{zh ? "学员购买的分析次数" : "Analyses the student bought"}</h3><Hint>{zh ? "核对微信到账后确认，次数会加到学员的账户里。" : "Confirm once WeChat shows the payment; the analyses go to the student's account."}</Hint></div>
      {view?.purchases.map((purchase) => <AnalysisPurchase key={purchase.id} purchase={purchase} locale={locale} isCustomer={false} canReview={isOwnCoach && view.canReview} payment={view.payment} busy={Boolean(busy)} onAction={(path, body) => mutate(`order:${purchase.id}`, `${base}/purchases/${purchase.id}/${path}`, body)} />)}
    </div>}

    {uploadAllowed && <Dialog open={uploadOpen} onClose={() => { setUploadOpen(false); setChecked(null); }} closeLabel={zh ? "关闭" : "Close"} title={uploadLabel}
      description={zh ? "MP4 或 MOV，最大 200MB；上传后选动作和分析档位。" : "MP4 or MOV, up to 200MB; then choose the action and the tier."}>
      <Hint>{personal ? (zh ? "只有你自己能看，视频保存到 5 月 31 日，报告一直保留。" : "Only you can see it; the video is kept until May 31, the report for good.")
        : (zh ? "只有本课学员和教练能看，视频保存到 5 月 31 日。" : "Only this lesson's students and coach can see it; kept until May 31.")}
        {" "}<Link href="/video-analysis/guide#keeping" className="font-semibold text-accent hover:underline">{zh ? "详见使用指南" : "More in the guide"}</Link></Hint>
      <details aria-label={zh ? "拍摄指南" : "Filming guide"} className="group rounded-xl border border-border bg-surface-2">
        <summary className="flex min-h-10 cursor-pointer list-none items-center gap-2 px-3.5 text-sm font-semibold"><Camera className="size-4 text-cat-video" aria-hidden />{zh ? "怎么拍分析才准" : "How to film for an accurate analysis"}
          <ChevronRight className="ml-auto size-4 text-ink-3 transition-transform group-open:rotate-90" aria-hidden /></summary>
        <ol className="list-decimal space-y-1 border-t border-border px-3.5 py-2.5 pl-8 text-sm text-ink-2">{FILMING_GUIDE.map((rule, index) => <li key={index}>{zh ? rule.zh : rule.en}</li>)}</ol>
      </details>
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

    {canAct && <Dialog open={analyzeVideoId !== null} onClose={() => { setAnalyzeVideoId(null); setReplacesJobId(null); }} closeLabel={zh ? "关闭" : "Close"}
      title={zh ? "开始分析" : "Start the analysis"}
      description={analyzeVideo ? `${analyzeVideo.caption || (zh ? "未命名视频" : "Untitled video")}` : undefined}>
      {view?.actions.length ? <div className="space-y-2">
        <Label htmlFor={`analysis-action-${bookingCode}`}>{zh ? "1. 视频里的动作" : "1. The action in the video"}</Label>
        <Select id={`analysis-action-${bookingCode}`} value={selectedActionAvailable ? chosenAction : ""} disabled={Boolean(busy) || !hasSupportedVideo || !anyActionAvailable} onChange={(event) => setActionId(event.target.value)}>
          {!autoOption && <option value="">{zh ? "请选择动作" : "Choose an action"}</option>}
          {[...actionGroups.entries()].map(([key, group]) => <optgroup key={key} label={group.label}>
            {group.actions.map((action) => <option key={action.id} value={action.id} disabled={action.available !== true}>{zh ? action.labelZh : action.labelEn}{action.available !== true ? zh ? "（暂未开放）" : " (Not available)" : ""}</option>)}
          </optgroup>)}
        </Select>
        <Hint>{replacesJobId ? (zh ? "改正自动识别：按你选的动作重新分析这段视频，上一次的次数会退回。" : "Correcting the recognition: this clip is analysed again as the action you choose, and the earlier credit is handed back.")
          : chosenSelection?.actionName === "auto" ? (zh ? "不选动作时由 FreeSki 自动识别，报告里会写识别结果，认错了可以改。" : "Without a choice FreeSki recognises the action; the report says what it found, and you can correct it.")
          : (zh ? "日常练习选「技术提升」，备考选对应级别的考证动作。" : "Choose Improvement for everyday practice, or the certification action you are preparing for.")}</Hint>
        {needsLevel && <div className="space-y-2 pt-1">
          <Label htmlFor={`analysis-level-${bookingCode}`}>{examLevel ? (zh ? "你要考的 CSIA 级别" : "The CSIA level you are going for") : zh ? "你目前的 CSIA 级别" : "Your current CSIA level"}</Label>
          <Select id={`analysis-level-${bookingCode}`} value={levelChosen} disabled={Boolean(busy)} onChange={(event) => setCurrentLevel(event.target.value as FreeSkiCurrentLevel | "")}>
            <option value="">{zh ? "请选择级别" : "Choose a level"}</option>
            {FREESKI_CURRENT_LEVELS.filter((level) => !examLevel || level.id !== "none").map((level) => <option key={level.id} value={level.id}>{zh ? level.labelZh : level.labelEn}</option>)}
          </Select>
          <Hint>{examLevel ? (zh ? "在这一级的考试动作里识别，并和这一级的标准动作比。" : "The run is recognised among this level's exam runs and compared with its pass demonstrations.")
            : chosenSelection?.actionName === "auto" ? (zh ? "填上级别识别更准，会和高你一级的标准动作比。" : "Your level makes the recognition more accurate; you are compared with pass examples one level above yours.")
            : (zh ? "会和高你一级的 CSIA 标准动作对比。" : "You are compared with CSIA pass examples one level above yours.")}</Hint>
        </div>}
      </div> : null}
      <div className="space-y-2">
        <p className="text-sm font-semibold">{zh ? "2. 分析档位" : "2. Analysis tier"}</p>
        <TierPicker name={`analysis-tier-${bookingCode}`} value={tier} onChange={setTier} zh={zh} disabled={Boolean(busy)}
          unlimited={Boolean(view?.unlimited)} remainingHalves={view?.quota.remainingHalves ?? null}
          freeLeft={view?.quota.freeLimit ? view.quota.freeLimit - (view.quota.freeToday ?? 0) : null} />
        <Hint>{zh ? "分析完成后也能改档位：免费档之间随便改，往上改只扣差价。" : "You can change the tier later: free tiers swap freely, and going up costs only the difference."}</Hint>
      </div>
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

export function AnalysisPurchase({ purchase, locale, isCustomer, canReview, payment, busy, onAction }: {
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
