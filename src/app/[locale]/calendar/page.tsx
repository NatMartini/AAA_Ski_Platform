import { setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { prisma } from "@/lib/prisma";
import { requireUserPage } from "@/lib/auth/require-user";
import { Card, CardDescription } from "@/components/ui/card";
import { StatusPill } from "@/components/ui/status-pill";
import { OCCUPYING_STATUSES } from "@/lib/booking/state";
import { canAcceptBookings, rulesFor } from "@/lib/coach";
import {
  daySegments,
  hhmm,
  torontoHours,
  weekDays,
  weekStart,
  type Segment,
} from "@/lib/calendar";
import { lessonTypeLabel } from "@/lib/lesson-types";
import {
  addDaysToDateKey,
  dateKeyToDbDate,
  dbDateToDateKey,
  isDateKey,
  toDateKey,
  type DateKey,
} from "@/lib/time";
import { toLocale, type Locale } from "@/i18n/routing";
import { cn } from "@/lib/utils";
import { ChevronLeft, ChevronRight } from "lucide-react";

const COPY = {
  zh: {
    title: "教练日历",
    intro: "每位教练哪天在哪个雪场、什么时间在上课,所有人都能看到。",
    handover: "开课时间是整点后 10 分钟:前 10 分钟是和上一位学员的交接。",
    namesHidden: "学员姓名只有教练能看到。",
    prev: "上一周",
    next: "下一周",
    thisWeek: "回到本周",
    today: "今天",
    noCoach: "没有教练出勤",
    lesson: "上课",
    open: "可约",
    lunch: "午休",
    booked: "已约",
    yours: "你的课",
    bookDay: "约这天",
    oneOnN: "1 对 {n}",
    empty: "这一周还没有教练开放日期。",
  },
  en: {
    title: "Coach calendar",
    intro: "Where each coach is and when they are teaching, visible to everyone.",
    handover:
      "Lessons start ten minutes past the hour: the first ten minutes are the handover from the previous student.",
    namesHidden: "Only coaches can see students' names.",
    prev: "Previous week",
    next: "Next week",
    thisWeek: "This week",
    today: "Today",
    noCoach: "No coach working",
    lesson: "Lesson",
    open: "Bookable",
    lunch: "Lunch",
    booked: "Booked",
    yours: "Your lesson",
    bookDay: "Book this day",
    oneOnN: "1-on-{n}",
    empty: "No coach has opened any days this week yet.",
  },
} as const;

/** Lessons that still hold the time, plus the ones already taught. */
const SHOWN_STATUSES = [...OCCUPYING_STATUSES, "COMPLETED" as const];

/**
 * The shared week timetable. Every signed-in user sees every coach's days and
 * lessons — the site is run by two coaches who keep one set of books — but a
 * student sees other students' lessons only as "booked", without a name.
 */
export default async function CalendarPage({
  params,
  searchParams,
}: PageProps<"/[locale]/calendar">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await requireUserPage({
    locale,
    callbackPath: `/${locale}/calendar`,
  });

  const loc = toLocale(locale);
  const c = COPY[loc];
  const isCoach = user.role === "COACH" || user.role === "ADMIN";
  const now = new Date();
  const today = toDateKey(now);
  const thisWeek = weekStart(today);

  const { week: asked } = await searchParams;
  const monday =
    typeof asked === "string" && isDateKey(asked)
      ? weekStart(asked)
      : await defaultWeek(thisWeek, today);
  const dates = weekDays(monday);

  const [profiles, days] = await Promise.all([
    // The same order as the stats page, so a coach keeps their colour.
    prisma.coachProfile.findMany({
      include: { rates: true },
      orderBy: [{ displayName: "asc" }, { createdAt: "asc" }],
    }),
    prisma.coachDay.findMany({
      where: {
        date: {
          gte: dateKeyToDbDate(dates[0]),
          lte: dateKeyToDbDate(dates[6]),
        },
      },
      select: {
        id: true,
        coachId: true,
        date: true,
        startHour: true,
        endHour: true,
        breakStartHour: true,
        breakEndHour: true,
        resort: { select: { slug: true, nameEn: true, nameZh: true } },
      },
    }),
  ]);
  const bookings = await prisma.booking.findMany({
    where: {
      coachDayId: { in: days.map((d) => d.id) },
      status: { in: SHOWN_STATUSES },
    },
    select: {
      id: true,
      code: true,
      coachDayId: true,
      accountId: true,
      status: true,
      startAt: true,
      endAt: true,
      lessonStartAt: true,
      lessonEndAt: true,
      lessonType: true,
      headcount: true,
      participantNameSnapshot: true,
      inviteName: true,
      participant: { select: { fullName: true } },
    },
    orderBy: { startAt: "asc" },
  });

  const coachIndex = new Map(profiles.map((p, i) => [p.userId, i]));
  const profileOf = new Map(profiles.map((p) => [p.userId, p]));
  const lessonsByDay = new Map<string, typeof bookings>();
  for (const b of bookings) {
    lessonsByDay.set(b.coachDayId, [...(lessonsByDay.get(b.coachDayId) ?? []), b]);
  }

  type Lesson = (typeof bookings)[number];
  const rows = days
    .filter((d) => profileOf.has(d.coachId))
    .map((d) => {
      const profile = profileOf.get(d.coachId)!;
      const dateKey = dbDateToDateKey(d.date);
      const lessons = lessonsByDay.get(d.id) ?? [];
      const segments = daySegments<Lesson>(
        {
          dateKey,
          startHour: d.startHour,
          endHour: d.endHour,
          breakStartHour: d.breakStartHour,
          breakEndHour: d.breakEndHour,
        },
        lessons,
        now,
        rulesFor(profile),
      );
      return {
        id: d.id,
        dateKey,
        coachId: d.coachId,
        coachName: profile.displayName,
        colour: `var(--series-${((coachIndex.get(d.coachId) ?? 0) % 8) + 1})`,
        resort: d.resort,
        startHour: d.startHour,
        endHour: d.endHour,
        segments,
        canBook:
          !isCoach &&
          canAcceptBookings(profile) &&
          segments.some((s) => s.kind === "open" && s.bookable),
      };
    })
    .sort(
      (a, b) =>
        (coachIndex.get(a.coachId) ?? 0) - (coachIndex.get(b.coachId) ?? 0),
    );

  // One time axis for the whole week, so the same hour lines up on every day.
  const axisStart = Math.min(
    9,
    ...rows.map((r) => r.startHour),
    ...bookings.map((b) => Math.floor(torontoHours(b.startAt))),
  );
  const axisEnd = Math.max(
    16,
    ...rows.map((r) => r.endHour),
    ...bookings.map((b) => Math.ceil(torontoHours(b.endAt))),
  );
  const axis = { start: axisStart, end: axisEnd };
  const hours = Array.from(
    { length: axisEnd - axisStart + 1 },
    (_, i) => axisStart + i,
  );
  // Every hour fits on a phone for a normal ski day; a long one gets every other.
  const labelEvery = hours.length > 10 ? 2 : 1;

  const coachesThisWeek = profiles.filter((p) =>
    rows.some((r) => r.coachId === p.userId),
  );

  return (
    <div className="stagger space-y-5">
      <div className="space-y-1.5">
        <h1 className="text-3xl">{c.title}</h1>
        <p className="text-sm text-ink-2">{c.intro}</p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1.5">
          <WeekLink week={addDaysToDateKey(monday, -7)} label={c.prev}>
            <ChevronLeft className="size-4" aria-hidden />
          </WeekLink>
          <p className="min-w-40 text-center font-display text-base font-bold tabular-nums">
            {weekLabel(dates[0], dates[6], loc)}
          </p>
          <WeekLink week={addDaysToDateKey(monday, 7)} label={c.next}>
            <ChevronRight className="size-4" aria-hidden />
          </WeekLink>
        </div>
        {monday !== thisWeek && (
          <Link
            href={`/calendar?week=${thisWeek}`}
            className="press rounded-lg border border-border px-3 py-1.5 text-sm font-semibold text-ink-2 hover:border-accent hover:text-ink"
          >
            {c.thisWeek}
          </Link>
        )}
      </div>

      <Legend
        coaches={coachesThisWeek.map((p) => ({
          id: p.userId,
          name: p.displayName,
          colour: `var(--series-${((coachIndex.get(p.userId) ?? 0) % 8) + 1})`,
        }))}
        labels={c}
      />

      <Card className="p-0 sm:p-0">
        {/* Hour axis, aligned with every timeline below it. */}
        <div className="grid gap-x-4 border-b border-border px-4 pb-1.5 pt-3 sm:grid-cols-[7rem_1fr] sm:px-5">
          <span className="hidden sm:block" />
          <div aria-hidden className="relative h-4 text-[11px] text-ink-3 tabular-nums">
            {hours.map((h, i) =>
              i % labelEvery === 0 ? (
                <span
                  key={h}
                  className="absolute -translate-x-1/2"
                  style={{
                    left: `${pct(h, axis)}%`,
                    // Keep the first and last label inside the card.
                    transform:
                      i === 0
                        ? "none"
                        : i === hours.length - 1
                          ? "translateX(-100%)"
                          : undefined,
                  }}
                >
                  {String(h).padStart(2, "0")}
                </span>
              ) : null,
            )}
          </div>
        </div>

        {dates.map((dateKey) => {
          const dayRows = rows.filter((r) => r.dateKey === dateKey);
          const isToday = dateKey === today;
          return (
            <section
              key={dateKey}
              aria-label={dayLabel(dateKey, loc)}
              className={cn(
                "grid gap-x-4 gap-y-2 border-b border-border px-4 py-3 last:border-0 sm:grid-cols-[7rem_1fr] sm:px-5",
                isToday && "bg-[var(--accent-soft)]/40",
              )}
            >
              <h2 className="flex items-baseline gap-2 text-sm font-bold sm:flex-col sm:gap-0.5">
                <span className={isToday ? "text-accent" : "text-ink"}>
                  {dayLabel(dateKey, loc)}
                </span>
                {isToday && (
                  <span className="text-[11px] font-bold text-accent">
                    {c.today}
                  </span>
                )}
              </h2>

              {dayRows.length === 0 ? (
                <p className="self-center text-sm text-ink-3">{c.noCoach}</p>
              ) : (
                <div className="space-y-3.5">
                  {dayRows.map((r) => (
                    <div key={r.id} className="space-y-1.5">
                      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-sm">
                        <span className="flex min-w-0 items-center gap-1.5">
                          <span
                            aria-hidden
                            className="inline-block size-2.5 shrink-0 rounded-[3px]"
                            style={{ background: r.colour }}
                          />
                          <strong>{r.coachName}</strong>
                          <span className="text-ink-2">
                            · {loc === "zh" ? r.resort.nameZh : r.resort.nameEn} ·{" "}
                            <span className="tabular-nums">
                              {pad(r.startHour)}:00–{pad(r.endHour)}:00
                            </span>
                          </span>
                        </span>
                        {r.canBook && (
                          <Link
                            href={`/book/${r.resort.slug}/${r.coachId}?date=${dateKey}`}
                            className="text-xs font-bold text-accent underline underline-offset-2"
                          >
                            {c.bookDay} →
                          </Link>
                        )}
                      </div>

                      <Timeline
                        segments={r.segments}
                        axis={axis}
                        hours={hours}
                        colour={r.colour}
                      />

                      <ul className="space-y-1 text-xs">
                        {r.segments.map((s) => (
                          <SegmentRow
                            key={`${s.kind}-${s.startAt.toISOString()}`}
                            segment={s}
                            locale={loc}
                            labels={c}
                            viewerId={user.id}
                            isCoach={isCoach}
                          />
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </Card>

      {rows.length === 0 && (
        <CardDescription className="text-center">{c.empty}</CardDescription>
      )}

      <div className="space-y-1 text-xs text-ink-3">
        <p>{c.handover}</p>
        {!isCoach && <p>{c.namesHidden}</p>}
      </div>
    </div>
  );
}

/**
 * The current week, unless nobody is on this week and someone is later — off
 * season the page would otherwise open on an empty week every time.
 */
async function defaultWeek(thisWeek: DateKey, today: DateKey): Promise<DateKey> {
  const onThisWeek = await prisma.coachDay.count({
    where: {
      date: {
        gte: dateKeyToDbDate(thisWeek),
        lte: dateKeyToDbDate(addDaysToDateKey(thisWeek, 6)),
      },
    },
  });
  if (onThisWeek > 0) return thisWeek;
  const next = await prisma.coachDay.findFirst({
    where: { date: { gte: dateKeyToDbDate(today) } },
    orderBy: { date: "asc" },
    select: { date: true },
  });
  return next ? weekStart(dbDateToDateKey(next.date)) : thisWeek;
}

type Axis = { start: number; end: number };

function pct(hour: number, axis: Axis): number {
  return ((hour - axis.start) / (axis.end - axis.start)) * 100;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

type LessonRow = {
  code: string;
  accountId: string | null;
  status: Parameters<typeof StatusPill>[0]["status"];
  startAt: Date;
  endAt: Date;
  lessonStartAt: Date;
  lessonEndAt: Date;
  lessonType: string;
  headcount: number;
  participantNameSnapshot: string | null;
  inviteName: string | null;
  participant: { fullName: string } | null;
};

/**
 * The day drawn to scale. Decorative: every block is also listed in words
 * underneath, so nothing here is conveyed by colour or position alone.
 */
function Timeline({
  segments,
  axis,
  hours,
  colour,
}: {
  segments: Segment<LessonRow>[];
  axis: Axis;
  hours: number[];
  colour: string;
}) {
  return (
    <div aria-hidden className="relative h-6">
      {hours.map((h) => (
        <span
          key={h}
          className="absolute inset-y-0 w-px bg-[var(--chart-grid)]"
          style={{ left: `${pct(h, axis)}%` }}
        />
      ))}
      {segments.map((s) => {
        // A lesson is drawn from ten past, so the handover shows as a sliver.
        const from = torontoHours(s.kind === "lesson" ? s.lesson.lessonStartAt : s.startAt);
        const to = torontoHours(s.kind === "lesson" ? s.lesson.lessonEndAt : s.endAt);
        const style = {
          left: `${pct(from, axis)}%`,
          width: `${pct(to, axis) - pct(from, axis)}%`,
        };
        const key = `${s.kind}-${s.startAt.toISOString()}`;
        if (s.kind === "lesson") {
          return (
            <span
              key={key}
              className="absolute inset-y-0 rounded-[4px]"
              style={{ ...style, background: colour }}
            />
          );
        }
        if (s.kind === "open" && s.bookable) {
          return (
            <span
              key={key}
              className="absolute inset-y-0.5 rounded-[4px] border border-dashed border-accent bg-[var(--accent-soft)]"
              style={style}
            />
          );
        }
        if (s.kind === "break") {
          return (
            <span
              key={key}
              className="absolute inset-y-0.5 rounded-[4px]"
              style={{
                ...style,
                background:
                  "repeating-linear-gradient(135deg, var(--border) 0 3px, transparent 3px 7px)",
              }}
            />
          );
        }
        // Open but too short or too soon to book: the coach is there, so it
        // still reads as part of the day.
        return (
          <span
            key={key}
            className="absolute inset-y-1.5 rounded-[3px] bg-surface-2"
            style={style}
          />
        );
      })}
    </div>
  );
}

function SegmentRow({
  segment: s,
  locale,
  labels,
  viewerId,
  isCoach,
}: {
  segment: Segment<LessonRow>;
  locale: Locale;
  labels: (typeof COPY)[Locale];
  viewerId: string;
  isCoach: boolean;
}) {
  if (s.kind === "lesson") {
    const b = s.lesson;
    const own = b.accountId === viewerId;
    const student =
      b.participantNameSnapshot ?? b.participant?.fullName ?? b.inviteName ?? "—";
    const detail = [
      lessonTypeLabel(b.lessonType, locale),
      b.headcount > 1 ? labels.oneOnN.replace("{n}", String(b.headcount)) : null,
    ]
      .filter(Boolean)
      .join(" · ");
    return (
      <li className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-semibold tabular-nums text-ink">
          {hhmm(b.lessonStartAt)}–{hhmm(b.lessonEndAt)}
        </span>
        {isCoach ? (
          <span className="text-ink">
            {student} <span className="text-ink-2">· {detail}</span>
          </span>
        ) : (
          <span className="text-ink-2">{own ? labels.yours : labels.booked}</span>
        )}
        {isCoach && <StatusPill status={b.status} locale={locale} className="px-2 py-0.5" />}
        {(isCoach || own) && (
          <Link
            href={`/booking/${b.code}`}
            className="font-mono font-bold text-accent underline underline-offset-2"
          >
            {b.code}
          </Link>
        )}
      </li>
    );
  }
  if (s.kind === "open" && s.bookable) {
    return (
      <li className="flex gap-2">
        <span className="tabular-nums text-ink-2">
          {hhmm(s.startAt)}–{hhmm(s.endAt)}
        </span>
        <span className="font-semibold text-accent">{labels.open}</span>
      </li>
    );
  }
  if (s.kind === "break") {
    return (
      <li className="flex gap-2 text-ink-3">
        <span className="tabular-nums">
          {hhmm(s.startAt)}–{hhmm(s.endAt)}
        </span>
        <span>{labels.lunch}</span>
      </li>
    );
  }
  return null;
}

function Legend({
  coaches,
  labels,
}: {
  coaches: { id: string; name: string; colour: string }[];
  labels: (typeof COPY)[Locale];
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-ink-2">
      {coaches.map((coach) => (
        <span key={coach.id} className="inline-flex items-center gap-1.5">
          <span
            aria-hidden
            className="inline-block h-3 w-5 rounded-[3px]"
            style={{ background: coach.colour }}
          />
          {coach.name} · {labels.lesson}
        </span>
      ))}
      <span className="inline-flex items-center gap-1.5">
        <span
          aria-hidden
          className="inline-block h-3 w-5 rounded-[3px] border border-dashed border-accent bg-[var(--accent-soft)]"
        />
        {labels.open}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span
          aria-hidden
          className="inline-block h-3 w-5 rounded-[3px]"
          style={{
            background:
              "repeating-linear-gradient(135deg, var(--border) 0 3px, transparent 3px 7px)",
          }}
        />
        {labels.lunch}
      </span>
    </div>
  );
}

function WeekLink({
  week,
  label,
  children,
}: {
  week: DateKey;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={`/calendar?week=${week}`}
      aria-label={label}
      title={label}
      className="press flex size-9 items-center justify-center rounded-lg border border-border text-ink-2 hover:border-accent hover:text-ink"
    >
      {children}
    </Link>
  );
}

/** "周一 12月7日" / "Mon, Dec 7". Date keys are formatted as UTC dates. */
function dayLabel(dateKey: DateKey, locale: Locale): string {
  const d = dateKeyToDbDate(dateKey);
  if (locale === "zh") {
    const weekday = new Intl.DateTimeFormat("zh-CN", {
      weekday: "short",
      timeZone: "UTC",
    }).format(d);
    return `${weekday} ${d.getUTCMonth() + 1}月${d.getUTCDate()}日`;
  }
  return new Intl.DateTimeFormat("en-CA", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(d);
}

function weekLabel(from: DateKey, to: DateKey, locale: Locale): string {
  const a = dateKeyToDbDate(from);
  const b = dateKeyToDbDate(to);
  if (locale === "zh") {
    return `${a.getUTCFullYear()} 年 ${a.getUTCMonth() + 1}月${a.getUTCDate()}日 – ${b.getUTCMonth() + 1}月${b.getUTCDate()}日`;
  }
  const f = new Intl.DateTimeFormat("en-CA", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  return `${f.format(a)} – ${f.format(b)}, ${b.getUTCFullYear()}`;
}
