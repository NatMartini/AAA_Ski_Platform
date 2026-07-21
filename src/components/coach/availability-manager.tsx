"use client";

import { useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FieldError, Hint, Input, Label, Select } from "@/components/ui/field";
import { formatMoneyShort } from "@/lib/pricing";
import { isWithinSeason, seasonOfDateKey } from "@/lib/season";
import type { Locale } from "@/i18n/routing";
import { Loader2, Trash2 } from "lucide-react";

export type ManagedDay = {
  id: string;
  date: string;
  resortId: string;
  resortName: string;
  startHour: number;
  endHour: number;
  breakStartHour: number | null;
  breakEndHour: number | null;
  hourlyRateCentsOverride: number | null;
  note: string | null;
  bookingCount: number;
};

type Resort = { id: string; slug: string; nameEn: string; nameZh: string };

const COPY = {
  zh: {
    title: "可用日",
    intro:
      "选一个日期、雪场和时间段。学员只能在你开放的日子里预定;午休时段会自动挡掉。",
    date: "日期",
    resort: "雪场",
    from: "开始",
    to: "结束",
    lunch: "午休",
    lunchOn: "13:00–14:00 休息",
    lunchOff: "不设午休",
    rateOverride: "当日特价(留空用默认价)",
    note: "备注(仅自己可见)",
    add: "保存这一天",
    existing: "已开放的日子",
    none: "还没有开放任何日期。",
    booked: "{n} 个订单",
    remove: "删除",
    offSeason: "雪季为 12 月 1 日至次年 5 月 1 日,该日期不在雪季内。",
    hasBookings: "该日仍有订单,无法删除。",
    conflicts: "新的时间段会把已有订单挤出去:{codes}",
    season: "{season} 雪季",
  },
  en: {
    title: "Availability",
    intro:
      "Pick a date, a resort and a window. Students can only book on days you open; the lunch break is blocked automatically.",
    date: "Date",
    resort: "Resort",
    from: "From",
    to: "To",
    lunch: "Lunch break",
    lunchOn: "13:00–14:00 break",
    lunchOff: "No break",
    rateOverride: "Rate for this day (blank uses your default)",
    note: "Note (only you see this)",
    add: "Save this day",
    existing: "Open days",
    none: "No days opened yet.",
    booked: "{n} booking(s)",
    remove: "Remove",
    offSeason: "The season runs 1 December to 1 May. This date is outside it.",
    hasBookings: "This day still has bookings and cannot be removed.",
    conflicts: "The new window would strand existing bookings: {codes}",
    season: "{season} season",
  },
} as const;

const HOURS = Array.from({ length: 25 }, (_, i) => i);

