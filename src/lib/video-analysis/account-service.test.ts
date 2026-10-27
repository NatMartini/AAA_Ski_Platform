import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma, type AccountAnalysisGrant, type AccountAnalysisJob, type AccountAnalysisVideo } from "@prisma/client";
import type { ActiveUser } from "../auth/require-user";
import type { FreeSkiAnalysisResult } from "../freeski/types";

const mocks = vi.hoisted(() => ({ transaction: vi.fn(), lock: vi.fn(), userFirst: vi.fn(), userUnique: vi.fn(),
  grantMany: vi.fn(), grantUnique: vi.fn(), grantCreate: vi.fn(), videoMany: vi.fn(), videoFirst: vi.fn(),
  jobMany: vi.fn(), jobUnique: vi.fn(), jobFirst: vi.fn(), jobCreate: vi.fn(), jobUpdate: vi.fn(), jobUpdateMany: vi.fn(),
  configured: vi.fn(), available: vi.fn(), scheduler: vi.fn(), catalog: vi.fn(), exists: vi.fn(), enqueue: vi.fn(),
  freeskiConfig: vi.fn(), upstreamJob: vi.fn() }));
vi.mock("../prisma", () => ({ prisma: { $transaction: mocks.transaction,
  user: { findFirst: mocks.userFirst, findUnique: mocks.userUnique },
  accountAnalysisGrant: { findMany: mocks.grantMany },
  accountAnalysisJob: { findMany: mocks.jobMany, findUnique: mocks.jobUnique, findFirst: mocks.jobFirst, updateMany: mocks.jobUpdateMany } } }));
vi.mock("../storage", () => ({ objectExists: mocks.exists }));
vi.mock("../freeski/config", () => ({ isFreeSkiConfigured: mocks.configured, getFreeSkiConfig: mocks.freeskiConfig }));
vi.mock("../freeski/adapter", () => ({ freeSkiServiceState: mocks.available, freeSkiSchedulerState: mocks.scheduler,
  getFreeSkiActionCatalog: mocks.catalog, getFreeSkiAnalysisJob: mocks.upstreamJob }));
vi.mock("../freeski/dispatcher", () => ({ ensureBusinessAnalysisQueued: mocks.enqueue }));
import { accountAnalysisQuota, attachAccountUpstreamJobId, claimAccountAnalysisJob, getAccountVideoAnalysisState,
  heartbeatAccountAnalysisJob, issueAccountAnalysisGrant, listAccountAnalysisGrants, lockedAccount,
  recoverExpiredAccountAnalysisJobs, requestAccountAnalysis, settleAccountAnalysisJob } from "./account-service";

const now = new Date("2026-10-08T17:00:00.000Z");
const actor = (id: string, role: ActiveUser["role"] = "CUSTOMER"): ActiveUser => ({ id, role, email: `${id}@example.com`,
  name: id, image: null, phone: null, wechatId: null, tokenIssuedAt: now.toISOString() });
const customer = actor("customer");
const coach = actor("coach", "COACH");
type StoredUser = { id: string; name: string; email: string; role: ActiveUser["role"]; disabledAt: Date | null };
let users: StoredUser[];
let grants: AccountAnalysisGrant[];
let videos: AccountAnalysisVideo[];
let jobs: AccountAnalysisJob[];
let tail: Promise<unknown>;
let inTransaction: boolean;
const action = (id = "parallel", available = true) => ({ id, labelZh: "平行式", labelEn: "Parallel",
  pathType: "improvement" as const, level: null, available, groupZh: "动作提升", groupEn: "Improvement" });
const video = (id = "video", accountId = "customer"): AccountAnalysisVideo => ({ id, accountId,
  storageKey: `private/${accountId}/${id}.mp4`, uploadedById: accountId,
  caption: null, contentType: "video/mp4", bytes: 100, uploadedAt: now });
const job = (changes: Partial<AccountAnalysisJob> = {}): AccountAnalysisJob => ({ id: "job", accountId: "customer",
  videoId: "video", createdById: "customer", requestKey: "request", actionId: "parallel", upstreamJobId: null, upstreamDeploymentId: null, upstreamApiVersion: null,
  status: "QUEUED", consumedAt: now, refundedAt: null, queuedExpiresAt: new Date(now.getTime() + 30 * 60_000),
  leaseToken: null, leaseExpiresAt: null, attempts: 0, startedAt: null, finishedAt: null, result: null,
  errorCode: null, createdAt: now, updatedAt: now, ...changes });
