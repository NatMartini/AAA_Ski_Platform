import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { prisma } from "@/lib/prisma";
import { requireCoachPage } from "@/lib/auth/require-user";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { BookingRow } from "@/components/booking/booking-row";
import { setupGaps } from "@/lib/coach";
import { toLocale } from "@/i18n/routing";
import { toDateKey, dateKeyToDbDate } from "@/lib/time";
import { TriangleAlert } from "lucide-react";

const GAP_COPY = {
  zh: {
    hourlyRate: "设置每小时价格",
    cancellationPolicyZh: "填写中文取消政策",
    cancellationPolicyEn: "填写英文取消政策",
    paymentMethod: "至少启用一种收款方式",
    published: "打开「开放预定」",
  },
  en: {
    hourlyRate: "Set your hourly rate",
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
  const loc = toLocale(locale);
  const zh = loc === "zh";

  const todayKey = toDateKey(new Date());
  const todayStart = dateKeyToDbDate(todayKey);

  const [profile, todays, needsAttention] = await Promise.all([
    prisma.coachProfile.findUnique({ where: { userId: user.id } }),
    prisma.booking.findMany({
      where: {
        coachId: user.id,
        status: { in: ["CONFIRMED", "PENDING_PAYMENT_REVIEW"] },
        startAt: {
          gte: new Date(todayStart.getTime() - 12 * 3600_000),
          lte: new Date(todayStart.getTime() + 36 * 3600_000),
        },
      },
      include: { resort: true, participant: true },
      orderBy: { startAt: "asc" },
    }),
    prisma.booking.findMany({
      where: {
        coachId: user.id,
        status: { in: ["PENDING_PAYMENT_REVIEW", "AWAITING_WAIVER"] },
      },
      include: { resort: true, participant: true },
      orderBy: { startAt: "asc" },
      take: 20,
    }),
  ]);

  const gaps = profile ? setupGaps(profile) : [];

  return (
    <div className="space-y-6">
      {gaps.length > 0 && (
        <Card className="space-y-2 border-amber-500/40 bg-amber-500/5">
          <CardTitle className="flex items-center gap-2">
            <TriangleAlert className="size-4 text-amber-600" aria-hidden />
            {zh ? "还不能接单" : "Not taking bookings yet"}
          </CardTitle>
          <ul className="list-inside list-disc text-sm text-muted-foreground">
            {gaps.map((gap) => (
              <li key={gap}>
                {GAP_COPY[loc][gap as keyof (typeof GAP_COPY)["zh"]] ?? gap}
              </li>
            ))}
          </ul>
          <Link
            href="/coach/settings"
            className="text-sm font-medium text-ice-700 underline dark:text-ice-300"
          >
            {t("settings")}
          </Link>
        </Card>
      )}

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-muted-foreground">
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

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-muted-foreground">
          {zh ? "待处理" : "Needs attention"}
        </h2>
        {needsAttention.length === 0 ? (
          <Card>
            <CardDescription>
              {zh ? "没有待处理事项。" : "Nothing waiting on you."}
            </CardDescription>
          </Card>
        ) : (
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
