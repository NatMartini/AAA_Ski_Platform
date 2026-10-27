/** Browser-origin guard for cookie-authenticated API writes. */
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function originOf(value: string | null | undefined, originOnly = false): string | null {
  try {
    if (!value) return null;
    const url = new URL(value);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return null;
    if (originOnly && value !== url.origin) return null;
    return url.origin;
  } catch { return null; }
}

export function isTrustedApiWrite(req: Request, env: Record<string, string | undefined> = process.env): boolean {
  if (SAFE_METHODS.has(req.method.toUpperCase())) return true;
  const origin = req.headers.get("origin");
  const site = req.headers.get("sec-fetch-site");
  // Sibling subdomains are not trusted to act with a user's session cookie.
  if (site === "cross-site" || site === "same-site") return false;
  const canonical = originOf(env.AUTH_URL) ?? originOf(env.NEXT_PUBLIC_BASE_URL);
  const target = canonical ?? originOf(req.url);
  if (!target) return false;
  if (origin !== null) return originOf(origin, true) === target;
  const referer = req.headers.get("referer");
  if (referer !== null) return originOf(referer) === target;
  if (site === "same-origin") return true;
  // Non-browser callers without cookies still pass through route auth (cron,
  // for example, requires its bearer secret). Cookie clients supply Origin.
  return !req.headers.get("cookie") && !site;
}
