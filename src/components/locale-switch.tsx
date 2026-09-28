"use client";

import { usePathname, useRouter } from "@/i18n/navigation";
import { useParams } from "next/navigation";
import { locales, type Locale } from "@/i18n/routing";
import { useTransition } from "react";

const LABELS: Record<Locale, string> = { zh: "中文", en: "EN" };

/**
 * Segmented language switch. The sliding highlight is a single absolutely
 * positioned element rather than a per-button background, so the movement
 * between languages animates instead of snapping.
 */
export function LocaleSwitch({ current }: { current: Locale }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useParams();
  const [pending, startTransition] = useTransition();

  const index = locales.indexOf(current);

  function switchTo(next: Locale) {
    if (next === current) return;
    startTransition(() => {
      router.replace(
        // @ts-expect-error -- params are re-applied verbatim to the same route
        { pathname, params },
        { locale: next },
      );
    });
  }

  return (
    <div
      className="relative flex rounded-lg border border-border bg-surface-2 p-0.5"
      aria-busy={pending}
    >
      <span
        aria-hidden
        className="absolute inset-y-0.5 rounded-[6px] bg-surface shadow-[var(--shadow-sm)] transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
        style={{
          width: `calc((100% - 4px) / ${locales.length})`,
          transform: `translateX(${index * 100}%)`,
          left: "2px",
        }}
      />
      {locales.map((locale) => (
        <button
          key={locale}
          type="button"
          onClick={() => switchTo(locale)}
          aria-current={locale === current ? "true" : undefined}
          className={`relative z-10 flex min-h-9 min-w-9 items-center justify-center rounded-[6px] px-1.5 text-xs sm:min-w-11 sm:px-2 font-bold transition-colors ${
            locale === current ? "text-ink" : "text-ink-3 hover:text-ink-2"
          }`}
        >
          {LABELS[locale]}
        </button>
      ))}
    </div>
  );
}
