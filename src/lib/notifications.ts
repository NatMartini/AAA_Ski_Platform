import type { BookingStatus, PackageStatus, UserRole } from "@prisma/client";
import { isSelfServeHoldExpired } from "./booking/hold";
import { isOfferOnSale } from "./packages";
import { toDateKey } from "./time";

export const NOTIFICATION_LIMIT = 40;
export const NOTIFICATION_RECENT_DAYS = 30;

export type NotificationKind =
  | "booking-waiver" | "booking-payment" | "booking-payment-rejected"
  | "booking-payment-submitted" | "booking-confirmed" | "booking-cancelled"
  | "booking-completed" | "booking-expired" | "booking-feedback"
  | "coach-booking-payment" | "coach-booking-waiver" | "coach-booking-receipt"
  | "package-payment" | "package-payment-rejected" | "package-payment-submitted"
  | "package-active" | "package-cancelled" | "coach-package-payment"
  | "analysis-ready" | "analysis-failed" | "analysis-payment" | "analysis-payment-submitted"
  | "analysis-payment-rejected" | "analysis-credits-confirmed" | "coach-analysis-payment"
  | "coach-video-review" | "human-video-review-published";

export type InboxNotification = {
  key: string;
  kind: NotificationKind;
  code: string;
  href: string;
  occurredAt: string;
  actionable: boolean;
};

export type NotificationUser = { id: string; role: UserRole };
export type NotificationBooking = {
  code: string;
  accountId: string | null;
  coachId: string;
  status: BookingStatus;
  waiverId: string | null;
  holdExpiresAt: Date | null;
  updatedAt: Date;
  paymentSubmittedAt: Date | null;
  reviewedAt: Date | null;
  cancelledAt: Date | null;
  coachSummaryAt: Date | null;
};
export type NotificationPackage = {
  code: string;
  accountId: string;
  payeeCoachId: string;
  status: PackageStatus;
  offerKey: string;
  season: string;
  updatedAt: Date;
  paymentSubmittedAt: Date | null;
  reviewedAt: Date | null;
  cancelledAt: Date | null;
};

export type NotificationAnalysisPurchase = {
  id: string; accountId: string; payeeCoachId: string; status: string; updatedAt: Date;
  paymentSubmittedAt: Date | null; reviewedAt: Date | null;
  booking: { code: string };
};
export type NotificationAnalysisJob = {
  id: string; status: string; finishedAt: Date | null;
  booking: { code: string; accountId: string | null; coachId: string };
};
export type NotificationCoachVideoReview = {
  id: string; accountId: string; coachId: string; sourceVideoId: string; status: string;
  createdAt: Date; publishedAt: Date | null; booking: { code: string } | null;
};

export function notificationRecentSince(now: Date): Date {
  return new Date(now.getTime() - NOTIFICATION_RECENT_DAYS * 24 * 3600_000);
}

