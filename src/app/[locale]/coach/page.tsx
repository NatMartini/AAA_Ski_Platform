import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { prisma } from "@/lib/prisma";
import { requireCoachPage } from "@/lib/auth/require-user";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader, SectionHeading } from "@/components/ui/page-header";
import { StatTile } from "@/components/coach/stat-tile";
import { BookingRow } from "@/components/booking/booking-row";
import { setupGaps } from "@/lib/coach";
import { formatMoney } from "@/lib/pricing";
import { toLocale } from "@/i18n/routing";
import { toDateKey, addDaysToDateKey, torontoWallTimeToUtc } from "@/lib/time";
import { CalendarDays, CheckCircle2, ChevronRight, LayoutDashboard, TriangleAlert, UserRoundPlus, Video } from "lucide-react";

const GAP_COPY = {
  zh: {
    rates: "在设置里填写至少一种课程的价格",
    cancellationPolicyZh: "填写中文取消政策",
    cancellationPolicyEn: "填写英文取消政策",
    paymentMethod: "至少启用一种收款方式",
    published: "打开「开放预定」",
  },
  en: {
    rates: "Price at least one lesson type in Settings",
    cancellationPolicyZh: "Write the Chinese cancellation policy",
    cancellationPolicyEn: "Write the English cancellation policy",
    paymentMethod: "Enable at least one payment method",
    published: "Turn on 'Open for bookings'",
  },
} as const;

