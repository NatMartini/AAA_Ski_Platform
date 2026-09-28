import { formatMoneyShort } from "@/lib/pricing";
import { lessonTypeLabel } from "@/lib/lesson-types";
import { offeredRates, type RateRow } from "@/lib/rates";
import type { Locale } from "@/i18n/routing";
import { EarlyBirdTag } from "./price-breakdown";

/**
 * A coach's prices, one line per lesson type. While the early bird is on, the
 * early-bird price leads and the regular price is struck through beside it.
 */
export function RateList({
  rates,
  locale,
  earlyBirdActive,
}: {
  rates: RateRow[];
  locale: Locale;
  earlyBirdActive: boolean;
}) {
  const zh = locale === "zh";
  const perHour = zh ? "/小时" : "/h";

  return (
    <ul className="space-y-1 text-sm" data-numeric>
      {offeredRates(rates).map((r) => {
        const early = earlyBirdActive && r.earlyBirdCents != null;
        return (
          <li
            key={r.lessonType}
            className="flex flex-wrap items-baseline justify-between gap-x-3"
          >
            <span className="text-ink-2">{lessonTypeLabel(r.lessonType, locale)}</span>
            <span className="flex items-baseline gap-1.5">
              {early && (
                <s className="text-xs text-ink-3">
                  <span className="sr-only">{zh ? "原价 " : "Regular "}</span>
                  {formatMoneyShort(r.regularCents)}
                </s>
              )}
              <strong className="font-display text-ink">
                {formatMoneyShort(early ? r.earlyBirdCents! : r.regularCents)}
                <span className="text-xs font-semibold text-ink-3">{perHour}</span>
              </strong>
              {early && <EarlyBirdTag label={zh ? "早鸟" : "Early bird"} />}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
