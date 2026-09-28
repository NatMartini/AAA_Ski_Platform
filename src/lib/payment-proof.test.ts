import { beforeEach, describe, expect, it, vi } from "vitest";

const fakes = vi.hoisted(() => ({
  transaction: vi.fn(),
  queryRaw: vi.fn(),
  count: vi.fn(),
  packageCount: vi.fn(),
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
  paymentProofOwner,
} from "./payment-proof";

type FakeTransaction = {
  $queryRaw: typeof fakes.queryRaw;
  booking: { count: typeof fakes.count };
  lessonPackage: { count: typeof fakes.packageCount };
};

describe("payment proof cleanup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const tx: FakeTransaction = {
      $queryRaw: fakes.queryRaw,
      booking: { count: fakes.count },
      lessonPackage: { count: fakes.packageCount },
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

  it("tells booking proofs from package proofs", () => {
    const uuid = "c928d4a1-027e-417d-97fe-92fc8e1ebb11";
    expect(paymentProofOwner(`proofs/b1/${uuid}.webp`)).toEqual({
      kind: "booking",
      id: "b1",
    });
    expect(paymentProofOwner(`package-proofs/p1/${uuid}.webp`)).toEqual({
      kind: "package",
      id: "p1",
    });
    // A package key is not a booking's, whatever id it carries.
    expect(paymentProofBookingId(`package-proofs/p1/${uuid}.webp`)).toBeNull();
  });

  it("checks package references before deleting a package proof", async () => {
    fakes.packageCount.mockResolvedValue(1);
    const key = "package-proofs/pkg1/c928d4a1-027e-417d-97fe-92fc8e1ebb11.webp";

    await expect(deletePaymentProofIfUnreferenced(key)).resolves.toBe(false);
    expect(fakes.packageCount).toHaveBeenCalledWith({
      where: { paymentProofKey: key },
    });
    expect(fakes.count).not.toHaveBeenCalled();
    expect(fakes.remove).not.toHaveBeenCalled();
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
