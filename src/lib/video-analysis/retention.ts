import { prisma } from "../prisma";
import { deleteObject } from "../storage";
import { expiredBefore } from "./season";

const BUSY = ["QUEUED", "RUNNING"];

/**
 * Deletes the footage of videos whose season has ended (see season.ts), everywhere or for one account or lesson:
 * the rows and the stored files. A video still being analysed waits for its analysis; analyses keep their reports,
 * unlinked from the video.
 */
export async function purgeExpiredVideos(scope: { accountId?: string; bookingCode?: string } = {}, now = new Date()) {
  const idle = { uploadedAt: { lt: expiredBefore(now) }, analysisJobs: { none: { status: { in: BUSY } } } };
  let removed = 0;
  if (!scope.bookingCode) {
    const videos = await prisma.accountAnalysisVideo.findMany({ where: { ...idle, ...(scope.accountId ? { accountId: scope.accountId } : {}) },
      select: { id: true, storageKey: true } });
    for (const video of videos) {
      // Checked again as it is deleted, so an analysis queued meanwhile keeps its video.
      if ((await prisma.accountAnalysisVideo.deleteMany({ where: { id: video.id, ...idle } })).count) {
        await deleteObject(video.storageKey).catch(() => null);
        removed++;
      }
    }
  }
  if (!scope.accountId) {
    const videos = await prisma.lessonVideo.findMany({ where: { ...idle, ...(scope.bookingCode ? { booking: { code: scope.bookingCode } } : {}) },
      select: { id: true, storageKey: true } });
    for (const video of videos) {
      if ((await prisma.lessonVideo.deleteMany({ where: { id: video.id, ...idle } })).count) {
        await deleteObject(video.storageKey).catch(() => null);
        removed++;
      }
    }
  }
  return removed;
}