const grant = (changes: Partial<AccountAnalysisGrant> = {}): AccountAnalysisGrant => ({ id: "grant", accountId: "customer",
  coachId: "coach", quantity: 3, note: null, requestKey: "grant-request", createdAt: now, ...changes });
const result: FreeSkiAnalysisResult = { version: 1, provider: "freeski", actionId: "parallel", gradingStatus: "graded",
  gradingReason: null, score: 0, scoreKind: "TECH", numTurns: 4, coachingZh: [], coachingEn: [], metrics: [], scorerVersion: null };

function matches(value: object, where: Record<string, unknown>): boolean {
  const row = value as Record<string, unknown>;
  return Object.entries(where).every(([key, expected]) => {
    if (key === "OR") return (expected as Record<string, unknown>[]).some((part) => matches(value, part));
    const actual = row[key];
    if (expected && typeof expected === "object" && !(expected instanceof Date)) {
      const bounds = expected as { gt?: Date; lte?: Date; in?: unknown[] };
      if (bounds.in) return bounds.in.includes(actual);
      return actual instanceof Date && (!bounds.gt || actual > bounds.gt) && (!bounds.lte || actual <= bounds.lte);
    }
    return actual === expected;
  });
}
function withGrantRelations(row: AccountAnalysisGrant) {
  const recipient = users.find((user) => user.id === row.accountId)!;
  const instructor = users.find((user) => user.id === row.coachId)!;
  return { ...structuredClone(row), account: { name: recipient.name, email: recipient.email },
    coach: { name: instructor.name, coachProfile: { displayName: "Coach display" } } };
}
function update(row: AccountAnalysisJob, data: Record<string, unknown>) {
  const { attempts, result: storedResult, ...rest } = data;
  Object.assign(row, rest, { updatedAt: new Date() });
  if (attempts && typeof attempts === "object") row.attempts += (attempts as { increment: number }).increment;
  if (storedResult !== undefined) row.result = storedResult === Prisma.DbNull ? null : storedResult as Prisma.JsonValue;
  return structuredClone(row);
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
  tail = Promise.resolve();
  inTransaction = false;
  users = [customer, coach, actor("other"), actor("other-coach", "COACH"), actor("admin", "ADMIN")].map((user) => ({
    id: user.id, email: user.email, name: user.name!, role: user.role, disabledAt: null }));
  grants = [grant()];
  videos = [video(), video("other-video", "other")];
  jobs = [];
  mocks.configured.mockReturnValue(true);
  mocks.available.mockResolvedValue({ configured: true, available: true });
  mocks.scheduler.mockResolvedValue({ connected: true, runtimeState: "stopped", waitingReason: null });
  mocks.catalog.mockResolvedValue([action(), action("short_turn"), action("carving"), action("bumps")]);
  mocks.exists.mockResolvedValue(true);
  mocks.enqueue.mockResolvedValue(true);
  mocks.userUnique.mockImplementation(async ({ where }) => structuredClone(users.find((user) => user.id === where.id) ?? null));
  mocks.userFirst.mockImplementation(async ({ where }) => structuredClone(users.find((user) => user.email.toLowerCase() === where.email.equals.toLowerCase()) ?? null));
  mocks.grantMany.mockImplementation(async ({ where, take }) => grants.filter((row) => matches(row, where)).slice(0, take).map(withGrantRelations));
  mocks.grantUnique.mockImplementation(async ({ where }) => {
    const row = grants.find((row) => matches(row, where.coachId_requestKey));
    return row ? withGrantRelations(row) : null;
  });
  mocks.grantCreate.mockImplementation(async ({ data }) => {
    const row = grant({ ...data, id: `grant-${grants.length + 1}` });
    grants.push(row);
    return withGrantRelations(row);
  });
  mocks.videoMany.mockImplementation(async ({ where }) => structuredClone(videos.filter((row) => matches(row, where))));
  mocks.videoFirst.mockImplementation(async ({ where }) => structuredClone(videos.find((row) => matches(row, where)) ?? null));
  mocks.jobMany.mockImplementation(async ({ where, distinct }) => {
    const selected = jobs.filter((row) => matches(row, where));
    if (distinct) return [...new Set(selected.map((row) => row.accountId))].map((accountId) => ({ accountId }));
    return structuredClone(selected);
  });
  mocks.jobUnique.mockImplementation(async ({ where, include }) => {
    const row = jobs.find((row) => matches(row, where));
    if (!row) return null;
    return include ? { ...structuredClone(row), video: videos.find((video) => video.id === row.videoId) ?? null,
      account: users.find((user) => user.id === row.accountId)! } : structuredClone(row);
  });
  mocks.jobFirst.mockImplementation(async ({ where }) => structuredClone(jobs.find((row) => matches(row, where)) ?? null));
  mocks.jobCreate.mockImplementation(async ({ data }) => {
    const row = job({ ...data, id: `job-${jobs.length + 1}` });
    jobs.push(row);
    return structuredClone(row);
  });
  mocks.jobUpdate.mockImplementation(async ({ where, data }) => update(jobs.find((row) => row.id === where.id)!, data));
  mocks.jobUpdateMany.mockImplementation(async ({ where, data }) => {
    const selected = jobs.filter((row) => matches(row, where));
    selected.forEach((row) => update(row, data));
    return { count: selected.length };
  });
  const tx = { $queryRaw: mocks.lock, user: { findUnique: mocks.userUnique },
    accountAnalysisGrant: { findMany: mocks.grantMany, findUnique: mocks.grantUnique, create: mocks.grantCreate },
    accountAnalysisVideo: { findMany: mocks.videoMany, findFirst: mocks.videoFirst },
    accountAnalysisJob: { findMany: mocks.jobMany, findUnique: mocks.jobUnique, findFirst: mocks.jobFirst,
      create: mocks.jobCreate, update: mocks.jobUpdate, updateMany: mocks.jobUpdateMany } };
  mocks.transaction.mockImplementation((work: (client: typeof tx) => Promise<unknown>) => {
    const next = tail.then(async () => {
      const snapshot = structuredClone({ users, grants, videos, jobs });
      inTransaction = true;
      try { return await work(tx); }
      catch (error) { ({ users, grants, videos, jobs } = snapshot); throw error; }
      finally { inTransaction = false; }
    });
    tail = next.catch(() => undefined);
    return next;
  });
});
afterEach(() => vi.useRealTimers());
const run = (requestKey = "request", user = customer, videoId = "video") => requestAccountAnalysis(user,
  { videoId, actionId: "improvement:level2:parallel", requestKey, expectedAccountId: user.id });
