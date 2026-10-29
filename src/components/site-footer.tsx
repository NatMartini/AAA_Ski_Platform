import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";

export async function SiteFooter() {
  const t = await getTranslations("legal");
  const brand = await getTranslations("brand");

  return (
    <footer className="no-print mb-16 border-t border-border lg:mb-0">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-5 gap-y-2 px-4 py-6 text-xs text-ink-3 sm:px-6 lg:px-8">
        <span className="font-semibold text-ink-2">{brand("short")}</span>
        <span className="flex flex-wrap gap-x-5 gap-y-1 sm:ml-auto">
          <FooterLink href="/legal/terms">{t("terms")}</FooterLink>
          <FooterLink href="/legal/privacy">{t("privacy")}</FooterLink>
          <FooterLink href="/legal/accessibility">{t("accessibility")}</FooterLink>
        </span>
      </div>
    </footer>
  );
}

function FooterLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="inline-flex min-h-9 items-center font-medium transition-colors hover:text-ink"
    >
      {children}
    </Link>
  );
}
