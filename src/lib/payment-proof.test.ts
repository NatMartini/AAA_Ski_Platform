import { beforeEach, describe, expect, it, vi } from "vitest";

const fakes = vi.hoisted(() => ({
  transaction: vi.fn(),
  queryRaw: vi.fn(),
  count: vi.fn(),
  remove: vi.fn(),
}));

vi.mock("./prisma", () => ({
  prisma: { $transaction: fakes.transaction },
}));

vi.mock("./storage", () => ({
  deleteObject: fakes.remove,
}));

import {
  deletePaymentProofIfUnreferenced,
  paymentProofBookingId,
} from "./payment-proof";

type FakeTransaction = {
  $queryRaw: typeof fakes.queryRaw;
  booking: { count: typeof fakes.count };
};

describe("payment proof cleanup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const tx: FakeTransaction = {
      $queryRaw: fakes.queryRaw,
      booking: { count: fakes.count },
    };
    fakes.transaction.mockImplementation(
      async (work: (transaction: FakeTransaction) => Promise<unknown>) =>
        work(tx),
    );
  });

  it("extracts only a server-shaped payment proof key", () => {
    expect(
      paymentProofBookingId(
        "proofs/booking_123/c928d4a1-027e-417d-97fe-92fc8e1ebb11.webp",
      ),
    ).toBe("booking_123");
    expect(paymentProofBookingId("videos/booking_123/clip.mp4")).toBeNull();
    expect(
      paymentProofBookingId("proofs/booking_123/../someone-else/image.webp"),
    ).toBeNull();
  });

  it("never deletes a proof which is still referenced", async () => {
    fakes.count.mockResolvedValue(1);

    const deleted = await deletePaymentProofIfUnreferenced(
      "proofs/booking123/c928d4a1-027e-417d-97fe-92fc8e1ebb11.webp",
    );

    expect(deleted).toBe(false);
    expect(fakes.queryRaw).toHaveBeenCalledOnce();
    expect(fakes.count).toHaveBeenCalledWith({
      where: {
        paymentProofKey:
          "proofs/booking123/c928d4a1-027e-417d-97fe-92fc8e1ebb11.webp",
      },
    });
    expect(fakes.remove).not.toHaveBeenCalled();
  });

  it("deletes an unreferenced proof while holding the booking lock", async () => {
    fakes.count.mockResolvedValue(0);
    fakes.remove.mockResolvedValue(undefined);
    const key =
      "proofs/booking123/c928d4a1-027e-417d-97fe-92fc8e1ebb11.webp";

    await expect(deletePaymentProofIfUnreferenced(key)).resolves.toBe(true);
    expect(fakes.queryRaw).toHaveBeenCalledOnce();
    expect(fakes.remove).toHaveBeenCalledWith(key);
  });

  it("ignores invalid keys without touching the database or filesystem", async () => {
    await expect(
      deletePaymentProofIfUnreferenced("proofs/booking123/../../waivers/a.pdf"),
    ).resolves.toBe(false);

    expect(fakes.transaction).not.toHaveBeenCalled();
    expect(fakes.remove).not.toHaveBeenCalled();
  });
});
