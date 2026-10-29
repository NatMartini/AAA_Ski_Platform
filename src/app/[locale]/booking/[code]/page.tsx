import { setRequestLocale, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { requireUserPage } from "@/lib/auth/require-user";
import { accessFor, loadBooking } from "@/lib/booking/access";
import { Card, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PriceBreakdown } from "@/components/booking/price-breakdown";
import { quoteFromBooking } from "@/lib/pricing";
import { HoldCountdown } from "@/components/booking/hold-countdown";
import { isSelfServeHoldExpired } from "@/lib/booking/hold";
import { CoachReviewPanel } from "@/components/coach/coach-review-panel";
import { CoachLessonPanel } from "@/components/coach/coach-lesson-panel";
import { CoachInvitationCard } from "@/components/coach/coach-invitation-card";
import { GroupAttendeeRoster } from "@/components/booking/group-attendee-roster";
import { VideoAnalysisPanel } from "@/components/booking/video-analysis-panel";
import { areBookingWaiversValid, isAttendeeWaiverValid } from "@/lib/booking/group-readiness";
import { prisma } from "@/lib/prisma";
import { balanceCents } from "@/lib/booking/lesson";
import { levelLabel } from "@/lib/skills";
import { requestedSkillLabel } from "@/lib/custom-skills";
import { formatMoneyShort } from "@/lib/pricing";
import { StatusPill } from "@/components/ui/status-pill";
import { formatTorontoDate, formatTorontoTime } from "@/lib/time";
import { toLocale } from "@/i18n/routing";
import type { DisclosureSnapshot } from "@/lib/booking/disclosure";
import { PageHeader, SectionHeading } from "@/components/ui/page-header";
import {
  ArrowLeft,
  ClipboardList,
  Download,
  FileSignature,
  CreditCard,
  NotebookPen,
  Target,
} from "lucide-react";

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

  const now = new Date();
  const holdExpired = isSelfServeHoldExpired(booking, now);
  const effectiveStatus = holdExpired ? "EXPIRED" : booking.status;
  const primaryAttendee = booking.attendees.find((attendee) => attendee.ordinal === 1);
  const primaryNeedsWaiver = booking.headcount > 1
    ? !primaryAttendee || !isAttendeeWaiverValid(primaryAttendee, booking)
    : !booking.waiverId;
  const needsWaiver =
    !holdExpired &&
    primaryNeedsWaiver &&
    access.isCustomer &&
    ["HOLD", "AWAITING_WAIVER"].includes(booking.status);
  const allSigned = areBookingWaiversValid(booking);
  const needsPayment = !holdExpired && allSigned && access.canPay;

  const owing = balanceCents(booking);
  const videos = await prisma.lessonVideo.findMany({
    where: { bookingId: booking.id },
    orderBy: { uploadedAt: "asc" },
    select: { id: true, caption: true, uploadedAt: true, uploadedById: true, contentType: true },
  });

  return (
    <div className="space-y-5">
      <Link href={access.isCoach ? "/coach/bookings" : "/my/bookings"} className="inline-flex min-h-9 items-center gap-1.5 text-sm font-semibold text-ink-2 hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden />{access.isCoach ? (zh ? "返回订单" : "Back to bookings") : (zh ? "返回我的预约" : "Back to my bookings")}
      </Link>
      <PageHeader
        icon={<ClipboardList aria-hidden />}
        tone="lessons"
        eyebrow={<span className="font-mono tracking-widest">{booking.code}</span>}
        title={zh ? booking.resort.nameZh : booking.resort.nameEn}
        actions={<StatusPill status={effectiveStatus} locale={loc} />}
      />

      {booking.headcount === 1 && access.isCoach && booking.status === "AWAITING_WAIVER" && !booking.waiverId && booking.inviteEmail && (
        <CoachInvitationCard locale={loc} code={booking.code} recipientEmail={booking.inviteEmail} isMinor={booking.inviteIsMinor} />
      )}

      {booking.headcount > 1 && <GroupAttendeeRoster
        key={booking.code} locale={loc} code={booking.code}
        allSigned={allSigned}
        canManage={!holdExpired && (access.isCustomer || access.isCoach) && ["HOLD", "AWAITING_WAIVER"].includes(booking.status)}
        senderRole={access.isCoach ? "coach" : "organizer"}
        attendees={booking.attendees.map((attendee) => ({
          id: attendee.id, ordinal: attendee.ordinal, fullName: attendee.fullName,
          email: attendee.email, isMinor: attendee.isMinor,
          signed: isAttendeeWaiverValid(attendee, booking),
          signedAt: attendee.waiver?.signedAt.toISOString() ?? null,
          canReadPdf: access.isCoach || attendee.accountId === user.id,
          canInvite: attendee.ordinal > 1 || booking.createdByCoach,
        }))}
      />}

      {!holdExpired &&
        ["HOLD", "AWAITING_WAIVER", "AWAITING_PAYMENT"].includes(booking.status) &&
        booking.holdExpiresAt && (
          <HoldCountdown
            expiresAt={booking.holdExpiresAt.toISOString()}
            locale={loc}
            signOnly={booking.paymentPlan === "PACKAGE"}
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
        <p className="rounded-xl bg-surface-2 p-3.5 text-xs leading-relaxed text-ink-2">
          {t("handoverNote")}
        </p>
      </Card>

      <Card className="space-y-3">
        <CardTitle>{zh ? "价格明细" : "Price breakdown"}</CardTitle>
        <PriceBreakdown
          locale={loc}
          quote={quoteFromBooking(booking)}
          lessonType={booking.lessonType}
          earlyBird={booking.earlyBird}
          packageUse={
            booking.package
              ? { code: booking.package.code, hours: booking.hours }
              : undefined
          }
        />
        {/* The buyer and every coach can open the package. */}
        {booking.package &&
          (access.isCustomer ||
            user.role === "COACH" ||
            user.role === "ADMIN") && (
          <Link
            href={`/packages/${booking.package.code}`}
            className="inline-block text-sm font-bold text-accent underline underline-offset-2"
          >
            {zh ? "查看课时包" : "View lesson package"}
          </Link>
        )}
        {/* A deposit booking is confirmed with money still owing, so the
            status pill alone would be misleading. */}
        {booking.paymentPlan === "DEPOSIT" && (
          <p
            className="rounded-xl p-3 text-sm font-semibold"
            style={{
              background: owing > 0 ? "var(--amber-bg)" : "var(--success-bg)",
              color: owing > 0 ? "var(--amber)" : "var(--success)",
            }}
            data-numeric
          >
            {owing === 0
              ? zh
                ? "已付清全部课费"
                : "Paid in full"
              : booking.amountPaidCents === 0
                ? // Nothing has cleared yet: describe the plan, not a payment.
                  zh
                  ? `分两次付款:先付定金 ${formatMoneyShort(booking.depositCents)},余款 ${formatMoneyShort(owing - booking.depositCents)} 课后支付`
                  : `Paying in two parts: ${formatMoneyShort(booking.depositCents)} deposit now, ${formatMoneyShort(owing - booking.depositCents)} after the lesson`
                : zh
                  ? `已付定金 ${formatMoneyShort(booking.amountPaidCents)},课后需再付 ${formatMoneyShort(owing)}`
                  : `Deposit of ${formatMoneyShort(booking.amountPaidCents)} paid — ${formatMoneyShort(owing)} due after the lesson`}
          </p>
        )}
      </Card>

      {(booking.requestedSkills.length > 0 || booking.studentLevel) && (
        <Card className="space-y-2">
          <CardTitle className="flex items-center gap-2">
            <Target className="size-4 text-accent" aria-hidden />
            {zh ? "本课重点" : "Focus for this lesson"}
          </CardTitle>
          {booking.studentLevel && (
            <p className="text-sm text-ink-2">
              {zh ? "学员水平:" : "Ability: "}
              <strong className="text-ink">
                {levelLabel(booking.studentLevel, loc)}
              </strong>
            </p>
          )}
          {booking.requestedSkills.length > 0 && (
            <ul className="flex flex-wrap gap-1.5">
              {booking.requestedSkills.map((key) => (
                <li
                  key={key}
                  className="rounded-full border border-border bg-surface-2 px-2.5 py-1 text-xs font-semibold text-ink-2"
                >
                  {requestedSkillLabel(key, loc, booking.requestedSkillsSnapshot)}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

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
        <p
          className="rounded-xl border p-4 text-sm font-medium"
          style={{
            background: "var(--pill-checking-bg)",
            borderColor: "var(--pill-checking-br)",
            color: "var(--pill-checking-fg)",
          }}
        >
          {tp(booking.paymentMethod === "WECHAT" && !booking.paymentProofKey
            ? "awaitingWechat"
            : "awaitingReview")}
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

      {booking.status === "CANCELLED" && (
        <Card
          className="space-y-1.5"
          style={{ borderColor: "var(--danger-border)" }}
        >
          <CardTitle>{zh ? "已取消" : "Cancelled"}</CardTitle>
          {booking.cancelReason && (
            <p className="text-sm text-ink-2">{booking.cancelReason}</p>
          )}
        </Card>
      )}

      {booking.coachSummary && !access.isCoach && (
        <Card className="space-y-3">
          <CardTitle className="flex items-center gap-2">
            <NotebookPen className="size-4 text-accent" aria-hidden />
            {zh ? "课后总结" : "Lesson notes"}
          </CardTitle>
          {booking.coachSummary && (
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-2">
              {booking.coachSummary}
            </p>
          )}
        </Card>
      )}

      {/* A package booking has no payment of its own to review. Another coach
          sees the payment read-only: review and upload stay with this
          booking's coach. */}
      {access.isAnyCoach && booking.paymentPlan !== "PACKAGE" && (
        <CoachReviewPanel
          key={`${booking.code}:${booking.updatedAt.toISOString()}`}
          locale={loc}
          expectedUpdatedAt={booking.updatedAt.toISOString()}
          target={{ kind: "booking", code: booking.code }}
          confirmed={booking.status === "CONFIRMED"}
          submitted={booking.status === "PENDING_PAYMENT_REVIEW"}
          hasProof={Boolean(booking.paymentProofKey)}
          proofUploadedBy={booking.proofUploadedBy}
          paymentMethod={booking.paymentMethod}
          paymentReference={booking.paymentReference}
          canReview={access.canReview}
          canUploadProof={!holdExpired && access.canPay}
          canConfirmReceipt={!holdExpired && access.isCoach && allSigned && access.canPay}
        />
      )}

      {access.isCoach && (
        <CoachLessonPanel
          locale={loc}
          bookingCode={booking.code}
          balanceCents={owing}
          paidCents={booking.amountPaidCents}
          depositCents={booking.depositCents}
          isDeposit={booking.paymentPlan === "DEPOSIT"}
          canSettleBalance={["CONFIRMED", "COMPLETED"].includes(booking.status)}
          canCancel={!holdExpired && access.canCancel}
          summary={booking.coachSummary}
          isConfirmed={booking.status === "CONFIRMED"}
          canComplete={booking.status === "CONFIRMED" && booking.lessonEndAt.getTime() <= now.getTime()}
        />
      )}

      <section id="video-analysis" className="scroll-mt-28 space-y-3">
      <SectionHeading title={zh ? "课程视频与分析" : "Lesson videos and analysis"}
        description={zh ? "这节课的视频、分析状态和报告。" : "This lesson's videos, analysis status and reports."} />
      <VideoAnalysisPanel
        locale={loc}
        bookingCode={booking.code}
        bookedHours={booking.hours}
        completed={booking.status === "COMPLETED"}
        isCustomer={access.isCustomer}
        isOwnCoach={access.isCoach}
        canUpload={(access.isCustomer || access.isCoach) && ["CONFIRMED", "COMPLETED"].includes(booking.status)}
        initialVideos={videos.map((video) => ({
          id: video.id,
          caption: video.caption,
          uploadedAt: video.uploadedAt.toISOString(),
          url: `/api/bookings/${booking.code}/videos/${video.id}`,
          canDelete: access.isCoach || video.uploadedById === user.id,
          contentType: video.contentType,
          analysisSupported: video.contentType === "video/mp4" || video.contentType === "video/quicktime",
        }))}
      />
      </section>

      {snapshot && (
        <Card className="space-y-2">
          <CardTitle>{zh ? "取消与退款政策" : "Cancellation policy"}</CardTitle>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-2">
            {zh
              ? snapshot.cancellationPolicy.zh
              : snapshot.cancellationPolicy.en}
          </p>
          <p className="text-xs text-ink-3">
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
      <dt className="text-ink-2">{term}</dt>
      <dd className={strong ? "font-bold" : "text-ink"}>{value}</dd>
    </div>
  );
}
