import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { Link, redirect } from "@/i18n/navigation";
import { prisma } from "@/lib/prisma";
import { requireUserPage } from "@/lib/auth/require-user";
import { listBookableCoaches } from "@/lib/coach";
import { listResortBookingDays } from "@/lib/booking/recommendation";
import { parseBookingSelection, toBookingSelectionQuery } from "@/lib/booking/selection";
import { coachSkillOptions } from "@/lib/custom-skills";
import { isLevelKey } from "@/lib/skills";
import { isLessonTypeKey } from "@/lib/lesson-types";
import { isDateKey } from "@/lib/time";
import { toLocale } from "@/i18n/routing";
import { BookingSteps } from "@/components/booking/booking-steps";
import { TimeSelection } from "@/components/booking/time-selection";
import { ArrowLeft } from "lucide-react";

export default async function ChooseTimePage({ params, searchParams }: PageProps<"/[locale]/book/[resort]">) {
  const { locale, resort: resortSlug } = await params;
  setRequestLocale(locale);
  const query = await searchParams;
  const selection = parseBookingSelection(query);
  const askedDate = typeof query.askedDate === "string" ? query.askedDate : typeof query.date === "string" ? query.date : undefined;
  const level = selection?.level ?? (typeof query.level === "string" && isLevelKey(query.level) ? query.level : null);
  const lessonType = typeof query.lessonType === "string" && isLessonTypeKey(query.lessonType) ? query.lessonType : undefined;
  const headcount = typeof query.headcount === "string" && /^[1-3]$/.test(query.headcount) ? Number(query.headcount) : undefined;
  const requestedSkills = typeof query.requestedSkills === "string" ? [...new Set(query.requestedSkills.split(",").filter(Boolean))] : [];
  const validSkills = requestedSkills.length <= 12 && requestedSkills.every((key) => key.length <= 96 && /^[a-zA-Z0-9_:-]+$/.test(key));
  const callbackQuery = selection ? toBookingSelectionQuery(selection) : {
    ...(askedDate && isDateKey(askedDate) ? { askedDate } : {}),
    ...(level ? { level } : {}), ...(lessonType ? { lessonType } : {}),
    ...(headcount ? { headcount: String(headcount) } : {}),
    ...(validSkills && requestedSkills.length > 0 ? { requestedSkills: requestedSkills.join(",") } : {}),
  };
  const suffix = new URLSearchParams(callbackQuery).toString();
  const user = await requireUserPage({ locale, callbackPath: `/${locale}/book/${resortSlug}${suffix ? `?${suffix}` : ""}` });
  if (user.role === "COACH" || user.role === "ADMIN") redirect({ href: "/coach/bookings/new", locale });
  const resort = await prisma.resort.findUnique({ where: { slug: resortSlug } });
  if (!resort?.isActive) notFound();
  const loc = toLocale(locale);
  const zh = loc === "zh";
  const [days, coaches] = await Promise.all([listResortBookingDays(resortSlug), listBookableCoaches(resortSlug)]);
  return (
    <div className="space-y-5">
      <BookingSteps locale={loc} current={2} />
      <div className="space-y-2">
        <p className="text-sm text-ink-3">{zh ? resort.nameZh : resort.nameEn}</p>
        <h1 className="text-2xl">{zh ? "选择日期和时间" : "Choose your date and time"}</h1>
        <p className="text-sm text-ink-2">{zh ? "选定时间后，再查看这个时间可以约的教练。" : "Choose a time to see the coaches available for that exact slot."}</p>
      </div>
      <Link href="/book" className="inline-flex items-center gap-1.5 text-sm font-semibold text-accent"><ArrowLeft className="size-4" aria-hidden />{zh ? "换一个雪场" : "Change resort"}</Link>
      <TimeSelection
        key={`${resortSlug}:${JSON.stringify(query)}`}
        locale={loc} resortSlug={resortSlug}
        days={days.map((day) => ({ ...day, startOptions: day.startOptions.map((option) => ({ ...option, startAt: option.startAt.toISOString() })) }))}
        coaches={coaches.map((coach) => ({ userId: coach.userId, skills: coachSkillOptions(coach) }))}
        initialSelection={selection} askedDate={askedDate} initialLevel={level}
        initialRequestedSkills={validSkills ? requestedSkills : []}
        initialLessonType={lessonType} initialHeadcount={headcount}
        selectionError={query.selectionError === "missing" || query.selectionError === "unavailable" ? query.selectionError : undefined}
      />
    </div>
  );
}
