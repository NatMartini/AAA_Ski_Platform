import { describe, expect, it } from "vitest";
import { packagePaymentSchema, paymentProofSchema } from "./validators";

const KEY = "proofs/b1/c928d4a1-027e-417d-97fe-92fc8e1ebb11.webp";

describe("payment proof", () => {
  it("accepts WeChat with nothing attached: the coach confirms it in WeChat", () => {
    expect(paymentProofSchema.safeParse({ method: "WECHAT" }).success).toBe(true);
    expect(packagePaymentSchema.safeParse({ method: "WECHAT" }).success).toBe(true);
  });

  it("needs both the screenshot and the reference for an e-Transfer", () => {
    expect(
      paymentProofSchema.safeParse({ method: "EMT", proofKey: KEY, reference: "CA7Xk9" })
        .success,
    ).toBe(true);

    const noReference = paymentProofSchema.safeParse({ method: "EMT", proofKey: KEY });
    expect(noReference.success).toBe(false);
    expect(noReference.error?.issues.map((i) => i.path.join("."))).toEqual(["reference"]);

    const noScreenshot = packagePaymentSchema.safeParse({
      method: "EMT",
      reference: "CA7Xk9",
    });
    expect(noScreenshot.error?.issues.map((i) => i.path.join("."))).toEqual(["proofKey"]);
  });

  it("does not count a blank reference", () => {
    expect(
      paymentProofSchema.safeParse({ method: "ALIPAY", proofKey: KEY, reference: "   " })
        .success,
    ).toBe(false);
  });
});
