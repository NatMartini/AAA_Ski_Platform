import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CoachLessonPanel } from "./coach-lesson-panel";

vi.mock("@/i18n/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const props = { locale: "en" as const, bookingCode: "test", balanceCents: 7000, paidCents: 7000,
  depositCents: 7000, isDeposit: true, canSettleBalance: true, canCancel: true, summary: "Lesson notes",
  isConfirmed: true, canComplete: false };

describe("coach lesson completion and preserved operations", () => {
  it("shows locked completion before the lesson ends while keeping notes and balance controls", () => {
    const html = renderToStaticMarkup(createElement(CoachLessonPanel, props));
    expect(html).toContain("Completion is available after the teaching time ends");
    const button = [...html.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/g)].map((match) => match[0]).find((tag) => tag.includes("Complete lesson and unlock video analysis"));
    expect(button?.split(">")[0]).toContain("disabled=\"\"");
    expect(html).toContain("Mark balance received");
    expect(html).toContain("Save notes");
    expect(html).toContain("Cancel this lesson");
    expect(html).not.toContain("<video");
    expect(html).not.toContain("Upload video");
  });
  it("enables completion after teaching ends", () => {
    const html = renderToStaticMarkup(createElement(CoachLessonPanel, { ...props, canComplete: true }));
    const button = [...html.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/g)].map((match) => match[0]).find((tag) => tag.includes("Complete lesson and unlock video analysis"));
    expect(button).toBeTruthy();
    expect(button?.split(">")[0]).not.toContain("disabled=\"\"");
  });
  it("hides the completion action for terminal lessons without hiding outstanding balance", () => {
    const html = renderToStaticMarkup(createElement(CoachLessonPanel, { ...props, isConfirmed: false, canComplete: false, canCancel: false }));
    expect(html).not.toContain("Complete lesson and unlock video analysis");
    expect(html).toContain("Mark balance received");
    expect(html).toContain("Save notes");
  });
});
