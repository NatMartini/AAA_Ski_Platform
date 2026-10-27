import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/require-user";
import { accessFor, loadBooking } from "@/lib/booking/access";
import { readObject } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Streams the signed waiver PDF.
 *
 * Carries a handwritten signature and an audit trail, so it
 * is never served statically. Downloadable by the signer and by the coach the
 * waiver was signed with — the coach needs a copy on file.
 */
export async function GET(
  req: Request,
  ctx: RouteContext<"/api/bookings/[code]/waiver-pdf">,
) {
  const r = await requireUser();
  if (!r.ok) return r.response;

  const { code } = await ctx.params;
  const booking = await loadBooking(code);
  if (!booking) {
    return NextResponse.json({ error: "not-found" }, { status: 404 });
  }

  const access = accessFor(booking, r.user);
  const attendeeId = new URL(req.url).searchParams.get("attendee");
  const attendee = attendeeId
    ? booking.attendees.find((row) => row.id === attendeeId)
    : null;
  const waiver = attendeeId ? attendee?.waiver : booking.waiver;
  if (!waiver) {
    return NextResponse.json({ error: "not-found" }, { status: 404 });
  }
  // A purchaser collects signature status, but does not gain access to
  // another adult's legal record. Guardians can download their own signatures.
  const canRead = attendeeId
    ? access.isAnyCoach || waiver.signerUserId === r.user.id
    : access.canView;
  if (!canRead) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    const body = await readObject(waiver.signedPdfKey);
    const name = attendee
      ? `waiver-${booking.code}-student-${attendee.ordinal}.pdf`
      : `waiver-${booking.code}.pdf`;
    return new NextResponse(new Uint8Array(body), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${name}"`,
        "Cache-Control": "private, no-store",
        Vary: "Cookie",
      },
    });
  } catch {
    return NextResponse.json({ error: "not-found" }, { status: 404 });
  }
}
