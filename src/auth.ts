import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/prisma";
import type { UserRole } from "@prisma/client";

/**
 * Google is the only sign-in method. That is deliberate and load-bearing:
 *
 *  - There is no password signup, so nobody can create an account claiming an
 *    email they do not control. That is what makes it safe to treat the signed-
 *    in address as verified identity evidence on a waiver.
 *  - Waiver signing links check that the signed-in address matches the address
 *    the coach issued the link to. With only a verified-email provider in play,
 *    that check actually means something.
 *
 * We ask for `openid email profile` and nothing else. Calendar sync is done
 * with a read-only ICS feed precisely so we never have to hold a refresh token
 * with calendar scope.
 */

export const googleEnabled = Boolean(
  process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET,
);

function emailList(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export const COACH_EMAILS = emailList(process.env.COACH_EMAILS);
export const ADMIN_EMAILS = emailList(process.env.ADMIN_EMAILS);

export function roleForEmail(email: string): UserRole {
  const normalized = email.trim().toLowerCase();
  if (ADMIN_EMAILS.includes(normalized)) return "ADMIN";
  if (COACH_EMAILS.includes(normalized)) return "COACH";
  return "CUSTOMER";
}

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      email: string;
      name?: string | null;
      image?: string | null;
      role: UserRole;
      tokenIssuedAt?: string;
    };
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  session: { strategy: "jwt", maxAge: 7 * 24 * 60 * 60 },
  pages: { signIn: "/sign-in", error: "/sign-in" },

  providers: googleEnabled
    ? [
        Google({
          clientId: process.env.AUTH_GOOGLE_ID,
          clientSecret: process.env.AUTH_GOOGLE_SECRET,
          authorization: { params: { scope: "openid email profile" } },
          // Safe here only because Google is the sole provider: there is no
          // unverified-email signup path an attacker could use to pre-claim an
          // address. Adding any credentials provider later would make this an
          // account-takeover hole.
          allowDangerousEmailAccountLinking: true,
        }),
      ]
    : [],

  trustHost:
    process.env.NODE_ENV !== "production" ||
    process.env.AUTH_TRUST_HOST === "true",

  callbacks: {
    async jwt({ token, user, trigger }) {
      if (user?.id) {
        token.uid = user.id;
        token.tokenIssuedAt = new Date().toISOString();
      }
      // Roles come from the allowlist at sign-in. Re-check on session refresh so
      // adding an email to COACH_EMAILS takes effect without a full re-login.
      if (user?.id || trigger === "update") {
        const id = (token.uid as string) ?? user?.id;
        if (id) await syncRoleFromAllowlist(id);
      }
      return token;
    },

    async session({ session, token }) {
      if (token.uid) session.user.id = token.uid as string;
      if (token.tokenIssuedAt) {
        session.user.tokenIssuedAt = token.tokenIssuedAt as string;
      }
      // The authoritative role is read fresh from the DB per request by
      // requireUser(); this copy is only for cheap UI decisions.
      return session;
    },
  },

  events: {
    async createUser({ user }) {
      if (user.id && user.email) await syncRoleFromAllowlist(user.id);
    },
  },
});

/**
 * Promote allowlisted emails and make sure a coach has a profile row. Runs on
 * account creation and on session refresh, so adding an email to COACH_EMAILS
 * is all it takes to onboard a coach.
 */
async function syncRoleFromAllowlist(userId: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true, role: true },
  });
  if (!user) return;

  const target = roleForEmail(user.email);
  if (target !== user.role && user.role !== "ADMIN") {
    await prisma.user.update({
      where: { id: user.id },
      data: { role: target },
    });
  }

  if (target === "COACH" || target === "ADMIN") {
    const existing = await prisma.coachProfile.findUnique({
      where: { userId: user.id },
      select: { id: true },
    });
    if (!existing && target === "COACH") {
      await prisma.coachProfile.create({
        data: {
          userId: user.id,
          displayName: user.name ?? user.email.split("@")[0],
          contactEmail: user.email,
          emtEmail: user.email,
          icsToken: crypto.randomUUID().replace(/-/g, ""),
        },
      });
    }
  }
}
