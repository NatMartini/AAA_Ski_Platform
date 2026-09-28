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
  it("lets every coach read a package, since any of them can teach from it", () => {
    const alisa = packageAccessFor(pkg, user("alisa", "COACH"), true, false);
    expect(alisa.canView).toBe(true);
  });

  it("keeps the screenshot and the review with the coach who was paid", () => {
    const alisa = packageAccessFor(pkg, user("alisa", "COACH"), true, false);
    expect(alisa).toMatchObject({
      isParty: false,
      canSeeProof: false,
      canReview: false,
      canCancel: false,
    });

    const kevin = packageAccessFor(pkg, user("kevin", "COACH"), true, false);
    expect(kevin).toMatchObject({ isParty: true, canSeeProof: true, canReview: true });
  });

  it("does not let a coach who was not paid upload proof for it", () => {
    const rejected = { ...pkg, status: "PAYMENT_REJECTED" } as const;
    expect(packageAccessFor(rejected, user("alisa", "COACH"), true, false).canPay).toBe(false);
    expect(packageAccessFor(rejected, user("kevin", "COACH"), true, false).canPay).toBe(true);
    expect(packageAccessFor(rejected, user("wei", "CUSTOMER"), true, false).canPay).toBe(true);
  });

  it("shows nothing to another student", () => {
    const other = packageAccessFor(pkg, user("lin", "CUSTOMER"), true, false);
    expect(other).toMatchObject({ canView: false, canSeeProof: false, canPay: false });
  });
});
