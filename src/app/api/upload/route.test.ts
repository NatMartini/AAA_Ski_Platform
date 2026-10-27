import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const mocks = vi.hoisted(() => ({ user: vi.fn(), booking: vi.fn(), update: vi.fn(), write: vi.fn(), process: vi.fn() }));
vi.mock("@/lib/auth/require-user", () => ({ requireUser: mocks.user }));
vi.mock("@/lib/rate-limit", () => ({ rateLimitOrRespond: () => null }));
vi.mock("@/lib/prisma", () => ({ prisma: { booking: { findUnique: mocks.booking }, coachProfile: { update: mocks.update } } }));
vi.mock("@/lib/storage", () => ({
  buildKey: (prefix: string) => `${prefix}/image.webp`, KEY_PREFIX: { qr: (id: string) => `qr/${id}`, avatar: (id: string) => `avatar/${id}`, proof: (id: string) => `proof/${id}` },
  writeObject: mocks.write,
}));
vi.mock("@/lib/upload/image", async (original) => ({ ...await original<typeof import("@/lib/upload/image")>(), processUpload: mocks.process }));

function upload(purpose: string, expectedCoachId?: string) {
  const form = new FormData();
  form.set("file", new File([new Uint8Array(16)], "image.png", { type: "image/png" }));
  form.set("purpose", purpose);
  form.set("bookingCode", "LESSON");
  if (expectedCoachId) form.set("expectedCoachId", expectedCoachId);
  return new Request("http://localhost:3000/api/upload", { method: "POST", body: form });
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.mockResolvedValue({ ok: true, user: { id: "alisa", role: "COACH" } });
  mocks.process.mockResolvedValue({ buffer: Buffer.from("private-image"), extension: "webp", width: 1, height: 1 });
  mocks.write.mockImplementation(async (key: string) => ({ key, bytes: 13 }));
  mocks.update.mockResolvedValue({});
  mocks.booking.mockResolvedValue({ id: "lesson", accountId: "student", coachId: "kevin", status: "AWAITING_PAYMENT", holdExpiresAt: new Date(Date.now() + 600_000) });
});

describe("coach upload identity and current permissions", () => {
  it.each(["coach-avatar", "payment-qr"])("rejects another account's stale %s draft before image processing or storage", async (purpose) => {
    const response = await POST(upload(purpose, "kevin"));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "session-changed" });
    expect(mocks.process).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("requires an expected identity rather than selecting a profile from client input", async () => {
    expect((await POST(upload("coach-avatar"))).status).toBe(400);
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("writes a matched draft to the authenticated coach only", async () => {
    expect((await POST(upload("coach-avatar", "alisa"))).status).toBe(201);
    expect(mocks.update).toHaveBeenCalledWith({ where: { userId: "alisa" }, data: { avatarKey: "avatar/alisa/image.webp", avatarUrl: "/api/files/avatar/alisa" } });
  });
  it("rejects a demoted instructor's payment-proof upload", async () => {
    mocks.user.mockResolvedValue({ ok: true, user: { id: "kevin", role: "CUSTOMER" } });
    expect((await POST(upload("payment-proof"))).status).toBe(403);
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it("retains the actual purchaser's upload right", async () => {
    mocks.user.mockResolvedValue({ ok: true, user: { id: "student", role: "CUSTOMER" } });
    expect((await POST(upload("payment-proof"))).status).toBe(201);
  });
});
