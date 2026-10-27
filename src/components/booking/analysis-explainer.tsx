"use client";

import { useEffect, useRef, useState } from "react";
import { explainerSchema, type Explainer } from "@/lib/freeski/scorecard";
import { clientFetch } from "@/lib/client-fetch";
import { referenceNote, type ReferenceTarget } from "./analysis-scorecard";

const KIND: Record<NonNullable<Explainer["segments"]>[number]["kind"], [string, string]> = {
  title: ["片头", "Intro"], realtime: ["原速", "Real time"], slow: ["慢动作", "Slow motion"],
  freeze: ["定格", "Freeze"], outro: ["总结", "Summary"],
};

/** Slow-motion skeleton comparison rendered by FreeSki; captions come from FreeSki's code templates. */
export function AnalysisExplainer({ base, zh, target = null }: { base: string; zh: boolean; target?: ReferenceTarget | null }) {
  const [explainer, setExplainer] = useState<Explainer | null>(null);
  const [current, setCurrent] = useState(0);
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>, attempts = 0;
    const load = async () => {
      try {
        const response = await clientFetch(`${base}/explainer`, { cache: "no-store", signal: controller.signal });
        if (!response.ok) return;
        const value = explainerSchema.parse(await response.json());
        if (controller.signal.aborted) return;
        setExplainer(value);
        if ((value.status === "pending" || value.status === "running") && attempts++ < 120) timer = setTimeout(() => void load(), 5000);
      } catch { /* The explainer is optional; the report stays usable without it. */ }
    };
    void load();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [base]);
  if (!explainer || explainer.status === "unavailable") return null;
  if (explainer.status === "pending" || explainer.status === "running")
    return <p className="text-sm text-ink-3">{zh ? "慢动作讲解视频生成中…" : "Generating the slow-motion explainer…"}</p>;
  if (explainer.status === "failed" || !explainer.segments)
    return <p className="text-sm text-ink-3">{zh ? "慢动作讲解视频这次没有生成成功，评分和文字解释不受影响。" : "The slow-motion explainer could not be generated; scores and notes are unaffected."}</p>;
  const segments = explainer.segments;
  const perTurn = Object.values(explainer.reference_status ?? {});
  const statuses = perTurn.length || !explainer.reference || explainer.reference === "mixed" ? perTurn : [explainer.reference];
  const overlaid = statuses.some(status => status !== "not_available");
  const seek = (index: number) => {
    setCurrent(index);
    if (video.current) { video.current.currentTime = segments[index].start_sec; void video.current.play().catch(() => {}); }
  };
  return <section className="space-y-3" aria-label={zh ? "慢动作讲解" : "Slow-motion explainer"}>
    <div className="flex flex-wrap items-center gap-2">
      <p className="text-sm font-semibold">{zh ? "慢动作讲解" : "Slow-motion explainer"}</p>
      <span className="rounded-full border border-border bg-surface px-2.5 py-1 text-xs font-bold text-ink-2">{zh ? "试验性" : "Experimental"}</span>
    </div>
    {statuses.length > 0 && <p className="text-xs text-ink-3">{referenceNote(statuses, zh, target)}
      {overlaid && (zh ? "两副骨架按身高和髋部对齐叠放。" : " The skeletons are aligned by height and hips.")}</p>}
    <video ref={video} src={`${base}/assets/explainer`} controls playsInline preload="metadata"
      width={explainer.width} height={explainer.height} className="h-auto w-full rounded-lg bg-black"
      onTimeUpdate={() => {
        const time = video.current?.currentTime ?? 0;
        const index = segments.findIndex(segment => time >= segment.start_sec && time < segment.end_sec);
        if (index >= 0 && index !== current) setCurrent(index);
      }} />
    <ol className="space-y-1 text-sm">{segments.map((segment, index) => <li key={index}>
      <button type="button" onClick={() => seek(index)} aria-current={index === current ? "step" : undefined}
        className={`w-full rounded-lg px-3 py-2 text-left ${index === current ? "bg-accent-soft" : "hover:bg-surface"}`}>
        <span className="mr-2 text-xs text-ink-3">{KIND[segment.kind][zh ? 0 : 1]} · {segment.start_sec.toFixed(1)}s</span>
        {/* The title caption can quote the withheld overall score. */}
        {segment.kind === "title" ? null : zh ? segment.caption_zh : segment.caption_en}
      </button></li>)}</ol>
  </section>;
}
