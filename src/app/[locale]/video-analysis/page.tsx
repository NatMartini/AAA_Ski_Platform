import { setRequestLocale } from "next-intl/server";
import { ArrowRight, CheckCircle2, ChevronDown, Clock3, Gift, Video } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { toLocale } from "@/i18n/routing";
import { requireUserPage } from "@/lib/auth/require-user";
import { getVideoAnalysisOverview } from "@/lib/video-analysis/overview";
import { getAccountVideoAnalysisState } from "@/lib/video-analysis/account-service";
import { getVideoAnalysisState } from "@/lib/video-analysis/service";
import { LESSON_ANALYSES } from "@/lib/video-analysis/quota";
import { formatTorontoDate, formatTorontoTime } from "@/lib/time";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { VideoAnalysisPanel } from "@/components/booking/video-analysis-panel";
import { AnalysisSourceSelector } from "@/components/booking/analysis-source-selector";
import { AnalysisCreditPurchase } from "@/components/booking/analysis-credit-purchase";
import type { VideoAnalysisView } from "@/components/booking/video-analysis-types";

/**
 * One account, one count, one list (owner's decision, 2026-11-07): the analyses left sit by the title with a line of
 * statistics, and every analysis the student runs appears in the list below. Lesson videos stay reachable from the
 * folded lesson list; coaches also switch to the lessons they teach there.
 */
