import type { NextAuthConfig, Session } from "next-auth";
import { encode, type JWT } from "next-auth/jwt";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ config: null as NextAuthConfig | null, findUser: vi.fn(), updateUser: vi.fn(),
  findCoach: vi.fn(), createCoach: vi.fn(), linkAccount: vi.fn() }));
vi.mock("next-auth", () => ({ default: (config: NextAuthConfig) => {
  mocks.config = config;
  return { handlers: {}, auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn() };
} }));
vi.mock("@auth/prisma-adapter", () => ({ PrismaAdapter: () => ({ linkAccount: mocks.linkAccount }) }));
vi.mock("@/lib/prisma", () => ({ prisma: { user: { findUnique: mocks.findUser, update: mocks.updateUser },
  coachProfile: { findUnique: mocks.findCoach, create: mocks.createCoach } } }));

type Callbacks = NonNullable<NextAuthConfig["callbacks"]>;
type SignInInput = Parameters<NonNullable<Callbacks["signIn"]>>[0];
type JwtInput = Parameters<NonNullable<Callbacks["jwt"]>>[0];
const now = new Date("2026-10-08T14:00:00.000Z");
const email = "coach@example.test";
const account = { provider: "google", type: "oidc" as const, providerAccountId: "google-sub-123" };
const profile = { sub: account.providerAccountId, email, email_verified: true };
const user = { id: "user-123", email, name: "Coach" };
const validClaims = () => ({ uid: user.id, sub: user.id, email, verifiedGoogleEmail: email, tokenIssuedAt: now.toISOString() });
const signInInput = (patch: Record<string, unknown> = {}) => ({ user, account, profile, ...patch }) as SignInInput;
const jwtInput = (patch: Record<string, unknown> = {}) => ({ token: { sub: user.id, email }, user, account, profile, trigger: "signIn", ...patch }) as JwtInput;
const callbacks = () => mocks.config!.callbacks!;

beforeAll(async () => {
  vi.stubEnv("AUTH_GOOGLE_ID", "test-client-id");
  vi.stubEnv("AUTH_GOOGLE_SECRET", "test-client-secret");
  vi.stubEnv("COACH_EMAILS", email);
  vi.stubEnv("ADMIN_EMAILS", "admin@example.test");
  await import("./auth");
});
beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(now);
  mocks.findUser.mockResolvedValue({ ...user, role: "CUSTOMER" });
  mocks.updateUser.mockResolvedValue({});
  mocks.findCoach.mockResolvedValue({ id: "existing-coach" });
});
afterEach(() => { vi.useRealTimers(); });
afterAll(() => { vi.unstubAllEnvs(); });

