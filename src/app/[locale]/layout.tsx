import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Manrope, Noto_Sans_SC } from "next/font/google";
import { NextIntlClientProvider, hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { routing } from "@/i18n/routing";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { DevBanner } from "@/components/dev-banner";
import { ThemeScript } from "@/components/theme-script";
import { getUser } from "@/lib/auth/require-user";
import "../globals.css";

// Manrope carries the Latin text; Noto Sans SC covers Chinese. Both are
// self-hosted by next/font, so there is no third-party request at runtime —
// which also keeps the CSP free of a font CDN.
const manrope = Manrope({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-manrope",
  display: "swap",
});

const notoSansSC = Noto_Sans_SC({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-noto-sc",
  display: "swap",
  preload: false, // the SC subset is large; let it load on demand
});

export async function generateMetadata({
  params,
}: LayoutProps<"/[locale]">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "brand" });
  return {
    title: t("name"),
    description: t("tagline"),
    // This site is handed out as a link in a group chat. It should never be
    // indexed, and there is nothing here worth a search result.
    robots: { index: false, follow: false, nocache: true },
  };
}

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: LayoutProps<"/[locale]">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const user = await getUser();

  return (
    <html
      lang={locale}
      className={`h-full antialiased ${manrope.variable} ${notoSansSC.variable}`}
      suppressHydrationWarning /* ThemeScript sets data-theme before paint */
    >
      <body className="flex min-h-full flex-col">
        <ThemeScript />
        <NextIntlClientProvider>
          <DevBanner user={user} />
          <SiteHeader user={user} locale={locale} />
          <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6">
            {children}
          </main>
          <SiteFooter />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
