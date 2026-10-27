import { setRequestLocale, getTranslations } from "next-intl/server";
import { requireUserPage } from "@/lib/auth/require-user";
import { checkInvite } from "@/lib/waiver/invite";
import { loadBooking } from "@/lib/booking/access";
import { clausesFor, WARNING } from "@/lib/waiver/template-v1";
import { WaiverForm } from "@/components/waiver/waiver-form";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { toLocale } from "@/i18n/routing";
import { formatTorontoDate, formatTorontoTime } from "@/lib/time";
import { TriangleAlert } from "lucide-react";
import { PriceBreakdown } from "@/components/booking/price-breakdown";
import { quoteFromBooking } from "@/lib/pricing";

/**
 * Landing page for a coach-issued signing link.
 *
 * Sign-in is required before anything is shown, both because the signature has
 * to be attributable to a verified address and because this site never renders
 * booking details to an anonymous visitor.
 */
export default async function SigningLinkPage({
  params,
}: PageProps<"/[locale]/w/[token]">) {
  const { locale, token } = await params;
  setRequestLocale(locale);

  const user = await requireUserPage({
    locale,
    callbackPath: `/${locale}/w/${token}`,
  });

  const loc = toLocale(locale);
  const zh = loc === "zh";
  const t = await getTranslations("waiver");

  const check = await checkInvite(token, user.email);

  if (!check.ok) {
    return (
      <Card className="mx-auto max-w-md space-y-3">
        <CardTitle className="flex items-center gap-2">
          <TriangleAlert className="size-5 text-amber-600" aria-hidden />
          {check.reason === "email-mismatch"
            ? zh
              ? "账号不匹配"
              : "Wrong account"
            : zh
              ? "链接无法使用"
              : "This link cannot be used"}
        </CardTitle>
        <CardDescription>
          {check.reason === "email-mismatch" ? (
            <>
              {zh
                ? `此签字链接是发给 ${check.expected} 的,而你当前登录的是 ${user.email}。请用正确的账号登录,或让教练把链接重新发到你现在的邮箱。`
                : `This link was issued to ${check.expected}, but you are signed in as ${user.email}. Sign in with the right account, or ask your coach to reissue it to this address.`}
            </>
          ) : (
            <>
              {/* Deliberately vague: expired, already used and never-existed
                  all read the same, so the page cannot be used to probe. */}
              {zh
                ? "该链接可能已过期、已被使用,或已失效。请联系教练重新发送。"
                : "The link may have expired, already been used, or no longer be valid. Ask your coach to send a new one."}
            </>
          )}
        </CardDescription>
      </Card>
    );
  }

  const booking = await loadBooking(check.bookingCode);
  const personalInvite = check as typeof check & { fullName?: string; isMinor?: boolean; ordinal?: number };
  const studentName = personalInvite.fullName ?? booking?.inviteName;
  if (!booking || !studentName) {
    return (
      <Card className="mx-auto max-w-md">
        <CardDescription>
          {zh ? "该链接已失效。" : "This link is no longer valid."}
        </CardDescription>
      </Card>
    );
  }

  const isMinor = personalInvite.isMinor ?? booking.inviteIsMinor;
  const isExtraGuest = (personalInvite.ordinal ?? 1) > 1 && booking.accountId !== user.id;
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
        <p className="text-sm text-muted-foreground">{booking.code}</p>
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
      </div>

      <Card className="space-y-1.5 text-sm">
        <p>
          <span className="text-muted-foreground">
            {zh ? "学员:" : "Student: "}
          </span>
          {studentName}
        </p>
        <p>
          <span className="text-muted-foreground">
            {zh ? "课程:" : "Lesson: "}
          </span>
          {formatTorontoDate(booking.lessonStartAt, loc)}{" "}
          {formatTorontoTime(booking.lessonStartAt, loc)} –{" "}
          {formatTorontoTime(booking.lessonEndAt, loc)}
        </p>
        <p>
          <span className="text-muted-foreground">{zh ? "雪场:" : "Resort: "}</span>
          {zh ? booking.resort.nameZh : booking.resort.nameEn}
        </p>
        <p>
          <span className="text-muted-foreground">
            {zh ? "教练:" : "Coach: "}
          </span>
          {booking.coach.name ?? booking.coach.email}
        </p>
      </Card>

      <PriceBreakdown quote={quoteFromBooking(booking)} locale={loc} lessonType={booking.lessonType} earlyBird={booking.earlyBird} />

      {booking.headcount > 1 && <p className="rounded-xl border border-border bg-surface-2 p-4 text-sm text-ink-2">{zh ? "这是你本人或你监护的未成年学员的个人免责协议。每位学员独立签署，全部签署完成后由预约人统一付款。" : "This is the personal waiver for you or the minor in your care. Each student signs independently; the booking organizer pays after all signatures are complete."}</p>}

      <WaiverForm
        locale={loc}
        bookingCode={booking.code}
        clauses={clauses}
        isGuardian={isMinor}
        minorNotice={isMinor ? t("minorNotice") : null}
        warning={zh ? WARNING.zh : WARNING.en}
        prefill={{ typedName: user.name, guardianName: isMinor ? user.name : null }}
        postTo={`/api/waiver-invites/${token}`}
        redirectTo={`/booking/${booking.code}`}
        stayOnSuccess={isExtraGuest}
      />
    </div>
  );
}
