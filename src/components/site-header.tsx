import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { Snowflake } from "lucide-react";
import type { ActiveUser } from "@/lib/auth/require-user";
import type { Locale } from "@/i18n/routing";
import { LocaleSwitch } from "./locale-switch";
import { SignOutButton } from "./sign-out-button";
import { ThemeToggle } from "./theme-toggle";
import { devBypassEnabled } from "@/lib/auth/dev-bypass";
import { NotificationBell } from "./notification-bell";

/**
 * The FreeSki introduction is public. Booking and coach navigation appear
 * after sign-in; the video-analysis destination also checks authentication.
 */
export async function SiteHeader({
  user,
  locale,
}: {
  user: ActiveUser | null;
  locale: Locale;
}) {
  const t = await getTranslations("nav");
  const brand = await getTranslations("brand");
  const isCoach = user?.role === "COACH" || user?.role === "ADMIN";

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-[var(--surface)]/90 shadow-[var(--shadow-sm)] backdrop-blur-xl">
      <div className="relative mx-auto flex w-full max-w-5xl flex-wrap items-center gap-x-2 gap-y-2 px-4 py-3 sm:gap-x-3 sm:px-6">
        <Link
          href={isCoach ? "/coach" : "/"}
          aria-label={brand("name")}
          className="press font-display flex shrink-0 items-center gap-2 font-extrabold tracking-tight"
        >
          <span className="flex size-9 items-center justify-center rounded-xl bg-accent text-accent-foreground shadow-[var(--shadow-sm)]">
            <Snowflake className="size-5" aria-hidden />
          </span>
          {/* Navigation has its own row on smaller screens. The compact
              desktop wordmark leaves room for every coach action. */}
          <span className="hidden sm:inline xl:hidden">{brand("name")}</span>
          <span className="hidden xl:inline">{brand("short")}</span>
        </Link>

          <nav aria-label={locale === "zh" ? "主导航" : "Main navigation"} className="order-3 flex w-full min-w-0 flex-wrap items-center gap-1 border-t border-border/70 pt-2 text-sm xl:order-none xl:ml-1 xl:w-auto xl:flex-1 xl:border-0 xl:pt-0">
            {user && (isCoach ? (
              <>
                <HeaderLink href="/coach" accent short={t("coachShort")}>
                  {t("coach")}
                </HeaderLink>
                <HeaderLink href="/coach/schedule" short={locale === "zh" ? "课表" : "Schedule"}>
                  {locale === "zh" ? "已排课程" : "Scheduled lessons"}
                </HeaderLink>
                <HeaderLink href="/coach/bookings/new" short={locale === "zh" ? "代约" : "New lesson"}>
                  {locale === "zh" ? "代学员建课" : "Book for a student"}
                </HeaderLink>
                <HeaderLink href="/calendar" short={locale === "zh" ? "日历" : "Calendar"}>
                  {t("calendar")}
                </HeaderLink>
              </>
            ) : (
              <>
                <HeaderLink href="/book" short={t("bookShort")}>
                  {t("book")}
                </HeaderLink>
                {/* The student home page keeps prices and calendar reachable on phones. */}
                <HeaderLink href="/prices" className="hidden md:inline-block">
                  {t("prices")}
                </HeaderLink>
                <HeaderLink href="/calendar" className="hidden lg:inline-block">
                  {t("calendar")}
                </HeaderLink>
                <HeaderLink href="/my/bookings" short={t("myBookingsShort")}>
                  {t("myBookings")}
                </HeaderLink>
              </>
            ))}
            <HeaderLink href="/video-analysis" short={t("videoAnalysisShort")}>
              {t("videoAnalysis")}
            </HeaderLink>
          </nav>

        <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-1.5">
          {user && <NotificationBell key={user.id} userId={user.id} locale={locale} />}
          <LocaleSwitch current={locale} />
          <ThemeToggle label={locale === "zh" ? "切换深色模式" : "Toggle theme"} />
          {user && (
            <SignOutButton label={t("signOut")} devMode={devBypassEnabled()} />
          )}
        </div>
      </div>
    </header>
  );
}

function HeaderLink({
  href,
  children,
  short,
  accent,
  className = "",
}: {
  href: string;
  children: React.ReactNode;
  /** Shown instead below md, where the full labels do not fit. */
  short?: string;
  accent?: boolean;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={`press whitespace-nowrap rounded-xl px-2.5 py-2 font-semibold transition-colors hover:bg-surface-2 md:px-3 ${
        accent ? "bg-accent-soft text-accent" : "text-ink-2 hover:text-ink"
      } ${className}`}
    >
      {short ? (
        <>
          <span className="md:hidden">{short}</span>
          <span className="hidden md:inline">{children}</span>
        </>
      ) : (
        children
      )}
    </Link>
  );
}
