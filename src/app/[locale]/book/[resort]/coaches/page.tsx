import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { Link, redirect } from "@/i18n/navigation";
import { requireUserPage } from "@/lib/auth/require-user";
import { prisma } from "@/lib/prisma";
import { recommendCoaches } from "@/lib/booking/recommendation";
import { listBookableCoaches } from "@/lib/coach";
import { parseBookingSelection, toBookingSelectionQuery } from "@/lib/booking/selection";
import { coachCanTeachRequestedSkills, coachSkillOptions } from "@/lib/custom-skills";
import { csiaLabel, levelLabel, skillLabel } from "@/lib/skills";
import { earlyBirdWindow } from "@/lib/rates";
import { formatTorontoDate, formatTorontoTime, toDateKey, torontoWallTimeToUtc } from "@/lib/time";
import { lessonWindow } from "@/lib/pricing";
import { toLocale } from "@/i18n/routing";
import { BookingSteps } from "@/components/booking/booking-steps";
import { RateList } from "@/components/booking/rate-list";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { ArrowLeft, ArrowRight, BadgeCheck, Check, Clock, Wand2 } from "lucide-react";

export default async function ChooseCoachPage({ params, searchParams }: PageProps<"/[locale]/book/[resort]/coaches">) {
  const { locale, resort: resortSlug } = await params;
  setRequestLocale(locale);
  const query = await searchParams;
  const selection = parseBookingSelection(query);
  const callbackQuery = selection ? { ...toBookingSelectionQuery(selection), ...(query.recommend === "true" ? { recommend: "true" } : {}) } : {};
  const suffix = new URLSearchParams(callbackQuery).toString();
  const user = await requireUserPage({ locale, callbackPath: `/${locale}/book/${resortSlug}/coaches${suffix ? `?${suffix}` : ""}` });
  if (user.role === "COACH" || user.role === "ADMIN") redirect({ href: "/coach/bookings/new", locale });
  if (!selection) return redirect({ href: { pathname: `/book/${resortSlug}`, query: { ...Object.fromEntries(Object.entries(query).filter((entry): entry is [string, string] => typeof entry[1] === "string")), selectionError: "missing" } }, locale });
  const resort = await prisma.resort.findUnique({ where: { slug: resortSlug } });
  if (!resort?.isActive) notFound();
  const loc = toLocale(locale);
  const zh = loc === "zh";
  const [candidates, profiles] = await Promise.all([recommendCoaches({ resortSlug, dateKey: selection.dateKey, startHour: selection.startHour,
    hours: selection.hours, skills: selection.requestedSkills, level: selection.level,
    lessonType: selection.lessonType, headcount: selection.headcount }, user.id), listBookableCoaches(resortSlug)]);
  const coaches = candidates.filter((coach) => coachCanTeachRequestedSkills(selection.requestedSkills, coach));
  const selectedQuery = toBookingSelectionQuery(selection);
  const window = lessonWindow(torontoWallTimeToUtc(selection.dateKey, selection.startHour), torontoWallTimeToUtc(selection.dateKey, selection.startHour + selection.hours));
  const earlyBirdActive = earlyBirdWindow(toDateKey(new Date())).active;
  const skillLabels = new Map([...profiles, ...coaches].flatMap((coach) => coachSkillOptions(coach)).map((skill) => [skill.key, zh ? skill.zh : skill.en || skill.zh]));
  const selectedLabel = (key: string) => skillLabels.get(key) ?? (key.startsWith("custom:")
    ? zh ? "自定义动作（当前未提供）" : "Custom skill (not currently offered)" : skillLabel(key, loc));
  const helpRequested = query.recommend === "true";

  return (
    <div className="space-y-5">
      <BookingSteps locale={loc} current={3} />
      {query.coachUnavailable === "true" && <p role="alert" className="rounded-xl border border-amber-border bg-amber-bg p-4 text-sm text-amber">{zh ? "原先选择的教练目前无法满足所选动作或时段，请从符合条件的教练中重新选择，或调整动作与时间。" : "Your previous coach cannot currently accommodate your selected skills or time. Choose another matching coach or adjust your skills and time."}</p>}
      <div className="space-y-2"><p className="text-sm text-ink-3">{zh ? resort.nameZh : resort.nameEn}</p><h1 className="text-2xl">{zh ? "选择教练" : "Choose your coach"}</h1><p className="text-sm text-ink-2">{zh ? "先匹配能教全部已选动作、且在选定地点和时间可约的教练，再比较本雪季已排授课时数。" : "We first match coaches who teach all your selected skills and are available at your chosen resort and time, then compare scheduled teaching hours this season."}</p></div>
      <Card className="space-y-2">
        <p className="flex flex-wrap items-center gap-2 text-sm font-bold"><Clock className="size-4 text-accent" aria-hidden />{formatTorontoDate(window.lessonStartAt, loc)} · {formatTorontoTime(window.lessonStartAt, loc)} – {formatTorontoTime(window.lessonEndAt, loc)}</p>
        <p className="text-xs text-ink-3">{zh ? `预约 ${selection.hours} 小时，开头 10 分钟用于交接。` : `${selection.hours}-hour booking; the first ten minutes are for handover.`}</p>
        <div className="space-y-2 border-t border-border pt-3"><p className="text-sm font-semibold">{zh ? "已选动作" : "Selected skills"}</p>{selection.requestedSkills.length > 0
          ? <ul className="flex flex-wrap gap-2">{selection.requestedSkills.map((key) => <li key={key} className="rounded-full border border-accent/30 bg-accent-soft px-3 py-1 text-xs font-semibold text-accent">{selectedLabel(key)}</li>)}</ul>
          : <p className="text-xs text-ink-3">{zh ? "尚未指定动作，显示该时段可约教练。" : "No skills selected; showing coaches available at this time."}</p>}</div>
        <Link href={{ pathname: `/book/${resortSlug}`, query: selectedQuery }} className="inline-flex items-center gap-1.5 text-sm font-semibold text-accent"><ArrowLeft className="size-4" aria-hidden />{zh ? "修改时间或练习方向" : "Change time or practice focus"}</Link>
      </Card>
      {coaches.length === 0 ? <Card className="space-y-3"><CardTitle>{zh ? "这个选择暂无可约教练" : "No coaches are available for this selection"}</CardTitle><CardDescription>{zh ? "当前没有教练能在这个时段同时满足全部已选动作、课程类型和人数。请调整动作或时间；日期、时间和动作选择均已保留，我们不会自动改选教练。" : "No coach at this time can accommodate all your selected skills, lesson type and group size together. Adjust your skills or time; your date, time and skills have been kept, and no coach will be substituted automatically."}</CardDescription><Button asChild variant="secondary"><Link href={{ pathname: `/book/${resortSlug}`, query: selectedQuery }}>{zh ? "调整动作或时间" : "Adjust skills or time"}</Link></Button></Card>
        : <>
          <div className="rounded-xl border border-border bg-surface-2 p-4 text-sm text-ink-2"><p className="flex items-start gap-2"><Wand2 className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />{helpRequested ? zh ? "已标出推荐教练：先满足全部已选动作，再从符合条件者中推荐本雪季已排课时较少的教练。你也可选择列表中其他匹配教练。" : "Your recommendation is marked: all selected skills must match first, then we favor fewer scheduled hours this season among matching coaches. You can choose any other matching coach listed." : zh ? "列表只包含符合全部已选动作的教练，按本雪季已排课时排序。推荐课时较少者，选择任何一位都保留当前时间。" : "Only coaches matching all selected skills are listed, ordered by scheduled hours this season. A lighter schedule is recommended, and every choice keeps your selected time."}</p></div>
          <div className="stagger grid gap-4 sm:grid-cols-2">
            {coaches.map((coach) => {
              const certs = csiaLabel(coach.csiaLevel, coach.csiaParkLevel, loc);
              const skills = coachSkillOptions(coach);
              return <Link key={coach.userId} href={{ pathname: `/book/${resortSlug}/${coach.userId}`, query: selectedQuery }} className="block">
                <Card interactive className={`flex h-full flex-col gap-3 ${coach.recommended ? "border-accent/50" : ""}`}>
                  <div className="flex items-start gap-3">
                    {coach.avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={coach.avatarUrl} alt="" className="size-12 shrink-0 rounded-full border border-border object-cover" />
                    ) : (
                      <span aria-hidden className="font-display flex size-12 shrink-0 items-center justify-center rounded-full bg-accent-soft text-lg font-extrabold text-accent">{coach.displayName.slice(0, 1)}</span>
                    )}
                    <div className="min-w-0 flex-1"><h2 className="break-words text-lg">{coach.displayName}</h2>{certs.length > 0 && <p className="mt-1 flex flex-wrap gap-2 text-xs font-semibold text-accent">{certs.map((cert) => <span key={cert} className="inline-flex items-center gap-1"><BadgeCheck className="size-3.5" aria-hidden />{cert}</span>)}</p>}</div>
                    <ArrowRight className="size-4 shrink-0 text-ink-3" aria-hidden />
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs"><span className="font-semibold text-ink-2">{zh ? `本雪季已排 ${Number(coach.bookedHours.toFixed(1))} 小时` : `${Number(coach.bookedHours.toFixed(1))}h scheduled this season`}</span>{coach.recommended && <span className="rounded-full bg-accent-soft px-2.5 py-1 font-bold text-accent">{zh ? "推荐" : "Recommended"}</span>}</div>
                  {(zh ? coach.bioZh : coach.bioEn) && <CardDescription className="line-clamp-3">{zh ? coach.bioZh : coach.bioEn}</CardDescription>}
                  {selection.level && <p className="text-xs text-ink-3">{zh ? "水平参考：" : "Level context: "}{levelLabel(selection.level, loc)} · {coach.levelMatch === "listed" ? zh ? "教练已列为可教学水平" : "Listed by this coach" : zh ? "教学水平请先与教练确认" : "Confirm level suitability with this coach"}</p>}
                  {selection.requestedSkills.length > 0 && <div className="space-y-2 text-xs"><p className="font-semibold text-success">{zh ? "全部已选动作匹配" : "All selected skills matched"}</p><ul className="flex flex-wrap gap-1.5" aria-label={zh ? "匹配动作" : "Matching skills"}>{coach.matchedSkills.map((key) => <li key={key} className="inline-flex items-center gap-1 rounded-full border border-success/30 bg-success-bg px-2.5 py-1 text-success"><Check className="size-3" aria-hidden />{selectedLabel(key)}</li>)}</ul></div>}
                  <ul className="flex flex-wrap gap-1.5">{skills.slice(0, 6).map((skill) => <li key={skill.key} className="rounded-full border border-border px-2 py-0.5 text-[11px] font-semibold text-ink-2">{zh ? skill.zh : skill.en}</li>)}{skills.length > 6 && <li className="px-1 py-0.5 text-[11px] text-ink-3">+{skills.length - 6}</li>}</ul>
                  <div className="mt-auto space-y-2 border-t border-border pt-3"><RateList rates={coach.rates} locale={loc} earlyBirdActive={earlyBirdActive} /><p className="text-xs text-ink-3">{zh ? "一对一小时价格；人数和课费在下一步确认。" : "One-person hourly prices; group size and your total are confirmed next."}</p></div>
                </Card>
              </Link>;
            })}
          </div>
        </>}
    </div>
  );
}
