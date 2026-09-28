import { setRequestLocale } from "next-intl/server";
import { requireCoachPage } from "@/lib/auth/require-user";
import { prisma } from "@/lib/prisma";
import { getAvailability } from "@/lib/availability";
import { CoachBookingForm } from "@/components/coach/coach-booking-form";
import { toLocale } from "@/i18n/routing";
import { toDateKey } from "@/lib/time";
import { bookingHorizon } from "@/lib/season";
import { MAX_SUPPORTED_HEADCOUNT } from "@/lib/booking/group";
import { offeredRates } from "@/lib/rates";

export default async function CoachNewBookingPage({
  params,
}: PageProps<"/[locale]/coach/bookings/new">) {
  const { locale } = await params;
  setRequestLocale(locale);

  const user = await requireCoachPage({ locale });

  const profile = await prisma.coachProfile.findUnique({
    where: { userId: user.id },
    include: { rates: true },
  });

  const horizon = bookingHorizon(toDateKey(new Date()));
  const days = await getAvailability({
    coachId: user.id,
    from: horizon.from,
    to: horizon.to,
  });

  return (
    <CoachBookingForm
      locale={toLocale(locale)}
      minHours={profile?.minHours ?? 2}
      maxGroupSize={Math.min(
        profile?.maxGroupSize ?? 1,
        MAX_SUPPORTED_HEADCOUNT,
      )}
      rates={offeredRates(profile?.rates ?? []).map((r) => ({
        lessonType: r.lessonType,
        regularCents: r.regularCents,
        earlyBirdCents: r.earlyBirdCents,
      }))}
      days={days.map((day) => ({
        dateKey: day.dateKey,
        resortName: locale === "zh" ? day.resort.nameZh : day.resort.nameEn,
        earlyBird: day.earlyBird,
        handoverDiscountCents: day.handoverDiscountCents,
        extraPersonCents: day.extraPersonCents,
        startOptions: day.startOptions.map((o) => ({
          hour: o.hour,
          durations: o.durations,
        })),
      }))}
    />
  );
}
