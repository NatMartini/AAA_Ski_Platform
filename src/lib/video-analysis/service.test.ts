import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma, type LessonVideo, type VideoAnalysisJob, type VideoAnalysisPurchase } from "@prisma/client";
import type { ActiveUser } from "../auth/require-user";
import type { FreeSkiAnalysisResult } from "../freeski/types";
import { scorecardSchema } from "../freeski/scorecard";
import { sampleScorecard } from "../freeski/scorecard.fixtures";

const mocks = vi.hoisted(() => ({ transaction: vi.fn(), findBooking: vi.fn(), profile: vi.fn(),
  jobFindUnique: vi.fn(), jobFindFirst: vi.fn(), jobFindMany: vi.fn(), jobUpdateMany: vi.fn(),
  jobCreate: vi.fn(), jobUpdate: vi.fn(), purchaseCreate: vi.fn(), purchaseUpdate: vi.fn(),
  objectExists: vi.fn(), configured: vi.fn(), serviceState: vi.fn(), scheduler: vi.fn(), catalog: vi.fn(), lock: vi.fn(), enqueue: vi.fn(),
  freeskiConfig: vi.fn(), upstreamJob: vi.fn() }));
vi.mock("../prisma", () => ({ prisma: { $transaction: mocks.transaction, booking: { findUnique: mocks.findBooking },
  videoAnalysisJob: { findUnique: mocks.jobFindUnique, findFirst: mocks.jobFindFirst,
    findMany: mocks.jobFindMany, updateMany: mocks.jobUpdateMany } } }));
vi.mock("../storage", () => ({ objectExists: mocks.objectExists }));
vi.mock("../freeski/config", () => ({ isFreeSkiConfigured: mocks.configured, getFreeSkiConfig: mocks.freeskiConfig }));
vi.mock("../freeski/adapter", () => ({ freeSkiServiceState: mocks.serviceState, freeSkiSchedulerState: mocks.scheduler,
  getFreeSkiActionCatalog: mocks.catalog, getFreeSkiAnalysisJob: mocks.upstreamJob }));
vi.mock("../freeski/dispatcher", () => ({ ensureBusinessAnalysisQueued: mocks.enqueue }));

import { attachUpstreamJobId, cancelAnalysisPurchase, claimAnalysisJob, createAnalysisPurchase,
  getVideoAnalysisState, heartbeatAnalysisJob, recoverExpiredAnalysisJobs, requestVideoAnalysis,
  reviewAnalysisPayment, settleAnalysisJob, submitAnalysisPayment } from "./service";

const now = new Date("2026-10-06T17:00:00Z");
const user = (id: string, role: ActiveUser["role"] = "CUSTOMER"): ActiveUser => ({ id, role,
  email: `${id}@example.com`, name: id, image: null, phone: null, wechatId: null, tokenIssuedAt: null });
const buyer = user("buyer"), coach = user("coach", "COACH"), otherCoach = user("other-coach", "COACH");
const graded: FreeSkiAnalysisResult = { version: 1, provider: "freeski", actionId: "parallel",
  gradingStatus: "graded", gradingReason: null, score: 80, scoreKind: "TECH", numTurns: 6,
  coachingZh: [], coachingEn: [], metrics: [], scorerVersion: "test" };
let booking: { id: string; code: string; status: string; accountId: string; coachId: string; hours: number;
  videos: LessonVideo[]; analysisJobs: VideoAnalysisJob[]; analysisPurchases: VideoAnalysisPurchase[] };
let profile: { analysisCreditPriceCents: number | null; wechatPayEnabled: boolean; displayName: string;
  wechatId: string; wechatPayQrKey: string | null };
let tail: Promise<unknown>;
let inTransaction: boolean;
const action = (id = "parallel", available = true) => ({ id, labelZh: "平行式", labelEn: "Parallel",
  pathType: "improvement" as const, level: null, available, groupZh: "动作提升", groupEn: "Improvement" });

