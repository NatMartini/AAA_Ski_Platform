import { NextResponse } from "next/server";
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
  if (!access.canView) {
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

/** The coach removes a clip they uploaded by mistake. */
export async function DELETE(
  req: Request,
  ctx: RouteContext<"/api/bookings/[code]/videos/[videoId]">,
) {
  const limited = rateLimitOrRespond(req, "write", "lesson-video-delete");
  if (limited) return limited;

  const r = await requireUser();
  if (!r.ok) return r.response;

  const { code, videoId } = await ctx.params;
  const booking = await loadBooking(code);
  if (!booking) return NextResponse.json({ error: "not-found" }, { status: 404 });

  const access = accessFor(booking, r.user);
  if (!access.isCoach) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const video = await prisma.lessonVideo.findFirst({
    where: { id: videoId, bookingId: booking.id },
  });
  if (!video) return NextResponse.json({ error: "not-found" }, { status: 404 });

  // Row first: an orphaned file on disk is harmless, a row pointing at a file
  // that no longer exists renders as a broken player.
  await prisma.lessonVideo.delete({ where: { id: video.id } });
  await deleteObject(video.storageKey).catch(() => null);

  return NextResponse.json({ ok: true });
}
