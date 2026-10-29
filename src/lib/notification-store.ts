import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import {
  buildNotifications,
  NOTIFICATION_LIMIT,
  notificationRecentSince,
  type NotificationUser,
} from "./notifications";

const bookingSelect = {
  code: true, accountId: true, coachId: true, status: true, waiverId: true,
  holdExpiresAt: true, updatedAt: true, paymentSubmittedAt: true,
  reviewedAt: true, cancelledAt: true, coachSummaryAt: true,
} satisfies Prisma.BookingSelect;
const packageSelect = {
  code: true, accountId: true, payeeCoachId: true, status: true,
  offerKey: true, season: true, updatedAt: true, paymentSubmittedAt: true,
  reviewedAt: true, cancelledAt: true,
} satisfies Prisma.LessonPackageSelect;

/** Current actions and recent updates; every query is bound to the current user. */
export async function loadNotifications(user: NotificationUser, now = new Date()) {
  const coach = user.role === "COACH" || user.role === "ADMIN";
  const bookingActions: Prisma.BookingWhereInput[] = [{
    accountId: user.id,
    OR: [
      { status: { in: ["AWAITING_WAIVER", "PAYMENT_REJECTED"] } },
      { status: { in: ["HOLD", "AWAITING_PAYMENT"] }, OR: [{ holdExpiresAt: null }, { holdExpiresAt: { gt: now } }] },
    ],
  }];
  const packageActions: Prisma.LessonPackageWhereInput[] = [{
    accountId: user.id,
    status: { in: ["AWAITING_PAYMENT", "PAYMENT_REJECTED"] },
  }];
  if (coach) {
    bookingActions.push({ coachId: user.id, OR: [
      { status: { in: ["PENDING_PAYMENT_REVIEW", "AWAITING_WAIVER", "PAYMENT_REJECTED"] } },
      { status: "AWAITING_PAYMENT", OR: [{ holdExpiresAt: null }, { holdExpiresAt: { gt: now } }] },
    ] });
    packageActions.push({ payeeCoachId: user.id, status: "PENDING_PAYMENT_REVIEW" });
  }
  const since = notificationRecentSince(now);
  const [actionBookings, recentBookings, actionPackages, recentPackages, analysisPurchases, analysisJobs, videoReviews, accountJobs] = await Promise.all([
    prisma.booking.findMany({
      where: { OR: bookingActions }, select: bookingSelect,
      orderBy: { updatedAt: "desc" }, take: NOTIFICATION_LIMIT,
    }),
    prisma.booking.findMany({
      where: {
        accountId: user.id,
        OR: [{ updatedAt: { gte: since }, status: { in: ["PENDING_PAYMENT_REVIEW", "CONFIRMED", "CANCELLED", "COMPLETED", "EXPIRED"] } },
          { coachSummaryAt: { gte: since } },
          { status: { in: ["HOLD", "AWAITING_PAYMENT"] }, holdExpiresAt: { gte: since, lte: now } }],
      },
      select: bookingSelect, orderBy: { updatedAt: "desc" }, take: NOTIFICATION_LIMIT,
    }),
    prisma.lessonPackage.findMany({
      where: { OR: packageActions }, select: packageSelect,
      orderBy: { updatedAt: "desc" }, take: NOTIFICATION_LIMIT,
    }),
    prisma.lessonPackage.findMany({
      where: {
        accountId: user.id, updatedAt: { gte: since },
        status: { in: ["PENDING_PAYMENT_REVIEW", "ACTIVE", "CANCELLED"] },
      },
      select: packageSelect, orderBy: { updatedAt: "desc" }, take: NOTIFICATION_LIMIT,
    }),
    prisma.videoAnalysisPurchase.findMany({
      where: { OR: [
        { accountId: user.id, OR: [
          { status: { in: ["AWAITING_PAYMENT", "PAYMENT_REJECTED"] } },
          { updatedAt: { gte: since }, status: { in: ["PENDING_PAYMENT_REVIEW", "CONFIRMED"] } },
        ] },
        ...(coach ? [{ payeeCoachId: user.id, status: "PENDING_PAYMENT_REVIEW" }] : []),
      ] },
      select: { id: true, accountId: true, payeeCoachId: true, status: true, updatedAt: true,
        paymentSubmittedAt: true, reviewedAt: true, booking: { select: { code: true } } },
      orderBy: { updatedAt: "desc" }, take: NOTIFICATION_LIMIT,
    }),
    prisma.videoAnalysisJob.findMany({
      where: { videoId: { not: null }, status: { in: ["SUCCEEDED", "FAILED"] }, finishedAt: { gte: since },
        booking: { OR: [{ accountId: user.id }, ...(coach ? [{ coachId: user.id }] : [])] } },
      select: { id: true, status: true, finishedAt: true,
        booking: { select: { code: true, accountId: true, coachId: true } } },
      orderBy: { finishedAt: "desc" }, take: NOTIFICATION_LIMIT,
    }),
    prisma.coachVideoReviewRequest.findMany({
      where: { account: { disabledAt: null }, OR: [
        { accountId: user.id, status: "PUBLISHED", publishedAt: { gte: since } },
        ...(coach ? [{ coachId: user.id, status: { in: ["REQUESTED", "IN_REVIEW"] as ("REQUESTED" | "IN_REVIEW")[] } }] : []),
      ], AND: [{ OR: [{ lessonVideoId: { not: null } }, { accountVideoId: { not: null } }] }] },
      select: { id: true, accountId: true, coachId: true, sourceVideoId: true, status: true,
        createdAt: true, publishedAt: true, booking: { select: { code: true } } },
      orderBy: { updatedAt: "desc" }, take: NOTIFICATION_LIMIT,
    }),
    prisma.accountAnalysisJob.findMany({
      where: { accountId: user.id, videoId: { not: null }, status: { in: ["SUCCEEDED", "FAILED"] }, finishedAt: { gte: since } },
      select: { id: true, status: true, finishedAt: true, accountId: true },
      orderBy: { finishedAt: "desc" }, take: NOTIFICATION_LIMIT,
    }),
  ]);
  return buildNotifications(user, [...actionBookings, ...recentBookings], [...actionPackages, ...recentPackages], now,
    { purchases: analysisPurchases, jobs: [...analysisJobs, ...accountJobs.map((job) => ({ ...job, booking: null }))], reviews: videoReviews });
}
