import { prisma } from "../prisma";
import { baseUrl, sendMail } from "../mail";
import { renderDisclosureText, type DisclosureSnapshot } from "./disclosure";
import type { Locale } from "@/i18n/routing";

/**
 * Transactional mail for a booking.
 *
 * Always best-effort: callers swallow failures, because a booking that exists
 * in the database but whose email bounced is still a valid booking, and the
 * student can re-read everything on the site.
 */

export async function sendBookingConfirmation(
  code: string,
  locale: Locale,
): Promise<void> {
  const booking = await prisma.booking.findUnique({
    where: { code },
    select: {
      code: true,
      disclosureSnapshot: true,
      account: { select: { email: true } },
      inviteEmail: true,
      confirmationSentAt: true,
    },
  });
  if (!booking?.disclosureSnapshot) return;

  const to = booking.account?.email ?? booking.inviteEmail;
  if (!to) return;

  const snapshot = booking.disclosureSnapshot as unknown as DisclosureSnapshot;
  const zh = locale === "zh";

  const body = [
    zh
      ? "你的滑雪课已预定,详情如下。"
      : "Your ski lesson is booked. Details below.",
    "",
    renderDisclosureText(snapshot, booking.code, locale),
    "",
    zh
      ? "请在网站上完成免责协议签署与付款:"
      : "Finish signing the waiver and paying here:",
    `${baseUrl()}/${locale}/booking/${booking.code}`,
    "",
    zh
      ? "这是一封交易通知邮件,不是营销邮件。"
      : "This is a transactional message about your booking, not marketing.",
  ].join("\n");

  const result = await sendMail({
    to,
    subject: zh
      ? `预定确认 ${booking.code} · ${snapshot.coach.displayName}`
      : `Booking ${booking.code} · ${snapshot.coach.displayName}`,
    text: body,
  });

  // Record the attempt either way: "we tried at this time" is the useful fact
  // when a student says they never received it.
  if (result.sent || result.reason === "not-configured") {
    await prisma.booking.update({
      where: { code },
      data: { confirmationSentAt: new Date() },
    });
  }
}

export async function sendWaiverInviteEmail(input: {
  code: string;
  to: string;
  studentName: string;
  coachName: string;
  signingUrl: string;
  locale: Locale;
}): Promise<void> {
  const zh = input.locale === "zh";

  const body = [
    zh ? `${input.studentName} 你好,` : `Hello ${input.studentName},`,
    "",
    zh
      ? `教练 ${input.coachName} 已为你安排了一节滑雪课(订单号 ${input.code})。`
      : `${input.coachName} has arranged a ski lesson for you (booking ${input.code}).`,
    zh
      ? "上课前需要你本人签署一份免责协议。请打开下面的链接,用这个邮箱对应的 Google 账号登录后签署:"
      : "Before the lesson you need to sign a liability waiver yourself. Open the link below and sign in with the Google account for this email address:",
    "",
    input.signingUrl,
    "",
    zh
      ? "该链接 7 天内有效,只能使用一次,且只有这个邮箱的账号可以签署。"
      : "The link is valid for 7 days, can be used once, and only the account for this address can sign it.",
  ].join("\n");

  await sendMail({
    to: input.to,
    subject: zh
      ? `请签署免责协议 · ${input.code}`
      : `Please sign your waiver · ${input.code}`,
    text: body,
  });
}

export async function sendPaymentReviewed(input: {
  code: string;
  to: string;
  approved: boolean;
  note: string | null;
  locale: Locale;
}): Promise<void> {
  const zh = input.locale === "zh";

  const body = input.approved
    ? [
        zh
          ? `订单 ${input.code} 的付款已确认,预定成功。`
          : `Payment for booking ${input.code} is confirmed. You are booked in.`,
        "",
        `${baseUrl()}/${input.locale}/booking/${input.code}`,
      ].join("\n")
    : [
        zh
          ? `订单 ${input.code} 的付款未通过。`
          : `The payment for booking ${input.code} was not accepted.`,
        input.note
          ? zh
            ? `原因:${input.note}`
            : `Reason: ${input.note}`
          : "",
        "",
        zh
          ? "你的时段仍然保留,请重新上传付款截图:"
          : "Your slot is still held. Please upload the screenshot again:",
        `${baseUrl()}/${input.locale}/booking/${input.code}/payment`,
      ]
        .filter(Boolean)
        .join("\n");

  await sendMail({
    to: input.to,
    subject: input.approved
      ? zh
        ? `预定成功 · ${input.code}`
        : `Booking confirmed · ${input.code}`
      : zh
        ? `付款需重新提交 · ${input.code}`
        : `Payment needs re-submitting · ${input.code}`,
    text: body,
  });
}

