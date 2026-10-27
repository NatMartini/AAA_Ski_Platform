import { citesEstimated, type Teaching } from "@/lib/freeski/scorecard";

/** Model-written explanation whose every conclusion cites a code-computed comparison fact. */
export function AnalysisTeaching({ teaching, zh, turnLabel, onSelectTurn }: { teaching: Teaching; zh: boolean;
  turnLabel: (turnId: string) => string | null; onSelectTurn?: (turnId: string) => void }) {
  const estimated = (factIds: string[]) => citesEstimated(teaching, factIds)
    ? <span className="ml-2 whitespace-nowrap rounded-full border border-amber-border bg-amber-bg px-2 py-0.5 text-xs text-amber">{zh ? "视频估算" : "Video estimate"}</span> : null;
  const improvements = [...teaching.improvements].sort((a, b) => Number(b.priority === "primary") - Number(a.priority === "primary"));
  const summary = zh ? teaching.summary_zh : teaching.summary_en;
  const limitations = zh ? teaching.limitations_zh : teaching.limitations_en;
  return <section className="space-y-3" aria-label={zh ? "动作解释" : "Technique explanation"}>
    <div className="flex flex-wrap items-center gap-2">
      <p className="text-sm font-semibold">{zh ? "动作解释" : "Technique explanation"}</p>
      <span className="rounded-full border border-border bg-surface px-2.5 py-1 text-xs font-bold text-ink-2">{zh ? "试验性" : "Experimental"}</span>
    </div>
    <p className="text-xs text-ink-3">{zh ? "由本地模型根据与示范的对比数据撰写，每条结论都对应一项测量。" : "Written by a local model from the comparison with the examples; every point is tied to a measurement."}
      {teaching.model.model && <span className="break-all">{zh ? ` 模型：${teaching.model.model}` : ` Model: ${teaching.model.model}`}</span>}</p>
    {summary && <p className="text-sm leading-relaxed">{summary}</p>}
    {teaching.strengths.length > 0 && <div className="space-y-1">
      <p className="text-sm font-semibold text-success">{zh ? "做得好的地方" : "What is working"}</p>
      <ul className="list-disc space-y-1 pl-5 text-sm text-ink-2">{teaching.strengths.map((item, index) =>
        <li key={index}>{zh ? item.text_zh : item.text_en}{estimated(item.fact_ids)}</li>)}</ul>
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
      </div>)}
    </div>}
    {teaching.drills.length > 0 && <div className="space-y-2">
      <p className="text-sm font-semibold">{zh ? "建议练习" : "Suggested drills"}</p>
      {teaching.drills.map(drill => <div key={drill.drill_id} className="rounded-lg border border-border p-3 text-sm">
        <p className="font-semibold">{zh ? drill.name_zh : drill.name_en}</p>
        <p className="mt-1 text-ink-2">{zh ? drill.why_zh : drill.why_en}</p></div>)}
    </div>}
    {limitations.length > 0 && <ul className="space-y-1 text-xs text-ink-3">{limitations.map((text, index) => <li key={index}>{text}</li>)}</ul>}
  </section>;
}
