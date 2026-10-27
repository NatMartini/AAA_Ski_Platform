"use client";

import { useMemo, useState } from "react";
import { clientFetch } from "@/lib/client-fetch";
import { Link, useRouter } from "@/i18n/navigation";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FieldError, Label, Select } from "@/components/ui/field";
import { EarlyBirdTag, PriceBreakdown } from "./price-breakdown";
import { AddParticipantDialog } from "./add-participant-dialog";
import { SkillPicker } from "./skill-picker";
import { toBookingSelectionQuery, type BookingSelection } from "@/lib/booking/selection";
import { coachCanTeachRequestedSkills, type CustomSkill } from "@/lib/custom-skills";
import { AdditionalAttendees } from "./additional-attendees";
import { GroupAttendeeRoster, type GroupInvitationLink } from "./group-attendee-roster";
import { HoldCountdown } from "./hold-countdown";
import { additionalAttendeesComplete, normalizeAdditionalAttendees, resizeAdditionalAttendees, type AdditionalAttendeeInput } from "@/lib/booking/attendee-form";
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
import { expandTeachableSkillKeys, skillLabel } from "@/lib/skills";
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
      "开头 10 分钟用于交接:整点后 10 分开始上课、到整点结束。每单按 10 分钟课时费计算交接优惠,向上取整至 $5 的倍数,最低 $10,且不超过课费。",
    lessonRuns: "实际授课",
    minutes: "分钟",
    needParticipant: "请选择上课学员",
    needAttendees: "请填写每位额外学员的姓名及本人或监护人邮箱。",
    createdGroup: "多人订单已创建，请分别转发签字链接",
    openOrder: "查看订单并完成本人签署",
    slotTaken: "抱歉,该时段刚被他人预定,请另选时间。",
    packageFailed: "课时包剩余时长不足或已不可用,请刷新后重试,或改为直接付款。",
    skillsUnavailable: "这位教练目前不能教授全部所选动作，请返回调整动作或更换教练。",
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
      "Lessons start ten minutes past the booked hour and finish at the booked end. Each booking receives a handover credit based on ten minutes at the hourly rate, rounded up to the next $5, with a $10 minimum and capped at the lesson price.",
    lessonRuns: "Lesson runs",
    minutes: "min",
    needParticipant: "Please choose who is taking the lesson",
    needAttendees: "Enter each additional student's name and their own or guardian's email.",
    createdGroup: "Group booking created — share each personal signing link",
    openOrder: "Open order and sign your own waiver",
    slotTaken: "Sorry — someone just took that slot. Please pick another time.",
    packageFailed:
      "That package no longer has enough hours for this lesson. Refresh and try again, or pay instead.",
    skillsUnavailable: "This coach cannot currently teach all your selected moves. Change your moves or choose another coach.",
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
  customSkills,
  cancellationPolicy,
  resortName,
  maxGroupSize,
  rates,
  earlyBirdActive,
  packages,
  selection,
  changeTimeHref,
  changeCoachHref,
  days,
  participants: initialParticipants,
}: {
  locale: Locale;
  coachId: string;
  coachName: string;
  coachBio: string | null;
  coachAvatarUrl: string | null;
  coachWechat: string | null;
  /** Explicit catalogue skills this coach teaches; custom moves are separate. */
  coachSkills: string[];
  customSkills: CustomSkill[];
  cancellationPolicy: string;
  resortName: string;
  maxGroupSize: number;
  /** The coach's rate card, offered types only, in price-sheet order. */
  rates: RateRow[];
  /** Early-bird prices are on offer to anyone booking today. */
  earlyBirdActive: boolean;
  packages: UsablePackage[];
  selection: BookingSelection;
  changeTimeHref: string;
  changeCoachHref: string;
  days: Day[];
  participants: Participant[];
}) {
  const router = useRouter();
  const c = COPY[locale];

  const [participants, setParticipants] = useState(initialParticipants);
  const [lessonType, setLessonType] = useState(selection.lessonType ?? rates[0]?.lessonType ?? "");
  const { dateKey, startHour, hours } = selection;
  const [headcount, setHeadcount] = useState(selection.headcount ?? 1);
  const [additionalAttendees, setAdditionalAttendees] = useState<AdditionalAttendeeInput[]>(resizeAdditionalAttendees([], selection.headcount ?? 1));
  const [groupResult, setGroupResult] = useState<{ code: string; invitations: GroupInvitationLink[]; holdExpiresAt?: string | null } | null>(null);
  const [skills, setSkills] = useState<string[]>(selection.requestedSkills);
  const [plan, setPlan] = useState<"FULL" | "DEPOSIT" | "PACKAGE">("FULL");
  const [participantId, setParticipantId] = useState(
    initialParticipants.find((p) => p.isSelf)?.id ?? "",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const currentQuery = new URLSearchParams(toBookingSelectionQuery({
    ...selection, requestedSkills: skills, lessonType, headcount,
  })).toString();
  const currentTimeHref = `${changeTimeHref.split("?")[0]}?${currentQuery}`;
  const currentCoachHref = `${changeCoachHref.split("?")[0]}?${currentQuery}`;
  const skillsSupported = coachCanTeachRequestedSkills(skills, { teachableSkills: coachSkills, customSkills });
  const catalogueSkills = expandTeachableSkillKeys(coachSkills);
  const unavailableSkills = skills.filter((key) => !catalogueSkills.includes(key) && !customSkills.some((skill) => skill.key === key));

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

  const startCell = day?.cells.find((cell) => cell.hour === startHour);
  const window =
    startCell && option?.durations.includes(hours)
      ? lessonWindow(
          new Date(startCell.startIso),
          new Date(
            new Date(startCell.startIso).getTime() +
              hours * 3_600_000,
          ),
        )
      : null;

  async function submit() {
    if (!skillsSupported) {
      setError(c.skillsUnavailable);
      return;
    }
    if (!participantId) {
      setError(c.needParticipant);
      return;
    }
    if (!additionalAttendeesComplete(additionalAttendees)) {
      setError(c.needAttendees);
      return;
    }
    if (busy || startHour == null || !day || !window) return;

    setBusy(true);
    setError(null);
    const res = await clientFetch("/api/bookings", {
      method: "POST",
      headers: { "content-type": "application/json", "x-locale": locale },
      body: JSON.stringify({
        coachId,
        date: day.dateKey,
        startHour,
        hours,
        lessonType,
        headcount,
        additionalAttendees: normalizeAdditionalAttendees(additionalAttendees),
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
          : body.error === "invalid-requested-skills"
            ? c.skillsUnavailable
          : body.error?.startsWith("package-")
            ? c.packageFailed
            : c.failed,
      );
      router.refresh();
      return;
    }

    const { code, nextStep, invitations = [], holdExpiresAt } = (await res.json()) as {
      code: string;
      nextStep: "waiver" | "payment" | "done";
      invitations?: GroupInvitationLink[];
      holdExpiresAt?: string | null;
    };
    if (headcount > 1) {
      setGroupResult({ code, invitations, holdExpiresAt });
      return;
    }
    router.push(
      nextStep === "payment"
        ? `/booking/${code}/payment`
        : `/booking/${code}`,
    );
  }

  if (groupResult) {
    return <div className="space-y-5">
      <h1 className="text-2xl font-bold">{c.createdGroup}</h1>
      {groupResult.holdExpiresAt && <HoldCountdown expiresAt={groupResult.holdExpiresAt} locale={locale} signOnly={plan === "PACKAGE"} />}
      <GroupAttendeeRoster
        locale={locale} code={groupResult.code} allSigned={false} canManage
        attendees={groupResult.invitations.map((invitation) => ({ id: invitation.attendeeId, ordinal: invitation.ordinal, fullName: invitation.fullName, email: invitation.email, isMinor: invitation.isMinor, signed: false }))}
        invitations={groupResult.invitations}
      />
      <Button asChild><Link href={`/booking/${groupResult.code}`}>{c.openOrder}</Link></Button>
    </div>;
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
        <p className="mt-3 text-xs font-bold text-accent">{locale === "zh" ? "地点 → 时间 → 教练 → 确认预定" : "Location → Time → Coach → Booking details"}</p>
        <h1 className="mt-1 text-3xl">{locale === "zh" ? "确认课程与学员" : "Complete your booking"}</h1>
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

        <div className="rounded-xl border border-border bg-surface-2 p-4">
          <p className="text-xs font-semibold text-ink-3">{locale === "zh" ? "已选择的地点与时间" : "Selected location and time"}</p>
          <p className="mt-1 font-bold">{resortName} · {formatTorontoDate(new Date(`${dateKey}T12:00:00Z`), locale)}</p>
          <p className="mt-1 text-sm text-ink-2" data-numeric>{String(startHour).padStart(2, "0")}:00 – {String(startHour + hours).padStart(2, "0")}:00 · {hours} {c.hours}</p>
          <div className="mt-3 flex flex-wrap gap-4 text-sm font-semibold text-accent">
            <Link href={currentTimeHref} className="underline underline-offset-4">{locale === "zh" ? "修改时间" : "Change time"}</Link>
            <Link href={currentCoachHref} className="underline underline-offset-4">{locale === "zh" ? "更换教练" : "Change coach"}</Link>
          </div>
        </div>

        {maxGroupSize > 1 && (
          <div className="space-y-1.5">
            <Label htmlFor="headcount">{c.headcount}</Label>
            <Select id="headcount" value={headcount} onChange={(e) => {
              const next = Number(e.target.value);
              setHeadcount(next);
              setAdditionalAttendees((current) => resizeAdditionalAttendees(current, next));
            }}>
              {Array.from({ length: Math.min(3, maxGroupSize) }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>{n} {c.people}{n > 1 ? ` · ${c.oneOnN.replace("{n}", String(n))}` : ""}</option>
              ))}
            </Select>
            {day && day.extraPersonCents > 0 && <p className="text-xs text-ink-3">{c.groupNote.replace("{extra}", formatMoneyShort(day.extraPersonCents))}</p>}
          </div>
        )}

        {coachWechat && (
          <p className="flex items-center gap-1.5 border-t border-border pt-3 text-xs text-ink-3">
            <MessageCircle className="size-3.5 shrink-0" aria-hidden />
            {c.otherTimes} <strong className="text-ink-2">{coachWechat}</strong>
          </p>
        )}
        <FieldError>{error}</FieldError>
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
            {!skillsSupported && <div className="space-y-2 rounded-xl border border-amber-border bg-amber-bg p-3 text-xs text-amber">
              <p>{c.skillsUnavailable}</p>
              <div className="flex flex-wrap gap-2">{unavailableSkills.map((key) => <button key={key} type="button" onClick={() => setSkills((current) => current.filter((value) => value !== key))} className="rounded-full border border-amber-border px-3 py-1.5">{skillLabel(key, locale)} ×</button>)}</div>
            </div>}
            <SkillPicker
              locale={locale}
              selected={skills}
              onChange={setSkills}
              allowed={coachSkills}
              customSkills={customSkills}
              maxSelected={12}
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

          <AdditionalAttendees locale={locale} attendees={additionalAttendees} onChange={setAdditionalAttendees} disabled={busy} />

          <div className="space-y-1.5 border-t border-border pt-4">
            <p className="text-sm font-bold text-ink">
              {c.cancellationPolicy}
            </p>
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-2">
              {cancellationPolicy}
            </p>
          </div>

          <Button
            onClick={submit}
            disabled={busy || !skillsSupported || !additionalAttendeesComplete(additionalAttendees)}
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