function video(id = "video", owner = "buyer", contentType = "video/mp4"): LessonVideo {
  return { id, bookingId: "booking", uploadedById: owner, storageKey: `private/${id}.mp4`,
    contentType, bytes: 1024, caption: "test", uploadedAt: now };
}
function job(overrides: Partial<VideoAnalysisJob> = {}): VideoAnalysisJob {
  return { id: "job", bookingId: "booking", videoId: "video", createdById: "buyer", requestKey: "request",
    actionId: "parallel", upstreamJobId: null, upstreamDeploymentId: null, upstreamApiVersion: null, status: "QUEUED", consumedAt: now, refundedAt: null,
    queuedExpiresAt: new Date(now.getTime() + 30 * 60_000), leaseToken: null, leaseExpiresAt: null,
    attempts: 0, startedAt: null, finishedAt: null, result: null, errorCode: null, createdAt: now,
    updatedAt: now, ...overrides };
}
function purchase(overrides: Partial<VideoAnalysisPurchase> = {}): VideoAnalysisPurchase {
  return { id: "purchase", bookingId: "booking", accountId: "buyer", payeeCoachId: "coach", requestKey: "purchase-request",
    quantity: 2, unitPriceCents: 700, totalCents: 1400, currency: "CAD", status: "AWAITING_PAYMENT",
    paymentMethod: null, paymentReference: null, paymentSubmittedAt: null, reviewedById: null,
    reviewedAt: null, reviewNote: null, cancelledAt: null, createdAt: now, updatedAt: now, ...overrides };
}
function running(overrides: Partial<VideoAnalysisJob> = {}) {
  return job({ status: "RUNNING", leaseToken: "lease", startedAt: now,
    leaseExpiresAt: new Date(now.getTime() + 15 * 60_000), ...overrides });
}
// Apply the database predicates to a stateful repository. The transaction queue models
// Booking FOR UPDATE so races test the domain flow, not mocked successful return values.
function matches(row: object, where: Record<string, unknown>): boolean {
  const fields = row as Record<string, unknown>;
  return Object.entries(where).every(([key, expected]) => {
    if (key === "OR") return (expected as Record<string, unknown>[]).some((part) => matches(row, part));
    const actual = fields[key];
    if (expected && typeof expected === "object" && !(expected instanceof Date)) {
      const bounds = expected as { gt?: Date; lte?: Date };
      return actual instanceof Date && (!bounds.gt || actual > bounds.gt) && (!bounds.lte || actual <= bounds.lte);
    }
    return actual === expected;
  });
}
function updateJob(row: VideoAnalysisJob, data: Record<string, unknown>) {
  const { attempts, result, ...other } = data;
  Object.assign(row, other, { updatedAt: new Date() });
  if (attempts && typeof attempts === "object") row.attempts += (attempts as { increment: number }).increment;
  if (result !== undefined) row.result = result === Prisma.DbNull ? null : result as Prisma.JsonValue;
  return structuredClone(row);
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
  tail = Promise.resolve();
  inTransaction = false;
  booking = { id: "booking", code: "SKI-TEST", accountId: "buyer", coachId: "coach", status: "COMPLETED",
    hours: 2, videos: [video(), video("coach-video", "coach")], analysisJobs: [], analysisPurchases: [] };
  profile = { analysisCreditPriceCents: 700, wechatPayEnabled: true, displayName: "Coach",
    wechatId: "coach-wechat", wechatPayQrKey: null };
  mocks.configured.mockReturnValue(true);
  mocks.serviceState.mockResolvedValue({ configured: true, available: true });
  mocks.scheduler.mockResolvedValue({ connected: true, runtimeState: "stopped", waitingReason: null });
  mocks.catalog.mockResolvedValue([action(), action("short_turn"), action("carving"), action("bumps")]);
  mocks.objectExists.mockResolvedValue(true);
  mocks.enqueue.mockResolvedValue(true);
  mocks.profile.mockImplementation(async () => structuredClone(profile));
  mocks.findBooking.mockImplementation(async ({ where }) => where.code === booking.code ? { id: booking.id } : null);
  mocks.jobUpdateMany.mockImplementation(async ({ where, data }) => {
    const found = booking.analysisJobs.filter((row) => matches(row, where));
    found.forEach((row) => updateJob(row, data));
    return { count: found.length };
  });
  mocks.jobCreate.mockImplementation(async ({ data }) => {
    const result = job({ ...data, id: `job-${booking.analysisJobs.length + 1}` });
    booking.analysisJobs.push(result);
    return structuredClone(result);
  });
  mocks.jobFindUnique.mockImplementation(async ({ where, include }) => {
    const row = booking.analysisJobs.find((row) => row.id === where.id);
    if (!row) return null;
    return include ? { ...structuredClone(row), video: booking.videos.find((v) => v.id === row.videoId) ?? null,
      booking: { status: booking.status } } : structuredClone(row);
  });
  mocks.jobFindFirst.mockImplementation(async ({ where }) => booking.analysisJobs.find((row) => matches(row, where)) ?? null);
  mocks.jobFindMany.mockImplementation(async ({ where }) => booking.analysisJobs.some((row) => matches(row, where)) ? [{ bookingId: booking.id }] : []);
  mocks.jobUpdate.mockImplementation(async ({ where, data }) => updateJob(booking.analysisJobs.find((row) => row.id === where.id)!, data));
  mocks.purchaseCreate.mockImplementation(async ({ data }) => {
    const result = purchase({ ...data, id: `purchase-${booking.analysisPurchases.length + 1}` });
    booking.analysisPurchases.push(result);
    return structuredClone(result);
  });
  mocks.purchaseUpdate.mockImplementation(async ({ where, data }) => {
    const row = booking.analysisPurchases.find((row) => row.id === where.id)!;
    Object.assign(row, data, { updatedAt: new Date(Math.max(Date.now(), row.updatedAt.getTime() + 1)) });
    return structuredClone(row);
  });
  const tx = { $queryRaw: mocks.lock, booking: { findUnique: async () => structuredClone(booking) },
    coachProfile: { findUnique: mocks.profile }, videoAnalysisJob: { updateMany: mocks.jobUpdateMany,
      create: mocks.jobCreate, findUnique: mocks.jobFindUnique, update: mocks.jobUpdate },
    videoAnalysisPurchase: { create: mocks.purchaseCreate, update: mocks.purchaseUpdate } };
  mocks.transaction.mockImplementation((work: (client: typeof tx) => Promise<unknown>) => {
    const next = tail.then(async () => {
      const snapshot = structuredClone(booking);
      inTransaction = true;
      try { return await work(tx); }
      catch (error) { booking = snapshot; throw error; }
      finally { inTransaction = false; }
    });
    tail = next.catch(() => undefined);
    return next;
  });
});
afterEach(() => vi.useRealTimers());

