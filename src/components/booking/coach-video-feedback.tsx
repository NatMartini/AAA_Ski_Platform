"use client";

import { useState } from "react";
import { clientFetch } from "@/lib/client-fetch";
import { clientRandomUUID } from "@/lib/browser-helpers";
import type { Locale } from "@/i18n/routing";
import { Button } from "@/components/ui/button";
import { FieldError, Hint, Label, Select } from "@/components/ui/field";

export type CoachFeedbackView = { id: string; accountId: string; coachId: string; coachName?: string; videoId: string;
  scope: "LESSON" | "ACCOUNT"; caption: string | null; status: string; revision: number;
  publishedText: string | null; draftText: string | null; publishedAt: string | null;
  videoViewedAt: string | null; mediaUrl: string; hasAnalysisSnapshot: boolean };
type State = { ok: true; accountId: string; consentVersion: string; coaches: { id: string; name: string }[];
  status: string; current: CoachFeedbackView | null; history: CoachFeedbackView[] };

export function feedbackStatus(status: string, zh: boolean) {
  const labels: Record<string, [string, string]> = { NOT_REQUESTED: ["尚未申请", "Not requested"],
    REQUESTED: ["等待教练查看", "Waiting for coach"], IN_REVIEW: ["教练点评中", "Coach reviewing"],
    PUBLISHED: ["教练已发布", "Published by coach"], CANCELLED: ["已撤销授权", "Authorization withdrawn"] };
  return labels[status]?.[zh ? 0 : 1] ?? status;
}

export function CoachVideoFeedback({ locale, videoId, bookingCode, personal = false }: {
  locale: Locale; videoId: string; bookingCode?: string; personal?: boolean;
}) {
  const zh = locale === "zh";
  const [opened, setOpened] = useState(false);
  const [state, setState] = useState<State | null>(null);
  const [coachId, setCoachId] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const scope = personal ? "ACCOUNT" : "LESSON";
  const subject = { scope, videoId, ...(!personal && bookingCode ? { bookingCode } : {}) };
  const base = "/api/video-analysis/coach-feedback";
  async function load() {
    const response = await clientFetch(`${base}?${new URLSearchParams(subject)}`, { cache: "no-store" });
    const body = await response.json().catch(() => null) as State | null;
    if (!response.ok || !body?.ok) { setState(null); throw new Error("load"); }
    setState(body);
    setConsent(false);
    setCoachId((current) => body.coaches.some((coach) => coach.id === current) ? current : "");
    return body;
  }
  async function show() {
    setOpened(true); setBusy(true); setError("");
    try { await load(); }
    catch { setError(zh ? "暂时无法读取人工点评，请刷新重试。" : "Human feedback is unavailable. Refresh and try again."); }
    finally { setBusy(false); }
  }
  async function submit(cancel = false) {
    if (!state || busy) return;
    setBusy(true); setError("");
    try {
      const current = state.current;
      const response = await clientFetch(cancel && current ? `${base}/${current.id}` : base, {
        method: cancel ? "DELETE" : "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(cancel ? { expectedRevision: current?.revision } : { ...subject, expectedAccountId: state.accountId,
          coachId, requestKey: clientRandomUUID(), consent, consentVersion: state.consentVersion,
          expectedCurrentId: current?.id ?? null, expectedRevision: current?.revision ?? null }),
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({})) as { error?: string };
        if (response.status === 401 || response.status === 403) setState(null);
        throw new Error(result.error ?? "request");
      }
      setConsent(false);
      await load();
    } catch (failure) {
      setError(failure instanceof Error && failure.message === "state-changed"
        ? (zh ? "点评状态或登录账号已变化，请刷新后重新确认。" : "The request or account changed. Refresh and confirm again.")
        : (zh ? "操作未完成，请刷新核对当前授权后重试。" : "The action was not completed. Refresh and check the current authorization."));
    } finally { setBusy(false); }
  }
  return <section id={`coach-feedback-${videoId}`} className="space-y-3 rounded-xl border border-border bg-surface-2 p-3" aria-label={zh ? "教练人工点评" : "Human coach feedback"}>
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-bold">{zh ? "教练人工点评（选填）" : "Human coach feedback (optional)"}</h3>
      <Button size="sm" variant="secondary" disabled={busy} onClick={() => void show()}>{zh ? opened ? "刷新点评" : "申请或查看人工点评" : opened ? "Refresh feedback" : "Request or view feedback"}</Button></div>
    <Hint>{zh ? "由你指定的教练观看此视频后亲自写点评。与 FreeSki 自动分析独立，不消耗分析次数，无需等待 AI 完成。" : "Your chosen coach watches this clip and writes their own feedback. This is separate from FreeSki AI, uses no analysis credits, and can be requested before AI completes."}</Hint>
    {opened && state && <>
      <p role="status" className="text-sm">{feedbackStatus(state.status, zh)}{state.current?.coachName ? ` · ${state.current.coachName}` : ""}</p>
      {state.history.filter((item) => item.publishedText).map((item) => <article key={item.id} className="space-y-1 rounded-lg bg-surface p-3">
        <p className="text-xs font-semibold text-ink-2">{item.coachName ?? (zh ? "教练" : "Coach")} · {item.publishedAt ? new Date(item.publishedAt).toLocaleString(zh ? "zh-CN" : "en-CA") : ""}</p>
        <p className="whitespace-pre-wrap break-words text-sm">{item.publishedText}</p>
      </article>)}
      {state.current && <Button size="sm" variant="ghost" disabled={busy} onClick={() => { if (window.confirm(zh ? "撤销这份人工点评申请及该申请的后续访问？已发布内容仍保留。" : "Withdraw this human review request and access granted by this request? Published feedback is retained.")) void submit(true); }}>{zh ? "取消申请 / 撤销点评授权" : "Cancel request / withdraw review access"}</Button>}
      {state.coaches.length ? <div className="space-y-3 border-t border-border pt-3">
        <div className="space-y-1"><Label htmlFor={`review-coach-${videoId}`}>{zh ? "指定点评教练" : "Choose reviewing coach"}</Label>
          <Select id={`review-coach-${videoId}`} value={coachId} disabled={busy} onChange={(event) => { setCoachId(event.target.value); setConsent(false); }}><option value="">{zh ? "请选择" : "Choose a coach"}</option>{state.coaches.map((coach) => <option key={coach.id} value={coach.id}>{coach.name}</option>)}</Select></div>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={consent} disabled={busy || !coachId} onChange={(event) => setConsent(event.target.checked)} className="mt-1" />
          <span>{zh ? "我授权指定教练查看这一个视频和申请时的自动报告版本，并为我提供人工点评。更换教练会撤销之前的人工点评授权。" : "I authorize this coach to view this clip and the automatic report captured with this request, and provide human feedback. Replacing a coach withdraws the previous human-review authorization."}</span></label>
        <Button size="sm" disabled={busy || !consent || !coachId} onClick={() => void submit()}>{zh ? state.current ? "重新申请 / 更换教练" : "确认授权并申请" : state.current ? "Replace request / coach" : "Authorize and request"}</Button>
      </div> : <Hint>{zh ? "暂无可指定教练。可选择已确认/完成课程的教练或给你发放过个人分析次数的教练；他们不会自动获得视频访问权。" : "No eligible coach is available. Choose a coach from a confirmed/completed lesson or one who issued personal credits. Those relationships never grant video access automatically."}</Hint>}
    </>}
    <FieldError>{error}</FieldError>
  </section>;
}
