import { describe, expect, it } from "vitest";
import {
  buildNotifications, notificationLabel, NOTIFICATION_LIMIT,
  type NotificationBooking, type NotificationPackage,
} from "./notifications";
import { notificationReadStorageKey, parseNotificationReadKeys } from "./notification-read-state";

const now = new Date("2026-10-03T12:00:00Z");
const student = { id: "student", role: "CUSTOMER" as const };
const coach = { id: "coach", role: "COACH" as const };

function booking(overrides: Partial<NotificationBooking> = {}): NotificationBooking {
  return {
    code: "SKI-OWN", accountId: student.id, coachId: coach.id,
    status: "HOLD", waiverId: null,
    holdExpiresAt: new Date(now.getTime() + 30 * 60_000), updatedAt: now,
    paymentSubmittedAt: null, reviewedAt: null, cancelledAt: null,
    coachSummaryAt: null, ...overrides,
  };
}
function pkg(overrides: Partial<NotificationPackage> = {}): NotificationPackage {
  return {
    code: "PKG-OWN", accountId: student.id, payeeCoachId: coach.id,
    status: "AWAITING_PAYMENT", offerKey: "blue-mountain-4h", season: "2026-27",
    updatedAt: now, paymentSubmittedAt: null, reviewedAt: null, cancelledAt: null,
    ...overrides,
  };
}

