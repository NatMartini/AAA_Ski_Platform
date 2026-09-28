/**
 * The kinds of lesson a coach sells, each with its own hourly rate.
 *
 * From the published price sheet: an ordinary on-snow lesson, CSIA Level 1
 * exam preparation, and park. A coach offers a type by setting a rate for it
 * (see CoachRate); a coach with no park rate simply does not appear as a park
 * option.
 *
 * A code constant for the same reasons as the skill catalogue: it needs
 * bilingual labels, every consumer wants compile-time keys, and adding a type
 * is a one-line edit with no migration. Keys are stored on CoachRate and on
 * Booking — never rename one.
 */

export type LessonType = {
  key: string;
  zh: string;
  en: string;
  zhHint: string;
  enHint: string;
};

export const LESSON_TYPES: LessonType[] = [
  {
    key: "riding",
    zh: "滑行课",
    en: "Ski lesson",
    zhHint: "按你的水平练滑行技术,从第一次上雪到刻滑都可以。",
    enHint: "Technique on the hill at your level, from first slides to carving.",
  },
  {
    key: "csia1_prep",
    zh: "一级考前培训",
    en: "CSIA Level 1 prep",
    zhHint: "针对 CSIA 一级考试的示范动作与考核要点。",
    enHint: "Demonstration runs and assessment points for the CSIA Level 1 course.",
  },
  {
    key: "park",
    zh: "公园课",
    en: "Park lesson",
    zhHint: "跳台、平箱、铁杆与转体。",
    enHint: "Jumps, boxes, rails and spins.",
  },
];

/** What existing bookings and rates were before lesson types existed. */
export const DEFAULT_LESSON_TYPE = "riding";

const BY_KEY = new Map(LESSON_TYPES.map((t) => [t.key, t]));

export function isLessonTypeKey(key: string): boolean {
  return BY_KEY.has(key);
}

export function lessonTypeLabel(key: string, locale: "zh" | "en"): string {
  const type = BY_KEY.get(key);
  if (!type) return key; // unknown key: show it rather than hide the booking
  return locale === "zh" ? type.zh : type.en;
}

/** Catalogue position, for sorting a coach's rates into sheet order. */
export function lessonTypeOrder(key: string): number {
  const index = LESSON_TYPES.findIndex((t) => t.key === key);
  return index === -1 ? LESSON_TYPES.length : index;
}
