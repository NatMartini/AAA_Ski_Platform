"use client";

import { useMemo, useState } from "react";
import type { Locale } from "@/i18n/routing";
import { cn } from "@/lib/utils";
import { ChevronLeft, ChevronRight } from "lucide-react";

/**
 * Month calendar for picking a lesson day.
 *
 * Replaces a `<select>` of dates. A season runs December to May, so the list
 * could be sixty entries long and gives no sense of *when* — a student
 * thinking "the weekend after next" had to read every option. A grid answers
 * that at a glance.
 *
 * Only days the coach has actually opened are selectable; the rest render as
 * plain text so the shape of the month still reads. Months with nothing
 * available are skipped entirely by the arrows, so paging never lands on an
 * empty screen.
 *
 * Dates are handled as `YYYY-MM-DD` strings throughout rather than Date
 * objects. The whole app already keys availability by that string, and
 * constructing a Date to render a calendar cell is how you end up with an
 * off-by-one day for anyone east of Toronto.
 */

type DateKey = string;

const WEEKDAYS = {
  zh: ["一", "二", "三", "四", "五", "六", "日"],
  en: ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"],
} as const;

function parseKey(key: DateKey): { y: number; m: number; d: number } {
  const [y, m, d] = key.split("-").map(Number);
  return { y, m, d };
}

function monthKey(key: DateKey): string {
  return key.slice(0, 7);
}

function monthLabel(month: string, locale: Locale): string {
  const [y, m] = month.split("-").map(Number);
  return locale === "zh"
    ? `${y} 年 ${m} 月`
    : new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-CA", {
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      });
}

/** Days in a month, and which weekday the 1st falls on (0 = Monday). */
function monthShape(month: string): { days: number; leading: number } {
  const [y, m] = month.split("-").map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  // getUTCDay is 0 = Sunday; the grid starts on Monday.
  const firstDow = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  return { days, leading: (firstDow + 6) % 7 };
}

export function DateCalendar({
  locale,
  available,
  selected,
  onSelect,
  labels,
}: {
  locale: Locale;
  /** Date keys the coach is open, in any order. */
  available: DateKey[];
  selected: DateKey | null;
  onSelect: (dateKey: DateKey) => void;
  labels: { prev: string; next: string; none: string };
}) {
  const openDays = useMemo(() => new Set(available), [available]);

  // Only months that have at least one open day, in order. Paging moves
  // between these rather than through the calendar, so a student never has to
  // click through an empty August to reach December.
  const months = useMemo(() => {
    const set = new Set(available.map(monthKey));
    return [...set].sort();
  }, [available]);

  const [monthIndex, setMonthIndex] = useState(() => {
    const from = selected ?? available.slice().sort()[0];
    const i = from ? months.indexOf(monthKey(from)) : 0;
    return i < 0 ? 0 : i;
  });

  if (months.length === 0) {
    return <p className="text-sm text-ink-2">{labels.none}</p>;
  }

  const month = months[Math.min(monthIndex, months.length - 1)];
  const { days, leading } = monthShape(month);
  const [y, m] = month.split("-").map(Number);

  return (
    <div className="rounded-xl border border-border bg-surface p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <button
          type="button"
          aria-label={labels.prev}
          disabled={monthIndex === 0}
          onClick={() => setMonthIndex((i) => Math.max(0, i - 1))}
          className="press flex size-8 items-center justify-center rounded-lg border border-border text-ink-2 disabled:opacity-35 hover:enabled:border-accent hover:enabled:text-ink"
        >
          <ChevronLeft className="size-4" aria-hidden />
        </button>
        <p aria-live="polite" className="font-display text-sm font-bold">
          {monthLabel(month, locale)}
        </p>
        <button
          type="button"
          aria-label={labels.next}
          disabled={monthIndex >= months.length - 1}
          onClick={() =>
            setMonthIndex((i) => Math.min(months.length - 1, i + 1))
          }
          className="press flex size-8 items-center justify-center rounded-lg border border-border text-ink-2 disabled:opacity-35 hover:enabled:border-accent hover:enabled:text-ink"
        >
          <ChevronRight className="size-4" aria-hidden />
        </button>
      </div>

      <div
        role="grid"
        aria-label={monthLabel(month, locale)}
        className="grid grid-cols-7 gap-1"
      >
        {WEEKDAYS[locale].map((w) => (
          <div
            key={w}
            role="columnheader"
            className="pb-1 text-center text-[11px] font-bold text-ink-3"
          >
            {w}
          </div>
        ))}

        {Array.from({ length: leading }, (_, i) => (
          <div key={`pad-${i}`} aria-hidden />
        ))}

        {Array.from({ length: days }, (_, i) => {
          const day = i + 1;
          const key = `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
          const open = openDays.has(key);
          const isSelected = key === selected;

          if (!open) {
            return (
              <div
                key={key}
                role="gridcell"
                aria-disabled
                className="flex min-h-10 items-center justify-center text-sm tabular-nums text-ink-3/45"
              >
                {day}
              </div>
            );
          }

          return (
            <button
              key={key}
              type="button"
              role="gridcell"
              aria-selected={isSelected}
              onClick={() => onSelect(key)}
              className={cn(
                "press flex min-h-10 items-center justify-center rounded-lg border text-sm font-bold tabular-nums",
                isSelected
                  ? "border-accent bg-accent text-accent-foreground shadow-[var(--shadow-sm)]"
                  : "border-border bg-surface-3 text-ink hover:border-accent hover:bg-[var(--accent-soft)]",
              )}
            >
              {day}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Exported for tests: the grid maths is the part worth pinning. */
export const __internal = { monthShape, monthKey, parseKey };
