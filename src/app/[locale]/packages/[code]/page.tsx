import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { prisma } from "@/lib/prisma";
import { requireUserPage } from "@/lib/auth/require-user";
import { Card, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { PaymentPanel } from "@/components/booking/payment-panel";
import { CoachReviewPanel } from "@/components/coach/coach-review-panel";
import { PackageStatusPill } from "@/components/packages/package-status-pill";
import { PackageCancel } from "@/components/packages/package-cancel";
import { accessForPackage, loadPackage } from "@/lib/package-store";
import { hoursUsed, offerLabel } from "@/lib/packages";
import { lessonTypeLabel } from "@/lib/lesson-types";
import { isSelfServeHoldExpired } from "@/lib/booking/hold";
import { formatMoneyShort } from "@/lib/pricing";
import { formatTorontoDate } from "@/lib/time";
import { formatSeason } from "@/lib/season";
import { toLocale } from "@/i18n/routing";
import { CalendarPlus } from "lucide-react";

export default async function PackagePage({
  params,
}: PageProps<"/[locale]/packages/[code]">) {
  const { locale, code } = await params;
  setRequestLocale(locale);
  const user = await requireUserPage({
    locale,
    callbackPath: `/${locale}/packages/${code}`,
  });

  const pkg = await loadPackage(code);
  if (!pkg) notFound();
  const now = new Date();
  const access = accessForPackage(pkg, user, now);
  if (!access.canView) notFound();

  const loc = toLocale(locale);
  const zh = loc === "zh";
  const used = hoursUsed(pkg.bookings, now);
  const payeeName = pkg.payeeCoach.name ?? pkg.payeeCoach.email;
  const resortName = zh ? pkg.resort.nameZh : pkg.resort.nameEn;

  // The QR codes and e-Transfer address belong to the coach being paid.
  const payee = access.canPay
    ? await prisma.coachProfile.findUnique({
        where: { userId: pkg.payeeCoachId },
      })
    : null;
  // Names of the coaches who taught from it, for the lesson list.
  const coachNames = new Map(
    (
      await prisma.coachProfile.findMany({
        where: { userId: { in: pkg.bookings.map((b) => b.coachId) } },
        select: { userId: true, displayName: true },
      })
    ).map((c) => [c.userId, c.displayName]),
  );
  const lessons = pkg.bookings.filter((b) => !isSelfServeHoldExpired(b, now));

  const summary = (
    <dl className="overflow-hidden rounded-xl border border-border bg-surface-3 text-sm">
      <div className="flex items-center justify-between gap-4 px-4 py-2.5">
        <dt className="text-ink-2">
          {lessonTypeLabel(pkg.lessonType, loc)} · {resortName}
        </dt>
        <dd className="tabular-nums">
          {pkg.hours} {zh ? "小时" : "hours"}
        </dd>
      </div>
      <div className="flex items-center justify-between gap-4 border-t border-border bg-surface px-4 py-3.5">
        <dt className="font-bold">{zh ? "实付(加元 CAD)" : "Total (CAD)"}</dt>
        <dd className="text-xl font-extrabold tabular-nums tracking-tight">
          {formatMoneyShort(pkg.priceCents)}
        </dd>
      </div>
    </dl>
  );

  return (
    <div className="stagger space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-xs font-bold tracking-widest text-ink-3">
            {pkg.code}
          </p>
          <h1 className="mt-1 text-3xl">{offerLabel(pkg.offerKey, loc)}</h1>
        </div>
        <PackageStatusPill status={pkg.status} locale={loc} className="mt-1" />
      </div>

      <Card className="space-y-3">
        <CardTitle data-numeric>
          {zh
            ? `剩余 ${pkg.hours - used} / ${pkg.hours} 小时`
            : `${pkg.hours - used} of ${pkg.hours} hours left`}
        </CardTitle>
        <dl className="space-y-1.5 text-sm">
          <Row term={zh ? "雪场" : "Resort"} value={resortName} />
          <Row
            term={zh ? "课程" : "Lesson"}
            value={`${lessonTypeLabel(pkg.lessonType, loc)} · ${zh ? "任意教练" : "any coach"}`}
          />
          <Row term={zh ? "有效期" : "Valid for"} value={formatSeason(pkg.season, loc)} />
          <Row term={zh ? "价格" : "Price"} value={formatMoneyShort(pkg.priceCents)} />
          <Row term={zh ? "付款给" : "Paid to"} value={payeeName} />
          {access.isPayee && (
            <Row
              term={zh ? "购买人" : "Bought by"}
              value={pkg.account.name ?? pkg.account.email}
            />
          )}
        </dl>
        {pkg.status === "ACTIVE" && access.isBuyer && pkg.hours - used > 0 && (
          <Button asChild className="self-start">
            <Link href={`/book/${pkg.resort.slug}`}>
              <CalendarPlus aria-hidden />
              {zh ? "用课时包约课" : "Book with this package"}
            </Link>
          </Button>
        )}
      </Card>

      {lessons.length > 0 && (
        <Card className="space-y-2">
          <CardTitle>{zh ? "用这个课时包的课" : "Lessons from this package"}</CardTitle>
          <ul className="divide-y divide-border text-sm">
            {lessons.map((b) => (
              <li key={b.code} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <span>
                  {formatTorontoDate(b.startAt, loc)} · {coachNames.get(b.coachId) ?? "—"} ·{" "}
                  {b.hours} {zh ? "小时" : "h"}
                  {b.participantNameSnapshot ? ` · ${b.participantNameSnapshot}` : ""}
                </span>
                <span className="flex items-center gap-2">
                  <StatusPill status={b.status} locale={loc} />
                  {(access.isBuyer || b.coachId === user.id) && (
                    <Link
                      href={`/booking/${b.code}`}
                      className="font-mono text-xs font-bold text-accent underline underline-offset-2"
                    >
                      {b.code}
                    </Link>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {pkg.status === "PENDING_PAYMENT_REVIEW" && access.isBuyer && (
        <p
          className="rounded-xl border p-4 text-sm font-medium"
          style={{
            background: "var(--pill-checking-bg)",
            borderColor: "var(--pill-checking-br)",
            color: "var(--pill-checking-fg)",
          }}
        >
          {zh
            ? `已收到你的付款截图,${payeeName} 确认后课时包即可使用。`
            : `Your screenshot is in. The package is ready once ${payeeName} confirms it.`}
        </p>
      )}

      {pkg.status === "AWAITING_PAYMENT" && !access.canPay && (
        <p className="rounded-xl bg-surface-2 p-4 text-sm text-ink-2">
          {zh
            ? "早鸟已截止,这个订单不能再付款了。"
            : "The early bird is over, so this order can no longer be paid."}
        </p>
      )}

      {access.canPay && payee && access.isBuyer && (
        <PaymentPanel
          locale={loc}
          target={{ kind: "package", code: pkg.code }}
          coachId={pkg.payeeCoachId}
          isCoach={false}
          totalCents={pkg.priceCents}
          currency={pkg.currency}
          amountDueCents={pkg.priceCents}
          breakdown={summary}
          rejectedNote={pkg.status === "PAYMENT_REJECTED" ? pkg.reviewNote : null}
          methods={{
            emt:
              payee.emtEnabled && payee.emtEmail
                ? { email: payee.emtEmail, name: payee.emtName }
                : null,
            wechat: Boolean(payee.wechatPayEnabled && payee.wechatPayQrKey),
            alipay: Boolean(payee.alipayEnabled && payee.alipayQrKey),
          }}
        />
      )}

      {access.isPayee && (
        <CoachReviewPanel
          locale={loc}
          target={{ kind: "package", code: pkg.code }}
          confirmed={pkg.status === "ACTIVE"}
          hasProof={Boolean(pkg.paymentProofKey)}
          proofUploadedBy={null}
          paymentMethod={pkg.paymentMethod}
          paymentReference={pkg.paymentReference}
          canReview={access.canReview}
          canUploadProof={access.canPay}
        />
      )}

      {pkg.status === "CANCELLED" && (
        <Card className="space-y-1.5" style={{ borderColor: "var(--danger-border)" }}>
          <CardTitle>{zh ? "已取消" : "Cancelled"}</CardTitle>
          {pkg.cancelReason && <p className="text-sm text-ink-2">{pkg.cancelReason}</p>}
        </Card>
      )}

      {access.canCancel && <PackageCancel locale={loc} packageCode={pkg.code} />}
    </div>
  );
}

function Row({ term, value }: { term: string; value: string }) {
  return (
    <div className="flex flex-wrap justify-between gap-2">
      <dt className="text-ink-2">{term}</dt>
      <dd className="text-ink">{value}</dd>
    </div>
  );
}
