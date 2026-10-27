import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getUser, requireAdmin, requireCoach, requireUser, requireUserPage } from "./require-user";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), user: vi.fn(), bypass: vi.fn(), redirect: vi.fn(), headers: vi.fn() }));
vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/prisma", () => ({ prisma: { user: { findUnique: mocks.user } } }));
vi.mock("./dev-bypass", () => ({ devBypassUser: mocks.bypass }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("next/headers", () => ({ headers: mocks.headers }));

const now = new Date("2026-10-08T14:00:00.000Z");
const email = "student@example.test";
const dbUser = { id: "student", email, name: "Student", image: null, role: "CUSTOMER", phone: null, wechatId: null, disabledAt: null, tokenInvalidatedAt: null };
const session = (patch: Record<string, unknown> = {}) => ({ user: { id: dbUser.id, email, verifiedGoogleEmail: email, tokenIssuedAt: now.toISOString(), ...patch } });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NODE_ENV", "production");
  vi.useFakeTimers();
  vi.setSystemTime(now);
  mocks.auth.mockResolvedValue(session());
  mocks.user.mockResolvedValue(dbUser);
  mocks.bypass.mockResolvedValue(null);
  mocks.headers.mockResolvedValue(new Headers());
  mocks.redirect.mockImplementation((path: string) => { throw new Error(`REDIRECT:${path}`); });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe("production authoritative user guard", () => {
  it("returns the unchanged ActiveUser contract for a fresh verified identity", async () => {
    expect(await requireUser()).toEqual({ ok: true, user: { id: dbUser.id, email, name: "Student", image: null,
      role: "CUSTOMER", phone: null, wechatId: null, tokenIssuedAt: now.toISOString() } });
    expect(mocks.user).toHaveBeenCalledWith(expect.objectContaining({ where: { id: dbUser.id } }));
    expect(mocks.bypass).not.toHaveBeenCalled();
  });
  it.each([undefined, false, true, "true", "invalid"])("rejects absent/malformed verified claim %j before DB lookup", async (claim) => {
    mocks.auth.mockResolvedValue(session({ verifiedGoogleEmail: claim }));
    const response = await requireUser();
    expect(response.ok).toBe(false);
    if (!response.ok) expect(response.response.status).toBe(401);
    expect(mocks.user).not.toHaveBeenCalled();
  });
  it("rejects a marker that no longer matches the fresh database email", async () => {
    mocks.user.mockResolvedValue({ ...dbUser, email: "changed@example.test" });
    const result = await requireUser();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(await result.response.json()).toEqual({ error: "Session invalidated" });
  });
  it("compares legitimate emails without case-dependent account duplication", async () => {
    mocks.user.mockResolvedValue({ ...dbUser, email: email.toUpperCase() });
    expect((await requireUser()).ok).toBe(true);
  });
  it.each([undefined, null, 0, "", "invalid-date", "Infinity", new Date(now.getTime() + 300_001).toISOString()])("rejects invalid/future issue time %j before DB lookup", async (issuedAt) => {
    mocks.auth.mockResolvedValue(session({ tokenIssuedAt: issuedAt }));
    const result = await requireUser();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(401);
    expect(mocks.user).not.toHaveBeenCalled();
  });
  it("rejects authentication older than seven days even with a current session object", async () => {
    mocks.auth.mockResolvedValue(session({ tokenIssuedAt: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000 - 1).toISOString() }));
    const result = await requireUser();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(await result.response.json()).toEqual({ error: "Session expired" });
    expect(mocks.user).not.toHaveBeenCalled();
  });
  it.each([-7 * 24 * 60 * 60 * 1000, 300_000])("accepts the documented age/skew boundary %i", async (offset) => {
    mocks.auth.mockResolvedValue(session({ tokenIssuedAt: new Date(now.getTime() + offset).toISOString() }));
    expect((await requireUser()).ok).toBe(true);
  });
  it.each([now, new Date(now.getTime() + 1)])("honors forced invalidation at or after issue time %s", async (invalidatedAt) => {
    mocks.user.mockResolvedValue({ ...dbUser, tokenInvalidatedAt: invalidatedAt });
    const result = await requireUser();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(await result.response.json()).toEqual({ error: "Session invalidated" });
  });
  it("allows authentication strictly after the forced invalidation mark", async () => {
    mocks.user.mockResolvedValue({ ...dbUser, tokenInvalidatedAt: new Date(now.getTime() - 1) });
    expect((await requireUser()).ok).toBe(true);
  });
  it("cannot use NaN to bypass a forced invalidation mark", async () => {
    mocks.auth.mockResolvedValue(session({ tokenIssuedAt: "not-a-date" }));
    mocks.user.mockResolvedValue({ ...dbUser, tokenInvalidatedAt: now });
    expect((await requireUser()).ok).toBe(false);
    expect(mocks.user).not.toHaveBeenCalled();
  });
  it.each([{ disabledAt: now }, null])("denies disabled or missing users after authentication %j", async (patch) => {
    mocks.user.mockResolvedValue(patch ? { ...dbUser, ...patch } : null);
    expect((await requireUser()).ok).toBe(false);
  });
  it("reads current database roles instead of session-provided privileges", async () => {
    mocks.auth.mockResolvedValue(session({ role: "ADMIN" }));
    const coach = await requireCoach();
    const admin = await requireAdmin();
    expect(coach.ok).toBe(false);
    expect(admin.ok).toBe(false);
    if (!coach.ok) expect(coach.response.status).toBe(403);
  });
  it("hides old sessions on soft reads and redirects hard reads to reauthentication", async () => {
    mocks.auth.mockResolvedValue(session({ verifiedGoogleEmail: undefined }));
    expect(await getUser()).toBeNull();
    await expect(requireUserPage({ locale: "zh", callbackPath: "/zh/coach" })).rejects.toThrow("REDIRECT:/zh/sign-in?reason=session-invalid");
  });
  it("ignores the development bypass unconditionally in production", async () => {
    vi.stubEnv("DEV_AUTH_BYPASS", "1");
    mocks.auth.mockResolvedValue(null);
    mocks.bypass.mockResolvedValue({ ...dbUser, role: "ADMIN", tokenIssuedAt: null });
    expect((await requireUser()).ok).toBe(false);
    expect(mocks.bypass).not.toHaveBeenCalled();
  });
  it("keeps an explicitly supplied development stand-in usable without Google JWT claims", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const standIn = { id: dbUser.id, email, name: "Demo", image: null, role: "COACH", phone: null, wechatId: null, tokenIssuedAt: null };
    mocks.bypass.mockResolvedValue(standIn);
    expect(await requireUser()).toEqual({ ok: true, user: standIn });
    expect(mocks.auth).not.toHaveBeenCalled();
    expect(mocks.user).not.toHaveBeenCalled();
  });

  it("does not let a forged demo cookie bypass LAN access on media routes", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("DEV_LAN_TEST_PASSWORD", "test-lan-password");
    mocks.bypass.mockResolvedValue({ ...dbUser, tokenIssuedAt: null });
    expect((await requireUser()).ok).toBe(false);
    expect(mocks.bypass).not.toHaveBeenCalled();
    expect(mocks.auth).not.toHaveBeenCalled();
    mocks.headers.mockResolvedValue(new Headers({ authorization: `Basic ${Buffer.from("ski:test-lan-password").toString("base64")}` }));
    expect((await requireUser()).ok).toBe(true);
  });
});
