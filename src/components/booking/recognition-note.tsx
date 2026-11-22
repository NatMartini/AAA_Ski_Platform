"use client";

import { useState } from "react";
import { Loader2, ScanSearch } from "lucide-react";
import { clientFetch } from "@/lib/client-fetch";
import { clientRandomUUID } from "@/lib/browser-helpers";
import { Link, useRouter } from "@/i18n/navigation";
import type { ActionRecognition } from "@/lib/freeski/action-recognition";
import { actionName, correctedActionId, parseFreeSkiActionId } from "@/lib/freeski/actions";
import type { AnalysisTier } from "@/lib/video-analysis/tiers";

/**
 * What FreeSki recognised in a run left without an action, and how sure it was. A wrong recognition is corrected by
 * analysing the same clip as the right action: FreeSki reuses the skeleton it already found, and the first analysis's
 * credit is handed back.
 */
export function RecognitionNote({ recognition, zh, jobId, actionId, videoId, tier, accountId }: {
  recognition: ActionRecognition; zh: boolean; jobId: string; actionId: string;
  /** The clip, while it is kept; a correction needs it. */
  videoId: string | null; tier: AnalysisTier;
  /** The owner of a personal analysis, who may correct it; none for a lesson's. */
  accountId: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const selection = parseFreeSkiActionId(actionId);
  const canCorrect = Boolean(accountId && videoId && selection);
  const percent = (value: number | null) => value === null ? null : `${Math.round(value * 100)}%`;
  const alternatives = recognition.alternatives.filter(item => item.action !== recognition.action);

  async function correct(action: string) {
    if (!selection || !videoId || !accountId || busy) return;
    const next = correctedActionId(action, selection.pathType, recognition.level, selection.currentLevel);
    if (!next) { setError(zh ? "这个动作现在不能直接改，请在“我的分析”里重新选。" : "This action cannot be chosen here; choose it under My analyses."); return; }
    if (!window.confirm(zh ? `按“${actionName(action, null, true)}”重新分析这段视频？这次的结果会被替换，次数退回。` : `Analyse this clip again as ${actionName(action, null, false)}? This result is replaced and its credit handed back.`)) return;
    setBusy(action);
    setError(null);
    try {
      const response = await clientFetch("/api/video-analysis", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ videoId, actionId: next, tier, requestKey: clientRandomUUID(), expectedAccountId: accountId, replacesJobId: jobId }) });
      const data = await response.json().catch(() => ({})) as { job?: { id: string }; error?: string };
      if (!response.ok || !data.job) {
        setError(data.error === "unsupported-action" ? (zh ? "这个动作暂未开放分析。" : "This action is not open for analysis.")
          : data.error === "quota-exhausted" || data.error === "free-daily-limit" ? (zh ? "可用次数不够。" : "Not enough credits.")
          : (zh ? "没有提交成功，请刷新后再试。" : "It was not submitted. Refresh and try again."));
        return;
      }
      router.push(`/video-analysis/report/${encodeURIComponent(data.job.id)}`);
    } finally {
      setBusy(null);
    }
  }

  const choose = canCorrect ? <Link href={`/video-analysis?analyze=${encodeURIComponent(videoId!)}&replaces=${encodeURIComponent(jobId)}#workspace`}
    className="text-sm font-semibold text-accent hover:underline">{zh ? "选别的动作" : "Choose another action"}</Link> : null;

  return <section aria-label={zh ? "动作识别" : "Action recognition"} className="space-y-2 rounded-xl border border-border bg-surface p-3.5">
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
      <ScanSearch className="size-4 shrink-0 text-accent" aria-hidden />
      {recognition.status === "recognized" ? <>
        <span>{zh ? "FreeSki 识别为" : "FreeSki recognised"}</span>
        <span className="font-semibold">{actionName(recognition.action, recognition.level, zh)}</span>
        {percent(recognition.confidence) && <span className="text-ink-3" data-numeric>{zh ? `把握 ${percent(recognition.confidence)}` : `${percent(recognition.confidence)} sure`}</span>}
      </> : <span>{zh ? "视频里完整的弯不到 3 个，没法识别动作，这次按示范平行弯打分。" : "Fewer than three whole turns: the action could not be recognised, so this was scored as a demonstration parallel."}</span>}
    </p>
    {recognition.status === "recognized" && alternatives.length > 0 && <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-ink-3">{zh ? "认错了？改成：" : "Not right? Change to:"}</span>
      {alternatives.map(item => canCorrect
        ? <button key={item.action} type="button" disabled={Boolean(busy)} onClick={() => void correct(item.action)}
          className="press inline-flex min-h-8 items-center gap-1 rounded-full border border-border bg-surface-2 px-3 text-xs font-semibold text-ink-2 hover:text-ink">
          {busy === item.action && <Loader2 className="size-3.5 animate-spin" aria-hidden />}{actionName(item.action, null, zh)}
          <span className="font-normal text-ink-3" data-numeric>{percent(item.probability)}</span></button>
        : <span key={item.action} className="rounded-full bg-surface-2 px-2.5 py-1 text-xs text-ink-2">{actionName(item.action, null, zh)} {percent(item.probability)}</span>)}
      {choose}
    </div>}
    {(recognition.status === "fallback" || alternatives.length === 0) && choose}
    {error && <p role="alert" className="text-sm font-semibold text-danger">{error}</p>}
  </section>;
}
