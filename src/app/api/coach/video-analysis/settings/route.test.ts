import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), profile: vi.fn(), update: vi.fn() }));
vi.mock("@/lib/auth/require-user", () => ({ requireCoach: mocks.auth }));
vi.mock("@/lib/rate-limit", () => ({ rateLimitOrRespond: () => null }));
vi.mock("@/lib/prisma", () => ({ prisma: { coachProfile: { findUnique: mocks.profile, update: mocks.update } } }));
import { GET, PATCH } from "./route";
beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue({ ok: true, user: { id: "coach" } });
  mocks.profile.mockResolvedValue({ id: "profile", analysisCreditPriceCents: null });
  mocks.update.mockImplementation(async ({ data }) => data);
});
const patch = (body: unknown) => PATCH(new Request("http://localhost/api/coach/video-analysis/settings", {
  method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
describe("independent analysis price settings", () => {
  it("preserves a missing price as disabled and reads only the session coach's profile", async () => {
    expect(await (await GET()).json()).toMatchObject({ analysisCreditPriceCents: null });
    expect(mocks.profile).toHaveBeenCalledWith({ where: { userId: "coach" }, select: { analysisCreditPriceCents: true } });
  });
  it.each([null, 750])("sets the explicit price %s without mass-assigning a supplied target", async (price) => {
    const response = await patch({ analysisCreditPriceCents: price, expectedCoachId: "coach", coachId: "other", userId: "other" });
    expect(response.status).toBe(200);
    expect(mocks.profile).toHaveBeenCalledWith({ where: { userId: "coach" }, select: { id: true } });
    expect(mocks.update).toHaveBeenCalledWith({ where: { id: "profile" }, data: { analysisCreditPriceCents: price },
      select: { analysisCreditPriceCents: true } });
  });
  it("rejects a stale coach tab after switching sessions before touching any profile", async () => {
    mocks.auth.mockResolvedValue({ ok: true, user: { id: "other-coach" } });
    const response = await patch({ analysisCreditPriceCents: 750, expectedCoachId: "coach" });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "session-changed" });
    expect(mocks.profile).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it.each([{ analysisCreditPriceCents: 750 }, { analysisCreditPriceCents: 0, expectedCoachId: "coach" },
    { analysisCreditPriceCents: -1, expectedCoachId: "coach" }, { analysisCreditPriceCents: 1.5, expectedCoachId: "coach" }])
    ("rejects invalid price/draft input", async (body) => {
      expect((await patch(body)).status).toBe(400);
      expect(mocks.profile).not.toHaveBeenCalled();
      expect(mocks.update).not.toHaveBeenCalled();
    });
  it("does not process unauthenticated requests", async () => {
    mocks.auth.mockResolvedValue({ ok: false, response: new Response(null, { status: 401 }) });
    expect((await patch({ analysisCreditPriceCents: 750, expectedCoachId: "coach" })).status).toBe(401);
    expect(mocks.profile).not.toHaveBeenCalled();
  });
});