/** Rechecks ownership before projecting minimal, safe-to-display inbox items. */
export function buildNotifications(
  user: NotificationUser,
  bookings: NotificationBooking[],
  packages: NotificationPackage[],
  now = new Date(),
  analysis: { purchases: NotificationAnalysisPurchase[]; jobs: NotificationAnalysisJob[]; reviews?: NotificationCoachVideoReview[] } = { purchases: [], jobs: [] },
): InboxNotification[] {
  const result: InboxNotification[] = [];
  const recentSince = notificationRecentSince(now).getTime();
  const coach = user.role === "COACH" || user.role === "ADMIN";
  function add(
    kind: NotificationKind,
    record: { code: string; updatedAt: Date },
    group: "booking" | "packages",
    actionable: boolean,
    occurredAt = record.updatedAt,
  ) {
    if (!actionable && occurredAt.getTime() < recentSince) return;
    const timestamp = occurredAt.toISOString();
    result.push({
      key: `${kind}:${record.code}:${timestamp}`,
      kind,
      code: record.code,
      href: `/${group}/${encodeURIComponent(record.code)}`,
      occurredAt: timestamp,
      actionable,
    });
  }

  for (const booking of bookings) {
    const expired = isSelfServeHoldExpired(booking, now);
    if (booking.accountId === user.id) {
      if (expired) {
        add("booking-expired", booking, "booking", false, booking.holdExpiresAt!);
      } else {
        switch (booking.status) {
          case "HOLD":
          case "AWAITING_WAIVER":
            add("booking-waiver", booking, "booking", true);
            break;
          case "AWAITING_PAYMENT":
            add("booking-payment", booking, "booking", true);
            break;
          case "PAYMENT_REJECTED":
            add("booking-payment-rejected", booking, "booking", true, booking.reviewedAt ?? booking.updatedAt);
            break;
          case "PENDING_PAYMENT_REVIEW":
            add("booking-payment-submitted", booking, "booking", false, booking.paymentSubmittedAt ?? booking.updatedAt);
            break;
          case "CONFIRMED":
            add("booking-confirmed", booking, "booking", false, booking.reviewedAt ?? booking.updatedAt);
            break;
          case "CANCELLED":
            add("booking-cancelled", booking, "booking", false, booking.cancelledAt ?? booking.updatedAt);
            break;
          case "COMPLETED":
            add("booking-completed", booking, "booking", false);
            break;
          case "EXPIRED":
            add("booking-expired", booking, "booking", false, booking.holdExpiresAt ?? booking.updatedAt);
            break;
        }
      }
      if (booking.coachSummaryAt) {
        add("booking-feedback", booking, "booking", false, booking.coachSummaryAt);
      }
    }
    if (coach && booking.coachId === user.id && !expired) {
      if (booking.status === "PENDING_PAYMENT_REVIEW") {
        add("coach-booking-payment", booking, "booking", true, booking.paymentSubmittedAt ?? booking.updatedAt);
      } else if (booking.status === "AWAITING_WAIVER") {
        add("coach-booking-waiver", booking, "booking", true);
      } else if (booking.waiverId && (booking.status === "AWAITING_PAYMENT" || booking.status === "PAYMENT_REJECTED")) {
        add("coach-booking-receipt", booking, "booking", true);
      }
    }
  }

  const today = toDateKey(now);
  for (const pkg of packages) {
    if (pkg.accountId === user.id) {
      switch (pkg.status) {
        case "AWAITING_PAYMENT":
          if (isOfferOnSale(pkg.offerKey, pkg.season, today)) {
            add("package-payment", pkg, "packages", true);
          }
          break;
        case "PAYMENT_REJECTED":
          add("package-payment-rejected", pkg, "packages", true, pkg.reviewedAt ?? pkg.updatedAt);
          break;
        case "PENDING_PAYMENT_REVIEW":
          add("package-payment-submitted", pkg, "packages", false, pkg.paymentSubmittedAt ?? pkg.updatedAt);
          break;
        case "ACTIVE":
          add("package-active", pkg, "packages", false, pkg.reviewedAt ?? pkg.updatedAt);
          break;
        case "CANCELLED":
          add("package-cancelled", pkg, "packages", false, pkg.cancelledAt ?? pkg.updatedAt);
          break;
      }
    }
    if (coach && pkg.payeeCoachId === user.id && pkg.status === "PENDING_PAYMENT_REVIEW") {
      add("coach-package-payment", pkg, "packages", true, pkg.paymentSubmittedAt ?? pkg.updatedAt);
    }
  }

  function addAnalysis(kind: NotificationKind, id: string, code: string, actionable: boolean, occurredAt: Date) {
    if (!actionable && occurredAt.getTime() < recentSince) return;
    const timestamp = occurredAt.toISOString();
    result.push({ key: `${kind}:${id}:${timestamp}`, kind, code,
      href: `/booking/${encodeURIComponent(code)}#video-analysis`, occurredAt: timestamp, actionable });
  }
  for (const purchase of analysis.purchases) {
    if (purchase.accountId === user.id) {
      const kind: Partial<Record<string, NotificationKind>> = {
        AWAITING_PAYMENT: "analysis-payment", PAYMENT_REJECTED: "analysis-payment-rejected",
        PENDING_PAYMENT_REVIEW: "analysis-payment-submitted", CONFIRMED: "analysis-credits-confirmed",
      };
      const label = kind[purchase.status];
      if (label) addAnalysis(label, purchase.id, purchase.booking.code,
        ["AWAITING_PAYMENT", "PAYMENT_REJECTED"].includes(purchase.status),
        purchase.reviewedAt ?? purchase.paymentSubmittedAt ?? purchase.updatedAt);
    }
    if (coach && purchase.payeeCoachId === user.id && purchase.status === "PENDING_PAYMENT_REVIEW") {
      addAnalysis("coach-analysis-payment", purchase.id, purchase.booking.code, true,
        purchase.paymentSubmittedAt ?? purchase.updatedAt);
    }
  }
  for (const job of analysis.jobs) {
    if (job.booking.accountId !== user.id && !(coach && job.booking.coachId === user.id)) continue;
    if (!job.finishedAt || !["SUCCEEDED", "FAILED"].includes(job.status)) continue;
    addAnalysis(job.status === "SUCCEEDED" ? "analysis-ready" : "analysis-failed", job.id,
      job.booking.code, false, job.finishedAt);
  }

  for (const review of analysis.reviews ?? []) {
    const reviewing = coach && review.coachId === user.id && ["REQUESTED", "IN_REVIEW"].includes(review.status);
    const published = review.accountId === user.id && review.status === "PUBLISHED" && review.publishedAt !== null;
    if (!reviewing && !published) continue;
    const occurredAt = reviewing ? review.createdAt : review.publishedAt!;
    if (!reviewing && occurredAt.getTime() < recentSince) continue;
    const kind = reviewing ? "coach-video-review" : "human-video-review-published";
    const query = review.booking ? `?lesson=${encodeURIComponent(review.booking.code)}` : "";
    result.push({ key: `${kind}:${review.id}:${occurredAt.toISOString()}`, kind,
      code: review.booking?.code ?? "FreeSki", actionable: reviewing,
      href: reviewing ? "/coach/video-reviews" : `/video-analysis${query}#coach-feedback-${encodeURIComponent(review.sourceVideoId)}`,
      occurredAt: occurredAt.toISOString() });
  }

  return [...new Map(result.map((item) => [item.key, item])).values()]
    .sort((a, b) => Number(b.actionable) - Number(a.actionable) || b.occurredAt.localeCompare(a.occurredAt) || a.key.localeCompare(b.key))
    .slice(0, NOTIFICATION_LIMIT);
}

