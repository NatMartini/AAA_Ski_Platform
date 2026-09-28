import type { PackageStatus } from "@prisma/client";
import { PACKAGE_STATUS_TOKEN, packageStatusLabel } from "@/lib/packages";
import type { Locale } from "@/i18n/routing";
import { cn } from "@/lib/utils";

/** Same look as the booking status pill, with the package's own labels. */
export function PackageStatusPill({
  status,
  locale,
  className,
}: {
  status: PackageStatus;
  locale: Locale;
  className?: string;
}) {
  const t = PACKAGE_STATUS_TOKEN[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-bold",
        className,
      )}
      style={{
        background: `var(--pill-${t}-bg)`,
        borderColor: `var(--pill-${t}-br)`,
        color: `var(--pill-${t}-fg)`,
      }}
    >
      <span
        aria-hidden
        className="size-1.5 rounded-full"
        style={{ background: "currentColor" }}
      />
      {packageStatusLabel(status, locale)}
    </span>
  );
}