const issue = (changes: Partial<Parameters<typeof issueAccountAnalysisGrant>[1]> = {}, user = coach) => issueAccountAnalysisGrant(user,
  { recipientEmail: "customer@example.com", quantity: 2, requestKey: "new-grant", expectedCoachId: user.id, ...changes });

describe("account FreeSki grant wallet", () => {
  it("uses the live catalog and prevents reservations for closed actions", async () => {
    const disabled = [action("parallel", false), action("bumps", false)];
    mocks.catalog.mockResolvedValue(disabled);
    expect(await getAccountVideoAnalysisState(customer)).toMatchObject({ actions: disabled, canAnalyze: false,
      quota: { remaining: 3 } });
    await expect(run()).rejects.toMatchObject({ reason: "unsupported-action" });
    expect(mocks.jobCreate).not.toHaveBeenCalled();
    expect(jobs).toHaveLength(0);
  });

  it("rejects an unlisted historical action while leaving other available actions selectable", async () => {
    mocks.catalog.mockResolvedValue([action("short_turn")]);
    expect(await getAccountVideoAnalysisState(customer)).toMatchObject({ canAnalyze: true });
    await expect(run()).rejects.toMatchObject({ reason: "unsupported-action" });
    expect(mocks.jobCreate).not.toHaveBeenCalled();
    expect(jobs).toHaveLength(0);
  });

  it("keeps grants visible and spending disabled while the catalog is unavailable", async () => {
    mocks.catalog.mockRejectedValue(new Error("private catalog path"));
    const state = await getAccountVideoAnalysisState(customer);
    expect(state).toMatchObject({ actions: [], canAnalyze: false, quota: { remaining: 3 } });
    expect(JSON.stringify(state)).not.toContain("private catalog path");
    await expect(run()).rejects.toMatchObject({ reason: "service-unavailable" });
    expect(mocks.jobCreate).not.toHaveBeenCalled();
  });

  it("reuses an existing reservation with the catalog offline and still rejects changed retries", async () => {
    const first = await run();
    mocks.catalog.mockClear().mockRejectedValue(new Error("offline"));
    expect((await run()).job.id).toBe(first.job.id);
    await expect(run("request", customer, "other-video")).rejects.toMatchObject({ reason: "request-conflict" });
    expect(mocks.catalog).not.toHaveBeenCalled();
    expect(mocks.jobCreate).toHaveBeenCalledOnce();
  });

  it("preserves idempotency when another caller reserves during a failed catalog lookup", async () => {
    mocks.catalog.mockImplementationOnce(async () => { await run(); throw new Error("offline"); });
    const reservation = await run();
    expect(reservation.job.id).toBe(jobs[0].id);
    expect(mocks.jobCreate).toHaveBeenCalledOnce();
  });

  it("queries the catalog and object storage outside the account transaction", async () => {
    mocks.catalog.mockImplementation(async () => { expect(inTransaction).toBe(false); return [action()]; });
    mocks.exists.mockImplementation(async () => { expect(inTransaction).toBe(false); return true; });
    await getAccountVideoAnalysisState(customer);
    await run();
  });

  it("rechecks account and video ownership after the external catalog response", async () => {
    mocks.catalog.mockImplementation(async () => { videos[0].accountId = "other"; return [action()]; });
    await expect(run()).rejects.toMatchObject({ reason: "video-not-found" });
    expect(mocks.jobCreate).not.toHaveBeenCalled();
  });

  it("keeps the certification level and action unchanged when claiming the queued job", async () => {
    const id = "certification:level2:short_turn";
    mocks.catalog.mockResolvedValue([{ ...action(id), pathType: "certification", level: "level2" }]);
    const reservation = await requestAccountAnalysis(customer, { videoId: "video", actionId: id,
      requestKey: "cert", expectedAccountId: customer.id });
    expect(jobs[0].actionId).toBe(id);
    expect(await claimAccountAnalysisJob(reservation.job.id)).toMatchObject({ actionId: id });
  });

  it("stores the skier's current level with an improvement request and refuses one without it", async () => {
    await expect(requestAccountAnalysis(customer, { videoId: "video", actionId: "parallel", requestKey: "bare", expectedAccountId: customer.id }))
      .rejects.toMatchObject({ reason: "unsupported-action" });
    expect(mocks.jobCreate).not.toHaveBeenCalled();
    const reservation = await requestAccountAnalysis(customer, { videoId: "video", actionId: "improvement:level4:parallel",
      requestKey: "level", expectedAccountId: customer.id });
    expect(jobs[0].actionId).toBe("improvement:level4:parallel");
    expect(await claimAccountAnalysisJob(reservation.job.id)).toMatchObject({ actionId: "improvement:level4:parallel" });
  });

  it("shows only this account's grants, videos and jobs, with no internal identifiers", async () => {
    grants.push(grant({ id: "others-grant", accountId: "other", quantity: 50 }));
    jobs.push(job({ leaseToken: "lease-secret", upstreamJobId: "upstream-secret" }), job({ id: "others-job", accountId: "other" }));
    const state = await getAccountVideoAnalysisState(customer);
    expect(state).toMatchObject({ accountId: "customer", quota: { grantTotal: 3, reserved: 1, remaining: 2 }, canAnalyze: true, canUpload: true });
    expect(state.videos.map((video) => video.id)).toEqual(["video"]);
    expect(state.grants).toHaveLength(1);
    for (const secret of ["lease-secret", "upstream-secret", "private/", "others-job", "customer@example.com"])
      expect(JSON.stringify(state)).not.toContain(secret);
  });

  it("says when FreeSki holds an accepted personal job for compute, without exposing its id", async () => {
    mocks.freeskiConfig.mockReturnValue({ deploymentId: "freeski-platform-8100" });
    mocks.upstreamJob.mockResolvedValue({ status: "queued", brokerStatus: null, queueReason: "waiting_for_compute", result: null });
    jobs.push(job({ upstreamJobId: "a".repeat(32), upstreamDeploymentId: "freeski-platform-8100" }));
    const state = await getAccountVideoAnalysisState(customer);
    expect(state.jobs[0]).toMatchObject({ status: "QUEUED", computeWait: "waiting_for_compute" });
    expect(state.quota).toMatchObject({ reserved: 1, remaining: 2 });
    expect(JSON.stringify(state)).not.toContain("a".repeat(32));
    expect(state).not.toHaveProperty("upstream");
  });

  it("does not authorize generic video storage without an issued grant", async () => {
    grants = [];
    expect(await getAccountVideoAnalysisState(customer)).toMatchObject({ canUpload: false, canAnalyze: false, quota: { grantTotal: 0, remaining: 0 } });
    await expect(run()).rejects.toMatchObject({ reason: "quota-exhausted" });
    expect(jobs).toHaveLength(0);
  });

  it("enriches only the authenticated wallet with one real scheduler reason", async () => {
    const reason = "检测到游戏：cs2.exe";
    jobs.push(job(), job({ id: "done", status: "SUCCEEDED" }), job({ id: "other-job", accountId: "other" }));
    mocks.scheduler.mockResolvedValue({ connected: true, runtimeState: "stopped", waitingReason: reason });
    const state = await getAccountVideoAnalysisState(customer);
    expect(state.jobs.map((row) => ({ id: row.id, queueReason: row.queueReason })))
      .toEqual([{ id: "job", queueReason: reason }, { id: "done", queueReason: null }]);
    expect(state.quota).toMatchObject({ reserved: 1, used: 1, remaining: 1 });
    expect(mocks.scheduler).toHaveBeenCalledOnce();
    expect(JSON.stringify(state)).not.toContain("other-job");
  });

  it("does not refund or fail a personal analysis when scheduler status is temporarily unavailable", async () => {
    jobs.push(job());
    mocks.scheduler.mockRejectedValue(new Error("private transport detail"));
    const state = await getAccountVideoAnalysisState(customer);
    expect(state.jobs[0]).toMatchObject({ status: "QUEUED", queueReason: null });
    expect(state.quota).toMatchObject({ reserved: 1, remaining: 2 });
    expect(JSON.stringify(state)).not.toContain("private transport detail");
    expect(jobs[0].refundedAt).toBeNull();
  });

  it("bounds ten concurrent requests to exactly the three granted credits", async () => {
    const results = await Promise.allSettled(Array.from({ length: 10 }, (_, i) => run(`request-${i}`)));
    expect(results.filter((row) => row.status === "fulfilled")).toHaveLength(3);
    expect(results.filter((row) => row.status === "rejected")).toHaveLength(7);
    expect((await getAccountVideoAnalysisState(customer)).quota).toMatchObject({ reserved: 3, remaining: 0 });
  });

  it("reuses identical analysis requests and rejects conflicting retries without spending", async () => {
    const [a, b] = await Promise.all([run(), run()]);
    expect(a.job.id).toBe(b.job.id);
    expect(jobs).toHaveLength(1);
    expect(mocks.enqueue).toHaveBeenCalledWith("account", a.job.id);
    await expect(run("request", customer, "other-video")).rejects.toMatchObject({ reason: "request-conflict" });
    expect(jobs).toHaveLength(1);
  });

  it("rejects an account-switch snapshot before any lock or request write", async () => {
    await expect(requestAccountAnalysis(customer, { videoId: "video", actionId: "parallel", requestKey: "request", expectedAccountId: "other" }))
      .rejects.toMatchObject({ reason: "state-changed" });
    expect(mocks.lock).not.toHaveBeenCalled();
    expect(mocks.catalog).not.toHaveBeenCalled();
    expect(jobs).toHaveLength(0);
  });

  it.each([actor("other"), coach, actor("admin", "ADMIN")])("does not permit %s to use somebody else's personal video", async (user) => {
    await expect(run("request", user)).rejects.toMatchObject({ reason: "video-not-found" });
    expect(jobs).toHaveLength(0);
    expect(mocks.catalog).not.toHaveBeenCalled();
  });

  it.each(["video/webm", "text/html"])("does not reserve credits for unsupported content %s", async (type) => {
    videos[0].contentType = type;
    await expect(run()).rejects.toMatchObject({ reason: "unsupported-video" });
    expect(jobs).toHaveLength(0);
  });

  it("rejects unknown actions, missing files and unavailable configuration without spending", async () => {
    await expect(requestAccountAnalysis(customer, { videoId: "video", actionId: "invented", requestKey: "request", expectedAccountId: "customer" }))
      .rejects.toMatchObject({ reason: "unsupported-action" });
    mocks.configured.mockReturnValue(false);
    await expect(run()).rejects.toMatchObject({ reason: "service-not-configured" });
    mocks.configured.mockReturnValue(true);
    mocks.exists.mockResolvedValue(false);
    await expect(run()).rejects.toMatchObject({ reason: "video-not-found" });
    expect(jobs).toHaveLength(0);
  });

  it("leaves quota visible when FreeSki is unhealthy while disabling submission", async () => {
    mocks.available.mockResolvedValue({ configured: true, available: false });
    expect(await getAccountVideoAnalysisState(customer)).toMatchObject({ quota: { remaining: 3 }, canAnalyze: false, canUpload: true });
  });

  it("requires a current existing non-disabled account under its row lock", async () => {
    await expect(lockedAccount("missing", async () => true)).rejects.toMatchObject({ reason: "not-found" });
    users[0].disabledAt = now;
    await expect(getAccountVideoAnalysisState(customer)).rejects.toMatchObject({ reason: "forbidden" });
    expect(mocks.lock).toHaveBeenCalled();
    expect(mocks.scheduler).not.toHaveBeenCalled();
    expect(mocks.available).not.toHaveBeenCalled();
    expect(mocks.catalog).not.toHaveBeenCalled();
  });
});

