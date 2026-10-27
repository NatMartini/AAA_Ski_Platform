import type { Locale } from "@/i18n/routing";
import { Check } from "lucide-react";

export function BookingSteps({ locale, current }: { locale: Locale; current: 1 | 2 | 3 }) {
  const labels = locale === "zh" ? ["雪场", "时间", "教练"] : ["Resort", "Time", "Coach"];
  return (
    <ol aria-label={locale === "zh" ? "预约步骤" : "Booking steps"} className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs sm:text-sm">
      {labels.map((label, index) => {
        const step = index + 1;
        return (
          <li key={label} aria-current={step === current ? "step" : undefined} className={`flex items-center gap-2 font-semibold ${step === current ? "text-accent" : "text-ink-3"}`}>
            <span className={`flex size-6 items-center justify-center rounded-full border ${step === current ? "border-accent bg-accent text-accent-foreground" : "border-border bg-surface"}`}>
              {step < current ? <Check className="size-3" aria-hidden /> : <span aria-hidden>{step}</span>}
            </span>
            {label}
          </li>
        );
      })}
    </ol>
  );
}
