export type FreeSkiPathType = "improvement" | "certification";
export type FreeSkiLevel = "level1" | "level2" | "level3" | "level4";
/** The skier's own CSIA level on the improvement path; "none" means not yet certified. */
export type FreeSkiCurrentLevel = "none" | FreeSkiLevel;

/** Improvement compares with pass examples one level above this (decision of 2026-10-27). */
export const FREESKI_CURRENT_LEVELS = [
  { id: "none", labelZh: "还没考 CSIA 级别", labelEn: "No CSIA level yet" },
  { id: "level1", labelZh: "CSIA 1 级", labelEn: "CSIA Level 1" },
  { id: "level2", labelZh: "CSIA 2 级", labelEn: "CSIA Level 2" },
  { id: "level3", labelZh: "CSIA 3 级", labelEn: "CSIA Level 3" },
  { id: "level4", labelZh: "CSIA 4 级", labelEn: "CSIA Level 4" },
] as const satisfies readonly { id: FreeSkiCurrentLevel; labelZh: string; labelEn: string }[];

export type FreeSkiActionOption = {
  id: string;
  labelZh: string;
  labelEn: string;
  pathType: FreeSkiPathType;
  level: string | null;
  available: boolean;
  groupZh: string;
  groupEn: string;
};

/** Compatibility labels for existing videos, never a list of enabled capabilities. */
export const FREESKI_ACTIONS = [
  { id: "parallel", labelZh: "平行式转弯", labelEn: "Parallel turns", pathType: "improvement", level: null, available: false, groupZh: "技术提升", groupEn: "Improvement" },
  { id: "short_turn", labelZh: "小回转", labelEn: "Short turns", pathType: "improvement", level: null, available: false, groupZh: "技术提升", groupEn: "Improvement" },
  { id: "carving", labelZh: "刻滑", labelEn: "Carving", pathType: "improvement", level: null, available: false, groupZh: "技术提升", groupEn: "Improvement" },
  { id: "bumps", labelZh: "蘑菇地形", labelEn: "Moguls", pathType: "improvement", level: null, available: false, groupZh: "技术提升", groupEn: "Improvement" },
] as const satisfies readonly FreeSkiActionOption[];

// Canonical names, valid levels and families mirror FreeSki's shared/ontology.py
// and shared/config.py. They identify stored selections; availability is ONLY
// supplied by the authenticated catalog, not this compatibility table.
const CERTIFICATION_ACTIONS = {
  demonstration_parallel: { labelZh: "示范平行弯", labelEn: "Demonstration parallel", family: "parallel", levels: [1, 2, 3, 4] },
  intro_parallel: { labelZh: "入门平行弯", labelEn: "Intro parallel", family: "parallel", levels: [2] },
  free_run: { labelZh: "自由滑行", labelEn: "Free run", family: "parallel", levels: [2] },
  short_turn: { labelZh: "小回转", labelEn: "Short turns", family: "short_turn", levels: [2, 3, 4] },
  advanced_parallel: { labelZh: "进阶平行弯", labelEn: "Advanced parallel", family: "parallel", levels: [3] },
  bumps: { labelZh: "蘑菇地形", labelEn: "Moguls", family: "mogul", levels: [3, 4] },
  braquage: { labelZh: "原地小弯", labelEn: "Braquage", family: "tactic", levels: [3] },
  hop_turn: { labelZh: "跳跃转弯", labelEn: "Hop turns", family: "tactic", levels: [3, 4] },
  expert_parallel: { labelZh: "专家平行弯", labelEn: "Expert parallel", family: "carving", levels: [4] },
  expert_all_terrain: { labelZh: "专家全地形", labelEn: "Expert all terrain", family: "parallel", levels: [4] },
  expert_corridor: { labelZh: "定宽走廊", labelEn: "Expert corridor", family: "parallel", levels: [4] },
  javelin: { labelZh: "标枪转弯", labelEn: "Javelin turns", family: "tactic", levels: [4] },
} as const;

const CERTIFICATION_ALIASES = {
  demo_parallel: "demonstration_parallel",
  demostration_parallel: "demonstration_parallel",
  parallel: "demonstration_parallel",
  wedge_basic: "demonstration_parallel",
  linking_parallel: "demonstration_parallel",
  linking_snowplow: "demonstration_parallel",
  short_radius: "short_turn",
  advanced_short_radius: "short_turn",
  expert_short_turn: "short_turn",
  expert_bumps: "bumps",
  hop_to_hop: "hop_turn",
  javelin_turns: "javelin",
  Javelin_turns: "javelin",
} as const satisfies Record<string, keyof typeof CERTIFICATION_ACTIONS>;

type ImprovementActionId = (typeof FREESKI_ACTIONS)[number]["id"];
type CertificationActionName = keyof typeof CERTIFICATION_ACTIONS | keyof typeof CERTIFICATION_ALIASES;
export type FreeSkiActionId = ImprovementActionId | `improvement:${FreeSkiCurrentLevel}:${ImprovementActionId}`
  | `certification:${FreeSkiLevel}:${CertificationActionName}`;

export type FreeSkiActionSelection = {
  id: FreeSkiActionId;
  actionName: string;
  pathType: FreeSkiPathType;
  level: FreeSkiLevel | null;
  /** Improvement only. Null for certification and for improvement jobs stored before the level was asked. */
  currentLevel: FreeSkiCurrentLevel | null;
  /** The catalog entry that must be open to submit this selection. */
  catalogId: string;
  skillFamily: string;
  isLegacyAlias: boolean;
};

