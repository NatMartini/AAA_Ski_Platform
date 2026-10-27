"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { clientFetch } from "@/lib/client-fetch";
import { clientRandomUUID } from "@/lib/browser-helpers";
import { formatMoneyShort } from "@/lib/pricing";
import type { Locale } from "@/i18n/routing";
import { useRouter } from "@/i18n/navigation";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FieldError, Hint, Input, Label, Select } from "@/components/ui/field";
import { Check, Loader2, RefreshCw, Trash2, Upload, Video, Wand2 } from "lucide-react";
import { VideoAnalysisResult } from "./video-analysis-result";
import { CoachVideoFeedback } from "./coach-video-feedback";
import type { AnalysisPurchaseView, AnalysisVideoView, VideoAnalysisView } from "./video-analysis-types";
import { includedAnalysisCredits } from "@/lib/video-analysis/quota";
import { FREESKI_CURRENT_LEVELS, getFreeSkiActionOption, parseFreeSkiActionId, submittedFreeSkiActionId, type FreeSkiCurrentLevel } from "@/lib/freeski/actions";

// A job waiting for compute never times out; only a completed analysis uses its credit.
const COMPUTE_WAIT = {
  compute_offline: ["分析算力暂时不在线，任务已保留，恢复后自动开始。等待不算超时，分析完成才扣次数。",
    "Analysis compute is offline for now. Your job is kept and starts automatically when it is back. Waiting never times out, and a credit is used only when the analysis completes."],
  waiting_for_compute: ["正在等待分析算力，空出后自动开始。等待不算超时，分析完成才扣次数。",
    "Waiting for analysis compute; it starts automatically when compute is free. Waiting never times out, and a credit is used only when the analysis completes."],
} as const;

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

  async function upload(file: File) {
    if (busy) return;
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
      setMessage(zh ? "视频已上传。选择动作后可提交分析。" : "Video uploaded. Choose an action to submit it for analysis.");
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
    if (await mutate(operation, base, { videoId, actionId: submitted, requestKey: requestKey(operation), ...(accountId ? { expectedAccountId: accountId } : {}) })) setMessage(zh ? "已提交分析，结果会自动更新。" : "Analysis submitted. The result will update automatically.");
  }

  async function purchase() {
    const count = /^\d+$/.test(quantity) ? Number(quantity) : NaN;
    if (!Number.isInteger(count) || count < 1 || count > 50) { setError(zh ? "请选择 1–50 次额外分析。" : "Choose between 1 and 50 extra analyses."); return; }
    const operation = `purchase:${count}`;
    if (await mutate(operation, `${base}/purchases`, { quantity: count, expectedUnitPriceCents: view?.price?.unitCents, requestKey: requestKey(operation) })) setMessage(zh ? "已生成额外次数订单，请按订单金额通过微信付款。" : "Your extra-credit order is ready. Pay its stated amount by WeChat.");
  }

  const videos = view?.videos ?? initialVideos;
  const hasSupportedVideo = videos.some((video) => video.analysisSupported ?? video.contentType !== "video/webm");
  const active = view?.quota.active ?? completed;
  const totalFree = active ? view?.quota.freeTotal ?? includedAnalysisCredits(bookedHours) : includedAnalysisCredits(bookedHours);
  const serviceReady = Boolean(view?.service.configured && view.service.available);
  const selectedActionAvailable = view?.actions.some((action) => action.id === actionId && action.available === true) ?? false;
  const needsLevel = selectedActionAvailable && parseFreeSkiActionId(actionId)?.pathType === "improvement";
  const canRun = Boolean((isCustomer || isOwnCoach) && view?.canAnalyze && active && serviceReady && selectedActionAvailable && (!needsLevel || currentLevel) && !busy);
  const parallelAvailable = view?.actions.some((action) => action.id === "parallel" && action.pathType === "improvement" && action.available === true) ?? false;
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
  const statusLabels: Record<string, string> = { QUEUED: zh ? "排队中" : "Queued", RUNNING: zh ? "分析中" : "Analyzing", SUCCEEDED: zh ? "分析已完成" : "Analysis complete", FAILED: zh ? "分析失败，次数未扣除" : "Analysis failed; no credit used" };
  const statusLabel = (status: string) => statusLabels[status] ?? status;

  if (sessionChanged) return <Card className="space-y-2"><CardTitle>{zh ? "登录状态已变化" : "Your sign-in changed"}</CardTitle><p role="alert" className="text-sm text-ink-2">{zh ? "正在重新检查订单访问权限。请重新登录后查看视频。" : "Booking access is being checked again. Sign in again to view videos."}</p></Card>;

  return <Card className="space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="space-y-1"><CardTitle className="flex items-center gap-2"><Video className="size-5 text-accent" aria-hidden />{personal ? (zh ? "我的 FreeSki 视频分析" : "My FreeSki video analysis") : (zh ? "课程视频与分析" : "Lesson videos and analysis")}</CardTitle><CardDescription>{personal ? (zh ? "使用教练发放的次数，上传滑雪片段并查看动作分析。个人视频及结果默认仅你可见，可逐片授权教练人工点评，无需课程订单。MP4、MOV 可分析，每个文件最大 200MB。" : "Use coach-issued credits to analyse your skiing clips without a lesson booking. Personal videos and reports are private to you unless you explicitly authorize a coach review. Upload MP4 or MOV for analysis; 200MB per file.") : (zh ? "学员可上传自己的课程片段，教练也可上传。视频及结果仅本订单学员和当前本课教练可见，其他点评教练须另获授权。MP4、MOV、WebM 可观看，每个文件最大 200MB；视频分析请上传 MP4 或 MOV。" : "Students and their coach can upload lesson clips. Videos and results are visible to this booking's student and current lesson coach. Other reviewers need explicit authorization. MP4, MOV and WebM can be viewed; 200MB per file. Upload MP4 or MOV for analysis.")}</CardDescription></div>
      <Button variant="ghost" size="sm" disabled={Boolean(busy)} onClick={() => void refresh()}><RefreshCw aria-hidden />{zh ? "刷新分析" : "Refresh analysis"}</Button>
    </div>
    <div className="space-y-2 rounded-xl border border-border bg-surface-2 p-4">
      <p className="text-sm font-bold">{personal ? (zh ? `教练累计发放 ${view?.quota.grantTotal ?? 0} 次` : `${view?.quota.grantTotal ?? 0} credits issued by coaches`) : (zh ? `本节 ${bookedHours} 小时课包含 ${totalFree} 次共享免费分析` : `This ${bookedHours}-hour lesson includes ${totalFree} shared free analyses`)}</p>
      {!active ? <p role="status" className="text-sm text-ink-2">{zh ? "待课程完成后解锁。请教练在授课结束后确认课程已完成。" : "Credits unlock after the lesson is completed. Ask the coach to mark it completed after the teaching time ends."}</p>
        : view ? <p className="text-sm text-ink-2">{zh ? `可用 ${view.quota.remaining} 次 · 已使用 ${view.quota.used} 次 · 处理中 ${view.quota.reserved} 次 · 已购 ${view.quota.paidTotal} 次` : `${view.quota.remaining} available · ${view.quota.used} used · ${view.quota.reserved} processing · ${view.quota.paidTotal} purchased`}</p>
          : <p className="text-sm text-ink-3">{zh ? "正在读取可用额度…" : "Loading available credits…"}</p>}
      <Hint>{personal ? (zh ? "发放次数属于你的账号，与课程次数分别使用。分析失败或无法评分不扣次数；处理中会暂时预留一次。" : "Issued credits belong to your account and are separate from lesson credits. Failed or ungradable analyses do not use a credit. One credit is reserved while processing.") : (zh ? "额度由本订单共享，不按人数增加。分析失败或无法评分不扣次数；处理中会暂时预留一次额度。" : "Credits are shared by this booking and do not multiply with group size. Failed or ungradable analyses do not use a credit. One credit is reserved while a job is processing.")}</Hint>
      {personal && !view?.canUpload && <p className="text-sm text-ink-2">{zh ? "联系教练发放次数后，即可上传和分析视频。" : "Contact your coach for credits to start uploading and analysing clips."}</p>}
    </div>
    {view && !serviceReady && <p role="status" className="text-sm text-amber">{zh ? "视频分析服务暂未就绪，可先上传视频，服务恢复后再提交分析。" : "Video analysis is not ready. You can upload clips now and submit them when the service is available."}</p>}
    <section aria-labelledby={`analysis-learning-path-${bookingCode}`} className="space-y-3 rounded-xl border border-border bg-surface-2 p-4">
      <h3 id={`analysis-learning-path-${bookingCode}`} className="text-sm font-semibold">{zh ? "从新手到平行式" : "From first turns to parallel"}</h3>
      <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {beginnerStages.map((stage, index) => <li key={stage.en} className="space-y-1 rounded-lg border border-border bg-surface p-3">
          <p className="text-sm font-semibold"><span className="mr-2 text-accent">{index + 1}</span>{zh ? stage.zh : stage.en}</p>
          <p className="text-xs text-ink-3">{index < 3 ? zh ? "暂未开放分析" : "Analysis not available yet" : !view ? zh ? "正在读取开放状态…" : "Checking availability…" : parallelAvailable ? zh ? "技术提升 · 已开放" : "Improvement · Available" : zh ? "暂未开放分析" : "Analysis not available yet"}</p>
        </li>)}
      </ol>
      <Hint>{zh ? `FreeSki 当前可评分的新手进阶动作从平行式转弯开始。前三阶段暂未开放自动分析，${personal ? "个人视频可以先上传保留，仍仅你本人可见" : "课程视频仍可上传给教练查看"}。请按视频里实际做出的动作选择。` : `FreeSki's currently supported beginner progression starts at parallel turns. Automated analysis is not available for the first three stages; ${personal ? "you can upload personal clips to keep them, visible only to you" : "lesson clips can still be uploaded for your coach to review"}. Choose the movement actually shown.`}</Hint>
      {(isCustomer || isOwnCoach) && parallelAvailable && <Button variant="secondary" size="sm" disabled={Boolean(busy) || !hasSupportedVideo || !serviceReady} onClick={() => setActionId("parallel")}>
        {selectedActionAvailable && actionId === "parallel" ? <Check aria-hidden /> : <Wand2 aria-hidden />}{selectedActionAvailable && actionId === "parallel" ? zh ? "已选择平行式转弯" : "Parallel turns selected" : zh ? "选择平行式转弯分析" : "Choose parallel-turn analysis"}
      </Button>}
    </section>
    {view?.actions.length ? <div className="max-w-sm space-y-2">
      <Label htmlFor={`analysis-action-${bookingCode}`}>{zh ? "视频中的练习动作" : "Action shown in the video"}</Label>
      <Select id={`analysis-action-${bookingCode}`} value={selectedActionAvailable ? actionId : ""} disabled={Boolean(busy) || !hasSupportedVideo || !view.actions.some((action) => action.available === true)} onChange={(event) => setActionId(event.target.value)}>
        <option value="">{zh ? "请选择动作" : "Choose an action"}</option>
        {[...actionGroups.entries()].map(([key, group]) => <optgroup key={key} label={group.label}>
          {group.actions.map((action) => <option key={action.id} value={action.id} disabled={action.available !== true}>{zh ? action.labelZh : action.labelEn}{action.available !== true ? zh ? "（暂未开放）" : " (Not available)" : ""}</option>)}
        </optgroup>)}
      </Select>
      <Hint>{zh ? "动作与开放状态同步自 FreeSki。日常练习请选择「技术提升」；CSIA 考证动作供备考学员使用。评分和建议会显示在视频下方。" : "Actions and availability are synced from FreeSki. Choose Improvement for everyday practice; CSIA certification actions are for exam preparation. Scores and coaching appear below the clip."}</Hint>
      {needsLevel && <div className="space-y-2 pt-2">
        <Label htmlFor={`analysis-level-${bookingCode}`}>{zh ? "你目前的 CSIA 级别" : "Your current CSIA level"}</Label>
        <Select id={`analysis-level-${bookingCode}`} value={currentLevel} disabled={Boolean(busy)} onChange={(event) => setCurrentLevel(event.target.value as FreeSkiCurrentLevel | "")}>
          <option value="">{zh ? "请选择级别" : "Choose a level"}</option>
          {FREESKI_CURRENT_LEVELS.map((level) => <option key={level.id} value={level.id}>{zh ? level.labelZh : level.labelEn}</option>)}
        </Select>
        <Hint>{zh ? "技术提升和高你一级的 CSIA 通过示范对比：还没考级对比 1 级，1 级对比 2 级，依此类推；4 级对比专家示范。报告里会写明实际对比的示范。" : "Improvement compares you with CSIA pass examples one level above yours: no level compares with Level 1, Level 1 with Level 2, and so on; Level 4 compares with expert examples. The report states which examples were used."}</Hint>
      </div>}
    </div> : view ? <p role="status" className="text-sm text-amber">{zh ? "FreeSki 动作目录暂不可用，请稍后刷新。当前无法提交新的分析，已有结果仍可查看。" : "The FreeSki action catalog is temporarily unavailable. Refresh later to submit a new analysis; existing results remain available."}</p> : null}
    {videos.length > 0 ? <ul className="space-y-4">{videos.map((video) => {
      const jobs = view?.jobs.filter((job) => job.videoId === video.id) ?? [];
      const pending = jobs.some((job) => job.status === "QUEUED" || job.status === "RUNNING");
      const supported = video.analysisSupported ?? video.contentType !== "video/webm";
      return <li key={video.id} className="space-y-3 rounded-xl border border-border p-3">
        <video controls preload="metadata" playsInline src={video.url} className="max-h-[30rem] w-full rounded-lg bg-black" />
        {video.caption && <p className="break-words text-sm text-ink-2">{video.caption}</p>}
        {!supported && <p className="text-sm text-ink-3">{zh ? "此视频可观看；分析请上传 MP4 或 MOV。" : "This video can be viewed. Upload MP4 or MOV for analysis."}</p>}
        <div className="flex flex-wrap gap-2">
          {(isOwnCoach || isCustomer) && <Button variant="secondary" size="sm" disabled={!canRun || pending || !supported} onClick={() => void analyze(video.id)}>{pending || busy?.startsWith(`analyze:${video.id}:`) ? <Loader2 className="animate-spin" aria-hidden /> : <Wand2 aria-hidden />}{pending ? zh ? "正在分析" : "Analysis in progress" : zh ? "分析这个视频" : "Analyze this video"}</Button>}
          {video.canDelete && <Button variant="ghost" size="sm" disabled={Boolean(busy) || pending} onClick={() => { if (window.confirm(zh ? "确定删除这个视频？" : "Delete this video?")) void mutate(`delete:${video.id}`, `${videosBase}/${video.id}`, {}, "DELETE"); }}><Trash2 aria-hidden />{zh ? "删除视频" : "Delete video"}</Button>}
        </div>
        {isCustomer && <CoachVideoFeedback locale={locale} videoId={video.id} bookingCode={bookingCode} personal={personal} />}
        {jobs.length > 0 && <ul className="space-y-3">{jobs.map((job) => {
          const selection = parseFreeSkiActionId(job.actionId);
          const action = view?.actions.find((candidate) => candidate.id === selection?.catalogId) ?? getFreeSkiActionOption(job.actionId);
          const jobLevel = FREESKI_CURRENT_LEVELS.find((level) => level.id === selection?.currentLevel);
          const queueReason = job.status === "QUEUED" && typeof job.queueReason === "string" ? job.queueReason.trim() : null;
          const computeWait = job.status === "QUEUED" && job.computeWait && Object.hasOwn(COMPUTE_WAIT, job.computeWait) ? COMPUTE_WAIT[job.computeWait] : null;
          return <li key={job.id} className="space-y-2">
            <p role="status" className="flex items-center gap-2 text-xs font-semibold text-ink-2">{(job.status === "QUEUED" || job.status === "RUNNING") && <Loader2 className="size-3 animate-spin" aria-hidden />}{action && <span>{action.pathType === "certification" ? `${zh ? action.groupZh : action.groupEn} · ` : ""}{zh ? action.labelZh : action.labelEn} ·{jobLevel ? ` ${jobLevel.id === "none" ? zh ? jobLevel.labelZh : jobLevel.labelEn : zh ? `目前 ${jobLevel.labelZh}` : `Currently ${jobLevel.labelEn}`} ·` : ""}</span>}{statusLabel(job.status)}</p>
            {computeWait && <p className="text-xs text-ink-2">{computeWait[zh ? 0 : 1]}</p>}
            {queueReason && <p className="break-words text-xs text-ink-2">{zh ? "排队原因：" : "Waiting reason: "}{queueReason}</p>}
            {job.result && (job.status === "SUCCEEDED" || job.status === "FAILED") ? <VideoAnalysisResult result={job.result} locale={locale} dynamicReportBase={`/api/video-analysis/reports/${personal ? "account" : "booking"}/${job.id}`} /> : null}
          </li>;
        })}</ul>}
      </li>;
    })}</ul> : <p className="text-sm text-ink-3">{personal ? (zh ? "还没有上传视频。" : "No videos uploaded yet.") : (zh ? "还没有课程视频。" : "No lesson videos yet.")}</p>}
    {canUpload && (view?.canUpload ?? true) && <div className="space-y-3 border-t border-border pt-4">
      <div className="space-y-2"><Label htmlFor={`analysis-caption-${bookingCode}`}>{zh ? "视频说明（选填）" : "Video caption (optional)"}</Label><Input id={`analysis-caption-${bookingCode}`} value={caption} maxLength={200} disabled={Boolean(busy)} onChange={(event) => setCaption(event.target.value)} /></div>
      <input ref={fileRef} type="file" accept="video/mp4,video/quicktime,video/webm" className="hidden" aria-label={personal ? (zh ? "选择滑雪视频" : "Choose a skiing video") : (zh ? "选择课程视频" : "Choose a lesson video")} onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); event.target.value = ""; }} />
      <Button variant="secondary" disabled={Boolean(busy)} onClick={() => fileRef.current?.click()}>{busy === "upload" ? <Loader2 className="animate-spin" aria-hidden /> : <Upload aria-hidden />}{personal ? (zh ? "上传滑雪视频" : "Upload skiing video") : (zh ? "上传课程视频" : "Upload lesson video")}</Button>
    </div>}
    {active && !personal && <div className="space-y-4 border-t border-border pt-4">
      <div className="space-y-1"><h3 className="font-semibold">{zh ? "额外分析次数" : "Extra analysis credits"}</h3><Hint>{zh ? "通过微信付款后通知教练，教练核对到账后才增加额度。每笔订单保留下单时的价格。" : "Pay by WeChat and notify your coach. Credits are added after the coach checks receipt. Each order keeps its original price."}</Hint></div>
      {!view ? <Hint>{zh ? "正在读取购买信息…" : "Loading purchase details…"}</Hint> : !view.price ? <p className="text-sm text-ink-3">{zh ? "教练尚未设置额外分析价格或微信收款，暂不能购买。" : "Extra analysis pricing or WeChat payment has not been configured. Purchases are unavailable."}</p> : <p className="text-sm font-semibold">{zh ? "每次" : "Per analysis"} {formatMoneyShort(view.price.unitCents)} CAD</p>}
      {isCustomer && view?.canPurchase && view.price && <div className="flex flex-wrap items-end gap-3"><div className="w-28 space-y-2"><Label htmlFor={`analysis-quantity-${bookingCode}`}>{zh ? "购买次数" : "Credits"}</Label><Input id={`analysis-quantity-${bookingCode}`} type="number" min={1} max={50} step={1} value={quantity} disabled={Boolean(busy)} onChange={(event) => setQuantity(event.target.value)} /></div><Button variant="secondary" disabled={Boolean(busy)} onClick={() => void purchase()}>{busy?.startsWith("purchase:") && <Loader2 className="animate-spin" aria-hidden />}{zh ? "生成微信付款订单" : "Create WeChat payment order"}</Button></div>}
      {view && isCustomer && view.price && !view.payment.wechatEnabled && <p className="text-sm text-ink-3">{zh ? "教练暂未启用微信收款，请联系教练。" : "The coach has not enabled WeChat payment. Contact your coach."}</p>}
      {view?.purchases.map((purchase) => <AnalysisPurchase key={purchase.id} purchase={purchase} locale={locale} isCustomer={isCustomer} canReview={isOwnCoach && view.canReview} payment={view.payment} busy={Boolean(busy)} onAction={(path, body) => mutate(`order:${purchase.id}`, `${base}/purchases/${purchase.id}/${path}`, body)} />)}
    </div>}
    {refreshError && <p role="alert" className="text-sm text-amber">{zh ? "暂时无法刷新分析状态。页面保留上次结果，请恢复网络后点击刷新。" : "Analysis status could not be refreshed. Your last results are kept; reconnect and press Refresh analysis."}</p>}
    {message && <p role="status" className="text-sm text-success">{message}</p>}
    <FieldError>{error}</FieldError>
  </Card>;
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
