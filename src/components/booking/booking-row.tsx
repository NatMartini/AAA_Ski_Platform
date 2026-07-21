import { Link } from "@/i18n/navigation";
import { statusLabel, statusTone } from "@/lib/booking/state";
import { formatMoneyShort } from "@/lib/pricing";
import { formatTorontoDate, formatTorontoTime } from "@/lib/time";
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
      className="flex items-center gap-3 rounded-lg border border-border bg-surface p-4 transition-colors hover:border-ice-400"
    >
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">
            {formatTorontoDate(booking.startAt, locale)}
          </span>
          <span
            className={`rounded-full border px-2 py-0.5 text-xs ${statusTone(booking.status)}`}
          >
            {statusLabel(booking.status, locale)}
          </span>
          {!booking.hasWaiver && (
            <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-xs text-amber-700 dark:text-amber-300">
              {zh ? "待签协议" : "waiver needed"}
            </span>
          )}
        </div>
        <p className="truncate text-sm text-muted-foreground">
          {formatTorontoTime(booking.lessonStartAt, locale)} –{" "}
          {formatTorontoTime(booking.lessonEndAt, locale)} · {booking.resortName}{" "}
          · {booking.otherPartyName}
        </p>
        <p className="font-mono text-xs text-muted-foreground">
          {booking.code} · {formatMoneyShort(booking.totalCents)}
        </p>
      </div>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
    </Link>
  );
}
