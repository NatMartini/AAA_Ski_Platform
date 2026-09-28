"use client";

import { useMemo, useState } from "react";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FieldError, Hint, Input, Label, Select } from "@/components/ui/field";
import { PriceBreakdown } from "@/components/booking/price-breakdown";
import { formatMoneyShort, quote } from "@/lib/pricing";
import { formatTorontoDate } from "@/lib/time";
import { rateFor, type RateRow } from "@/lib/rates";
import { lessonTypeLabel } from "@/lib/lesson-types";
import type { Locale } from "@/i18n/routing";
import { Check, Copy, Loader2 } from "lucide-react";

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
      "为还没有账号的学员占一个时段。建好后会生成一条签字链接 —— 学员用链接里指定的邮箱登录后自己签署免责协议。你不能代签。",
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
    emailHelp: "签字链接只能由这个邮箱对应的 Google 账号打开并签署。",
    birthDate: "出生日期",
    birthHelp: "未满 18 岁时,链接需由监护人登录签署。",
    notes: "备注(仅自己可见)",
    create: "建课并生成签字链接",
    created: "已建课",
    linkTitle: "签字链接",
    linkHelp:
      "复制发给学员(微信即可)。链接 7 天内有效,只能用一次。系统也已尝试发送邮件。",
    copy: "复制链接",
    copied: "已复制",
    another: "再建一节",
    noDays: "请先在「可用日」里开放日期。",
    slotTaken: "该时段刚被占用,请另选时间。",
    failed: "建课失败,请检查填写内容。",
  },
  en: {
    title: "Book for a student",
    intro:
      "Hold a slot for a student who has no account yet. You will get a signing link — they open it, sign in with the address you specify, and sign the waiver themselves. You cannot sign for them.",
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
    emailHelp:
      "Only the Google account for this address can open and sign the link.",
    birthDate: "Date of birth",
    birthHelp:
      "If they are under 18, a guardian must sign in and sign instead.",
    notes: "Notes (only you see these)",
    create: "Create and get signing link",
    created: "Booked",
    linkTitle: "Signing link",
    linkHelp:
      "Copy this to the student (WeChat is fine). Valid for 7 days, single use. An email has also been attempted.",
    copy: "Copy link",
    copied: "Copied",
    another: "Book another",
    noDays: "Open some days under Availability first.",
    slotTaken: "That slot was just taken. Please choose another.",
    failed: "Could not create the booking. Please check the details.",
  },
} as const;

export function CoachBookingForm({
  locale,
  days,
  minHours,
  maxGroupSize,
  rates,
}: {
  locale: Locale;
  days: Day[];
  minHours: number;
  maxGroupSize: number;
  /** The coach's rate card, offered types only, in price-sheet order. */
  rates: RateRow[];
}) {
  const c = COPY[locale];
  const [lessonType, setLessonType] = useState(rates[0]?.lessonType ?? "");

  const [dateKey, setDateKey] = useState(days[0]?.dateKey ?? "");
  const [startHour, setStartHour] = useState<number | null>(null);
  const [hours, setHours] = useState(minHours);
  const [headcount, setHeadcount] = useState(1);
  const [studentName, setStudentName] = useState("");
  const [studentEmail, setStudentEmail] = useState("");
  const [studentBirthDate, setStudentBirthDate] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ code: string; url: string } | null>(
    null,
  );
  const [copied, setCopied] = useState(false);

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
    if (!day || startHour == null) return;
    setBusy(true);
    setError(null);

    const res = await fetch("/api/coach/bookings", {
      method: "POST",
      headers: { "content-type": "application/json", "x-locale": locale },
      body: JSON.stringify({
        date: day.dateKey,
        startHour,
        hours,
        lessonType,
        headcount,
        studentName,
        studentEmail,
        studentBirthDate,
        notes: notes || null,
      }),
    });
    setBusy(false);

    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error === "slot-taken" ? c.slotTaken : c.failed);
      return;
    }
    const j = (await res.json()) as { code: string; signingUrl: string };
    setResult({ code: j.code, url: j.signingUrl });
  }

  if (result) {
    return (
      <Card className="space-y-4">
        <CardTitle className="flex items-center gap-2">
          <Check className="size-5 text-emerald-600" aria-hidden />
          {c.created} · {result.code}
        </CardTitle>

        <div className="space-y-2">
          <Label htmlFor="link">{c.linkTitle}</Label>
          <div className="flex flex-wrap items-center gap-2">
            <input
              id="link"
              readOnly
              value={result.url}
              onFocus={(e) => e.currentTarget.select()}
              className="min-h-11 min-w-0 flex-1 rounded-lg border border-border bg-surface-muted px-3 font-mono text-xs"
            />
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(result.url);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                } catch {
                  /* selectable as a fallback */
                }
              }}
            >
              {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
              {copied ? c.copied : c.copy}
            </Button>
          </div>
          <Hint>{c.linkHelp}</Hint>
        </div>

        <Button
          variant="secondary"
          onClick={() => {
            setResult(null);
            setStartHour(null);
            setStudentName("");
            setStudentEmail("");
            setStudentBirthDate("");
            setNotes("");
          }}
        >
          {c.another}
        </Button>
      </Card>
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
                const hour = Number(e.target.value);
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
                onChange={(e) => setHeadcount(Number(e.target.value))}
              >
                {Array.from({ length: maxGroupSize }, (_, i) => i + 1).map(
                  (n) => (
                    <option key={n} value={n}>
                      {n} {c.people}
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
            <Label htmlFor="s-email">{c.email}</Label>
            <Input
              id="s-email"
              type="email"
              value={studentEmail}
              onChange={(e) => setStudentEmail(e.target.value)}
            />
            <Hint>{c.emailHelp}</Hint>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="s-dob">{c.birthDate}</Label>
            <Input
              id="s-dob"
              type="date"
              value={studentBirthDate}
              onChange={(e) => setStudentBirthDate(e.target.value)}
            />
            <Hint>{c.birthHelp}</Hint>
          </div>
        </div>

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
            startHour == null ||
            !studentName ||
            !studentEmail ||
            !studentBirthDate
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
