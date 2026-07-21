"use client";

import { usePathname, useRouter } from "@/i18n/navigation";
import { useParams } from "next/navigation";
import { locales, type Locale } from "@/i18n/routing";
import { useTransition } from "react";
import { Languages } from "lucide-react";

const LABELS: Record<Locale, string> = { zh: "中文", en: "EN" };

export function LocaleSwitch({ current }: { current: Locale }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useParams();
  const [pending, startTransition] = useTransition();

  function switchTo(next: Locale) {
    startTransition(() => {
      // pathname here is already locale-stripped by next-intl's navigation, but
      // dynamic segments still need to be passed back through.
      router.replace(
        // @ts-expect-error -- params are re-applied verbatim to the same route
        { pathname, params },
        { locale: next },
      );
    });
  }

  return (
    <div className="flex items-center gap-1" aria-busy={pending}>
      <Languages className="size-4 text-muted-foreground" aria-hidden />
      {locales.map((locale) => (
        <button
          key={locale}
          type="button"
          onClick={() => switchTo(locale)}
          aria-current={locale === current ? "true" : undefined}
          className={
            locale === current
              ? "rounded px-2 py-1 text-xs font-semibold text-foreground"
              : "rounded px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
          }
        >
          {LABELS[locale]}
        </button>
      ))}
    </div>
  );
}
