import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCoach } from "@/lib/auth/require-user";
import { rateLimitOrRespond } from "@/lib/rate-limit";
import { fieldErrors, packageAdjustSchema } from "@/lib/validators";
import { accessForPackage, loadPackage } from "@/lib/package-store";
import {
  hoursUsed,
  packageTotalHours,
  PACKAGE_CONSUMING_STATUSES,
} from "@/lib/packages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The coach who sold a package adds or takes away hours — a make-up lesson,
 * hours given back, a correction. Recorded as a new adjustment row with the
 * reason, never by rewriting the package.
 *
 * Takes the same row lock as booking, so a coach cannot take away hours that
 * a booking is spending at the same moment.
 */
export async function POST(
  req: Request,
  ctx: RouteContext<"/api/packages/[code]/adjust">,
) {
  const limited = rateLimitOrRespond(req, "write", "package-adjust");
  if (limited) return limited;

  const r = await requireCoach();
  if (!r.ok) return r.response;

  const { code } = await ctx.params;
  const pkg = await loadPackage(code);
  if (!pkg) return NextResponse.json({ error: "not-found" }, { status: 404 });

  const access = accessForPackage(pkg, r.user);
  if (!access.isPayee) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (!access.canAdjust) {
    return NextResponse.json({ error: "invalid-state" }, { status: 409 });
  }

  const parsed = packageAdjustSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation", fields: fieldErrors(parsed.error) },
      { status: 400 },
    );
  }
  const d = parsed.data;
  const now = new Date();

  const result = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "LessonPackage" WHERE "id" = ${pkg.id} FOR UPDATE
    `;
    const current = await tx.lessonPackage.findUnique({
      where: { id: pkg.id },
      include: {
        adjustments: { select: { hours: true } },
        bookings: {
          where: { status: { in: PACKAGE_CONSUMING_STATUSES } },
          select: { hours: true, status: true, holdExpiresAt: true },
        },
      },
    });
    if (!current || current.status !== "ACTIVE") return "invalid-state" as const;
    // Hours already booked or taught cannot be taken back.
    if (packageTotalHours(current) + d.hours < hoursUsed(current.bookings, now)) {
      return "below-used" as const;
    }
    await tx.packageAdjustment.create({
      data: {
        packageId: pkg.id,
        hours: d.hours,
        reason: d.reason,
        createdById: r.user.id,
      },
    });
    return "ok" as const;
  });

  if (result !== "ok") {
    return NextResponse.json({ error: result }, { status: 409 });
  }
  return NextResponse.json({ ok: true });
}
