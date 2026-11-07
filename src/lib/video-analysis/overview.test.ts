import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActiveUser } from "../auth/require-user";

const mocks = vi.hoisted(() => ({ findMany: vi.fn(), recover: vi.fn() }));
vi.mock("../prisma", () => ({ prisma: { booking: { findMany: mocks.findMany } } }));
vi.mock("./service", () => ({ recoverExpiredAnalysisJobs: mocks.recover }));
import { getVideoAnalysisOverview } from "./overview";

const viewer = (role: ActiveUser["role"]): ActiveUser => ({ id: "viewer", role, email: "viewer@test.example",
  name: "Viewer", image: null, phone: null, wechatId: null, tokenIssuedAt: null });
function course(id: string, overrides = {}) {
  return { id, accountId: "viewer", coachId: "coach", code: id, hours: 2, headcount: 3, status: "COMPLETED",
    startAt: new Date("2026-01-01T14:00:00Z"), lessonStartAt: new Date("2026-01-01T14:10:00Z"),
    lessonEndAt: new Date("2026-01-01T16:00:00Z"), participantNameSnapshot: "Student",
    resort: { nameZh: "雪场", nameEn: "Resort" }, coach: { name: "Coach", coachProfile: { displayName: "Kevin" } },
    analysisJobs: [] as { status: string; refundedAt: Date | null }[],
    analysisPurchases: [] as { status: string; quantity: number }[], ...overrides };
}
type Scope = { accountId?: string; OR?: { coachId?: string; accountId?: string }[]; status: { in: string[] } };
let records: ReturnType<typeof course>[];
beforeEach(() => {
  vi.resetAllMocks();
  records = [course("own"), course("assigned", { accountId: "other", coachId: "viewer", hours: 3 }),
    course("stranger", { accountId: "other", coachId: "another" }), course("cancelled", { status: "CANCELLED" })];
  mocks.recover.mockResolvedValue(0);
  mocks.findMany.mockImplementation(async ({ where, select }: { where: Scope; select: { id?: boolean } }) => {
    const found = records.filter(row => where.status.in.includes(row.status)
      && (!where.accountId || row.accountId === where.accountId)
      && (!where.OR || where.OR.some(scope => scope.accountId === row.accountId || scope.coachId === row.coachId)));
    if (select.id) return found.map(row => ({ id: row.id }));
    return found.map(({ id, accountId, coachId, ...row }) => {
      void id; void accountId; void coachId;
      return structuredClone(row);
    });
  });
});

describe("private video analysis overview", () => {
  it("restricts customers and demoted coaches to courses they ordered", async () => {
    const result = await getVideoAnalysisOverview(viewer("CUSTOMER"));
    expect(result.courses.map(row => row.code)).toEqual(["own"]);
    expect(mocks.recover).toHaveBeenCalledWith(["own"]);
    for (const [args] of mocks.findMany.mock.calls) expect(args.where.accountId).toBe("viewer");
  });
  it("shows a coach their assigned lessons and orders, without other coaches' balances", async () => {
    const result = await getVideoAnalysisOverview(viewer("COACH"));
    expect(result.courses.map(row => row.code)).toEqual(["own", "assigned"]);
    expect(mocks.recover).toHaveBeenCalledWith(["own", "assigned"]);
    expect(JSON.stringify(result)).not.toMatch(/analysisJobs|analysisPurchases|accountId|coachId/);
  });
  it("lets only current admins see all eligible course balances", async () => {
    const result = await getVideoAnalysisOverview(viewer("ADMIN"));
    expect(result.courses.map(row => row.code)).toEqual(["own", "assigned", "stranger"]);
  });
  it("reports each lesson's own analyses, with nothing to spend there (owner's decision, 2026-11-07)", async () => {
    records = [course("overused", { analysisJobs: Array.from({ length: 6 }, () => ({ status: "SUCCEEDED", refundedAt: null })) }),
      course("fresh", { hours: 3, analysisJobs: [{ status: "RUNNING", refundedAt: null }],
        analysisPurchases: [{ status: "CONFIRMED", quantity: 2 }, { status: "PENDING_PAYMENT_REVIEW", quantity: 10 }] }),
      course("future", { status: "CONFIRMED", hours: 3 })];
    const result = await getVideoAnalysisOverview(viewer("CUSTOMER"));
    expect(result.courses.map(row => row.quota)).toEqual([
      { active: true, freeTotal: 0, paidTotal: 0, used: 6, reserved: 0, remaining: 0 },
      { active: true, freeTotal: 0, paidTotal: 2, used: 0, reserved: 1, remaining: 0 },
      { active: false, freeTotal: 0, paidTotal: 0, used: 0, reserved: 0, remaining: 0 }]);
    expect(records[0].analysisJobs).toHaveLength(6);
  });
  it("recovers only scoped reservations before reading the current balance", async () => {
    records[0].analysisJobs.push({ status: "QUEUED", refundedAt: null });
    mocks.recover.mockImplementation(async (ids: string[]) => {
      expect(ids).toEqual(["own"]);
      Object.assign(records[0].analysisJobs[0], { status: "FAILED", refundedAt: new Date() });
      return 1;
    });
    expect((await getVideoAnalysisOverview(viewer("CUSTOMER"))).courses[0].quota.reserved).toBe(0);
    expect(mocks.findMany).toHaveBeenCalledTimes(2);
  });
  it("does not fall back to other accounts when no eligible course exists", async () => {
    records = [];
    expect(await getVideoAnalysisOverview(viewer("CUSTOMER"))).toMatchObject({ courses: [] });
    expect(mocks.recover).toHaveBeenCalledWith([]);
  });
});
