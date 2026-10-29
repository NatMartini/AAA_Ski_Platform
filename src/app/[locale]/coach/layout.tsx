import { setRequestLocale } from "next-intl/server";
import { requireCoachPage } from "@/lib/auth/require-user";

/**
 * Coach pages are grouped into sections in the site header (see
 * lib/navigation), so this layout only guards access; each page has its own
 * title.
 */
export default async function CoachLayout({
  children,
  params,
}: LayoutProps<"/[locale]/coach">) {
  const { locale } = await params;
  setRequestLocale(locale);

  // Redirects to the home page (not a 403) for non-coaches, so the existence
  // of this area is not advertised.
  await requireCoachPage({ locale, callbackPath: `/${locale}/coach` });

  return <div className="space-y-6">{children}</div>;
}
