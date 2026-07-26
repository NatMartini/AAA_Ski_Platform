/**
 * Theme persistence.
 *
 * A cookie rather than localStorage, so the server can stamp `data-theme` onto
 * <html> in the response it already sends. That removes the blocking inline
 * script this used to need: an inline <script> inside a React component is
 * never executed when that component renders on the client, which React now
 * warns about, and it was only ever there to beat the first paint. The server
 * knowing the answer is strictly better than the client racing to apply it.
 */

export type Theme = "light" | "dark";

export const THEME_COOKIE = "theme";

/** A year: long enough that a returning student keeps their choice. */
const MAX_AGE = 60 * 60 * 24 * 365;

export function isTheme(value: unknown): value is Theme {
  return value === "light" || value === "dark";
}

/**
 * Lax rather than Strict: the site is opened from a link in a group chat, and
 * Strict would drop the cookie on that first cross-site navigation — landing
 * the user on the wrong theme exactly once, which is the flash we are trying
 * to avoid. It carries no authority, so Lax costs nothing.
 */
export function themeCookieString(theme: Theme): string {
  return `${THEME_COOKIE}=${theme}; path=/; max-age=${MAX_AGE}; samesite=lax`;
}
