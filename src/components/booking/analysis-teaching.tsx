import { useState } from "react";
import { Check, X } from "lucide-react";
import { citesEstimated, type Teaching } from "@/lib/freeski/scorecard";
import { findingKey, type FindingKind } from "@/lib/video-analysis/finding-key";

export type FindingReview = { findingKey: string; verdict: "AGREE" | "DISAGREE"; note: string | null; coachName: string; mine: boolean };

/** Model-written explanation whose every conclusion cites a code-computed comparison fact. */
export function AnalysisTeaching({ teaching, zh, turnLabel, onSelectTurn, reviews = [], canReview = false, onReview }: { teaching: Teaching; zh: boolean;
  turnLabel: (turnId: string) => string | null; onSelectTurn?: (turnId: string) => void;
  /** Coach verdicts on each finding; `onReview` lets a coach set or clear one. */
  reviews?: FindingReview[]; canReview?: boolean;
  onReview?: (key: string, verdict: "AGREE" | "DISAGREE" | null, note: string, metricKeys: string[]) => Promise<void>;
}) {
  const estimated = (factIds: string[]) => citesEstimated(teaching, factIds)
    ? <span className="ml-2 whitespace-nowrap rounded-full border border-amber-border bg-amber-bg px-2 py-0.5 text-xs text-amber">{zh ? "视频估算" : "Video estimate"}</span> : null;
  const improvements = [...teaching.improvements].sort((a, b) => Number(b.priority === "primary") - Number(a.priority === "primary"));
  const summary = zh ? teaching.summary_zh : teaching.summary_en;
  const limitations = zh ? teaching.limitations_zh : teaching.limitations_en;
  const metricsOf = (factIds: string[]) => [...new Set(factIds.flatMap(id => teaching.facts.filter(fact => fact.fact_id === id).map(fact => fact.metric_key)))];
  const verdicts = (kind: FindingKind, textZh: string, factIds: string[]) => {
    const key = findingKey(kind, textZh);
    return <Verdicts key={key} findingKey={key} zh={zh} reviews={reviews.filter(review => review.findingKey === key)} canReview={canReview}
      onReview={onReview && ((verdict, note) => onReview(key, verdict, note, metricsOf(factIds)))} />;
  };
  return <section className="space-y-3" aria-label={zh ? "动作解释" : "Technique explanation"}>
    <div className="flex flex-wrap items-center gap-2">
      <p className="text-sm font-semibold">{zh ? "动作解释" : "Technique explanation"}</p>
      <span className="rounded-full border border-border bg-surface px-2.5 py-1 text-xs font-bold text-ink-2">{zh ? "试验性" : "Experimental"}</span>
    </div>
    <p className="text-xs text-ink-3">{zh ? "由本地模型根据与示范的对比数据撰写，每条结论都对应一项测量。" : "Written by a local model from the comparison with the examples; every conclusion matches one measurement."}
      {teaching.model.model && <span className="break-all">{zh ? ` 模型：${teaching.model.model}` : ` Model: ${teaching.model.model}`}</span>}</p>
    {canReview && <p className="rounded-lg bg-accent-soft px-3 py-2 text-xs text-ink-2">{zh ? "你是这段视频的教练：每条结论可以标“同意”或“不同意”，学员能看到，FreeSki 也会用它校准对比。" : "As this clip's coach you can mark each finding agree or disagree; the student sees it and FreeSki uses it to calibrate the comparison."}</p>}
    {summary && <p className="text-sm leading-relaxed">{summary}</p>}
    {teaching.strengths.length > 0 && <div className="space-y-1">
      <p className="text-sm font-semibold text-success">{zh ? "做得好的地方" : "What is working"}</p>
      <ul className="list-disc space-y-1 pl-5 text-sm text-ink-2">{teaching.strengths.map((item, index) =>
        <li key={index}>{zh ? item.text_zh : item.text_en}{estimated(item.fact_ids)}{verdicts("strength", item.text_zh, item.fact_ids)}</li>)}</ul>
    </div>}
    {improvements.length > 0 && <div className="space-y-2">
      <p className="text-sm font-semibold">{zh ? "需要改进" : "What to improve"}</p>
      {improvements.map((item, index) => <div key={index} className={`rounded-lg p-3 text-sm ${item.priority === "primary" ? "border border-accent bg-accent-soft" : "bg-surface"}`}>
        <p>{zh ? item.text_zh : item.text_en}{estimated(item.fact_ids)}</p>
        {onSelectTurn && item.turn_ids.length > 0 && <div className="mt-2 flex flex-wrap gap-3">{item.turn_ids.map(turnId => {
          const label = turnLabel(turnId);
          return label && <button type="button" key={turnId} className="text-accent underline" onClick={() => onSelectTurn(turnId)}>
            {zh ? `查看${label}` : `View ${label}`}</button>;
        })}</div>}
        {verdicts("improvement", item.text_zh, item.fact_ids)}
      </div>)}
    </div>}
    {teaching.drills.length > 0 && <div className="space-y-2">
      <p className="text-sm font-semibold">{zh ? "建议练习" : "Suggested drills"}</p>
      {teaching.drills.map(drill => <div key={drill.drill_id} className="rounded-lg border border-border p-3 text-sm">
        <p className="font-semibold">{zh ? drill.name_zh : drill.name_en}</p>
        <p className="mt-1 text-ink-2">{zh ? drill.why_zh : drill.why_en}</p>
        {verdicts("drill", drill.why_zh, drill.fact_ids)}</div>)}
    </div>}
    {limitations.length > 0 && <ul className="space-y-1 text-xs text-ink-3">{limitations.map((text, index) => <li key={index}>{text}</li>)}</ul>}
  </section>;
}

