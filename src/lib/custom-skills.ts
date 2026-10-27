import { SKILLS, expandTeachableSkillKeys, isSkillKey, skillLabel } from "./skills";

export const MAX_CUSTOM_SKILLS = 20;
export type SkillOption = { key: string; zh: string; en: string };
export type CustomSkill = SkillOption & { id: string };
export type CoachSkillProfile = { teachableSkills?: readonly string[]; customSkills?: unknown };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Defensive reader for JSON stored by earlier clients or imported profiles. */
export function parseCustomSkills(value: unknown): CustomSkill[] {
  if (!Array.isArray(value)) return [];
  const result: CustomSkill[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const { id, key, zh, en } = item;
    if (typeof id !== "string" || !UUID.test(id) || key !== `custom:${id}` ||
      typeof zh !== "string" || !zh.trim() || zh.trim().length > 120 ||
      (en != null && (typeof en !== "string" || en.trim().length > 120)) || seen.has(key)) continue;
    seen.add(key);
    result.push({ id, key, zh: zh.trim(), en: typeof en === "string" ? en.trim() : "" });
    if (result.length === MAX_CUSTOM_SKILLS) break;
  }
  return result;
}

/** Only skills explicitly configured by this coach are offered. */
export function coachSkillOptions(profile: CoachSkillProfile): SkillOption[] {
  const builtin = new Set(expandTeachableSkillKeys(profile.teachableSkills ?? []));
  return [
    ...SKILLS.filter((skill) => builtin.has(skill.key)).map(({ key, zh, en }) => ({ key, zh, en })),
    ...parseCustomSkills(profile.customSkills).map(({ key, zh, en }) => ({ key, zh, en: en || zh })),
  ];
}

/** All selected current skills must belong to this coach; legacy unknowns are discarded. */
export function coachCanTeachRequestedSkills(keys: readonly string[], profile: CoachSkillProfile): boolean {
  const offered = new Set(coachSkillOptions(profile).map((skill) => skill.key));
  return keys.every((key) => (!isSkillKey(key) && !key.startsWith("custom:")) || offered.has(key));
}

export function skillOptionsUnion(profiles: readonly CoachSkillProfile[]): SkillOption[] {
  const choices = new Map<string, SkillOption>();
  for (const profile of profiles) for (const choice of coachSkillOptions(profile)) {
    if (!choices.has(choice.key)) choices.set(choice.key, choice);
  }
  return [...choices.values()];
}

/** Known catalogue preferences survive; custom keys must belong to this coach. */
export function sanitizeCoachRequestedSkills(keys: readonly string[], profile: CoachSkillProfile): string[] {
  const custom = new Set(parseCustomSkills(profile.customSkills).map((skill) => skill.key));
  return [...new Set(keys.filter((key) => isSkillKey(key) || custom.has(key)))].slice(0, 12);
}

export function snapshotRequestedSkills(keys: readonly string[], profile: CoachSkillProfile): SkillOption[] {
  const custom = new Map(parseCustomSkills(profile.customSkills).map((skill) => [skill.key, skill]));
  return sanitizeCoachRequestedSkills(keys, profile).map((key) => {
    const item = custom.get(key);
    return item ? { key, zh: item.zh, en: item.en || item.zh } : { key, zh: skillLabel(key, "zh"), en: skillLabel(key, "en") };
  });
}

export function customSkillLabel(key: string, locale: "zh" | "en", customSkills: unknown): string {
  const custom = parseCustomSkills(customSkills).find((skill) => skill.key === key);
  return custom ? custom[locale] || custom.zh : skillLabel(key, locale);
}

/** History reads its own labels, with the old builtin/legacy lookup as fallback. */
export function requestedSkillLabel(key: string, locale: "zh" | "en", snapshot: unknown): string {
  if (Array.isArray(snapshot)) {
    const item = snapshot.find((row) => row && typeof row === "object" && row.key === key);
    if (item && typeof item[locale] === "string" && item[locale].trim()) return item[locale];
    if (item && typeof item.zh === "string" && item.zh.trim()) return item.zh;
  }
  return skillLabel(key, locale);
}
