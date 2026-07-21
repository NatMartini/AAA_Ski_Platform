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
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <Link
          href="/coach/bookings/new"
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-foreground"
        >
          {t("newBooking")}
        </Link>
      </div>
      <CoachNav />
      {children}
    </div>
  );
}
