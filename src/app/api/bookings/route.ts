import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/require-user";
import { createBookingSchema, fieldErrors } from "@/lib/validators";
import { rateLimitOrRespond } from "@/lib/rate-limit";
import { createBooking } from "@/lib/booking/create";
import { checkSelfServeParticipant } from "@/lib/participants";
import { torontoWallTimeToUtc } from "@/lib/time";
import { toLocale } from "@/i18n/routing";
import { sendBookingConfirmation } from "@/lib/booking/notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const limited = rateLimitOrRespond(req, "booking", "create");
  if (limited) return limited;

  const r = await requireUser();
  if (!r.ok) return r.response;

  const parsed = createBookingSchema.safeParse(
    await req.json().catch(() => null),
  );
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
      birthDate: true,
      isSelf: true,
      archivedAt: true,
    },
  });
  if (!participant || participant.archivedAt) {
    return NextResponse.json({ error: "not-found" }, { status: 404 });
  }
  if (participant.accountId !== r.user.id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // Gate 2 and 4, re-checked against the lesson date rather than today.
  const lessonStartAt = torontoWallTimeToUtc(d.date, d.startHour);
  const check = checkSelfServeParticipant({
    birthDate: participant.birthDate,
    isSelf: participant.isSelf,
    lessonStartAt,
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
    headcount: d.headcount,
    locale,
    account: {
      id: r.user.id,
      participantId: participant.id,
      participantName: participant.fullName,
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

  return NextResponse.json({ ok: true, code: result.code }, { status: 201 });
}
