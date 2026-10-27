import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { DELETE, GET } from "./route";
import { __resetRateLimits } from "@/lib/rate-limit";

const mocks = vi.hoisted(() => ({
  user: vi.fn(), video: vi.fn(), pending: vi.fn(), clearResult: vi.fn(), removeVideo: vi.fn(), removeJob: vi.fn(),
  lock: vi.fn(), recover: vi.fn(), read: vi.fn(), deleteFile: vi.fn(),
}));
vi.mock("@/lib/auth/require-user", () => ({ requireUser: mocks.user }));
vi.mock("@/lib/prisma", () => ({ prisma: { accountAnalysisVideo: { findFirst: mocks.video } } }));
vi.mock("@/lib/video-analysis/account-service", () => ({ lockedAccount: mocks.lock, recoverExpiredAccountAnalysisJobs: mocks.recover }));
vi.mock("@/lib/storage", () => ({ readObject: mocks.read, deleteObject: mocks.deleteFile }));

const context = () => ({ params: Promise.resolve({ videoId: "video-private" }) });
const request = (method = "GET", origin = "http://localhost") => new Request("http://localhost/api/video-analysis/videos/video-private", { method, headers: { origin } });

beforeEach(() => {
  vi.clearAllMocks();
  __resetRateLimits();
  vi.stubEnv("AUTH_URL", "http://localhost");
  vi.stubEnv("NEXT_PUBLIC_BASE_URL", "http://localhost");
  mocks.user.mockResolvedValue({ ok: true, user: { id: "student", role: "CUSTOMER" } });
  mocks.video.mockResolvedValue({ id: "video-private", accountId: "student", storageKey: "account-videos/student/private.mp4", contentType: "video/mp4" });
  mocks.pending.mockResolvedValue(0);
  mocks.recover.mockResolvedValue(0);
  mocks.clearResult.mockResolvedValue({ count: 1 });
  mocks.removeVideo.mockResolvedValue({ id: "video-private" });
  mocks.read.mockResolvedValue(Buffer.from([1, 2, 3]));
  mocks.deleteFile.mockResolvedValue(undefined);
  mocks.lock.mockImplementation((_accountId: string, callback: (tx: unknown) => Promise<unknown>) => callback({
    accountAnalysisVideo: { findFirst: mocks.video, delete: mocks.removeVideo },
    accountAnalysisJob: { count: mocks.pending, updateMany: mocks.clearResult, deleteMany: mocks.removeJob },
  }));
});
afterEach(() => vi.unstubAllEnvs());

describe("account-private FreeSki clips and credit ledger", () => {
  it("does not grant the issuing coach access to a student's personal clip", async () => {
    mocks.user.mockResolvedValue({ ok: true, user: { id: "issuing-coach", role: "COACH" } });
    mocks.video.mockResolvedValue(null);
    const response = await GET(request(), context());
    expect(response.status).toBe(404);
    expect(mocks.video).toHaveBeenCalledWith({ where: { id: "video-private", accountId: "issuing-coach" } });
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it("does not grant an administrator implicit access to personal clips", async () => {
    mocks.user.mockResolvedValue({ ok: true, user: { id: "admin", role: "ADMIN" } });
    mocks.video.mockResolvedValue(null);
    expect((await GET(request(), context())).status).toBe(404);
    expect(mocks.video).toHaveBeenCalledWith({ where: { id: "video-private", accountId: "admin" } });
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it("serves the owner's clip as a private no-store video with nosniff", async () => {
    const response = await GET(request(), context());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("content-type")).toBe("video/mp4");
    expect(response.headers.get("content-disposition")).toBe("inline");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    expect(mocks.read).toHaveBeenCalledWith("account-videos/student/private.mp4");
  });

  it("rejects cross-origin deletion before authentication or transaction access", async () => {
    const response = await DELETE(request("DELETE", "https://attacker.example"), context());
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "untrusted-origin" });
    expect(mocks.user).not.toHaveBeenCalled();
    expect(mocks.lock).not.toHaveBeenCalled();
    expect(mocks.deleteFile).not.toHaveBeenCalled();
  });

  it("cannot delete another account's video", async () => {
    mocks.video.mockResolvedValue(null);
    expect((await DELETE(request("DELETE"), context())).status).toBe(404);
    expect(mocks.video).toHaveBeenCalledWith({ where: { id: "video-private", accountId: "student" } });
    expect(mocks.removeVideo).not.toHaveBeenCalled();
    expect(mocks.clearResult).not.toHaveBeenCalled();
    expect(mocks.deleteFile).not.toHaveBeenCalled();
  });

  it("blocks deletion while a queued or running analysis still owns the video", async () => {
    mocks.pending.mockResolvedValue(1);
    const response = await DELETE(request("DELETE"), context());
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "analysis-in-progress" });
    expect(mocks.pending).toHaveBeenCalledWith({ where: { videoId: "video-private", status: { in: ["QUEUED", "RUNNING"] } } });
    expect(mocks.clearResult).not.toHaveBeenCalled();
    expect(mocks.removeVideo).not.toHaveBeenCalled();
    expect(mocks.deleteFile).not.toHaveBeenCalled();
  });

  it("erases reports and the clip while retaining consumed-credit ledger rows", async () => {
    const response = await DELETE(request("DELETE"), context());
    expect(response.status).toBe(200);
    expect(mocks.lock).toHaveBeenCalledWith("student", expect.any(Function));
    expect(mocks.clearResult).toHaveBeenCalledWith({ where: { videoId: "video-private" }, data: { result: Prisma.DbNull } });
    expect(mocks.removeVideo).toHaveBeenCalledWith({ where: { id: "video-private" } });
    expect(mocks.removeJob).not.toHaveBeenCalled();
    expect(mocks.deleteFile).toHaveBeenCalledWith("account-videos/student/private.mp4");
  });

  it("recovers expired jobs for this account before checking pending reservations", async () => {
    let recovered = false;
    mocks.recover.mockImplementation(async () => { recovered = true; return 1; });
    mocks.pending.mockImplementation(async () => recovered ? 0 : 1);
    expect((await DELETE(request("DELETE"), context())).status).toBe(200);
    expect(mocks.recover).toHaveBeenCalledWith(["student"]);
    expect(mocks.recover.mock.invocationCallOrder[0]).toBeLessThan(mocks.lock.mock.invocationCallOrder[0]);
    expect(mocks.removeVideo).toHaveBeenCalledOnce();
    expect(mocks.removeJob).not.toHaveBeenCalled();
  });

  it("does not remove the private file if the transaction fails", async () => {
    mocks.removeVideo.mockRejectedValue(new Error("database unavailable"));
    await expect(DELETE(request("DELETE"), context())).rejects.toThrow("database unavailable");
    expect(mocks.removeJob).not.toHaveBeenCalled();
    expect(mocks.deleteFile).not.toHaveBeenCalled();
  });
});
