import { readJsonBodyOrResponse } from "@/lib/request-body";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/require-user";
import { rateLimitOrRespond } from "@/lib/rate-limit";
import { fieldErrors, waiverSignSchema } from "@/lib/validators";
import { checkInvite } from "@/lib/waiver/invite";
import { loadBooking } from "@/lib/booking/access";
import { signWaiver } from "@/lib/waiver/sign";
import { identityKey } from "@/lib/participants";
import { clientIp } from "@/lib/request";
import { areBookingWaiversValid } from "@/lib/booking/group-readiness";

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
  if (!booking || !["HOLD", "AWAITING_WAIVER"].includes(booking.status)) {
    return NextResponse.json({ error: "invalid" }, { status: 409 });
  }
  const fullName = check.fullName ?? booking.inviteName;
  if (!fullName) {
    return NextResponse.json({ error: "incomplete-booking" }, { status: 409 });
  }

  const jsonBody = await readJsonBodyOrResponse(req);
  if (!jsonBody.ok) return jsonBody.response;
  const parsed = waiverSignSchema.safeParse(jsonBody.data);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation", fields: fieldErrors(parsed.error) },
      { status: 400 },
    );
  }
  const d = parsed.data;

  const isMinor = check.isMinor ?? booking.inviteIsMinor;
  if (!isMinor) {
    const self = await prisma.participant.findFirst({ where: { accountId: r.user.id, isSelf: true, archivedAt: null },
      select: { identityKey: true } });
    if (self && self.identityKey !== identityKey(fullName)) {
      return NextResponse.json({ error: "participant-identity-mismatch" }, { status: 409 });
    }
  }

  // The participant belongs to whoever signed in. For a minor that is the
  // guardian's account (isSelf false); for an adult it is their own.
  const participant = await prisma.participant.upsert({
    where: {
      accountId_identityKey: {
        accountId: r.user.id,
        identityKey: identityKey(fullName),
      },
    },
    update: {},
    create: {
      accountId: r.user.id,
      fullName,
      isMinor,
      identityKey: identityKey(fullName),
      isSelf: !isMinor,
      email: isMinor ? null : r.user.email,
    },
  }).catch((error: unknown) => {
    if ((error as { code?: string }).code === "P2002") return null;
    throw error;
  });
  if (!participant) {
    return NextResponse.json({ error: "participant-identity-mismatch" }, { status: 409 });
  }
  // A pre-existing identity must agree with the invitation's signing role.
  // Otherwise the displayed guardian clauses could produce an adult waiver.
  if (participant.archivedAt || participant.isMinor !== isMinor || (!isMinor && !participant.isSelf)) {
    return NextResponse.json({ error: "participant-status-mismatch" }, { status: 409 });
  }

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
    inviteToken: token,
    attendeeId: check.attendeeId,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, {
      status: result.reason === "invalid-invite" ? 409 : 400,
    });
  }

  const updated = await loadBooking(booking.code);
  return NextResponse.json({ ok: true, code: booking.code,
    attendeeId: check.attendeeId, isPrimary: (check.ordinal ?? 1) === 1,
    isBookingOwner: updated?.accountId === r.user.id,
    allSigned: updated ? areBookingWaiversValid(updated) : false });
}
