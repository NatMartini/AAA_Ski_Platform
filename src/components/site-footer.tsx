import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";

export async function SiteFooter() {
  const t = await getTranslations("legal");

  return (
    <footer className="no-print mt-8 border-t border-border">
      <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-x-5 gap-y-2 px-4 py-6 text-xs text-ink-3 sm:px-6">
        <FooterLink href="/legal/terms">{t("terms")}</FooterLink>
        <FooterLink href="/legal/privacy">{t("privacy")}</FooterLink>
        <FooterLink href="/legal/accessibility">{t("accessibility")}</FooterLink>
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
