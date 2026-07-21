import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUserPage } from "@/lib/auth/require-user";
import { getAvailability } from "@/lib/availability";
import { canAcceptBookings } from "@/lib/coach";
import { SlotPicker } from "@/components/booking/slot-picker";
import { toLocale } from "@/i18n/routing";
import { dbDateToDateKey, toDateKey, addDaysToDateKey } from "@/lib/time";
import { isMinorAt } from "@/lib/waiver/validity";

export default async function PickSlotPage({
  params,
}: PageProps<"/[locale]/book/[resort]/[coach]">) {
  const { locale, resort: resortSlug, coach: coachId } = await params;
  setRequestLocale(locale);

  const user = await requireUserPage({
    locale,
    callbackPath: `/${locale}/book/${resortSlug}/${coachId}`,
  });

  const [resort, profile] = await Promise.all([
    prisma.resort.findUnique({ where: { slug: resortSlug } }),
    prisma.coachProfile.findUnique({ where: { userId: coachId } }),
  ]);
  if (!resort?.isActive || !profile || !canAcceptBookings(profile)) notFound();

  const today = toDateKey(new Date());
  const days = await getAvailability({
    coachId,
    from: today,
    to: addDaysToDateKey(today, 120),
  });

  // Only this resort's days; a coach is at one resort per day.
  const forResort = days.filter((d) => d.resort.slug === resortSlug);

  const participants = await prisma.participant.findMany({
    where: { accountId: user.id, archivedAt: null },
    orderBy: [{ isSelf: "desc" }, { fullName: "asc" }],
  });

  return (
    <SlotPicker
      locale={toLocale(locale)}
      coachId={coachId}
      coachName={profile.displayName}
      coachWechat={profile.wechatId}
      resortName={locale === "zh" ? resort.nameZh : resort.nameEn}
      minHours={profile.minHours}
      days={forResort.map((day) => ({
        dateKey: day.dateKey,
        hourlyRateCents: day.hourlyRateCents,
        handoverDiscountCents: day.handoverDiscountCents,
        note: day.note,
        cells: day.cells.map((c) => ({
          hour: c.hour,
          status: c.status,
          startIso: c.startAt.toISOString(),
        })),
        startOptions: day.startOptions.map((o) => ({
          hour: o.hour,
          durations: o.durations,
        })),
      }))}
      participants={participants.map((p) => ({
        id: p.id,
        fullName: p.fullName,
        birthDate: dbDateToDateKey(p.birthDate),
        isSelf: p.isSelf,
        isMinorToday: isMinorAt(p.birthDate, new Date()),
      }))}
    />
  );
}
