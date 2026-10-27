import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), load: vi.fn(), current: vi.fn(), update: vi.fn() }));
vi.mock("@/lib/auth/require-user", () => ({ requireUser: mocks.auth }));
vi.mock("@/lib/rate-limit", () => ({ rateLimitOrRespond: () => null }));
vi.mock("@/lib/package-store", () => ({ loadPackage: mocks.load,
  accessForPackage: () => ({ isParty: true, canPay: true }) }));
vi.mock("@/lib/storage", () => ({ KEY_PREFIX: { packageProof: (id: string) => `package-proofs/${id}` },
  objectExists: () => true }));
vi.mock("@/lib/payment-proof", () => ({ deletePaymentProofIfUnreferenced: vi.fn(),
  withPackageProofLock: async (_id: string, work: (tx: unknown) => unknown) => work({
    lessonPackage: { findUnique: mocks.current, update: mocks.update } }) }));
import { POST } from "./route";

const submittedVersion = new Date("2026-10-07T17:00:00.123Z");
beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue({ ok: true, user: { id: "coach", role: "COACH" } });
  mocks.load.mockResolvedValue({ id: "package", updatedAt: new Date("2026-10-07T16:00:00Z") });
  mocks.current.mockResolvedValue({ status: "AWAITING_PAYMENT", paymentProofKey: null });
  mocks.update.mockResolvedValue({ updatedAt: submittedVersion });
});
const submit = () => POST(new Request("http://localhost/api/packages/PACKAGE/payment", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ method: "WECHAT" }),
}), { params: Promise.resolve({ code: "PACKAGE" }) });

describe("exact package payment submission version", () => {
  it("returns the version written by this payment for a subsequent coach review", async () => {
    const response = await submit();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, updatedAt: submittedVersion.toISOString() });
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({
      select: { updatedAt: true }, data: expect.objectContaining({ status: "PENDING_PAYMENT_REVIEW" }),
    }));
    // Never fetch a later version after the transaction's exact submission.
    expect(mocks.load).toHaveBeenCalledOnce();
    expect(mocks.current).toHaveBeenCalledOnce();
  });
  it("does not produce a review version when another operation changed the state", async () => {
    mocks.current.mockResolvedValue({ status: "CANCELLED", paymentProofKey: null });
    const response = await submit();
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "invalid-state" });
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
