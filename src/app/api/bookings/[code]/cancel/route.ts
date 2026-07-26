import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/require-user";
import { rateLimitOrRespond } from "@/lib/rate-limit";
import { cancelBookingSchema, fieldErrors } from "@/lib/validators";
import { accessFor, loadBooking } from "@/lib/booking/access";
import { assertTransition } from "@/lib/booking/state";
import { sendBookingCancelled } from "@/lib/booking/notify";
import { toLocale } from "@/i18n/routing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Cancels a booking and frees the slot.
 *
 * Either side may cancel: the coach when they cannot make it, the student when
 * their plans change. The row is kept (status CANCELLED) rather than deleted —
 * the signed waiver, the payment record and the frozen policy snapshot all
 * hang off it, and a cancelled lesson that was paid for still needs a paper
 * trail. `CANCELLED` is outside `OCCUPYING_STATUSES`, so the hour immediately
 * becomes bookable again.
 *
 * Money is deliberately untouched. Refunds happen by e-transfer between two
 * people; recording a refund the coach has not actually sent would be worse
 * than recording nothing.
 */
export async function POST(
  req: Request,
  ctx: RouteContext<"/api/bookings/[code]/cancel">,
) {
  const limited = rateLimitOrRespond(req, "write", "cancel");
  if (limited) return limited;

  const r = await requireUser();
  if (!r.ok) return r.response;

  const { code } = await ctx.params;
  const booking = await loadBooking(code);
  if (!booking) return NextResponse.json({ error: "not-found" }, { status: 404 });

  const access = accessFor(booking, r.user);
  if (!access.canView) {
    return NextResponse.json({ error: "forbidden" }, { status: 404 });
  }
  if (!access.canCancel) {
    return NextResponse.json({ error: "invalid-state" }, { status: 409 });
  }

  const parsed = cancelBookingSchema.safeParse(
    await req.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation", fields: fieldErrors(parsed.error) },
      { status: 400 },
    );
  }
  const reason = parsed.data.reason.trim();

  assertTransition(booking.status, "CANCELLED");

  await prisma.booking.update({
    where: { id: booking.id },
    data: {
      status: "CANCELLED",
      cancelledAt: new Date(),
      cancelledById: r.user.id,
      cancelReason: reason,
    },
  });

  // Only tell the other side. Cancelling your own lesson and then being
  // emailed about it is noise.
  const locale = toLocale(req.headers.get("x-locale") ?? undefined);
  const coachName = booking.coach.name ?? booking.coach.email;
  if (access.isCoach) {
    const to = booking.account?.email ?? booking.inviteEmail;
    if (to) {
      await sendBookingCancelled({
        code: booking.code,
        to,
        reason,
        byCoach: true,
        coachName,
        locale,
      }).catch(() => null);
    }
  } else if (booking.coach.email) {
    await sendBookingCancelled({
      code: booking.code,
      to: booking.coach.email,
      reason,
      byCoach: false,
      coachName,
      locale,
    }).catch(() => null);
  }

  return NextResponse.json({ ok: true, status: "CANCELLED" });
}
