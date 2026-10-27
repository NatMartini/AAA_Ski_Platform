import { NextResponse } from "next/server";
import { readJsonBodyOrResponse } from "@/lib/request-body";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/require-user";
import { rateLimitOrRespond } from "@/lib/rate-limit";
import { accessFor, loadBooking } from "@/lib/booking/access";
import { deleteObject, readObject } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Streams a lesson clip to the student it belongs to, or the coach who filmed
 * it. Same reasoning as the payment screenshot route: the file lives outside
 * public/ so that this check is the only way to reach it.
 *
 * Served whole rather than with Range support. Clips are short, the audience
 * is two coaches and their students, and a partial-content implementation is
 * a lot of surface area for scrubbing a 40-second video.
 */
export async function GET(
  _req: Request,
  ctx: RouteContext<"/api/bookings/[code]/videos/[videoId]">,
) {
  const r = await requireUser();
  if (!r.ok) return r.response;

  const { code, videoId } = await ctx.params;
  const booking = await loadBooking(code);
  if (!booking) return NextResponse.json({ error: "not-found" }, { status: 404 });

  const access = accessFor(booking, r.user);
  if (!access.isCustomer && !(booking.coachId === r.user.id && ["COACH", "ADMIN"].includes(r.user.role))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // Scoped to the booking, so a valid id from someone else's lesson misses.
  const video = await prisma.lessonVideo.findFirst({
    where: { id: videoId, bookingId: booking.id },
  });
  if (!video) return NextResponse.json({ error: "not-found" }, { status: 404 });

  try {
    const body = await readObject(video.storageKey);
    return new NextResponse(new Uint8Array(body), {
      headers: {
        "Content-Type": video.contentType,
        "Content-Disposition": "inline",
        "Cache-Control": "private, no-store",
      },
    });
  } catch {
    return NextResponse.json({ error: "not-found" }, { status: 404 });
  }
}

/** The instructor, or a customer deleting their own upload, removes a clip. */
export async function DELETE(
  req: Request,
  ctx: RouteContext<"/api/bookings/[code]/videos/[videoId]">,
) {
  const limited = rateLimitOrRespond(req, "write", "lesson-video-delete");
  if (limited) return limited;

  const r = await requireUser();
  if (!r.ok) return r.response;
  const jsonBody = await readJsonBodyOrResponse(req, { allowEmpty: true });
  if (!jsonBody.ok) return jsonBody.response;

  const { code, videoId } = await ctx.params;
  const booking = await loadBooking(code);
  if (!booking) return NextResponse.json({ error: "not-found" }, { status: 404 });

  const access = accessFor(booking, r.user);
  if (!access.isCustomer && !access.isCoach) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const video = await prisma.lessonVideo.findFirst({
    where: { id: videoId, bookingId: booking.id },
  });
  if (!video) return NextResponse.json({ error: "not-found" }, { status: 404 });
  if (!access.isCoach && video.uploadedById !== r.user.id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // Row first: an orphaned file on disk is harmless, a row pointing at a file
  // that no longer exists renders as a broken player.
  const removed = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Booking" WHERE "id" = ${booking.id} FOR UPDATE`;
    const current = await tx.lessonVideo.findFirst({ where: { id: video.id, bookingId: booking.id } });
    if (!current) return { error: "not-found", status: 404 } as const;
    const pending = await tx.videoAnalysisJob.count({
      where: { videoId: video.id, status: { in: ["QUEUED", "RUNNING"] } },
    });
    if (pending > 0) return { error: "analysis-running", status: 409 } as const;
    // Keep the usage ledger while removing the report alongside its clip.
    // Otherwise deleting successful analyses would replenish free credits.
    await tx.videoAnalysisJob.updateMany({ where: { videoId: video.id }, data: { result: Prisma.DbNull } });
    await tx.lessonVideo.delete({ where: { id: video.id } });
    return { ok: true } as const;
  });
  if ("error" in removed) return NextResponse.json({ error: removed.error }, { status: removed.status });
  await deleteObject(video.storageKey).catch(() => null);

  return NextResponse.json({ ok: true });
}
