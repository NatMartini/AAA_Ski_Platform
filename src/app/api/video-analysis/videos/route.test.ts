import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";
import { readLimitedFormData } from "@/lib/request-body";
import { __resetRateLimits } from "@/lib/rate-limit";
import { AnalysisDomainError } from "@/lib/video-analysis/quota";

const mocks = vi.hoisted(() => ({
  user: vi.fn(), grantCount: vi.fn(), lockedGrantCount: vi.fn(), videoCount: vi.fn(), create: vi.fn(),
  write: vi.fn(), deleteFile: vi.fn(), lock: vi.fn(),
}));
vi.mock("@/lib/auth/require-user", () => ({ requireUser: mocks.user }));
vi.mock("@/lib/prisma", () => ({ prisma: { accountAnalysisGrant: { count: mocks.grantCount } } }));
vi.mock("@/lib/video-analysis/account-service", () => ({ lockedAccount: mocks.lock }));
vi.mock("@/lib/request-body", async (original) => {
  const actual = await original<typeof import("@/lib/request-body")>();
  return { ...actual, readLimitedFormData: vi.fn(actual.readLimitedFormData) };
});
vi.mock("@/lib/storage", () => ({
  KEY_PREFIX: { accountVideo: (id: string) => `account-videos/${id}` },
  buildKey: (prefix: string, extension: string) => `${prefix}/clip.${extension}`,
  writeObject: mocks.write, deleteObject: mocks.deleteFile,
}));

function upload(expectedAccountId = "student", origin = "http://localhost", bytes?: Uint8Array) {
  const data = bytes ?? new Uint8Array(24);
  if (!bytes) data.set(new TextEncoder().encode("ftypisom"), 4);
  const form = new FormData();
  form.set("expectedAccountId", expectedAccountId);
  form.set("file", new File([data as Uint8Array<ArrayBuffer>], "clip.mp4", { type: "video/mp4" }));
  form.set("caption", "  practice turn  ");
  return new Request("http://localhost/api/video-analysis/videos", { method: "POST", body: form, headers: { origin } });
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetRateLimits();
  vi.stubEnv("AUTH_URL", "http://localhost");
  vi.stubEnv("NEXT_PUBLIC_BASE_URL", "http://localhost");
  mocks.user.mockResolvedValue({ ok: true, user: { id: "student", role: "CUSTOMER" } });
  mocks.grantCount.mockResolvedValue(1);
  mocks.lockedGrantCount.mockResolvedValue(1);
  mocks.videoCount.mockResolvedValue(0);
  mocks.write.mockResolvedValue({ key: "account-videos/student/clip.mp4", bytes: 24 });
  mocks.deleteFile.mockResolvedValue(undefined);
  mocks.create.mockResolvedValue({ id: "video", caption: "practice turn", bytes: 24, uploadedAt: new Date("2026-10-08T16:00:00Z") });
  mocks.lock.mockImplementation((_accountId: string, callback: (tx: unknown) => Promise<unknown>) => callback({
    accountAnalysisGrant: { count: mocks.lockedGrantCount },
    accountAnalysisVideo: { count: mocks.videoCount, create: mocks.create },
  }));
});
afterEach(() => vi.unstubAllEnvs());

describe("private account FreeSki upload boundary", () => {
  it("rejects a cross-origin upload before authentication, buffering, or storage", async () => {
    const request = upload("student", "https://attacker.example");
    const response = await POST(request);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "untrusted-origin" });
    expect(mocks.user).not.toHaveBeenCalled();
    expect(readLimitedFormData).not.toHaveBeenCalled();
    expect(request.bodyUsed).toBe(false);
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it("requires issued credits before reading any multipart body", async () => {
    mocks.grantCount.mockResolvedValue(0);
    const response = await POST(upload());
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "quota-not-granted" });
    expect(readLimitedFormData).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("does not write an old account's pending upload after the login changes", async () => {
    const response = await POST(upload("previous-student"));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "state-changed" });
    expect(mocks.write).not.toHaveBeenCalled();
    expect(mocks.lock).not.toHaveBeenCalled();
  });

  it("stores only the authenticated account and returns no storage path", async () => {
    const response = await POST(upload());
    expect(response.status).toBe(201);
    expect(mocks.lock).toHaveBeenCalledWith("student", expect.any(Function));
    expect(mocks.create.mock.calls[0][0].data).toEqual({ accountId: "student", uploadedById: "student", storageKey: "account-videos/student/clip.mp4", contentType: "video/mp4", bytes: 24, caption: "practice turn" });
    expect(await response.json()).toEqual({ id: "video", caption: "practice turn", bytes: 24, uploadedAt: "2026-10-08T16:00:00.000Z" });
  });

  it("rejects an HTML payload labelled as MP4 before writing it", async () => {
    const response = await POST(upload("student", "http://localhost", new TextEncoder().encode("<script>unsafe payload</script>")));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "bad-content" });
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it("cleans its staged file when capacity is reached under the account lock", async () => {
    mocks.videoCount.mockResolvedValue(100);
    const response = await POST(upload());
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "too-many" });
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.deleteFile).toHaveBeenCalledWith("account-videos/student/clip.mp4");
  });

  it("cleans its staged file if the account is disabled during buffering", async () => {
    mocks.lock.mockRejectedValue(new AnalysisDomainError("forbidden"));
    const response = await POST(upload());
    expect(response.status).toBe(403);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.deleteFile).toHaveBeenCalledWith("account-videos/student/clip.mp4");
  });

  it("does not leave a staged private file after a database failure", async () => {
    mocks.create.mockRejectedValue(new Error("database unavailable"));
    await expect(POST(upload())).rejects.toThrow("database unavailable");
    expect(mocks.deleteFile).toHaveBeenCalledWith("account-videos/student/clip.mp4");
  });
});
