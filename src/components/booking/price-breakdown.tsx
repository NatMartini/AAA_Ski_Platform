import { formatMoneyShort, type Quote } from "@/lib/pricing";
import { lessonTypeLabel } from "@/lib/lesson-types";
import type { Locale } from "@/i18n/routing";

const COPY = {
  zh: {
    perHour: "/ 小时",
    hours: "小时",
    lesson: "课程",
    earlyBird: "早鸟价",
    group: "人数",
    oneOnN: "1 对 {n}",
    handover: "交接扣减(每单 10 分钟)",
    packageLine: "课时包 {code} 抵扣 {hours} 小时",
    packageNew: "课时包抵扣 {hours} 小时",
    total: "实付(加元 CAD)",
  },
  en: {
    perHour: "/ hour",
    hours: "hours",
    lesson: "Lesson",
    earlyBird: "Early bird",
    group: "Students",
    oneOnN: "1-on-{n}",
    handover: "Handover credit (10 min per booking)",
    packageLine: "{hours} hours from package {code}",
    packageNew: "{hours} hours from your lesson package",
    total: "Total (CAD)",
  },
} as const;

/**
 * The itemised price. The requirement was explicit that the rate, the hours and
 * the ten-minute deduction all have to be spelled out rather than folded into
 * one number, so this is shown on both the review and payment pages.
 *
 * When a lesson package pays for the booking there is no rate or credit to
 * spell out — the hours come out of the package and nothing is due.
 */
export function PriceBreakdown({
  quote,
  locale,
  lessonType,
  earlyBird,
  packageUse,
}: {
  quote: Quote;
  locale: Locale;
  /** Key from lib/lesson-types.ts; omitted on bookings made before types. */
  lessonType?: string;
  earlyBird?: boolean;
  /** Set when the booking is paid from a lesson package. */
  packageUse?: { code: string | null; hours: number };
}) {
  const c = COPY[locale];
  const total = packageUse ? 0 : quote.totalCents;

  return (
    <dl className="overflow-hidden rounded-xl border border-border bg-surface-3 text-sm">
      {lessonType && (
        <div className="flex items-center justify-between gap-4 px-4 py-2.5">
          <dt className="text-ink-2">{c.lesson}</dt>
          <dd className="flex items-center gap-2 font-semibold text-ink">
            {lessonTypeLabel(lessonType, locale)}
            {earlyBird && !packageUse && <EarlyBirdTag label={c.earlyBird} />}
          </dd>
        </div>
      )}
      {packageUse ? (
        <Row
          term={(packageUse.code ? c.packageLine : c.packageNew)
            .replace("{code}", packageUse.code ?? "")
            .replace("{hours}", String(packageUse.hours))}
          value={formatMoneyShort(0)}
        />
      ) : (
        <>
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
        </>
      )}
      <div className="flex items-center justify-between gap-4 border-t border-border bg-surface px-4 py-3.5">
        <dt className="font-bold">{c.total}</dt>
        <dd className="text-xl font-extrabold tabular-nums tracking-tight">
          {formatMoneyShort(total)}
        </dd>
      </div>
    </dl>
  );
}

/** Small amber tag marking an early-bird price. */
export function EarlyBirdTag({ label }: { label: string }) {
  return (
    <span
      className="rounded-full px-2 py-0.5 text-[11px] font-bold"
      style={{ background: "var(--amber-bg)", color: "var(--amber)" }}
    >
      {label}
    </span>
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
