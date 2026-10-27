import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CoachInvitationCard } from "./coach-invitation-card";
import { buildCoachInvitationEmail } from "@/lib/booking/invitation-email";

const signingUrl = "https://ski.example/zh/w/new-link";
const invitation = buildCoachInvitationEmail({
  code: "SKI-CARD", to: "guardian@example.com", studentName: "小明", isMinor: true,
  coachName: "Kevin", signingUrl,
});

describe("manual coach invitation card", () => {
  it("makes the full bilingual draft immediately available after creation", () => {
    const html = renderToStaticMarkup(createElement(CoachInvitationCard, {
      locale: "zh", code: "SKI-CARD", recipientEmail: invitation.to, isMinor: true,
      initial: { signingUrl, invitation },
    }));
    expect(html).toContain("收件人（监护人）");
    expect(html).toContain("guardian@example.com");
    expect(html).toContain("邮件由教练手动发送");
    expect(html).toContain("复制完整邮件");
    expect(html).toContain("复制正文");
    expect(html).toContain("The coach cannot sign for them");
    expect(html).toContain("生成新链接会使之前的签字链接失效");
    expect(html).toContain('href="mailto:');
  });

  it("requires an explicit generation action for an existing order with no plaintext token", () => {
    const html = renderToStaticMarkup(createElement(CoachInvitationCard, {
      locale: "en", code: "SKI-CARD", recipientEmail: "student@example.com", isMinor: false,
    }));
    expect(html).toContain("Recipient (adult student)");
    expect(html).toContain("Generate email and signing link");
    expect(html).toContain("coach sends this email manually");
    expect(html).not.toContain("Copy full email");
    expect(html).not.toContain("https://ski.example/zh/w/");
  });

  it("tells group recipients to sign personally while the organizer pays after all signatures", () => {
    const groupInvitation = buildCoachInvitationEmail({
      code: "SKI-CARD", to: "guardian@example.com", studentName: "小明", isMinor: true,
      coachName: "Kevin", signingUrl, groupSigningOnly: true,
      expiresAt: new Date("2026-12-07T12:00:00Z"),
    });
    const html = renderToStaticMarkup(createElement(CoachInvitationCard, {
      locale: "en", code: "SKI-CARD", recipientEmail: groupInvitation.to, isMinor: true,
      groupSigningOnly: true, senderRole: "organizer", initial: { signingUrl, invitation: groupInvitation },
    }));
    expect(html).toContain("Students do not each pay separately");
    expect(html).toContain("Sign before the deadline stated in the email");
    expect(html).not.toContain("valid for 7 days");
    expect(html).not.toContain("follow the order page to pay");
  });
});
