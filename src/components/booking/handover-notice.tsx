import { formatMoneyShort } from "@/lib/pricing";
import { formatTorontoTime } from "@/lib/time";
import type { Locale } from "@/i18n/routing";
import { Clock } from "lucide-react";

/**
 * Said plainly where the money is: the lesson starts ten minutes past the
 * hour, and the fee for those ten minutes has been taken off. Students who
 * miss this turn up at the hour and wonder why the lesson is short.
 */
export function HandoverNotice({
  locale,
  lessonStartAt,
  lessonEndAt,
  creditCents,
}: {
  locale: Locale;
  lessonStartAt: Date;
  lessonEndAt: Date;
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
            ? `开头 10 分钟是教练与上一位学员的交接时间,不收费:课费里已经直接减去 ${formatMoneyShort(creditCents)}。`
            : `The first ten minutes are the coach's handover from the previous student, so they are not charged: ${formatMoneyShort(creditCents)} has been taken off.`}
        </p>
      </div>
    </div>
  );
}
