import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/require-user";
import { rateLimitOrRespond } from "@/lib/rate-limit";
import { fieldErrors, paymentProofSchema } from "@/lib/validators";
import { accessFor, loadBooking } from "@/lib/booking/access";
import { assertTransition } from "@/lib/booking/state";
import { KEY_PREFIX } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  ctx: RouteContext<"/api/bookings/[code]/payment">,
) {
  const limited = rateLimitOrRespond(req, "write", "payment");
  if (limited) return limited;

  const r = await requireUser();
  if (!r.ok) return r.response;

  const { code } = await ctx.params;
  const booking = await loadBooking(code);
  if (!booking) return NextResponse.json({ error: "not-found" }, { status: 404 });

  const access = accessFor(booking, r.user);
  if (!access.canView) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (!access.canPay) {
    return NextResponse.json({ error: "invalid-state" }, { status: 409 });
  }
  // A waiver must be on file first — that was the whole point of the sequence.
  if (!booking.waiverId) {
    return NextResponse.json({ error: "waiver-required" }, { status: 409 });
  }

  const parsed = paymentProofSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation", fields: fieldErrors(parsed.error) },
      { status: 400 },
    );
  }
  const d = parsed.data;

  // The key must be one this booking's upload produced. Without this check a
  // caller could point their booking at somebody else's stored screenshot.
  const expectedPrefix = `${KEY_PREFIX.proof(booking.id)}/`;
  if (!d.proofKey.startsWith(expectedPrefix) || d.proofKey.includes("..")) {
    return NextResponse.json({ error: "invalid-proof-key" }, { status: 400 });
  }

  assertTransition(booking.status, "PENDING_PAYMENT_REVIEW");

  await prisma.booking.update({
    where: { id: booking.id },
    data: {
      status: "PENDING_PAYMENT_REVIEW",
      paymentMethod: d.method,
      paymentProofKey: d.proofKey,
      paymentReference: d.reference?.trim() || null,
      paymentSubmittedAt: new Date(),
      proofUploadedBy: access.isCustomer ? "CUSTOMER" : "COACH",
      // Clear any previous rejection note so the coach sees a clean submission.
      reviewNote: null,
    },
  });

  return NextResponse.json({ ok: true });
}
