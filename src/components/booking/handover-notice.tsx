import { formatMoneyShort } from "@/lib/pricing";
import { formatTorontoTime } from "@/lib/time";
import type { Locale } from "@/i18n/routing";
import { Clock } from "lucide-react";

/**
 * Said plainly where the money is: the lesson starts ten minutes past the
 * hour, and the fee for those ten minutes has been taken off. Students who
 * miss this turn up at the hour and wonder why the bill is not a round number.
 */
export function HandoverNotice({
  locale,
  lessonStartAt,
  lessonEndAt,
  perHourCents,
  creditCents,
}: {
  locale: Locale;
  lessonStartAt: Date;
  lessonEndAt: Date;
  perHourCents: number;
  creditCents: number;
}) {
  const zh = locale === "zh";
  const start = formatTorontoTime(lessonStartAt, locale);
  const end = formatTorontoTime(lessonEndAt, locale);

  return (
    <div
      role="note"
      className="flex items-start gap-3 rounded-xl border p-4 text-sm"
      style={{
        background: "var(--amber-bg)",
        borderColor: "var(--amber-border)",
        color: "var(--amber)",
      }}
    >
      <Clock className="mt-0.5 size-5 shrink-0" aria-hidden />
      <div className="space-y-1">
        <p className="text-base font-extrabold">
          {zh ? "开课时间是整点后 10 分钟" : "Your lesson starts ten minutes past the hour"}
        </p>
        <p className="font-semibold text-ink">
          {zh ? `本课 ${start} 开始,${end} 结束。` : `It runs ${start} – ${end}.`}
        </p>
        <p className="leading-relaxed text-ink-2" data-numeric>
          {zh
            ? `开头 10 分钟是教练与上一位学员的交接时间。这 10 分钟的课时费 ${formatMoneyShort(creditCents)}(每小时 ${formatMoneyShort(perHourCents)} × 10/60)已经从课费中减去。`
            : `The first ten minutes are the coach's handover from the previous student. Those ten minutes' fee, ${formatMoneyShort(creditCents)} (${formatMoneyShort(perHourCents)} an hour × 10/60), has been taken off.`}
        </p>
      </div>
    </div>
  );
}
