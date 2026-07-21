import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";

export async function SiteFooter() {
  const t = await getTranslations("legal");

  return (
    <footer className="no-print border-t border-border bg-surface-muted">
      <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-x-5 gap-y-2 px-4 py-5 text-xs text-muted-foreground sm:px-6">
        <Link href="/legal/terms" className="hover:text-foreground">
          {t("terms")}
        </Link>
        <Link href="/legal/privacy" className="hover:text-foreground">
          {t("privacy")}
        </Link>
        <Link href="/legal/accessibility" className="hover:text-foreground">
          {t("accessibility")}
        </Link>
      </div>
    </footer>
  );
}
