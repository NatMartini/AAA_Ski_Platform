import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { Snowflake } from "lucide-react";
import type { ActiveUser } from "@/lib/auth/require-user";
import type { Locale } from "@/i18n/routing";
import { navSections } from "@/lib/navigation";
import { LocaleSwitch } from "./locale-switch";
import { SignOutButton } from "./sign-out-button";
import { ThemeToggle } from "./theme-toggle";
import { devBypassEnabled } from "@/lib/auth/dev-bypass";
import { NotificationBell } from "./notification-bell";
import { DesktopNav, MobileNav, SectionTabs } from "./site-nav";
import { Button } from "./ui/button";

/**
 * The FreeSki introduction is public. Booking and coach navigation appear
 * after sign-in; the video-analysis destination also checks authentication.
 * Pages are grouped into sections (see lib/navigation): the header lists the
 * sections, and the strip under it lists the pages of the current one.
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
  const sections = navSections(user?.role ?? null);
  const zh = locale === "zh";
  const roleLabel = isCoach ? (zh ? "教练" : "Coach") : zh ? "学员" : "Student";

  return (
    <>
      <header className="no-print sticky top-0 z-40 border-b border-border bg-surface/90 backdrop-blur-xl">
        <div className="relative mx-auto flex h-16 w-full max-w-6xl items-center gap-3 px-4 sm:px-6 lg:gap-6 lg:px-8">
          <Link
            href={isCoach ? "/coach" : "/"}
            aria-label={brand("name")}
            className="press flex shrink-0 items-center gap-2.5"
          >
            <span className="flex size-9 items-center justify-center rounded-xl bg-accent text-accent-foreground">
              <Snowflake className="size-5" aria-hidden />
            </span>
            <span className="font-display hidden text-base font-bold sm:inline">{brand("short")}</span>
          </Link>

          <DesktopNav sections={sections} locale={locale} />

          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            {user && <NotificationBell key={user.id} userId={user.id} locale={locale} />}
            <LocaleSwitch current={locale} />
            <ThemeToggle label={zh ? "切换深色模式" : "Toggle theme"} />
            {user ? (
              <div className="ml-1 flex items-center gap-1 border-l border-border pl-2.5">
                <span className="hidden min-w-0 flex-col leading-tight xl:flex">
                  <span className="max-w-36 truncate text-sm font-semibold">{user.name ?? user.email}</span>
                  <span className="text-xs text-ink-3">{roleLabel}</span>
                </span>
                <SignOutButton label={t("signOut")} devMode={devBypassEnabled()} />
              </div>
            ) : (
              <Button asChild size="sm" className="ml-1">
                <Link href="/sign-in">{t("signIn")}</Link>
              </Button>
            )}
          </div>
        </div>
        {user && <SectionTabs sections={sections} locale={locale} />}
      </header>
      <MobileNav sections={sections} locale={locale} />
    </>
  );
}
