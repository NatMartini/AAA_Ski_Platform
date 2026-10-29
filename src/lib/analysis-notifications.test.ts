import { describe, expect, it } from "vitest";
import { buildNotifications, notificationLabel, type NotificationAnalysisJob, type NotificationAnalysisPurchase } from "./notifications";

const now = new Date("2026-10-06T18:00:00Z");
const purchase: NotificationAnalysisPurchase = {
  id: "purchase", accountId: "student", payeeCoachId: "coach", status: "PENDING_PAYMENT_REVIEW",
  updatedAt: now, paymentSubmittedAt: now, reviewedAt: null, booking: { code: "SKI-TEST" },
};
const job: NotificationAnalysisJob = {
  id: "analysis", status: "SUCCEEDED", finishedAt: now,
  booking: { code: "SKI-TEST", accountId: "student", coachId: "coach" },
};
function inbox(id: string, role: "COACH" | "CUSTOMER", overrides = {}) {
  return buildNotifications({ id, role }, [], [], now, { purchases: [purchase], jobs: [job], ...overrides });
}
describe("video analysis notifications", () => {
  it("notifies the paying student when results are ready or payment is under review", () => {
    expect(inbox("student", "CUSTOMER").map((item) => item.kind).sort()).toEqual(["analysis-payment-submitted", "analysis-ready"]);
  });
  it("makes only the payee's pending receipt actionable", () => {
    expect(inbox("coach", "COACH").filter((item) => item.actionable).map((item) => item.kind)).toEqual(["coach-analysis-payment"]);
    expect(inbox("other-coach", "COACH")).toEqual([]);
    expect(inbox("other-student", "CUSTOMER")).toEqual([]);
  });
  it("links failed analyses to the order without leaking result data", () => {
    const items = inbox("student", "CUSTOMER", { purchases: [], jobs: [{ ...job, status: "FAILED" }] });
    // A finished analysis opens on its own report page, inside the lesson's library.
    expect(items[0]).toMatchObject({ kind: "analysis-failed", href: `/video-analysis/report/${job.id}?lesson=SKI-TEST` });
    expect(Object.keys(items[0]).sort()).toEqual(["actionable", "code", "href", "key", "kind", "occurredAt"]);
  });
  it("tells a student about a finished personal analysis, and nobody else", () => {
    const personal = { ...job, id: "personal", booking: null, accountId: "student" };
    const mine = inbox("student", "CUSTOMER", { purchases: [], jobs: [personal] });
    expect(mine[0]).toMatchObject({ kind: "analysis-ready", code: "FreeSki", href: "/video-analysis/report/personal" });
    expect(inbox("coach", "COACH", { purchases: [], jobs: [personal] })).toEqual([]);
  });
  it("gives separate purchases independent unread identities", () => {
    const items = inbox("coach", "COACH", { jobs: [], purchases: [purchase, { ...purchase, id: "second" }] });
    expect(new Set(items.map((item) => item.key)).size).toBe(2);
    expect(items.every((item) => notificationLabel(item.kind, "zh") && notificationLabel(item.kind, "en"))).toBe(true);
  });
});