describe("actual Google auth configuration callbacks", () => {
  it.each([false, undefined, "true", 1, null])("rejects email_verified=%j before role or account writes", async (verified) => {
    const input = signInInput({ profile: { ...profile, email_verified: verified } });
    expect(await callbacks().signIn!(input)).toBe(false);
    expect(await callbacks().jwt!(jwtInput({ profile: input.profile }))).toBeNull();
    expect(mocks.findUser).not.toHaveBeenCalled();
    expect(mocks.updateUser).not.toHaveBeenCalled();
    expect(mocks.linkAccount).not.toHaveBeenCalled();
    expect(mocks.createCoach).not.toHaveBeenCalled();
  });
  it.each([
    { account: { ...account, provider: "github" } }, { account: null }, { profile: undefined },
    { profile: { ...profile, email: "not-an-email" } }, { user: { ...user, email: "other@example.test" } },
    { profile: { ...profile, sub: "another-sub" } }, { profile: { ...profile, sub: undefined } },
    { account: { ...account, type: "credentials" } },
    { user: undefined },
  ])("rejects incomplete or inconsistent identities: %j", async (patch) => {
    expect(await callbacks().signIn!(signInInput(patch))).toBe(false);
    expect(await callbacks().jwt!(jwtInput(patch))).toBeNull();
    expect(mocks.findUser).not.toHaveBeenCalled();
    expect(mocks.linkAccount).not.toHaveBeenCalled();
  });
  it("accepts a verified matching Google subject, then writes a server-owned normalized marker", async () => {
    expect(await callbacks().signIn!(signInInput({ profile: { ...profile, email: email.toUpperCase() } }))).toBe(true);
    const token = await callbacks().jwt!(jwtInput({ profile: { ...profile, email: email.toUpperCase() } }));
    expect(token).toMatchObject({ uid: user.id, sub: user.id, verifiedGoogleEmail: email, tokenIssuedAt: now.toISOString() });
    expect(mocks.updateUser).toHaveBeenCalledWith({ where: { id: user.id }, data: { role: "COACH" } });
    expect(mocks.linkAccount).not.toHaveBeenCalled();
  });
  it("blocks auto-linking or re-login when the matching existing account is disabled", async () => {
    mocks.findUser.mockResolvedValue({ ...user, disabledAt: now });
    expect(await callbacks().signIn!(signInInput())).toBe(false);
    expect(mocks.findUser).toHaveBeenCalledWith({ where: { email: user.email }, select: { disabledAt: true } });
    expect(mocks.updateUser).not.toHaveBeenCalled();
    expect(mocks.linkAccount).not.toHaveBeenCalled();
  });
  it("allows a first-time verified user without creating or linking them inside the guard", async () => {
    mocks.findUser.mockResolvedValue(null);
    expect(await callbacks().signIn!(signInInput())).toBe(true);
    expect(mocks.updateUser).not.toHaveBeenCalled();
    expect(mocks.linkAccount).not.toHaveBeenCalled();
  });
  it("uses the exact validated adapter email for the disabled-account lookup", async () => {
    const adapterEmail = email.toUpperCase();
    expect(await callbacks().signIn!(signInInput({ user: { ...user, email: adapterEmail } }))).toBe(true);
    expect(mocks.findUser).toHaveBeenCalledWith({ where: { email: adapterEmail }, select: { disabledAt: true } });
  });
  it("rejects an update that tries to add a marker to an old token", async () => {
    const legacy = { uid: user.id, sub: user.id, email, tokenIssuedAt: now.toISOString() };
    expect(await callbacks().jwt!(jwtInput({ token: legacy, user: undefined, account: undefined, profile: undefined,
      trigger: "update", session: { verifiedGoogleEmail: email, tokenIssuedAt: now.toISOString() } }))).toBeNull();
    expect(legacy).not.toHaveProperty("verifiedGoogleEmail");
    expect(mocks.findUser).not.toHaveBeenCalled();
  });
  it("cannot initialize a marker or renew issue time on an update even with misplaced login parameters", async () => {
    const old = { ...validClaims(), tokenIssuedAt: new Date(now.getTime() - 60_000).toISOString() };
    expect(await callbacks().jwt!(jwtInput({ token: old, trigger: "update" }))).toBeNull();
    expect(old.tokenIssuedAt).toBe(new Date(now.getTime() - 60_000).toISOString());
    expect(mocks.findUser).not.toHaveBeenCalled();
  });
  it("preserves the original verified identity and issue time despite client update data", async () => {
    const original = { ...validClaims(), tokenIssuedAt: new Date(now.getTime() - 60_000).toISOString() };
    const token = await callbacks().jwt!(jwtInput({ token: original, user: undefined, account: undefined, profile: undefined,
      trigger: "update", session: { verifiedGoogleEmail: "attacker@example.test", uid: "attacker", tokenIssuedAt: new Date(now.getTime() + 60_000).toISOString() } }));
    expect(token).toMatchObject(original);
    expect(token?.verifiedGoogleEmail).toBe(email);
    expect(token?.tokenIssuedAt).toBe(new Date(now.getTime() - 60_000).toISOString());
    expect(mocks.findUser).toHaveBeenCalledWith(expect.objectContaining({ where: { id: user.id } }));
  });
  it("passes the authenticated marker and original issue time into the session", async () => {
    const session = { user: { id: "", email, role: "CUSTOMER" }, expires: now.toISOString() } as Session;
    // The runtime JWT path passes only session/token, while Auth.js types also
    // intersect these parameters with its unrelated database-session shape.
    const result = await callbacks().session!({ session, token: validClaims() } as unknown as Parameters<NonNullable<Callbacks["session"]>>[0]);
    expect(result.user).toMatchObject({ id: user.id, email, verifiedGoogleEmail: email, tokenIssuedAt: now.toISOString() });
  });
});

