import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CoachVideoReviewRequest } from "@prisma/client";
import type { ActiveUser } from "../auth/require-user";

const mock = vi.hoisted(() => ({ transaction: vi.fn(), findRequest: vi.fn(), findRequests: vi.fn(),
  createRequest: vi.fn(), updateRequest: vi.fn(), userFind: vi.fn(), usersFind: vi.fn(),
  sourceAccount: vi.fn(), sourceLesson: vi.fn(), bookings: vi.fn(), grants: vi.fn(), job: vi.fn(), lock: vi.fn() }));
vi.mock("../prisma", () => ({ prisma: { $transaction: mock.transaction,
  coachVideoReviewRequest: { findUnique: mock.findRequest, findMany: mock.findRequests } } }));
import { cancelCoachFeedback, getCoachFeedback, getCoachFeedbackState, getCoachFeedbackVideo,
  listAssignedCoachFeedback, requestCoachFeedback, updateCoachFeedback, VIDEO_REVIEW_CONSENT } from "./coach-feedback";

const actor = (id: string, role: ActiveUser["role"] = "CUSTOMER"): ActiveUser => ({ id, role, email: `${id}@example.com`,
  name: id, image: null, phone: null, wechatId: null, tokenIssuedAt: null });
const owner = actor("student"), coach = actor("coach", "COACH"), replacement = actor("replacement", "COACH");
const admin = actor("admin", "ADMIN"), stranger = actor("stranger");
const now = new Date("2026-10-22T12:00:00Z");
let rows: CoachVideoReviewRequest[];
let users: { id: string; role: string; disabledAt: Date | null; name: string; coachProfile: { displayName: string } | null }[];
let accountVideo: { id: string; accountId: string; storageKey: string; bytes: number; contentType: string; uploadedAt: Date; caption: string } | null;
let lessonVideo: { id: string; bookingId: string; storageKey: string; bytes: number; contentType: string; uploadedAt: Date; caption: string; booking: { id: string; accountId: string } } | null;
let relationship: string[];
let grants: string[];
let tail: Promise<unknown>;
let rowCounter: number;

