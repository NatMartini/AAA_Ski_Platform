import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCoach } from "@/lib/auth/require-user";
import { coachDaySchema, fieldErrors } from "@/lib/validators";
import { rateLimitOrRespond } from "@/lib/rate-limit";
import { dateKeyToDbDate, utcToTorontoParts } from "@/lib/time";
import { OCCUPYING_STATUSES } from "@/lib/booking/state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Create or update the coach's availability for one day. */
export async function PUT(req: Request) {
  const limited = rateLimitOrRespond(req, "write", "coach-availability");
  if (limited) return limited;

  const r = await requireCoach();
  if (!r.ok) return r.response;

  const parsed = coachDaySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation", fields: fieldErrors(parsed.error) },
      { status: 400 },
    );
  }
  const d = parsed.data;

  const resort = await prisma.resort.findUnique({
    where: { id: d.resortId },
    select: { id: true, isActive: true },
  });
  if (!resort?.isActive) {
    return NextResponse.json({ error: "unknown-resort" }, { status: 400 });
  }

  const date = dateKeyToDbDate(d.date);

  // Narrowing the window must not orphan a booking that is already outside it.
  const existing = await prisma.coachDay.findUnique({
    where: { coachId_date: { coachId: r.user.id, date } },
    select: { id: true },
  });

  if (existing) {
    const conflicts = await prisma.booking.findMany({
      where: { coachDayId: existing.id, status: { in: OCCUPYING_STATUSES } },
      select: { code: true, startAt: true, endAt: true },
      orderBy: { startAt: "asc" },
    });

    const outside = conflicts.filter((b) => {
      const start = utcToTorontoParts(b.startAt).hour;
      // An end at exactly midnight reads as hour 0; treat it as 24 so a
      // late booking is not mistaken for an early one.
      const endHour = utcToTorontoParts(b.endAt).hour;
      const end = endHour === 0 ? 24 : endHour;
      const outsideWindow = start < d.startHour || end > d.endHour;
      const hitsBreak =
        d.breakStartHour != null &&
        d.breakEndHour != null &&
        start < d.breakEndHour &&
        d.breakStartHour < end;
      return outsideWindow || hitsBreak;
    });

    if (outside.length > 0) {
      return NextResponse.json(
        {
          error: "conflicts-existing-bookings",
          bookings: outside.map((b) => b.code),
        },
        { status: 409 },
      );
    }
  }

  const day = await prisma.coachDay.upsert({
    where: { coachId_date: { coachId: r.user.id, date } },
    update: {
      resortId: d.resortId,
      startHour: d.startHour,
      endHour: d.endHour,
      breakStartHour: d.breakStartHour ?? null,
      breakEndHour: d.breakEndHour ?? null,
      hourlyRateCentsOverride: d.hourlyRateCentsOverride ?? null,
      note: d.note ?? null,
    },
    create: {
      coachId: r.user.id,
      resortId: d.resortId,
      date,
      startHour: d.startHour,
      endHour: d.endHour,
      breakStartHour: d.breakStartHour ?? null,
      breakEndHour: d.breakEndHour ?? null,
      hourlyRateCentsOverride: d.hourlyRateCentsOverride ?? null,
      note: d.note ?? null,
    },
  });

  return NextResponse.json({ ok: true, id: day.id });
}

/** Remove a day. Refused while it still holds live bookings. */
export async function DELETE(req: Request) {
  const limited = rateLimitOrRespond(req, "write", "coach-availability");
  if (limited) return limited;

  const r = await requireCoach();
  if (!r.ok) return r.response;

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "missing-id" }, { status: 400 });

  const day = await prisma.coachDay.findUnique({
    where: { id },
    select: { id: true, coachId: true },
  });
  if (!day) return NextResponse.json({ error: "not-found" }, { status: 404 });
  if (day.coachId !== r.user.id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const live = await prisma.booking.count({
    where: { coachDayId: id, status: { in: OCCUPYING_STATUSES } },
  });
  if (live > 0) {
    return NextResponse.json(
      { error: "has-bookings", count: live },
      { status: 409 },
    );
  }

  await prisma.coachDay.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