export default async function CoachTodayPage({
  params,
}: PageProps<"/[locale]/coach">) {
  const { locale } = await params;
  setRequestLocale(locale);

  const user = await requireCoachPage({ locale });
  const t = await getTranslations("coach");
  const video = await getTranslations("videoAnalysis");
  const loc = toLocale(locale);
  const zh = loc === "zh";

  const todayKey = toDateKey(new Date());
  const todayStart = torontoWallTimeToUtc(todayKey, 0);
  const afterTomorrow = torontoWallTimeToUtc(addDaysToDateKey(todayKey, 2), 0);

  const [profile, todays, upcoming, needsAttention, packagesToCheck, analysisPayments, endedLessons] = await Promise.all([
    prisma.coachProfile.findUnique({
      where: { userId: user.id },
      include: { rates: true },
    }),
    prisma.booking.findMany({
      where: {
        coachId: user.id,
        status: { in: ["CONFIRMED", "PENDING_PAYMENT_REVIEW"] },
        startAt: {
          gte: todayStart,
          lt: afterTomorrow,
        },
      },
      include: { resort: true, participant: true },
      orderBy: { startAt: "asc" },
    }),
    prisma.booking.findMany({
      where: { coachId: user.id, status: "CONFIRMED", startAt: { gte: afterTomorrow } },
      include: { resort: true, participant: true },
      orderBy: { startAt: "asc" },
      take: 5,
    }),
    prisma.booking.findMany({
      where: {
        coachId: user.id,
        status: { in: ["PENDING_PAYMENT_REVIEW", "AWAITING_WAIVER", "AWAITING_PAYMENT", "PAYMENT_REJECTED"] },
        OR: [{ status: { not: "AWAITING_PAYMENT" } }, { holdExpiresAt: null }, { holdExpiresAt: { gt: new Date() } }],
      },
      include: { resort: true, participant: true },
      orderBy: { startAt: "asc" },
      take: 20,
    }),
    prisma.lessonPackage.count({
      where: { payeeCoachId: user.id, status: "PENDING_PAYMENT_REVIEW" },
    }),
    prisma.videoAnalysisPurchase.findMany({
      where: { payeeCoachId: user.id, status: "PENDING_PAYMENT_REVIEW" },
      select: { id: true, quantity: true, totalCents: true, booking: { select: { code: true } } },
      orderBy: { paymentSubmittedAt: "asc" }, take: 20,
    }),
    prisma.booking.findMany({
      where: { coachId: user.id, status: "CONFIRMED", lessonEndAt: { lte: new Date() } },
      select: { id: true, code: true, participantNameSnapshot: true },
      orderBy: { lessonEndAt: "desc" }, take: 10,
    }),
  ]);

  const gaps = profile ? setupGaps(profile) : [];
  const attentionCount = needsAttention.length + (packagesToCheck > 0 ? 1 : 0) + analysisPayments.length + endedLessons.length;
  const row = (b: (typeof todays)[number]) => (
    <BookingRow
      key={b.id}
      locale={loc}
      href={`/booking/${b.code}`}
      booking={{
        code: b.code,
        status: b.status,
        startAt: b.startAt,
        lessonStartAt: b.lessonStartAt,
        lessonEndAt: b.lessonEndAt,
        totalCents: b.totalCents,
        lessonType: b.lessonType,
        paidByPackage: b.paymentPlan === "PACKAGE",
        resortName: zh ? b.resort.nameZh : b.resort.nameEn,
        otherPartyName: b.participantNameSnapshot ?? b.participant?.fullName ?? b.inviteName ?? "—",
        hasWaiver: Boolean(b.waiverId),
      }}
    />
  );

  return (
    <div className="space-y-6">
      <PageHeader
        icon={<LayoutDashboard aria-hidden />}
        title={zh ? `你好，${user.name ?? user.email}` : `Hello, ${user.name ?? user.email}`}
        description={zh ? "今明两天的课程、需要你处理的事项和常用入口。" : "Today's and tomorrow's lessons, items waiting on you and shortcuts."}
        actions={<>
          <Button asChild><Link href="/coach/bookings/new"><UserRoundPlus aria-hidden />{t("newBooking")}</Link></Button>
          <Button asChild variant="secondary"><Link href="/video-analysis"><Video aria-hidden />{zh ? "视频分析" : "Video analysis"}</Link></Button>
        </>}
      />

      {gaps.length > 0 && (
        <div className="space-y-2 rounded-2xl border border-amber-border bg-amber-bg p-4 sm:p-5">
          <p className="flex items-center gap-2 font-semibold text-amber">
            <TriangleAlert className="size-4" aria-hidden />
            {zh ? "还不能接单" : "Not taking bookings yet"}
          </p>
          <ul className="list-inside list-disc text-sm text-ink-2">
            {gaps.map((gap) => (
              <li key={gap}>
                {GAP_COPY[loc][gap as keyof (typeof GAP_COPY)["zh"]] ?? gap}
              </li>
            ))}
          </ul>
          <Link href="/coach/settings" className="inline-flex text-sm font-semibold text-accent underline underline-offset-2">
            {t("settings")}
          </Link>
        </div>
      )}

      <div className="grid grid-cols-3 gap-3">
        <StatTile label={zh ? "今明两天" : "Today & tomorrow"} value={String(todays.length)} sub={zh ? "节课" : "lessons"} />
        <StatTile label={zh ? "待处理" : "Needs attention"} value={String(attentionCount)} sub={zh ? "项" : "items"} />
        <StatTile label={zh ? "之后的课程" : "Later"} value={String(upcoming.length)} sub={zh ? "节（最多显示 5 节）" : "lessons (up to 5 shown)"} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-6">
          <section className="space-y-3">
            <SectionHeading title={t("today")} />
            {todays.length === 0 ? (
              <EmptyState icon={<CalendarDays aria-hidden />} title={zh ? "今明两天没有课。" : "Nothing scheduled today or tomorrow."} />
            ) : (
              <div className="space-y-2">{todays.map(row)}</div>
            )}
          </section>

          {upcoming.length > 0 && (
            <section className="space-y-3">
              <SectionHeading
                title={zh ? "接下来的课程" : "Upcoming lessons"}
                actions={<Link href="/coach/schedule" className="text-sm font-semibold text-accent hover:underline">{zh ? "查看完整课表" : "View full schedule"}</Link>}
              />
              <div className="space-y-2">{upcoming.map(row)}</div>
            </section>
          )}
        </div>

        <aside className="space-y-6">
          <section className="space-y-3">
            <SectionHeading title={zh ? "待处理" : "Needs attention"} />
            {packagesToCheck > 0 && (
              <AttentionLink href="/coach/packages" tone="checking">
                {zh
                  ? `${packagesToCheck} 个课时包付款待你确认`
                  : `${packagesToCheck} package payment(s) to check`}
              </AttentionLink>
            )}
            {analysisPayments.map((purchase) => (
              <AttentionLink key={purchase.id} href={`/booking/${purchase.booking.code}#video-analysis`} tone="video">
                {zh ? "视频分析付款待确认" : "Review analysis payment"} · {purchase.booking.code} · {purchase.quantity} {zh ? "次" : "credits"} · {formatMoney(purchase.totalCents)}
              </AttentionLink>
            ))}
            {endedLessons.map((booking) => (
              <AttentionLink key={booking.id} href={`/booking/${booking.code}`} tone="neutral">
                {zh ? "确认课程是否完成，解锁视频分析" : "Confirm lesson completion to unlock analysis"} · {booking.participantNameSnapshot ?? booking.code}
              </AttentionLink>
            ))}
            {attentionCount === 0 ? (
              <EmptyState icon={<CheckCircle2 aria-hidden />} title={zh ? "没有待处理事项。" : "Nothing waiting on you."} />
            ) : needsAttention.length === 0 ? null : (
              <div className="space-y-2">{needsAttention.map(row)}</div>
            )}
          </section>

          <Card className="space-y-3">
            <p className="flex items-center gap-2 text-sm font-semibold">
              <span className="flex size-8 items-center justify-center rounded-lg bg-cat-video-soft text-cat-video"><Video className="size-4" aria-hidden /></span>
              {video("title")}
            </p>
            <div className="divide-y divide-border">
              <ShortcutLink href="/video-analysis">{zh ? "视频分析" : "Video analysis"}</ShortcutLink>
              <ShortcutLink href="/coach/video-analysis">{zh ? "给学员发放 FreeSki 分析次数" : "Issue FreeSki analysis credits to a student"}</ShortcutLink>
              <ShortcutLink href="/coach/video-reviews">{zh ? "视频点评" : "Video reviews"}</ShortcutLink>
            </div>
          </Card>
        </aside>
      </div>
    </div>
  );
}

function AttentionLink({ href, tone, children }: { href: string; tone: "checking" | "video" | "neutral"; children: React.ReactNode }) {
  const toneClass = tone === "checking"
    ? "border-[var(--pill-checking-br)] bg-[var(--pill-checking-bg)] text-[var(--pill-checking-fg)]"
    : tone === "video" ? "border-border bg-surface text-cat-video" : "border-border bg-surface text-ink-2";
  return (
    <Link href={href} className={`lift flex items-center justify-between gap-3 rounded-2xl border p-4 text-sm font-semibold ${toneClass}`}>
      <span className="min-w-0">{children}</span>
      <ChevronRight className="size-4 shrink-0" aria-hidden />
    </Link>
  );
}

function ShortcutLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="flex min-h-11 items-center justify-between gap-3 py-2 text-sm font-medium text-ink-2 hover:text-ink">
      {children}
      <ChevronRight className="size-4 shrink-0 text-ink-3" aria-hidden />
    </Link>
  );
}
