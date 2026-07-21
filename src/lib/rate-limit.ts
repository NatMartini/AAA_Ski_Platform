import { NextResponse } from "next/server";

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
  const forwarded = req.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local";
  return ip;
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
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    sweep(now);
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
  if (now - lastSweep < 60_000) return;
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
