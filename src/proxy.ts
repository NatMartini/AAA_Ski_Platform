import createIntlMiddleware from "next-intl/middleware";
import { NextResponse, type NextRequest } from "next/server";
import { routing } from "@/i18n/routing";
import { isTrustedApiWrite } from "@/lib/request-origin";
import { hasLanTestAccess, lanTestChallenge } from "@/lib/auth/lan-test-access";

/**
 * Next 16 renamed `middleware` to `proxy`, and it now runs on the Node runtime
 * rather than edge.
 *
 * Three jobs:
 *  1. Locale routing (next-intl).
 *  2. Reinforcing that this is a private site — belt and braces alongside the
 *     X-Robots-Tag header set in next.config.ts.
 *  3. Rejecting API writes from untrusted browser origins.
 *
 * Authorisation is deliberately NOT done here. Every page and route handler
 * checks the database itself via requireUser/requireCoach, because a proxy-level
 * check would be a single point of failure and cannot see fresh role or
 * disabled state. Request-origin checks do not replace authorisation.
 */

const intlMiddleware = createIntlMiddleware(routing);

export function proxy(request: NextRequest): NextResponse {
  if (!hasLanTestAccess(request.headers)) return lanTestChallenge();
  if (request.nextUrl.pathname === "/api" || request.nextUrl.pathname.startsWith("/api/")) {
    if (!isTrustedApiWrite(request)) {
      return NextResponse.json({ error: "untrusted-origin" }, { status: 403,
        headers: { "Cache-Control": "private, no-store", Vary: "Origin, Sec-Fetch-Site" } });
    }
    return NextResponse.next();
  }
  const response = intlMiddleware(request);
  response.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  return response;
}

export const config = {
  // Large multipart bodies must bypass Proxy's default 10MB body clone.
  // Each upload route enforces the identical guard through rateLimitOrRespond.
  matcher: ["/api/((?!upload(?:/|$)|bookings/[^/]+/videos(?:/|$)|video-analysis/videos(?:/|$)).*)", "/((?!api|_next|_vercel|.*\\..*).*)"],
};
