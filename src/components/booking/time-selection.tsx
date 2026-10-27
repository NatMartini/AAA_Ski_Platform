"use client";

import { useState } from "react";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import type { BookingSelection } from "@/lib/booking/selection";
import { toBookingSelectionQuery } from "@/lib/booking/selection";
import type { SkillOption } from "@/lib/custom-skills";
import { LEVELS, isSkillKey, skillLabel } from "@/lib/skills";
import { formatTorontoDate, formatTorontoTime, isDateKey, torontoWallTimeToUtc } from "@/lib/time";
import { lessonWindow } from "@/lib/pricing";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { FieldError, Label, Select } from "@/components/ui/field";
import { DateCalendar } from "./date-calendar";
import { SkillPicker } from "./skill-picker";
import { ArrowRight, CalendarDays, Clock, Wand2, X } from "lucide-react";

export type TimeSelectionDay = {
  dateKey: string;
  coachIds: string[];
  startOptions: { hour: number; startAt: string; durations: number[]; coachIdsByDuration: Record<number, string[]> }[];
};
type TimeCoach = { userId: string; skills: SkillOption[] };

export function TimeSelection({ locale, resortSlug, days, coaches, initialSelection, askedDate, initialLevel = null, initialRequestedSkills = [], initialLessonType, initialHeadcount, selectionError }: {
  locale: Locale;
  resortSlug: string;
  days: TimeSelectionDay[];
  coaches: TimeCoach[];
  initialSelection: BookingSelection | null;
  askedDate?: string;
  initialLevel?: string | null;
  initialRequestedSkills?: string[];
  initialLessonType?: string;
  initialHeadcount?: number;
  selectionError?: "missing" | "unavailable";
}) {
  const zh = locale === "zh";
  const requestedDate = initialSelection?.dateKey ?? (askedDate && isDateKey(askedDate) ? askedDate : undefined);
  const initialDay = requestedDate ? days.find((day) => day.dateKey === requestedDate) : days[0];
  const initialStart = initialSelection && initialDay?.dateKey === initialSelection.dateKey
    ? initialDay?.startOptions.find((option) => option.hour === initialSelection.startHour && option.durations.includes(initialSelection.hours)) : undefined;
  const wantedSkills = initialSelection?.requestedSkills ?? initialRequestedSkills;
  const [dateKey, setDateKey] = useState(requestedDate ?? initialDay?.dateKey ?? "");
  const [startHour, setStartHour] = useState<number | null>(initialStart?.hour ?? null);
  const [hours, setHours] = useState(initialStart ? initialSelection!.hours : 2);
  const [level, setLevel] = useState(initialSelection?.level ?? initialLevel ?? "");
  const [skills, setSkills] = useState(wantedSkills);
  const [skillLimit, setSkillLimit] = useState(false);
  const day = days.find((candidate) => candidate.dateKey === dateKey);
  const option = day?.startOptions.find((candidate) => candidate.hour === startHour);
  const ready = Boolean(option?.durations.includes(hours));
  const availableCoachIds = ready ? option!.coachIdsByDuration[hours] ?? [] : day?.coachIds ?? [];
  const availableSkills = skillsForCoaches(availableCoachIds, coaches);
  const requiredSkills = skills.filter((key) => isSkillKey(key) || key.startsWith("custom:"));
  const hasSkillMatch = coaches.some((coach) => availableCoachIds.includes(coach.userId)
    && requiredSkills.every((key) => coach.skills.some((skill) => skill.key === key)));
  const selectedLabels = new Map(skillsForCoaches(coaches.map((coach) => coach.userId), coaches).map((skill) => [skill.key, zh ? skill.zh : skill.en || skill.zh]));
  const selectedLabel = (key: string) => selectedLabels.get(key) ?? (key.startsWith("custom:")
    ? zh ? "自定义动作（当前未提供）" : "Custom skill (not currently offered)" : skillLabel(key, locale));
  const effectiveError = selectionError ?? (initialSelection && !initialStart ? "unavailable" : undefined);
  const selection: BookingSelection | null = ready ? {
    dateKey, startHour: startHour!, hours, requestedSkills: skills, level: level || null,
    ...((initialSelection?.lessonType ?? initialLessonType) ? { lessonType: initialSelection?.lessonType ?? initialLessonType } : {}),
    ...((initialSelection?.headcount ?? initialHeadcount) ? { headcount: initialSelection?.headcount ?? initialHeadcount } : {}),
  } : null;
  const query = selection ? new URLSearchParams(toBookingSelectionQuery(selection)).toString() : "";
  const target = `/book/${resortSlug}/coaches?${query}`;
  const window = ready ? lessonWindow(torontoWallTimeToUtc(dateKey, startHour!), torontoWallTimeToUtc(dateKey, startHour! + hours)) : null;

  function selectDay(next: string) {
    setDateKey(next);
    setStartHour(null);
    setSkillLimit(false);
  }

  function selectTime(nextHour: number, nextHours: number) {
    setStartHour(nextHour);
    setHours(nextHours);
    setSkillLimit(false);
  }

  if (days.length === 0) return <Card className="space-y-3"><CardDescription>{zh ? "这个雪场暂时没有可约时间。请选择其他雪场，或稍后再来查看。" : "There are no bookable times at this resort yet. Choose another resort or check again later."}</CardDescription><Button asChild variant="secondary"><Link href="/book">{zh ? "查看其他雪场" : "View other resorts"}</Link></Button></Card>;

  return (
    <div className="space-y-5">
      {effectiveError && <p role="alert" className="rounded-xl border border-amber-border bg-amber-bg p-4 text-sm text-amber">{effectiveError === "unavailable"
        ? zh ? "之前选择的时间已无法预约，请重新选择。我们没有替你更换时间。" : "Your previous time is no longer available. Please choose again; your time has not been replaced."
        : zh ? "请先选择完整的日期、开始时间和时长，再选教练。" : "Choose a date, start time and duration before choosing a coach."}</p>}
      <Card className="space-y-5">
        <CardTitle className="flex items-center gap-2"><CalendarDays className="size-5 text-accent" aria-hidden />{zh ? "日期和时间" : "Date and time"}</CardTitle>
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>{zh ? "选择日期" : "Choose a date"}</Label>
            <DateCalendar locale={locale} available={days.map((candidate) => candidate.dateKey)} selected={dateKey} onSelect={selectDay} labels={{ prev: zh ? "上一个月" : "Previous month", next: zh ? "下一个月" : "Next month", none: zh ? "暂无日期" : "No dates available" }} />
            <p className="text-sm font-semibold text-ink-2">{formatTorontoDate(torontoWallTimeToUtc(dateKey, 12), locale)}</p>
          </div>
          <div className="space-y-4">
            <fieldset className="space-y-2">
              <legend className="mb-2 text-sm font-semibold">{zh ? "开始时间" : "Start time"}</legend>
              <div className="grid grid-cols-3 gap-2">
                {day?.startOptions.map((start) => <button key={start.hour} type="button" aria-pressed={startHour === start.hour} onClick={() => selectTime(start.hour, start.durations.includes(hours) ? hours : start.durations[0])} className={cn("press min-h-11 rounded-xl border px-2 text-sm font-semibold tabular-nums", startHour === start.hour ? "border-accent bg-accent text-accent-foreground" : "border-border bg-surface hover:border-accent")}>
                  {String(start.hour).padStart(2, "0")}:00
                </button>)}
              </div>
              {!day && <p className="text-sm text-ink-2">{zh ? "这一天暂时没有可约时间，请选择其他日期。" : "There are no bookable times on this date. Please choose another date."}</p>}
            </fieldset>
            {option && <div className="space-y-2"><Label htmlFor="time-duration">{zh ? "预约时长" : "Booking duration"}</Label><Select id="time-duration" value={hours} onChange={(event) => selectTime(option.hour, Number(event.target.value))}>{option.durations.map((duration) => <option key={duration} value={duration}>{duration} {zh ? "小时" : "hours"}</option>)}</Select></div>}
            {window && <div role="status" className="space-y-1 rounded-xl border border-border bg-surface-3 p-4 text-sm">
              <p className="flex items-center gap-2 font-bold"><Clock className="size-4 text-accent" aria-hidden />{zh ? "实际授课" : "Teaching time"}: {formatTorontoTime(window.lessonStartAt, locale)} – {formatTorontoTime(window.lessonEndAt, locale)}</p>
              <p className="text-xs leading-relaxed text-ink-3">{zh ? "开头 10 分钟用于交接；确认订单时会列出交接优惠。所有时间均为多伦多时间。" : "The first ten minutes are for handover; your order will show the handover credit. All times are Toronto time."}</p>
            </div>}
          </div>
        </div>
      </Card>

      <Card className="space-y-4">
        <div className="space-y-1"><CardTitle>{zh ? "想练什么？（选填）" : "What would you like to practise? (optional)"}</CardTitle><CardDescription>{zh ? "先匹配能教全部已选动作的教练，再从中推荐本雪季已排课时较少者。最多选择 12 项；还没想好也可留空。" : "First we match coaches who teach all your selected skills, then recommend a coach with fewer scheduled hours this season. Choose up to 12, or leave this blank."}</CardDescription><p className="text-xs text-ink-3">{ready ? zh ? "选项来自当前时段可约教练。修改时间会保留已选动作。" : "Options come from coaches available at this time. Changing time keeps your selected skills." : zh ? "选项来自当天教练，选定时间后会更新可选动作。" : "Options come from that day's coaches and update after you choose a time."}</p></div>
        {skills.length > 0 && <div className="flex flex-wrap gap-2" aria-label={zh ? "已选练习方向" : "Selected practice focus"}>{skills.map((key) => <button key={key} type="button" className="press inline-flex min-h-9 items-center gap-1.5 rounded-full border border-accent bg-accent-soft px-3 text-xs font-semibold text-accent" onClick={() => setSkills(skills.filter((skill) => skill !== key))} aria-label={`${zh ? "取消选择" : "Deselect"} ${selectedLabel(key)}`}>{selectedLabel(key)}<X className="size-3" aria-hidden /></button>)}</div>}
        {availableSkills.length > 0 && <SkillPicker locale={locale} selected={skills} maxSelected={12} onChange={(next) => { setSkillLimit(next.length > 12); if (next.length <= 12) setSkills(next); }} allowed={availableSkills.filter((skill) => !skill.key.startsWith("custom:")).map((skill) => skill.key)} customSkills={availableSkills.filter((skill) => skill.key.startsWith("custom:"))} labels={{ alpine: zh ? "滑行" : "Alpine", park: zh ? "公园" : "Park", tier: zh ? "级别 {n}" : "Level {n}" }} />}
        <FieldError>{skillLimit ? zh ? "最多选择 12 个练习方向。" : "Choose at most 12 skills." : null}</FieldError>
        {ready && requiredSkills.length > 0 && !hasSkillMatch && <p role="status" className="rounded-xl border border-amber-border bg-amber-bg p-3 text-sm text-amber">{zh ? "当前时段没有教练能同时教全部已选动作。请调整动作或时间；你的选择已保留。" : "No coach at this time teaches all your selected skills. Adjust your skills or time; your selections have been kept."}</p>}
        {availableSkills.length === 0 && <p className="text-sm text-ink-3">{zh ? "当前教练尚未配置练习动作。可先留空查看该时段教练，或换一个时间。" : "These coaches have not configured any skills. Leave this blank to view available coaches, or choose another time."}</p>}
        <div className="max-w-sm space-y-2 border-t border-border pt-4"><Label htmlFor="time-level" className="text-ink-2">{zh ? "目前水平（选填）" : "Current level (optional)"}</Label><p id="time-level-hint" className="text-xs text-ink-3">{zh ? "补充信息，仅供沟通参考；匹配以所选动作为准。" : "Optional context for your coach; matching is based on your selected skills."}</p><Select id="time-level" aria-describedby="time-level-hint" value={level} onChange={(event) => setLevel(event.target.value)}><option value="">{zh ? "暂不确定" : "Not sure yet"}</option>{LEVELS.map((entry) => <option key={entry.key} value={entry.key}>{zh ? entry.zh : entry.en}</option>)}</Select></div>
      </Card>
      <div className="flex flex-wrap gap-3">
        {ready ? <><Button asChild><Link href={target}>{zh ? "查看可约教练" : "View available coaches"}<ArrowRight aria-hidden /></Link></Button><Button asChild variant="secondary"><Link href={`${target}&recommend=true`}><Wand2 aria-hidden />{zh ? "不知道选什么 / 帮我推荐" : "Not sure? Recommend a coach"}</Link></Button></>
          : <><Button disabled>{zh ? "查看可约教练" : "View available coaches"}<ArrowRight aria-hidden /></Button><Button disabled variant="secondary"><Wand2 aria-hidden />{zh ? "不知道选什么 / 帮我推荐" : "Not sure? Recommend a coach"}</Button></>}
      </div>
    </div>
  );
}

function skillsForCoaches(coachIds: string[], coaches: TimeCoach[]): SkillOption[] {
  const choices = new Map<string, SkillOption>();
  for (const coach of coaches) if (coachIds.includes(coach.userId)) for (const skill of coach.skills) choices.set(skill.key, skill);
  return [...choices.values()];
}
