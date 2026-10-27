import { readJsonBodyOrResponse } from "@/lib/request-body";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCoach } from "@/lib/auth/require-user";
import { rateLimitOrRespond } from "@/lib/rate-limit";
import { coachCreateBookingSchema, fieldErrors } from "@/lib/validators";
import { createBooking } from "@/lib/booking/create";
import { inviteUrl } from "@/lib/waiver/invite";
import { buildCoachInvitationEmail } from "@/lib/booking/invitation-email";
import { baseUrl } from "@/lib/mail";
import { toLocale } from "@/i18n/routing";
import { attendeeInvitation } from "@/lib/booking/attendees";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A coach books a slot for a student.
 *
 * The booking is created in AWAITING_WAIVER; group signing ends the day before
 * the lesson. A one-time signing link is
 * issued to the student's email; they sign in with that address and sign for
 * themselves. The coach never signs on their behalf.
 */
export async function POST(req: Request) {
  const limited = rateLimitOrRespond(req, "booking", "coach-create");
  if (limited) return limited;

  const r = await requireCoach();
  if (!r.ok) return r.response;

  const jsonBody = await readJsonBodyOrResponse(req);
  if (!jsonBody.ok) return jsonBody.response;
  const parsed = coachCreateBookingSchema.safeParse(jsonBody.data);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation", fields: fieldErrors(parsed.error) },
      { status: 400 },
    );
  }
  const d = parsed.data;
  if ((!d.studentIsMinor &&
      d.studentEmail.trim().toLowerCase() === r.user.email.trim().toLowerCase()) ||
      d.additionalAttendees.some((a) => !a.isMinor && a.email === r.user.email.trim().toLowerCase())) {
    return NextResponse.json({ error: "student-email-must-differ" }, { status: 400 });
  }

  const locale = toLocale(req.headers.get("x-locale") ?? undefined);

  const result = await createBooking({
    coachId: r.user.id,
    dateKey: d.date,
    startHour: d.startHour,
    hours: d.hours,
    lessonType: d.lessonType,
    headcount: d.headcount,
    additionalAttendees: d.additionalAttendees,
    requestedSkills: d.requestedSkills,
    locale,
    invite: {
      name: d.studentName,
      email: d.studentEmail,
      isMinor: d.studentIsMinor,
    },
    notes: d.notes ?? null,
  });

  if (!result.ok) {
    const status = result.reason === "slot-taken" ? 409 : 400;
    return NextResponse.json({ error: result.reason }, { status });
  }

  if (!result.inviteToken) throw new Error("Coach booking has no signing token");
  const url = inviteUrl(result.inviteToken, locale);

  const profile = await prisma.coachProfile.findUnique({
    where: { userId: r.user.id },
    select: { displayName: true },
  });

  // The coach sends this fixed draft manually. No email is dispatched and no
  // sentAt is recorded merely because a draft was generated.
  const invitation = buildCoachInvitationEmail({
    code: result.code,
    to: d.studentEmail,
    studentName: d.studentName,
    isMinor: d.studentIsMinor,
    coachName: profile?.displayName ?? r.user.email,
    signingUrl: url,
    bookingUrl: `${baseUrl()}/${locale}/booking/${result.code}`,
    expiresAt: result.inviteExpiresAt,
    groupSigningOnly: d.headcount > 1,
  });

  // The plaintext token exists only here and in the link; it is never stored.
  return NextResponse.json(
    { ok: true, code: result.code, signingUrl: url, invitation, holdExpiresAt: result.holdExpiresAt,
      invitations: (result.attendeeInvites ?? []).map((a) =>
        attendeeInvitation(a, result.code, profile?.displayName ?? r.user.email, locale)) },
    { status: 201 },
  );
}
