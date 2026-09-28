import { setRequestLocale } from "next-intl/server";
import { requireCoachPage } from "@/lib/auth/require-user";
import { prisma } from "@/lib/prisma";
import { AvailabilityManager } from "@/components/coach/availability-manager";
import { toLocale } from "@/i18n/routing";
import { dbDateToDateKey } from "@/lib/time";
import { OCCUPYING_STATUSES } from "@/lib/booking/state";

export default async function CoachAvailabilityPage({
  params,
}: PageProps<"/[locale]/coach/availability">) {
  const { locale } = await params;
  setRequestLocale(locale);

  const user = await requireCoachPage({ locale });

  const [resorts, days] = await Promise.all([
    prisma.resort.findMany({
      where: { isActive: true },
      orderBy: { order: "asc" },
      select: { id: true, slug: true, nameEn: true, nameZh: true },
    }),
    prisma.coachDay.findMany({
      where: { coachId: user.id },
      orderBy: { date: "asc" },
      include: {
        resort: { select: { id: true, nameEn: true, nameZh: true } },
        bookings: {
          where: { status: { in: OCCUPYING_STATUSES } },
          select: { id: true },
        },
      },
    }),
  ]);

  return (
    <AvailabilityManager
      locale={toLocale(locale)}
      resorts={resorts}
      initialDays={days.map((d) => ({
        id: d.id,
        date: dbDateToDateKey(d.date),
        resortId: d.resortId,
        resortName: locale === "zh" ? d.resort.nameZh : d.resort.nameEn,
        startHour: d.startHour,
        endHour: d.endHour,
        breakStartHour: d.breakStartHour,
        breakEndHour: d.breakEndHour,
        note: d.note,
        bookingCount: d.bookings.length,
      }))}
    />
  );
}
