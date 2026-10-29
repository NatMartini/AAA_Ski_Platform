"use client";

import { useEffect, useState } from "react";
import type { Locale } from "@/i18n/routing";
import { clientFetch } from "@/lib/client-fetch";
import { Button } from "@/components/ui/button";
import { FieldError, Hint, Label, Textarea } from "@/components/ui/field";
import { feedbackStatus, type CoachFeedbackView } from "@/components/booking/coach-video-feedback";
import { PageHeader } from "@/components/ui/page-header";
import { MessageSquareText } from "lucide-react";

export function VideoReviewWorkspace({ locale, coachId }: { locale: Locale; coachId: string }) {
  const zh = locale === "zh";
  const [requests, setRequests] = useState<CoachFeedbackView[]>([]);
  const [selected, setSelected] = useState<CoachFeedbackView | null>(null);
  const [editorGeneration, setEditorGeneration] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function refresh() {
    setBusy(true); setError("");
    try {
      const response = await clientFetch("/api/coach/video-reviews", { cache: "no-store" });
      const data = await response.json().catch(() => null) as { ok?: boolean; coachId?: string; requests?: CoachFeedbackView[] } | null;
      if (!response.ok || !data?.ok || data.coachId !== coachId || !Array.isArray(data.requests)) { setRequests([]); setSelected(null); throw new Error("unavailable"); }
      setRequests(data.requests);
      if (selected && !data.requests.some((request) => request.id === selected.id && request.revision === selected.revision)) setSelected(null);
    } catch { setError(zh ? "无法读取任务，请刷新或重新登录。" : "Could not load review requests. Refresh or sign in again."); }
    finally { setBusy(false); }
  }
  useEffect(() => { let active = true; void clientFetch("/api/coach/video-reviews", { cache: "no-store" }).then(async (response) => {
    const data = await response.json() as { ok?: boolean; coachId?: string; requests?: CoachFeedbackView[] };
    if (active && response.ok && data.ok && data.coachId === coachId && Array.isArray(data.requests)) setRequests(data.requests);
    else if (active) setError(zh ? "无法读取人工点评任务。" : "Could not load human review requests.");
  }).catch(() => { if (active) setError(zh ? "连接中断，请刷新。" : "Connection interrupted. Refresh to try again."); }); return () => { active = false; }; }, [coachId, zh]);
  async function choose(id: string) {
    setBusy(true); setError("");
    try {
      const response = await clientFetch(`/api/video-analysis/coach-feedback/${id}`, { cache: "no-store" });
      const data = await response.json() as { viewer?: string; request?: CoachFeedbackView };
      if (!response.ok || data.viewer !== "coach" || data.request?.coachId !== coachId) { setSelected(null); throw new Error("permission"); }
      setSelected(data.request);
      setEditorGeneration((current) => current + 1);
    } catch { setError(zh ? "申请已变更或授权已撤销，请刷新列表。" : "The request changed or its authorization was withdrawn. Refresh the list."); }
    finally { setBusy(false); }
  }
  return <div className="space-y-5">
    <PageHeader icon={<MessageSquareText aria-hidden />} tone="video" title={zh ? "视频人工点评" : "Human video reviews"}
      description={zh ? "学员授权给你的视频，写下人工点评。" : "Videos students shared with you for a written review."}
      actions={<Button variant="secondary" disabled={busy} onClick={() => void refresh()}>{zh ? "刷新任务" : "Refresh requests"}</Button>} />
    <Hint>{zh ? "仅显示学员明确授权给你的任务。请观看视频、本人填写并确认发布；自动分析不会代你写入或署名。" : "Only requests explicitly assigned to you are shown. Watch the clip, write your own feedback, and confirm publication. AI never writes or publishes under your name."}</Hint>
    <FieldError>{error}</FieldError>
    {requests.length ? <ul className="flex flex-wrap gap-2">{requests.map((request) => <li key={request.id}><Button variant={selected?.id === request.id ? "primary" : "secondary"} size="sm" disabled={busy} onClick={() => void choose(request.id)}>{request.caption || request.videoId} · {feedbackStatus(request.status, zh)}</Button></li>)}</ul> : <p className="text-sm text-ink-2">{zh ? "目前没有已授权的人工点评任务。" : "There are no authorized human review requests."}</p>}
    {selected && <ReviewEditor key={`${selected.id}:${editorGeneration}`} initial={selected} locale={locale} onChanged={(request) => { setSelected(request); setRequests((current) => current.map((item) => item.id === request.id ? request : item)); }} onRevoked={() => { setSelected(null); void refresh(); }} />}
  </div>;
}

