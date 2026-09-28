import { setRequestLocale, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { redirect } from "@/i18n/navigation";
import { requireUserPage } from "@/lib/auth/require-user";
import { accessFor, loadBooking } from "@/lib/booking/access";
import { prisma } from "@/lib/prisma";
import { PaymentPanel } from "@/components/booking/payment-panel";
import { PriceBreakdown } from "@/components/booking/price-breakdown";
import { quoteFromBooking } from "@/lib/pricing";
import { amountDueCents } from "@/lib/booking/lesson";
import { toLocale } from "@/i18n/routing";
import { HoldCountdown } from "@/components/booking/hold-countdown";
import { isSelfServeHoldExpired } from "@/lib/booking/hold";

export default async function PaymentPage({
  params,
}: PageProps<"/[locale]/booking/[code]/payment">) {
  const { locale, code } = await params;
  setRequestLocale(locale);

  const user = await requireUserPage({
    locale,
    callbackPath: `/${locale}/booking/${code}/payment`,
  });

  const booking = await loadBooking(code);
  if (!booking) notFound();

  const access = accessFor(booking, user);
  if (!access.canView) notFound();
  if (!access.canPay || isSelfServeHoldExpired(booking, new Date())) {
    redirect({ href: `/booking/${code}`, locale });
  }

  const profile = await prisma.coachProfile.findUnique({
    where: { userId: booking.coachId },
  });
  if (!profile) notFound();

  const t = await getTranslations("payment");

  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm text-muted-foreground">{booking.code}</p>
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
      </div>

      {booking.status === "AWAITING_PAYMENT" && booking.holdExpiresAt && (
        <HoldCountdown
          expiresAt={booking.holdExpiresAt.toISOString()}
          locale={toLocale(locale)}
        />
      )}

      <PaymentPanel
        locale={toLocale(locale)}
        target={{ kind: "booking", code: booking.code }}
        coachId={booking.coachId}
        isCoach={access.isCoach}
        rejectedNote={
          booking.status === "PAYMENT_REJECTED" ? booking.reviewNote : null
        }
        totalCents={booking.totalCents}
        currency={booking.currency}
        breakdown={
          <PriceBreakdown
            quote={quoteFromBooking(booking)}
            locale={toLocale(locale)}
            lessonType={booking.lessonType}
            earlyBird={booking.earlyBird}
          />
        }
        amountDueCents={amountDueCents(booking)}
        methods={{
          emt:
            profile.emtEnabled && profile.emtEmail
              ? { email: profile.emtEmail, name: profile.emtName }
              : null,
          wechat: profile.wechatPayEnabled && profile.wechatPayQrKey ? true : false,
          alipay: profile.alipayEnabled && profile.alipayQrKey ? true : false,
        }}
      />
    </div>
  );
}
