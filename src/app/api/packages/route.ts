import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/require-user";
import { rateLimitOrRespond } from "@/lib/rate-limit";
import { fieldErrors, packagePurchaseSchema } from "@/lib/validators";
import { canAcceptBookings } from "@/lib/coach";
import { offersOnSale } from "@/lib/packages";
import { generatePackageCode } from "@/lib/booking/code";
import { toDateKey } from "@/lib/time";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A student orders a lesson package and chooses which coach to pay.
 *
 * Nothing is reserved: the order only records the price and hours as they
 * stand today. The student pays that coach directly and uploads a screenshot;
 * the hours become spendable once the coach confirms it.
 */
export async function POST(req: Request) {
  const limited = rateLimitOrRespond(req, "booking", "package-create");
  if (limited) return limited;

  const r = await requireUser();
  if (!r.ok) return r.response;

  const parsed = packagePurchaseSchema.safeParse(
    await req.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation", fields: fieldErrors(parsed.error) },
      { status: 400 },
    );
  }
  const d = parsed.data;

  const sale = offersOnSale(toDateKey(new Date()));
  const offer = sale.offers.find((o) => o.key === d.offerKey);
  if (!offer) return NextResponse.json({ error: "not-on-sale" }, { status: 409 });

  const [resort, payee] = await Promise.all([
    prisma.resort.findUnique({ where: { slug: offer.resortSlug } }),
    prisma.coachProfile.findUnique({
      where: { userId: d.payeeCoachId },
      include: { rates: true },
    }),
  ]);
  if (!resort?.isActive) {
    return NextResponse.json({ error: "not-on-sale" }, { status: 409 });
  }
  // Only a coach a student could book can be paid: they need a way to take
  // the money and a published cancellation policy.
  if (!payee || !canAcceptBookings(payee)) {
    return NextResponse.json({ error: "coach-unavailable" }, { status: 400 });
  }

  const pkg = await prisma.lessonPackage.create({
    data: {
      code: generatePackageCode(),
      accountId: r.user.id,
      offerKey: offer.key,
      resortId: resort.id,
      lessonType: offer.lessonType,
      season: sale.season,
      hours: offer.hours,
      priceCents: offer.priceCents,
      payeeCoachId: payee.userId,
    },
    select: { code: true },
  });

  return NextResponse.json({ ok: true, code: pkg.code }, { status: 201 });
}
