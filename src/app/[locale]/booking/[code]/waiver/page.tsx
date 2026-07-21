import { setRequestLocale, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { redirect } from "@/i18n/navigation";
import { requireUserPage } from "@/lib/auth/require-user";
import { accessFor, loadBooking } from "@/lib/booking/access";
import { clausesFor, WARNING } from "@/lib/waiver/template-v1";
import { isMinorAt } from "@/lib/waiver/validity";
import { WaiverForm } from "@/components/waiver/waiver-form";
import { toLocale } from "@/i18n/routing";

export default async function SignWaiverPage({
  params,
}: PageProps<"/[locale]/booking/[code]/waiver">) {
  const { locale, code } = await params;
  setRequestLocale(locale);

  const user = await requireUserPage({
    locale,
    callbackPath: `/${locale}/booking/${code}/waiver`,
  });

  const booking = await loadBooking(code);
  if (!booking) notFound();

  const access = accessFor(booking, user);
  if (!access.canView) notFound();
  if (!access.isCustomer || !booking.participant) {
    redirect({ href: `/booking/${code}`, locale });
  }

  // Nothing to sign: either already covered, or past that step.
  if (booking.waiverId || !["HOLD", "AWAITING_WAIVER"].includes(booking.status)) {
    redirect({ href: `/booking/${code}`, locale });
  }

  const t = await getTranslations("waiver");
  const loc = toLocale(locale);
  const zh = loc === "zh";

  const isMinor = isMinorAt(
    booking.participant!.birthDate,
    booking.lessonStartAt,
  );
  const variant = isMinor ? "guardian" : "adult";

  const clauses = clausesFor(variant).map((clause) => ({
    id: clause.id,
    heading: zh ? clause.headingZh : clause.headingEn,
    body: zh ? clause.bodyZh : clause.bodyEn,
    bodyAlt: zh ? clause.bodyEn : clause.bodyZh,
    acknowledge: clause.acknowledge,
  }));

  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm text-muted-foreground">
          {booking.participantNameSnapshot ?? booking.participant!.fullName}
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("seasonNote")}</p>
      </div>

      <WaiverForm
        locale={loc}
        bookingCode={booking.code}
        clauses={clauses}
        isGuardian={isMinor}
        minorNotice={isMinor ? t("minorNotice") : null}
        warning={zh ? WARNING.zh : WARNING.en}
        postTo={`/api/bookings/${booking.code}/waiver`}
        redirectTo={`/booking/${booking.code}/payment`}
      />
    </div>
  );
}
