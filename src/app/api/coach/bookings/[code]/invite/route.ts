import { NextResponse } from "next/server";
import { readJsonBodyOrResponse } from "@/lib/request-body";
import { prisma } from "@/lib/prisma";
import { requireCoach } from "@/lib/auth/require-user";
import { rateLimitOrRespond } from "@/lib/rate-limit";
import { accessFor, loadBooking } from "@/lib/booking/access";
import { buildCoachInvitationEmail } from "@/lib/booking/invitation-email";
import { createInvite, inviteUrl } from "@/lib/waiver/invite";
import { baseUrl } from "@/lib/mail";
import { toLocale } from "@/i18n/routing";
import { reissueAttendeeInvite } from "@/lib/booking/attendees";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Regenerate a manual signing invitation without changing the reservation. */
export async function POST(
  req: Request,
  ctx: RouteContext<"/api/coach/bookings/[code]/invite">,
) {
  const limited = rateLimitOrRespond(req, "write", "coach-invite");
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
  if (booking.headcount > 1) {
    const primary = booking.attendees.find((a) => a.ordinal === 1);
    if (!primary) return NextResponse.json({ error: "incomplete-booking" }, { status: 409 });
    const result = await reissueAttendeeInvite(code, primary.id, r.user, toLocale(req.headers.get("x-locale") ?? undefined));
    if (!result.ok) return NextResponse.json({ error: result.reason }, {
      status: result.reason === "not-found" ? 404 : result.reason === "forbidden" ? 403 : 409,
    });
    return NextResponse.json({ ...result, invitations: [result] });
  }

  const result = await prisma.$transaction(async (tx) => {
    // Signing uses this same row lock when it checks and consumes the token.
    // A reissue either wins first and invalidates the old signing request, or
    // sees a finished booking and cannot reopen it.
    await tx.$queryRaw`
      SELECT "id" FROM "Booking" WHERE "id" = ${booking.id} FOR UPDATE
    `;
    const current = await tx.booking.findUnique({ where: { id: booking.id } });
    if (!current) return { error: "not-found" } as const;
    if (current.coachId !== r.user.id && r.user.role !== "ADMIN") {
      return { error: "forbidden" } as const;
    }
    if (current.status !== "AWAITING_WAIVER" || current.waiverId) {
      return { error: "invalid-state" } as const;
    }
    if (!current.inviteName || !current.inviteEmail) {
      return { error: "incomplete-booking" } as const;
    }
    const token = await createInvite({
      bookingId: current.id,
      email: current.inviteEmail,
    }, tx);
    return { booking: current, token } as const;
  });
  if ("error" in result) {
    const status = result.error === "not-found" ? 404
      : result.error === "forbidden" ? 403 : 409;
    return NextResponse.json({ error: result.error }, { status });
  }

  const locale = toLocale(req.headers.get("x-locale") ?? undefined);
  const url = inviteUrl(result.token, locale);
  const profile = await prisma.coachProfile.findUnique({
    where: { userId: result.booking.coachId },
    select: { displayName: true },
  });
  const invitation = buildCoachInvitationEmail({
    code,
    to: result.booking.inviteEmail!,
    studentName: result.booking.inviteName!,
    isMinor: result.booking.inviteIsMinor,
    coachName: profile?.displayName ?? booking.coach.name ?? booking.coach.email,
    signingUrl: url,
    bookingUrl: `${baseUrl()}/${locale}/booking/${code}`,
  });
  return NextResponse.json({ ok: true, code, signingUrl: url, invitation });
}
