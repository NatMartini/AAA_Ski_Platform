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
/** Leaving the action open (FreeSki c754c1c): FreeSki recognises it, on either path, with the skier's level as a hint. */
export type AutoActionId = `auto:${FreeSkiPathType}` | `auto:${FreeSkiPathType}:${FreeSkiCurrentLevel}`;
export type FreeSkiActionId = ImprovementActionId | `improvement:${FreeSkiCurrentLevel}:${ImprovementActionId}`
  | `certification:${FreeSkiLevel}:${CertificationActionName}` | AutoActionId;

/** The action FreeSki is asked to recognise. */
export const AUTO_ACTION = "auto";
export const isAutoAction = (value: unknown) => typeof value === "string" && /^auto:(certification|improvement)(:|$)/.test(value);

/** Every action FreeSki may name, recognising one: the certification actions and the improvement skills. */
export const KNOWN_ACTION_NAMES: readonly string[] = [...Object.keys(CERTIFICATION_ACTIONS), ...FREESKI_ACTIONS.map(action => action.id)];

/** An action FreeSki named, as people read it, with the level it was compared at when there is one. */
export function actionName(action: string, level: string | null | undefined, zh: boolean) {
  const certification = own(CERTIFICATION_ACTIONS, action) ? CERTIFICATION_ACTIONS[action] : null;
  const improvement = FREESKI_ACTIONS.find(item => item.id === action);
  const name = certification ? (zh ? certification.labelZh : certification.labelEn) : improvement ? (zh ? improvement.labelZh : improvement.labelEn) : action;
  const number = /^level([1-4])$/.exec(level ?? "")?.[1];
  return number ? (zh ? `${name} · CSIA ${number} 级` : `${name} · CSIA L${number}`) : name;
}

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
  const auto = /^auto:(certification|improvement)(?::(none|level[1-4]))?$/.exec(value);
  if (auto) return {
    id: value as FreeSkiActionId, actionName: AUTO_ACTION, pathType: auto[1] as FreeSkiPathType, level: null,
    currentLevel: (auto[2] ?? null) as FreeSkiCurrentLevel | null, catalogId: `auto:${auto[1]}`, skillFamily: AUTO_ACTION, isLegacyAlias: false,
  };
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

/**
 * New requests must say what they are compared with: an improvement request carries the skier's level, and so does
 * one leaving the action to be recognised, where it picks the level to compare at.
 */
export function isSubmittableFreeSkiActionId(value: unknown): value is FreeSkiActionId {
  const selection = parseFreeSkiActionId(value);
  if (selection === null) return false;
  // An exam run left open names the exam it is for; "no level yet" is not an exam.
  if (isExamRecognition(selection)) return selection.currentLevel !== null && selection.currentLevel !== "none";
  return selection.pathType === "certification" || selection.currentLevel !== null;
}

/** An exam run left for FreeSki to recognise: the level chosen with it is the exam's, not the skier's own. */
export const isExamRecognition = (selection: Pick<FreeSkiActionSelection, "actionName" | "pathType"> | null) =>
  selection?.actionName === AUTO_ACTION && selection.pathType === "certification";

/**
 * The levels FreeSki is sent. An exam run left open names the exam level: FreeSki recognises among that level's runs
 * and compares with that level's demonstrations. Everywhere else the skier's own level goes as the current level,
 * which FreeSki compares one level up.
 */
export function upstreamLevels(selection: FreeSkiActionSelection): { level: string | null; currentLevel: string | null } {
  return isExamRecognition(selection) && selection.currentLevel !== null && selection.currentLevel !== "none"
    ? { level: selection.currentLevel, currentLevel: null } : { level: selection.level, currentLevel: selection.currentLevel };
}

/** The id to submit for a catalog choice; improvement choices need the skier's current level. */
export function submittedFreeSkiActionId(catalogId: string, currentLevel: FreeSkiCurrentLevel | null): FreeSkiActionId | null {
  const selection = parseFreeSkiActionId(catalogId);
  if (!selection || selection.id !== selection.catalogId) return null;
  if (selection.actionName === AUTO_ACTION) return currentLevel && !(selection.pathType === "certification" && currentLevel === "none")
    ? `${selection.catalogId as `auto:${FreeSkiPathType}`}:${currentLevel}` : null;
  if (selection.pathType === "certification") return selection.id;
  return currentLevel ? `improvement:${currentLevel}:${selection.actionName as ImprovementActionId}` : null;
}

/** Safe, unavailable-by-default labels for historical selections or offline UI. */
export function getFreeSkiActionOption(value: unknown): FreeSkiActionOption | null {
  const selection = parseFreeSkiActionId(value);
  if (!selection) return null;
  if (selection.actionName === AUTO_ACTION) {
    const improvement = selection.pathType === "improvement";
    return { id: selection.id, labelZh: improvement ? "不确定动作，让 FreeSki 识别（技术提升）" : "让 FreeSki 识别考证动作",
      labelEn: improvement ? "Not sure: let FreeSki recognise it (improvement)" : "Let FreeSki recognise the exam run",
      pathType: selection.pathType, level: null, available: false, groupZh: "自动识别", groupEn: "Recognise the action" };
  }
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
  const auto = object(catalog.auto);
  if (auto.available === true && auto.action === AUTO_ACTION && Array.isArray(auto.paths)) {
    for (const path of ["improvement", "certification"] as const) if (auto.paths.includes(path)) add(getFreeSkiActionOption(`auto:${path}`), true);
  }
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

/**
 * The selection for re-running a recognised run as another action: an improvement skill at the skier's level, or a
 * certification action at the level FreeSki compared with, else the nearest level the guide has it at.
 */
export function correctedActionId(action: string, pathType: FreeSkiPathType, level: string | null, currentLevel: FreeSkiCurrentLevel | null): FreeSkiActionId | null {
  if (pathType === "improvement") {
    const skill = FREESKI_ACTIONS.find(item => item.id === action);
    return skill && currentLevel ? `improvement:${currentLevel}:${skill.id}` : null;
  }
  if (!own(CERTIFICATION_ACTIONS, action)) return null;
  const levels = CERTIFICATION_ACTIONS[action].levels as readonly number[], wanted = Number(/^level([1-4])$/.exec(level ?? "")?.[1] ?? levels[0]);
  const nearest = [...levels].sort((a, b) => Math.abs(a - wanted) - Math.abs(b - wanted) || b - a)[0];
  return `certification:level${nearest}:${action}` as FreeSkiActionId;
}
