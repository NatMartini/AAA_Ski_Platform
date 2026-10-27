import { readJsonBodyOrResponse } from "@/lib/request-body";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/require-user";
import { createBookingSchema, fieldErrors } from "@/lib/validators";
import { rateLimitOrRespond } from "@/lib/rate-limit";
import { createBooking } from "@/lib/booking/create";
import { checkSelfServeParticipant } from "@/lib/participants";
import { toLocale } from "@/i18n/routing";
import { sendBookingConfirmation } from "@/lib/booking/notify";
import { attendeeInvitation } from "@/lib/booking/attendees";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const limited = rateLimitOrRespond(req, "booking", "create");
  if (limited) return limited;

  const r = await requireUser();
  if (!r.ok) return r.response;
  if (r.user.role === "COACH" || r.user.role === "ADMIN") {
    return NextResponse.json({ error: "coach-booking-required" }, { status: 403 });
  }

  const jsonBody = await readJsonBodyOrResponse(req);
  if (!jsonBody.ok) return jsonBody.response;
  const parsed = createBookingSchema.safeParse(jsonBody.data);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation", fields: fieldErrors(parsed.error) },
      { status: 400 },
    );
  }
  const d = parsed.data;

  // The participant must belong to the caller. Passing someone else's id is
  // the obvious way to try to attach their signed waiver to your booking.
  const participant = await prisma.participant.findUnique({
    where: { id: d.participantId },
    select: {
      id: true,
      accountId: true,
      fullName: true,
      isMinor: true,
      isSelf: true,
      level: true,
      archivedAt: true,
    },
  });
  if (!participant || participant.archivedAt) {
    return NextResponse.json({ error: "not-found" }, { status: 404 });
  }
  if (participant.accountId !== r.user.id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // Gate 4, re-checked server side from the stored row rather than the client.
  const check = checkSelfServeParticipant({
    isMinor: participant.isMinor,
    isSelf: participant.isSelf,
  });
  if (!check.ok) {
    return NextResponse.json({ error: check.reason }, { status: 400 });
  }

  const locale = toLocale(
    req.headers.get("x-locale") ?? new URL(req.url).searchParams.get("locale") ?? undefined,
  );

  const result = await createBooking({
    coachId: d.coachId,
    dateKey: d.date,
    startHour: d.startHour,
    hours: d.hours,
    lessonType: d.lessonType,
    headcount: d.headcount,
    additionalAttendees: d.additionalAttendees,
    requestedSkills: d.requestedSkills,
    paymentPlan: d.paymentPlan,
    packageId: d.packageId ?? null,
    locale,
    account: {
      id: r.user.id,
      email: r.user.email,
      participantId: participant.id,
      participantName: participant.fullName,
      participantIsMinor: participant.isMinor,
      // Snapshot the ability the participant profile carries, so the coach
      // sees what to expect even if the student edits it later.
      level: participant.level,
    },
    notes: d.notes ?? null,
  });

  if (!result.ok) {
    const status = result.reason === "slot-taken" ? 409 : 400;
    return NextResponse.json({ error: result.reason }, { status });
  }

  // Best-effort: a mail failure must not undo a valid booking. The student can
  // always re-download the confirmation from the booking page.
  await sendBookingConfirmation(result.code, locale).catch(() => null);

  return NextResponse.json(
    { ok: true, code: result.code, nextStep: result.nextStep, holdExpiresAt: result.holdExpiresAt,
      invitations: (result.attendeeInvites ?? []).map((a) => attendeeInvitation(a, result.code, result.coachName ?? "", locale)) },
    { status: 201 },
  );
}