function match(row: object, where: Record<string, unknown>): boolean {
  const object = row as Record<string, unknown>;
  return Object.entries(where).every(([key, value]) => {
    if (key === "accountId_requestKey") return match(row, value as Record<string, unknown>);
    if (typeof value === "object" && value !== null && "in" in value) return (value.in as unknown[]).includes(object[key]);
    return object[key] === value;
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  rows = []; rowCounter = 0; tail = Promise.resolve();
  users = [owner, coach, replacement, admin, stranger].map((user) => ({ id: user.id, role: user.role, name: user.id,
    disabledAt: null, coachProfile: ["COACH", "ADMIN"].includes(user.role) ? { displayName: user.id } : null }));
  relationship = [coach.id, replacement.id]; grants = [];
  accountVideo = { id: "personal", accountId: owner.id, storageKey: "private/personal.mp4", bytes: 42,
    contentType: "video/mp4", uploadedAt: now, caption: "Practice" };
  lessonVideo = { id: "lesson", bookingId: "booking", storageKey: "private/lesson.mp4", bytes: 84,
    contentType: "video/mp4", uploadedAt: now, caption: "Lesson", booking: { id: "booking", accountId: owner.id } };
  mock.userFind.mockImplementation(async ({ where }) => structuredClone(users.find((user) => user.id === where.id) ?? null));
  mock.usersFind.mockImplementation(async ({ where }) => structuredClone(users.filter((user) => where.id.in.includes(user.id) && !user.disabledAt && ["COACH", "ADMIN"].includes(user.role) && user.coachProfile)));
  mock.bookings.mockImplementation(async () => relationship.map((coachId) => ({ coachId })));
  mock.grants.mockImplementation(async () => grants.map((coachId) => ({ coachId })));
  mock.sourceAccount.mockImplementation(async ({ where }) => structuredClone(accountVideo && accountVideo.id === where.id && accountVideo.accountId === where.accountId ? accountVideo : null));
  mock.sourceLesson.mockImplementation(async ({ where }) => structuredClone(lessonVideo && lessonVideo.id === where.id && lessonVideo.booking.accountId === where.booking.accountId && (!where.booking.code || where.booking.code === "SKI-TEST") ? lessonVideo : null));
  mock.findRequest.mockImplementation(async ({ where }) => structuredClone(rows.find((row) => match(row, where)) ?? null));
  mock.findRequests.mockImplementation(async ({ where }) => structuredClone(rows.filter((row) => match(row, where)).reverse()));
  mock.job.mockResolvedValue(null);
  mock.createRequest.mockImplementation(async ({ data }) => {
    const row = { id: `review-${++rowCounter}`, revision: 1, consentedAt: now, createdAt: now, updatedAt: now,
      analysisSnapshot: null, draftText: null, publishedText: null, videoViewedAt: null, authoredAt: null,
      publishedAt: null, cancelledAt: null, ...data } as CoachVideoReviewRequest;
    rows.push(row); return structuredClone(row);
  });
  mock.updateRequest.mockImplementation(async ({ where, data }) => {
    const row = rows.find((row) => row.id === where.id)!;
    const { revision, ...other } = data;
    Object.assign(row, other);
    if (revision?.increment) row.revision += revision.increment;
    return structuredClone(row);
  });
  const tx = { $queryRaw: mock.lock, user: { findUnique: mock.userFind, findMany: mock.usersFind },
    accountAnalysisVideo: { findFirst: mock.sourceAccount }, lessonVideo: { findFirst: mock.sourceLesson },
    booking: { findMany: mock.bookings }, accountAnalysisGrant: { findMany: mock.grants },
    accountAnalysisJob: { findFirst: mock.job }, videoAnalysisJob: { findFirst: mock.job },
    coachVideoReviewRequest: { findUnique: mock.findRequest, findFirst: async ({ where }: { where: Record<string, unknown> }) => structuredClone(rows.find((row) => match(row, where)) ?? null),
      findMany: mock.findRequests, create: mock.createRequest, update: mock.updateRequest } };
  mock.transaction.mockImplementation((work) => {
    const next = tail.then(async () => {
      const snapshot = structuredClone(rows);
      try { return await work(tx); }
      catch (error) { rows = snapshot; throw error; }
    });
    tail = next.catch(() => undefined); return next;
  });
});

const input = (changes = {}) => ({ scope: "ACCOUNT" as const, videoId: "personal", expectedAccountId: owner.id,
  coachId: coach.id, requestKey: "request-1", consent: true as const, consentVersion: VIDEO_REVIEW_CONSENT,
  expectedCurrentId: null, expectedRevision: null, ...changes });
async function requested(changes = {}) { return (await requestCoachFeedback(owner, input(changes))).request; }
async function started() {
  const row = await requested();
  return (await updateCoachFeedback(row.id, coach, { action: "start", expectedRevision: row.revision })).request;
}

describe("optional human video feedback authorization", () => {
  it("starts NOT_REQUESTED and exposes no other account's clips", async () => {
    expect((await getCoachFeedbackState(owner, { scope: "ACCOUNT", videoId: "personal" })).status).toBe("NOT_REQUESTED");
    await expect(getCoachFeedbackState(stranger, { scope: "ACCOUNT", videoId: "personal" })).rejects.toMatchObject({ reason: "video-not-found" });
  });
  it("requires explicit consent and the current account", async () => {
    await expect(requested({ consent: false })).rejects.toMatchObject({ reason: "consent-required" });
    await expect(requested({ consentVersion: "old" })).rejects.toMatchObject({ reason: "consent-required" });
    await expect(requested({ expectedAccountId: stranger.id })).rejects.toMatchObject({ reason: "state-changed" });
    expect(rows).toHaveLength(0);
  });
  it("rejects an unrelated coach, including an administrator", async () => {
    await expect(requested({ coachId: admin.id })).rejects.toMatchObject({ reason: "coach-not-eligible" });
    await expect(requested({ coachId: owner.id })).rejects.toMatchObject({ reason: "coach-not-eligible" });
    expect(rows).toHaveLength(0);
  });
  it("grants permit selection but never reading footage before consent", async () => {
    relationship = []; grants = [coach.id];
    expect((await getCoachFeedbackState(owner, { scope: "ACCOUNT", videoId: "personal" })).coaches.map((item) => item.id)).toEqual([coach.id]);
    await expect(getCoachFeedbackVideo("uncreated", coach)).rejects.toMatchObject({ reason: "not-found" });
    const row = await requested();
    await expect(getCoachFeedback(row.id, replacement)).rejects.toMatchObject({ reason: "not-found" });
    await expect(getCoachFeedback(row.id, admin)).rejects.toMatchObject({ reason: "not-found" });
  });
  it("supports course clips without requiring course or AI completion", async () => {
    const row = await requested({ scope: "LESSON", videoId: "lesson", bookingCode: "SKI-TEST" });
    expect(row.scope).toBe("LESSON");
    expect(rows[0]).toMatchObject({ bookingId: "booking", lessonVideoId: "lesson", accountVideoId: null, analysisSnapshot: null });
    expect(mock.job).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ videoId: "lesson" }) }));
  });
  it("freezes report provenance without copying AI into a coach draft", async () => {
    mock.job.mockResolvedValue({ id: "ai-1", result: { coachingZh: ["AI text"] }, updatedAt: now });
    const row = await requested();
    expect(rows[0].analysisSnapshot).toEqual({ id: "ai-1", capturedVersionAt: now.toISOString(), result: { coachingZh: ["AI text"] } });
    expect(row).toMatchObject({ draftText: null, publishedText: null, hasAnalysisSnapshot: true });
    expect(row).not.toHaveProperty("analysisSnapshot");
  });
  it("keeps drafts private and denies owner impersonating a coach", async () => {
    const row = await started();
    await updateCoachFeedback(row.id, coach, { action: "save", expectedRevision: row.revision, text: "Private coach notes" });
    expect((await getCoachFeedback(row.id, owner)).request).toMatchObject({ draftText: null, publishedText: null });
    expect((await getCoachFeedback(row.id, coach)).request.draftText).toBe("Private coach notes");
    await expect(updateCoachFeedback(row.id, owner, { action: "save", expectedRevision: 3, text: "owner edits" })).rejects.toMatchObject({ reason: "forbidden" });
  });
  it("requires video access and personal authorship/publication attestations", async () => {
    const row = await started();
    const publish = { action: "publish" as const, expectedRevision: row.revision, text: "At 2s, practice gradual steering.",
      watchedVideo: true, authoredByMe: true, publishConfirmed: true };
    await expect(updateCoachFeedback(row.id, coach, publish)).rejects.toMatchObject({ reason: "review-attestation-required" });
    await getCoachFeedbackVideo(row.id, coach, true);
    await expect(updateCoachFeedback(row.id, coach, { ...publish, authoredByMe: false })).rejects.toMatchObject({ reason: "review-attestation-required" });
    await expect(updateCoachFeedback(row.id, coach, { ...publish, publishConfirmed: false })).rejects.toMatchObject({ reason: "review-attestation-required" });
    const result = await updateCoachFeedback(row.id, coach, publish);
    expect(result.request.status).toBe("PUBLISHED");
    expect((await getCoachFeedback(row.id, owner)).request.publishedText).toBe(publish.text);
    await expect(updateCoachFeedback(row.id, coach, { ...publish, expectedRevision: 3 })).rejects.toMatchObject({ reason: "invalid-state" });
  });
  it("withdraws all subsequent reviewer reads/media while preserving published history", async () => {
    const row = await started();
    await getCoachFeedbackVideo(row.id, coach, true);
    const published = await updateCoachFeedback(row.id, coach, { action: "publish", expectedRevision: 2, text: "Coach-authored feedback",
      watchedVideo: true, authoredByMe: true, publishConfirmed: true });
    await cancelCoachFeedback(row.id, owner, published.request.revision);
    await expect(getCoachFeedback(row.id, coach)).rejects.toMatchObject({ reason: "not-found" });
    await expect(getCoachFeedbackVideo(row.id, coach)).rejects.toMatchObject({ reason: "not-found" });
    expect((await getCoachFeedback(row.id, owner)).request).toMatchObject({ status: "CANCELLED", publishedText: "Coach-authored feedback" });
    expect((await listAssignedCoachFeedback(coach)).requests).toHaveLength(0);
  });
  it("replacement revokes the prior coach and preserves a new explicit assignment", async () => {
    const old = await requested();
    const next = await requested({ coachId: replacement.id, requestKey: "replacement", expectedCurrentId: old.id, expectedRevision: old.revision });
    expect(rows.map((row) => row.status)).toEqual(["CANCELLED", "REQUESTED"]);
    await expect(getCoachFeedback(old.id, coach)).rejects.toMatchObject({ reason: "not-found" });
    expect((await getCoachFeedback(next.id, replacement)).viewer).toBe("coach");
  });
  it("rechecks disabled accounts, current role, relationship and source identity", async () => {
    const row = await started();
    users.find((item) => item.id === coach.id)!.disabledAt = now;
    await expect(getCoachFeedback(row.id, coach)).rejects.toMatchObject({ reason: "forbidden" });
    users.find((item) => item.id === coach.id)!.disabledAt = null;
    users.find((item) => item.id === coach.id)!.role = "CUSTOMER";
    await expect(getCoachFeedback(row.id, coach)).rejects.toMatchObject({ reason: "not-found" });
    users.find((item) => item.id === coach.id)!.role = "COACH";
    relationship = [];
    await expect(getCoachFeedbackVideo(row.id, coach)).rejects.toMatchObject({ reason: "not-found" });
    relationship = [coach.id]; accountVideo!.bytes += 1;
    await expect(getCoachFeedbackVideo(row.id, coach)).rejects.toMatchObject({ reason: "video-not-found" });
    accountVideo = null;
    await expect(getCoachFeedback(row.id, coach)).rejects.toMatchObject({ reason: "video-not-found" });
  });
});

