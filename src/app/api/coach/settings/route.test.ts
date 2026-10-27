import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(), profile: vi.fn(), update: vi.fn(), transaction: vi.fn(), rateDelete: vi.fn(), rateUpsert: vi.fn(),
}));
vi.mock("@/lib/auth/require-user", () => ({ requireCoach: mocks.auth }));
vi.mock("@/lib/rate-limit", () => ({ rateLimitOrRespond: () => null }));
vi.mock("@/lib/prisma", () => ({ prisma: {
  coachProfile: { findUnique: mocks.profile, update: mocks.update },
  coachRate: { deleteMany: mocks.rateDelete, upsert: mocks.rateUpsert },
  $transaction: mocks.transaction,
} }));
import { PATCH } from "./route";

const focusId = "32fe21ac-0762-40ed-a7cc-90882b0fd6a2";
const focus = { id: focusId, key: `custom:${focusId}`, zh: "单脚控板", en: "" };
const settings = {
  expectedCoachId: "own-coach",
  displayName: "Coach", rates: [{ lessonType: "riding", regularCents: 8000, earlyBirdCents: null }],
  extraPersonCents: 2000, maxGroupSize: 3, csiaLevel: null, csiaParkLevel: null,
  teachableSkills: [], teachableLevels: [], minHours: 2, maxHours: 8, leadTimeHours: 24,
  emtEnabled: true, emtEmail: "coach@example.com", wechatPayEnabled: false, alipayEnabled: false,
  cancellationPolicyZh: "政策", cancellationPolicyEn: "Policy", isPublished: true,
};
function request(body: unknown) {
  return new Request("http://localhost/api/coach/settings", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue({ ok: true, user: { id: "own-coach" } });
  mocks.profile.mockResolvedValue({ id: "own-profile" });
  mocks.update.mockResolvedValue({});
  mocks.transaction.mockResolvedValue([]);
});
describe("coach custom focus settings privacy and preservation", () => {
  it("updates only the authenticated coach's catalogue and retains optional English as blank", async () => {
    const response = await PATCH(request({ ...settings, coachId: "other-coach", customSkills: [focus] }));
    expect(response.status).toBe(200);
    expect(mocks.profile).toHaveBeenCalledWith({ where: { userId: "own-coach" }, select: { id: true } });
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "own-profile" }, data: expect.objectContaining({
      customSkills: [focus],
    }) }));
  });
  it("preserves existing custom skills when an older client omits the new field", async () => {
    expect((await PATCH(request(settings))).status).toBe(200);
    expect(mocks.update.mock.calls[0][0].data).not.toHaveProperty("customSkills");
  });
  it("removes offerings only through an explicit empty catalogue", async () => {
    expect((await PATCH(request({ ...settings, customSkills: [] }))).status).toBe(200);
    expect(mocks.update.mock.calls[0][0].data.customSkills).toEqual([]);
  });
  it("rejects malformed identities before touching any profile or rates", async () => {
    const response = await PATCH(request({ ...settings, customSkills: [{ ...focus, key: "custom:forged" }] }));
    expect(response.status).toBe(400);
    expect(mocks.profile).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it("does not inspect or mutate catalogues for an unauthorized request", async () => {
    mocks.auth.mockResolvedValue({ ok: false, response: new Response(null, { status: 401 }) });
    expect((await PATCH(request({ ...settings, customSkills: [focus] }))).status).toBe(401);
    expect(mocks.profile).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("rejects an old tab's draft after switching to a different coach session", async () => {
    mocks.auth.mockResolvedValue({ ok: true, user: { id: "another-coach" } });
    const response = await PATCH(request(settings));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "session-changed" });
    expect(mocks.profile).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.rateDelete).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it("does not accept a missing draft identity", async () => {
    expect((await PATCH(request({ ...settings, expectedCoachId: undefined }))).status).toBe(400);
    expect(mocks.profile).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