/** The coach verdict line under one finding: badges for everyone, buttons for the reviewing coach. */
function Verdicts({ findingKey: key, zh, reviews, canReview, onReview }: { findingKey: string; zh: boolean; reviews: FindingReview[]; canReview: boolean;
  onReview?: (verdict: "AGREE" | "DISAGREE" | null, note: string) => Promise<void> }) {
  const mine = reviews.find(review => review.mine);
  const [note, setNote] = useState(mine?.note ?? "");
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const others = reviews.filter(review => !review.mine);
  const submit = async (verdict: "AGREE" | "DISAGREE" | null) => {
    if (!onReview || busy) return;
    setBusy(true);
    try { await onReview(verdict, note.trim()); setAsking(false); } finally { setBusy(false); }
  };
  if (!reviews.length && !canReview) return null;
  return <div className="mt-2 flex flex-wrap items-center gap-2 text-xs" data-finding={key}>
    {others.map((review, index) => <span key={index} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold ${review.verdict === "AGREE" ? "bg-success-bg text-success" : "bg-danger-bg text-danger"}`}>
      {review.verdict === "AGREE" ? <Check className="size-3" aria-hidden /> : <X className="size-3" aria-hidden />}
      {review.coachName || (zh ? "教练" : "Coach")}{review.verdict === "AGREE" ? (zh ? "同意" : " agrees") : (zh ? "不同意" : " disagrees")}{review.note ? `：${review.note}` : ""}</span>)}
    {canReview && onReview ? <>
      <button type="button" disabled={busy} aria-pressed={mine?.verdict === "AGREE"} onClick={() => mine?.verdict === "AGREE" ? void submit(null) : void submit("AGREE")}
        className={`press inline-flex min-h-7 items-center gap-1 rounded-full border px-2 font-semibold ${mine?.verdict === "AGREE" ? "border-success bg-success-bg text-success" : "border-border text-ink-2 hover:text-ink"}`}>
        <Check className="size-3" aria-hidden />{zh ? "同意" : "Agree"}</button>
      <button type="button" disabled={busy} aria-pressed={mine?.verdict === "DISAGREE"} onClick={() => { if (mine?.verdict === "DISAGREE") void submit(null); else setAsking(true); }}
        className={`press inline-flex min-h-7 items-center gap-1 rounded-full border px-2 font-semibold ${mine?.verdict === "DISAGREE" ? "border-danger bg-danger-bg text-danger" : "border-border text-ink-2 hover:text-ink"}`}>
        <X className="size-3" aria-hidden />{zh ? "不同意" : "Disagree"}</button>
      {mine?.note && !asking && <span className="text-ink-3">{mine.note}</span>}
      {asking && <span className="flex w-full flex-wrap items-center gap-2">
        <input value={note} maxLength={200} onChange={event => setNote(event.target.value)} placeholder={zh ? "为什么不同意（选填）" : "Why not (optional)"}
          className="min-h-8 flex-1 rounded-lg border border-border-strong bg-surface px-2 text-xs" />
        <button type="button" disabled={busy} onClick={() => void submit("DISAGREE")} className="press min-h-8 rounded-lg bg-accent px-3 font-semibold text-accent-foreground">{zh ? "确定" : "Save"}</button>
        <button type="button" disabled={busy} onClick={() => setAsking(false)} className="press min-h-8 rounded-lg px-2 text-ink-3">{zh ? "取消" : "Cancel"}</button>
      </span>}
    </> : mine && <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold ${mine.verdict === "AGREE" ? "bg-success-bg text-success" : "bg-danger-bg text-danger"}`}>
      {zh ? "你标了" : "You marked "}{mine.verdict === "AGREE" ? (zh ? "同意" : "agree") : (zh ? "不同意" : "disagree")}</span>}
  </div>;
}
