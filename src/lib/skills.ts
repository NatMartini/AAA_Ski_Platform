/**
 * Alpine and park manoeuvre catalogue, following the CSIA syllabus.
 *
 * Ordering and naming come from the official candidate guides: the Level 1–4
 * ski-off runs for the alpine track, and the Snow Park Level 1–2 progressions
 * for the park track. `tier` is the certification level a manoeuvre first
 * appears at, which is also the order a student meets them in.
 *
 * One manoeuvre per entry. Nothing is combined — "boxes and rails" are two
 * different features taught in two different sessions, and a coach who teaches
 * one may not teach the other. The same goes for 180s and 360s.
 *
 * Deliberately a code constant rather than database rows: it changes when the
 * CSIA changes it, it needs bilingual labels, and every consumer wants
 * compile-time keys. Adding a manoeuvre is a one-line edit here, no migration.
 *
 * Keys are stored in `CoachProfile.teachableSkills` and
 * `Booking.requestedSkills`. Never rename a key — old bookings keep whatever
 * they were saved with. Retire one by removing it from `SKILLS` and leaving
 * its label in `LEGACY_LABELS` so historical records still render.
 */

export type SkillTrack = "alpine" | "park";

export type Skill = {
  key: string;
  track: SkillTrack;
  zh: string;
  en: string;
  /** CSIA level this first appears at. Also the display order. */
  tier: 1 | 2 | 3 | 4;
};

/**
 * The alpine progression.
 *
 * Level 1 is the beginner-to-intermediate lesson content; Level 2 adds the
 * demonstration parallel and short turn ski-off runs; Level 3 adds advanced
 * parallel, bumps and the tactic runs (hop turn, braquage); Level 4 adds the
 * expert runs, the corridor objective and the javelin turn.
 */
const ALPINE: Omit<Skill, "track">[] = [
  { key: "first_slide", tier: 1, zh: "第一次滑行", en: "First slides" },
  { key: "straight_run", tier: 1, zh: "直滑降", en: "Straight run" },
  { key: "wedge", tier: 1, zh: "犁式", en: "Snowplow" },
  { key: "wedge_stop", tier: 1, zh: "犁式停止", en: "Snowplow stop" },
  { key: "wedge_turn", tier: 1, zh: "犁式转弯", en: "Snowplow turns" },
  { key: "traverse", tier: 1, zh: "横切", en: "Traverse" },
  { key: "sideslip", tier: 1, zh: "侧滑", en: "Sideslip" },
  { key: "wedge_christie", tier: 1, zh: "半犁式并腿", en: "Christie" },
  { key: "parallel", tier: 1, zh: "平行式", en: "Basic parallel" },
  { key: "demo_parallel", tier: 2, zh: "示范平行弯", en: "Demonstration parallel" },
  { key: "short_turn", tier: 2, zh: "小弯", en: "Short turns" },
  { key: "long_turn", tier: 2, zh: "大弯", en: "Long turns" },
  { key: "carving", tier: 2, zh: "卡宾", en: "Carving" },
  { key: "advanced_parallel", tier: 3, zh: "进阶平行弯", en: "Advanced parallel" },
  { key: "short_radius", tier: 3, zh: "高级小弯", en: "Short radius turns" },
  { key: "moguls", tier: 3, zh: "猫跳", en: "Bumps" },
  { key: "braquage", tier: 3, zh: "原地小弯", en: "Braquage" },
  { key: "hop_turn", tier: 3, zh: "跳跃转弯", en: "Hop turns" },
  { key: "mixed_radius", tier: 3, zh: "变节奏弯", en: "Mixed radius" },
  { key: "steeps", tier: 3, zh: "陡坡", en: "Steeps" },
  { key: "powder", tier: 3, zh: "粉雪", en: "Powder" },
  { key: "javelin", tier: 4, zh: "标枪转弯", en: "Javelin turns" },
  { key: "corridor", tier: 4, zh: "定宽走廊", en: "Corridor" },
  { key: "all_terrain", tier: 4, zh: "道外全地形", en: "All-terrain off-piste" },
];

