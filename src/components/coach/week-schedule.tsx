import { CalendarDays } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";
import { clock, hourRange, placeInWeek, weekDays, type Placed } from "@/lib/week-schedule";
import type { DateKey } from "@/lib/time";

/** One lesson as the workbench shows it. */
export type ScheduleLesson = {
  id: string;
  code: string;
  start: Date;
  end: Date;
  student: string;
  headcount: number;
  resort: string;
  lessonType: string;
  /** Booked, but the payment is still being checked. */
  pending: boolean;
  /** What the student wants to learn, already in the page's language. */
  skills: string[];
  level: string | null;
  notes: string | null;
};

const WEEKDAYS_ZH = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
const WEEKDAYS_EN = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const HOUR_REM = 3;

const monthDay = (dateKey: DateKey) => `${Number(dateKey.slice(5, 7))}/${Number(dateKey.slice(8, 10))}`;

/** The week as a timetable: a column a day, an hour a row, each lesson a block from its start to its end. */
export function WeekSchedule({ lessons, weekStart, todayKey, nowMinutes, zh }: {
  lessons: ScheduleLesson[]; weekStart: DateKey; todayKey: DateKey; nowMinutes: number; zh: boolean;
}) {
  const days = weekDays(weekStart);
  const placed = placeInWeek(lessons, weekStart);
  const { first, last } = hourRange(placed);
  const span = (last - first) * 60;
  const hours = Array.from({ length: last - first + 1 }, (_, i) => first + i);
  const at = (minutes: number) => `${((minutes - first * 60) / span) * 100}%`;
  const todayIndex = days.indexOf(todayKey);
  return (
    <div className="overflow-x-auto rounded-2xl border border-border bg-surface">
      <div className="grid min-w-[40rem]" style={{ gridTemplateColumns: "3rem repeat(7, minmax(0, 1fr))" }}>
        <div className="border-b border-border" />
        {days.map((day, i) => (
          <div key={day} className={cn("border-b border-l border-border px-1 py-2 text-center text-xs",
            i === todayIndex ? "bg-accent-soft font-semibold text-accent" : "text-ink-2")}>
            <div>{zh ? WEEKDAYS_ZH[i] : WEEKDAYS_EN[i]}</div>
            <div className="tabular-nums">{monthDay(day)}</div>
          </div>
        ))}
        <div className="relative" style={{ height: `${(last - first) * HOUR_REM}rem` }} aria-hidden>
          {hours.slice(0, -1).map((hour) => (
            <span key={hour} className="absolute right-1.5 -translate-y-1/2 text-[11px] tabular-nums text-ink-3" style={{ top: at(hour * 60) }}>
              {hour === first ? "" : `${hour}:00`}
            </span>
          ))}
        </div>
        {days.map((day, i) => (
          <div key={day} className={cn("relative border-l border-border", i === todayIndex && "bg-accent-soft/40")}
            style={{ height: `${(last - first) * HOUR_REM}rem` }}>
            {hours.slice(1, -1).map((hour) => <div key={hour} className="absolute inset-x-0 border-t border-border/60" style={{ top: at(hour * 60) }} />)}
            {placed.filter((lesson) => lesson.day === i).map((lesson) => <WeekBlock key={lesson.id} lesson={lesson} at={at} zh={zh} />)}
            {i === todayIndex && nowMinutes > first * 60 && nowMinutes < last * 60 && (
              <div className="pointer-events-none absolute inset-x-0 z-10 border-t-2 border-danger" style={{ top: at(nowMinutes) }}
                aria-label={zh ? `现在 ${clock(nowMinutes)}` : `Now, ${clock(nowMinutes)}`} />
            )}
          </div>
        ))}
      </div>
      {placed.length === 0 && <p className="border-t border-border px-4 py-3 text-sm text-ink-3">{zh ? "本周还没有课。" : "No lessons this week yet."}</p>}
    </div>
  );
}

