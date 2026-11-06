import { Camera } from "lucide-react";
import { turnNumber, type Scorecard } from "@/lib/freeski/scorecard";
import { FILMING_GUIDE } from "@/lib/video-analysis/precheck";
import { EVIDENCE, type EvidenceReason } from "./analysis-scorecard";

type Tip = { zh: string; en: string };

const TURN_TIP: Record<EvidenceReason, Tip> = {
  subject_small: { zh: "离近一些，让人至少占画面高度的五分之一。", en: "Film closer so the skier fills at least a fifth of the frame height." },
  out_of_frame: { zh: "横屏拍，镜头一直跟住人，让整个弯都留在画面里。", en: "Film in landscape and keep the skier, and the whole turn, in frame." },
  lower_body_hidden: { zh: "要拍到腿和雪板，别让雪包或其他人挡住。", en: "Keep the legs and skis in view, not hidden by bumps or other people." },
  tracking_lost: { zh: "画面里尽量只有滑雪者一个人；跟拍时转动镜头，不要走动。", en: "Keep only the skier in shot; when following, pivot the camera rather than walking." },
  overlapping_person: { zh: "等其他人离开画面再拍。", en: "Wait until nobody else is in shot." },
  discontinuity: { zh: "一趟连续拍完，不要剪辑或切换镜头。", en: "Film the run in one continuous shot, without cuts." },
};
const CLIP_TIP: Partial<Record<Scorecard["quality_reasons"][number], Tip>> = {
  camera_motion: FILMING_GUIDE[3],
  low_pose_confidence: { zh: "选光线好的时候拍，离近一些，让下半身看得清。", en: "Film in good light and closer, so the lower body is clear." },
  subject_reacquired: { zh: "画面里不要有其他人，免得认错滑雪者。", en: "Keep other people out of shot so the skier is not mixed up with them." },
};

function turnList(numbers: number[], zh: boolean) {
  if (zh) return `第 ${numbers.join("、")} 弯`;
  return numbers.length === 1 ? `Turn ${numbers[0]}` : `Turns ${numbers.slice(0, -1).join(", ")} and ${numbers[numbers.length - 1]}`;
}

/** What held this clip's analysis back, as advice for filming the next one; empty when nothing did. */
export function filmingAdvice(card: Scorecard, zh: boolean): string[] {
  const lines: string[] = [], tips = new Set<string>();
  for (const reason of Object.keys(TURN_TIP) as EvidenceReason[]) {
    const numbers = card.turns.filter(turn => turn.evidence?.status === "insufficient" && turn.evidence.reasons.includes(reason)).map(turn => turnNumber(turn.turn_id)!);
    if (!numbers.length) continue;
    const tip = TURN_TIP[reason][zh ? "zh" : "en"];
    tips.add(tip);
    lines.push(zh ? `${turnList(numbers, true)}${EVIDENCE[reason][0]}，没有打分。${tip}` : `${turnList(numbers, false)}: ${EVIDENCE[reason][1]}, so not scored. ${tip}`);
  }
  for (const reason of card.quality_reasons) {
    // Too few turns only says to film more when the clip itself was short, not when footage excluded them.
    const tip = (reason === "few_turns" && card.overall.turns_total < 5 ? FILMING_GUIDE[1] : CLIP_TIP[reason])?.[zh ? "zh" : "en"];
    if (tip && !tips.has(tip)) { tips.add(tip); lines.push(tip); }
  }
  return lines;
}

/** Shown only when this clip's footage limited the analysis. */
export function FilmingTips({ card, zh }: { card: Scorecard; zh: boolean }) {
  const advice = filmingAdvice(card, zh);
  if (!advice.length) return null;
  return <section className="space-y-2 rounded-xl border border-amber-border bg-amber-bg p-3 text-sm" aria-label={zh ? "下次拍得更准" : "Filming tips"}>
    <p className="flex items-center gap-2 font-semibold text-amber"><Camera className="size-4" aria-hidden />{zh ? "下次拍得更准" : "Film it better next time"}</p>
    <ul className="space-y-1 leading-relaxed text-ink-2">{advice.map(line => <li key={line}>{line}</li>)}</ul>
    <details className="text-xs text-ink-2">
      <summary className="cursor-pointer font-semibold">{zh ? "完整拍摄指南" : "Full filming guide"}</summary>
      <ul className="mt-1 list-disc space-y-1 pl-5">{FILMING_GUIDE.map(rule => <li key={rule.en}>{zh ? rule.zh : rule.en}</li>)}</ul>
    </details>
  </section>;
}