/**
 * The park progression, from the Snow Park candidate guides.
 *
 * Park Level 1 covers jibbing, switch, jumping, grabs, the pop-90 onto a box,
 * boxes, rails and 180/360 spins. Park Level 2 adds switch take-offs,
 * switch-ups on a feature, urban rails, 540s and spins with grabs.
 */
const PARK: Skill[] = [
  { key: "jibbing", track: "park", tier: 1, zh: "地形游玩", en: "Jibbing" },
  { key: "switch", track: "park", tier: 1, zh: "倒滑", en: "Switch skiing" },
  { key: "small_jump", track: "park", tier: 1, zh: "小跳台", en: "Small jumps" },
  { key: "grab", track: "park", tier: 1, zh: "抓板", en: "Grabs" },
  { key: "pop_90", track: "park", tier: 1, zh: "Pop 90 上道具", en: "Pop 90 onto a feature" },
  { key: "box", track: "park", tier: 1, zh: "平箱", en: "Boxes" },
  { key: "rail", track: "park", tier: 1, zh: "铁杆", en: "Rails" },
  { key: "spin_180", track: "park", tier: 1, zh: "转体 180", en: "180 spins" },
  { key: "spin_360", track: "park", tier: 1, zh: "转体 360", en: "360 spins" },
  { key: "switch_takeoff", track: "park", tier: 2, zh: "倒滑起跳", en: "Switch take-offs" },
  { key: "switch_up", track: "park", tier: 2, zh: "道具上换向", en: "Switch-ups" },
  { key: "switch_spin", track: "park", tier: 2, zh: "倒滑转体", en: "Switch spins" },
  { key: "spin_540", track: "park", tier: 2, zh: "转体 540", en: "540 spins" },
  { key: "spin_grab", track: "park", tier: 2, zh: "转体抓板", en: "Spins with grabs" },
  { key: "urban_rail", track: "park", tier: 2, zh: "异型杆", en: "Urban rails & kinks" },
  { key: "halfpipe", track: "park", tier: 2, zh: "U 型池", en: "Halfpipe" },
];

export const SKILLS: Skill[] = [
  ...ALPINE.map((s) => ({ ...s, track: "alpine" as const })),
  ...PARK,
];

/**
 * Labels for retired keys, so bookings saved before a change still read
 * correctly. The 20260726… migration rewrites these in the database, but a row
 * restored from an old backup would still land here.
 */
const LEGACY_LABELS: Record<string, { zh: string; en: string }> = {
  park_intro: { zh: "公园入门", en: "Park intro" },
  box_rail: { zh: "平箱 / 铁杆", en: "Boxes & rails" },
  spins: { zh: "转体(180 / 360)", en: "Spins (180 / 360)" },
  dynamic_parallel: { zh: "动态平行式", en: "Dynamic parallel" },
};

const BY_KEY = new Map(SKILLS.map((s) => [s.key, s]));

export function skillLabel(key: string, locale: "zh" | "en"): string {
  const skill = BY_KEY.get(key);
  if (skill) return locale === "zh" ? skill.zh : skill.en;
  const legacy = LEGACY_LABELS[key];
  if (legacy) return locale === "zh" ? legacy.zh : legacy.en;
  return key; // unknown key: show it rather than silently dropping it
}

/** CSIA level a manoeuvre belongs to, for grouping the picker. */
export function skillTier(key: string): number {
  return BY_KEY.get(key)?.tier ?? 0;
}

export function skillsForTrack(track: SkillTrack): Skill[] {
  return SKILLS.filter((s) => s.track === track);
}

/** The manoeuvres of one track, grouped by the CSIA level they belong to. */
export function skillsByTier(track: SkillTrack): { tier: number; skills: Skill[] }[] {
  const groups = new Map<number, Skill[]>();
  for (const skill of skillsForTrack(track)) {
    const list = groups.get(skill.tier);
    if (list) list.push(skill);
    else groups.set(skill.tier, [skill]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a - b)
    .map(([tier, skills]) => ({ tier, skills }));
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
    enHint: "Can control speed in a snowplow, comfortable on green runs.",
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
