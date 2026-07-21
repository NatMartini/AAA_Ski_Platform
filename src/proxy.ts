import createIntlMiddleware from "next-intl/middleware";
import { NextResponse, type NextRequest } from "next/server";
import { routing } from "@/i18n/routing";

/**
 * Next 16 renamed `middleware` to `proxy`, and it now runs on the Node runtime
 * rather than edge.
 *
 * Two jobs:
 *  1. Locale routing (next-intl).
 *  2. Reinforcing that this is a private site — belt and braces alongside the
 *     X-Robots-Tag header set in next.config.ts.
 *
 * Authorisation is deliberately NOT done here. Every page and route handler
 * checks the database itself via requireUser/requireCoach, because a proxy-level
 * check would be a single point of failure and cannot see fresh role or
 * disabled state. This layer only handles routing.
 */

const intlMiddleware = createIntlMiddleware(routing);

export function proxy(request: NextRequest): NextResponse {
  const response = intlMiddleware(request);
  response.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  return response;
}

export const config = {
  // Skip API routes, Next internals and static files; match everything else so
  // each page lands under a /zh or /en prefix.
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
