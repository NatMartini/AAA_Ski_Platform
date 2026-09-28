"use client";

import { useMemo, useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FieldError, Label, Select } from "@/components/ui/field";
import { EarlyBirdTag, PriceBreakdown } from "./price-breakdown";
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
import { rateFor, type RateRow } from "@/lib/rates";
import { LESSON_TYPES, lessonTypeLabel } from "@/lib/lesson-types";
import { seasonOfDateKey } from "@/lib/season";
import type { Locale } from "@/i18n/routing";
import { cn } from "@/lib/utils";
import { Clock, Loader2, MessageCircle } from "lucide-react";

type Cell = { hour: number; startIso: string };
type Day = {
  dateKey: string;
  /** Booking it now would be charged the early-bird rate. */
  earlyBird: boolean;
  extraPersonCents: number;
  cells: Cell[];
  startOptions: { hour: number; durations: number[] }[];
};
/** A paid-up lesson package this account could spend here. */
type UsablePackage = {
  id: string;
  code: string;
  lessonType: string;
  season: string;
  hoursLeft: number;
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
    lessonType: "课程类型",
    earlyBird: "早鸟价",
    regular: "原价",
    perHour: "/小时",
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
    planPackage: "用课时包 {code}",
    packageAfter: "用后剩余",
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
      "开头 10 分钟用于与上一位学员交接,整点后 10 分开始上课、到整点结束,因此实际授课比预定时段少 10 分钟,因此每单减去这 10 分钟的课时费。",
    lessonRuns: "实际授课",
    minutes: "分钟",
    needParticipant: "请选择上课学员",
    slotTaken: "抱歉,该时段刚被他人预定,请另选时间。",
    packageFailed: "课时包剩余时长不足或已不可用,请刷新后重试,或改为直接付款。",
    failed: "预定失败,请重试。",
  },
  en: {
    lessonType: "Lesson type",
    earlyBird: "Early bird",
    regular: "Regular",
    perHour: "/h",
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
    planPackage: "Use package {code}",
    packageAfter: "Left afterwards",
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
      "The first 10 minutes are the handover from the previous student, so the lesson starts at ten past and runs to the hour — 10 minutes shorter than the booked block, so those ten minutes' fee is taken off each booking.",
    lessonRuns: "Lesson runs",
    minutes: "min",
    needParticipant: "Please choose who is taking the lesson",
    slotTaken: "Sorry — someone just took that slot. Please pick another time.",
    packageFailed:
      "That package no longer has enough hours for this lesson. Refresh and try again, or pay instead.",
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
  rates,
  earlyBirdActive,
  packages,
  initialDateKey,
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
  /** The coach's rate card, offered types only, in price-sheet order. */
  rates: RateRow[];
  /** Early-bird prices are on offer to anyone booking today. */
  earlyBirdActive: boolean;
  packages: UsablePackage[];
  /** A day to open on, e.g. from the calendar. Must be one of `days`. */
  initialDateKey?: string;
  days: Day[];
  participants: Participant[];
}) {
  const router = useRouter();
  const c = COPY[locale];

  const [participants, setParticipants] = useState(initialParticipants);
  const [lessonType, setLessonType] = useState(rates[0]?.lessonType ?? "");
  const [dateKey, setDateKey] = useState(initialDateKey ?? "");
  const [startHour, setStartHour] = useState<number | null>(null);
  const [hours, setHours] = useState<number>(minHours);
  const [headcount, setHeadcount] = useState(1);
  const [skills, setSkills] = useState<string[]>([]);
  const [plan, setPlan] = useState<"FULL" | "DEPOSIT" | "PACKAGE">("FULL");
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

  const rate = day ? rateFor(rates, lessonType, day.earlyBird) : null;
  const priced =
    day && option && rate
      ? quote({
          hours,
          hourlyRateCents: rate.hourlyRateCents,
          headcount,
          extraPersonCents: day.extraPersonCents,
        })
      : null;

  // A package pays for a whole one-on-one lesson of its own type and season,
  // or not at all. The server re-checks all of this under a row lock.
  const usablePackage = day
    ? packages.find(
        (p) =>
          p.lessonType === lessonType &&
          p.season === seasonOfDateKey(day.dateKey) &&
          p.hoursLeft >= hours &&
          headcount === 1,
      )
    : undefined;
  const effectivePlan = plan === "PACKAGE" && !usablePackage ? "FULL" : plan;

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
        lessonType,
        headcount,
        participantId,
        requestedSkills: skills,
        paymentPlan: effectivePlan,
        packageId: effectivePlan === "PACKAGE" ? usablePackage?.id : null,
      }),
    });
    setBusy(false);

    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(
        body.error === "slot-taken"
          ? c.slotTaken
          : body.error?.startsWith("package-")
            ? c.packageFailed
            : c.failed,
      );
      router.refresh();
      return;
    }

    const { code, nextStep } = (await res.json()) as {
      code: string;
      nextStep: "waiver" | "payment" | "done";
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
        {rates.length > 0 && (
          <LessonTypePicker
            locale={locale}
            rates={rates}
            earlyBirdActive={earlyBirdActive}
            selected={lessonType}
            onSelect={setLessonType}
            labels={{
              title: c.lessonType,
              earlyBird: c.earlyBird,
              regular: c.regular,
              perHour: c.perHour,
            }}
          />
        )}

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

          <PriceBreakdown
            quote={priced}
            locale={locale}
            lessonType={lessonType}
            earlyBird={rate?.earlyBird}
            packageUse={
              effectivePlan === "PACKAGE" && usablePackage
                ? { code: usablePackage.code, hours }
                : undefined
            }
          />

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
              {usablePackage && (
                <PlanOption
                  selected={effectivePlan === "PACKAGE"}
                  onSelect={() => setPlan("PACKAGE")}
                  title={c.planPackage.replace("{code}", usablePackage.code)}
                  amountLabel={c.depositNow}
                  amount={formatMoneyShort(0)}
                  secondaryLabel={c.packageAfter}
                  secondary={`${usablePackage.hoursLeft - hours} ${c.hours}`}
                />
              )}
              <PlanOption
                selected={effectivePlan === "FULL"}
                onSelect={() => setPlan("FULL")}
                title={c.planFull}
                amountLabel={c.depositNow}
                amount={formatMoneyShort(priced.totalCents)}
              />
              <PlanOption
                selected={effectivePlan === "DEPOSIT"}
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
 * One tile per lesson type the coach teaches, with its price. During the
 * early-bird window both prices show, the regular one struck through, so the
 * saving is visible before a student commits to a time.
 */
function LessonTypePicker({
  locale,
  rates,
  earlyBirdActive,
  selected,
  onSelect,
  labels,
}: {
  locale: Locale;
  rates: RateRow[];
  earlyBirdActive: boolean;
  selected: string;
  onSelect: (lessonType: string) => void;
  labels: { title: string; earlyBird: string; regular: string; perHour: string };
}) {
  return (
    <div className="space-y-1.5">
      <Label>{labels.title}</Label>
      <div
        role="group"
        aria-label={labels.title}
        className="grid gap-2 sm:grid-cols-3"
      >
        {rates.map((r) => {
          const isSelected = r.lessonType === selected;
          const early = earlyBirdActive && r.earlyBirdCents != null;
          const hint = LESSON_TYPES.find((t) => t.key === r.lessonType);
          return (
            <button
              key={r.lessonType}
              type="button"
              aria-pressed={isSelected}
              onClick={() => onSelect(r.lessonType)}
              className={cn(
                "press rounded-xl border p-3 text-left",
                isSelected
                  ? "border-accent bg-[var(--accent-soft)]"
                  : "border-border bg-surface hover:border-accent",
              )}
            >
              <span className="block text-sm font-bold text-ink">
                {lessonTypeLabel(r.lessonType, locale)}
              </span>
              <span className="mt-1 flex flex-wrap items-baseline gap-x-1.5 text-xs text-ink-2" data-numeric>
                <strong className="text-sm text-ink">
                  {formatMoneyShort(early ? r.earlyBirdCents! : r.regularCents)}
                  {labels.perHour}
                </strong>
                {early && (
                  <>
                    <s className="text-ink-3">
                      <span className="sr-only">{labels.regular} </span>
                      {formatMoneyShort(r.regularCents)}
                    </s>
                    <EarlyBirdTag label={labels.earlyBird} />
                  </>
                )}
              </span>
              {hint && (
                <span className="mt-1 block text-[11px] leading-snug text-ink-3">
                  {locale === "zh" ? hint.zhHint : hint.enHint}
                </span>
              )}
            </button>
          );
        })}
      </div>
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
