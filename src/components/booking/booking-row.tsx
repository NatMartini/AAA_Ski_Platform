import { Link } from "@/i18n/navigation";
import { StatusPill } from "@/components/ui/status-pill";
import { formatMoneyShort } from "@/lib/pricing";
import { formatTorontoDate, formatTorontoTime, utcToTorontoParts } from "@/lib/time";
import { lessonTypeLabel } from "@/lib/lesson-types";
import type { BookingStatus } from "@prisma/client";
import type { Locale } from "@/i18n/routing";
import { ChevronRight } from "lucide-react";

const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

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
  const day = utcToTorontoParts(booking.startAt);

  return (
    <Link
      href={href}
      className="lift group flex items-center gap-4 rounded-2xl border border-border bg-surface p-3.5 shadow-[var(--shadow-sm)] hover:border-border-strong sm:p-4"
    >
      <span aria-hidden className="flex w-14 shrink-0 flex-col items-center rounded-xl bg-cat-lessons-soft py-2 text-cat-lessons">
        <span className="text-[11px] font-semibold">{zh ? `${day.month}月` : MONTHS_EN[day.month - 1]}</span>
        <span className="font-display text-xl font-bold leading-tight">{day.day}</span>
      </span>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold">
            {formatTorontoDate(booking.startAt, locale)}
          </span>
          <StatusPill status={booking.status} locale={locale} />
          {!booking.hasWaiver && (
            <span
              className="rounded-full border px-2.5 py-0.5 text-xs font-semibold"
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
        <p className="text-xs text-ink-3">
          <span className="font-mono">{booking.code}</span> · {lessonTypeLabel(booking.lessonType, locale)} ·{" "}
          {booking.paidByPackage
            ? zh
              ? "课时包"
              : "package"
            : formatMoneyShort(booking.totalCents)}
        </p>
      </div>
      <ChevronRight className="size-4 shrink-0 text-ink-3 transition-transform group-hover:translate-x-0.5" aria-hidden />
    </Link>
  );
}