describe("instructor issuance authority and immutable ledger", () => {
  it("normalizes registered addresses and duplicate retries issue only once", async () => {
    const [a, b] = await Promise.all([issue({ recipientEmail: " CUSTOMER@EXAMPLE.COM ", note: " useful practice " }),
      issue({ note: "useful practice" })]);
    expect(a.grant.id).toBe(b.grant.id);
    expect(a.grant).toMatchObject({ quantity: 2, note: "useful practice", recipient: { email: "customer@example.com" }, coach: { name: "Coach display" } });
    expect(grants).toHaveLength(2);
    expect((await getAccountVideoAnalysisState(customer)).quota.grantTotal).toBe(5);
  });

  it.each([{ quantity: 1 }, { note: "different" }, { recipientEmail: "other@example.com" }])("rejects changed payload on the same request key (%j)", async (changes) => {
    await issue();
    await expect(issue(changes)).rejects.toMatchObject({ reason: "request-conflict" });
    expect(grants).toHaveLength(2);
  });

  it("treats null, empty and missing notes as the same request", async () => {
    const first = await issue({ note: null });
    expect((await issue({ note: "  " })).grant.id).toBe(first.grant.id);
    expect((await issue()).grant.id).toBe(first.grant.id);
  });

  it("rejects customer issuance and switched coach identities", async () => {
    await expect(issue({}, customer)).rejects.toMatchObject({ reason: "forbidden" });
    await expect(issue({ expectedCoachId: "other-coach" })).rejects.toMatchObject({ reason: "state-changed" });
    expect(grants).toHaveLength(1);
  });

  it.each(["demoted", "disabled"])("rechecks a %s instructor inside the issuance transaction", async (condition) => {
    if (condition === "demoted") users[1].role = "CUSTOMER";
    else users[1].disabledAt = now;
    await expect(issue()).rejects.toMatchObject({ reason: "forbidden" });
    expect(grants).toHaveLength(1);
  });

  it.each(["missing", "disabled", "coach"])("rejects %s recipients without creating accounts or grants", async (condition) => {
    if (condition === "missing") users = users.filter((user) => user.id !== "customer");
    if (condition === "disabled") users[0].disabledAt = now;
    if (condition === "coach") users[0].role = "COACH";
    await expect(issue()).rejects.toMatchObject({ reason: condition === "missing" ? "recipient-not-found" : "recipient-not-eligible" });
    expect(grants).toHaveLength(1);
  });

  it.each([0, -1, 1.5, 101, NaN, Infinity])("rejects invalid grant quantity %s", async (quantity) => {
    await expect(issue({ quantity })).rejects.toMatchObject({ reason: "invalid-quantity" });
    expect(grants).toHaveLength(1);
  });

  it("lets administrators issue their own grants and lists only that issuer's recent records", async () => {
    const admin = actor("admin", "ADMIN");
    await issue({}, admin);
    const listing = await listAccountAnalysisGrants(admin);
    expect(listing.coachId).toBe("admin");
    expect(listing.grants).toHaveLength(1);
    expect(mocks.grantMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: { coachId: "admin" }, take: 50 }));
    await expect(listAccountAnalysisGrants(customer)).rejects.toMatchObject({ reason: "forbidden" });
  });
});

