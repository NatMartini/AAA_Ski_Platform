import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SkillPicker } from "./skill-picker";

const base = { locale: "en" as const, selected: [], onChange: () => {}, labels: { alpine: "Alpine", park: "Park", tier: "L{n}" } };

describe("configured skill choices", () => {
  it("shows the full catalogue for a coach editing their own capabilities", () => {
    const html = renderToStaticMarkup(createElement(SkillPicker, base));
    expect(html).toContain("Snowplow");
    expect(html).toContain("Small jumps");
  });

  it("does not advertise every move when an eligible coach has no configured builtin skills", () => {
    const html = renderToStaticMarkup(createElement(SkillPicker, { ...base, allowed: [],
      customSkills: [{ key: "custom:focus", zh: "自定义动作", en: "Custom focus" }] }));
    expect(html).not.toContain("Snowplow");
    expect(html).not.toContain("Small jumps");
    expect(html).toContain("Custom focus");
  });

  it("shows only the coach's explicitly advertised builtin moves", () => {
    const html = renderToStaticMarkup(createElement(SkillPicker, { ...base, allowed: ["wedge"] }));
    expect(html).toContain("Snowplow");
    expect(html).not.toContain("Small jumps");
  });
});
