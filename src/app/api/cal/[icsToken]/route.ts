import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { buildCalendar, type IcsEvent } from "@/lib/ics";
import { OCCUPYING_STATUSES } from "@/lib/booking/state";
import { formatMoneyShort } from "@/lib/pricing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A coach's schedule as an iCalendar feed.
 *
 * Authorised by the unguessable token in the path rather than a session,
 * because Google's calendar fetcher cannot log in. That makes the URL itself
 * the secret: it is only ever shown to the coach, with a warning not to share
 * it, and it can be rotated from the settings page.
 *
 * The events carry the *lesson* window (13:05–14:55), not the booked block, so
 * the calendar shows the time actually being taught.
 */
export async function GET(
  _req: Request,
  ctx: RouteContext<"/api/cal/[icsToken]">,
) {
  const { icsToken } = await ctx.params;

  const profile = await prisma.coachProfile.findUnique({
    where: { icsToken },
    select: { userId: true, displayName: true },
  });
  // Same response for an unknown token as for an empty calendar would leak
  // less, but a 404 here is fine: the token space is 128 bits.
  if (!profile) {
    return new NextResponse("Not found", { status: 404 });
  }

  const bookings = await prisma.booking.findMany({
    where: {
      coachId: profile.userId,
      status: { in: [...OCCUPYING_STATUSES, "CANCELLED", "COMPLETED"] },
    },
    include: { resort: true, participant: true },
    orderBy: { startAt: "asc" },
    take: 500,
  });

  const events: IcsEvent[] = bookings.map((b) => {
    const student =
      b.participantNameSnapshot ?? b.participant?.fullName ?? b.inviteName ?? "—";
    const cancelled = b.status === "CANCELLED";

    return {
      uid: `booking-${b.id}@aaa-ski`,
      // Any status change is a revision, so subscribers replace the event.
      sequence: Math.floor(b.updatedAt.getTime() / 1000) % 2_000_000_000,
      start: b.lessonStartAt,
      end: b.lessonEndAt,
      summary: `${student} · ${b.resort.nameEn}`,
      description: [
        `Booking: ${b.code}`,
        `Status: ${b.status}`,
        `Student: ${student}`,
        `Booked block: ${b.startAt.toISOString()} – ${b.endAt.toISOString()}`,
        `Fee: ${formatMoneyShort(b.totalCents)} ${b.currency}`,
        b.waiverId ? "Waiver: signed" : "Waiver: NOT SIGNED",
        b.notes ? `Notes: ${b.notes}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
      location: b.resort.address ?? b.resort.nameEn,
      cancelled,
      lastModified: b.updatedAt,
    };
  });

  const body = buildCalendar({
    name: `${profile.displayName} — ski lessons`,
    events,
  });

  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="schedule.ics"',
      "Cache-Control": "private, max-age=300",
      // Belt and braces: a feed URL should never end up in an index.
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}
