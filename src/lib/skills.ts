/**
 * Alpine skill and ability catalogue.
 *
 * Deliberately a code constant rather than database rows: it changes when the
 * coaches decide it changes, it needs bilingual labels, and every consumer
 * wants compile-time keys. Adding a skill is a one-line edit here with no
 * migration.
 *
 * Keys are stored in `CoachProfile.teachableSkills`, `Booking.requestedSkills`
 * and `Participant.level`. Never renumber or rename a key — old bookings keep
 * whatever they were saved with. Retire one by removing it from `SKILLS` and
 * leaving its label in `LEGACY_LABELS` so historical records still render.
 */

export type SkillTrack = "alpine" | "park";

export type Skill = {
  key: string;
  track: SkillTrack;
  zh: string;
  en: string;
  /** Roughly the ability at which this is usually taught, for sorting. */
  tier: number;
};

/** CSIA-style alpine progression, easiest first. */
export const SKILLS: Skill[] = [
  { key: "first_slide", track: "alpine", tier: 1, zh: "第一次滑行 / 站立平衡", en: "First slides & balance" },
  { key: "wedge", track: "alpine", tier: 1, zh: "犁式", en: "Wedge" },
  { key: "wedge_turn", track: "alpine", tier: 1, zh: "犁式转弯", en: "Wedge turns" },
  { key: "wedge_christie", track: "alpine", tier: 2, zh: "犁式并腿(半犁式)", en: "Wedge christie" },
  { key: "parallel", track: "alpine", tier: 2, zh: "平行式", en: "Parallel turns" },
  { key: "short_turn", track: "alpine", tier: 3, zh: "小弯", en: "Short turns" },
  { key: "long_turn", track: "alpine", tier: 2, zh: "大弯", en: "Long turns" },
  { key: "carving", track: "alpine", tier: 3, zh: "卡宾(刻滑)", en: "Carving" },
  { key: "dynamic_parallel", track: "alpine", tier: 4, zh: "动态平行式", en: "Dynamic parallel" },
  { key: "moguls", track: "alpine", tier: 4, zh: "刻槽 / 猫跳", en: "Moguls" },
  { key: "steeps", track: "alpine", tier: 4, zh: "陡坡", en: "Steeps" },
  { key: "powder", track: "alpine", tier: 4, zh: "粉雪", en: "Powder" },

  // CSIA Park
  { key: "park_intro", track: "park", tier: 2, zh: "公园入门 / 安全", en: "Park intro & safety" },
  { key: "box_rail", track: "park", tier: 3, zh: "平箱 / 铁杆", en: "Boxes & rails" },
  { key: "small_jump", track: "park", tier: 3, zh: "小跳台", en: "Small jumps" },
  { key: "spins", track: "park", tier: 4, zh: "转体(180 / 360)", en: "Spins (180 / 360)" },
  { key: "switch", track: "park", tier: 3, zh: "倒滑", en: "Switch riding" },
  { key: "halfpipe", track: "park", tier: 4, zh: "U 型池", en: "Halfpipe" },
];

/** Labels for retired keys, so old bookings still read correctly. */
const LEGACY_LABELS: Record<string, { zh: string; en: string }> = {};

const BY_KEY = new Map(SKILLS.map((s) => [s.key, s]));

export function skillLabel(key: string, locale: "zh" | "en"): string {
  const skill = BY_KEY.get(key);
  if (skill) return locale === "zh" ? skill.zh : skill.en;
  const legacy = LEGACY_LABELS[key];
  if (legacy) return locale === "zh" ? legacy.zh : legacy.en;
  return key; // unknown key: show it rather than silently dropping it
}

export function skillsForTrack(track: SkillTrack): Skill[] {
  return SKILLS.filter((s) => s.track === track).sort((a, b) => a.tier - b.tier);
}

export function isSkillKey(key: string): boolean {
  return BY_KEY.has(key);
}

/** Drops unknown keys. Use on anything arriving from a client. */
export function sanitizeSkillKeys(keys: string[]): string[] {
  return [...new Set(keys.filter(isSkillKey))];
}

// ─────────────────────────── Ability levels ───────────────────────────

export type Level = {
  key: string;
  zh: string;
  en: string;
  zhHint: string;
  enHint: string;
  /** Ordering, lowest first. */
  rank: number;
};

export const LEVELS: Level[] = [
  {
    key: "first_time",
    rank: 1,
    zh: "第一次滑雪",
    en: "First time",
    zhHint: "从未滑过,或只滑过一两次。",
    enHint: "Never skied, or only once or twice.",
  },
  {
    key: "beginner",
    rank: 2,
    zh: "初级",
    en: "Beginner",
    zhHint: "能用犁式控速,可滑绿道。",
    enHint: "Can control speed in a wedge, comfortable on green runs.",
  },
  {
    key: "intermediate",
    rank: 3,
    zh: "中级",
    en: "Intermediate",
    zhHint: "能平行转弯,可滑蓝道。",
    enHint: "Parallel turns, comfortable on blue runs.",
  },
  {
    key: "advanced",
    rank: 4,
    zh: "高级",
    en: "Advanced",
    zhHint: "能滑黑道,想练刻滑、小弯或公园。",
    enHint: "Confident on black runs; working on carving, short turns or park.",
  },
];

const LEVEL_BY_KEY = new Map(LEVELS.map((l) => [l.key, l]));

export function levelLabel(key: string, locale: "zh" | "en"): string {
  const level = LEVEL_BY_KEY.get(key);
  if (!level) return key;
  return locale === "zh" ? level.zh : level.en;
}

export function isLevelKey(key: string): boolean {
  return LEVEL_BY_KEY.has(key);
}

export function levelRank(key: string): number {
  return LEVEL_BY_KEY.get(key)?.rank ?? 0;
}

export function sanitizeLevelKeys(keys: string[]): string[] {
  return [...new Set(keys.filter(isLevelKey))];
}

/** Certification labels for a coach card. */
export function csiaLabel(
  level: number | null,
  park: number | null,
  locale: "zh" | "en",
): string[] {
  const out: string[] = [];
  if (level) {
    out.push(locale === "zh" ? `CSIA ${level} 级` : `CSIA Level ${level}`);
  }
  if (park) {
    out.push(
      locale === "zh" ? `CSIA Park ${park} 级` : `CSIA Park Level ${park}`,
    );
  }
  return out;
}
