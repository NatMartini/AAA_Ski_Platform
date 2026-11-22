import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { torontoWallTimeToUtc } from "@/lib/time";
import { TodayLessons, WeekSchedule, type ScheduleLesson } from "./week-schedule";

vi.mock("@/i18n/navigation", () => ({ Link: (props: ComponentProps<"a">) => createElement("a", props) }));

const lesson = (over: Partial<ScheduleLesson> = {}): ScheduleLesson => ({
  id: "b1", code: "SKI-ABC123", start: torontoWallTimeToUtc("2026-11-21", 9), end: torontoWallTimeToUtc("2026-11-21", 11, 30),
  student: "Wei Zhang", headcount: 1, resort: "蓝山", lessonType: "private", pending: false, skills: ["小回转", "换刃"],
  level: "中级", notes: "想练陡坡", ...over });

describe("the workbench's lessons", () => {
  it("lists today's lessons with their times, who, where and what they want to learn", () => {
    const html = renderToStaticMarkup(createElement(TodayLessons, { zh: true, nowMinutes: 600, typeLabel: () => "私教课",
      lessons: [{ ...lesson(), from: 540, to: 690 }, { ...lesson({ id: "b2", code: "SKI-XYZ789", student: "Alex", headcount: 3, skills: [], level: null, notes: null, pending: true }), from: 780, to: 900 }] }));
    expect(html).toContain('href="/booking/SKI-ABC123"');
    expect(html).toContain("9:00");
    expect(html).toContain("– 11:30");
    expect(html).toContain("2.5 小时");
    expect(html).toContain("进行中");
    expect(html).toContain("小回转、换刃");
    expect(html).toContain("中级");
    expect(html).toContain("想练陡坡");
    expect(html).toContain("共 3 人");
    expect(html).toContain("没有填写");
    expect(html).toContain("付款待核对");
    expect(renderToStaticMarkup(createElement(TodayLessons, { zh: true, nowMinutes: 0, typeLabel: String, lessons: [] }))).toContain("今天没有课。");
  });

  it("draws the week with each lesson on its day and today marked", () => {
    const html = renderToStaticMarkup(createElement(WeekSchedule, { zh: true, weekStart: "2026-11-16", todayKey: "2026-11-21", nowMinutes: 600, lessons: [lesson()] }));
    expect(html).toContain("周六");
    expect(html).toContain("11/21");
    expect(html).toContain("9:00–11:30");
    expect(html).toContain('aria-label="现在 10:00"');
    expect(html).not.toContain("本周还没有课");
    expect(renderToStaticMarkup(createElement(WeekSchedule, { zh: true, weekStart: "2026-11-16", todayKey: "2026-11-21", nowMinutes: 600, lessons: [] }))).toContain("本周还没有课");
  });
});
