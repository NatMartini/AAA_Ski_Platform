import createIntlMiddleware from "next-intl/middleware";
import { NextResponse, type NextRequest } from "next/server";
import { routing } from "@/i18n/routing";
import { isTrustedApiWrite } from "@/lib/request-origin";
import { hasLanTestAccess, LAN_TEST_SIGN_IN_PATH, lanTestAccessEnabled, lanTestChallenge, lanTestSignIn } from "@/lib/auth/lan-test-access";

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

/** Says in the server's log who met the LAN test gate, so a device that cannot get in can be told from one that never arrived. */
function noteLanVisitor(request: NextRequest, what: string) {
  const from = (request.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "an unknown address";
  console.info(`[lan-test] ${from} ${what} (${(request.headers.get("user-agent") ?? "no user agent").slice(0, 90)})`);
}

/** The LAN test server's gate: the access form and its submission, then a refusal for anything without access. */
function lanTestGate(request: NextRequest): NextResponse | Promise<NextResponse> | null {
  if (!lanTestAccessEnabled()) return null;
  if (request.nextUrl.pathname === LAN_TEST_SIGN_IN_PATH) {
    return lanTestSignIn(request).then((response) => {
      if (request.method === "POST") noteLanVisitor(request, response.status === 303 ? "passed the access form" : "entered a wrong access password");
      return response;
    });
  }
  if (hasLanTestAccess(request.headers)) return null;
  const response = lanTestChallenge(request);
  if (response.status === 200) noteLanVisitor(request, "was shown the access form");
  return response;
}

export function proxy(request: NextRequest): NextResponse | Promise<NextResponse> {
  const gate = lanTestGate(request);
  if (gate) return gate;
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
