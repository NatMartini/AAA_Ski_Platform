"use client";

import { Check } from "lucide-react";
import { ANALYSIS_TIERS, priceLabel, TIER_HALVES, TIER_INFO, upgradeHalves, type AnalysisTier } from "@/lib/video-analysis/tiers";
import { cn } from "@/lib/utils";

/**
 * The four analysis tiers as cards: what each one shows and what choosing it costs here. For a new analysis the price is
 * the tier's own; for one already started it is the difference to the tier paid for, so going back down is free.
 */
export function TierPicker({ value, onChange, zh, name, paidTier = null, unlimited = false, remainingHalves = null, freeLeft = null, disabled = false }: {
  value: AnalysisTier; onChange: (tier: AnalysisTier) => void; zh: boolean;
  /** Names the radio group, unique on the page. */
  name: string;
  /** For an analysis already started: the costliest tier paid for. */
  paidTier?: AnalysisTier | null;
  unlimited?: boolean;
  /** Analyses left, in halves; unknown where null. */
  remainingHalves?: number | null;
  /** Free analyses still open today, for a new analysis; no limit where null. */
  freeLeft?: number | null;
  disabled?: boolean;
}) {
  return <div role="radiogroup" aria-label={zh ? "分析档位" : "Analysis tier"} className="grid gap-2 sm:grid-cols-2">
    {ANALYSIS_TIERS.map(tier => {
      const cost = unlimited ? 0 : paidTier ? upgradeHalves(paidTier, tier) : TIER_HALVES[tier];
      const free = TIER_HALVES[tier] === 0;
      const short = !unlimited && cost > 0 && remainingHalves !== null && cost > remainingHalves;
      const outOfFree = !unlimited && !paidTier && free && freeLeft !== null && freeLeft <= 0;
      const off = disabled || short || outOfFree;
      const selected = value === tier;
      const price = unlimited ? (zh ? "不限次数" : "Unlimited")
        : paidTier ? (cost > 0 ? `+${priceLabel(cost, zh)}` : free ? (zh ? "免费" : "Free") : (zh ? "已付过" : "Paid"))
        : free && freeLeft !== null ? (zh ? `免费 · 今天还剩 ${Math.max(0, freeLeft)} 次` : `Free · ${Math.max(0, freeLeft)} left today`)
        : priceLabel(cost, zh);
      return <label key={tier} className={cn("relative flex min-h-16 cursor-pointer flex-col gap-1 rounded-xl border p-3 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent",
        selected ? "border-accent bg-accent-soft" : "border-border bg-surface hover:border-border-strong", off && "cursor-not-allowed opacity-55")}>
        <input type="radio" name={name} value={tier} checked={selected} disabled={off} onChange={() => onChange(tier)} className="sr-only" />
        <span className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 text-sm font-semibold">
            {selected && <Check className="size-4 text-accent" aria-hidden />}{zh ? TIER_INFO[tier].zh : TIER_INFO[tier].en}
          </span>
          <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold", cost > 0 ? "bg-amber-bg text-amber" : "bg-success-bg text-success")} data-numeric>{price}</span>
        </span>
        <span className="text-xs leading-relaxed text-ink-2">{zh ? TIER_INFO[tier].gistZh : TIER_INFO[tier].gistEn}</span>
        {short && <span className="text-xs font-semibold text-amber">{zh ? "可用次数不够" : "Not enough credits"}</span>}
        {outOfFree && <span className="text-xs font-semibold text-amber">{zh ? "今天的免费次数用完了" : "No free analyses left today"}</span>}
      </label>;
    })}
  </div>;
}