describe("account reservations, leases and refunds", () => {
  it("claims only once and an incorrect lease cannot heartbeat, attach or settle", async () => {
    await run();
    const claimed = await claimAccountAnalysisJob();
    expect(claimed).toMatchObject({ accountId: "customer", actionId: "improvement:level2:parallel" });
    expect(await claimAccountAnalysisJob()).toBeNull();
    expect(await heartbeatAccountAnalysisJob(claimed!.id, "wrong-lease")).toBe(false);
    expect(await attachAccountUpstreamJobId(claimed!.id, "wrong-lease", "a".repeat(32))).toBe(false);
    expect(await settleAccountAnalysisJob(claimed!.id, "wrong-lease", { ok: true, result })).toBe(false);
    expect(jobs[0].status).toBe("RUNNING");
  });

  it("retains a true zero TECH grade as used once, including after video deletion", async () => {
    await run();
    const claimed = (await claimAccountAnalysisJob())!;
    expect(await heartbeatAccountAnalysisJob(claimed.id, claimed.leaseToken)).toBe(true);
    expect(await attachAccountUpstreamJobId(claimed.id, claimed.leaseToken, "a".repeat(32))).toBe(true);
    expect(await settleAccountAnalysisJob(claimed.id, claimed.leaseToken, { ok: true, result })).toBe(true);
    expect(await settleAccountAnalysisJob(claimed.id, claimed.leaseToken, { ok: true, result })).toBe(false);
    videos = [];
    jobs[0].videoId = null;
    jobs[0].result = null;
    expect((await getAccountVideoAnalysisState(customer)).quota).toMatchObject({ used: 1, remaining: 2 });
  });

  it.each(["failure", "ungradable", "invalid-score"])("refunds a %s outcome exactly once", async (condition) => {
    await run();
    const claimed = (await claimAccountAnalysisJob())!;
    const outcome = condition === "failure" ? { ok: false as const, errorCode: "secret-provider-error" }
      : { ok: true as const, result: { ...result, ...(condition === "ungradable" ? { gradingStatus: "unavailable" as const, scoreKind: null }
        : { score: NaN }) } };
    expect(await settleAccountAnalysisJob(claimed.id, claimed.leaseToken, outcome)).toBe(true);
    expect(await settleAccountAnalysisJob(claimed.id, claimed.leaseToken, outcome)).toBe(false);
    expect(jobs[0]).toMatchObject({ status: "FAILED", refundedAt: now });
    expect(JSON.stringify(jobs[0])).not.toContain("secret-provider-error");
    expect((await getAccountVideoAnalysisState(customer)).quota).toMatchObject({ used: 0, reserved: 0, remaining: 3 });
  });

  it("refunds a definitively unsubmitted closed action exactly once", async () => {
    jobs.push(job({ actionId: "carving" }));
    const claimed = (await claimAccountAnalysisJob("job"))!;
    const outcome = { ok: false as const, errorCode: "UNSUPPORTED_ACTION", expectedUnsubmittedActionId: "carving" };
    const settlements = await Promise.all([settleAccountAnalysisJob("job", claimed.leaseToken, outcome),
      settleAccountAnalysisJob("job", claimed.leaseToken, outcome)]);
    expect(settlements.filter(Boolean)).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ status: "FAILED", refundedAt: now,
      errorCode: "UNSUPPORTED_ACTION", upstreamJobId: null });
    expect((await getAccountVideoAnalysisState(customer)).quota).toMatchObject({ used: 0, reserved: 0, remaining: 3 });
  });

  it.each(["attached-upstream", "changed-action"])("does not refund closed-action evidence after a concurrent %s write", async (change) => {
    jobs.push(job({ status: "RUNNING", actionId: "carving", leaseToken: "lease", startedAt: now,
      leaseExpiresAt: new Date(now.getTime() + 15 * 60_000) }));
    const applyUpdate = mocks.jobUpdateMany.getMockImplementation()!;
    mocks.jobUpdateMany.mockImplementationOnce(async (query) => {
      if (change === "attached-upstream") jobs[0].upstreamJobId = "a".repeat(32);
      else jobs[0].actionId = "parallel";
      return applyUpdate(query);
    });
    expect(await settleAccountAnalysisJob("job", "lease", { ok: false, errorCode: "UNSUPPORTED_ACTION",
      expectedUnsubmittedActionId: "carving" })).toBe(false);
    expect(jobs[0]).toMatchObject({ status: "RUNNING", refundedAt: null, errorCode: null });
    expect((await getAccountVideoAnalysisState(customer)).quota).toMatchObject({ reserved: 1, remaining: 2 });
  });

  it.each(["queued", "lease", "hard-deadline"])("retains an expired %s reservation without refunding", async (condition) => {
    jobs.push(job(condition === "queued" ? { queuedExpiresAt: now } : { status: "RUNNING", leaseToken: "old",
      leaseExpiresAt: new Date(now.getTime() + (condition === "lease" ? 0 : 60_000)),
      startedAt: new Date(now.getTime() - (condition === "hard-deadline" ? 60 * 60_000 : 60_000)) }));
    expect(await recoverExpiredAccountAnalysisJobs()).toBe(condition === "queued" ? 0 : 1);
    expect(await recoverExpiredAccountAnalysisJobs()).toBe(0);
    expect(await settleAccountAnalysisJob("job", "old", { ok: true, result })).toBe(false);
    expect(jobs[0]).toMatchObject({ status: "QUEUED", refundedAt: null, errorCode: null });
    expect((await getAccountVideoAnalysisState(customer)).quota).toMatchObject({ reserved: 1, remaining: 2 });
    expect(await claimAccountAnalysisJob()).toMatchObject({ id: "job" });
  });

  it.each(["disabled", "deleted-video", "foreign-video", "unsupported-action"])("refunds a %s request before GPU submission", async (condition) => {
    jobs.push(job());
    if (condition === "disabled") users[0].disabledAt = now;
    if (condition === "deleted-video") videos = [];
    if (condition === "foreign-video") videos[0].accountId = "other";
    if (condition === "unsupported-action") jobs[0].actionId = "invented";
    expect(await claimAccountAnalysisJob()).toBeNull();
    expect(jobs[0]).toMatchObject({ status: "FAILED", refundedAt: now });
  });

  it("recovers disabled accounts' stale leases and supports an explicitly empty scope", async () => {
    users[0].disabledAt = now;
    jobs.push(job({ status: "RUNNING", leaseToken: "old", leaseExpiresAt: now, startedAt: now }));
    expect(await recoverExpiredAccountAnalysisJobs([])).toBe(0);
    expect(await recoverExpiredAccountAnalysisJobs(["other"])).toBe(0);
    expect(await recoverExpiredAccountAnalysisJobs(["customer"])).toBe(1);
    expect(jobs[0]).toMatchObject({ status: "QUEUED", refundedAt: null });
  });

  it("does not mint credits from an inconsistent terminal ledger", () => {
    expect(accountAnalysisQuota([grant({ quantity: 1 })], [job({ status: "FAILED" })])).toMatchObject({ remaining: 0, used: 0, reserved: 0 });
  });
});
