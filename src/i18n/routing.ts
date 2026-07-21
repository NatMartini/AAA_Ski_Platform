import { defineRouting } from "next-intl/routing";

export const locales = ["zh", "en"] as const;
export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "zh";

export const routing = defineRouting({
  locales,
  defaultLocale,
  // Always prefix so /zh/... and /en/... are both explicit and shareable — the
  // booking link gets pasted into a group chat, and an ambiguous root is one
  // more thing to go wrong.
  localePrefix: "always",
});

export function isLocale(value: string): value is Locale {
  return (locales as readonly string[]).includes(value);
}

/** Narrow an unknown route segment to a Locale, falling back to the default. */
export function toLocale(value: string | undefined): Locale {
  return value && isLocale(value) ? value : defaultLocale;
}
