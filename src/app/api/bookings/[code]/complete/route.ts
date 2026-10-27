import { NextResponse } from "next/server";
import { readJsonBodyOrResponse } from "@/lib/request-body";
import { prisma } from "@/lib/prisma";
import { requireCoach } from "@/lib/auth/require-user";
import { rateLimitOrRespond } from "@/lib/rate-limit";
import { accessFor, loadBooking } from "@/lib/booking/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Completion unlocks lesson analysis credits without changing payment data. */
export async function POST(
  req: Request,
  ctx: RouteContext<"/api/bookings/[code]/complete">,
) {
  const limited = rateLimitOrRespond(req, "write", "lesson-complete");
  if (limited) return limited;
  const r = await requireCoach();
  if (!r.ok) return r.response;
  const jsonBody = await readJsonBodyOrResponse(req, { allowEmpty: true });
  if (!jsonBody.ok) return jsonBody.response;
  const { code } = await ctx.params;
  const booking = await loadBooking(code);
  if (!booking) return NextResponse.json({ error: "not-found" }, { status: 404 });
  if (!accessFor(booking, r.user).isCoach) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (booking.status === "COMPLETED") return NextResponse.json({ ok: true });
  if (booking.status !== "CONFIRMED") {
    return NextResponse.json({ error: "invalid-state" }, { status: 409 });
  }
  const now = new Date();
  if (booking.lessonEndAt > now) {
    return NextResponse.json({ error: "lesson-not-ended" }, { status: 409 });
  }
  // The conditional update also protects against a concurrent cancellation.
  const completed = await prisma.booking.updateMany({
    where: { id: booking.id, coachId: booking.coachId, status: "CONFIRMED", lessonEndAt: { lte: now } },
    data: { status: "COMPLETED" },
  });
  if (completed.count !== 1) {
    const current = await prisma.booking.findUnique({ where: { id: booking.id }, select: { status: true } });
    if (current?.status !== "COMPLETED") {
      return NextResponse.json({ error: "state-changed" }, { status: 409 });
    }
  }
  return NextResponse.json({ ok: true });
}
