/**
 * What a payment screenshot is for: a booking or a lesson package. Both go
 * through the same upload, submit and review steps, at different addresses.
 */
export type PaymentTarget = { kind: "booking" | "package"; code: string };

export function paymentPaths(target: PaymentTarget) {
  const api =
    target.kind === "booking"
      ? `/api/bookings/${target.code}`
      : `/api/packages/${target.code}`;
  return {
    submit: `${api}/payment`,
    review: `${api}/review`,
    proof: `${api}/proof`,
    /** The page to return to afterwards. */
    page:
      target.kind === "booking"
        ? `/booking/${target.code}`
        : `/packages/${target.code}`,
    /** Form fields for /api/upload. */
    upload:
      target.kind === "booking"
        ? { purpose: "payment-proof", field: "bookingCode" }
        : { purpose: "package-proof", field: "packageCode" },
  } as const;
}
