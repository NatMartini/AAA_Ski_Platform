import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { prisma } from "@/lib/prisma";
import { requireCoachPage } from "@/lib/auth/require-user";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { BookingRow } from "@/components/booking/booking-row";
import { setupGaps } from "@/lib/coach";
import { formatMoney } from "@/lib/pricing";
import { toLocale } from "@/i18n/routing";
import { toDateKey, addDaysToDateKey, torontoWallTimeToUtc } from "@/lib/time";
import { ChevronRight, TriangleAlert } from "lucide-react";
import { FreeSkiIntroCard } from "@/components/booking/freeski-intro-card";

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

  return (
    <div className="stagger space-y-6">
      <FreeSkiIntroCard copy={{ title: video("title"), attribution: video("attribution"),
        body: video("coachBody"), quotaPolicy: video("quotaPolicy"),
        sharedPolicy: video("sharedPolicy"), action: video("coachAction") }} />
      <Link href="/coach/video-analysis" className="lift flex items-center justify-between gap-3 rounded-2xl border border-border bg-surface p-4 text-sm font-bold text-accent">
        {zh ? "给学员发放 FreeSki 分析次数" : "Issue FreeSki analysis credits to a student"}
        <ChevronRight className="size-4 shrink-0" aria-hidden />
      </Link>
      {gaps.length > 0 && (
        <Card
          className="space-y-2"
          style={{
            background: "var(--amber-bg)",
            borderColor: "var(--amber-border)",
          }}
        >
          <CardTitle
            className="flex items-center gap-2"
            style={{ color: "var(--amber)" }}
          >
            <TriangleAlert className="size-4" aria-hidden />
            {zh ? "还不能接单" : "Not taking bookings yet"}
          </CardTitle>
          <ul className="list-inside list-disc text-sm text-ink-2">
            {gaps.map((gap) => (
              <li key={gap}>
                {GAP_COPY[loc][gap as keyof (typeof GAP_COPY)["zh"]] ?? gap}
              </li>
            ))}
          </ul>
          <Link
            href="/coach/settings"
            className="text-sm font-bold text-accent underline underline-offset-2"
          >
            {t("settings")}
          </Link>
        </Card>
      )}

      <section className="space-y-2">
        <h2 className="text-xs font-bold uppercase tracking-[0.14em] text-ink-3">
          {t("today")}
        </h2>
        {todays.length === 0 ? (
          <Card>
            <CardDescription>
              {zh ? "今明两天没有课。" : "Nothing scheduled today or tomorrow."}
            </CardDescription>
          </Card>
        ) : (
          <div className="space-y-2">
            {todays.map((b) => (
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
                  otherPartyName:
                    b.participantNameSnapshot ??
                    b.participant?.fullName ??
                    b.inviteName ??
                    "—",
                  hasWaiver: Boolean(b.waiverId),
                }}
              />
            ))}
          </div>
        )}
      </section>

      {upcoming.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-xs font-bold uppercase tracking-[0.14em] text-ink-3">{zh ? "接下来的课程" : "Upcoming lessons"}</h2>
            <Link href="/coach/schedule" className="text-xs font-bold text-accent underline">{zh ? "查看完整课表" : "View full schedule"}</Link>
          </div>
          <div className="space-y-2">
            {upcoming.map((booking) => (
              <BookingRow key={booking.id} locale={loc} href={`/booking/${booking.code}`} booking={{
                code: booking.code,
                status: booking.status,
                startAt: booking.startAt,
                lessonStartAt: booking.lessonStartAt,
                lessonEndAt: booking.lessonEndAt,
                totalCents: booking.totalCents,
                lessonType: booking.lessonType,
                paidByPackage: booking.paymentPlan === "PACKAGE",
                resortName: zh ? booking.resort.nameZh : booking.resort.nameEn,
                otherPartyName: booking.participantNameSnapshot ?? booking.participant?.fullName ?? booking.inviteName ?? "—",
                hasWaiver: Boolean(booking.waiverId),
              }} />
            ))}
          </div>
        </section>
      )}

      <section className="space-y-2">
        <h2 className="text-xs font-bold uppercase tracking-[0.14em] text-ink-3">
          {zh ? "待处理" : "Needs attention"}
        </h2>
        {packagesToCheck > 0 && (
          <Link
            href="/coach/packages"
            className="lift flex items-center justify-between gap-3 rounded-2xl border p-4 text-sm font-bold"
            style={{
              background: "var(--pill-checking-bg)",
              borderColor: "var(--pill-checking-br)",
              color: "var(--pill-checking-fg)",
            }}
          >
            {zh
              ? `${packagesToCheck} 个课时包付款待你确认`
              : `${packagesToCheck} package payment(s) to check`}
            <ChevronRight className="size-4 shrink-0" aria-hidden />
          </Link>
        )}
        {analysisPayments.map((purchase) => (
          <Link key={purchase.id} href={`/booking/${purchase.booking.code}#video-analysis`}
            className="lift flex items-center justify-between gap-3 rounded-2xl border border-line bg-paper p-4 text-sm font-bold text-accent">
            <span>{zh ? "视频分析付款待确认" : "Review analysis payment"} · {purchase.booking.code} · {purchase.quantity} {zh ? "次" : "credits"} · {formatMoney(purchase.totalCents)}</span>
            <ChevronRight className="size-4 shrink-0" aria-hidden />
          </Link>
        ))}
        {endedLessons.map((booking) => (
          <Link key={booking.id} href={`/booking/${booking.code}`}
            className="lift flex items-center justify-between gap-3 rounded-2xl border border-line bg-paper p-4 text-sm font-bold text-ink-2">
            <span>{zh ? "确认课程是否完成，解锁视频分析" : "Confirm lesson completion to unlock analysis"} · {booking.participantNameSnapshot ?? booking.code}</span>
            <ChevronRight className="size-4 shrink-0" aria-hidden />
          </Link>
        ))}
        {needsAttention.length === 0 && packagesToCheck === 0 && analysisPayments.length === 0 && endedLessons.length === 0 ? (
          <Card>
            <CardDescription>
              {zh ? "没有待处理事项。" : "Nothing waiting on you."}
            </CardDescription>
          </Card>
        ) : needsAttention.length === 0 ? null : (
          <div className="space-y-2">
            {needsAttention.map((b) => (
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
                  otherPartyName:
                    b.participantNameSnapshot ??
                    b.participant?.fullName ??
                    b.inviteName ??
                    "—",
                  hasWaiver: Boolean(b.waiverId),
                }}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
