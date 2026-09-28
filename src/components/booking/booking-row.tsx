import { Link } from "@/i18n/navigation";
import { StatusPill } from "@/components/ui/status-pill";
import { formatMoneyShort } from "@/lib/pricing";
import { formatTorontoDate, formatTorontoTime } from "@/lib/time";
import { lessonTypeLabel } from "@/lib/lesson-types";
import type { BookingStatus } from "@prisma/client";
import type { Locale } from "@/i18n/routing";
import { ChevronRight } from "lucide-react";

export type BookingRowData = {
  code: string;
  status: BookingStatus;
  startAt: Date;
  lessonStartAt: Date;
  lessonEndAt: Date;
  totalCents: number;
  lessonType: string;
  /** Paid from a lesson package, so the total is not money owed. */
  paidByPackage: boolean;
  resortName: string;
  otherPartyName: string;
  hasWaiver: boolean;
};

export function BookingRow({
  booking,
  locale,
  href,
}: {
  booking: BookingRowData;
  locale: Locale;
  href: string;
}) {
  const zh = locale === "zh";

  return (
    <Link
      href={href}
      className="lift flex items-center gap-3 rounded-2xl border border-border bg-surface p-4 shadow-[var(--shadow-sm)] hover:border-accent/40 hover:shadow-[var(--shadow)]"
    >
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-bold">
            {formatTorontoDate(booking.startAt, locale)}
          </span>
          <StatusPill status={booking.status} locale={locale} />
          {!booking.hasWaiver && (
            <span
              className="rounded-full border px-2.5 py-1 text-xs font-bold"
              style={{
                background: "var(--pill-waiver-bg)",
                borderColor: "var(--pill-waiver-br)",
                color: "var(--pill-waiver-fg)",
              }}
            >
              {zh ? "待签协议" : "waiver needed"}
            </span>
          )}
        </div>
        <p className="truncate text-sm text-ink-2">
          {formatTorontoTime(booking.lessonStartAt, locale)} –{" "}
          {formatTorontoTime(booking.lessonEndAt, locale)} · {booking.resortName}{" "}
          · {booking.otherPartyName}
        </p>
        <p className="font-mono text-xs text-ink-3">
          {booking.code} · {lessonTypeLabel(booking.lessonType, locale)} ·{" "}
          {booking.paidByPackage
            ? zh
              ? "课时包"
              : "package"
            : formatMoneyShort(booking.totalCents)}
        </p>
      </div>
      <ChevronRight className="size-4 shrink-0 text-ink-3" aria-hidden />
    </Link>
  );
}
