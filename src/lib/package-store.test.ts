import { describe, expect, it, vi } from "vitest";

vi.mock("./prisma", () => ({ prisma: {} }));

import { packageAccessFor } from "./package-store";
import type { ActiveUser } from "./auth/require-user";

const user = (id: string, role: ActiveUser["role"]): ActiveUser => ({
  id,
  email: `${id}@example.com`,
  name: id,
  image: null,
  role,
  phone: null,
  wechatId: null,
  tokenIssuedAt: null,
});

const pkg = { accountId: "wei", payeeCoachId: "kevin", status: "PENDING_PAYMENT_REVIEW" } as const;

describe("packageAccessFor", () => {
  it("lets the coach who was paid review it", () => {
    expect(packageAccessFor(pkg, user("kevin", "COACH"), true, false)).toMatchObject({
      canView: true,
      canReview: true,
    });
  });

  it("keeps a package away from a coach who was not paid", () => {
    // Other coaches see a student's hours left on the students page, not the
    // package itself, its screenshot or who else taught from it.
    expect(packageAccessFor(pkg, user("alisa", "COACH"), true, false)).toMatchObject({
      canView: false,
      canReview: false,
      canPay: false,
      canCancel: false,
    });
  });

  it("lets the buyer re-upload after a rejection, and nobody else but the paid coach", () => {
    const rejected = { ...pkg, status: "PAYMENT_REJECTED" } as const;
    expect(packageAccessFor(rejected, user("wei", "CUSTOMER"), true, false).canPay).toBe(true);
    expect(packageAccessFor(rejected, user("kevin", "COACH"), true, false).canPay).toBe(true);
    expect(packageAccessFor(rejected, user("alisa", "COACH"), true, false).canPay).toBe(false);
  });

  it("shows nothing to another student", () => {
    expect(packageAccessFor(pkg, user("lin", "CUSTOMER"), true, false).canView).toBe(false);
  });
});
