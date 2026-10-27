import { describe, expect, it } from "vitest";
import { buildNotifications, notificationLabel, type NotificationCoachVideoReview } from "../notifications";
const now = new Date("2026-10-22T12:00:00Z");
const row: NotificationCoachVideoReview = { id: "review", accountId: "student", coachId: "coach", sourceVideoId: "video",
  status: "REQUESTED", createdAt: now, publishedAt: null, booking: null };
const inbox = (id: string, role: "CUSTOMER" | "COACH" | "ADMIN", overrides = {}) => buildNotifications({ id, role }, [], [], now,
  { jobs: [], purchases: [], reviews: [{ ...row, ...overrides }] });
describe("human video review inbox", () => {
  it("only the assigned coach gets an actionable request, without private prose", () => {
    expect(inbox("coach", "COACH")).toMatchObject([{ kind: "coach-video-review", actionable: true, href: "/coach/video-reviews" }]);
    expect(inbox("other", "COACH")).toEqual([]);
    expect(inbox("admin", "ADMIN")).toEqual([]);
    expect(inbox("student", "CUSTOMER")).toEqual([]);
    expect(Object.keys(inbox("coach", "COACH")[0]).sort()).toEqual(["actionable", "code", "href", "key", "kind", "occurredAt"]);
  });
  it("published feedback notifies only its owner and links to the exact video's feedback", () => {
    expect(inbox("student", "CUSTOMER", { status: "PUBLISHED", publishedAt: now })).toMatchObject([
      { kind: "human-video-review-published", actionable: false, href: "/video-analysis#coach-feedback-video" },
    ]);
    expect(inbox("other", "CUSTOMER", { status: "PUBLISHED", publishedAt: now })).toEqual([]);
    expect(inbox("student", "CUSTOMER", { status: "PUBLISHED", publishedAt: now, booking: { code: "SKI-TEST" } })[0].href).toBe("/video-analysis?lesson=SKI-TEST#coach-feedback-video");
  });
  it("cancellation removes the task and drafts never trigger a published notification", () => {
    expect(inbox("coach", "COACH", { status: "CANCELLED" })).toEqual([]);
    expect(inbox("student", "CUSTOMER", { status: "IN_REVIEW" })).toEqual([]);
    for (const kind of ["coach-video-review", "human-video-review-published"] as const) {
      expect(notificationLabel(kind, "zh")).toBeTruthy();
      expect(notificationLabel(kind, "en")).toBeTruthy();
    }
  });
});