const run = (requestKey = "request", actor = buyer, videoId = "video") => requestVideoAnalysis("SKI-TEST", actor,
  { videoId, actionId: "improvement:level2:parallel", requestKey });
const buy = (requestKey = "purchase-request", actor = buyer, quantity = 2, expectedUnitPriceCents = 700) =>
  createAnalysisPurchase("SKI-TEST", actor, { quantity, requestKey, expectedUnitPriceCents });
const view = (actor = buyer) => getVideoAnalysisState("SKI-TEST", actor);

describe("atomic shared credits and analysis access", () => {
  it("uses the current catalog and closes submission when all actions are unavailable", async () => {
    const disabled = [action("parallel", false), action("bumps", false)];
    mocks.catalog.mockResolvedValue(disabled);
    expect(await view()).toMatchObject({ actions: disabled, canAnalyze: false, quota: { remaining: 3 } });
    await expect(run()).rejects.toMatchObject({ reason: "unsupported-action" });
    expect(mocks.jobCreate).not.toHaveBeenCalled();
    expect(booking.analysisJobs).toHaveLength(0);
  });

  it("does not treat a historical action as open merely because another catalog action is available", async () => {
    mocks.catalog.mockResolvedValue([action("short_turn")]);
    expect(await view()).toMatchObject({ canAnalyze: true });
    await expect(run()).rejects.toMatchObject({ reason: "unsupported-action" });
    expect(mocks.jobCreate).not.toHaveBeenCalled();
    expect(booking.analysisJobs).toHaveLength(0);
  });

  it("does not replace a missing catalog with the historical four-action list", async () => {
    mocks.catalog.mockRejectedValue(new Error("private catalog transport failure"));
    const state = await view();
    expect(state).toMatchObject({ actions: [], canAnalyze: false, quota: { remaining: 3 } });
    expect(JSON.stringify(state)).not.toContain("private catalog");
    await expect(run()).rejects.toMatchObject({ reason: "service-unavailable" });
    expect(mocks.jobCreate).not.toHaveBeenCalled();
  });

  it("keeps identical retries usable offline and rejects changed retries before catalog reads", async () => {
    const first = await run();
    mocks.catalog.mockClear().mockRejectedValue(new Error("offline"));
    expect((await run()).job.id).toBe(first.job.id);
    await expect(run("request", buyer, "coach-video")).rejects.toMatchObject({ reason: "request-conflict" });
    expect(mocks.catalog).not.toHaveBeenCalled();
    expect(mocks.jobCreate).toHaveBeenCalledOnce();
  });

  it("reuses a concurrently committed retry even when its own catalog read fails", async () => {
    mocks.catalog.mockImplementationOnce(async () => {
      await run();
      throw new Error("connection lost after another caller reserved the same request");
    });
    const result = await run();
    expect(result.job.id).toBe(booking.analysisJobs[0].id);
    expect(mocks.jobCreate).toHaveBeenCalledOnce();
  });

  it("reads the catalog and private storage only after releasing the row lock", async () => {
    mocks.catalog.mockImplementation(async () => { expect(inTransaction).toBe(false); return [action()]; });
    mocks.objectExists.mockImplementation(async () => { expect(inTransaction).toBe(false); return true; });
    await view();
    await run();
  });

  it("rechecks ownership after the catalog response without spending a credit", async () => {
    mocks.catalog.mockImplementation(async () => { booking.accountId = "other"; return [action()]; });
    await expect(run()).rejects.toMatchObject({ reason: "forbidden" });
    expect(mocks.jobCreate).not.toHaveBeenCalled();
  });

  it("stores the certification path and level in the action identifier through worker claim", async () => {
    const id = "certification:level2:short_turn";
    mocks.catalog.mockResolvedValue([{ ...action(id), pathType: "certification", level: "level2" }]);
    const reservation = await requestVideoAnalysis("SKI-TEST", buyer, { videoId: "video", actionId: id, requestKey: "cert" });
    expect(booking.analysisJobs[0].actionId).toBe(id);
    expect(await claimAnalysisJob(reservation.job.id)).toMatchObject({ actionId: id });
  });

  it("stores the skier's current level with an improvement request and refuses one without it", async () => {
    await expect(requestVideoAnalysis("SKI-TEST", buyer, { videoId: "video", actionId: "parallel", requestKey: "bare" }))
      .rejects.toMatchObject({ reason: "unsupported-action" });
    expect(mocks.jobCreate).not.toHaveBeenCalled();
    const reservation = await requestVideoAnalysis("SKI-TEST", buyer, { videoId: "video", actionId: "improvement:none:parallel", requestKey: "level" });
    expect(booking.analysisJobs[0].actionId).toBe("improvement:none:parallel");
    expect(await claimAnalysisJob(reservation.job.id)).toMatchObject({ actionId: "improvement:none:parallel" });
  });

  it.each([[2, 3], [3, 5]])("reserves at most the whole-lesson allowance for %i hours", async (hours, allowance) => {
    booking.hours = hours;
    const results = await Promise.allSettled(Array.from({ length: 10 }, (_, index) => run(`concurrent-${index}`)));
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(allowance);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(10 - allowance);
    expect((await view()).quota).toMatchObject({ freeTotal: allowance, reserved: allowance, remaining: 0 });
  });

  it("serializes simultaneous competition for the final shared course credit", async () => {
    booking.analysisJobs.push(job({ id: "old-1", status: "SUCCEEDED" }), job({ id: "old-2", status: "SUCCEEDED" }));
    const results = await Promise.allSettled([run("one"), run("two", coach)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find((r) => r.status === "rejected")).toMatchObject({ reason: { reason: "quota-exhausted" } });
    expect(mocks.jobCreate).toHaveBeenCalledOnce();
    expect((await view()).quota).toMatchObject({ remaining: 0, reserved: 1 });
    expect(mocks.lock).toHaveBeenCalled();
  });

  it("coalesces duplicate requests instead of consuming a second credit", async () => {
    const [first, duplicate] = await Promise.all([run(), run()]);
    expect(first.job.id).toBe(duplicate.job.id);
    expect(mocks.jobCreate).toHaveBeenCalledOnce();
    expect(duplicate.quota.remaining).toBe(2);
    expect(mocks.enqueue).toHaveBeenCalledWith("booking", first.job.id);
    await expect(run("request", buyer, "coach-video")).rejects.toMatchObject({ reason: "request-conflict" });
  });

  it("preserves other-coach read access while refusing all their mutations", async () => {
    booking.analysisPurchases.push(purchase());
    const state = await view(otherCoach);
    expect(state.videos).toHaveLength(2);
    expect(state).toMatchObject({ canAnalyze: false, canUpload: false, canPurchase: false, canReview: false });
    expect(state.videos.every((v) => !v.canDelete)).toBe(true);
    await expect(run("other", otherCoach)).rejects.toMatchObject({ reason: "forbidden" });
    await expect(buy("other", otherCoach)).rejects.toMatchObject({ reason: "forbidden" });
    await expect(submitAnalysisPayment("SKI-TEST", "purchase", otherCoach)).rejects.toMatchObject({ reason: "forbidden" });
    await expect(cancelAnalysisPurchase("SKI-TEST", "purchase", otherCoach)).rejects.toMatchObject({ reason: "forbidden" });
  });

  it("refuses unrelated customers and group guests full-course access", async () => {
    await expect(view(user("guest"))).rejects.toMatchObject({ reason: "forbidden" });
    await expect(run("guest", user("guest"))).rejects.toMatchObject({ reason: "forbidden" });
    expect(mocks.scheduler).not.toHaveBeenCalled();
    expect(mocks.serviceState).not.toHaveBeenCalled();
    expect(mocks.catalog).not.toHaveBeenCalled();
  });

  it("adds the current broker reason only to authorized queued lessons without changing quota", async () => {
    const reason = "待命：等待门卫切换";
    mocks.scheduler.mockResolvedValue({ connected: true, runtimeState: "stopped", waitingReason: reason });
    booking.analysisJobs.push(job({ upstreamJobId: "private-upstream" }), job({ id: "done", status: "SUCCEEDED" }));
    const state = await view();
    expect(state.jobs.map((row) => ({ id: row.id, queueReason: row.queueReason })))
      .toEqual([{ id: "job", queueReason: reason }, { id: "done", queueReason: null }]);
    expect(state.quota).toMatchObject({ reserved: 1, used: 1, remaining: 1 });
    expect(mocks.scheduler).toHaveBeenCalledOnce();
    expect(mocks.jobUpdateMany).not.toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ refundedAt: expect.anything() }) }));
    expect(JSON.stringify(state)).not.toContain("private-upstream");
  });

  it("says when FreeSki holds an accepted lesson job for compute, without exposing its id", async () => {
    mocks.freeskiConfig.mockReturnValue({ deploymentId: "freeski-platform-8100" });
    mocks.upstreamJob.mockResolvedValue({ status: "queued", brokerStatus: null, queueReason: "compute_offline", result: null });
    booking.analysisJobs.push(job({ upstreamJobId: "a".repeat(32), upstreamDeploymentId: "freeski-platform-8100" }));
    const state = await view();
    expect(state.jobs[0]).toMatchObject({ status: "QUEUED", computeWait: "compute_offline" });
    expect(mocks.upstreamJob).toHaveBeenCalledWith("a".repeat(32), "parallel", expect.any(AbortSignal));
    expect(state.quota).toMatchObject({ reserved: 1, remaining: 2 });
    expect(JSON.stringify(state)).not.toContain("a".repeat(32));
    expect(state).not.toHaveProperty("upstream");
  });

  it("keeps lesson credits reserved and the view readable when the scheduler is unavailable", async () => {
    booking.analysisJobs.push(job());
    mocks.scheduler.mockRejectedValue(new Error("private credentials and local paths"));
    const state = await view();
    expect(state.jobs[0]).toMatchObject({ status: "QUEUED", queueReason: null });
    expect(state.quota).toMatchObject({ reserved: 1, remaining: 2 });
    expect(JSON.stringify(state)).not.toContain("private credentials");
    expect(booking.analysisJobs[0].refundedAt).toBeNull();
  });

  it("revokes coach-only mutation authority when a former payee coach is demoted", async () => {
    const formerCoach = user("coach", "CUSTOMER");
    booking.analysisPurchases.push(purchase({ status: "PENDING_PAYMENT_REVIEW" }));
    await expect(run("demoted", formerCoach)).rejects.toMatchObject({ reason: "forbidden" });
    await expect(reviewAnalysisPayment("SKI-TEST", "purchase", formerCoach,
      { action: "confirm", expectedUpdatedAt: now.toISOString() })).rejects.toMatchObject({ reason: "forbidden" });
    expect(booking.analysisPurchases[0].status).toBe("PENDING_PAYMENT_REVIEW");
  });

  it("hides worker credentials and storage locations, and respects uploader deletion ownership", async () => {
    booking.analysisJobs.push(job({ leaseToken: "internal-token", upstreamJobId: "provider-id" }));
    const state = await view();
    expect(state.videos.find((v) => v.id === "video")?.canDelete).toBe(false);
    expect(state.videos.find((v) => v.id === "coach-video")?.canDelete).toBe(false);
    const response = JSON.stringify(state);
    for (const secret of ["internal-token", "provider-id", "private/", "requestKey", "createdById"])
      expect(response).not.toContain(secret);
  });

  it.each(["CONFIRMED", "CANCELLED"])("does not reserve an analysis before COMPLETED (%s)", async (status) => {
    booking.status = status;
    await expect(run()).rejects.toMatchObject({ reason: "lesson-not-completed" });
    expect(mocks.jobCreate).not.toHaveBeenCalled();
  });

  it("keeps existing WebM playable while rejecting analysis before any reservation", async () => {
    booking.videos[0].contentType = "video/webm";
    expect((await view()).videos[0]).toMatchObject({ contentType: "video/webm", analysisSupported: false });
    await expect(run()).rejects.toMatchObject({ reason: "unsupported-video" });
    expect(mocks.jobCreate).not.toHaveBeenCalled();
    expect((await view()).quota.remaining).toBe(3);
  });

  it("rejects unconfigured services and unknown or cross-booking video identifiers without spending", async () => {
    mocks.configured.mockReturnValue(false);
    await expect(run()).rejects.toMatchObject({ reason: "service-not-configured" });
    mocks.configured.mockReturnValue(true);
    await expect(run("unknown", buyer, "other-booking-video")).rejects.toMatchObject({ reason: "video-not-found" });
    mocks.objectExists.mockResolvedValue(false);
    await expect(run()).rejects.toMatchObject({ reason: "video-not-found" });
    expect(mocks.jobCreate).not.toHaveBeenCalled();
  });
});

