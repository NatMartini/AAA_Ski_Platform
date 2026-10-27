"use client";

import { useId } from "react";
import { clientRandomUUID } from "@/lib/browser-helpers";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Hint, Input, Label } from "@/components/ui/field";
import { MAX_CUSTOM_SKILLS, type CustomSkill } from "@/lib/custom-skills";
import type { Locale } from "@/i18n/routing";

export function CustomSkillsEditor({ locale, value, onChange, disabled = false }: {
  locale: Locale;
  value: CustomSkill[];
  onChange: (next: CustomSkill[]) => void;
  disabled?: boolean;
}) {
  const zh = locale === "zh";
  const id = useId();
  function edit(key: string, field: "zh" | "en", text: string) {
    onChange(value.map((skill) => skill.key === key ? { ...skill, [field]: text } : skill));
  }
  return <fieldset disabled={disabled} className="space-y-3 border-t border-border pt-4">
    <legend className="text-sm font-bold">{zh ? "自定义练习动作" : "Custom practice focus"}</legend>
    <Hint>{zh ? "填写你希望学员选择的动作或训练主题。中文必填，英文可选；留空时英文页面也显示中文。保存后会出现在学员选时段和约课页面，改名或删除不影响历史订单。" : "Add the moves or training topics students can choose. Chinese is required; English is optional and falls back to Chinese. Saved choices appear when choosing a time and booking. Renaming or removing one keeps past orders unchanged."}</Hint>
    <div className="space-y-3">
      {value.map((skill, index) => <div key={skill.key} className="grid gap-3 rounded-xl border border-border p-3 sm:grid-cols-[1fr_1fr_auto]">
        <div className="min-w-0 space-y-1.5"><Label htmlFor={`${id}-${skill.id}-zh`}>{zh ? `动作 ${index + 1} · 中文名称` : `Focus ${index + 1} · Chinese name`}</Label><Input id={`${id}-${skill.id}-zh`} value={skill.zh} required maxLength={120} onChange={(event) => edit(skill.key, "zh", event.target.value)} /></div>
        <div className="min-w-0 space-y-1.5"><Label htmlFor={`${id}-${skill.id}-en`}>{zh ? "英文名称（可选）" : "English name (optional)"}</Label><Input id={`${id}-${skill.id}-en`} value={skill.en} maxLength={120} onChange={(event) => edit(skill.key, "en", event.target.value)} /></div>
        <Button type="button" variant="secondary" size="sm" className="self-end justify-self-start" aria-label={zh ? `删除动作 ${index + 1}` : `Remove focus ${index + 1}`} onClick={() => onChange(value.filter((item) => item.key !== skill.key))}><Trash2 aria-hidden />{zh ? "删除" : "Remove"}</Button>
      </div>)}
    </div>
    <Button type="button" variant="secondary" disabled={value.length >= MAX_CUSTOM_SKILLS} onClick={() => {
      const skillId = clientRandomUUID();
      onChange([...value, { id: skillId, key: `custom:${skillId}`, zh: "", en: "" }]);
    }}><Plus aria-hidden />{zh ? "添加自定义动作" : "Add custom practice focus"}</Button>
    {value.length >= MAX_CUSTOM_SKILLS && <Hint>{zh ? `最多添加 ${MAX_CUSTOM_SKILLS} 个自定义动作。` : `You can add up to ${MAX_CUSTOM_SKILLS} custom choices.`}</Hint>}
  </fieldset>;
}
