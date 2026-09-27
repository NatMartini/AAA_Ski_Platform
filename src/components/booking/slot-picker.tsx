"use client";

import { useMemo, useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FieldError, Label, Select } from "@/components/ui/field";
import { PriceBreakdown } from "./price-breakdown";
import { AddParticipantDialog } from "./add-participant-dialog";
import { SkillPicker } from "./skill-picker";
import { DateCalendar } from "./date-calendar";
import {
  quote,
  lessonWindow,
  formatMoneyShort,
  depositFor,
} from "@/lib/pricing";
import { formatTorontoDate, formatTorontoTime } from "@/lib/time";
import type { Locale } from "@/i18n/routing";
import { cn } from "@/lib/utils";
import { Clock, Loader2, MessageCircle } from "lucide-react";

type Cell = { hour: number; startIso: string };
type Day = {
  dateKey: string;
  hourlyRateCents: number;
  handoverDiscountCents: number;
  extraPersonCents: number;
  cells: Cell[];
  startOptions: { hour: number; durations: number[] }[];
};
type Participant = {
  id: string;
  fullName: string;
  isMinor: boolean;
  isSelf: boolean;
  level: string | null;
  phone: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
};

const COPY = {
  zh: {
    pickDay: "选择日期",
    prevMonth: "上一月",
    nextMonth: "下一月",
    pickTime: "选择开始时间",
    duration: "时长",
    hours: "小时",
    headcount: "上课人数",
    people: "人",
    skills: "想练的动作(可多选)",
    skillsHint: "告诉教练你想重点练什么,课前就能准备。",
    alpine: "双板技术",
    park: "公园",
    tier: "L{n}",
    plan: "付款方式",
    planFull: "一次付清",
    planDeposit: "先付定金(一小时课费),上课后付余款",
    depositNow: "现在支付",
    balanceLater: "课后支付",
    oneOnN: "1 对 {n}",
    groupNote: "多人课每增加一人,每小时加 {extra}。",
    participant: "上课学员",
    addParticipant: "添加学员",
    cancellationPolicy: "取消与退款政策",
    noDays: "该雪场暂时没有可预定的日子。",
    noSlots: "这一天已经约满了。",
    review: "确认并预定",
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
    prevMonth: "Previous month",
    nextMonth: "Next month",
    pickTime: "Choose a start time",
    duration: "Duration",
    hours: "hours",
    headcount: "How many students",
    people: "students",
    skills: "What you want to work on (optional)",
    skillsHint: "Tell your coach what to focus on so they can plan ahead.",
    alpine: "Alpine",
    park: "Park",
    tier: "L{n}",
    plan: "Payment",
    planFull: "Pay in full",
    planDeposit: "Deposit now (one hour), balance after the lesson",
    depositNow: "Due now",
    balanceLater: "Due after the lesson",
    oneOnN: "1-on-{n}",
    groupNote: "Each extra student adds {extra} per hour.",
    participant: "Who is taking the lesson",
    addParticipant: "Add participant",
    cancellationPolicy: "Cancellation and refund policy",
    noDays: "No days are open at this resort yet.",
    noSlots: "This day is fully booked.",
    review: "Review and book",
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
  coachBio,
  coachAvatarUrl,
  coachWechat,
  coachSkills,
  cancellationPolicy,
  resortName,
  minHours,
  maxGroupSize,
  days,
  participants: initialParticipants,
}: {
  locale: Locale;
  coachId: string;
  coachName: string;
  coachBio: string | null;
  coachAvatarUrl: string | null;
  coachWechat: string | null;
  /** Skill keys this coach teaches; empty means show the whole catalogue. */
  coachSkills: string[];
  cancellationPolicy: string;
  resortName: string;
  minHours: number;
  maxGroupSize: number;
  days: Day[];
  participants: Participant[];
}) {
  const router = useRouter();
  const c = COPY[locale];

  const [participants, setParticipants] = useState(initialParticipants);
  const [dateKey, setDateKey] = useState("");
  const [startHour, setStartHour] = useState<number | null>(null);
  const [hours, setHours] = useState<number>(minHours);
  const [headcount, setHeadcount] = useState(1);
  const [skills, setSkills] = useState<string[]>([]);
  const [plan, setPlan] = useState<"FULL" | "DEPOSIT">("FULL");
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
          headcount,
          extraPersonCents: day.extraPersonCents,
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
        headcount,
        participantId,
        requestedSkills: skills,
        paymentPlan: plan,
      }),
    });
    setBusy(false);

    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error === "slot-taken" ? c.slotTaken : c.failed);
      router.refresh();
      return;
    }

    const { code, nextStep } = (await res.json()) as {
      code: string;
      nextStep: "waiver" | "payment";
    };
    router.push(
      nextStep === "payment"
        ? `/booking/${code}/payment`
        : `/booking/${code}`,
    );
  }

  if (days.length === 0) {
    return (
      <Card>
        <CardDescription>{c.noDays}</CardDescription>
        {coachWechat && (
          <p className="mt-3 flex items-center gap-1.5 text-sm text-ink-2">
            <MessageCircle className="size-4 shrink-0" aria-hidden />
            {c.otherTimes} <strong className="text-ink">{coachWechat}</strong>
          </p>
        )}
      </Card>
    );
  }

  return (
    <div className="stagger space-y-5">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-ink-3">
          {resortName} · {coachName}
        </p>
        <h1 className="mt-1 text-3xl">{c.pickTime}</h1>
      </div>

      {/* Coach introduction. Fed from the coach's bio; the content is set in
          coach settings and shown here at the top of the booking page. */}
      {(coachBio || coachAvatarUrl) && (
        <CoachIntro
          name={coachName}
          bio={coachBio}
          avatarUrl={coachAvatarUrl}
        />
      )}

      <Card className="space-y-4">
        <div className="space-y-1.5">
          <Label>{c.pickDay}</Label>
          <DateCalendar
            locale={locale}
            available={days.map((d) => d.dateKey)}
            selected={dateKey || null}
            onSelect={(next) => {
              setDateKey(next);
              setStartHour(null);
            }}
            labels={{
              prev: c.prevMonth,
              next: c.nextMonth,
              none: c.noDays,
            }}
          />
          {dateKey && (
            <p className="pt-0.5 text-sm font-semibold text-ink-2">
              {formatTorontoDate(new Date(`${dateKey}T12:00:00Z`), locale)}
            </p>
          )}
        </div>

        {day && (
          <>
            {day.startOptions.length === 0 ? (
              <p className="rounded-xl bg-surface-2 p-4 text-sm text-ink-2">
                {c.noSlots}
              </p>
            ) : (
              <HourGrid
                day={day}
                locale={locale}
                selected={startHour}
                onSelect={selectStart}
              />
            )}

            {option && (
              <div className="grid gap-4 sm:grid-cols-2">
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

                {maxGroupSize > 1 && (
                  <div className="space-y-1.5">
                    <Label htmlFor="headcount">{c.headcount}</Label>
                    <Select
                      id="headcount"
                      value={headcount}
                      onChange={(e) => setHeadcount(Number(e.target.value))}
                    >
                      {Array.from({ length: maxGroupSize }, (_, i) => i + 1).map(
                        (n) => (
                          <option key={n} value={n}>
                            {n} {c.people}
                            {n > 1 ? ` · ${c.oneOnN.replace("{n}", String(n))}` : ""}
                          </option>
                        ),
                      )}
                    </Select>
                    {day.extraPersonCents > 0 && (
                      <p className="text-xs text-muted-foreground">
                        {c.groupNote.replace(
                          "{extra}",
                          formatMoneyShort(day.extraPersonCents),
                        )}
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {coachWechat && (
          <p className="flex items-center gap-1.5 border-t border-border pt-3 text-xs text-ink-3">
            <MessageCircle className="size-3.5 shrink-0" aria-hidden />
            {c.otherTimes} <strong className="text-ink-2">{coachWechat}</strong>
          </p>
        )}
      </Card>

      {priced && window && (
        <Card className="animate-fade-up space-y-4">
          <CardTitle>{c.review}</CardTitle>

          <div className="rounded-xl border border-[var(--accent-soft)] bg-[var(--accent-soft)] p-4 text-sm">
            <p className="flex items-center gap-2 font-bold text-ink">
              <Clock className="size-4 shrink-0 text-accent" aria-hidden />
              {c.lessonRuns} {formatTorontoTime(window.lessonStartAt, locale)} –{" "}
              {formatTorontoTime(window.lessonEndAt, locale)} (
              {priced.lessonMinutes} {c.minutes})
            </p>
            <p className="mt-1.5 pl-6 text-xs leading-relaxed text-ink-2">
              {c.handoverNote}
            </p>
          </div>

          <PriceBreakdown quote={priced} locale={locale} />

          <div className="space-y-1.5">
            <Label>{c.skills}</Label>
            <p className="text-xs text-ink-3">{c.skillsHint}</p>
            <SkillPicker
              locale={locale}
              selected={skills}
              onChange={setSkills}
              allowed={coachSkills}
              labels={{ alpine: c.alpine, park: c.park, tier: c.tier }}
            />
          </div>

          <div className="space-y-1.5">
            <Label>{c.plan}</Label>
            <div className="grid gap-2 sm:grid-cols-2">
              <PlanOption
                selected={plan === "FULL"}
                onSelect={() => setPlan("FULL")}
                title={c.planFull}
                amountLabel={c.depositNow}
                amount={formatMoneyShort(priced.totalCents)}
              />
              <PlanOption
                selected={plan === "DEPOSIT"}
                onSelect={() => setPlan("DEPOSIT")}
                title={c.planDeposit}
                amountLabel={c.depositNow}
                amount={formatMoneyShort(depositFor(priced))}
                secondaryLabel={c.balanceLater}
                secondary={formatMoneyShort(
                  priced.totalCents - depositFor(priced),
                )}
              />
            </div>
          </div>

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

          <div className="space-y-1.5 border-t border-border pt-4">
            <p className="text-sm font-bold text-ink">
              {c.cancellationPolicy}
            </p>
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-2">
              {cancellationPolicy}
            </p>
          </div>

          <FieldError>{error}</FieldError>

          <Button
            onClick={submit}
            disabled={busy}
            size="lg"
            className="w-full sm:w-auto sm:self-start"
          >
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
 * reachable and operable by keyboard.
 *
 * Only hours that can actually start a lesson are shown — past hours, lunch,
 * booked hours and hours with no room for a full lesson simply do not appear,
 * rather than showing as greyed-out cells.
 */
function HourGrid({
  day,
  locale,
  selected,
  onSelect,
}: {
  day: Day;
  locale: Locale;
  selected: number | null;
  onSelect: (hour: number) => void;
}) {
  const byHour = new Map(day.cells.map((cell) => [cell.hour, cell]));

  return (
    <div className="space-y-2">
      <div
        role="group"
        aria-label={locale === "zh" ? "可选时段" : "Available start times"}
        className="grid grid-cols-3 gap-2 sm:grid-cols-4"
      >
        {day.startOptions.map((opt, i) => {
          const isSelected = selected === opt.hour;
          const label = `${String(opt.hour).padStart(2, "0")}:00`;
          if (!byHour.has(opt.hour)) return null;

          return (
            <button
              // Keyed by day as well as hour so the tiles re-run their entrance
              // animation when the date changes.
              key={`${day.dateKey}-${opt.hour}`}
              type="button"
              aria-pressed={isSelected}
              onClick={() => onSelect(opt.hour)}
              style={{ animationDelay: `${Math.min(i, 10) * 25}ms` }}
              className={cn(
                "press animate-fade-up flex min-h-14 items-center justify-center rounded-xl border text-[15px] font-bold tabular-nums",
                isSelected
                  ? "border-accent bg-accent text-accent-foreground shadow-[var(--shadow-sm)]"
                  : "border-border bg-surface text-ink hover:border-accent hover:bg-[var(--accent-soft)]",
              )}
            >
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** One payment-plan choice, showing what is due now and later. */
function PlanOption({
  selected,
  onSelect,
  title,
  amountLabel,
  amount,
  secondaryLabel,
  secondary,
}: {
  selected: boolean;
  onSelect: () => void;
  title: string;
  amountLabel: string;
  amount: string;
  secondaryLabel?: string;
  secondary?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        "press rounded-xl border p-3 text-left",
        selected
          ? "border-accent bg-[var(--accent-soft)]"
          : "border-border bg-surface hover:border-accent",
      )}
    >
      <span className="block text-sm font-bold text-ink">{title}</span>
      <span className="mt-1 block text-xs text-ink-2">
        {amountLabel} <strong className="text-ink">{amount}</strong>
      </span>
      {secondary && (
        <span className="block text-xs text-ink-2">
          {secondaryLabel} <strong className="text-ink">{secondary}</strong>
        </span>
      )}
    </button>
  );
}

/** Coach introduction card shown above the calendar. */
function CoachIntro({
  name,
  bio,
  avatarUrl,
}: {
  name: string;
  bio: string | null;
  avatarUrl: string | null;
}) {
  return (
    <Card className="flex items-start gap-4">
      {avatarUrl ? (
        // Coach photo from an arbitrary host; next/image config is not worth it.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={avatarUrl}
          alt={name}
          className="size-14 shrink-0 rounded-2xl border border-border object-cover sm:size-16"
        />
      ) : (
        <span className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-[var(--accent-soft)] text-xl font-extrabold text-accent sm:size-16">
          {name.slice(0, 1)}
        </span>
      )}
      <div className="min-w-0 space-y-1.5">
        <CardTitle>{name}</CardTitle>
        {bio && (
          <div className="space-y-1 text-sm leading-relaxed text-ink-2">
            {bio.split(/\n+/).map((para, i) => (
              <p key={i}>{para}</p>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}