export function AvailabilityManager({
  locale,
  resorts,
  initialDays,
  defaultRateCents,
}: {
  locale: Locale;
  resorts: Resort[];
  initialDays: ManagedDay[];
  defaultRateCents: number;
}) {
  const router = useRouter();
  const c = COPY[locale];

  const [date, setDate] = useState("");
  const [resortId, setResortId] = useState(resorts[0]?.id ?? "");
  const [startHour, setStartHour] = useState(9);
  const [endHour, setEndHour] = useState(16);
  const [lunch, setLunch] = useState(true);
  const [rateOverride, setRateOverride] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const season = date && isWithinSeason(date) ? seasonOfDateKey(date) : null;
  const offSeason = date !== "" && !isWithinSeason(date);

  async function save() {
    setError(null);
    if (offSeason) {
      setError(c.offSeason);
      return;
    }
    setBusy(true);
    const res = await fetch("/api/coach/availability", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        date,
        resortId,
        startHour,
        endHour,
        breakStartHour: lunch ? 13 : null,
        breakEndHour: lunch ? 14 : null,
        hourlyRateCentsOverride: rateOverride
          ? Math.round(Number(rateOverride) * 100)
          : null,
        note: note || null,
      }),
    });
    setBusy(false);

    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        bookings?: string[];
        fields?: Record<string, string>;
      };
      if (body.error === "conflicts-existing-bookings") {
        setError(c.conflicts.replace("{codes}", (body.bookings ?? []).join(", ")));
      } else {
        setError(
          body.fields ? Object.values(body.fields)[0] : (body.error ?? "failed"),
        );
      }
      return;
    }
    setDate("");
    setNote("");
    setRateOverride("");
    router.refresh();
  }

  async function remove(day: ManagedDay) {
    if (day.bookingCount > 0) {
      setError(c.hasBookings);
      return;
    }
    setBusy(true);
    const res = await fetch(`/api/coach/availability?id=${day.id}`, {
      method: "DELETE",
    });
    setBusy(false);
    if (res.ok) router.refresh();
    else setError(c.hasBookings);
  }

  return (
    <div className="space-y-5">
      <Card className="space-y-4">
        <div>
          <CardTitle>{c.title}</CardTitle>
          <CardDescription>{c.intro}</CardDescription>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="date">{c.date}</Label>
            <Input
              id="date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
            {season && (
              <Hint>{c.season.replace("{season}", season)}</Hint>
            )}
            {offSeason && <FieldError>{c.offSeason}</FieldError>}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="resort">{c.resort}</Label>
            <Select
              id="resort"
              value={resortId}
              onChange={(e) => setResortId(e.target.value)}
            >
              {resorts.map((r) => (
                <option key={r.id} value={r.id}>
                  {locale === "zh" ? r.nameZh : r.nameEn}
                </option>
              ))}
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="startHour">{c.from}</Label>
              <Select
                id="startHour"
                value={startHour}
                onChange={(e) => setStartHour(Number(e.target.value))}
              >
                {HOURS.slice(0, 24).map((h) => (
                  <option key={h} value={h}>
                    {String(h).padStart(2, "0")}:00
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="endHour">{c.to}</Label>
              <Select
                id="endHour"
                value={endHour}
                onChange={(e) => setEndHour(Number(e.target.value))}
              >
                {HOURS.filter((h) => h > startHour).map((h) => (
                  <option key={h} value={h}>
                    {String(h).padStart(2, "0")}:00
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="lunch">{c.lunch}</Label>
            <Select
              id="lunch"
              value={lunch ? "on" : "off"}
              onChange={(e) => setLunch(e.target.value === "on")}
            >
              <option value="on">{c.lunchOn}</option>
              <option value="off">{c.lunchOff}</option>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="rate">{c.rateOverride}</Label>
            <Input
              id="rate"
              type="number"
              min={0}
              step="0.01"
              inputMode="decimal"
              placeholder={(defaultRateCents / 100).toFixed(2)}
              value={rateOverride}
              onChange={(e) => setRateOverride(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="note">{c.note}</Label>
            <Input
              id="note"
              value={note}
              maxLength={300}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
        </div>

        <FieldError>{error}</FieldError>

        <Button onClick={save} disabled={busy || !date || !resortId} className="self-start">
          {busy && <Loader2 className="animate-spin" aria-hidden />}
          {c.add}
        </Button>
      </Card>

      <Card className="space-y-3">
        <CardTitle>{c.existing}</CardTitle>
        {initialDays.length === 0 ? (
          <CardDescription>{c.none}</CardDescription>
        ) : (
          <ul className="divide-y divide-border">
            {initialDays.map((day) => (
              <li
                key={day.id}
                className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm"
              >
                <div className="space-y-0.5">
                  <p className="font-medium">
                    {day.date} · {day.resortName}
                  </p>
                  <p className="text-muted-foreground">
                    {String(day.startHour).padStart(2, "0")}:00–
                    {String(day.endHour).padStart(2, "0")}:00
                    {day.breakStartHour != null &&
                      ` · ${String(day.breakStartHour).padStart(2, "0")}:00–${String(day.breakEndHour).padStart(2, "0")}:00 ${locale === "zh" ? "午休" : "break"}`}
                    {day.hourlyRateCentsOverride != null &&
                      ` · ${formatMoneyShort(day.hourlyRateCentsOverride)}/h`}
                  </p>
                  {day.note && (
                    <p className="text-xs text-muted-foreground">{day.note}</p>
                  )}
                </div>

                <div className="flex items-center gap-3">
                  {day.bookingCount > 0 && (
                    <span className="rounded-full border border-ice-500/40 bg-ice-500/10 px-2.5 py-1 text-xs">
                      {c.booked.replace("{n}", String(day.bookingCount))}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => remove(day)}
                    disabled={busy || day.bookingCount > 0}
                    aria-label={c.remove}
                    title={day.bookingCount > 0 ? c.hasBookings : c.remove}
                    className="rounded-lg p-2 text-red-600 hover:bg-surface-muted disabled:opacity-30 dark:text-red-400"
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
