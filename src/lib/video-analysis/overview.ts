import type { Prisma } from "@prisma/client";
import type { ActiveUser } from "../auth/require-user";
import { prisma } from "../prisma";
import { analysisQuota, includedAnalysisCredits } from "./quota";
import { recoverExpiredAnalysisJobs } from "./service";

/** Show spendable credits only for courses this identity may actually analyse. */
export async function getVideoAnalysisOverview(user: ActiveUser) {
  const where: Prisma.BookingWhereInput = {
    status: { in: ["CONFIRMED", "COMPLETED"] },
    ...(user.role === "ADMIN" ? {} : user.role === "COACH"
      ? { OR: [{ coachId: user.id }, { accountId: user.id }] }
      : { accountId: user.id }),
  };
  const owned = await prisma.booking.findMany({ where, select: { id: true } });
  // Match the per-course view: expired reservations must not hide usable credits.
  // The worker can recover all courses; this page recovers only the scoped rows.
  await recoverExpiredAnalysisJobs(owned.map((booking) => booking.id));
  const bookings = await prisma.booking.findMany({
    where,
    orderBy: { startAt: "desc" },
    select: {
      code: true, status: true, hours: true, headcount: true, startAt: true, accountId: true, coachId: true,
      lessonStartAt: true, lessonEndAt: true, participantNameSnapshot: true,
      coach: { select: { name: true, coachProfile: { select: { displayName: true } } } },
      resort: { select: { nameZh: true, nameEn: true } },
      analysisJobs: { select: { status: true, refundedAt: true } },
      analysisPurchases: { select: { status: true, quantity: true } },
    },
  });
  const courses = bookings.map(({ analysisJobs, analysisPurchases, coach, accountId, coachId, ...booking }) => ({
    ...booking,
    coachName: coach.coachProfile?.displayName ?? coach.name ?? "",
    includedCredits: includedAnalysisCredits(booking.hours),
    quota: analysisQuota(booking, analysisJobs, analysisPurchases),
    isCustomer: accountId === user.id,
    isOwnCoach: user.role === "ADMIN" || (user.role === "COACH" && coachId === user.id),
  })).sort((a, b) => Number(b.quota.active) - Number(a.quota.active));
  const totals = courses.reduce((sum, course) => ({
    remaining: sum.remaining + course.quota.remaining,
    freeTotal: sum.freeTotal + course.quota.freeTotal,
    paidTotal: sum.paidTotal + (course.quota.active ? course.quota.paidTotal : 0),
    used: sum.used + course.quota.used,
    reserved: sum.reserved + course.quota.reserved,
  }), { remaining: 0, freeTotal: 0, paidTotal: 0, used: 0, reserved: 0 });
  return { courses, totals };
}
