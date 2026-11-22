"use client";

import { useState } from "react";
import { ChevronRight, Layers } from "lucide-react";
import { clientFetch } from "@/lib/client-fetch";
import { useRouter } from "@/i18n/navigation";
import { credits, priceLabel, TIER_INFO, upgradeHalves, type AnalysisTier } from "@/lib/video-analysis/tiers";
import { cn } from "@/lib/utils";
import { TierPicker } from "./analysis-tier-picker";

/** Who may move this analysis between tiers, and on whose account. */
export type TierControl = {
  scope: "account" | "booking"; jobId: string; paidTier: AnalysisTier;
  /** A personal analysis's owner, or a lesson analysis's coach. */
  canChange: boolean;
  accountId?: string | null; unlimited?: boolean;
  /** Analyses left, in halves, when known. */
  remainingHalves?: number | null;
};

/**
 * The report's tier: what it is, and a way to change it. Going up asks first and charges the difference; going down
 * keeps what was paid, so coming back costs nothing. The page is read again after a change: what the new tier shows is
 * made first, and the report appears when it is all there.
 */
export function ReportTierBar({ tier, control, zh }: { tier: AnalysisTier; control: TierControl; zh: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = zh ? TIER_INFO[tier].zh : TIER_INFO[tier].en;

  async function change(next: AnalysisTier) {
    if (next === tier || busy) return;
    const cost = control.unlimited ? 0 : upgradeHalves(control.paidTier, next);
    if (cost > 0 && !window.confirm(zh ? `改为${TIER_INFO[next].zh}档需要扣 ${credits(cost)} 次分析，确定吗？` : `Moving to ${TIER_INFO[next].en} uses ${priceLabel(cost, false)}. Continue?`)) return;
    setBusy(true);
    setError(null);
    try {
      const response = await clientFetch(`/api/video-analysis/jobs/${control.scope}/${encodeURIComponent(control.jobId)}/tier`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ tier: next, ...(control.accountId ? { expectedAccountId: control.accountId } : {}) }),
      });
      const data = await response.json().catch(() => ({})) as { error?: string; job?: { tier: AnalysisTier; paidTier: AnalysisTier }; quota?: { remainingHalves?: number } };
      if (!response.ok || !data.job) {
        setError(data.error === "quota-exhausted" ? (zh ? "可用次数不够，没有改档。" : "Not enough credits; the tier was not changed.")
          : data.error === "forbidden" ? (zh ? "只有这节课的教练能改档位。" : "Only this lesson's coach can change the tier.")
          : (zh ? "没有改成功，请刷新后再试。" : "The tier was not changed. Refresh and try again."));
        return;
      }
      setOpen(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return <div className="rounded-xl border border-border bg-surface">
    <button type="button" aria-expanded={open} disabled={!control.canChange} onClick={() => setOpen(value => !value)}
      className={cn("flex min-h-11 w-full items-center gap-2 px-3 text-left text-sm", control.canChange ? "cursor-pointer" : "cursor-default")}>
      <Layers className="size-4 shrink-0 text-accent" aria-hidden />
      <span className="min-w-0 flex-1"><span className="font-semibold">{zh ? `分析档位：${name}` : `Analysis tier: ${name}`}</span>
        <span className="ml-2 text-xs text-ink-3">{zh ? TIER_INFO[tier].gistZh : TIER_INFO[tier].gistEn}</span></span>
      {control.canChange && <span className="flex shrink-0 items-center gap-1 text-xs font-semibold text-accent">{zh ? "改档位" : "Change"}
        <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} aria-hidden /></span>}
    </button>
    {open && <div className="space-y-2 border-t border-border p-3">
      <TierPicker name={`report-tier-${control.jobId}`} value={tier} onChange={tier => void change(tier)} zh={zh} disabled={busy}
        paidTier={control.paidTier} unlimited={control.unlimited} remainingHalves={control.remainingHalves ?? null} />
      {error && <p role="alert" className="text-sm font-semibold text-danger">{error}</p>}
    </div>}
  </div>;
}
