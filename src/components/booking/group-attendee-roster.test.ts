import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
vi.mock("@/i18n/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
import { GroupAttendeeRoster } from "./group-attendee-roster";

describe("group roster sharing and signed PDF controls", () => {
  it("shows a valid signature separately from permission to download the other adult's waiver", () => {
    const html = renderToStaticMarkup(createElement(GroupAttendeeRoster, {
      locale: "en", code: "SKI-GROUP", allSigned: true, canManage: true, poll: false,
      attendees: [
        { id: "self", ordinal: 1, fullName: "Purchaser", email: "self@example.com", isMinor: false, signed: true, canReadPdf: true },
        { id: "other", ordinal: 2, fullName: "Other adult", email: "other@example.com", isMinor: false, signed: true, canReadPdf: false },
      ],
    }));
    expect(html).toContain("Everyone has signed their waiver");
    expect(html).toContain("attendee=self");
    expect(html).not.toContain("attendee=other");
    expect(html).not.toContain("Generate email and signing link");
  });

  it("keeps self-serve primary signing on its own waiver route instead of issuing an unsupported invite", () => {
    const html = renderToStaticMarkup(createElement(GroupAttendeeRoster, {
      locale: "zh", code: "SKI-GROUP", allSigned: false, canManage: true, poll: false,
      attendees: [{ id: "self", ordinal: 1, fullName: "Purchaser", email: "self@example.com", isMinor: false, signed: false, canInvite: false }],
    }));
    expect(html).toContain("待签署");
    expect(html).not.toContain("生成邮件与签字链接");
  });

  it("requires each missing signature and generates individual links only for the authorized organizer", () => {
    const props = {
      locale: "zh" as const, code: "SKI-GROUP", allSigned: false, poll: false,
      attendees: [{ id: "guest", ordinal: 2, fullName: "Guest", email: "guest@example.com", isMinor: false, signed: false }],
    };
    const owner = renderToStaticMarkup(createElement(GroupAttendeeRoster, { ...props, canManage: true }));
    const viewer = renderToStaticMarkup(createElement(GroupAttendeeRoster, { ...props, canManage: false }));
    expect(owner).toContain("全部签署完成后才开放付款");
    expect(owner).toContain("生成邮件与签字链接");
    expect(viewer).not.toContain("生成邮件与签字链接");
  });
});
