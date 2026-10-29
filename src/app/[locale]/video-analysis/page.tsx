import { setRequestLocale } from "next-intl/server";
import { ArrowRight, CheckCircle2, Clock3, Gift, Video } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { toLocale } from "@/i18n/routing";
import { requireUserPage } from "@/lib/auth/require-user";
import { getVideoAnalysisOverview } from "@/lib/video-analysis/overview";
import { getAccountVideoAnalysisState } from "@/lib/video-analysis/account-service";
import { getVideoAnalysisState } from "@/lib/video-analysis/service";
import { formatTorontoDate, formatTorontoTime } from "@/lib/time";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader, SectionHeading } from "@/components/ui/page-header";
import { AnalysisOverviewRefresh } from "@/components/booking/analysis-overview-refresh";
import { VideoAnalysisPanel } from "@/components/booking/video-analysis-panel";
import { AnalysisSourceSelector } from "@/components/booking/analysis-source-selector";
import type { VideoAnalysisView } from "@/components/booking/video-analysis-types";

export default async function VideoAnalysisPage({ params, searchParams }: PageProps<"/[locale]/video-analysis">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await requireUserPage({ locale, callbackPath: `/${locale}/video-analysis` });
  const loc = toLocale(locale);
  const zh = loc === "zh";
  const [{ courses, totals }, account, query] = await Promise.all([
    getVideoAnalysisOverview(user), getAccountVideoAnalysisState(user), searchParams,
  ]);
  // Only codes in this identity's scoped overview can select a lesson workspace.
  const selectedCourse = typeof query.lesson === "string" ? courses.find(course => course.code === query.lesson)
    : query.source === "account" || account.quota.remaining > 0 ? undefined : courses.find(course => course.quota.active);
  const selectedView = selectedCourse ? await getVideoAnalysisState(selectedCourse.code, user) : account;
  // Match the API's JSON DTO for dates passed into the client workspace.
  const view = JSON.parse(JSON.stringify(selectedView)) as VideoAnalysisView;
  const coachView = user.role === "COACH" || user.role === "ADMIN";
  const remaining = totals.remaining + account.quota.remaining;

  return (
    <div className="space-y-8">
      <PageHeader
        icon={<Video aria-hidden />}
        tone="video"
        eyebrow={<>FreeSki · {zh ? "来自 Kevin 的个人项目" : "From Kevin’s personal project"}</>}
        title={zh ? "视频分析" : "Video analysis"}
        description={zh ? "上传滑雪视频，FreeSki 对比 CSIA 示范给出评分卡、动作讲解和练习建议。每节 2 小时课赠送 3 次分析，3 小时课赠送 5 次；1v1、1v2、1v3 都使用同一节课的次数。"
          : "Upload a skiing video and FreeSki compares it with CSIA demonstrations for a scorecard, movement explanation and drills. Each two-hour lesson includes 3 analyses; each three-hour lesson includes 5. The same allowance applies to 1-to-1, 1-to-2 and 1-to-3 lessons."}
        actions={<>
          {coachView && <Button asChild variant="secondary"><Link href="/coach/video-analysis"><Gift aria-hidden />{zh ? "给学员发放 FreeSki 次数" : "Issue FreeSki credits to a student"}</Link></Button>}
          <AnalysisOverviewRefresh locale={loc} />
        </>}
      />

      <section aria-label={zh ? "分析次数" : "Analysis credits"} className="grid gap-3 sm:grid-cols-[minmax(0,1.3fr)_repeat(3,minmax(0,1fr))]">
        <div className="rounded-2xl bg-cat-video-soft p-5">
          <p className="text-sm font-semibold text-cat-video">{zh ? "当前可分析" : "Currently available"}</p>
          <p className="font-display mt-1 text-5xl font-bold text-cat-video" data-testid="analysis-remaining">
            {remaining}<span className="ml-2 text-base font-semibold">{zh ? "次" : "analyses"}</span>
          </p>
        </div>
        <Metric label={zh ? "处理中" : "Processing"} value={totals.reserved + account.quota.reserved} />
        <Metric label={zh ? "已使用" : "Used"} value={totals.used + account.quota.used} />
        <div className="rounded-2xl border border-border bg-surface p-4 shadow-[var(--shadow-sm)]">
          <p className="text-xs font-semibold text-ink-3">{zh ? "次数来源" : "Where credits come from"}</p>
          <dl className="mt-2 space-y-1 text-sm" data-numeric>
            <Source label={zh ? "教练发放" : "Coach-issued"} value={account.quota.grantTotal ?? 0} />
            <Source label={zh ? "已解锁免费" : "Free unlocked"} value={totals.freeTotal} />
            <Source label={zh ? "已购买" : "Purchased"} value={totals.paidTotal} />
          </dl>
        </div>
        <p className="text-xs leading-relaxed text-ink-3 sm:col-span-4">
          {zh ? "教练发放即时到账，无需课程订单。课程免费次数在完课后解锁；额外次数经教练确认收款后到账。分析失败或无法评分会返还次数。"
            : "Coach-issued credits are available immediately without a lesson booking. Lesson credits unlock after completion; purchased credits unlock after receipt confirmation. Failed or ungradable analyses return their credit."}
        </p>
      </section>

      <section id="workspace" className="scroll-mt-28 space-y-4">
        <SectionHeading title={zh ? "视频库" : "Video library"}
          description={zh ? "按分析状态分类，显示每个视频的上传、提交和完成时间。" : "Grouped by analysis status, with when each video was uploaded, submitted and finished."} />
        <div className="max-w-xl">
          <AnalysisSourceSelector locale={loc} value={selectedCourse?.code ?? "account"} accountRemaining={account.quota.remaining}
            courses={courses.map(course => ({ code: course.code, remaining: course.quota.remaining,
              label: `${zh ? course.resort.nameZh : course.resort.nameEn} · ${course.coachName} · ${formatTorontoDate(course.startAt, loc)} · ${course.code}` }))} />
        </div>
        <VideoAnalysisPanel key={`${user.id}:${selectedCourse?.code ?? "account"}`} locale={loc}
          bookingCode={selectedCourse?.code ?? "account"} bookedHours={selectedCourse?.hours ?? 0}
          completed={view.quota.active} isCustomer={selectedCourse ? selectedCourse.isCustomer : true}
          isOwnCoach={selectedCourse?.isOwnCoach ?? false} canUpload={view.canUpload}
          initialVideos={view.videos} initialView={view} accountId={selectedCourse ? undefined : user.id} />
        {!selectedCourse && account.grants.length > 0 && <details className="group rounded-2xl border border-border bg-surface p-4">
          <summary className="cursor-pointer text-sm font-semibold">{zh ? "查看次数发放记录" : "View issued-credit history"}</summary>
          <ul className="mt-3 space-y-3 text-sm">{account.grants.map(grant => <li key={grant.id} className="border-t border-border pt-3">
            <p>{grant.coach.name ?? (zh ? "教练" : "Coach")} · {zh ? `${grant.quantity} 次` : `${grant.quantity} credits`} · {formatTorontoDate(new Date(grant.createdAt), loc)}</p>
            {grant.note && <p className="mt-1 break-words text-ink-2">{grant.note}</p>}
          </li>)}</ul>
        </details>}
      </section>

      <section className="space-y-3">
        <SectionHeading title={coachView ? (zh ? "我负责的课程" : "My lessons") : (zh ? "我的课程" : "My lessons")}
          description={zh ? "选择对应课程上传视频。次数随该课程使用，多人课共用，不跨课程转移。"
            : "Choose a lesson to upload a video. Credits belong to that lesson, are shared by its group, and cannot be transferred to another lesson."} />
        {courses.length === 0 ? (
          <EmptyState title={zh ? "还没有已确认或已完成的课程。" : "No confirmed or completed lessons yet."}
            description={zh ? "课程完成后，你的分析次数会显示在这里。" : "Your analysis credits will appear here after lesson completion."}
            action={<Button asChild variant="secondary"><Link href={coachView ? "/coach" : "/book"}>
              {coachView ? (zh ? "返回教练后台" : "Coach workspace") : (zh ? "预约课程" : "Book a lesson")}<ArrowRight aria-hidden />
            </Link></Button>} />
        ) : <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface shadow-[var(--shadow-sm)]">
          {courses.map((course) => (
            <div key={course.code} className={`flex flex-wrap items-center gap-4 p-4 ${course.code === selectedCourse?.code ? "bg-cat-video-soft/40" : ""}`}>
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold">{zh ? course.resort.nameZh : course.resort.nameEn} · {course.coachName}</p>
                  <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${course.quota.active ? "bg-success-bg text-success" : "bg-surface-2 text-ink-2"}`}>
                    {course.quota.active ? <CheckCircle2 className="size-3.5" aria-hidden /> : <Clock3 className="size-3.5" aria-hidden />}
                    {course.quota.active ? (zh ? "已完成" : "Completed") : (zh ? "待课后解锁" : "Unlocks after lesson")}
                  </span>
                </div>
                <p className="text-sm text-ink-2">
                  {formatTorontoDate(course.startAt, loc)} · {formatTorontoTime(course.lessonStartAt, loc)}–{formatTorontoTime(course.lessonEndAt, loc)}
                </p>
                <p className="text-xs text-ink-3">
                  <span className="font-mono">{course.code}</span> · {zh ? `${course.hours} 小时课 · 1v${course.headcount} · 本节包含 ${course.includedCredits} 次共享免费分析`
                    : `${course.hours}-hour lesson · 1-to-${course.headcount} · ${course.includedCredits} shared free analyses`}
                  {coachView && course.participantNameSnapshot ? ` · ${course.participantNameSnapshot}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-4">
                <div className="text-right">
                  <p className="font-display text-lg font-bold text-cat-video" data-numeric>{zh ? `可用 ${course.quota.remaining} 次` : `${course.quota.remaining} available`}</p>
                  <p className="text-xs text-ink-3" data-numeric>
                    {zh ? `已使用 ${course.quota.used} · 处理中 ${course.quota.reserved} · 已购 ${course.quota.paidTotal}`
                      : `${course.quota.used} used · ${course.quota.reserved} processing · ${course.quota.paidTotal} purchased`}
                  </p>
                </div>
                <Button asChild variant={course.quota.active ? "primary" : "secondary"} size="sm">
                  <Link href={`/video-analysis?lesson=${encodeURIComponent(course.code)}#workspace`}>
                    {course.quota.active ? (zh ? "上传视频 / 分析" : "Upload / analyse") : (zh ? "查看课程" : "View lesson")}<ArrowRight aria-hidden />
                  </Link>
                </Button>
              </div>
            </div>
          ))}
        </div>}
      </section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return <div className="rounded-2xl border border-border bg-surface p-4 shadow-[var(--shadow-sm)]">
    <p className="text-xs font-semibold text-ink-3">{label}</p>
    <p className="font-display mt-1 text-3xl font-bold" data-numeric>{value}</p>
  </div>;
}

function Source({ label, value }: { label: string; value: number }) {
  return <div className="flex items-center justify-between gap-3"><dt className="text-ink-2">{label}</dt><dd className="font-semibold">{value}</dd></div>;
}