describe("serialized human review transitions", () => {
  it("deduplicates concurrent retries and never mutates analysis credits", async () => {
    const [first, second] = await Promise.all([requested(), requested()]);
    expect(first.id).toBe(second.id);
    expect(rows).toHaveLength(1);
    expect(mock.lock).toHaveBeenCalled();
    // The transactional repository exposes analysis ledgers as read-only;
    // credit reservation, payment review and model submission are absent.
    await expect(requested({ coachId: replacement.id })).rejects.toMatchObject({ reason: "request-conflict" });
  });
  it("prevents two simultaneous new requests to different coaches", async () => {
    const result = await Promise.allSettled([requested(), requested({ coachId: replacement.id, requestKey: "new-key" })]);
    expect(result.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    expect(rows.filter((row) => row.status !== "CANCELLED")).toHaveLength(1);
  });
  it("rejects stale saves after another draft update", async () => {
    const row = await started();
    const result = await Promise.allSettled([
      updateCoachFeedback(row.id, coach, { action: "save", expectedRevision: row.revision, text: "first" }),
      updateCoachFeedback(row.id, coach, { action: "save", expectedRevision: row.revision, text: "second" }),
    ]);
    expect(result.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    expect(rows[0].draftText).toBe("first");
  });
  it("a cancellation winning the lock prevents late publication", async () => {
    const row = await started();
    await getCoachFeedbackVideo(row.id, coach, true);
    const result = await Promise.allSettled([
      cancelCoachFeedback(row.id, owner, row.revision),
      updateCoachFeedback(row.id, coach, { action: "publish", expectedRevision: row.revision, text: "Late publication",
        watchedVideo: true, authoredByMe: true, publishConfirmed: true }),
    ]);
    expect(result[0].status).toBe("fulfilled");
    expect(result[1].status).toBe("rejected");
    expect(rows[0]).toMatchObject({ status: "CANCELLED", publishedText: null });
  });
});