const COPY: Record<NotificationKind, { zh: string; en: string }> = {
  "booking-waiver": { zh: "请签署课程免责协议", en: "Sign your lesson waiver" },
  "booking-payment": { zh: "课程等待付款", en: "Lesson payment needed" },
  "booking-payment-rejected": { zh: "课程付款未通过，请重新提交", en: "Lesson payment rejected — submit again" },
  "booking-payment-submitted": { zh: "课程付款已提交，等待确认", en: "Lesson payment submitted for review" },
  "booking-confirmed": { zh: "课程预约已确认", en: "Your lesson is confirmed" },
  "booking-cancelled": { zh: "课程预约已取消", en: "Your lesson was cancelled" },
  "booking-completed": { zh: "课程已完成", en: "Your lesson is complete" },
  "booking-expired": { zh: "课程预留时段已过期", en: "Your lesson hold expired" },
  "booking-feedback": { zh: "教练更新了课后反馈", en: "Your coach updated lesson feedback" },
  "coach-booking-payment": { zh: "有课程付款需要确认", en: "Review a lesson payment" },
  "coach-booking-waiver": { zh: "学员尚未签署免责协议", en: "A student still needs to sign their waiver" },
  "coach-booking-receipt": { zh: "课程已签字，等待收款确认", en: "Waiver signed — payment still needs confirmation" },
  "package-payment": { zh: "课时包等待付款", en: "Package payment needed" },
  "package-payment-rejected": { zh: "课时包付款未通过，请重新提交", en: "Package payment rejected — submit again" },
  "package-payment-submitted": { zh: "课时包付款已提交，等待确认", en: "Package payment submitted for review" },
  "package-active": { zh: "课时包付款已确认，可以使用", en: "Your package is ready to use" },
  "package-cancelled": { zh: "课时包订单已取消", en: "Your package was cancelled" },
  "coach-package-payment": { zh: "有课时包付款需要确认", en: "Review a package payment" },
  "analysis-ready": { zh: "FreeSki 视频分析已完成", en: "Your FreeSki analysis is ready" },
  "analysis-failed": { zh: "视频分析未完成，次数已返还", en: "Analysis could not finish — credit returned" },
  "analysis-payment": { zh: "额外视频分析次数等待付款", en: "Extra analysis credits need payment" },
  "analysis-payment-submitted": { zh: "视频分析付款已提交，等待教练确认", en: "Analysis payment submitted for review" },
  "analysis-payment-rejected": { zh: "视频分析付款未通过，请重新提交", en: "Analysis payment rejected — submit again" },
  "analysis-credits-confirmed": { zh: "额外视频分析次数已到账", en: "Extra analysis credits are ready" },
  "coach-analysis-payment": { zh: "有视频分析付款需要确认", en: "Review an analysis credit payment" },
  "coach-video-review": { zh: "学员申请了你的视频人工点评", en: "A student requested your video feedback" },
  "human-video-review-published": { zh: "教练已发布视频人工点评", en: "Your coach published video feedback" },
};

export function notificationLabel(kind: NotificationKind, locale: "zh" | "en"): string {
  return COPY[kind][locale];
}
