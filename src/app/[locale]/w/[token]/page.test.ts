import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ check: vi.fn(), load: vi.fn() }));
vi.mock("next-intl/server", () => ({ setRequestLocale: vi.fn(), getTranslations: async () => (key: string) => key }));
vi.mock("@/lib/auth/require-user", () => ({ requireUserPage: async () => ({ id: "guest-user", email: "guest@example.com", name: "Guest" }) }));
vi.mock("@/lib/waiver/invite", () => ({ checkInvite: mocks.check }));
vi.mock("@/lib/booking/access", () => ({ loadBooking: mocks.load }));
vi.mock("@/lib/pricing", () => ({ quoteFromBooking: () => ({}) }));
vi.mock("@/components/booking/price-breakdown", () => ({ PriceBreakdown: () => null }));
vi.mock("@/components/waiver/waiver-form", () => ({ WaiverForm: (props: { isGuardian: boolean; stayOnSuccess: boolean }) => createElement("div", { "data-guardian": props.isGuardian, "data-personal-completion": props.stayOnSuccess }) }));
import SigningLinkPage from "./page";

beforeEach(() => {
  mocks.check.mockResolvedValue({ ok: true, bookingCode: "SKI-GROUP", attendeeId: "guest-attendee", ordinal: 2, fullName: "Specific Guest", isMinor: false });
  mocks.load.mockResolvedValue({
    code: "SKI-GROUP", accountId: "purchaser", headcount: 3,
    inviteName: "PRIVATE PRIMARY NAME", inviteIsMinor: true,
    lessonStartAt: new Date("2026-12-03T15:10:00Z"), lessonEndAt: new Date("2026-12-03T17:00:00Z"),
    resort: { nameEn: "Resort", nameZh: "雪场" }, coach: { name: "Coach" },
    attendees: [{ fullName: "PRIVATE OTHER NAME", email: "PRIVATE OTHER EMAIL" }],
  });
});

describe("individual group signing page", () => {
  async function render() {
    return renderToStaticMarkup(await SigningLinkPage({
      params: Promise.resolve({ locale: "en", token: "personal-token" }), searchParams: Promise.resolve({}),
    }));
  }

  it("shows only that guest's identity and keeps them on a personal completion screen", async () => {
    const html = await render();
    expect(html).toContain("Specific Guest");
    expect(html).not.toContain("PRIVATE PRIMARY NAME");
    expect(html).not.toContain("PRIVATE OTHER NAME");
    expect(html).not.toContain("PRIVATE OTHER EMAIL");
    expect(html).toContain('data-guardian="false"');
    expect(html).toContain('data-personal-completion="true"');
  });

  it("uses the minor's personal guardian variant instead of the primary student's variant", async () => {
    mocks.check.mockResolvedValue({ ok: true, bookingCode: "SKI-GROUP", ordinal: 3, fullName: "Child Guest", isMinor: true });
    mocks.load.mockResolvedValue({ ...(await mocks.load()), inviteIsMinor: false });
    const html = await render();
    expect(html).toContain("Child Guest");
    expect(html).toContain('data-guardian="true"');
  });
});
