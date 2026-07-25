import { formatMoneyShort, type Quote } from "@/lib/pricing";
import type { Locale } from "@/i18n/routing";

const COPY = {
  zh: {
    perHour: "/ 小时",
    hours: "小时",
    group: "人数",
    oneOnN: "1 对 {n}",
    handover: "交接扣减(每单 10 分钟)",
    total: "实付(加元 CAD)",
  },
  en: {
    perHour: "/ hour",
    hours: "hours",
    group: "Students",
    oneOnN: "1-on-{n}",
    handover: "Handover credit (10 min per booking)",
    total: "Total (CAD)",
  },
} as const;

/**
 * The itemised price. The requirement was explicit that the rate, the hours and
 * the ten-minute deduction all have to be spelled out rather than folded into
 * one number, so this is shown on both the review and payment pages.
 */
export function PriceBreakdown({
  quote,
  locale,
}: {
  quote: Quote;
  locale: Locale;
}) {
  const c = COPY[locale];

  return (
    <dl className="overflow-hidden rounded-xl border border-border bg-surface-3 text-sm">
      {quote.headcount > 1 && (
        <Row
          term={c.group}
          value={c.oneOnN.replace("{n}", String(quote.headcount))}
          muted
        />
      )}
      <Row
        term={`${formatMoneyShort(quote.perHourCents)} ${c.perHour} × ${quote.hours} ${c.hours}`}
        value={formatMoneyShort(quote.subtotalCents)}
      />
      <Row
        term={c.handover}
        value={`−${formatMoneyShort(quote.handoverDiscountCents)}`}
        muted
        credit
      />
      <div className="flex items-center justify-between gap-4 border-t border-border bg-surface px-4 py-3.5">
        <dt className="font-bold">{c.total}</dt>
        <dd className="text-xl font-extrabold tabular-nums tracking-tight">
          {formatMoneyShort(quote.totalCents)}
        </dd>
      </div>
    </dl>
  );
}

function Row({
  term,
  value,
  muted,
  credit,
}: {
  term: string;
  value: string;
  muted?: boolean;
  /** Deductions read in the success colour so they are visibly a reduction. */
  credit?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-2.5">
      <dt className={muted ? "text-ink-2" : "text-ink"}>{term}</dt>
      <dd
        className={`tabular-nums ${credit ? "font-semibold text-success" : "text-ink"}`}
      >
        {value}
      </dd>
    </div>
  );
}
