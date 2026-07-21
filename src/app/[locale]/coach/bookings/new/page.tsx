import { setRequestLocale } from "next-intl/server";
import { requireCoachPage } from "@/lib/auth/require-user";
import { prisma } from "@/lib/prisma";
import { getAvailability } from "@/lib/availability";
import { CoachBookingForm } from "@/components/coach/coach-booking-form";
import { toLocale } from "@/i18n/routing";
import { addDaysToDateKey, toDateKey } from "@/lib/time";

export default async function CoachNewBookingPage({
  params,
}: PageProps<"/[locale]/coach/bookings/new">) {
  const { locale } = await params;
  setRequestLocale(locale);

  const user = await requireCoachPage({ locale });

  const profile = await prisma.coachProfile.findUnique({
    where: { userId: user.id },
  });

  const today = toDateKey(new Date());
  const days = await getAvailability({
    coachId: user.id,
    from: today,
    to: addDaysToDateKey(today, 120),
  });

  return (
    <CoachBookingForm
      locale={toLocale(locale)}
      minHours={profile?.minHours ?? 2}
      days={days.map((day) => ({
        dateKey: day.dateKey,
        resortName: locale === "zh" ? day.resort.nameZh : day.resort.nameEn,
        hourlyRateCents: day.hourlyRateCents,
        handoverDiscountCents: day.handoverDiscountCents,
        startOptions: day.startOptions.map((o) => ({
          hour: o.hour,
          durations: o.durations,
        })),
      }))}
    />
  );
}
