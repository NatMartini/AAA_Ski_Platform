import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCoach } from "@/lib/auth/require-user";
import { rateLimitOrRespond } from "@/lib/rate-limit";
import { coachCreateBookingSchema, fieldErrors } from "@/lib/validators";
import { createBooking } from "@/lib/booking/create";
import { createInvite, inviteUrl } from "@/lib/waiver/invite";
import { sendWaiverInviteEmail } from "@/lib/booking/notify";
import { isPlausibleBirthDate } from "@/lib/participants";
import { toLocale } from "@/i18n/routing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A coach books a slot for a student.
 *
 * The booking is created in AWAITING_WAIVER with no hold timer — the coach owns
 * the slot and chases the signature themselves. A one-time signing link is
 * issued to the student's email; they sign in with that address and sign for
 * themselves. The coach never signs on their behalf.
 */
export async function POST(req: Request) {
  const limited = rateLimitOrRespond(req, "booking", "coach-create");
  if (limited) return limited;

  const r = await requireCoach();
  if (!r.ok) return r.response;

  const parsed = coachCreateBookingSchema.safeParse(
    await req.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation", fields: fieldErrors(parsed.error) },
      { status: 400 },
    );
  }
  const d = parsed.data;

  if (!isPlausibleBirthDate(d.studentBirthDate)) {
    return NextResponse.json(
      { error: "validation", fields: { studentBirthDate: "implausible" } },
      { status: 400 },
    );
  }

  const locale = toLocale(req.headers.get("x-locale") ?? undefined);

  const result = await createBooking({
    coachId: r.user.id,
    dateKey: d.date,
    startHour: d.startHour,
    hours: d.hours,
    headcount: d.headcount,
    locale,
    invite: {
      name: d.studentName,
      email: d.studentEmail,
      birthDate: d.studentBirthDate,
    },
    notes: d.notes ?? null,
  });

  if (!result.ok) {
    const status = result.reason === "slot-taken" ? 409 : 400;
    return NextResponse.json({ error: result.reason }, { status });
  }

  const token = await createInvite({
    bookingId: result.id,
    email: d.studentEmail,
  });
  const url = inviteUrl(token, locale);

  const profile = await prisma.coachProfile.findUnique({
    where: { userId: r.user.id },
    select: { displayName: true },
  });

  // Sending is best-effort; the coach can always copy the link into WeChat,
  // which is how most of these will actually reach the student.
  await sendWaiverInviteEmail({
    code: result.code,
    to: d.studentEmail,
    studentName: d.studentName,
    coachName: profile?.displayName ?? r.user.email,
    signingUrl: url,
    locale,
  }).catch(() => null);

  await prisma.waiverInvite.update({
    where: { bookingId: result.id },
    data: { sentAt: new Date() },
  });

  // The plaintext token exists only here and in the link; it is never stored.
  return NextResponse.json(
    { ok: true, code: result.code, signingUrl: url },
    { status: 201 },
  );
}
