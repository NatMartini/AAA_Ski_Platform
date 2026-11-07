"use client";

import { useMemo, useState, type ReactNode } from "react";
import { ChevronRight, PersonStanding } from "lucide-react";
import { Link } from "@/i18n/navigation";
import type { Scorecard } from "@/lib/freeski/scorecard";
import type { StandardMotion, StandardMotionId } from "@/lib/freeski/standard-motion";
import { faultById, faultEvidence, faultsFor, faultsForAction, GUIDE_DRILLS, type Evidence, type Fault, type FaultId } from "@/lib/freeski/technique-faults";
import { cn } from "@/lib/utils";
import { TechniqueDiagram, useStandardMotion } from "./technique-diagrams";

/**
 * 动作讲解: each problem the score card points to, as a coach would explain it — what it looks like on the video,
 * what the student's own measurements say, what commonly causes it, a picture of the forces, the guide's fix and drills.
 */

function Block({ title, children }: { title: string; children: ReactNode }) {
  return <div className="space-y-1">
    <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-3">{title}</h4>
    {children}
  </div>;
}

function Drills({ fault, zh }: { fault: Fault; zh: boolean }) {
  if (fault.drills.length === 0) return null;
  return <Block title={zh ? "练习" : "Drills"}>
    <ul className="space-y-2">{fault.drills.map(id => {
      const drill = GUIDE_DRILLS[id], motion = "motion" in drill ? drill.motion : null;
      return <li key={id} className="rounded-lg bg-surface-2 p-2.5 text-sm">
        <p className="flex flex-wrap items-center gap-x-2 font-semibold">{zh ? drill.zh : drill.en}
          <span className="text-xs font-normal text-ink-3">{drill.source}</span></p>
        <p className="mt-0.5 text-ink-2">{zh ? drill.purposeZh : drill.purposeEn}</p>
        {motion && <Link href={`/video-analysis/standards?motion=${motion}`} className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-accent underline">
          <PersonStanding className="size-3.5" aria-hidden />{zh ? "看这个练习的标准动作" : "Watch this drill's standard"}</Link>}
      </li>;
    })}</ul>
  </Block>;
}

/** One problem explained: shared by the report (with the student's evidence) and the motion library (without). */
function FaultBody({ fault, zh, motion, evidence, causes, durations, onShowMetric, onOpen }: {
  fault: Fault; zh: boolean; motion: StandardMotion | null; evidence?: Evidence[]; causes?: { fault: Fault; shows: boolean | null }[];
  durations?: number[] | null; onShowMetric?: (key: string) => void; onOpen?: (id: FaultId) => void;
}) {
  return <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
    <div className="min-w-0 space-y-3">
      {motion ? <TechniqueDiagram kind={fault.diagram} motion={motion} zh={zh} faultName={zh ? fault.zh : fault.en} durations={durations} />
        : <div className="aspect-[4/3] w-full animate-pulse rounded-lg bg-surface-2" aria-label={zh ? "正在加载示意图" : "Loading the picture"} />}
    </div>
    <div className="min-w-0 space-y-3 text-sm leading-relaxed">
      <Block title={zh ? "视频里看什么" : "What to look for"}><p className="text-ink-2">{zh ? fault.seeZh : fault.seeEn}</p></Block>
      {evidence && evidence.length > 0 && <Block title={zh ? "你的数据" : "Your measurements"}>
        <div className="flex flex-wrap gap-1.5">{evidence.map(({ metric, standing }) => {
          const text = <>{zh ? metric.label_zh : metric.label_en}{metric.score !== null && <span className="ml-1 font-bold" data-numeric>{Math.round(metric.score)}</span>}</>;
          const style = cn("inline-flex min-h-8 items-center rounded-full border px-2.5 text-xs", standing === "short" ? "border-amber-border bg-amber-bg text-amber" : "border-border bg-success-bg text-success");
          return onShowMetric ? <button key={metric.key} type="button" onClick={() => onShowMetric(metric.key)} className={cn("press", style)}
            title={zh ? "在视频里高亮这一项" : "Highlight this in the video"}>{text}</button> : <span key={metric.key} className={style}>{text}</span>;
        })}</div>
      </Block>}
      {causes && causes.length > 0 && <Block title={zh ? "常见原因，对照你的数据" : "Common causes, against your measurements"}>
        <ul className="space-y-1">{causes.map(({ fault: cause, shows }) => <li key={cause.id} className="flex flex-wrap items-baseline gap-x-2">
          {onOpen ? <button type="button" onClick={() => onOpen(cause.id)} className="font-semibold text-accent underline">{zh ? cause.zh : cause.en}</button>
            : <span className="font-semibold">{zh ? cause.zh : cause.en}</span>}
          <span className={cn("text-xs", shows ? "font-semibold text-amber" : "text-ink-3")}>{shows === null ? (zh ? "这次没测到" : "not measured this time")
            : shows ? (zh ? "你的数据也显示这个问题" : "your measurements show this too") : (zh ? "数据上看还好" : "looks fine in your measurements")}</span>
        </li>)}</ul>
      </Block>}
      <Block title={zh ? "为什么，力是怎么变的" : "Why, and how the forces change"}><p className="text-ink-2">{zh ? fault.whyZh : fault.whyEn}</p></Block>
      <Block title={zh ? "怎么改" : "What to do"}>
        <p className="text-ink-2">{zh ? fault.fixZh : fault.fixEn}</p>
        <p className="text-xs text-ink-3">{zh ? `CSIA 指南：${fault.criterionZh}（${fault.source}）` : `CSIA guide: ${fault.criterionEn} (${fault.source})`}</p>
      </Block>
      <Drills fault={fault} zh={zh} />
    </div>
  </div>;
}

