import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActiveUser } from "../auth/require-user";

const mocks = vi.hoisted(() => ({ booking: vi.fn(), account: vi.fn(), request: vi.fn(), list: vi.fn(), upsert: vi.fn(), remove: vi.fn() }));
vi.mock("../prisma", () => ({ prisma: {
  videoAnalysisJob: { findFirst: mocks.booking }, accountAnalysisJob: { findFirst: mocks.account },
  coachVideoReviewRequest: { findFirst: mocks.request },
  analysisFindingReview: { findMany: mocks.list, upsert: mocks.upsert, deleteMany: mocks.remove },
} }));
vi.mock("../request-origin", () => ({ isTrustedApiWrite: () => true }));
import { handleFindingReviews, listCoachFindingReviews, loadReviewableJob, saveFindingReview } from "./finding-reviews";
import { findingKey } from "./finding-key";

const student = { id: "student", role: "CUSTOMER" } as ActiveUser;
const coach = { id: "coach", role: "COACH" } as ActiveUser;
const other = { id: "other", role: "COACH" } as ActiveUser;
const key = findingKey("improvement", "第4弯的收弯完成度只有 33.4 分。");
const review = (coachId: string, verdict: "AGREE" | "DISAGREE" = "AGREE") => ({ findingKey: key, verdict, note: null, metricKeys: ["turn_closure"],
  coachId, updatedAt: new Date("2026-10-29T10:00:00Z"), coach: { id: coachId, name: "Kevin", coachProfile: { displayName: "Kevin L" } } });

beforeEach(() => {
  vi.resetAllMocks();
  mocks.list.mockResolvedValue([]);
  mocks.upsert.mockResolvedValue({});
  mocks.remove.mockResolvedValue({ count: 1 });
});

describe("who may review findings", () => {
  it("lets the lesson's coach write and its student only read", async () => {
    mocks.booking.mockImplementation(async ({ where }) => ({ id: "job", actionId: "certification:level2:short_turn", booking: { accountId: "student", coachId: "coach" }, where }));
    expect((await loadReviewableJob("booking", "job", coach)).viewer).toBe("coach");
    expect((await loadReviewableJob("booking", "job", student)).viewer).toBe("owner");
    await expect(saveFindingReview("booking", "job", student, { findingKey: key, verdict: "AGREE", metricKeys: [] })).rejects.toMatchObject({ status: 403 });
  });

  it("reaches a personal clip only through the student's live review authorization", async () => {
    mocks.account.mockResolvedValue({ id: "job", actionId: "improvement:level1:parallel", accountId: "student", videoId: "v1" });
    mocks.request.mockResolvedValueOnce({ id: "request" }).mockResolvedValueOnce(null);
    expect((await loadReviewableJob("account", "job", coach)).viewer).toBe("coach");
    expect(mocks.request).toHaveBeenLastCalledWith(expect.objectContaining({ where: expect.objectContaining({ coachId: "coach", accountId: "student", sourceVideoId: "v1" }) }));
    await expect(loadReviewableJob("account", "job", other)).rejects.toMatchObject({ status: 404 });
    expect((await loadReviewableJob("account", "job", student)).viewer).toBe("owner");
  });

  it("only looks at finished, unrefunded analyses and rejects odd ids", async () => {
    mocks.booking.mockResolvedValue(null);
    await expect(loadReviewableJob("booking", "missing", coach)).rejects.toMatchObject({ status: 404 });
    expect(mocks.booking).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ status: "SUCCEEDED", refundedAt: null }) }));
    await expect(loadReviewableJob("booking", "../x", coach)).rejects.toMatchObject({ status: 404 });
    await expect(loadReviewableJob("elsewhere", "job", coach)).rejects.toMatchObject({ status: 404 });
  });
});

describe("verdicts", () => {
  beforeEach(() => {
    mocks.booking.mockResolvedValue({ id: "job", actionId: "certification:level2:short_turn", booking: { accountId: "student", coachId: "coach" } });
  });

  it("stores one verdict per coach and finding, carrying the action and metrics for calibration", async () => {
    mocks.list.mockResolvedValue([review("coach", "DISAGREE")]);
    const result = await saveFindingReview("booking", "job", coach, { findingKey: key, verdict: "DISAGREE", note: "镜头太远", metricKeys: ["turn_closure"] });
    expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { scope_jobId_findingKey_coachId: { scope: "LESSON", jobId: "job", findingKey: key, coachId: "coach" } },
      create: expect.objectContaining({ verdict: "DISAGREE", note: "镜头太远", actionId: "certification:level2:short_turn", metricKeys: ["turn_closure"] }),
    }));
    expect(result).toMatchObject({ canReview: true, reviews: [{ findingKey: key, verdict: "DISAGREE", coachName: "Kevin L", mine: true }] });
  });

  it("shows the student the coach's verdict without letting them change it", async () => {
    mocks.list.mockResolvedValue([review("coach")]);
    const request = new Request("http://localhost/api", { method: "GET" });
    const body = await (await handleFindingReviews({ scope: "booking", jobId: "job", resource: ["finding-reviews"], user: student, request })).json();
    expect(body).toMatchObject({ canReview: false, reviews: [{ verdict: "AGREE", mine: false }] });
    expect(JSON.stringify(body)).not.toContain('"coachId"');
    const write = new Request("http://localhost/api", { method: "POST", body: JSON.stringify({ findingKey: key, verdict: "AGREE" }), headers: { "content-type": "application/json" } });
    await expect(handleFindingReviews({ scope: "booking", jobId: "job", resource: ["finding-reviews"], user: student, request: write })).rejects.toMatchObject({ status: 403 });
  });

  it("rejects malformed keys and verdicts before touching the database", async () => {
    const write = new Request("http://localhost/api", { method: "POST", body: JSON.stringify({ findingKey: "improvement:zzz", verdict: "MAYBE" }), headers: { "content-type": "application/json" } });
    await expect(handleFindingReviews({ scope: "booking", jobId: "job", resource: ["finding-reviews"], user: coach, request: write })).rejects.toThrow();
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("exports only the coach's own verdicts", async () => {
    mocks.list.mockResolvedValue([{ ...review("coach"), scope: "LESSON", jobId: "job", actionId: "certification:level2:short_turn" }]);
    const exported = await listCoachFindingReviews(coach);
    expect(mocks.list).toHaveBeenCalledWith(expect.objectContaining({ where: { coachId: "coach" } }));
    expect(exported.reviews[0]).toMatchObject({ scope: "LESSON", jobId: "job", findingKey: key, verdict: "AGREE", metricKeys: ["turn_closure"] });
    await expect(listCoachFindingReviews(student)).rejects.toMatchObject({ status: 403 });
  });
});
