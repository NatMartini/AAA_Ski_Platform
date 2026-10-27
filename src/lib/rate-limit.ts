import { NextResponse } from "next/server";
import { isIP } from "node:net";
import { isTrustedApiWrite } from "./request-origin";
import { hasLanTestAccess, lanTestChallenge } from "./auth/lan-test-access";

/**
 * In-memory fixed-window rate limiting.
 *
 * Adequate for a single self-hosted instance serving two coaches and their
 * students. It resets on deploy and does not coordinate across processes — if
 * this ever runs behind more than one instance, move the counters to the
 * database or Redis.
 */

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();
const MAX_BUCKETS = 5000;

export const LIMITS = {
  /** Sign-in, token lookups — cheap but abusable for enumeration. */
  auth: { max: 20, windowMs: 60_000 },
  /** Ordinary writes. */
  write: { max: 30, windowMs: 60_000 },
  /** Image uploads: expensive (sharp) and fill the disk. */
  upload: { max: 20, windowMs: 60 * 60_000 },
  /** Booking creation, tighter to blunt slot-squatting. */
  booking: { max: 10, windowMs: 10 * 60_000 },
  /** Outbound email. */
  mail: { max: 15, windowMs: 60 * 60_000 },
} as const;

export type LimitName = keyof typeof LIMITS;

export function clientKey(req: Request): string {
  // Only an explicitly trusted reverse proxy may supply the client address.
  // Direct clients can freely forge these headers.
  if (process.env.TRUST_PROXY_HEADERS !== "true") return "local";
  const forwarded = req.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || req.headers.get("x-real-ip")?.trim();
  return ip && ip.length <= 45 && isIP(ip) ? ip : "local";
}

export function checkRateLimit(
  req: Request,
  limit: LimitName,
  scope: string,
): { allowed: boolean; retryAfterSeconds: number } {
  const { max, windowMs } = LIMITS[limit];
  const key = `${limit}:${scope}:${clientKey(req)}`;
  const now = Date.now();

  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    sweep(now);
    if (!bucket && buckets.size >= MAX_BUCKETS) {
      // Do not evict live counters: rotating addresses must not reset a limit.
      return { allowed: false, retryAfterSeconds: 60 };
    }
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  bucket.count += 1;
  if (bucket.count > max) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
    };
  }
  return { allowed: true, retryAfterSeconds: 0 };
}

/** Returns a 429 response to short-circuit with, or null to continue. */
export function rateLimitOrRespond(
  req: Request,
  limit: LimitName,
  scope: string,
): NextResponse | null {
  if (!hasLanTestAccess(req.headers)) return lanTestChallenge();
  // Uploads bypass Proxy's body cloning; keep the same source guard here.
  if (!isTrustedApiWrite(req)) {
    return NextResponse.json({ error: "untrusted-origin" }, { status: 403,
      headers: { "Cache-Control": "private, no-store", Vary: "Origin, Sec-Fetch-Site" } });
  }
  const result = checkRateLimit(req, limit, scope);
  if (result.allowed) return null;
  return NextResponse.json(
    { error: "rate-limited" },
    {
      status: 429,
      headers: { "Retry-After": String(result.retryAfterSeconds) },
    },
  );
}

let lastSweep = 0;

function sweep(now: number): void {
  if (now - lastSweep < 60_000 && buckets.size < MAX_BUCKETS) return;
  lastSweep = now;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

/** Test hook. */
export function __resetRateLimits(): void {
  buckets.clear();
  lastSweep = 0;
}
