import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { TimeSelection, type TimeSelectionDay } from "./time-selection";
import type { BookingSelection } from "@/lib/booking/selection";

vi.mock("@/i18n/navigation", () => ({ Link: (props: ComponentProps<"a">) => createElement("a", props) }));
const firstKey = "custom:11111111-1111-4111-8111-111111111111";
const secondKey = "custom:22222222-2222-4222-8222-222222222222";
const days: TimeSelectionDay[] = [{ dateKey: "2026-12-04", coachIds: ["alisa", "kevin"], startOptions: [
  { hour: 9, startAt: "2026-12-04T14:00:00Z", durations: [2, 3], coachIdsByDuration: { 2: ["alisa"], 3: ["kevin"] } },
] }];
const coaches = [
  { userId: "alisa", skills: [{ key: "parallel", zh: "平行式", en: "Parallel" }, { key: firstKey, zh: "雪场路线", en: "Trail tactics" }] },
  { userId: "kevin", skills: [{ key: "spin_540", zh: "转体 540", en: "540 spins" }, { key: secondKey, zh: "雪包节奏", en: "Bump rhythm" }] },
];
const selection: BookingSelection = { dateKey: "2026-12-04", startHour: 9, hours: 2, requestedSkills: [firstKey], level: "intermediate", lessonType: "riding", headcount: 2 };
function render(initialSelection: BookingSelection | null, extras = {}) {
  return renderToStaticMarkup(createElement(TimeSelection, { locale: "en", resortSlug: "msl", days, coaches, initialSelection, ...extras }));
}

describe("time selection and practice focus", () => {
  it("shows the day union before choosing a start and keeps coach actions disabled", () => {
    const html = render(null);
    expect(html).toContain("Trail tactics");
    expect(html).toContain("Bump rhythm");
    expect(html).not.toContain("href=\"/book/msl/coaches");
    expect(html.match(/disabled=""/g)?.length).toBeGreaterThanOrEqual(2);
  });
  it("narrows custom skills to exact hour/duration eligibility and preserves query preferences", () => {
    const html = render(selection);
    expect(html).toContain("Trail tactics");
    expect(html).not.toContain("Bump rhythm");
    const href = html.match(/href="([^\"]*coaches[^\"]*)"/)![1].replaceAll("&amp;", "&");
    const query = new URL(href, "https://test.invalid").searchParams;
    expect(query.get("date")).toBe(selection.dateKey);
    expect(query.get("startHour")).toBe("9");
    expect(query.get("hours")).toBe("2");
    expect(query.get("requestedSkills")).toBe(firstKey);
    expect(query.get("lessonType")).toBe("riding");
    expect(query.get("headcount")).toBe("2");
    expect(query.get("level")).toBe("intermediate");
    expect(html).toContain("recommend=true");
  });
  it("keeps unavailable builtin and custom selections and explains the missing all-actions match", () => {
    const html = render({ ...selection, hours: 3, requestedSkills: [firstKey, "parallel"] });
    expect(html).toContain("Trail tactics");
    expect(html).toContain("Bump rhythm");
    expect(html).toContain("No coach at this time teaches all your selected skills.");
    expect(html).toContain("your selections have been kept");
    expect(html).toContain(`requestedSkills=${encodeURIComponent(firstKey)}%2Cparallel`);
    expect(html).toContain("Deselect Trail tactics");
    expect(html).toContain("Deselect Parallel");
  });
  it("does not imply that skills offered by different coaches can be combined in one match", () => {
    const html = render({ ...selection, requestedSkills: [firstKey, secondKey] }, { days: [{ ...days[0], startOptions: [{ ...days[0].startOptions[0], coachIdsByDuration: { 2: ["alisa", "kevin"], 3: ["kevin"] } }] }] });
    expect(html).toContain("Deselect Trail tactics");
    expect(html).toContain("Deselect Bump rhythm");
    expect(html).toContain("No coach at this time teaches all your selected skills.");
    expect(html).toContain("First we match coaches who teach all your selected skills");
  });
  it.each(["zh", "en"])("retains a removed custom selection with a readable fallback in %s", (locale) => {
    const removedKey = "custom:33333333-3333-4333-8333-333333333333";
    const html = render({ ...selection, requestedSkills: [removedKey] }, { locale });
    expect(html).toContain(locale === "zh" ? "自定义动作（当前未提供）" : "Custom skill (not currently offered)");
    expect(html).toContain(`requestedSkills=${encodeURIComponent(removedKey)}`);
    expect(html).toContain(locale === "zh" ? "你的选择已保留" : "your selections have been kept");
  });
  it("shows no inferred catalogue when coaches have not configured any actions", () => {
    const html = render({ ...selection, requestedSkills: [] }, { coaches: coaches.map((coach) => ({ ...coach, skills: [] })) });
    expect(html).toContain("These coaches have not configured any skills.");
    expect(html).not.toContain("aria-pressed=\"false\">Basic parallel");
    expect(html).not.toContain("Trail tactics");
    expect(html).toContain("matching is based on your selected skills");
    expect(html).toContain("href=\"/book/msl/coaches");
  });
  it("shows custom-only choices without inferring any builtin skills", () => {
    const html = render(selection, { coaches: [{ userId: "alisa", skills: [coaches[0].skills[1]] }] });
    expect(html).toContain("Trail tactics");
    expect(html).not.toContain("Alpine");
    expect(html).not.toContain("No coach at this time teaches all your selected skills.");
  });
  it("keeps an unavailable requested date and never preselects a replacement slot", () => {
    const html = render({ ...selection, dateKey: "2026-12-05" });
    expect(html).toContain("Your previous time is no longer available.");
    expect(html).toContain("There are no bookable times on this date.");
    expect(html).toContain("December 5, 2026");
    expect(html).not.toContain("href=\"/book/msl/coaches");
    expect(html).not.toContain("Teaching time");
  });
  it("supports a partial requested date without choosing a complete time automatically", () => {
    const html = render(null, { askedDate: "2026-12-04", initialLessonType: "park", initialHeadcount: 3 });
    expect(html).toContain("December 4, 2026");
    expect(html).not.toContain("href=\"/book/msl/coaches");
  });
});
