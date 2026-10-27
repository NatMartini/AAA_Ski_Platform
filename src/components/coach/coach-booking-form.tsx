"use client";

import { useMemo, useState } from "react";
import { clientFetch } from "@/lib/client-fetch";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FieldError, Hint, Input, Label, Select } from "@/components/ui/field";
import { PriceBreakdown } from "@/components/booking/price-breakdown";
import { formatMoneyShort, quote } from "@/lib/pricing";
import { formatTorontoDate } from "@/lib/time";
import { rateFor, type RateRow } from "@/lib/rates";
import { lessonTypeLabel } from "@/lib/lesson-types";
import type { Locale } from "@/i18n/routing";
import { Check, Loader2 } from "lucide-react";
import { CoachInvitationCard, type CoachInvitationDraft } from "./coach-invitation-card";
import { AdditionalAttendees } from "@/components/booking/additional-attendees";
import { GroupAttendeeRoster, type GroupInvitationLink } from "@/components/booking/group-attendee-roster";
import { HoldCountdown } from "@/components/booking/hold-countdown";
import { SkillPicker } from "@/components/booking/skill-picker";
import type { SkillOption } from "@/lib/custom-skills";
import { additionalAttendeesComplete, normalizeAdditionalAttendees, resizeAdditionalAttendees, type AdditionalAttendeeInput } from "@/lib/booking/attendee-form";

type Day = {
  dateKey: string;
  resortName: string;
  /** Booking it now would be charged the early-bird rate. */
  earlyBird: boolean;
  extraPersonCents: number;
  startOptions: { hour: number; durations: number[] }[];
};

const COPY = {
  zh: {
    title: "代学员建课",
    intro:
      "为还没有账号的学员占一个时段。成年学员使用本人邮箱登录签署;未满 18 岁请填写监护人邮箱,由监护人登录签署。教练不能代签。",
    lessonType: "课程类型",
    earlyBird: "早鸟",
    noRates: "请先在「设置」里填写各课程类型的价格。",
    day: "日期",
    start: "开始时间",
    duration: "时长",
    hours: "小时",
    headcount: "人数",
    people: "人",
    student: "学员信息",
    name: "学员姓名",
    email: "学员邮箱",
    guardianEmail: "监护人邮箱",
    emailHelp: "签字链接只能由这个邮箱对应的 Google 账号打开并签署。",
    minor: "学员未满 18 岁",
    guardianHelp: "邀请邮件请手动发给这位监护人，需用该邮箱登录并以监护人身份签署。",
    notes: "备注(教练可见)",
    create: "建课并生成邀请邮件",
    created: "已建课",
    another: "再建一节",
    noDays: "请先在「可用日」里开放日期。",
    slotTaken: "该时段刚被占用,请另选时间。",
    failed: "建课失败,请检查填写内容。",
    skillsUnavailable: "所选动作已不在你的可教动作中，请重新选择或先更新教练设置。",
    needAttendees: "请填写每位额外学员的姓名及本人或监护人邮箱。",
  },
  en: {
    title: "Book for a student",
    intro:
      "Hold a slot for a student who has no account yet. Adults sign with their own email. For a student under 18, use the guardian's email so the guardian can sign in and sign. Coaches cannot sign for them.",
    lessonType: "Lesson type",
    earlyBird: "early bird",
    noRates: "Set your lesson prices under Settings first.",
    day: "Day",
    start: "Start time",
    duration: "Duration",
    headcount: "Students",
    people: "students",
    hours: "hours",
    student: "Student details",
    name: "Student's name",
    email: "Student's email",
    guardianEmail: "Guardian's email",
    emailHelp:
      "Only the Google account for this address can open and sign the link.",
    minor: "Student is under 18",
    guardianHelp:
      "Send the invitation email to this guardian manually. They must sign in with this address and sign as a guardian.",
    notes: "Notes (visible to coaches)",
    create: "Create and prepare invitation email",
    created: "Booked",
    another: "Book another",
    noDays: "Open some days under Availability first.",
    slotTaken: "That slot was just taken. Please choose another.",
    failed: "Could not create the booking. Please check the details.",
    skillsUnavailable: "The selected moves are no longer in your teaching list. Choose again or update your coach settings.",
    needAttendees: "Enter each additional student's name and their own or guardian's email.",
  },
} as const;

