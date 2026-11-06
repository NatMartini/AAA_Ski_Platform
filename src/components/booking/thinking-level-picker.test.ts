import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ThinkingLevelPicker } from "./thinking-level-picker";

const render = (props: Partial<ComponentProps<typeof ThinkingLevelPicker>>) => renderToStaticMarkup(createElement(ThinkingLevelPicker,
  { value: "none", shown: "none", levels: { none: "ready" }, zh: true, onChange: vi.fn(), ...props }));
const button = (html: string, label: string) => new RegExp(`<button[^>]*>${label}`).exec(html)?.[0] ?? "";

describe("explanation thinking levels", () => {
  it("offers all four levels with their waits, and marks only the deep one as free for now", () => {
    const html = render({});
    for (const label of ["快！回答我", "看看算了", "认真一点", "当个事办"]) expect(button(html, label)).not.toBe("");
    expect(html.match(/限时免费/g)).toHaveLength(1);
    expect(html).toContain("约 3 分钟");
    expect(html).toContain("5 分钟以上");
    expect(button(html, "快！回答我")).toContain('aria-pressed="true"');
    expect(html).not.toContain('role="status"');
  });

  it("keeps the written explanation on screen and holds other new levels while one is being written", () => {
    const html = render({ value: "xhigh", levels: { none: "ready", xhigh: "running" } });
    expect(html).toContain("正在用「当个事办」档写讲解");
    expect(html).toContain("下面先显示「快！回答我」档的讲解");
    // Written levels stay one click away; levels not written yet wait their turn.
    expect(button(html, "快！回答我")).not.toContain('disabled=""');
    expect(button(html, "认真一点")).toContain('disabled=""');
    expect(button(html, "当个事办")).not.toContain('disabled=""');
  });

  it("marks levels FreeSki gave up on, and holds back an unavailable one", () => {
    const html = render({ levels: { none: "ready", medium: "failed", xhigh: "unavailable" } });
    expect(button(html, "认真一点")).not.toContain('disabled=""');
    expect(html).toContain("没写成");
    expect(button(html, "当个事办")).toContain('disabled=""');
    expect(html).toContain("暂时没有");
  });

  it("says when a level could not be written, in English too", () => {
    expect(render({ value: "medium", levels: { none: "ready", medium: "failed" } })).toContain("「认真一点」档的讲解这次没写成");
    const english = render({ zh: false, value: "low", shown: null, levels: { low: "pending" } });
    expect(english).toContain("Writing the explanation at “Quick look”");
    expect(english).not.toContain("stays below");
    expect(english).toContain("Free for now");
  });
});
