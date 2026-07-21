import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/require-user";
import { accessFor, loadBooking } from "@/lib/booking/access";
import { contentTypeForKey, readObject } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Streams a payment screenshot.
 *
 * These live outside public/ precisely so this check exists: a screenshot of
 * an e-Transfer usually shows an account number and a balance, and must not be
 * readable by anyone who has the URL. Only the person who booked and the coach
 * teaching that lesson can fetch it.
 */
export async function GET(
  _req: Request,
  ctx: RouteContext<"/api/bookings/[code]/proof">,
) {
  const r = await requireUser();
  if (!r.ok) return r.response;

  const { code } = await ctx.params;
  const booking = await loadBooking(code);
  if (!booking?.paymentProofKey) {
    return NextResponse.json({ error: "not-found" }, { status: 404 });
  }

  const access = accessFor(booking, r.user);
  if (!access.canView) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    const body = await readObject(booking.paymentProofKey);
    return new NextResponse(new Uint8Array(body), {
      headers: {
        "Content-Type": contentTypeForKey(booking.paymentProofKey),
        "Content-Disposition": "inline",
        // private: a shared cache must never hold on to this.
        "Cache-Control": "private, no-store",
      },
    });
  } catch {
    return NextResponse.json({ error: "not-found" }, { status: 404 });
  }
}