describe("worker leases, settlement and refunds", () => {
  it("allows exactly one worker claim, heartbeat and upstream correlation per reservation", async () => {
    booking.analysisJobs.push(job());
    const claims = await Promise.all([claimAnalysisJob(), claimAnalysisJob()]);
    const claim = claims.find((value) => value !== null)!;
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(booking.analysisJobs[0].attempts).toBe(1);
    expect(await heartbeatAnalysisJob("job", "wrong-token")).toBe(false);
    expect(await heartbeatAnalysisJob("job", claim.leaseToken)).toBe(true);
    expect(await attachUpstreamJobId("job", claim.leaseToken, "upstream-id")).toBe(true);
    expect(await attachUpstreamJobId("job", claim.leaseToken, "second-upstream-id")).toBe(false);
    expect(booking.analysisJobs[0].upstreamJobId).toBe("upstream-id");
  });

  it("refunds a provider failure exactly once and never stores its raw error", async () => {
    booking.analysisJobs.push(running());
    const outcomes = await Promise.all([settleAnalysisJob("job", "lease", { ok: false, errorCode: "http://secret-provider/raw-error" }),
      settleAnalysisJob("job", "lease", { ok: false, errorCode: "analysis-unavailable" })]);
    expect(outcomes.filter(Boolean)).toHaveLength(1);
    expect(booking.analysisJobs[0]).toMatchObject({ status: "FAILED", errorCode: "ANALYSIS_FAILED" });
    expect(booking.analysisJobs[0].refundedAt).toEqual(now);
    expect((await view()).quota.remaining).toBe(3);
    expect(await settleAnalysisJob("job", "lease", { ok: true, result: graded })).toBe(false);
  });

  it("refunds a definitively unsubmitted closed action exactly once", async () => {
    booking.analysisJobs.push(job({ actionId: "carving" }));
    const claimed = (await claimAnalysisJob("job"))!;
    const outcome = { ok: false as const, errorCode: "UNSUPPORTED_ACTION", expectedUnsubmittedActionId: "carving" };
    const settlements = await Promise.all([settleAnalysisJob("job", claimed.leaseToken, outcome),
      settleAnalysisJob("job", claimed.leaseToken, outcome)]);
    expect(settlements.filter(Boolean)).toHaveLength(1);
    expect(booking.analysisJobs[0]).toMatchObject({ status: "FAILED", refundedAt: now,
      errorCode: "UNSUPPORTED_ACTION", upstreamJobId: null });
    expect((await view()).quota).toMatchObject({ used: 0, reserved: 0, remaining: 3 });
  });

  it.each(["attached-upstream", "changed-action"])("does not refund closed-action evidence after a concurrent %s write", async (change) => {
    booking.analysisJobs.push(running({ actionId: "carving" }));
    const update = mocks.jobUpdateMany.getMockImplementation()!;
    mocks.jobUpdateMany.mockImplementationOnce(async (query) => {
      if (change === "attached-upstream") booking.analysisJobs[0].upstreamJobId = "a".repeat(32);
      else booking.analysisJobs[0].actionId = "parallel";
      return update(query);
    });
    expect(await settleAnalysisJob("job", "lease", { ok: false, errorCode: "UNSUPPORTED_ACTION",
      expectedUnsubmittedActionId: "carving" })).toBe(false);
    expect(booking.analysisJobs[0]).toMatchObject({ status: "RUNNING", refundedAt: null, errorCode: null });
    expect((await view()).quota).toMatchObject({ reserved: 1, remaining: 2 });
  });

  it("refunds ungradable results while preserving an explicit unavailable report", async () => {
    booking.analysisJobs.push(running());
    expect(await settleAnalysisJob("job", "lease", { ok: true, result: {
      ...graded, gradingStatus: "unavailable", gradingReason: "wrong-action", score: null, scoreKind: null } })).toBe(true);
    expect(booking.analysisJobs[0]).toMatchObject({ status: "FAILED", errorCode: "UNGRADABLE",
      result: { gradingStatus: "unavailable", gradingReason: "wrong-action", score: null, scoreKind: null } });
    expect((await view()).quota.remaining).toBe(3);
  });

  it("settles a usable contract scorecard even without a legacy TECH grade", async () => {
    booking.analysisJobs.push(running());
    const scorecard = scorecardSchema.parse(sampleScorecard);
    expect(await settleAnalysisJob("job", "lease", { ok: true, result: {
      ...graded, gradingStatus: "unavailable", gradingReason: "score-unavailable", score: null, scoreKind: null, scorecard } })).toBe(true);
    expect(booking.analysisJobs[0]).toMatchObject({ status: "SUCCEEDED", refundedAt: null, result: { scorecard: { overall: { score: sampleScorecard.overall.score } } } });
    expect((await view()).quota.remaining).toBe(2);
  });

  it("refunds when the scorecard reports insufficient evidence", async () => {
    booking.analysisJobs.push(running());
    const scorecard = scorecardSchema.parse({ ...sampleScorecard, quality: "insufficient", overall: { ...sampleScorecard.overall, score: null } });
    expect(await settleAnalysisJob("job", "lease", { ok: true, result: {
      ...graded, gradingStatus: "unavailable", gradingReason: "insufficient-turns", score: null, scoreKind: null, scorecard } })).toBe(true);
    expect(booking.analysisJobs[0]).toMatchObject({ status: "FAILED", errorCode: "UNGRADABLE" });
    expect((await view()).quota.remaining).toBe(3);
  });

  it("retains a real TECH zero as successful consumption, including after deleting the video", async () => {
    booking.analysisJobs.push(running());
    expect(await settleAnalysisJob("job", "lease", { ok: true, result: { ...graded, score: 0 } })).toBe(true);
    booking.analysisJobs[0].videoId = null;
    booking.analysisJobs[0].result = null;
    booking.videos = [];
    expect(await settleAnalysisJob("job", "lease", { ok: false, errorCode: "analysis-failed" })).toBe(false);
    expect((await view()).quota).toMatchObject({ used: 1, reserved: 0, remaining: 2 });
    expect(booking.analysisJobs[0].refundedAt).toBeNull();
  });

  it.each([
    job({ queuedExpiresAt: new Date(now.getTime() - 1) }),
    running({ leaseExpiresAt: new Date(now.getTime() - 1) }),
    running({ startedAt: new Date(now.getTime() - 61 * 60_000) }),
  ])("preserves queued reservations and recovers stale leases without refunding", async (stale) => {
    booking.analysisJobs.push(structuredClone(stale));
    expect(await recoverExpiredAnalysisJobs()).toBe(stale.status === "QUEUED" ? 0 : 1);
    expect(await recoverExpiredAnalysisJobs()).toBe(0);
    expect(await heartbeatAnalysisJob("job", "lease")).toBe(false);
    expect(await settleAnalysisJob("job", "lease", { ok: true, result: graded })).toBe(false);
    expect(booking.analysisJobs[0]).toMatchObject({ status: "QUEUED", refundedAt: null, errorCode: null });
    expect((await view()).quota).toMatchObject({ reserved: 1, remaining: 2 });
    expect(await claimAnalysisJob()).toMatchObject({ id: "job" });
    expect(mocks.jobCreate).not.toHaveBeenCalled();
  });

  it("a late worker cannot revive an expired lease even before recovery runs", async () => {
    booking.analysisJobs.push(running({ leaseExpiresAt: new Date(now.getTime() - 1) }));
    expect(await heartbeatAnalysisJob("job", "lease")).toBe(false);
    expect(await attachUpstreamJobId("job", "lease", "late-provider")).toBe(false);
    expect(await settleAnalysisJob("job", "lease", { ok: true, result: graded })).toBe(false);
    expect(await recoverExpiredAnalysisJobs()).toBe(1);
  });
});

