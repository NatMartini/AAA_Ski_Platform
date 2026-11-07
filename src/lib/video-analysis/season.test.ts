import { beforeEach, describe, expect, it, vi } from "vitest";
import { expiredBefore, seasonLastDay, videoKeptUntil } from "./season";

const mocks = vi.hoisted(() => ({ accountFind: vi.fn(), accountDelete: vi.fn(), lessonFind: vi.fn(), lessonDelete: vi.fn(), remove: vi.fn() }));
vi.mock("../prisma", () => ({ prisma: { accountAnalysisVideo: { findMany: mocks.accountFind, deleteMany: mocks.accountDelete },
  lessonVideo: { findMany: mocks.lessonFind, deleteMany: mocks.lessonDelete } } }));
vi.mock("../storage", () => ({ deleteObject: mocks.remove }));
import { purgeExpiredVideos } from "./retention";

describe("one ski season of footage", () => {
  it("keeps a video until the May 31 that ends its season, Toronto time", () => {
    expect(seasonLastDay(new Date("2026-12-20T15:00:00Z"))).toBe("2027-05-31");
    expect(seasonLastDay(new Date("2027-03-01T15:00:00Z"))).toBe("2027-05-31");
    // A summer clip belongs to the season ahead.
    expect(seasonLastDay(new Date("2026-07-15T15:00:00Z"))).toBe("2027-05-31");
    // 03:00 UTC on June 1 is still May 31 in Toronto.
    expect(seasonLastDay(new Date("2027-06-01T03:00:00Z"))).toBe("2027-05-31");
    expect(seasonLastDay(new Date("2027-06-01T05:00:00Z"))).toBe("2028-05-31");
    expect(videoKeptUntil(new Date("2027-01-10T15:00:00Z")).toISOString()).toBe("2027-06-01T04:00:00.000Z");
  });

  it("treats everything uploaded before the last June 1 as a season that has ended", () => {
    expect(expiredBefore(new Date("2026-11-07T15:00:00Z")).toISOString()).toBe("2026-06-01T04:00:00.000Z");
    expect(expiredBefore(new Date("2027-05-31T15:00:00Z")).toISOString()).toBe("2026-06-01T04:00:00.000Z");
    expect(expiredBefore(new Date("2027-06-01T04:00:00Z")).toISOString()).toBe("2027-06-01T04:00:00.000Z");
  });
});

describe("clearing past seasons", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.accountFind.mockResolvedValue([{ id: "a1", storageKey: "private/a1.mp4" }, { id: "a2", storageKey: "private/a2.mp4" }]);
    mocks.lessonFind.mockResolvedValue([{ id: "l1", storageKey: "private/l1.mp4" }]);
    // a2 got an analysis queued between the list and the delete, so it stays.
    mocks.accountDelete.mockImplementation(async ({ where }) => ({ count: where.id === "a2" ? 0 : 1 }));
    mocks.lessonDelete.mockResolvedValue({ count: 1 });
    mocks.remove.mockResolvedValue(undefined);
  });

  it("deletes ended seasons' idle videos and their files, keeping any being analysed", async () => {
    const now = new Date("2026-11-07T15:00:00Z");
    expect(await purgeExpiredVideos({}, now)).toBe(2);
    const idle = { uploadedAt: { lt: new Date("2026-06-01T04:00:00.000Z") }, analysisJobs: { none: { status: { in: ["QUEUED", "RUNNING"] } } } };
    expect(mocks.accountFind).toHaveBeenCalledWith({ where: idle, select: { id: true, storageKey: true } });
    expect(mocks.accountDelete).toHaveBeenCalledWith({ where: { id: "a2", ...idle } });
    expect(mocks.remove.mock.calls.map(([key]) => key)).toEqual(["private/a1.mp4", "private/l1.mp4"]);
  });

  it("clears only one account's videos, or one lesson's", async () => {
    await purgeExpiredVideos({ accountId: "student" }, new Date("2026-11-07T15:00:00Z"));
    expect(mocks.accountFind).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ accountId: "student" }) }));
    expect(mocks.lessonFind).not.toHaveBeenCalled();
    vi.clearAllMocks();
    mocks.lessonFind.mockResolvedValue([]);
    await purgeExpiredVideos({ bookingCode: "SKI-1" }, new Date("2026-11-07T15:00:00Z"));
    expect(mocks.accountFind).not.toHaveBeenCalled();
    expect(mocks.lessonFind).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ booking: { code: "SKI-1" } }) }));
  });
});
