import { setRequestLocale, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { redirect } from "@/i18n/navigation";
import { requireUserPage } from "@/lib/auth/require-user";
import { accessFor, loadBooking } from "@/lib/booking/access";
import { prisma } from "@/lib/prisma";
import { PaymentPanel } from "@/components/booking/payment-panel";
import { quoteFromBooking } from "@/lib/pricing";
import { toLocale } from "@/i18n/routing";

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
  if (!access.canPay) redirect({ href: `/booking/${code}`, locale });

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

      <PaymentPanel
        locale={toLocale(locale)}
        bookingCode={booking.code}
        coachId={booking.coachId}
        isCoach={access.isCoach}
        rejectedNote={
          booking.status === "PAYMENT_REJECTED" ? booking.reviewNote : null
        }
        quote={quoteFromBooking(booking)}
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
