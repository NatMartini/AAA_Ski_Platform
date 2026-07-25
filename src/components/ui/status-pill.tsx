import type { BookingStatus } from "@prisma/client";
import { statusLabel } from "@/lib/booking/state";
import type { Locale } from "@/i18n/routing";
import { cn } from "@/lib/utils";

/**
 * Booking status pill.
 *
 * Colours come from per-state CSS variables rather than Tailwind palette
 * classes, so both themes are handled in globals.css and this component never
 * needs a dark: variant.
 */
const TOKEN: Record<BookingStatus, string> = {
  HOLD: "hold",
  AWAITING_WAIVER: "waiver",
  AWAITING_PAYMENT: "payment",
  PAYMENT_REJECTED: "cancelled",
  PENDING_PAYMENT_REVIEW: "checking",
  CONFIRMED: "confirmed",
  COMPLETED: "confirmed",
  EXPIRED: "hold",
  CANCELLED: "cancelled",
};

export function StatusPill({
  status,
  locale,
  className,
}: {
  status: BookingStatus;
  locale: Locale;
  className?: string;
}) {
  const t = TOKEN[status];
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
      {statusLabel(status, locale)}
    </span>
  );
}
