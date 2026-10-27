import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ActiveUser } from "../auth/require-user";
const mock = vi.hoisted(() => ({ video: vi.fn(), resolve: vi.fn() }));
vi.mock("./coach-feedback", () => ({ getCoachFeedbackVideo: mock.video }));
vi.mock("../storage", () => ({ resolveKey: mock.resolve }));
import { reviewVideoRange, streamCoachFeedbackVideo } from "./coach-feedback-media";
const user = { id: "coach" } as ActiveUser;
let directory: string;
beforeEach(async () => {
  vi.resetAllMocks();
  directory = await mkdtemp(path.join(os.tmpdir(), "ski-review-media-test-"));
  const file = path.join(directory, "clip.mp4");
  await writeFile(file, "0123456789");
  mock.resolve.mockReturnValue(file);
  mock.video.mockResolvedValue({ storageKey: "private/clip", contentType: "video/mp4", bytes: 10 });
});
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

describe("private human-review media", () => {
  it.each(["bytes=0-2", "bytes=2-", "bytes=-3"])("supports one valid range: %s", async (range) => {
    const response = await streamCoachFeedbackVideo(new Request("http://local/video", { headers: { range } }), "review", user);
    expect(response.status).toBe(206);
    expect(response.headers.get("Accept-Ranges")).toBe("bytes");
    expect(await response.text()).toBe(range === "bytes=0-2" ? "012" : range === "bytes=2-" ? "23456789" : "789");
    expect(mock.video.mock.calls).toEqual([["review", user], ["review", user, true]]);
  });
  it.each(["bytes=10-", "bytes=7-2", "bytes=-0", "bytes=0-1,3-4", "bytes=x-2"])("rejects an invalid range without counting viewing: %s", async (range) => {
    const response = await streamCoachFeedbackVideo(new Request("http://local/video", { headers: { range } }), "review", user);
    expect(response.status).toBe(416);
    expect(response.headers.get("Content-Range")).toBe("bytes */10");
    expect(mock.video).toHaveBeenCalledTimes(1);
  });
  it("HEAD verifies access but neither reads video bytes nor counts viewing", async () => {
    const response = await streamCoachFeedbackVideo(new Request("http://local/video", { method: "HEAD" }), "review", user);
    expect(response.headers.get("Content-Length")).toBe("10");
    expect(await response.text()).toBe("");
    expect(mock.video).toHaveBeenCalledTimes(1);
  });
  it("checks authorization before parsing Range and rejects newly withdrawn access", async () => {
    mock.video.mockRejectedValueOnce(new Error("permission denied"));
    await expect(streamCoachFeedbackVideo(new Request("http://local/video", { headers: { range: "bytes=0-1" } }), "review", user)).rejects.toThrow("permission denied");
    expect(mock.resolve).not.toHaveBeenCalled();
    mock.video.mockResolvedValueOnce({ storageKey: "private/clip", contentType: "video/mp4", bytes: 10 }).mockRejectedValueOnce(new Error("revoked"));
    await expect(streamCoachFeedbackVideo(new Request("http://local/video"), "review", user)).rejects.toThrow("revoked");
  });
  it("a replaced or missing source cannot be streamed", async () => {
    mock.video.mockResolvedValue({ storageKey: "private/clip", contentType: "video/mp4", bytes: 12 });
    await expect(streamCoachFeedbackVideo(new Request("http://local/video"), "review", user)).rejects.toMatchObject({ reason: "video-not-found" });
    expect(mock.video).toHaveBeenCalledTimes(1);
  });
  it("range arithmetic caps EOF and refuses unsafe integer offsets", () => {
    expect(reviewVideoRange("bytes=2-100", 10)).toEqual({ start: 2, end: 9 });
    expect(reviewVideoRange("bytes=999999999999999999999-", 10)).toBeNull();
  });
});