function own<T extends object>(value: T, key: string): key is keyof T & string {
  return Object.hasOwn(value, key);
}

/** Decode the persisted choice without consulting changing service availability. */
export function parseFreeSkiActionId(value: unknown): FreeSkiActionSelection | null {
  if (typeof value !== "string") return null;
  const leveled = /^improvement:(none|level[1-4]):([a-z_]+)$/.exec(value);
  const improvement = FREESKI_ACTIONS.find((action) => action.id === (leveled ? leveled[2] : value));
  if (improvement) return {
    id: (leveled ? value : improvement.id) as FreeSkiActionId, actionName: improvement.id, pathType: "improvement",
    level: null, currentLevel: leveled ? leveled[1] as FreeSkiCurrentLevel : null, catalogId: improvement.id,
    skillFamily: improvement.id, isLegacyAlias: false,
  };
  if (leveled) return null;
  const match = /^certification:(level[1-4]):([A-Za-z_]+)$/.exec(value);
  if (!match) return null;
  const [, level, name] = match;
  const alias = own(CERTIFICATION_ALIASES, name) ? CERTIFICATION_ALIASES[name] : null;
  const canonical = alias ?? name;
  if (!own(CERTIFICATION_ACTIONS, canonical)) return null;
  const definition = CERTIFICATION_ACTIONS[canonical];
  if (!(definition.levels as readonly number[]).includes(Number(level.slice(-1)))) return null;
  return {
    id: value as FreeSkiActionId, actionName: canonical, pathType: "certification",
    level: level as FreeSkiLevel, currentLevel: null, catalogId: value, skillFamily: definition.family, isLegacyAlias: alias !== null,
  };
}

/** Recognition is for persisted/historical data. It does not authorize analysis. */
export function isFreeSkiActionId(value: unknown): value is FreeSkiActionId {
  return parseFreeSkiActionId(value) !== null;
}

/** New requests must say what they are compared with: an improvement request carries the skier's level. */
export function isSubmittableFreeSkiActionId(value: unknown): value is FreeSkiActionId {
  const selection = parseFreeSkiActionId(value);
  return selection !== null && (selection.pathType === "certification" || selection.currentLevel !== null);
}

/** The id to submit for a catalog choice; improvement choices need the skier's current level. */
export function submittedFreeSkiActionId(catalogId: string, currentLevel: FreeSkiCurrentLevel | null): FreeSkiActionId | null {
  const selection = parseFreeSkiActionId(catalogId);
  if (!selection || selection.id !== selection.catalogId) return null;
  if (selection.pathType === "certification") return selection.id;
  return currentLevel ? `improvement:${currentLevel}:${selection.actionName as ImprovementActionId}` : null;
}

/** Safe, unavailable-by-default labels for historical selections or offline UI. */
export function getFreeSkiActionOption(value: unknown): FreeSkiActionOption | null {
  const selection = parseFreeSkiActionId(value);
  if (!selection) return null;
  if (selection.pathType === "improvement") return { ...FREESKI_ACTIONS.find((action) => action.id === selection.actionName)!, id: selection.id };
  const definition = CERTIFICATION_ACTIONS[selection.actionName as keyof typeof CERTIFICATION_ACTIONS];
  const levelNumber = selection.level!.slice(-1);
  return {
    id: selection.id, labelZh: definition.labelZh, labelEn: definition.labelEn,
    pathType: "certification", level: selection.level, available: false,
    groupZh: `CSIA ${levelNumber} 级考证`, groupEn: `CSIA L${levelNumber} certification`,
  };
}

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** Only actual known catalog entries with an explicit true flag can be enabled. */
export function normalizeFreeSkiCatalog(raw: unknown): FreeSkiActionOption[] {
  const catalog = object(raw);
  const rubric = catalog.rubric_system ?? object(catalog.rubric).name;
  // This integration implements CSIA semantics only; another rubric cannot
  // accidentally reuse these labels or action/level identifiers.
  if (rubric !== "csia" || (object(catalog.rubric).name !== undefined && object(catalog.rubric).name !== "csia")) return [];
  const options: FreeSkiActionOption[] = [];
  const seen = new Set<string>();
  const add = (option: FreeSkiActionOption | null, available: unknown, legacy = false) => {
    if (!option || seen.has(option.id)) return;
    seen.add(option.id);
    options.push({ ...option, available: available === true && !legacy });
  };
  const skills = object(catalog.improvement).skills;
  if (Array.isArray(skills)) for (const rawSkill of skills.slice(0, 200)) {
    const skill = object(rawSkill);
    const option = getFreeSkiActionOption(skill.id);
    // The catalog lists actions; a skier's level is only ever added at submission.
    if (option?.pathType === "improvement" && option.id === parseFreeSkiActionId(skill.id)?.catalogId) add(option, skill.available);
  }
  const levels = object(object(catalog.certification).levels);
  for (const level of ["level1", "level2", "level3", "level4"] as const) {
    const levelDocument = object(levels[level]);
    if (!Array.isArray(levelDocument.actions)) continue;
    const availability = object(levelDocument.availability);
    for (const name of levelDocument.actions.slice(0, 200)) {
      if (typeof name !== "string") continue;
      const id = `certification:${level}:${name}`;
      const selection = parseFreeSkiActionId(id);
      add(getFreeSkiActionOption(id), availability[name], selection?.isLegacyAlias);
    }
  }
  return options;
}
