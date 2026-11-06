"use client";

import { Brain, Check, Loader2 } from "lucide-react";
import { THINKING_LEVELS, type ThinkingLevel } from "@/lib/freeski/scorecard";
import { cn } from "@/lib/utils";

type Status = "pending" | "running" | "ready" | "unavailable" | "failed";

// Names are the owner's (2026-11-06); a fifth, cloud-model level is planned as a paid feature and not offered yet.
// Waits are ModelCtrl's 2026-11-06 measurements for one answer; a deep one can also queue behind others.
const LEVELS: Record<ThinkingLevel, { zh: string; en: string; waitZh: string; waitEn: string }> = {
  none: { zh: "快！回答我", en: "Quick, just answer", waitZh: "约 1 分钟", waitEn: "about 1 min" },
  low: { zh: "看看算了", en: "Quick look", waitZh: "约 1 分钟", waitEn: "about 1 min" },
  medium: { zh: "认真一点", en: "Think it over", waitZh: "约 2 分钟", waitEn: "about 2 min" },
  xhigh: { zh: "当个事办", en: "Take it seriously", waitZh: "约 5 分钟", waitEn: "about 5 min" },
};

export const thinkingLabel = (level: ThinkingLevel, zh: boolean) => zh ? LEVELS[level].zh : LEVELS[level].en;

/**
 * How long the model thinks before writing the explanation. Each level is written once and kept, so
 * going back to one is instant; one explanation is written at a time, so the others wait. `shown` is
 * the level of the explanation on screen, which stays until the chosen one is written.
 */
export function ThinkingLevelPicker({ value, shown, levels, zh, onChange }: {
  value: ThinkingLevel; shown: ThinkingLevel | null; levels: Partial<Record<ThinkingLevel, Status>>; zh: boolean;
  onChange: (level: ThinkingLevel) => void;
}) {
  const writing = (level: ThinkingLevel) => levels[level] === "pending" || levels[level] === "running";
  const busy = THINKING_LEVELS.find(writing) ?? null;
  const chosen = levels[value];
  return <section className="space-y-2" aria-label={zh ? "讲解深度" : "Explanation depth"}>
    <p className="flex items-center gap-1.5 text-xs font-semibold text-ink-2">
      <Brain className="size-3.5" aria-hidden />{zh ? "讲解深度：想得越久，讲得越细，等得也越久" : "Explanation depth: longer thinking, more detail, longer wait"}</p>
    <div className="flex flex-wrap gap-1.5">{THINKING_LEVELS.map(level => {
      const status = levels[level], active = value === level;
      const blocked = status === "unavailable" || busy !== null && busy !== level && status !== "ready";
      return <button key={level} type="button" aria-pressed={active} disabled={blocked} onClick={() => onChange(level)}
        className={cn("press flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50",
          active ? "border-accent bg-accent text-accent-foreground" : "border-border bg-surface text-ink-2 hover:border-border-strong hover:text-ink")}>
        {thinkingLabel(level, zh)}
        {writing(level) ? <Loader2 className="size-3.5 animate-spin" aria-label={zh ? "正在写" : "Writing"} />
          : status === "ready" ? <Check className="size-3.5" aria-label={zh ? "已写好" : "Written"} />
          : <span className={cn("text-xs font-normal", active ? "text-accent-foreground/80" : "text-ink-3")}>
            {/* FreeSki does not retry these: a failed level was rejected twice, an unavailable one gave up after a day without the model. */}
            {status === "failed" ? (zh ? "没写成" : "not written") : status === "unavailable" ? (zh ? "暂时没有" : "not available")
              : zh ? LEVELS[level].waitZh : LEVELS[level].waitEn}</span>}
        {level === "xhigh" && <span className="rounded-full bg-success-bg px-1.5 py-0.5 text-[11px] font-semibold text-success">{zh ? "限时免费" : "Free for now"}</span>}
      </button>;
    })}</div>
    {(chosen === "pending" || chosen === "running") && <p role="status" className="text-xs leading-relaxed text-ink-3">
      {zh ? `正在用「${thinkingLabel(value, zh)}」档写讲解，${LEVELS[value].waitZh}；同一时间只写一份讲解，别人在写时要排队。`
        : `Writing the explanation at “${thinkingLabel(value, zh)}”, ${LEVELS[value].waitEn}; one explanation is written at a time, so it may queue.`}
      {shown && shown !== value && (zh ? `下面先显示「${thinkingLabel(shown, zh)}」档的讲解，写好后自动换上。` : ` The “${thinkingLabel(shown, zh)}” explanation stays below until then.`)}</p>}
    {chosen === "failed" && <p role="status" className="text-xs text-ink-3">
      {zh ? `「${thinkingLabel(value, zh)}」档的讲解这次没写成，可以换一档。` : `The “${thinkingLabel(value, zh)}” explanation could not be written this time. Try another depth.`}</p>}
  </section>;
}
