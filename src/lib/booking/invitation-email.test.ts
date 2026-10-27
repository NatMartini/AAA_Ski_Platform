import { describe, expect, it } from "vitest";
import {
  buildCoachInvitationEmail, invitationEmailClipboardText, invitationEmailMailto,
} from "./invitation-email";

const input = {
  code: "SKI-INVITE", to: " Student@Example.com ", studentName: "Alex",
  isMinor: false, coachName: "Kevin",
  signingUrl: "https://ski.example/zh/w/one-time-token",
  bookingUrl: "https://ski.example/zh/booking/SKI-INVITE",
};

describe("fixed manual invitation email", () => {
  it("includes the exact adult identity, bilingual signing/payment steps and a reusable order link", () => {
    const invitation = buildCoachInvitationEmail(input);
    expect(invitation.to).toBe("student@example.com");
    expect(invitation.subject).toBe("AAA Ski 课程邀请 / Lesson invitation — SKI-INVITE");
    expect(invitation.text).toContain("请使用 Google 账号 student@example.com 登录");
    expect(invitation.text).toContain("Google account student@example.com");
    expect(invitation.text).toContain("请由学员本人阅读并签署免责协议");
    expect(invitation.text).toContain("The student must read and sign their own waiver");
    expect(invitation.text).toContain("按订单页面的金额及教练收款信息完成付款");
    expect(invitation.text).toContain("Submit the payment proof or payment declaration");
    expect(invitation.text).toContain("wait for the coach to confirm receipt");
    expect(invitation.text).toContain("7 天内有效，仅可使用一次");
    expect(invitation.text).toContain("valid for 7 days from generation");
    expect(invitation.text.split(input.signingUrl)).toHaveLength(3);
    expect(invitation.text.split(input.bookingUrl)).toHaveLength(3);
  });

  it("addresses a minor's guardian, not the child, and binds signing to the guardian email", () => {
    const invitation = buildCoachInvitationEmail({ ...input, isMinor: true, studentName: "小明", to: "guardian@example.com" });
    expect(invitation.to).toBe("guardian@example.com");
    expect(invitation.text).toContain("小明 的监护人，您好");
    expect(invitation.text).toContain("请由您以监护人身份阅读并签署免责协议");
    expect(invitation.text).toContain("小明's parent or guardian");
    expect(invitation.text).toContain("parent or guardian must read and sign");
    expect(invitation.text).not.toContain("The student must read and sign their own waiver");
    expect(invitation.text).toContain("Google account guardian@example.com");
  });

  it("can show an exact expiry in Toronto time and handles an omitted persistent URL", () => {
    const invitation = buildCoachInvitationEmail({ ...input, bookingUrl: undefined, expiresAt: "2026-12-01T15:00:00Z" });
    expect(invitation.text).toContain("多伦多时间");
    expect(invitation.text).toContain("Toronto time");
    expect(invitation.text).toContain("10:00");
    expect(invitation.text).not.toContain("https://ski.example/zh/booking/");
  });

  it("copies the recipient, subject and complete body together", () => {
    const invitation = buildCoachInvitationEmail(input);
    const text = invitationEmailClipboardText(invitation);
    expect(text).toBe(`收件人 / To: student@example.com\n主题 / Subject: ${invitation.subject}\n\n${invitation.text}`);
  });

  it("tells group guests to sign separately and leaves payment with the order creator", () => {
    const invitation = buildCoachInvitationEmail({ ...input, groupSigningOnly: true });
    expect(invitation.text).toContain("全部签字收集齐后，由订单创建人统一付款");
    expect(invitation.text).toContain("the order creator makes one payment");
    expect(invitation.text).not.toContain(input.bookingUrl);
    expect(invitation.text).not.toContain("pay the amount shown on the order page");
  });

  it("encodes an email-app draft without changing body content or introducing extra recipients", () => {
    const invitation = buildCoachInvitationEmail({ ...input, studentName: "Alex & Sam", coachName: "Kevin + Team" });
    const link = new URL(invitationEmailMailto(invitation));
    expect(link.protocol).toBe("mailto:");
    expect(decodeURIComponent(link.pathname)).toBe(invitation.to);
    expect(link.searchParams.get("subject")).toBe(invitation.subject);
    expect(link.searchParams.get("body")).toBe(invitation.text);
    expect([...link.searchParams.keys()]).toEqual(["subject", "body"]);
  });

  it("keeps header values to one line and never claims automatic delivery", () => {
    const invitation = buildCoachInvitationEmail({ ...input, code: "SKI-INVITE\r\nUnexpected header", to: "student@example.com\r\n" });
    expect(invitation.subject).not.toMatch(/[\r\n]/);
    expect(invitation.to).toBe("student@example.com");
    expect(invitation.text).not.toContain("已发送");
    expect(invitation.text).not.toContain("email has been sent");
  });
});