export default async function VideoAnalysisPage({ params, searchParams }: PageProps<"/[locale]/video-analysis">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await requireUserPage({ locale, callbackPath: `/${locale}/video-analysis` });
  const loc = toLocale(locale);
  const zh = loc === "zh";
  const [{ courses }, account, query] = await Promise.all([
    getVideoAnalysisOverview(user), getAccountVideoAnalysisState(user), searchParams,
  ]);
  const coachView = user.role === "COACH" || user.role === "ADMIN";
  // Only codes in this identity's scoped overview can open a lesson's videos; the account is the default.
  const selectedCourse = typeof query.lesson === "string" ? courses.find(course => course.code === query.lesson) : undefined;
  // A student buys more through the coach of their latest completed lesson.
  const purchaseCourse = coachView ? undefined : courses.find(course => course.isCustomer && course.quota.active);
  const [selectedView, purchaseView] = await Promise.all([
    selectedCourse ? getVideoAnalysisState(selectedCourse.code, user) : account,
    purchaseCourse ? getVideoAnalysisState(purchaseCourse.code, user).catch(() => null) : null,
  ]);
  // Match the API's JSON DTO for dates passed into the client workspace.
  const view = JSON.parse(JSON.stringify(selectedView)) as VideoAnalysisView;
  const purchases = purchaseView ? JSON.parse(JSON.stringify(purchaseView)) as VideoAnalysisView : null;
  const quota = account.quota;
  // Coaches and administrators analyse without limit, their own clips and their lessons' alike.
  const unlimited = quota.unlimited;

  const lessonList = courses.map((course) => (
    <div key={course.code} className={`flex flex-wrap items-center gap-4 p-4 ${course.code === selectedCourse?.code ? "bg-cat-video-soft/40" : ""}`}>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-semibold">{zh ? course.resort.nameZh : course.resort.nameEn} · {course.coachName}</p>
          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${course.quota.active ? "bg-success-bg text-success" : "bg-surface-2 text-ink-2"}`}>
            {course.quota.active ? <CheckCircle2 className="size-3.5" aria-hidden /> : <Clock3 className="size-3.5" aria-hidden />}
            {course.quota.active ? (zh ? "已完成" : "Completed") : (zh ? "未上完" : "Not yet taught")}
          </span>
        </div>
        <p className="text-sm text-ink-2">
          {formatTorontoDate(course.startAt, loc)} · {formatTorontoTime(course.lessonStartAt, loc)}–{formatTorontoTime(course.lessonEndAt, loc)}
        </p>
        <p className="text-xs text-ink-3">
          <span className="font-mono">{course.code}</span> · {zh ? `${course.hours} 小时课 · 1v${course.headcount}` : `${course.hours}-hour lesson · 1-to-${course.headcount}`}
          {coachView && course.participantNameSnapshot ? ` · ${course.participantNameSnapshot}` : ""}
        </p>
      </div>
      <Button asChild variant="secondary" size="sm">
        <Link href={`/video-analysis?lesson=${encodeURIComponent(course.code)}#workspace`}>
          {zh ? "看这节课的视频" : "This lesson's videos"}<ArrowRight aria-hidden />
        </Link>
      </Button>
    </div>
  ));

  return (
    <div className="space-y-6">
      <PageHeader
        icon={<Video aria-hidden />}
        tone="video"
        eyebrow={<>FreeSki · {zh ? "来自 Kevin 的个人项目" : "From Kevin’s personal project"}</>}
        title={<span className="flex flex-wrap items-center gap-x-3 gap-y-1">{zh ? "视频分析" : "Video analysis"}
          <span className="inline-flex items-baseline gap-1 rounded-full bg-cat-video-soft px-3 py-1 text-sm font-semibold text-cat-video">
            {unlimited ? <span data-testid="analysis-remaining">{zh ? "不限次数" : "Unlimited"}</span> : <>{zh ? "可分析" : ""}
              <span className="font-display text-lg leading-none" data-testid="analysis-remaining">{quota.remaining}</span>{zh ? "次" : quota.remaining === 1 ? "analysis left" : "analyses left"}</>}
          </span></span>}
        description={zh ? "上传滑雪视频，FreeSki 对比 CSIA 示范给出评分、动作讲解和练习建议。"
          : "Upload a skiing video and FreeSki compares it with CSIA demonstrations for scores, movement explanations and drills."}
        actions={coachView ? <Button asChild variant="secondary" size="sm"><Link href="/coach/video-analysis"><Gift aria-hidden />{zh ? "给学员发放次数" : "Issue credits to a student"}</Link></Button> : undefined}
      />

      <details className="group rounded-xl border border-border bg-surface text-sm" aria-label={zh ? "分析次数" : "Analysis credits"}>
        <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 text-ink-2" data-numeric>
          {unlimited ? <span>{zh ? "教练账号，分析不限次数" : "Coach account: unlimited analyses"}</span>
            : <span>{zh ? `共获得 ${quota.earned} 次` : `${quota.earned} received`}</span>}
          <span>{zh ? `已用 ${quota.used} 次` : `${quota.used} used`}</span>
          <span>{zh ? `分析中 ${quota.reserved} 次` : `${quota.reserved} in progress`}</span>
          <span className="ml-auto inline-flex items-center gap-1 text-xs font-semibold text-ink-3">{zh ? "怎么算" : "How it works"}
            <ChevronDown className="size-4 shrink-0 transition-transform group-open:rotate-180" aria-hidden /></span>
        </summary>
        <div className="space-y-2 border-t border-border px-4 py-3 text-xs leading-relaxed text-ink-2">
          <p>{zh ? `注册送 3 次，每上完一节课再送 ${LESSON_ANALYSES} 次（一起上课、有账号的同伴各自也有），都直接进你的账户，什么时候用都行。教练也可以发放，或者微信购买。分析失败或无法评分不扣次数。`
            : `You get 3 analyses on joining and ${LESSON_ANALYSES} more for every lesson you complete (each companion with an account gets their own), straight into your account to use any time. Coaches can issue more, or you can buy them by WeChat. A failed or ungradable analysis does not use a credit.`}</p>
          {!unlimited && <p className="text-ink-3" data-numeric>{zh
            ? `注册 ${quota.freeTotal} · 上课 ${quota.lessonCount} 节 × ${LESSON_ANALYSES} = ${quota.lessonTotal} · 教练发放 ${quota.grantTotal} · 购买 ${quota.paidTotal}`
            : `Joining ${quota.freeTotal} · ${quota.lessonCount} lessons × ${LESSON_ANALYSES} = ${quota.lessonTotal} · coach-issued ${quota.grantTotal} · bought ${quota.paidTotal}`}</p>}
          {account.grants.length > 0 && <ul className="space-y-1 border-t border-border pt-2 text-ink-3">
            {account.grants.map(grant => <li key={grant.id}>
              {grant.coach.name ?? (zh ? "教练" : "Coach")} {zh ? `发放 ${grant.quantity} 次` : `issued ${grant.quantity}`} · {formatTorontoDate(new Date(grant.createdAt), loc)}
              {grant.note && <span className="block break-words">{grant.note}</span>}
            </li>)}
          </ul>}
        </div>
      </details>

      <section id="workspace" className="scroll-mt-28 space-y-4">
        {coachView && courses.length > 0 && <AnalysisSourceSelector locale={loc} value={selectedCourse?.code ?? "account"} accountRemaining={quota.remaining} accountUnlimited={unlimited}
          courses={courses.map(course => ({ code: course.code, remaining: course.quota.remaining,
            label: `${zh ? course.resort.nameZh : course.resort.nameEn} · ${course.coachName} · ${formatTorontoDate(course.startAt, loc)} · ${course.code}` }))} />}
        {selectedCourse && !coachView && <Link href="/video-analysis" className="inline-flex items-center gap-1 text-sm font-semibold text-accent hover:underline">
          ← {zh ? "回到我的分析" : "Back to my analyses"}</Link>}
        <VideoAnalysisPanel key={`${user.id}:${selectedCourse?.code ?? "account"}`} locale={loc}
          bookingCode={selectedCourse?.code ?? "account"} bookedHours={selectedCourse?.hours ?? 0}
          completed={view.quota.active} isCustomer={selectedCourse ? selectedCourse.isCustomer : true}
          isOwnCoach={selectedCourse?.isOwnCoach ?? false} canUpload={view.canUpload}
          initialVideos={view.videos} initialView={view} accountId={selectedCourse ? undefined : user.id} />
      </section>

      {purchases && purchaseCourse && <AnalysisCreditPurchase locale={loc} bookingCode={purchaseCourse.code} initialView={purchases} />}

      {courses.length > 0 ? <details className="group rounded-2xl border border-border bg-surface shadow-[var(--shadow-sm)]">
        <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-2 px-4 text-sm font-semibold">
          <span>{coachView ? (zh ? "我负责的课程" : "Lessons I teach") : (zh ? "课程视频" : "Lesson videos")} · {zh ? `${courses.length} 节` : courses.length}</span>
          <ChevronDown className="size-4 shrink-0 transition-transform group-open:rotate-180" aria-hidden />
        </summary>
        {!coachView && <p className="border-t border-border px-4 py-2 text-xs text-ink-3">{zh ? "教练在课上拍的视频和教练做的分析在这里，你随时能看。" : "Videos your coach filmed in lessons and the analyses they ran are here to watch any time."}</p>}
        <div className="divide-y divide-border border-t border-border">{lessonList}</div>
      </details>
        : <p className="text-sm text-ink-3">{zh ? `还没有课程；每上完一节课，账户里会多 ${LESSON_ANALYSES} 次分析。` : `No lessons yet; each lesson you complete adds ${LESSON_ANALYSES} analyses to your account.`}{" "}
          <Link href={coachView ? "/coach" : "/book"} className="font-semibold text-accent hover:underline">{coachView ? (zh ? "返回教练后台" : "Coach workspace") : (zh ? "预约课程" : "Book a lesson")}</Link></p>}
    </div>
  );
}
