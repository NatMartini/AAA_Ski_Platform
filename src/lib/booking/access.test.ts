import { describe, expect, it, vi } from "vitest";
import type { ActiveUser } from "../auth/require-user";
vi.mock("../prisma", () => ({ prisma: {} }));
import { accessFor, type LoadedBooking } from "./access";
const user = (id: string, role: ActiveUser["role"]): ActiveUser => ({ id, role, email: `${id}@example.com`,
  name: id, image: null, phone: null, wechatId: null, tokenIssuedAt: null });
const booking = { accountId: "buyer", coachId: "coach", status: "AWAITING_PAYMENT" } as LoadedBooking;

describe("fresh booking role authority", () => {
  it("revokes privileged write permissions when the assigned coach is no longer a coach", () => {
    expect(accessFor(booking, user("coach", "CUSTOMER"))).toMatchObject({ isCoach: false,
      canView: false, canPay: false, canReview: false, canCancel: false });
  });
  it("keeps true purchaser rights when that account also used to be a coach", () => {
    expect(accessFor({ ...booking, accountId: "coach" }, user("coach", "CUSTOMER"))).toMatchObject({
      isCustomer: true, isCoach: false, canView: true, canPay: true, canCancel: true, canReview: false });
  });
  it("keeps other site coaches read-only and admins authorized", () => {
    expect(accessFor(booking, user("other", "COACH"))).toMatchObject({ isCoach: false,
      canView: true, canPay: false, canCancel: false });
    expect(accessFor(booking, user("admin", "ADMIN"))).toMatchObject({ isCoach: true, canPay: true });
  });
});
