"use client";

import { Link, usePathname } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

const ITEMS = [
  { href: "/coach", key: "today" },
  { href: "/coach/schedule", key: "schedule" },
  { href: "/coach/availability", key: "availability" },
  { href: "/coach/bookings", key: "bookings" },
  { href: "/coach/packages", key: "packages" },
  { href: "/coach/students", key: "students" },
  { href: "/coach/stats", key: "stats" },
  { href: "/coach/settings", key: "settings" },
] as const;

export function CoachNav() {
  const pathname = usePathname();
  const t = useTranslations("coach");

  return (
    <nav className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 text-sm">
      {ITEMS.map((item) => {
        // "/coach" would otherwise match every sub-page.
        const active =
          item.href === "/coach"
            ? pathname === "/coach"
            : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "press whitespace-nowrap rounded-xl border px-3.5 py-2 font-semibold",
              active
                ? "border-accent bg-accent text-accent-foreground shadow-[var(--shadow-sm)]"
                : "border-border bg-surface text-ink-2 hover:border-accent hover:text-ink",
            )}
          >
            {t(item.key)}
          </Link>
        );
      })}
    </nav>
  );
}
