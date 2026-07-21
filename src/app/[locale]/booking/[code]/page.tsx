import { setRequestLocale, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { requireUserPage } from "@/lib/auth/require-user";
import { accessFor, loadBooking } from "@/lib/booking/access";
import { Card, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PriceBreakdown } from "@/components/booking/price-breakdown";
import { HoldCountdown } from "@/components/booking/hold-countdown";
import { CoachReviewPanel } from "@/components/coach/coach-review-panel";
import { statusLabel, statusTone } from "@/lib/booking/state";
import { formatTorontoDate, formatTorontoTime } from "@/lib/time";
import { toLocale } from "@/i18n/routing";
import type { DisclosureSnapshot } from "@/lib/booking/disclosure";
import { Download, FileSignature, CreditCard } from "lucide-react";

export default async function BookingPage({
  params,
}: PageProps<"/[locale]/booking/[code]">) {
  const { locale, code } = await params;
  setRequestLocale(locale);

  const user = await requireUserPage({
    locale,
    callbackPath: `/${locale}/booking/${code}`,
  });

  const booking = await loadBooking(code);
  if (!booking) notFound();

  const access = accessFor(booking, user);
  if (!access.canView) notFound();

  const loc = toLocale(locale);
  const zh = loc === "zh";
  const t = await getTranslations("booking");
  const tw = await getTranslations("waiver");
  const tp = await getTranslations("payment");

  const snapshot = booking.disclosureSnapshot as unknown as DisclosureSnapshot | null;
  const lessonMinutes = Math.round(
    (booking.lessonEndAt.getTime() - booking.lessonStartAt.getTime()) / 60000,
  );

  const needsWaiver = !booking.waiverId && access.isCustomer;
  const needsPayment = access.canPay;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-sm text-muted-foreground">
            {booking.code}
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">
            {zh ? booking.resort.nameZh : booking.resort.nameEn}
          </h1>
        </div>
        <span
          className={`rounded-full border px-3 py-1 text-sm ${statusTone(booking.status)}`}
        >
          {statusLabel(booking.status, loc)}
        </span>
      </div>

      {booking.status === "HOLD" && booking.holdExpiresAt && (
        <HoldCountdown
          expiresAt={booking.holdExpiresAt.toISOString()}
          locale={loc}
        />
      )}

      <Card className="space-y-3">
        <CardTitle>{formatTorontoDate(booking.startAt, loc)}</CardTitle>
        <dl className="space-y-1.5 text-sm">
          <Row
            term={zh ? "预定时段" : "Booked block"}
            value={`${formatTorontoTime(booking.startAt, loc)} – ${formatTorontoTime(booking.endAt, loc)}`}
          />
          <Row
            term={zh ? "实际授课" : "Lesson runs"}
            value={`${formatTorontoTime(booking.lessonStartAt, loc)} – ${formatTorontoTime(booking.lessonEndAt, loc)} (${lessonMinutes} ${zh ? "分钟" : "min"})`}
            strong
          />
          <Row
            term={zh ? "教练" : "Coach"}
            value={booking.coach.name ?? booking.coach.email}
          />
          <Row
            term={zh ? "学员" : "Student"}
            value={
              booking.participantNameSnapshot ??
              booking.participant?.fullName ??
              booking.inviteName ??
              "—"
            }
          />
        </dl>
        <p className="rounded-lg bg-surface-muted p-3 text-xs text-muted-foreground">
          {t("handoverNote")}
        </p>
      </Card>

      <Card className="space-y-3">
        <CardTitle>{zh ? "价格明细" : "Price breakdown"}</CardTitle>
        <PriceBreakdown
          locale={loc}
          quote={{
            hours: booking.hours,
            hourlyRateCents: booking.hourlyRateCents,
            subtotalCents: booking.subtotalCents,
            handoverDiscountCents: booking.handoverDiscountCents,
            totalCents: booking.totalCents,
            currency: booking.currency,
            lessonMinutes,
          }}
        />
      </Card>

      {/* Next action for the customer */}
      {(needsWaiver || needsPayment) && (
        <Card className="space-y-3">
          <CardTitle>{zh ? "接下来" : "Next step"}</CardTitle>
          <div className="flex flex-wrap gap-2">
            {needsWaiver && (
              <Button asChild>
                <Link href={`/booking/${booking.code}/waiver`}>
                  <FileSignature aria-hidden />
                  {tw("title")}
                </Link>
              </Button>
            )}
            {needsPayment && (
              <Button asChild variant={needsWaiver ? "secondary" : "primary"}>
                <Link href={`/booking/${booking.code}/payment`}>
                  <CreditCard aria-hidden />
                  {tp("title")}
                </Link>
              </Button>
            )}
          </div>
        </Card>
      )}

      {booking.status === "PENDING_PAYMENT_REVIEW" && access.isCustomer && (
        <p className="rounded-lg border border-sky-500/40 bg-sky-500/10 p-3 text-sm">
          {tp("awaitingReview")}
        </p>
      )}

      {/* Waiver status. Shows when it was actually signed so a coach can see at
          a glance that an unsigned-looking booking is in fact covered by an
          earlier signature this season. */}
      {booking.waiver && (
        <Card className="space-y-3">
          <CardTitle>{tw("title")}</CardTitle>
          <p className="text-sm text-muted-foreground">
            {tw("reusedFrom", {
              date: formatTorontoDate(booking.waiver.signedAt, loc),
            })}
            {" · "}
            {booking.waiver.signerRole === "GUARDIAN"
              ? zh
                ? "监护人签署"
                : "signed by guardian"
              : zh
                ? "本人签署"
                : "signed in person"}
          </p>
          <Button asChild variant="secondary" size="sm" className="self-start">
            <a href={`/api/bookings/${booking.code}/waiver-pdf`}>
              <Download aria-hidden />
              {zh ? "下载已签协议" : "Download signed waiver"}
            </a>
          </Button>
        </Card>
      )}

      {access.isCoach && (
        <CoachReviewPanel
          locale={loc}
          bookingCode={booking.code}
          status={booking.status}
          hasProof={Boolean(booking.paymentProofKey)}
          proofUploadedBy={booking.proofUploadedBy}
          paymentMethod={booking.paymentMethod}
          paymentReference={booking.paymentReference}
          canReview={access.canReview}
          canUploadProof={access.canPay}
        />
      )}

      {snapshot && (
        <Card className="space-y-2">
          <CardTitle>{zh ? "取消与退款政策" : "Cancellation policy"}</CardTitle>
          <p className="whitespace-pre-wrap text-sm text-muted-foreground">
            {zh
              ? snapshot.cancellationPolicy.zh
              : snapshot.cancellationPolicy.en}
          </p>
          <p className="text-xs text-muted-foreground">
            {zh
              ? "以上为你下单时的政策,之后教练修改不影响本订单。"
              : "These are the terms as they stood when you booked; later changes do not affect this booking."}
          </p>
        </Card>
      )}
    </div>
  );
}

function Row({
  term,
  value,
  strong,
}: {
  term: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="flex flex-wrap justify-between gap-2">
      <dt className="text-muted-foreground">{term}</dt>
      <dd className={strong ? "font-medium" : undefined}>{value}</dd>
    </div>
  );
}
