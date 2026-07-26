import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/require-user";
import { rateLimitOrRespond } from "@/lib/rate-limit";
import { fieldErrors, waiverSignSchema } from "@/lib/validators";
import { checkInvite, consumeInvite } from "@/lib/waiver/invite";
import { loadBooking } from "@/lib/booking/access";
import { signWaiver } from "@/lib/waiver/sign";
import { identityKey } from "@/lib/participants";
import { clientIp } from "@/lib/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Signs a waiver through a coach-issued link.
 *
 * The student (or, for a minor, their guardian) must be signed in with the
 * exact address the link was issued to. On success we create the Participant
 * under *their* account, so from then on the waiver is theirs: future
 * self-serve bookings find it and skip signing, and it is not attached to the
 * coach or to anyone else's account.
 */
export async function POST(
  req: Request,
  ctx: RouteContext<"/api/waiver-invites/[token]">,
) {
  const limited = rateLimitOrRespond(req, "auth", "invite-sign");
  if (limited) return limited;

  const r = await requireUser();
  if (!r.ok) return r.response;

  const { token } = await ctx.params;
  const check = await checkInvite(token, r.user.email);
  if (!check.ok) {
    return NextResponse.json(
      { error: check.reason, expected: check.expected },
      { status: check.reason === "email-mismatch" ? 403 : 404 },
    );
  }

  const booking = await loadBooking(check.bookingCode);
  if (!booking || booking.status !== "AWAITING_WAIVER") {
    return NextResponse.json({ error: "invalid" }, { status: 409 });
  }
  if (!booking.inviteName) {
    return NextResponse.json({ error: "incomplete-booking" }, { status: 409 });
  }

  const parsed = waiverSignSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation", fields: fieldErrors(parsed.error) },
      { status: 400 },
    );
  }
  const d = parsed.data;

  const isMinor = booking.inviteIsMinor;

  // The participant belongs to whoever signed in. For a minor that is the
  // guardian's account (isSelf false); for an adult it is their own.
  const participant = await prisma.participant.upsert({
    where: {
      accountId_identityKey: {
        accountId: r.user.id,
        identityKey: identityKey(booking.inviteName),
      },
    },
    update: {},
    create: {
      accountId: r.user.id,
      fullName: booking.inviteName,
      isMinor,
      identityKey: identityKey(booking.inviteName),
      isSelf: !isMinor,
      email: isMinor ? null : r.user.email,
    },
  });

  const result = await signWaiver({
    booking,
    participantId: participant.id,
    participantName: participant.fullName,
    participantIsMinor: participant.isMinor,
    signerUserId: r.user.id,
    signerName: r.user.name ?? r.user.email,
    signerEmail: r.user.email,
    typedName: d.typedName,
    signatureImage: d.signatureImage,
    consentToElectronic: d.consentToElectronic,
    agreedCheckboxes: d.agreedCheckboxes,
    guardianName: d.guardianName ?? null,
    guardianPhone: d.guardianPhone ?? null,
    guardianRelationship: d.guardianRelationship ?? null,
    ipAddress: clientIp(req),
    userAgent: req.headers.get("user-agent") ?? "unknown",
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 400 });
  }

  // Attach the booking to the account that signed, so the student can see it
  // under "my bookings" and pay for it.
  await prisma.booking.update({
    where: { id: booking.id },
    data: {
      accountId: r.user.id,
      participantId: participant.id,
      participantNameSnapshot: participant.fullName,
    },
  });

  await consumeInvite(booking.id);

  return NextResponse.json({ ok: true, code: booking.code });
}
