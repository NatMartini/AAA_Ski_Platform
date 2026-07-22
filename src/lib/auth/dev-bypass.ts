import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import type { ActiveUser } from "./require-user";

/**
 * Development-only sign-in bypass, so the site can be browsed without Google
 * OAuth credentials configured.
 *
 * ⚠ This makes every page readable by anyone who can reach the server. It is
 * for looking at a local dev instance and nothing else.
 *
 * Three independent guards, because an auth bypass that leaks into production
 * would expose every student's personal details and payment screenshots:
 *
 *   1. `NODE_ENV === "production"` disables it unconditionally — the env var is
 *      not even read.
 *   2. It must be switched on explicitly with DEV_AUTH_BYPASS=1; it is never
 *      on by default, even in development.
 *   3. `next build` runs with NODE_ENV=production, so a production bundle has
 *      the whole thing dead-code-eliminated rather than merely disabled.
 *
 * `assertNotProduction()` additionally makes a misconfigured production boot
 * fail loudly instead of silently serving everything to everyone.
 */

/**
 * Cookie holding the email of the account being impersonated.
 *
 * There is deliberately no default: with no cookie you are signed out and get
 * the sign-in page, exactly as a real visitor would. Auto-signing-in would hide
 * the signed-out state, which is the one a stranger who finds the URL sees.
 */
export const DEV_AS_COOKIE = "dev-as";

export function devBypassEnabled(): boolean {
  if (process.env.NODE_ENV === "production") return false;
  return process.env.DEV_AUTH_BYPASS === "1";
}

/**
 * Refuses to start a production server that has the bypass configured.
 * Called from instrumentation.ts, which Next runs once at boot.
 */
export function assertNotProduction(): void {
  if (process.env.NODE_ENV === "production" && process.env.DEV_AUTH_BYPASS) {
    throw new Error(
      "DEV_AUTH_BYPASS is set in a production build. This would let anyone " +
        "read every booking, waiver and payment screenshot. Remove it from " +
        "the environment before starting the server.",
    );
  }
}

/** The account the bypass is currently acting as, or null when it is off. */
export async function devBypassUser(): Promise<ActiveUser | null> {
  if (!devBypassEnabled()) return null;

  const jar = await cookies();
  const email = jar.get(DEV_AS_COOKIE)?.value?.trim();
  if (!email) return null; // signed out until an account is chosen

  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      email: true,
      name: true,
      image: true,
      role: true,
      phone: true,
      wechatId: true,
      disabledAt: true,
    },
  });
  // Still honour the disabled flag, so the bypass cannot resurrect a
  // deliberately disabled account while testing.
  if (!user || user.disabledAt) return null;

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    image: user.image,
    role: user.role,
    phone: user.phone,
    wechatId: user.wechatId,
    tokenIssuedAt: null,
  };
}

/**
 * Accounts offered on the dev sign-in page and in the banner switcher.
 *
 * Every account, not just the seeded demo ones, so a coach or student created
 * through the real flow can also be inspected. Disabled accounts are excluded
 * to match what signing in would actually do.
 */
export async function devBypassChoices() {
  if (!devBypassEnabled()) return [];
  return prisma.user.findMany({
    where: { disabledAt: null },
    select: { email: true, name: true, role: true },
    orderBy: [{ role: "asc" }, { email: "asc" }],
    take: 25,
  });
}
