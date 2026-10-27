import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import type { UserRole } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { inspectSessionIssuedAt, normalizedAuthEmail } from "./verified-google";
import { hasLanTestAccess, lanTestAccessEnabled } from "./lan-test-access";

/**
 * Bridges the JWT's self-reported claims and the database's current truth.
 *
 * A JWT keeps asserting whatever was true when it was issued. If an account is
 * disabled or its sessions are invalidated, the existing token stays
 * cryptographically valid until it expires — so every protected entry point
 * re-reads the user row instead of trusting the token's role or status.
 */

export type ActiveUser = {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  role: UserRole;
  phone: string | null;
  wechatId: string | null;
  tokenIssuedAt: string | null;
};

type UserStatus =
  | { kind: "ok"; user: ActiveUser }
  | { kind: "anon" }
  | { kind: "not-found" }
  | { kind: "disabled" }
  | { kind: "token-invalidated" }
  | { kind: "token-expired" };

async function inspect(): Promise<UserStatus> {
  // Large media routes intentionally bypass Proxy's body cloning. Recheck the
  // LAN gate here before accepting either a demo cookie or a real session.
  if (lanTestAccessEnabled()) {
    const { headers } = await import("next/headers");
    if (!hasLanTestAccess(await headers())) return { kind: "anon" };
  }
  // Development-only bypass. Compiled out of production builds entirely; see
  // dev-bypass.ts for why it is safe to have this branch here at all.
  if (process.env.NODE_ENV !== "production") {
    const { devBypassUser } = await import("./dev-bypass");
    const stand_in = await devBypassUser();
    if (stand_in) return { kind: "ok", user: stand_in };
  }

  const session = await auth();
  if (!session?.user?.id) return { kind: "anon" };
  const verifiedEmail = normalizedAuthEmail(session.user.verifiedGoogleEmail);
  if (!verifiedEmail) return { kind: "token-invalidated" };
  const issued = inspectSessionIssuedAt(session.user.tokenIssuedAt);
  if (issued.kind === "invalid") return { kind: "token-invalidated" };
  if (issued.kind === "expired") return { kind: "token-expired" };

  const dbUser = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      email: true,
      name: true,
      image: true,
      role: true,
      phone: true,
      wechatId: true,
      disabledAt: true,
      tokenInvalidatedAt: true,
    },
  });

  if (!dbUser) return { kind: "not-found" };
  if (dbUser.disabledAt) return { kind: "disabled" };
  if (normalizedAuthEmail(dbUser.email) !== verifiedEmail) return { kind: "token-invalidated" };

  // Forced sign-out: any token issued at or before the invalidation mark dies.
  if (dbUser.tokenInvalidatedAt) {
    if (issued.issuedAt <= dbUser.tokenInvalidatedAt.getTime()) {
      return { kind: "token-invalidated" };
    }
  }

  return {
    kind: "ok",
    user: {
      id: dbUser.id,
      email: dbUser.email,
      name: dbUser.name,
      image: dbUser.image,
      role: dbUser.role,
      phone: dbUser.phone,
      wechatId: dbUser.wechatId,
      tokenIssuedAt: issued.raw,
    },
  };
}

// ── API routes ──

export type RequireResult =
  | { ok: true; user: ActiveUser }
  | { ok: false; response: NextResponse };

function toResponse(status: UserStatus): RequireResult {
  switch (status.kind) {
    case "ok":
      return { ok: true, user: status.user };
    case "anon":
      return {
        ok: false,
        response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      };
    case "not-found":
      return {
        ok: false,
        response: NextResponse.json({ error: "Account not found" }, { status: 401 }),
      };
    case "disabled":
      return {
        ok: false,
        response: NextResponse.json({ error: "Account disabled" }, { status: 403 }),
      };
    case "token-invalidated":
      return {
        ok: false,
        response: NextResponse.json({ error: "Session invalidated" }, { status: 401 }),
      };
    case "token-expired":
      return {
        ok: false,
        response: NextResponse.json({ error: "Session expired" }, { status: 401 }),
      };
  }
}

export async function requireUser(): Promise<RequireResult> {
  return toResponse(await inspect());
}

/** Coach-only endpoints. ADMIN passes too — it is the escape hatch. */
export async function requireCoach(): Promise<RequireResult> {
  const r = await requireUser();
  if (!r.ok) return r;
  if (r.user.role !== "COACH" && r.user.role !== "ADMIN") {
    return {
      ok: false,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }
  return r;
}

export async function requireAdmin(): Promise<RequireResult> {
  const r = await requireUser();
  if (!r.ok) return r;
  if (r.user.role !== "ADMIN") {
    return {
      ok: false,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }
  return r;
}

// ── Server components ──

/** Soft read: null when signed out. For pages that render differently either way. */
export async function getUser(): Promise<ActiveUser | null> {
  const status = await inspect();
  return status.kind === "ok" ? status.user : null;
}

type SSROptions = {
  locale: string;
  /** Where to come back to after signing in. */
  callbackPath?: string;
};

/** Hard gate: redirects to sign-in when not usable. */
export async function requireUserPage(opts: SSROptions): Promise<ActiveUser> {
  const status = await inspect();
  const next = opts.callbackPath
    ? `?callbackUrl=${encodeURIComponent(opts.callbackPath)}`
    : "";

  switch (status.kind) {
    case "ok":
      return status.user;
    case "anon":
      redirect(`/${opts.locale}/sign-in${next}`);
    case "not-found":
    case "disabled":
    case "token-invalidated":
      redirect(`/${opts.locale}/sign-in?reason=session-invalid`);
    case "token-expired":
      redirect(`/${opts.locale}/sign-in?reason=expired`);
  }
}

export async function requireCoachPage(opts: SSROptions): Promise<ActiveUser> {
  const user = await requireUserPage(opts);
  if (user.role !== "COACH" && user.role !== "ADMIN") {
    // Do not reveal that the coach area exists.
    redirect(`/${opts.locale}`);
  }
  return user;
}
