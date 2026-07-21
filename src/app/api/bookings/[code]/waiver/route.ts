import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/require-user";
import { rateLimitOrRespond } from "@/lib/rate-limit";
import { fieldErrors, waiverSignSchema } from "@/lib/validators";
import { accessFor, loadBooking } from "@/lib/booking/access";
import { signWaiver } from "@/lib/waiver/sign";
import { clientIp } from "@/lib/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  ctx: RouteContext<"/api/bookings/[code]/waiver">,
) {
  const limited = rateLimitOrRespond(req, "write", "waiver-sign");
  if (limited) return limited;

  const r = await requireUser();
  if (!r.ok) return r.response;

  const { code } = await ctx.params;
  const booking = await loadBooking(code);
  if (!booking) return NextResponse.json({ error: "not-found" }, { status: 404 });

  const access = accessFor(booking, r.user);
  // Only the account holder signs through this route. A coach cannot sign for
  // a student — for coach-created bookings the student uses a signing link.
  if (!access.isCustomer) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (!booking.participant) {
    return NextResponse.json({ error: "no-participant" }, { status: 409 });
  }
  if (booking.waiverId) {
    return NextResponse.json({ error: "already-signed" }, { status: 409 });
  }
  if (!["HOLD", "AWAITING_WAIVER"].includes(booking.status)) {
    return NextResponse.json({ error: "invalid-state" }, { status: 409 });
  }

  const parsed = waiverSignSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation", fields: fieldErrors(parsed.error) },
      { status: 400 },
    );
  }
  const d = parsed.data;

  const result = await signWaiver({
    booking,
    participantId: booking.participant.id,
    participantName: booking.participant.fullName,
    participantBirthDate: booking.participant.birthDate,
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
    // Both recorded server-side. A client-supplied timestamp or address would
    // be worthless as evidence.
    ipAddress: clientIp(req),
    userAgent: req.headers.get("user-agent") ?? "unknown",
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