export function CoachBookingForm({
  locale,
  days,
  minHours,
  maxGroupSize,
  rates,
  teachableSkills = [],
  customSkills = [],
}: {
  locale: Locale;
  days: Day[];
  minHours: number;
  maxGroupSize: number;
  /** The coach's rate card, offered types only, in price-sheet order. */
  rates: RateRow[];
  teachableSkills?: string[];
  customSkills?: SkillOption[];
}) {
  const c = COPY[locale];
  const [lessonType, setLessonType] = useState(rates[0]?.lessonType ?? "");

  const [dateKey, setDateKey] = useState(days[0]?.dateKey ?? "");
  const [startHour, setStartHour] = useState<number | null>(null);
  const [hours, setHours] = useState(minHours);
  const [headcount, setHeadcount] = useState(1);
  const [additionalAttendees, setAdditionalAttendees] = useState<AdditionalAttendeeInput[]>([]);
  const [requestedSkills, setRequestedSkills] = useState<string[]>([]);
  const [studentName, setStudentName] = useState("");
  const [studentEmail, setStudentEmail] = useState("");
  const [studentIsMinor, setStudentIsMinor] = useState(false);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<({ code: string; isMinor: boolean; headcount: number; invitations: GroupInvitationLink[]; holdExpiresAt?: string | null } & CoachInvitationDraft) | null>(
    null,
  );

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

  async function submit() {
    if (busy || !day || !option || startHour == null) return;
    if (!additionalAttendeesComplete(additionalAttendees)) {
      setError(c.needAttendees);
      return;
    }
    setBusy(true);
    setError(null);

    const res = await clientFetch("/api/coach/bookings", {
      method: "POST",
      headers: { "content-type": "application/json", "x-locale": locale },
      body: JSON.stringify({
        date: day.dateKey,
        startHour,
        hours,
        lessonType,
        headcount,
        additionalAttendees: normalizeAdditionalAttendees(additionalAttendees),
        requestedSkills,
        studentName,
        studentEmail,
        studentIsMinor,
        notes: notes || null,
      }),
    });
    setBusy(false);

    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error === "slot-taken" ? c.slotTaken : body.error === "invalid-requested-skills" ? c.skillsUnavailable : c.failed);
      return;
    }
    const j = (await res.json()) as { code: string; invitations?: GroupInvitationLink[]; holdExpiresAt?: string | null } & CoachInvitationDraft;
    setResult({ code: j.code, signingUrl: j.signingUrl, invitation: j.invitation, isMinor: studentIsMinor, headcount, invitations: j.invitations ?? [], holdExpiresAt: j.holdExpiresAt });
  }

  if (result) {
    return (
      <div className="space-y-4">
        <CardTitle className="flex items-center gap-2">
          <Check className="size-5 text-success" aria-hidden />
          {c.created} · {result.code}
        </CardTitle>

        {result.holdExpiresAt && <HoldCountdown expiresAt={result.holdExpiresAt} locale={locale} />}

        {result.headcount > 1 ? <GroupAttendeeRoster
          locale={locale} code={result.code} allSigned={false} canManage senderRole="coach"
          attendees={result.invitations.map((invitation) => ({ id: invitation.attendeeId, ordinal: invitation.ordinal, fullName: invitation.fullName, email: invitation.email, isMinor: invitation.isMinor, signed: false }))}
          invitations={result.invitations}
        /> : <CoachInvitationCard
          locale={locale}
          code={result.code}
          recipientEmail={result.invitation.to}
          isMinor={result.isMinor}
          initial={{ signingUrl: result.signingUrl, invitation: result.invitation }}
        />}

        <Button
          variant="secondary"
          onClick={() => {
            setResult(null);
            setStartHour(null);
            setStudentName("");
            setStudentEmail("");
            setStudentIsMinor(false);
            setHeadcount(1);
            setAdditionalAttendees([]);
            setRequestedSkills([]);
            setNotes("");
          }}
        >
          {c.another}
        </Button>
      </div>
    );
  }

  if (days.length === 0 || rates.length === 0) {
    return (
      <Card>
        <CardDescription>
          {rates.length === 0 ? c.noRates : c.noDays}
        </CardDescription>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <Card className="space-y-4">
        <div>
          <CardTitle>{c.title}</CardTitle>
          <CardDescription>{c.intro}</CardDescription>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="lessonType">{c.lessonType}</Label>
            <Select
              id="lessonType"
              value={lessonType}
              onChange={(e) => setLessonType(e.target.value)}
            >
              {rates.map((r) => {
                const early = Boolean(day?.earlyBird && r.earlyBirdCents != null);
                return (
                  <option key={r.lessonType} value={r.lessonType}>
                    {lessonTypeLabel(r.lessonType, locale)} ·{" "}
                    {formatMoneyShort(early ? r.earlyBirdCents! : r.regularCents)}
                    {early ? ` (${c.earlyBird})` : ""}
                  </option>
                );
              })}
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="day">{c.day}</Label>
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
                  {formatTorontoDate(new Date(`${d.dateKey}T12:00:00Z`), locale)}{" "}
                  · {d.resortName}
                </option>
              ))}
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="start">{c.start}</Label>
            <Select
              id="start"
              value={startHour ?? ""}
              onChange={(e) => {
                const hour = e.target.value === "" ? null : Number(e.target.value);
                setStartHour(hour);
                const opt = day?.startOptions.find((o) => o.hour === hour);
                if (opt && !opt.durations.includes(hours)) {
                  setHours(opt.durations[0]);
                }
              }}
            >
              <option value="">—</option>
              {day?.startOptions.map((o) => (
                <option key={o.hour} value={o.hour}>
                  {String(o.hour).padStart(2, "0")}:00
                </option>
              ))}
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="hours">{c.duration}</Label>
            <Select
              id="hours"
              value={hours}
              disabled={!option}
              onChange={(e) => setHours(Number(e.target.value))}
            >
              {(option?.durations ?? [minHours]).map((d) => (
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
                onChange={(e) => {
                  const next = Number(e.target.value);
                  setHeadcount(next);
                  setAdditionalAttendees((current) => resizeAdditionalAttendees(current, next));
                }}
              >
                {Array.from({ length: Math.min(3, maxGroupSize) }, (_, i) => i + 1).map(
                  (n) => (
                    <option key={n} value={n}>
                      {locale === "zh" ? `1 对 ${n}` : `1-on-${n}`} · {n} {c.people}
                    </option>
                  ),
                )}
              </Select>
            </div>
          )}
        </div>

        {priced && (
          <PriceBreakdown
            quote={priced}
            locale={locale}
            lessonType={lessonType}
            earlyBird={rate?.earlyBird}
          />
        )}
        <div className="space-y-2 border-t border-border pt-4">
          <Label>{locale === "zh" ? "想练的动作（可选）" : "Practice focus (optional)"}</Label>
          <Hint>{locale === "zh" ? "选择学员本节课想练的动作，最多 12 项。" : "Choose the student's focus for this lesson, up to 12 choices."}</Hint>
          <SkillPicker locale={locale} selected={requestedSkills} onChange={setRequestedSkills} maxSelected={12} allowed={teachableSkills} customSkills={customSkills} labels={{ alpine: locale === "zh" ? "双板技术" : "Alpine", park: locale === "zh" ? "公园" : "Park", tier: "L{n}" }} />
        </div>
      </Card>

      <Card className="space-y-4">
        <CardTitle>{c.student}</CardTitle>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="s-name">{c.name}</Label>
            <Input
              id="s-name"
              value={studentName}
              onChange={(e) => setStudentName(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="s-email">{studentIsMinor ? c.guardianEmail : c.email}</Label>
            <Input
              id="s-email"
              type="email"
              value={studentEmail}
              onChange={(e) => setStudentEmail(e.target.value)}
            />
            <Hint>{studentIsMinor ? c.guardianHelp : c.emailHelp}</Hint>
          </div>
          <div className="space-y-1.5">
            <label className="flex min-h-11 items-center gap-2 text-sm font-semibold">
              <input
                type="checkbox"
                checked={studentIsMinor}
                onChange={(e) => {
                  setStudentIsMinor(e.target.checked);
                  setStudentEmail("");
                }}
                className="size-4 accent-accent"
              />
              {c.minor}
            </label>
          </div>
        </div>

        <AdditionalAttendees locale={locale} attendees={additionalAttendees} onChange={setAdditionalAttendees} disabled={busy} />

        <div className="space-y-1.5">
          <Label htmlFor="notes">{c.notes}</Label>
          <Input
            id="notes"
            value={notes}
            maxLength={1000}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>

        <FieldError>{error}</FieldError>

        <Button
          onClick={submit}
          disabled={
            busy ||
            !option ||
            !studentName.trim() ||
            !studentEmail.trim()
            || !additionalAttendeesComplete(additionalAttendees)
          }
          className="self-start"
        >
          {busy && <Loader2 className="animate-spin" aria-hidden />}
          {c.create}
        </Button>
      </Card>
    </div>
  );
}
