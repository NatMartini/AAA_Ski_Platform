import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { Snowflake } from "lucide-react";
import type { ActiveUser } from "@/lib/auth/require-user";
import type { Locale } from "@/i18n/routing";
import { LocaleSwitch } from "./locale-switch";
import { SignOutButton } from "./sign-out-button";
import { ThemeToggle } from "./theme-toggle";
import { devBypassEnabled } from "@/lib/auth/dev-bypass";

/**
 * Signed-out visitors see the brand and a sign-in link and nothing else — no
 * coach names, no resorts, no prices. Someone who stumbles onto the URL should
 * not be able to learn who teaches where for how much.
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
    <header className="sticky top-0 z-40 border-b border-border bg-[var(--surface)]/85 backdrop-blur-md">
      <div className="mx-auto flex w-full max-w-5xl items-center gap-3 px-4 py-3 sm:px-6">
        <Link
          href="/"
          className="press font-display flex items-center gap-2 font-extrabold tracking-tight"
        >
          <span className="flex size-8 items-center justify-center rounded-xl bg-accent text-accent-foreground">
            <Snowflake className="size-4" aria-hidden />
          </span>
          {/* The full name is long; below lg it would crowd out the nav, so
              the header falls back to the short form and then to the mark. */}
          <span className="hidden lg:inline">{brand("name")}</span>
          <span className="hidden sm:inline lg:hidden">{brand("short")}</span>
        </Link>

        {user && (
          // Short labels on a phone; wrapped, the Chinese ones stacked one
          // character per line. Scrolls sideways if even those do not fit.
          <nav className="ml-1 flex min-w-0 items-center gap-0.5 overflow-x-auto text-sm">
            <HeaderLink href="/book" short={t("bookShort")}>
              {t("book")}
            </HeaderLink>
            {/* No room on a phone; there the home page links to prices and
                the calendar, and the coach cards show prices anyway. */}
            <HeaderLink href="/prices" className="hidden md:inline-block">
              {t("prices")}
            </HeaderLink>
            <HeaderLink href="/calendar" className="hidden lg:inline-block">
              {t("calendar")}
            </HeaderLink>
            <HeaderLink href="/my/bookings" short={t("myBookingsShort")}>
              {t("myBookings")}
            </HeaderLink>
            {isCoach && (
              <HeaderLink href="/coach" accent short={t("coachShort")}>
                {t("coach")}
              </HeaderLink>
            )}
          </nav>
        )}

        <div className="ml-auto flex items-center gap-1.5">
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
      className={`press whitespace-nowrap rounded-lg px-1.5 py-2 font-semibold transition-colors hover:bg-surface-2 md:px-3 ${
        accent ? "text-accent" : "text-ink-2 hover:text-ink"
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
