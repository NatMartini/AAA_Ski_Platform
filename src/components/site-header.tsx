import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { Snowflake } from "lucide-react";
import type { ActiveUser } from "@/lib/auth/require-user";
import type { Locale } from "@/i18n/routing";
import { LocaleSwitch } from "./locale-switch";
import { SignOutButton } from "./sign-out-button";

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
    <header className="border-b border-border bg-surface">
      <div className="mx-auto flex w-full max-w-5xl items-center gap-4 px-4 py-3 sm:px-6">
        <Link
          href="/"
          className="flex items-center gap-2 font-semibold tracking-tight"
        >
          <Snowflake className="size-5 text-ice-500" aria-hidden />
          <span>{brand("name")}</span>
        </Link>

        {user && (
          <nav className="ml-auto flex items-center gap-1 text-sm">
            <Link
              href="/book"
              className="rounded-lg px-3 py-2 hover:bg-surface-muted"
            >
              {t("book")}
            </Link>
            <Link
              href="/my/bookings"
              className="rounded-lg px-3 py-2 hover:bg-surface-muted"
            >
              {t("myBookings")}
            </Link>
            {isCoach && (
              <Link
                href="/coach"
                className="rounded-lg px-3 py-2 font-medium text-ice-700 hover:bg-surface-muted dark:text-ice-300"
              >
                {t("coach")}
              </Link>
            )}
          </nav>
        )}

        <div className={user ? "flex items-center gap-2" : "ml-auto flex items-center gap-2"}>
          <LocaleSwitch current={locale} />
          {user && <SignOutButton label={t("signOut")} />}
        </div>
      </div>
    </header>
  );
}
