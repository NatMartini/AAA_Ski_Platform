import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/require-user";
import { rateLimitOrRespond } from "@/lib/rate-limit";
import { ImageRejected, MAX_INPUT_BYTES, processUpload } from "@/lib/upload/image";
import { buildKey, KEY_PREFIX, writeObject } from "@/lib/storage";
import { OCCUPYING_STATUSES } from "@/lib/booking/state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Accepts an image and returns a storage *key*, never a URL.
 *
 * Files land outside public/, so the only way to read one back is through a
 * route handler that checks the caller. See src/lib/storage.ts.
 *
 * Two purposes, each with its own authorisation:
 *   payment-proof — the booking's own customer, or that booking's coach
 *   payment-qr    — a coach, for their own profile
 */
export async function POST(req: Request) {
  const limited = rateLimitOrRespond(req, "upload", "upload");
  if (limited) return limited;

  const r = await requireUser();
  if (!r.ok) return r.response;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "invalid-form" }, { status: 400 });
  }

  const file = form.get("file");
  const purpose = form.get("purpose");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "no-file" }, { status: 400 });
  }
  if (file.size > MAX_INPUT_BYTES) {
    return NextResponse.json({ error: "too-large" }, { status: 413 });
  }

  let prefix: string;

  if (purpose === "payment-qr") {
    if (r.user.role !== "COACH" && r.user.role !== "ADMIN") {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    prefix = KEY_PREFIX.qr(r.user.id);
  } else if (purpose === "payment-proof") {
    const bookingCode = form.get("bookingCode");
    if (typeof bookingCode !== "string" || !bookingCode) {
      return NextResponse.json({ error: "missing-booking" }, { status: 400 });
    }
    const booking = await prisma.booking.findUnique({
      where: { code: bookingCode },
      select: { id: true, accountId: true, coachId: true, status: true },
    });
    if (!booking) {
      return NextResponse.json({ error: "not-found" }, { status: 404 });
    }
    // Only the person who booked it or the coach teaching it.
    const allowed =
      booking.accountId === r.user.id || booking.coachId === r.user.id;
    if (!allowed) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    if (!OCCUPYING_STATUSES.includes(booking.status)) {
      return NextResponse.json({ error: "invalid-state" }, { status: 409 });
    }
    prefix = KEY_PREFIX.proof(booking.id);
  } else {
    return NextResponse.json({ error: "unknown-purpose" }, { status: 400 });
  }

  const raw = Buffer.from(await file.arrayBuffer());

  let processed;
  try {
    // Re-encoding strips EXIF, which on a phone screenshot can include GPS.
    processed = await processUpload(raw, file.type);
  } catch (err) {
    if (err instanceof ImageRejected) {
      return NextResponse.json({ error: err.code }, { status: 400 });
    }
    throw err;
  }

  const key = buildKey(prefix, processed.extension);
  const written = await writeObject(key, processed.buffer);

  if (purpose === "payment-qr") {
    const kind = form.get("kind");
    const field = kind === "alipay" ? "alipayQrKey" : "wechatPayQrKey";
    await prisma.coachProfile.update({
      where: { userId: r.user.id },
      data: { [field]: key },
    });
  }

  return NextResponse.json(
    {
      key: written.key,
      bytes: written.bytes,
      width: processed.width,
      height: processed.height,
    },
    { status: 201 },
  );
}