function FaultCard({ fault, zh, open, onToggle, headline, children }: {
  fault: Fault; zh: boolean; open: boolean; onToggle: () => void; headline?: ReactNode; children: ReactNode;
}) {
  return <div className="rounded-xl border border-border bg-surface">
    <button type="button" aria-expanded={open} onClick={onToggle} className="flex min-h-12 w-full items-center gap-3 px-3 py-2 text-left">
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">{zh ? fault.zh : fault.en}</span>
        {headline && <span className="block text-xs text-ink-3">{headline}</span>}
      </span>
      <ChevronRight className={cn("size-4 shrink-0 text-ink-3 transition-transform", open && "rotate-90")} aria-hidden />
    </button>
    {open && <div className="border-t border-border p-3">{children}</div>}
  </div>;
}

/** The report's movement explanations: the problems the score card shows, worst first, one open at a time. */
export function MovementExplanations({ card, zh, motionId, durations, onShowMetric }: {
  card: Scorecard; zh: boolean; motionId: StandardMotionId | null; durations?: number[] | null; onShowMetric?: (key: string) => void;
}) {
  const found = useMemo(() => faultsFor(card), [card]);
  const [open, setOpen] = useState<FaultId | null>(found[0]?.fault.id ?? null);
  const motion = useStandardMotion(found.length > 0 ? motionId : null);
  if (found.length === 0) return null;
  const listed = new Set(found.map(entry => entry.fault.id));
  return <div className="space-y-2">
    <p className="text-xs text-ink-3">{zh ? "按你的数据里最需要改的排。图里绿色是标准动作，橙色是同一个人犯这个毛病的样子，力是按标准动作的弧线算的示意。"
      : "Ordered by what your measurements most need. In the pictures green is the standard and orange the same skier with the fault; the forces are worked out for the standard's arc, as an illustration."}</p>
    {found.map(({ fault, evidence }) => {
      const short = evidence.filter(item => item.standing === "short").map(item => zh ? item.metric.label_zh : item.metric.label_en);
      const causes = fault.causes?.map(id => {
        const cause = faultById(id), seen = faultEvidence(cause, card);
        return { fault: cause, shows: seen.length === 0 ? null : seen.some(item => item.standing === "short") };
      });
      return <FaultCard key={fault.id} fault={fault} zh={zh} open={open === fault.id} onToggle={() => setOpen(open === fault.id ? null : fault.id)}
        headline={short.length > 0 ? (zh ? `数据：${short.join("、")}` : `Measured: ${short.join(", ")}`) : undefined}>
        <FaultBody fault={fault} zh={zh} motion={motion} evidence={evidence} causes={causes} durations={durations} onShowMetric={onShowMetric}
          onOpen={id => listed.has(id) ? setOpen(id) : undefined} />
      </FaultCard>;
    })}
  </div>;
}

/** The motion library's common problems for the shown action and level, each with its picture drawn from this motion. */
export function CommonProblems({ motion, zh }: { motion: StandardMotion; zh: boolean }) {
  const faults = useMemo(() => faultsForAction(motion.action, motion.level), [motion]);
  const [open, setOpen] = useState<FaultId | null>(null);
  if (faults.length === 0) return null;
  return <section className="space-y-2">
    <h3 className="text-sm font-semibold">{zh ? "常见问题" : "Common problems"} <span className="font-normal text-ink-3">{zh ? "按 CSIA 指南对这个动作的要求" : "for what the CSIA guide asks of this run"}</span></h3>
    {faults.map(fault => <FaultCard key={fault.id} fault={fault} zh={zh} open={open === fault.id} onToggle={() => setOpen(open === fault.id ? null : fault.id)}
      headline={zh ? fault.criterionZh : fault.criterionEn}>
      <FaultBody fault={fault} zh={zh} motion={motion} />
    </FaultCard>)}
  </section>;
}
