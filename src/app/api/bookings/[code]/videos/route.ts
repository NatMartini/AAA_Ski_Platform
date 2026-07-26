import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCoach } from "@/lib/auth/require-user";
import { rateLimitOrRespond } from "@/lib/rate-limit";
import { accessFor, loadBooking } from "@/lib/booking/access";
import { buildKey, KEY_PREFIX, writeObject } from "@/lib/storage";
import { checkVideo, MAX_VIDEO_BYTES, VideoRejected } from "@/lib/upload/video";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** More than this per booking is a sign something has gone wrong. */
const MAX_VIDEOS_PER_BOOKING = 12;

/**
 * The coach uploads a clip from the lesson.
 *
 * Coach-only in both directions: only the coach can add one, and the files
 * live outside public/ so the only way back in is the authenticated GET
 * alongside this route. A student's ski video is not something to leave on a
 * guessable URL.
 */
export async function POST(
  req: Request,
  ctx: RouteContext<"/api/bookings/[code]/videos">,
) {
  const limited = rateLimitOrRespond(req, "upload", "lesson-video");
  if (limited) return limited;

  const r = await requireCoach();
  if (!r.ok) return r.response;

  const { code } = await ctx.params;
  const booking = await loadBooking(code);
  if (!booking) return NextResponse.json({ error: "not-found" }, { status: 404 });

  const access = accessFor(booking, r.user);
  if (!access.isCoach) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const existing = await prisma.lessonVideo.count({
    where: { bookingId: booking.id },
  });
  if (existing >= MAX_VIDEOS_PER_BOOKING) {
    return NextResponse.json({ error: "too-many" }, { status: 409 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "invalid-form" }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "no-file" }, { status: 400 });
  }
  // Checked before reading the body into memory as well as after, so an
  // oversized upload is rejected without buffering all of it.
  if (file.size > MAX_VIDEO_BYTES) {
    return NextResponse.json({ error: "too-large" }, { status: 413 });
  }

  const caption = form.get("caption");
  const buf = Buffer.from(await file.arrayBuffer());

  let checked;
  try {
    checked = checkVideo(buf, file.type);
  } catch (err) {
    if (err instanceof VideoRejected) {
      return NextResponse.json(
        { error: err.code },
        { status: err.code === "too-large" ? 413 : 400 },
      );
    }
    throw err;
  }

  const key = buildKey(KEY_PREFIX.video(booking.id), checked.extension);
  const written = await writeObject(key, buf);

  const video = await prisma.lessonVideo.create({
    data: {
      bookingId: booking.id,
      storageKey: written.key,
      contentType: checked.contentType,
      bytes: written.bytes,
      caption:
        typeof caption === "string" && caption.trim()
          ? caption.trim().slice(0, 200)
          : null,
      uploadedById: r.user.id,
    },
    select: { id: true, caption: true, bytes: true, uploadedAt: true },
  });

  return NextResponse.json(video, { status: 201 });
}
