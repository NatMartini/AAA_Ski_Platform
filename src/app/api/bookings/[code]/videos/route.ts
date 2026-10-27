import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/require-user";
import { rateLimitOrRespond } from "@/lib/rate-limit";
import { accessFor, loadBooking } from "@/lib/booking/access";
import { buildKey, deleteObject, KEY_PREFIX, writeObject } from "@/lib/storage";
import { checkVideo, MAX_VIDEO_BYTES, VideoRejected } from "@/lib/upload/video";
import { readLimitedFormData, requestBodyErrorResponse } from "@/lib/request-body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** More than this per booking is a sign something has gone wrong. */
const MAX_VIDEOS_PER_BOOKING = 100;

/**
 * The booking account or its instructor uploads a private lesson clip.
 * Uploading a video does not reserve or consume an analysis credit.
 */
export async function POST(
  req: Request,
  ctx: RouteContext<"/api/bookings/[code]/videos">,
) {
  const limited = rateLimitOrRespond(req, "upload", "lesson-video");
  if (limited) return limited;

  const r = await requireUser();
  if (!r.ok) return r.response;

  const { code } = await ctx.params;
  const booking = await loadBooking(code);
  if (!booking) return NextResponse.json({ error: "not-found" }, { status: 404 });

  const access = accessFor(booking, r.user);
  if (!access.isCustomer && !access.isCoach) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  if (!["CONFIRMED", "COMPLETED"].includes(booking.status)) {
    return NextResponse.json({ error: "invalid-state" }, { status: 409 });
  }

  let form: FormData;
  try {
    form = await readLimitedFormData(req, MAX_VIDEO_BYTES + 64 * 1024);
  } catch (error) {
    const response = requestBodyErrorResponse(error);
    if (response) return response;
    throw error;
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "no-file" }, { status: 400 });
  }
  // The envelope was stream-bounded above; enforce the file's own ceiling too.
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

  try {
    const outcome = await prisma.$transaction(async (tx) => {
      // Serialize the capacity check with uploads and other booking writes.
      await tx.$queryRaw`SELECT "id" FROM "Booking" WHERE "id" = ${booking.id} FOR UPDATE`;
      const current = await tx.booking.findUnique({ where: { id: booking.id } });
      if (!current || !["CONFIRMED", "COMPLETED"].includes(current.status)) {
        return { error: "invalid-state" } as const;
      }
      // A coach handoff may have bound the account between our two reads.
      if (r.user.role !== "ADMIN" && current.coachId !== r.user.id && current.accountId !== r.user.id) {
        return { error: "forbidden" } as const;
      }
      const existing = await tx.lessonVideo.count({ where: { bookingId: booking.id } });
      if (existing >= MAX_VIDEOS_PER_BOOKING) return { error: "too-many" } as const;
      const video = await tx.lessonVideo.create({
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
      return { video } as const;
    });
    if ("error" in outcome) {
      await deleteObject(written.key).catch(() => null);
      return NextResponse.json({ error: outcome.error }, { status: outcome.error === "forbidden" ? 403 : 409 });
    }
    return NextResponse.json(outcome.video, { status: 201 });
  } catch (err) {
    await deleteObject(written.key).catch(() => null);
    throw err;
  }
}
