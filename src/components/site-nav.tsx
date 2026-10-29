"use client";

import {
  ClipboardList, CalendarPlus, House, LayoutDashboard, Settings2, Users, Video,
  type LucideIcon,
} from "lucide-react";
import { Link, usePathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { activeNav, type NavIcon, type NavSection } from "@/lib/navigation";
import { TONE_TEXT } from "@/components/ui/tone";
import { cn } from "@/lib/utils";

const ICONS: Record<NavIcon, LucideIcon> = {
  home: House, book: CalendarPlus, lessons: ClipboardList, video: Video,
  dashboard: LayoutDashboard, students: Users, admin: Settings2,
};

/** The section links in the header, from lg up; narrower screens get the bottom tab bar. */
export function DesktopNav({ sections, locale }: { sections: NavSection[]; locale: Locale }) {
  const pathname = usePathname();
  const { section: current } = activeNav(pathname, sections);
  return (
    <nav aria-label={locale === "zh" ? "主导航" : "Main navigation"} className="hidden min-w-0 items-center gap-1 lg:flex">
      {sections.map((section) => {
        const active = section.key === current?.key;
        const Icon = ICONS[section.icon];
        return (
          <Link
            key={section.key}
            href={section.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "press inline-flex min-h-10 items-center gap-2 whitespace-nowrap rounded-xl px-3 text-sm font-semibold transition-colors",
              active ? "bg-surface-2 text-ink" : "text-ink-2 hover:bg-surface-2 hover:text-ink",
            )}
          >
            <Icon className={cn("size-4", active ? TONE_TEXT[section.tone] : "text-ink-3")} aria-hidden />
            {locale === "zh" ? section.zh : section.en}
          </Link>
        );
      })}
    </nav>
  );
}

/** The pages inside the current section, as a tab strip under the header. */
export function SectionTabs({ sections, locale }: { sections: NavSection[]; locale: Locale }) {
  const pathname = usePathname();
  const { section, item } = activeNav(pathname, sections);
  if (!section || section.items.length < 2) return null;
  return (
    <div className="border-t border-border">
      <nav
        aria-label={locale === "zh" ? `${section.zh}页面` : `${section.en} pages`}
        className="scrollbar-none mx-auto flex w-full max-w-6xl gap-1 overflow-x-auto px-4 sm:px-6 lg:px-8"
      >
        {section.items.map((entry) => {
          const active = entry.href === item?.href;
          return (
            <Link
              key={entry.href}
              href={entry.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative inline-flex min-h-11 shrink-0 items-center whitespace-nowrap px-3 text-sm font-semibold transition-colors",
                active ? "text-ink" : "text-ink-3 hover:text-ink",
              )}
            >
              {locale === "zh" ? entry.zh : entry.en}
              {active && <span aria-hidden className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-accent" />}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

/** Phone navigation: the same sections as a bottom tab bar. */
export function MobileNav({ sections, locale }: { sections: NavSection[]; locale: Locale }) {
  const pathname = usePathname();
  const { section: current } = activeNav(pathname, sections);
  return (
    <nav
      aria-label={locale === "zh" ? "主导航" : "Main navigation"}
      className="no-print fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden"
    >
      <div className="mx-auto flex max-w-lg">
        {sections.map((section) => {
          const active = section.key === current?.key;
          const Icon = ICONS[section.icon];
          return (
            <Link
              key={section.key}
              href={section.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-semibold",
                active ? "text-ink" : "text-ink-3",
              )}
            >
              <Icon className={cn("size-5", active && TONE_TEXT[section.tone])} aria-hidden />
              {locale === "zh" ? section.zh : section.en}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
