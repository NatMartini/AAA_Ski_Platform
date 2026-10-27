import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";
import { DELETE, GET } from "./[videoId]/route";

const mocks = vi.hoisted(() => ({
  user: vi.fn(), booking: vi.fn(), current: vi.fn(), count: vi.fn(), create: vi.fn(),
  video: vi.fn(), remove: vi.fn(), pending: vi.fn(), clearResult: vi.fn(), lock: vi.fn(),
  write: vi.fn(), deleteFile: vi.fn(), read: vi.fn(),
}));
vi.mock("@/lib/auth/require-user", () => ({ requireUser: mocks.user }));
vi.mock("@/lib/rate-limit", () => ({ rateLimitOrRespond: () => null }));
vi.mock("@/lib/booking/access", async (original) => ({
  ...await original<typeof import("@/lib/booking/access")>(), loadBooking: mocks.booking,
}));
vi.mock("@/lib/prisma", () => {
  const tx = {
    $queryRaw: mocks.lock,
    booking: { findUnique: mocks.current },
    lessonVideo: { count: mocks.count, create: mocks.create, findFirst: mocks.video, delete: mocks.remove },
    videoAnalysisJob: { count: mocks.pending, updateMany: mocks.clearResult },
  };
  return { prisma: { ...tx, $transaction: (run: (db: typeof tx) => Promise<unknown>) => run(tx) } };
});
vi.mock("@/lib/storage", () => ({
  buildKey: () => "videos/booking/clip.mp4", KEY_PREFIX: { video: (id: string) => `videos/${id}` },
  writeObject: mocks.write, deleteObject: mocks.deleteFile, readObject: mocks.read,
}));

const ctx = { params: Promise.resolve({ code: "LESSON" }) };
const videoCtx = { params: Promise.resolve({ code: "LESSON", videoId: "video" }) };
const req = () => new Request("http://localhost/api/bookings/LESSON/videos/video", { method: "DELETE" });
function upload() {
  const bytes = new Uint8Array(24);
  bytes.set(new TextEncoder().encode("ftypisom"), 4);
  const form = new FormData();
  form.set("file", new File([bytes], "lesson.mp4", { type: "video/mp4" }));
  form.set("caption", "  My turn  ");
  return new Request("http://localhost/api/bookings/LESSON/videos", { method: "POST", body: form });
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.mockResolvedValue({ ok: true, user: { id: "student", role: "CUSTOMER" } });
  const booking = { id: "booking", code: "LESSON", accountId: "student", coachId: "coach", status: "COMPLETED" };
  mocks.booking.mockResolvedValue(booking);
  mocks.current.mockResolvedValue(booking);
  mocks.count.mockResolvedValue(0);
  mocks.write.mockResolvedValue({ key: "videos/booking/clip.mp4", bytes: 24 });
  mocks.deleteFile.mockResolvedValue(undefined);
  mocks.create.mockResolvedValue({ id: "video" });
  mocks.video.mockResolvedValue({ id: "video", bookingId: "booking", uploadedById: "student", storageKey: "videos/booking/clip.mp4", contentType: "video/mp4" });
  mocks.pending.mockResolvedValue(0);
  mocks.clearResult.mockResolvedValue({ count: 1 });
  mocks.remove.mockResolvedValue({ id: "video" });
});

describe("private lesson videos", () => {
  it("lets the purchaser upload without consuming analysis credits", async () => {
    expect((await POST(upload(), ctx)).status).toBe(201);
    expect(mocks.create.mock.calls[0][0].data).toMatchObject({ uploadedById: "student", caption: "My turn" });
    expect(mocks.pending).not.toHaveBeenCalled();
  });
  it("blocks non-parties before reading their upload", async () => {
    mocks.user.mockResolvedValue({ ok: true, user: { id: "guest", role: "CUSTOMER" } });
    expect((await POST(upload(), ctx)).status).toBe(403);
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it("does not allow a different coach to mutate this order", async () => {
    mocks.user.mockResolvedValue({ ok: true, user: { id: "other", role: "COACH" } });
    expect((await POST(upload(), ctx)).status).toBe(403);
  });
  it("cleans up the upload if capacity was reached under the booking lock", async () => {
    mocks.count.mockResolvedValue(100);
    expect((await POST(upload(), ctx)).status).toBe(409);
    expect(mocks.lock).toHaveBeenCalledOnce();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.deleteFile).toHaveBeenCalledWith("videos/booking/clip.mp4");
  });
  it("cleans up the file on database failure", async () => {
    mocks.create.mockRejectedValue(new Error("database unavailable"));
    await expect(POST(upload(), ctx)).rejects.toThrow("database unavailable");
    expect(mocks.deleteFile).toHaveBeenCalledOnce();
  });
  it("checks cancellation again after buffering the file", async () => {
    mocks.current.mockResolvedValue({ accountId: "student", status: "CANCELLED" });
    expect((await POST(upload(), ctx)).status).toBe(409);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.deleteFile).toHaveBeenCalledOnce();
  });
  it("lets a student delete their own successful video while retaining usage", async () => {
    expect((await DELETE(req(), videoCtx)).status).toBe(200);
    expect(mocks.clearResult).toHaveBeenCalledOnce();
    expect(mocks.remove).toHaveBeenCalledOnce();
    expect(mocks.deleteFile).toHaveBeenCalledOnce();
  });
  it("cannot remove another uploader's clip", async () => {
    mocks.video.mockResolvedValue({ id: "video", uploadedById: "coach" });
    expect((await DELETE(req(), videoCtx)).status).toBe(403);
    expect(mocks.remove).not.toHaveBeenCalled();
  });
  it.each(["QUEUED", "RUNNING"])("protects a video with %s analysis from deletion", async () => {
    mocks.pending.mockResolvedValue(1);
    expect((await DELETE(req(), videoCtx)).status).toBe(409);
    expect(mocks.clearResult).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(mocks.deleteFile).not.toHaveBeenCalled();
  });
  it("does not serve a private video to another student", async () => {
    mocks.user.mockResolvedValue({ ok: true, user: { id: "other-student", role: "CUSTOMER" } });
    expect((await GET(new Request("http://localhost"), videoCtx)).status).toBe(403);
    expect(mocks.read).not.toHaveBeenCalled();
  });
});
