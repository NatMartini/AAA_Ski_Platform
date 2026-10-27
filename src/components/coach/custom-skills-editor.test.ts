import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CustomSkillsEditor } from "./custom-skills-editor";
import { SkillPicker } from "@/components/booking/skill-picker";

const skill = { id: "32fe21ac-0762-40ed-a7cc-90882b0fd6a2", key: "custom:32fe21ac-0762-40ed-a7cc-90882b0fd6a2", zh: "单脚控板", en: "" };
describe("custom focus editor and selectable chips", () => {
  it("offers Chinese and optional English edits with no editable identity field", () => {
    const html = renderToStaticMarkup(createElement(CustomSkillsEditor, { locale: "zh", value: [skill], onChange: () => {} }));
    expect(html).toContain("添加自定义动作");
    expect(html).toContain("英文名称（可选）");
    expect(html).toContain("删除动作 1");
    expect(html).not.toContain(`value="${skill.key}"`);
  });
  it("shows the custom Chinese fallback in English with accessible selection state", () => {
    const html = renderToStaticMarkup(createElement(SkillPicker, { locale: "en", selected: [skill.key], onChange: () => {},
      allowed: ["wedge"], customSkills: [skill], labels: { alpine: "Alpine", park: "Park", tier: "L{n}" } }));
    expect(html).toContain("单脚控板");
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("Snowplow");
    expect(html).not.toContain("Carving");
  });
});