describe("account-scoped notifications", () => {
  it("never reveals another student's record or a customer's assigned-coach records", () => {
    const notifications = buildNotifications(student, [
      booking(),
      booking({ code: "SKI-OTHER", accountId: "other", coachId: student.id, status: "PENDING_PAYMENT_REVIEW" }),
    ], [pkg({ code: "PKG-OTHER", accountId: "other", payeeCoachId: student.id, status: "PENDING_PAYMENT_REVIEW" })], now);
    expect(notifications.map((item) => item.code)).toEqual(["SKI-OWN"]);
    expect(Object.keys(notifications[0]).sort()).toEqual(["actionable", "code", "href", "key", "kind", "occurredAt"]);
  });

  it.each(["COACH", "ADMIN"] as const)("limits %s reviews to that user's own coaching records", (role) => {
    const notifications = buildNotifications({ ...coach, role }, [
      booking({ accountId: "first-student", status: "PENDING_PAYMENT_REVIEW" }),
      booking({ code: "SKI-OTHER-COACH", coachId: "other-coach", accountId: "second-student", status: "PENDING_PAYMENT_REVIEW" }),
      booking({ code: "SKI-CONFIRMED", accountId: "first-student", status: "CONFIRMED" }),
    ], [
      pkg({ accountId: "first-student", status: "PENDING_PAYMENT_REVIEW" }),
      pkg({ code: "PKG-OTHER-COACH", payeeCoachId: "other-coach", accountId: "second-student", status: "PENDING_PAYMENT_REVIEW" }),
    ], now);
    expect(notifications.map((item) => item.kind).sort()).toEqual(["coach-booking-payment", "coach-package-payment"]);
    expect(notifications.every((item) => item.actionable)).toBe(true);
  });

  it("offers waiver follow-up to the owning coach without exposing invite identities", () => {
    const notifications = buildNotifications(coach, [booking({ accountId: null, status: "AWAITING_WAIVER" })], [], now);
    expect(notifications[0].kind).toBe("coach-booking-waiver");
    expect(notifications[0].href).toBe("/booking/SKI-OWN");
  });

  it("keeps a partly signed group on the signature step", () => {
    const partial = booking({ status: "HOLD", waiverId: "purchaser-signed" });
    expect(buildNotifications(student, [partial], [], now)[0].kind).toBe("booking-waiver");
  });

  it("shows elapsed holds as expired instead of urging an impossible payment", () => {
    const notifications = buildNotifications(student, [booking({ status: "AWAITING_PAYMENT", holdExpiresAt: now })], [], now);
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({ kind: "booking-expired", actionable: false });
    expect(buildNotifications(coach, [booking({ status: "AWAITING_PAYMENT", holdExpiresAt: now })], [], now)).toEqual([]);
  });

  it("tells only the owning coach when a signed lesson is ready for receipt confirmation", () => {
    const signed = booking({ status: "AWAITING_PAYMENT", waiverId: "signed-waiver" });
    expect(buildNotifications(coach, [signed], [], now)[0]).toMatchObject({ kind: "coach-booking-receipt", actionable: true });
    expect(buildNotifications(coach, [booking({ status: "AWAITING_PAYMENT" })], [], now)).toEqual([]);
    expect(buildNotifications({ id: "other-coach", role: "COACH" }, [signed], [], now)).toEqual([]);
  });

  it("retains rejected payment actions after the original hold deadline", () => {
    const notifications = buildNotifications(student, [booking({ status: "PAYMENT_REJECTED", holdExpiresAt: new Date("2026-09-01T12:00:00Z") })], [], now);
    expect(notifications[0]).toMatchObject({ kind: "booking-payment-rejected", actionable: true });
  });

  it("keeps rejected package replacements actionable after the sale cutoff", () => {
    const afterCutoff = new Date("2026-12-02T12:00:00Z");
    expect(buildNotifications(student, [], [pkg({ status: "AWAITING_PAYMENT" })], afterCutoff)).toEqual([]);
    expect(buildNotifications(student, [], [pkg({ status: "PAYMENT_REJECTED" })], afterCutoff)[0])
      .toMatchObject({ kind: "package-payment-rejected", actionable: true });
  });

  it("uses each status transition's identity so a read submission does not hide rejection or confirmation", () => {
    const submitted = buildNotifications(student, [booking({ status: "PENDING_PAYMENT_REVIEW", paymentSubmittedAt: now })], [], now)[0];
    const reviewedAt = new Date(now.getTime() + 60_000);
    const rejected = buildNotifications(student, [booking({ status: "PAYMENT_REJECTED", reviewedAt })], [], reviewedAt)[0];
    const confirmed = buildNotifications(student, [booking({ status: "CONFIRMED", reviewedAt })], [], reviewedAt)[0];
    expect(new Set([submitted.key, rejected.key, confirmed.key]).size).toBe(3);
  });

  it("drops old informational states but retains old unfinished actions", () => {
    const old = new Date("2026-07-01T12:00:00Z");
    const notifications = buildNotifications(student, [
      booking({ code: "SKI-OLD-CONFIRMED", status: "CONFIRMED", reviewedAt: old, updatedAt: old }),
      booking({ code: "SKI-OLD-ACTION", status: "AWAITING_WAIVER", holdExpiresAt: null, updatedAt: old }),
    ], [pkg({ status: "ACTIVE", reviewedAt: old, updatedAt: old })], now);
    expect(notifications.map((item) => item.code)).toEqual(["SKI-OLD-ACTION"]);
  });

  it("keeps actions ahead of recent updates, de-duplicates and bounds the response", () => {
    const rows = Array.from({ length: NOTIFICATION_LIMIT + 5 }, (_, index) => booking({ code: `SKI-${index}`, status: "CONFIRMED" }));
    const action = booking({ code: "SKI-ACTION", status: "AWAITING_WAIVER", updatedAt: new Date("2026-09-01T12:00:00Z"), holdExpiresAt: null });
    const notifications = buildNotifications(student, [...rows, action, action], [], now);
    expect(notifications).toHaveLength(NOTIFICATION_LIMIT);
    expect(notifications[0].code).toBe("SKI-ACTION");
    expect(notifications.filter((item) => item.code === "SKI-ACTION")).toHaveLength(1);
    expect(notifications.every((item) => notificationLabel(item.kind, "zh") && notificationLabel(item.kind, "en"))).toBe(true);
  });

  it("shows new lesson feedback even when the lesson's confirmation is old", () => {
    const notifications = buildNotifications(student, [booking({ status: "CONFIRMED", reviewedAt: new Date("2026-07-01T12:00:00Z"), coachSummaryAt: now })], [], now);
    expect(notifications.map((item) => item.kind)).toEqual(["booking-feedback"]);
  });
});

describe("browser notification read identities", () => {
  it("separates each account's read storage and validates corrupted storage", () => {
    expect(notificationReadStorageKey("student")).not.toBe(notificationReadStorageKey("coach"));
    expect(notificationReadStorageKey("student")).toContain(":v1:");
    expect(parseNotificationReadKeys("not json")).toEqual([]);
    expect(parseNotificationReadKeys('{"email":"private"}')).toEqual([]);
    expect(parseNotificationReadKeys('["event","event",23,null]')).toEqual(["event"]);
  });
});
