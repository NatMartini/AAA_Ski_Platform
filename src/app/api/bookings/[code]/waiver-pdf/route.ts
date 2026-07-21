import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/require-user";
import { accessFor, loadBooking } from "@/lib/booking/access";
import { readObject } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Streams the signed waiver PDF.
 *
 * Carries a handwritten signature, a date of birth and an audit trail, so it
 * is never served statically. Downloadable by the signer and by the coach the
 * waiver was signed with — the coach needs a copy on file.
 */
export async function GET(
  _req: Request,
  ctx: RouteContext<"/api/bookings/[code]/waiver-pdf">,
) {
  const r = await requireUser();
  if (!r.ok) return r.response;

  const { code } = await ctx.params;
  const booking = await loadBooking(code);
  if (!booking?.waiver) {
    return NextResponse.json({ error: "not-found" }, { status: 404 });
  }

  const access = accessFor(booking, r.user);
  if (!access.canView) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    const body = await readObject(booking.waiver.signedPdfKey);
    const name = `waiver-${booking.code}.pdf`;
    return new NextResponse(new Uint8Array(body), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${name}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch {
    return NextResponse.json({ error: "not-found" }, { status: 404 });
  }
}
