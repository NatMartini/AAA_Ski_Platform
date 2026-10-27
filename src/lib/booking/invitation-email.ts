import { formatTorontoDateTime } from "../time";

export type CoachInvitationEmail = { to: string; subject: string; text: string };

export type CoachInvitationEmailInput = {
  code: string;
  to: string;
  studentName: string;
  isMinor: boolean;
  coachName: string;
  signingUrl: string;
  bookingUrl?: string;
  expiresAt?: Date | string;
  /** Group guests sign individually; the order creator handles one payment. */
  groupSigningOnly?: boolean;
};

function line(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

/** A fixed bilingual draft for the coach to send manually; this sends nothing. */
export function buildCoachInvitationEmail(input: CoachInvitationEmailInput): CoachInvitationEmail {
  const to = line(input.to).toLowerCase();
  const code = line(input.code);
  const student = line(input.studentName);
  const coach = line(input.coachName);
  const signingUrl = line(input.signingUrl);
  const bookingUrl = input.bookingUrl && !input.groupSigningOnly ? line(input.bookingUrl) : null;
  const expiry = input.expiresAt ? new Date(input.expiresAt) : null;
  const zhExpiry = expiry
    ? `签字链接有效至 ${formatTorontoDateTime(expiry, "zh")}（多伦多时间），仅可使用一次。`
    : "签字链接自生成起 7 天内有效，仅可使用一次。";
  const enExpiry = expiry
    ? `The signing link expires on ${formatTorontoDateTime(expiry, "en")} (Toronto time) and can be used once.`
    : "The signing link is valid for 7 days from generation and can be used once.";

  const zh = [
    input.isMinor ? `${student} 的监护人，您好：` : `${student}，您好：`,
    "",
    `${coach} 教练已为 ${student} 安排课程，预约编号：${code}。`,
    `请使用 Google 账号 ${to} 登录 AAA Ski 平台。`,
    input.isMinor
      ? "学员未满 18 岁，请由您以监护人身份阅读并签署免责协议。教练不能代签。"
      : "请由学员本人阅读并签署免责协议。教练不能代签。",
    "",
    "1. 打开以下链接，确认课程信息并签署免责协议：",
    signingUrl,
    ...(input.groupSigningOnly
      ? ["2. 每位学员须分别完成签署；未成年学员须由监护人签署。", "3. 全部签字收集齐后，由订单创建人统一付款，再等待教练确认收款。您无需重复支付整笔课程费用。"]
      : ["2. 签署后，按订单页面的金额及教练收款信息完成付款。", "3. 按付款页面要求提交付款凭证或付款声明，等待教练确认收款。"]),
    "付款获教练确认后，预约正式生效。",
    "",
    zhExpiry,
    ...(bookingUrl ? ["签署完成后，可通过以下订单链接继续付款或查看预约：", bookingUrl] : []),
    "如需更换登录邮箱、修改课程或重新获取签字链接，请联系教练。",
  ].join("\n");
  const en = [
    input.isMinor ? `Hello ${student}'s parent or guardian,` : `Hello ${student},`,
    "",
    `Coach ${coach} has arranged a lesson for ${student}. Booking reference: ${code}.`,
    `Sign in to the AAA Ski platform with the Google account ${to}.`,
    input.isMinor
      ? "As the student is under 18, their parent or guardian must read and sign the waiver. The coach cannot sign for them."
      : "The student must read and sign their own waiver. The coach cannot sign for them.",
    "",
    "1. Open this link to review the lesson details and sign the waiver:",
    signingUrl,
    ...(input.groupSigningOnly
      ? ["2. Each student signs separately; a parent or guardian signs for a minor.", "3. Once all signatures are collected, the order creator makes one payment and the coach confirms receipt. You do not need to pay the whole lesson again."]
      : ["2. After signing, pay the amount shown on the order page using the coach's payment details.", "3. Submit the payment proof or payment declaration requested on the payment page, then wait for the coach to confirm receipt."]),
    "Your booking becomes confirmed after the coach accepts the payment.",
    "",
    enExpiry,
    ...(bookingUrl ? ["After signing, use this order link to finish payment or view your booking:", bookingUrl] : []),
    "Contact your coach to change the sign-in email or lesson details, or to request a new signing link.",
  ].join("\n");

  return {
    to,
    subject: `AAA Ski 课程邀请 / Lesson invitation — ${code}`,
    text: `${zh}\n\n——————————\n\n${en}`,
  };
}

export function invitationEmailClipboardText(invitation: CoachInvitationEmail): string {
  return `收件人 / To: ${invitation.to}\n主题 / Subject: ${invitation.subject}\n\n${invitation.text}`;
}

export function invitationEmailMailto(invitation: CoachInvitationEmail): string {
  return `mailto:${encodeURIComponent(invitation.to)}?subject=${encodeURIComponent(invitation.subject)}&body=${encodeURIComponent(invitation.text)}`;
}
