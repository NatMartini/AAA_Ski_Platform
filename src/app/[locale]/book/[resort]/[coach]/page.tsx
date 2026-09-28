import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUserPage } from "@/lib/auth/require-user";
import { getAvailability } from "@/lib/availability";
import { canAcceptBookings } from "@/lib/coach";
import { SlotPicker } from "@/components/booking/slot-picker";
import { toLocale } from "@/i18n/routing";
import { toDateKey } from "@/lib/time";
import { bookingHorizon } from "@/lib/season";
import { MAX_SUPPORTED_HEADCOUNT } from "@/lib/booking/group";
import { earlyBirdWindow, offeredRates } from "@/lib/rates";
import { usablePackages } from "@/lib/package-store";

export default async function PickSlotPage({
  params,
  searchParams,
}: PageProps<"/[locale]/book/[resort]/[coach]">) {
  const { locale, resort: resortSlug, coach: coachId } = await params;
  const { date: askedDate } = await searchParams;
  setRequestLocale(locale);

  const user = await requireUserPage({
    locale,
    callbackPath: `/${locale}/book/${resortSlug}/${coachId}`,
  });

  const [resort, profile] = await Promise.all([
    prisma.resort.findUnique({ where: { slug: resortSlug } }),
    prisma.coachProfile.findUnique({
      where: { userId: coachId },
      include: { rates: true },
    }),
  ]);
  if (!resort?.isActive || !profile || !canAcceptBookings(profile)) notFound();

  // Runs to the end of the season rather than a fixed number of days, so
  // December dates are visible during the autumn rather than falling off the
  // end of a rolling window.
  const today = toDateKey(new Date());
  const horizon = bookingHorizon(today);
  const days = await getAvailability({
    coachId,
    from: horizon.from,
    to: horizon.to,
  });

  // Only this resort's days; a coach is at one resort per day. A day with no
  // start time left (fully booked, or already past) is left off entirely, so
  // the calendar only offers days that can still be booked.
  const forResort = days.filter(
    (d) => d.resort.slug === resortSlug && d.startOptions.length > 0,
  );

  const [participants, packages] = await Promise.all([
    prisma.participant.findMany({
      where: { accountId: user.id, archivedAt: null },
      orderBy: [{ isSelf: "desc" }, { fullName: "asc" }],
    }),
    // Only packages bought from this coach can pay for a lesson with them.
    usablePackages(user.id, coachId, resort.id),
  ]);

  // The calendar links here with ?date= so the day arrives picked.
  const initialDateKey =
    typeof askedDate === "string" &&
    forResort.some((d) => d.dateKey === askedDate)
      ? askedDate
      : undefined;

  return (
    <SlotPicker
      locale={toLocale(locale)}
      coachId={coachId}
      coachName={profile.displayName}
      coachBio={locale === "zh" ? profile.bioZh : profile.bioEn}
      coachAvatarUrl={profile.avatarUrl}
      coachWechat={profile.wechatId}
      coachSkills={profile.teachableSkills}
      cancellationPolicy={
        (locale === "zh"
          ? profile.cancellationPolicyZh
          : profile.cancellationPolicyEn) ?? ""
      }
      resortName={locale === "zh" ? resort.nameZh : resort.nameEn}
      minHours={profile.minHours}
      maxGroupSize={Math.min(
        profile.maxGroupSize,
        MAX_SUPPORTED_HEADCOUNT,
      )}
      rates={offeredRates(profile.rates).map((r) => ({
        lessonType: r.lessonType,
        regularCents: r.regularCents,
        earlyBirdCents: r.earlyBirdCents,
      }))}
      earlyBirdActive={earlyBirdWindow(today).active}
      packages={packages}
      initialDateKey={initialDateKey}
      days={forResort.map((day) => ({
        dateKey: day.dateKey,
        earlyBird: day.earlyBird,
        extraPersonCents: day.extraPersonCents,
        cells: day.cells.map((c) => ({
          hour: c.hour,
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
        isMinor: p.isMinor,
        isSelf: p.isSelf,
        level: p.level,
        phone: p.phone,
        emergencyContactName: p.emergencyContactName,
        emergencyContactPhone: p.emergencyContactPhone,
      }))}
    />
  );
}
