/**
 * Best-effort client IP for the waiver audit trail.
 *
 * Behind a reverse proxy the left-most X-Forwarded-For entry is the client;
 * without one the header is absent and we record that honestly rather than
 * inventing a value. It is corroborating evidence alongside the verified
 * Google account, not proof on its own.
 */
export function clientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}