function WeekBlock({ lesson, at, zh }: { lesson: Placed<ScheduleLesson>; at: (minutes: number) => string; zh: boolean }) {
  const width = 100 / lesson.lanes;
  const time = `${clock(lesson.from)}–${clock(lesson.to)}`;
  return (
    <Link href={`/booking/${lesson.code}`}
      title={`${time} ${lesson.student}${lesson.skills.length ? ` · ${lesson.skills.join(zh ? "、" : ", ")}` : ""}`}
      className={cn("absolute z-0 overflow-hidden rounded-md border px-1 py-0.5 text-[11px] leading-tight hover:z-20 hover:shadow-md",
        lesson.pending ? "border-[var(--pill-checking-br)] bg-[var(--pill-checking-bg)] text-[var(--pill-checking-fg)]"
          : "border-accent/40 bg-accent-soft text-ink")}
      style={{ top: at(lesson.from), height: `calc(${at(lesson.to)} - ${at(lesson.from)})`, left: `calc(${lesson.lane * width}% + 2px)`, width: `calc(${width}% - 4px)` }}>
      <span className="block font-semibold tabular-nums">{time}</span>
      <span className="block truncate">{lesson.student}{lesson.headcount > 1 ? ` · ${lesson.headcount}${zh ? " 人" : ""}` : ""}</span>
      <span className="block truncate text-ink-3">{lesson.resort}</span>
    </Link>
  );
}

/** Today's lessons in order: when, who, where and what they want to learn. */
export function TodayLessons({ lessons, nowMinutes, zh, typeLabel }: {
  lessons: (ScheduleLesson & { from: number; to: number })[]; nowMinutes: number; zh: boolean; typeLabel: (lessonType: string) => string;
}) {
  if (lessons.length === 0) return <EmptyState icon={<CalendarDays aria-hidden />} title={zh ? "今天没有课。" : "No lessons today."} />;
  return (
    <ol className="space-y-2">
      {lessons.map((lesson) => {
        const now = nowMinutes >= lesson.from && nowMinutes < lesson.to, over = nowMinutes >= lesson.to;
        const hours = (lesson.to - lesson.from) / 60;
        return (
          <li key={lesson.id}>
            <Link href={`/booking/${lesson.code}`}
              className={cn("lift flex gap-4 rounded-2xl border bg-surface p-4", now ? "border-accent" : "border-border", over && "opacity-70")}>
              <div className="w-20 shrink-0">
                <p className="text-lg font-semibold tabular-nums text-ink">{clock(lesson.from)}</p>
                <p className="text-sm tabular-nums text-ink-3">– {clock(lesson.to)}</p>
                <p className="mt-1 text-xs text-ink-3">{zh ? `${hours} 小时` : `${hours} h`}</p>
              </div>
              <div className="min-w-0 flex-1 space-y-1 text-sm">
                <p className="flex flex-wrap items-center gap-2 text-base font-semibold text-ink">
                  {lesson.student}
                  {lesson.headcount > 1 && <span className="text-sm font-normal text-ink-2">{zh ? `共 ${lesson.headcount} 人` : `${lesson.headcount} people`}</span>}
                  {now && <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-semibold text-accent-foreground">{zh ? "进行中" : "Now"}</span>}
                  {over && <span className="text-xs font-normal text-ink-3">{zh ? "已结束" : "Finished"}</span>}
                  {lesson.pending && <span className="rounded-full border border-[var(--pill-checking-br)] bg-[var(--pill-checking-bg)] px-2 py-0.5 text-xs font-semibold text-[var(--pill-checking-fg)]">
                    {zh ? "付款待核对" : "Payment to check"}</span>}
                </p>
                <p className="text-ink-2">{lesson.resort} · {typeLabel(lesson.lessonType)}</p>
                <p className="text-ink-2"><span className="text-ink-3">{zh ? "想学：" : "Wants to learn: "}</span>
                  {lesson.skills.length ? lesson.skills.join(zh ? "、" : ", ") : <span className="text-ink-3">{zh ? "没有填写" : "not given"}</span>}</p>
                {lesson.level && <p className="text-ink-2"><span className="text-ink-3">{zh ? "水平：" : "Ability: "}</span>{lesson.level}</p>}
                {lesson.notes && <p className="line-clamp-3 whitespace-pre-line text-ink-2"><span className="text-ink-3">{zh ? "备注：" : "Note: "}</span>{lesson.notes}</p>}
              </div>
            </Link>
          </li>
        );
      })}
    </ol>
  );
}
