import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCoach } from "@/lib/auth/require-user";
import { rateLimitOrRespond } from "@/lib/rate-limit";
import { fieldErrors, settleBalanceSchema } from "@/lib/validators";
import { accessFor, loadBooking } from "@/lib/booking/access";
import { balanceCents } from "@/lib/booking/lesson";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The coach records the outstanding balance on a deposit booking as settled.
 *
 * Deliberately coach-only and deliberately not a payment flow: the balance is
 * handed over in person after the lesson, usually in cash or a quick
 * e-transfer, and the only thing the system can honestly record is the coach
 * saying "yes, I got it". A student cannot mark their own balance paid.
 */
export async function POST(
  req: Request,
  ctx: RouteContext<"/api/bookings/[code]/balance">,
) {
  const limited = rateLimitOrRespond(req, "write", "balance");
  if (limited) return limited;

  const r = await requireCoach();
  if (!r.ok) return r.response;

  const { code } = await ctx.params;
  const booking = await loadBooking(code);
  if (!booking) return NextResponse.json({ error: "not-found" }, { status: 404 });

  const access = accessFor(booking, r.user);
  if (!access.isCoach) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  // Only on a live booking that still owes something.
  if (!["CONFIRMED", "COMPLETED"].includes(booking.status)) {
    return NextResponse.json({ error: "invalid-state" }, { status: 409 });
  }
  if (balanceCents(booking) <= 0) {
    return NextResponse.json({ error: "nothing-owing" }, { status: 409 });
  }

  const parsed = settleBalanceSchema.safeParse(
    await req.json().catch(() => ({})),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation", fields: fieldErrors(parsed.error) },
      { status: 400 },
    );
  }

  // Refuse a stale write if the booking was cancelled or another request
  // settled the balance after our read.
  const settled = await prisma.booking.updateMany({
    where: {
      id: booking.id,
      status: booking.status,
      amountPaidCents: booking.amountPaidCents,
    },
    data: {
      amountPaidCents: booking.totalCents,
      balanceSettledAt: new Date(),
      balanceNote: parsed.data.note?.trim() || null,
    },
  });
  if (settled.count !== 1) {
    return NextResponse.json({ error: "state-changed" }, { status: 409 });
  }

  return NextResponse.json({ ok: true, amountPaidCents: booking.totalCents });
}
