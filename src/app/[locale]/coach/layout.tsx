import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { requireCoachPage } from "@/lib/auth/require-user";
import { CoachNav } from "@/components/coach/coach-nav";

export default async function CoachLayout({
  children,
  params,
}: LayoutProps<"/[locale]/coach">) {
  const { locale } = await params;
  setRequestLocale(locale);

  // Redirects to the home page (not a 403) for non-coaches, so the existence
  // of this area is not advertised.
  await requireCoachPage({ locale, callbackPath: `/${locale}/coach` });

  const t = await getTranslations("coach");

  return (
    <div className="stagger space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl">{t("title")}</h1>
        <Link
          href="/coach/bookings/new"
          className="press rounded-xl bg-accent px-5 py-2.5 text-sm font-bold text-accent-foreground shadow-[var(--shadow-sm)] hover:bg-accent-strong"
        >
          {t("newBooking")}
        </Link>
      </div>
      <CoachNav />
      {children}
    </div>
  );
}
