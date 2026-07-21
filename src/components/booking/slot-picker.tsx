"use client";

import { useMemo, useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FieldError, Label, Select } from "@/components/ui/field";
import { PriceBreakdown } from "./price-breakdown";
import { AddParticipantDialog } from "./add-participant-dialog";
import { quote, lessonWindow } from "@/lib/pricing";
import { formatTorontoDate, formatTorontoTime } from "@/lib/time";
import type { Locale } from "@/i18n/routing";
import type { HourStatus } from "@/lib/slots";
import { cn } from "@/lib/utils";
import { Loader2, MessageCircle } from "lucide-react";

type Cell = { hour: number; status: HourStatus; startIso: string };
type Day = {
  dateKey: string;
  hourlyRateCents: number;
  handoverDiscountCents: number;
  note: string | null;
  cells: Cell[];
  startOptions: { hour: number; durations: number[] }[];
};
type Participant = {
  id: string;
  fullName: string;
  birthDate: string;
  isSelf: boolean;
  isMinorToday: boolean;
};

const COPY = {
  zh: {
    pickDay: "选择日期",
    pickTime: "选择开始时间",
    duration: "时长",
    hours: "小时",
    participant: "上课学员",
    addParticipant: "添加学员",
    noDays: "该雪场暂时没有可预定的日子。",
    noSlots: "这一天已经约满了。",
    review: "确认并预定",
    legend: {
      available: "可选",
      booked: "已约满",
      break: "午休",
      past: "已过时",
      "lead-time": "太临近",
    },
    otherTimes: "想约其他时间?微信联系教练",
    handoverNote:
      "首尾各留 5 分钟与下一位学员交接,因此实际授课比预定时段少 10 分钟。",
    lessonRuns: "实际授课",
    minutes: "分钟",
    needParticipant: "请选择上课学员",
    slotTaken: "抱歉,该时段刚被他人预定,请另选时间。",
    failed: "预定失败,请重试。",
  },
  en: {
    pickDay: "Choose a day",
    pickTime: "Choose a start time",
    duration: "Duration",
    hours: "hours",
    participant: "Who is taking the lesson",
    addParticipant: "Add participant",
    noDays: "No days are open at this resort yet.",
    noSlots: "This day is fully booked.",
    review: "Review and book",
    legend: {
      available: "Available",
      booked: "Booked",
      break: "Lunch",
      past: "Past",
      "lead-time": "Too soon",
    },
    otherTimes: "Want a different time? Message the coach on WeChat",
    handoverNote:
      "Five minutes at each end are the handover to the next student, so teaching time is 10 minutes shorter than the booked block.",
    lessonRuns: "Lesson runs",
    minutes: "min",
    needParticipant: "Please choose who is taking the lesson",
    slotTaken: "Sorry — someone just took that slot. Please pick another time.",
    failed: "Could not create the booking. Please try again.",
  },
} as const;

