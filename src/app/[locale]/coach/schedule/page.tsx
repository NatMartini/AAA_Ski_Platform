import { getTranslations, setRequestLocale } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { Link } from "@/i18n/navigation";
import { requireCoachPage } from "@/lib/auth/require-user";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { IcsFeedBox } from "@/components/coach/ics-feed-box";
import { googleCalendarUrl } from "@/lib/ics";
import { formatMoneyShort } from "@/lib/pricing";
import { lessonTypeLabel } from "@/lib/lesson-types";
import {
  formatTorontoDate,
  formatTorontoTime,
  toDateKey,
  dateKeyToDbDate,
} from "@/lib/time";
import { OCCUPYING_STATUSES } from "@/lib/booking/state";
import { StatusPill } from "@/components/ui/status-pill";
import { toLocale } from "@/i18n/routing";
import { CalendarPlus } from "lucide-react";

export default async function CoachSchedulePage({
  params,
}: PageProps<"/[locale]/coach/schedule">) {
  const { locale } = await params;
  setRequestLocale(locale);

  const user = await requireCoachPage({ locale });
  const t = await getTranslations("coach");
  const loc = toLocale(locale);
  const zh = loc === "zh";

  const profile = await prisma.coachProfile.findUnique({
    where: { userId: user.id },
    select: { icsToken: true },
  });

  const from = dateKeyToDbDate(toDateKey(new Date()));
  const bookings = await prisma.booking.findMany({
    where: {
      coachId: user.id,
      status: { in: OCCUPYING_STATUSES },
      endAt: { gte: new Date(from.getTime() - 24 * 3600_000) },
    },
    include: { resort: true, participant: true },
    orderBy: { startAt: "asc" },
  });

  // Group into days for the table.
  const byDay = new Map<string, typeof bookings>();
  for (const b of bookings) {
    const key = toDateKey(b.startAt);
    byDay.set(key, [...(byDay.get(key) ?? []), b]);
  }

  const base = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000";

  return (
    <div className="space-y-6">
      {profile && (
        <IcsFeedBox
          locale={loc}
          url={`${base}/api/cal/${profile.icsToken}`}
          title={t("icsFeed")}
          help={t("icsHelp")}
        />
      )}

      <section className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-medium text-muted-foreground">
            {t("schedule")}
          </h2>
          <Link
            href="/calendar"
            className="text-xs font-bold text-accent underline underline-offset-2"
          >
            {zh ? "所有教练的日历 →" : "Every coach's calendar →"}
          </Link>
        </div>

        {byDay.size === 0 ? (
          <Card>
            <CardDescription>
              {zh ? "接下来没有排课。" : "Nothing scheduled."}
            </CardDescription>
          </Card>
        ) : (
          [...byDay.entries()].map(([dateKey, dayBookings]) => (
            <Card key={dateKey} className="space-y-3">
              <CardTitle>
                {formatTorontoDate(dayBookings[0].startAt, loc)}
              </CardTitle>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-ink-3">
                      <th className="py-2 pr-3 font-medium">
                        {zh ? "授课时间" : "Lesson"}
                      </th>
                      <th className="py-2 pr-3 font-medium">
                        {zh ? "学员" : "Student"}
                      </th>
                      <th className="py-2 pr-3 font-medium">
                        {zh ? "雪场" : "Resort"}
                      </th>
                      <th className="py-2 pr-3 font-medium">
                        {zh ? "金额" : "Fee"}
                      </th>
                      <th className="py-2 pr-3 font-medium">
                        {zh ? "状态" : "Status"}
                      </th>
                      <th className="py-2 font-medium">
                        <span className="sr-only">{t("addToGoogle")}</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {dayBookings.map((b) => {
                      const student =
                        b.participantNameSnapshot ??
                        b.participant?.fullName ??
                        b.inviteName ??
                        "—";
                      return (
                        <tr
                          key={b.id}
                          className="border-b border-border last:border-0"
                        >
                          <td className="py-2 pr-3 whitespace-nowrap tabular-nums">
                            {formatTorontoTime(b.lessonStartAt, loc)} –{" "}
                            {formatTorontoTime(b.lessonEndAt, loc)}
                          </td>
                          <td className="py-2 pr-3">{student}</td>
                          <td className="py-2 pr-3">
                            {zh ? b.resort.nameZh : b.resort.nameEn}
                          </td>
                          <td className="py-2 pr-3 tabular-nums">
                            {b.paymentPlan === "PACKAGE"
                              ? zh
                                ? "课时包"
                                : "Package"
                              : formatMoneyShort(b.totalCents)}
                          </td>
                          <td className="py-2 pr-3">
                            <StatusPill status={b.status} locale={loc} />
                          </td>
                          <td className="py-2">
                            <a
                              href={googleCalendarUrl({
                                title: `${student} · ${b.resort.nameEn}`,
                                start: b.lessonStartAt,
                                end: b.lessonEndAt,
                                details: `${b.code} · ${lessonTypeLabel(b.lessonType, "en")} · ${b.paymentPlan === "PACKAGE" ? "package" : formatMoneyShort(b.totalCents)}`,
                                location: b.resort.address ?? b.resort.nameEn,
                              })}
                              target="_blank"
                              rel="noreferrer"
                              title={t("addToGoogle")}
                              className="press inline-flex items-center gap-1 text-accent hover:underline"
                            >
                              <CalendarPlus className="size-4" aria-hidden />
                              <span className="sr-only">
                                {t("addToGoogle")}
                              </span>
                            </a>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          ))
        )}
      </section>
    </div>
  );
}