describe("configured real Auth.js JWE decoder", () => {
  const secret = "round-five-unit-test-only-secret-not-an-environment-secret";
  const salt = "authjs.session-token";
  async function decodeClaims(patch: Record<string, unknown> = {}) {
    // Neither cryptography nor the configured decode hook is mocked.
    const cookie = await encode({ secret, salt, maxAge: 7 * 24 * 60 * 60, token: { ...validClaims(), ...patch } });
    return mocks.config!.jwt!.decode!({ token: cookie, secret, salt });
  }
  it("accepts a genuinely encrypted valid new cookie", async () => {
    expect(await decodeClaims()).toMatchObject(validClaims());
    expect(mocks.findUser).toHaveBeenCalledWith({ where: { id: user.id }, select: { email: true, disabledAt: true, tokenInvalidatedAt: true } });
  });
  it.each([{ uid: undefined }, { uid: "" }, { uid: " " }, { sub: undefined }, { sub: "other-user" }, { uid: false }])("rejects absent or diverging Auth.js/API user identifiers %j", async (patch) => {
    expect(await decodeClaims(patch)).toBeNull();
    expect(mocks.findUser).not.toHaveBeenCalled();
  });
  it.each([null, { ...user, email: "changed@example.test" }, { ...user, disabledAt: now },
    { ...user, tokenInvalidatedAt: now }, { ...user, tokenInvalidatedAt: new Date(now.getTime() + 1) }])("blocks cookie-link reuse for missing/changed/disabled/revoked users %j", async (row) => {
    mocks.findUser.mockResolvedValue(row);
    expect(await decodeClaims()).toBeNull();
    expect(mocks.updateUser).not.toHaveBeenCalled();
    expect(mocks.linkAccount).not.toHaveBeenCalled();
  });
  it("allows a fresh re-login strictly after forced revocation", async () => {
    mocks.findUser.mockResolvedValue({ ...user, tokenInvalidatedAt: new Date(now.getTime() - 1) });
    expect(await decodeClaims()).toMatchObject(validClaims());
  });
  it.each([undefined, false, true, "true", "other@example.test", "not-an-email"])("rejects missing or invalid verified marker %j", async (marker) => {
    expect(await decodeClaims({ verifiedGoogleEmail: marker })).toBeNull();
  });
  it.each([undefined, null, 0, "", "not-a-date", "Infinity", new Date(now.getTime() + 300_001).toISOString(), new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000 - 1).toISOString()])("rejects invalid cookie issue time %j", async (issuedAt) => {
    expect(await decodeClaims({ tokenIssuedAt: issuedAt })).toBeNull();
  });
  it.each([-7 * 24 * 60 * 60 * 1000, 300_000])("allows the defined lifetime/clock-skew boundary %i", async (offset) => {
    expect(await decodeClaims({ tokenIssuedAt: new Date(now.getTime() + offset).toISOString() })).not.toBeNull();
  });
  it("never treats a fresh JWE expiration as a renewed original authentication time", async () => {
    expect(await decodeClaims({ tokenIssuedAt: new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000).toISOString() })).toBeNull();
  });
  it("rejects tampered encryption instead of returning authenticated claims", async () => {
    const cookie = await encode({ secret, salt, token: validClaims() as JWT });
    await expect(mocks.config!.jwt!.decode!({ token: cookie, secret: "different-test-secret", salt })).rejects.toThrow();
  });
});