export async function sendPackageReviewed(input: {
  code: string;
  to: string;
  approved: boolean;
  note: string | null;
  locale: Locale;
}): Promise<void> {
  const zh = input.locale === "zh";
  const url = `${baseUrl()}/${input.locale}/packages/${input.code}`;

  const body = input.approved
    ? [
        zh
          ? `课时包 ${input.code} 的付款已确认,现在可以用它预约课程了。`
          : `Payment for lesson package ${input.code} is confirmed. You can now book lessons with it.`,
        "",
        url,
      ].join("\n")
    : [
        zh
          ? `课时包 ${input.code} 的付款未通过。`
          : `The payment for lesson package ${input.code} was not accepted.`,
        input.note
          ? zh
            ? `原因:${input.note}`
            : `Reason: ${input.note}`
          : "",
        "",
        zh ? "请重新上传付款截图:" : "Please upload the screenshot again:",
        url,
      ]
        .filter(Boolean)
        .join("\n");

  await sendMail({
    to: input.to,
    subject: input.approved
      ? zh
        ? `课时包已生效 · ${input.code}`
        : `Lesson package ready · ${input.code}`
      : zh
        ? `付款需重新提交 · ${input.code}`
        : `Payment needs re-submitting · ${input.code}`,
    text: body,
  });
}

export async function sendBookingCancelled(input: {
  code: string;
  to: string;
  reason: string;
  byCoach: boolean;
  coachName: string;
  locale: Locale;
}): Promise<void> {
  const zh = input.locale === "zh";

  const body = [
    zh
      ? `订单 ${input.code} 已被取消。`
      : `Booking ${input.code} has been cancelled.`,
    input.byCoach
      ? zh
        ? `取消人:教练 ${input.coachName}`
        : `Cancelled by your coach, ${input.coachName}.`
      : zh
        ? "取消人:你本人"
        : "Cancelled by you.",
    "",
    zh ? `原因:${input.reason}` : `Reason: ${input.reason}`,
    "",
    // Deliberately not a claim about what will be refunded: the terms are the
    // ones frozen onto the booking, and the coach settles refunds by hand.
    zh
      ? "退款按你下单时的取消政策处理,教练会与你联系。"
      : "Any refund follows the cancellation policy as it stood when you booked; your coach will be in touch.",
    "",
    `${baseUrl()}/${input.locale}/booking/${input.code}`,
  ].join("\n");

  await sendMail({
    to: input.to,
    subject: zh ? `课程已取消 · ${input.code}` : `Lesson cancelled · ${input.code}`,
    text: body,
  });
}

export async function sendLessonSummary(input: {
  code: string;
  to: string;
  coachName: string;
  locale: Locale;
}): Promise<void> {
  const zh = input.locale === "zh";

  // The summary itself is not put in the mail body: it can be long, it may be
  // edited afterwards, and the videos only exist behind a login anyway.
  const body = [
    zh
      ? `教练 ${input.coachName} 已经写好了 ${input.code} 这节课的课后总结。`
      : `${input.coachName} has written up your lesson (${input.code}).`,
    "",
    zh ? "打开这里查看总结和课程视频:" : "Read it and watch any video here:",
    `${baseUrl()}/${input.locale}/booking/${input.code}`,
  ].join("\n");

  await sendMail({
    to: input.to,
    subject: zh ? `课后总结 · ${input.code}` : `Your lesson notes · ${input.code}`,
    text: body,
  });
}
