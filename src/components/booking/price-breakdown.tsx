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
    <dl className="rounded-lg border border-border text-sm">
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
      />
      <div className="flex items-center justify-between gap-4 border-t border-border px-4 py-3">
        <dt className="font-medium">{c.total}</dt>
        <dd className="text-lg font-semibold tabular-nums">
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
}: {
  term: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-2.5">
      <dt className={muted ? "text-muted-foreground" : undefined}>{term}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}