export function SlotPicker({
  locale,
  coachId,
  coachName,
  coachWechat,
  resortName,
  minHours,
  days,
  participants: initialParticipants,
}: {
  locale: Locale;
  coachId: string;
  coachName: string;
  coachWechat: string | null;
  resortName: string;
  minHours: number;
  days: Day[];
  participants: Participant[];
}) {
  const router = useRouter();
  const c = COPY[locale];

  const [participants, setParticipants] = useState(initialParticipants);
  const [dateKey, setDateKey] = useState(days[0]?.dateKey ?? "");
  const [startHour, setStartHour] = useState<number | null>(null);
  const [hours, setHours] = useState<number>(minHours);
  const [participantId, setParticipantId] = useState(
    initialParticipants.find((p) => p.isSelf)?.id ?? "",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const day = useMemo(
    () => days.find((d) => d.dateKey === dateKey),
    [days, dateKey],
  );
  const option = day?.startOptions.find((o) => o.hour === startHour);

  const priced =
    day && option
      ? quote({
          hours,
          hourlyRateCents: day.hourlyRateCents,
          handoverDiscountCents: day.handoverDiscountCents,
        })
      : null;

  const window =
    day && startHour != null
      ? lessonWindow(
          new Date(day.cells.find((x) => x.hour === startHour)!.startIso),
          new Date(
            new Date(
              day.cells.find((x) => x.hour === startHour)!.startIso,
            ).getTime() +
              hours * 3_600_000,
          ),
        )
      : null;

  function selectStart(hour: number) {
    setStartHour(hour);
    setError(null);
    const opt = day?.startOptions.find((o) => o.hour === hour);
    // Keep the current duration if it is still legal, else fall back to the
    // shortest one this start allows.
    if (opt && !opt.durations.includes(hours)) setHours(opt.durations[0]);
  }

  async function submit() {
    if (!participantId) {
      setError(c.needParticipant);
      return;
    }
    if (startHour == null || !day) return;

    setBusy(true);
    setError(null);
    const res = await fetch("/api/bookings", {
      method: "POST",
      headers: { "content-type": "application/json", "x-locale": locale },
      body: JSON.stringify({
        coachId,
        date: day.dateKey,
        startHour,
        hours,
        participantId,
      }),
    });
    setBusy(false);

    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error === "slot-taken" ? c.slotTaken : c.failed);
      router.refresh();
      return;
    }

    const { code } = (await res.json()) as { code: string };
    router.push(`/booking/${code}`);
  }

  if (days.length === 0) {
    return (
      <Card>
        <CardDescription>{c.noDays}</CardDescription>
        {coachWechat && (
          <p className="mt-2 flex items-center gap-1.5 text-sm">
            <MessageCircle className="size-4" aria-hidden />
            {c.otherTimes} <strong>{coachWechat}</strong>
          </p>
        )}
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm text-muted-foreground">
          {resortName} · {coachName}
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">{c.pickTime}</h1>
      </div>

      <Card className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="day">{c.pickDay}</Label>
          <Select
            id="day"
            value={dateKey}
            onChange={(e) => {
              setDateKey(e.target.value);
              setStartHour(null);
            }}
          >
            {days.map((d) => (
              <option key={d.dateKey} value={d.dateKey}>
                {formatTorontoDate(new Date(`${d.dateKey}T12:00:00Z`), locale)}
              </option>
            ))}
          </Select>
        </div>

        {day && (
          <>
            <HourGrid
              day={day}
              locale={locale}
              selected={startHour}
              onSelect={selectStart}
              legend={c.legend}
            />

            {day.startOptions.length === 0 && (
              <p className="text-sm text-muted-foreground">{c.noSlots}</p>
            )}

            {option && (
              <div className="space-y-1.5">
                <Label htmlFor="hours">{c.duration}</Label>
                <Select
                  id="hours"
                  value={hours}
                  onChange={(e) => setHours(Number(e.target.value))}
                >
                  {option.durations.map((d) => (
                    <option key={d} value={d}>
                      {d} {c.hours}
                    </option>
                  ))}
                </Select>
              </div>
            )}
          </>
        )}

        {coachWechat && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <MessageCircle className="size-3.5" aria-hidden />
            {c.otherTimes} <strong>{coachWechat}</strong>
          </p>
        )}
      </Card>

      {priced && window && (
        <Card className="space-y-4">
          <CardTitle>{c.review}</CardTitle>

          <p className="rounded-lg bg-surface-muted p-3 text-sm">
            <strong>
              {c.lessonRuns} {formatTorontoTime(window.lessonStartAt, locale)} –{" "}
              {formatTorontoTime(window.lessonEndAt, locale)}
            </strong>{" "}
            ({priced.lessonMinutes} {c.minutes})
            <br />
            <span className="text-muted-foreground">{c.handoverNote}</span>
          </p>

          <PriceBreakdown quote={priced} locale={locale} />

          <div className="space-y-1.5">
            <Label htmlFor="participant">{c.participant}</Label>
            <div className="flex flex-wrap items-center gap-2">
              <Select
                id="participant"
                className="max-w-xs"
                value={participantId}
                onChange={(e) => setParticipantId(e.target.value)}
              >
                <option value="">—</option>
                {participants.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.isSelf
                      ? locale === "zh"
                        ? `我自己(${p.fullName})`
                        : `Myself (${p.fullName})`
                      : p.fullName}
                  </option>
                ))}
              </Select>
              <AddParticipantDialog
                locale={locale}
                label={c.addParticipant}
                hasSelf={participants.some((p) => p.isSelf)}
                onAdded={(p) => {
                  setParticipants((list) => [...list, p]);
                  setParticipantId(p.id);
                }}
              />
            </div>
          </div>

          <FieldError>{error}</FieldError>

          <Button onClick={submit} disabled={busy} className="self-start">
            {busy && <Loader2 className="animate-spin" aria-hidden />}
            {c.review}
          </Button>
        </Card>
      )}
    </div>
  );
}

/**
 * The hour grid is a radio group of buttons, not a table of divs: it has to be
 * reachable and operable by keyboard, and screen readers need to hear which
 * hours are unavailable and why.
 */
function HourGrid({
  day,
  locale,
  selected,
  onSelect,
  legend,
}: {
  day: Day;
  locale: Locale;
  selected: number | null;
  onSelect: (hour: number) => void;
  legend: Record<HourStatus, string>;
}) {
  const bookable = new Set(day.startOptions.map((o) => o.hour));

  return (
    <div className="space-y-2">
      <div
        role="group"
        aria-label={locale === "zh" ? "可选时段" : "Available start times"}
        className="grid grid-cols-3 gap-2 sm:grid-cols-4"
      >
        {day.cells.map((cell) => {
          const selectable = bookable.has(cell.hour);
          const isSelected = selected === cell.hour;
          const label = `${String(cell.hour).padStart(2, "0")}:00`;

          return (
            <button
              key={cell.hour}
              type="button"
              disabled={!selectable}
              aria-pressed={isSelected}
              onClick={() => onSelect(cell.hour)}
              className={cn(
                "flex min-h-14 flex-col items-center justify-center rounded-lg border text-sm transition-colors",
                isSelected
                  ? "border-accent bg-accent text-accent-foreground"
                  : selectable
                    ? "border-border bg-surface hover:border-ice-400"
                    : "cursor-not-allowed border-border bg-surface-muted text-muted-foreground",
              )}
            >
              <span className="font-medium">{label}</span>
              {!selectable && (
                <span className="text-[11px]">{legend[cell.status]}</span>
              )}
            </button>
          );
        })}
      </div>
      {day.note && (
        <p className="text-xs text-muted-foreground">{day.note}</p>
      )}
    </div>
  );
}
