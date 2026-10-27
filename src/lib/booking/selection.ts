import { isDateKey } from "../time";
import { seasonOfDateKey } from "../season";
import { isLevelKey } from "../skills";
import { isLessonTypeKey } from "../lesson-types";

export type BookingSelection = {
  dateKey: string;
  startHour: number;
  hours: number;
  requestedSkills: string[];
  level: string | null;
  lessonType?: string;
  headcount?: number;
};

type SelectionQuery = Record<string, string | string[] | undefined>;

/** All booking steps share one wall-clock selection; malformed URLs reset it. */
export function parseBookingSelection(query: SelectionQuery): BookingSelection | null {
  const { date, startHour, hours, requestedSkills, level, lessonType, headcount } = query;
  if (typeof date !== "string" || !isDateKey(date) || !seasonOfDateKey(date) ||
      typeof startHour !== "string" || !/^\d{1,2}$/.test(startHour) ||
      typeof hours !== "string" || !/^\d{1,2}$/.test(hours)) return null;
  const start = Number(startHour);
  const duration = Number(hours);
  if (start > 23 || duration < 1 || duration > 12 || start + duration > 24) return null;
  if (requestedSkills !== undefined && typeof requestedSkills !== "string") return null;
  const skills = [...new Set((requestedSkills ?? "").split(",").filter(Boolean))];
  if (skills.length > 12 || skills.some((key) => key.length > 96 || !/^[a-zA-Z0-9_:-]+$/.test(key))) return null;
  if (lessonType !== undefined && (typeof lessonType !== "string" || !isLessonTypeKey(lessonType))) return null;
  if (headcount !== undefined && (typeof headcount !== "string" || !/^[1-3]$/.test(headcount))) return null;
  return {
    dateKey: date, startHour: start, hours: duration, requestedSkills: skills,
    level: typeof level === "string" && isLevelKey(level) ? level : null,
    ...(typeof lessonType === "string" ? { lessonType } : {}),
    ...(typeof headcount === "string" ? { headcount: Number(headcount) } : {}),
  };
}

export function toBookingSelectionQuery(selection: BookingSelection): Record<string, string> {
  return {
    date: selection.dateKey, startHour: String(selection.startHour), hours: String(selection.hours),
    requestedSkills: selection.requestedSkills.join(","),
    ...(selection.level ? { level: selection.level } : {}),
    ...(selection.lessonType ? { lessonType: selection.lessonType } : {}),
    ...(selection.headcount ? { headcount: String(selection.headcount) } : {}),
  };
}
