import { CornerUpLeft, CornerUpRight } from "lucide-react";
import { turnNumber, type Scorecard } from "@/lib/freeski/scorecard";
import { cn } from "@/lib/utils";
import { EVIDENCE, turnLabel } from "./analysis-scorecard";

type Kind = "scored" | "focus" | "excluded" | "uncounted" | "plain";

// Label, segment style, and a legend swatch outlined so the pale fills still show at that size.
const KIND: Record<Exclude<Kind, "plain">, [string, string, string, string]> = {
  scored: ["计分", "Scored", "bg-accent-soft text-accent", "bg-accent-soft ring-1 ring-inset ring-accent/40"],
  focus: ["最该练", "Work on this", "bg-amber-bg text-amber", "bg-amber-bg ring-1 ring-inset ring-amber/60"],
  excluded: ["证据不足，不打分", "Not enough footage, not scored", "border border-dashed border-amber-border text-amber", "border border-dashed border-amber"],
  uncounted: ["不计分（启动、结束弯）", "Not counted (start and end turns)", "border border-border bg-surface text-ink-3", "border border-border-strong bg-surface"],
};

/**
 * The clip's turns in time order, each as wide as it lasted, so a turn is easy to place in the video: scored turns,
 * the one to work on, turns without enough footage, and start or end turns that are listed but not counted.
 */
export function TurnStrip({ turns, card, zh, selected = null, focus = null, onSelect }: {
  turns: { turnId: string; startMs: number; endMs: number }[]; card: Scorecard | null; zh: boolean;
  selected?: string | null; focus?: string | null; onSelect?: (turnId: string) => void;
}) {
  if (!turns.length) return null;
  const entries = turns.map(({ turnId, startMs, endMs }) => {
    const turn = card?.turns.find(candidate => candidate.turn_id === turnId);
    const excluded = turn?.evidence?.status === "insufficient";
    const kind: Kind = !turn ? "plain" : excluded ? "excluded" : turnId === focus ? "focus" : turn.used_in_overall ? "scored" : "uncounted";
    const why = excluded ? turn!.evidence!.reasons.map(reason => EVIDENCE[reason][zh ? 0 : 1]).join(zh ? "、" : ", ") : "";
    const score = turn && !excluded && turn.score !== null ? Math.round(turn.score) : null;
    const parts = [turnLabel(turnId, zh),
      turn?.direction === "left" ? (zh ? "左转" : "left turn") : turn?.direction === "right" ? (zh ? "右转" : "right turn") : null,
      turn?.role === "start" ? (zh ? "启动弯" : "start turn") : turn?.role === "end" ? (zh ? "结束弯" : "end turn") : null,
      excluded ? (zh ? `证据不足（${why}）` : `not scored (${why})`) : kind === "uncounted" ? (zh ? "不计分" : "not counted")
        : score !== null ? (zh ? `${score} 分` : `score ${score}`) : null,
      kind === "focus" ? (zh ? "最该练" : "work on this") : null,
      turn?.evidence?.reacquired ? (zh ? "中途重新识别" : "re-identified") : null];
    return { turnId, kind, score, direction: turn?.direction, width: Math.max(endMs - startMs, 1), description: parts.filter(Boolean).join(" · ") };
  });
  const kinds = new Set(entries.map(entry => entry.kind));
  const reacquired = card?.turns.filter(turn => turn.evidence?.reacquired && turns.some(entry => entry.turnId === turn.turn_id)) ?? [];
  return <div className="space-y-2">
    <div className="scrollbar-none -mx-1 flex gap-1 overflow-x-auto px-1 py-1">{entries.map(entry => {
      const Arrow = entry.direction === "left" ? CornerUpLeft : entry.direction === "right" ? CornerUpRight : null;
      const className = cn("flex min-h-11 min-w-9 basis-0 flex-col items-center justify-center rounded-md px-1 text-xs leading-tight",
        KIND[entry.kind === "plain" ? "uncounted" : entry.kind][2], entry.turnId === selected && "ring-2 ring-accent ring-offset-2 ring-offset-surface-2");
      const content = <>
        <span className="flex items-center gap-0.5 font-semibold" data-numeric>{turnNumber(entry.turnId)}{Arrow && <Arrow className="size-3" aria-hidden />}</span>
        {entry.score !== null && <span className="text-[11px] font-normal" data-numeric>{entry.score}</span>}
      </>;
      return onSelect
        ? <button type="button" key={entry.turnId} aria-pressed={entry.turnId === selected} aria-label={entry.description} title={entry.description}
            onClick={() => onSelect(entry.turnId)} style={{ flexGrow: entry.width }} className={cn("press", className)}>{content}</button>
        : <span key={entry.turnId} role="img" aria-label={entry.description} title={entry.description} style={{ flexGrow: entry.width }} className={className}>{content}</span>;
    })}</div>
    {card && <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-3">{(Object.keys(KIND) as (keyof typeof KIND)[]).filter(kind => kinds.has(kind)).map(kind =>
      <li key={kind} className="flex items-center gap-1.5"><span className={cn("size-3 rounded-sm", KIND[kind][3])} aria-hidden />{KIND[kind][zh ? 0 : 1]}</li>)}</ul>}
    {reacquired.length > 0 && <p className="text-xs text-amber">{zh
      ? `${reacquired.map(turn => turnLabel(turn.turn_id, zh)).join("、")}中途重新识别了滑雪者，请确认画面中是你。`
      : `The skier was picked up again mid-clip in ${reacquired.map(turn => turnLabel(turn.turn_id, zh).toLowerCase()).join(", ")}; check that it is you in the frame.`}</p>}
  </div>;
}
