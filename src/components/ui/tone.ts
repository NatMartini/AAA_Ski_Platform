/**
 * Feature categories. Each one has a colour pair in globals.css so the
 * navigation, home tiles and page headers say which area the user is in.
 * Class strings stay literal so Tailwind can see them.
 */
export type Tone = "book" | "lessons" | "video" | "people" | "admin";

export const TONE_TILE: Record<Tone, string> = {
  book: "bg-cat-book-soft text-cat-book",
  lessons: "bg-cat-lessons-soft text-cat-lessons",
  video: "bg-cat-video-soft text-cat-video",
  people: "bg-cat-people-soft text-cat-people",
  admin: "bg-cat-admin-soft text-cat-admin",
};

export const TONE_TEXT: Record<Tone, string> = {
  book: "text-cat-book",
  lessons: "text-cat-lessons",
  video: "text-cat-video",
  people: "text-cat-people",
  admin: "text-cat-admin",
};
