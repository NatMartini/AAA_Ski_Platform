"use client";

import { Link, usePathname } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

const ITEMS = [
  { href: "/coach", key: "today" },
  { href: "/coach/schedule", key: "schedule" },
  { href: "/coach/availability", key: "availability" },
  { href: "/coach/bookings", key: "bookings" },
  { href: "/coach/settings", key: "settings" },
] as const;

export function CoachNav() {
  const pathname = usePathname();
  const t = useTranslations("coach");

  return (
    <nav className="flex flex-wrap gap-1 border-b border-border pb-2 text-sm">
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
              "rounded-lg px-3 py-2",
              active
                ? "bg-surface-muted font-medium text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t(item.key)}
          </Link>
        );
      })}
    </nav>
  );
}