function ReviewEditor({ initial, locale, onChanged, onRevoked }: { initial: CoachFeedbackView; locale: Locale;
  onChanged: (request: CoachFeedbackView) => void; onRevoked: () => void }) {
  const zh = locale === "zh";
  const [row, setRow] = useState(initial);
  const [text, setText] = useState(initial.draftText ?? "");
  const [watched, setWatched] = useState(false);
  const [authored, setAuthored] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function update(action: "start" | "save" | "publish") {
    setBusy(true); setError("");
    try {
      const response = await clientFetch(`/api/video-analysis/coach-feedback/${row.id}`, { method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, expectedRevision: row.revision, ...(action !== "start" ? { text } : {}),
          ...(action === "publish" ? { watchedVideo: watched, authoredByMe: authored, publishConfirmed: confirmed } : {}) }) });
      const data = await response.json() as { request?: CoachFeedbackView; error?: string };
      if (!response.ok || !data.request) {
        if ([401, 403, 404].includes(response.status)) onRevoked();
        throw new Error(data.error);
      }
      setRow(data.request); onChanged(data.request);
    } catch { setError(zh ? "操作未完成，可能已撤销授权或状态变化。请刷新任务后核对。" : "The action was not completed. Authorization or state may have changed. Refresh the request to check."); }
    finally { setBusy(false); }
  }
  return <article className="space-y-4 rounded-2xl border border-border bg-surface p-5">
    <p className="font-semibold">{row.caption || row.videoId} · {feedbackStatus(row.status, zh)}</p>
    {row.status === "REQUESTED" ? <Button disabled={busy} onClick={() => void update("start")}>{zh ? "开始查看并点评" : "Start watching and reviewing"}</Button> : <>
      <video controls preload="none" playsInline src={row.mediaUrl} onEnded={() => setWatched(true)} onError={() => setError(zh ? "视频不可用，请刷新确认授权。" : "Video unavailable. Refresh to check authorization.")} className="max-h-[32rem] w-full rounded-xl bg-black" />
      {row.status === "PUBLISHED" ? <p className="whitespace-pre-wrap break-words">{row.publishedText}</p> : <>
        <div className="space-y-2"><Label htmlFor={`coach-review-${row.id}`}>{zh ? "本人填写的点评" : "Feedback written by you"}</Label><Textarea id={`coach-review-${row.id}`} value={text} maxLength={8000} disabled={busy} onChange={(event) => { setText(event.target.value); setAuthored(false); setConfirmed(false); }} placeholder={zh ? "写出观察到的问题、对应时间和练习建议。" : "Describe your observations, timestamps, and recommended exercises."} /></div>
        <Hint>{zh ? "草稿仅你可见；发布后学员才能看到正文。保存草稿不会发布。" : "Drafts are private to you. The student sees the text only after publication. Saving a draft does not publish it."}</Hint>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={watched && authored} disabled={busy || !watched} onChange={(event) => setAuthored(event.target.checked)} className="mt-1" /><span>{zh ? "我已观看此视频，以上点评由我本人填写。请先播放视频至结束。" : "I watched this clip and wrote the feedback myself. Play the clip to the end first."}</span></label>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmed} disabled={busy} onChange={(event) => setConfirmed(event.target.checked)} className="mt-1" /><span>{zh ? "确认以我的教练身份向学员发布这份点评。" : "Publish this feedback to the student under my coach identity."}</span></label>
        <div className="flex flex-wrap gap-2"><Button variant="secondary" disabled={busy} onClick={() => void update("save")}>{zh ? "保存私人草稿" : "Save private draft"}</Button><Button disabled={busy || !text.trim() || !watched || !authored || !confirmed} onClick={() => void update("publish")}>{zh ? "确认发布" : "Confirm publication"}</Button></div>
      </>}
    </>}
    <FieldError>{error}</FieldError>
  </article>;
}
