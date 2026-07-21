import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sweepExpiredHolds } from "@/lib/booking/create";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Releases self-serve holds whose 30 minutes ran out.
 *
 * Booking creation already sweeps inside its own transaction, so a stale hold
 * never actually blocks a real booking. This job exists so the schedule and
 * availability views do not show slots as taken by bookings that are already
 * dead, and so the status is honest if the student comes back to look.
 *
 * Coach-created bookings have no holdExpiresAt and are never swept.
 */
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  const provided = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!secret || provided !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const swept = await sweepExpiredHolds(prisma, undefined, new Date());
  return NextResponse.json({ ok: true, expired: swept });
}
