import type { BookingStatus } from "@prisma/client";

/**
 * The booking state machine. Every API route validates transitions through
 * `canTransition` rather than hand-rolling `if (status === ...)` checks, so the
 * rules live in exactly one place.
 *
 * Two entry points:
 *   HOLD             — student booked it themselves; expires if they stall.
 *   AWAITING_WAIVER  — coach booked it for a student; no expiry, the coach owns
 *                      the slot and chases the signature.
 */

/**
 * Statuses that occupy the coach's calendar. This list must stay in sync with
 * the `booking_no_overlap` exclusion constraint in the SQL migration — the
 * database is the real enforcement, this is for querying and display.
 */
export const OCCUPYING_STATUSES: BookingStatus[] = [
  "HOLD",
  "AWAITING_WAIVER",
  "AWAITING_PAYMENT",
  "PENDING_PAYMENT_REVIEW",
  "PAYMENT_REJECTED",
  "CONFIRMED",
];

/** Statuses where the booking is over or abandoned and frees the slot. */
export const TERMINAL_STATUSES: BookingStatus[] = [
  "EXPIRED",
  "CANCELLED",
  "COMPLETED",
];

export function occupiesSlot(status: BookingStatus): boolean {
  return OCCUPYING_STATUSES.includes(status);
}

/** Statuses from which the customer still has something to do. */
export function isActionableByCustomer(status: BookingStatus): boolean {
  return (
    status === "HOLD" ||
    status === "AWAITING_WAIVER" ||
    status === "AWAITING_PAYMENT" ||
    status === "PAYMENT_REJECTED"
  );
}

const TRANSITIONS: Record<BookingStatus, BookingStatus[]> = {
  HOLD: ["AWAITING_PAYMENT", "EXPIRED", "CANCELLED"],
  AWAITING_WAIVER: ["AWAITING_PAYMENT", "CANCELLED"],
  AWAITING_PAYMENT: ["PENDING_PAYMENT_REVIEW", "CONFIRMED", "EXPIRED", "CANCELLED"],
  PENDING_PAYMENT_REVIEW: ["CONFIRMED", "PAYMENT_REJECTED", "CANCELLED"],
  // Rejected proof keeps the slot so the student can re-upload.
  PAYMENT_REJECTED: ["PENDING_PAYMENT_REVIEW", "CONFIRMED", "CANCELLED"],
  CONFIRMED: ["COMPLETED", "CANCELLED"],
  EXPIRED: [],
  CANCELLED: [],
  COMPLETED: [],
};

export function canTransition(
  from: BookingStatus,
  to: BookingStatus,
): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: BookingStatus, to: BookingStatus): void {
  if (!canTransition(from, to)) {
    throw new BookingTransitionError(from, to);
  }
}

export class BookingTransitionError extends Error {
  constructor(
    readonly from: BookingStatus,
    readonly to: BookingStatus,
  ) {
    super(`Illegal booking transition ${from} -> ${to}`);
    this.name = "BookingTransitionError";
  }
}

// ── Display ──

const LABELS: Record<BookingStatus, { en: string; zh: string }> = {
  HOLD: { en: "Holding your slot", zh: "时段已锁定" },
  AWAITING_WAIVER: { en: "Waiver needed", zh: "待签免责协议" },
  AWAITING_PAYMENT: { en: "Payment needed", zh: "待付款" },
  PENDING_PAYMENT_REVIEW: { en: "Checking payment", zh: "待教练确认收款" },
  PAYMENT_REJECTED: { en: "Payment not accepted", zh: "付款未通过" },
  CONFIRMED: { en: "Confirmed", zh: "预定成功" },
  EXPIRED: { en: "Expired", zh: "已过期" },
  CANCELLED: { en: "Cancelled", zh: "已取消" },
  COMPLETED: { en: "Completed", zh: "已完成" },
};

export function statusLabel(
  status: BookingStatus,
  locale: "en" | "zh",
): string {
  return LABELS[status][locale];
}

/** Tailwind classes for the status pill. */
export function statusTone(status: BookingStatus): string {
  switch (status) {
    case "CONFIRMED":
    case "COMPLETED":
      return "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
    case "PENDING_PAYMENT_REVIEW":
      return "border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300";
    case "HOLD":
    case "AWAITING_WAIVER":
    case "AWAITING_PAYMENT":
      return "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300";
    case "PAYMENT_REJECTED":
      return "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300";
    default:
      return "border-neutral-400/40 bg-neutral-400/10 text-neutral-600 dark:text-neutral-400";
  }
}
