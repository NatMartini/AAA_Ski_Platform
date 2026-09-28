import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/require-user";
import { rateLimitOrRespond } from "@/lib/rate-limit";
import { cancelBookingSchema, fieldErrors } from "@/lib/validators";
import { accessForPackage, loadPackage } from "@/lib/package-store";
import { OCCUPYING_STATUSES } from "@/lib/booking/state";
import { EXPIRING_HOLD_STATUSES } from "@/lib/booking/hold";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Cancels a lesson package so no more hours can be booked from it.
 *
 * The row stays: lessons already taught from it still count in the coaches'
 * settlement. Money is untouched — a refund happens between two people, and
 * recording one that has not been sent would be worse than recording nothing.
 */
export async function POST(
  req: Request,
  ctx: RouteContext<"/api/packages/[code]/cancel">,
) {
  const limited = rateLimitOrRespond(req, "write", "package-cancel");
  if (limited) return limited;

  const r = await requireUser();
  if (!r.ok) return r.response;

  const { code } = await ctx.params;
  const pkg = await loadPackage(code);
  if (!pkg) return NextResponse.json({ error: "not-found" }, { status: 404 });

  const access = accessForPackage(pkg, r.user);
  if (!access.canView) {
    return NextResponse.json({ error: "not-found" }, { status: 404 });
  }
  if (!access.isParty) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
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

  // Lock the package the same way booking creation does, so a booking that
  // is spending its hours right now either lands first (and blocks this) or
  // sees the package already cancelled.
  const cancelled = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "LessonPackage" WHERE "id" = ${pkg.id} FOR UPDATE
    `;
    // Live: anything holding a slot, except a self-serve hold whose timer has
    // run out. A confirmed booking keeps its old hold deadline on record, so
    // the deadline alone cannot decide.
    const now = new Date();
    const live = await tx.booking.count({
      where: {
        packageId: pkg.id,
        OR: [
          {
            status: {
              in: OCCUPYING_STATUSES.filter(
                (s) => !EXPIRING_HOLD_STATUSES.includes(s),
              ),
            },
          },
          {
            status: { in: EXPIRING_HOLD_STATUSES },
            OR: [{ holdExpiresAt: null }, { holdExpiresAt: { gt: now } }],
          },
        ],
      },
    });
    if (live > 0) return false;
    const updated = await tx.lessonPackage.updateMany({
      where: { id: pkg.id, status: pkg.status },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
        cancelReason: parsed.data.reason.trim(),
      },
    });
    return updated.count === 1;
  });
  if (!cancelled) {
    return NextResponse.json({ error: "state-changed" }, { status: 409 });
  }

  return NextResponse.json({ ok: true });
}
