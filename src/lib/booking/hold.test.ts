import { describe, expect, it } from "vitest";
import { isSelfServeHoldExpired } from "./hold";

const NOW = new Date("2026-01-15T15:30:00.000Z");

describe("isSelfServeHoldExpired", () => {
  it.each(["HOLD", "AWAITING_PAYMENT"] as const)(
    "keeps the same deadline in %s",
    (status) => {
      expect(
        isSelfServeHoldExpired(
          {
            status,
            holdExpiresAt: new Date("2026-01-15T15:29:59.999Z"),
          },
          NOW,
        ),
      ).toBe(true);
    },
  );

  it("expires at the deadline, not one millisecond after it", () => {
    expect(
      isSelfServeHoldExpired(
        { status: "AWAITING_PAYMENT", holdExpiresAt: NOW },
        NOW,
      ),
    ).toBe(true);
  });

  it("keeps an awaiting-payment booking active before the deadline", () => {
    expect(
      isSelfServeHoldExpired(
        {
          status: "AWAITING_PAYMENT",
          holdExpiresAt: new Date("2026-01-15T15:30:00.001Z"),
        },
        NOW,
      ),
    ).toBe(false);
  });

  it("never expires a coach-created booking without a deadline", () => {
    expect(
      isSelfServeHoldExpired(
        { status: "AWAITING_PAYMENT", holdExpiresAt: null },
        NOW,
      ),
    ).toBe(false);
  });

  it("does not re-expire proof that is awaiting review or re-upload", () => {
    for (const status of [
      "PENDING_PAYMENT_REVIEW",
      "PAYMENT_REJECTED",
    ] as const) {
      expect(
        isSelfServeHoldExpired(
          {
            status,
            holdExpiresAt: new Date("2026-01-15T15:00:00.000Z"),
          },
          NOW,
        ),
      ).toBe(false);
    }
  });
});
