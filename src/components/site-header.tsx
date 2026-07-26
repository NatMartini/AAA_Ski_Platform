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
          <nav className="ml-1 flex items-center gap-0.5 text-sm">
            <HeaderLink href="/book">{t("book")}</HeaderLink>
            <HeaderLink href="/my/bookings">{t("myBookings")}</HeaderLink>
            {isCoach && (
              <HeaderLink href="/coach" accent>
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
  accent,
}: {
  href: string;
  children: React.ReactNode;
  accent?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`press rounded-lg px-3 py-2 font-semibold transition-colors hover:bg-surface-2 ${
        accent ? "text-accent" : "text-ink-2 hover:text-ink"
      }`}
    >
      {children}
    </Link>
  );
}
