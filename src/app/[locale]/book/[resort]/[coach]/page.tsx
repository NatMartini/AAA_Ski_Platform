import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { redirect } from "@/i18n/navigation";
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
import { parseBookingSelection, toBookingSelectionQuery } from "@/lib/booking/selection";
import { recommendCoaches } from "@/lib/booking/recommendation";
import { parseCustomSkills } from "@/lib/custom-skills";

export default async function PickSlotPage({
  params,
  searchParams,
}: PageProps<"/[locale]/book/[resort]/[coach]">) {
  const { locale, resort: resortSlug, coach: coachId } = await params;
  const query = await searchParams;
  const selection = parseBookingSelection(query);
  setRequestLocale(locale);

  const user = await requireUserPage({
    locale,
    callbackPath: `/${locale}/book/${resortSlug}/${coachId}${selection ? `?${new URLSearchParams(toBookingSelectionQuery(selection))}` : ""}`,
  });
  if (user.role === "COACH" || user.role === "ADMIN") {
    redirect({ href: "/coach/bookings/new", locale });
  }
  if (!selection) {
    return redirect({ href: { pathname: `/book/${resortSlug}`, query: {
      ...(typeof query.date === "string" ? { date: query.date } : {}), selectionError: "missing",
    } }, locale });
  }

  const [resort, profile] = await Promise.all([
    prisma.resort.findUnique({ where: { slug: resortSlug } }),
    prisma.coachProfile.findUnique({
      where: { userId: coachId },
      include: { rates: true },
    }),
  ]);
  if (!resort?.isActive || !profile || !canAcceptBookings(profile)) notFound();
  const eligible = await recommendCoaches({
    resortSlug, dateKey: selection.dateKey, startHour: selection.startHour, hours: selection.hours,
    skills: selection.requestedSkills, level: selection.level, lessonType: selection.lessonType,
    headcount: selection.headcount,
  }, user.id);
  if (!eligible.some((coach) => coach.userId === coachId)) {
    return redirect({ href: { pathname: `/book/${resortSlug}/coaches`, query: {
      ...toBookingSelectionQuery(selection), coachUnavailable: "true",
    } }, locale });
  }

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
    // A package pays for a lesson with any coach, whoever was paid for it.
    usablePackages(user.id, resort.id),
  ]);

  // Recheck after the recommendation read; never change a selected time silently.
  if (!forResort.some((day) => day.dateKey === selection.dateKey && day.startOptions.some((start) =>
    start.hour === selection.startHour && start.durations.includes(selection.hours)))) {
    return redirect({ href: { pathname: `/book/${resortSlug}`, query: {
      ...toBookingSelectionQuery(selection), selectionError: "unavailable",
    } }, locale });
  }
  const selectedQuery = new URLSearchParams(toBookingSelectionQuery(selection)).toString();

  return (
    <SlotPicker
      key={`${coachId}:${selectedQuery}`}
      locale={toLocale(locale)}
      coachId={coachId}
      coachName={profile.displayName}
      coachBio={locale === "zh" ? profile.bioZh : profile.bioEn}
      coachAvatarUrl={profile.avatarUrl}
      coachWechat={profile.wechatId}
      coachSkills={profile.teachableSkills}
      customSkills={parseCustomSkills(profile.customSkills)}
      cancellationPolicy={
        (locale === "zh"
          ? profile.cancellationPolicyZh
          : profile.cancellationPolicyEn) ?? ""
      }
      resortName={locale === "zh" ? resort.nameZh : resort.nameEn}
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
      selection={selection}
      changeTimeHref={`/book/${resortSlug}?${selectedQuery}`}
      changeCoachHref={`/book/${resortSlug}/coaches?${selectedQuery}`}
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