describe("paid supplemental credits", () => {
  it("leaves purchases disabled when the coach has not configured a real price", async () => {
    profile.analysisCreditPriceCents = null;
    expect(await view()).toMatchObject({ price: null, canPurchase: false });
    await expect(buy()).rejects.toMatchObject({ reason: "purchase-not-configured" });
    expect(mocks.purchaseCreate).not.toHaveBeenCalled();
  });

  it("freezes price and payee, rejects stale quotes, and coalesces retry purchases", async () => {
    await expect(buy("stale", buyer, 2, 600)).rejects.toMatchObject({ reason: "price-changed" });
    const [first, duplicate] = await Promise.all([buy(), buy()]);
    expect(first.purchase.id).toBe(duplicate.purchase.id);
    expect(mocks.purchaseCreate).toHaveBeenCalledOnce();
    profile.analysisCreditPriceCents = 1200;
    expect(booking.analysisPurchases[0]).toMatchObject({ unitPriceCents: 700, totalCents: 1400, payeeCoachId: "coach" });
    expect((await buy()).purchase).toMatchObject({ unitPriceCents: 700, totalCents: 1400 });
    await expect(buy("purchase-request", buyer, 3)).rejects.toMatchObject({ reason: "request-conflict" });
  });

  it.each([0, 51, 1.5])("rejects invalid quantity %s before creating a purchase", async (quantity) => {
    await expect(buy("invalid", buyer, quantity)).rejects.toMatchObject({ reason: "invalid-quantity" });
    expect(mocks.purchaseCreate).not.toHaveBeenCalled();
  });

  it("only the purchaser buys and only the payee coach/admin confirms", async () => {
    await expect(buy("coach", coach)).rejects.toMatchObject({ reason: "forbidden" });
    booking.analysisPurchases.push(purchase({ status: "PENDING_PAYMENT_REVIEW" }));
    await expect(reviewAnalysisPayment("SKI-TEST", "purchase", buyer,
      { action: "confirm", expectedUpdatedAt: now.toISOString() })).rejects.toMatchObject({ reason: "forbidden" });
    await expect(reviewAnalysisPayment("SKI-TEST", "purchase", otherCoach,
      { action: "confirm", expectedUpdatedAt: now.toISOString() })).rejects.toMatchObject({ reason: "forbidden" });
  });

  it("does not grant declared payment credits until a single successful review", async () => {
    booking.analysisPurchases.push(purchase());
    const submitted = await submitAnalysisPayment("SKI-TEST", "purchase", buyer, "wechat-receipt");
    expect((await view()).quota.paidTotal).toBe(0);
    const input = { action: "confirm" as const, expectedUpdatedAt: submitted.purchase.updatedAt.toISOString() };
    const reviews = await Promise.allSettled([reviewAnalysisPayment("SKI-TEST", "purchase", coach, input),
      reviewAnalysisPayment("SKI-TEST", "purchase", coach, input)]);
    expect(reviews.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(booking.analysisPurchases[0]).toMatchObject({ status: "CONFIRMED", paymentMethod: "WECHAT",
      paymentReference: "wechat-receipt", reviewedById: "coach" });
    expect((await view()).quota).toMatchObject({ paidTotal: 2, remaining: 5 });
  });

  it("rejects stale review after rejection and resubmission", async () => {
    booking.analysisPurchases.push(purchase());
    const old = await submitAnalysisPayment("SKI-TEST", "purchase", buyer, "first");
    await reviewAnalysisPayment("SKI-TEST", "purchase", coach,
      { action: "reject", note: "not received", expectedUpdatedAt: old.purchase.updatedAt.toISOString() });
    await submitAnalysisPayment("SKI-TEST", "purchase", buyer, "second");
    await expect(reviewAnalysisPayment("SKI-TEST", "purchase", coach,
      { action: "confirm", expectedUpdatedAt: old.purchase.updatedAt.toISOString() })).rejects.toMatchObject({ reason: "state-changed" });
    expect(booking.analysisPurchases[0]).toMatchObject({ status: "PENDING_PAYMENT_REVIEW", paymentReference: "second" });
    expect((await view()).quota.paidTotal).toBe(0);
  });

  it("supports explicit manual received confirmation and cancelling only unpaid orders", async () => {
    booking.analysisPurchases.push(purchase());
    const confirmed = await reviewAnalysisPayment("SKI-TEST", "purchase", coach, { action: "confirm",
      expectedUpdatedAt: now.toISOString(), manualReceipt: { method: "WECHAT", reference: "manual-reference" } });
    expect(confirmed.quota.paidTotal).toBe(2);
    expect(booking.analysisPurchases[0]).toMatchObject({ paymentReference: "manual-reference",
      paymentSubmittedAt: now, reviewedById: "coach", reviewedAt: now });
    await expect(cancelAnalysisPurchase("SKI-TEST", "purchase", buyer)).rejects.toMatchObject({ reason: "invalid-state" });
    booking.analysisPurchases.push(purchase({ id: "cancel-me", requestKey: "cancel-request" }));
    expect((await cancelAnalysisPurchase("SKI-TEST", "cancel-me", buyer)).purchase.status).toBe("CANCELLED");
    expect((await view()).quota.paidTotal).toBe(2);
  });
});
