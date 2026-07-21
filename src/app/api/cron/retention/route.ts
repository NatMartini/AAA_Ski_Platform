import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { deleteObject } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Payment screenshots are kept for two years, then deleted. */
const PROOF_RETENTION_MONTHS = 24;

/**
 * Enforces the retention policy stated in the privacy notice.
 *
 * Payment screenshots are deleted once the dispute window has long passed —
 * they contain bank details and there is no reason to hold them indefinitely.
 * The booking row itself stays, so the financial history survives without the
 * sensitive image.
 *
 * Waivers are deliberately NOT deleted here. A minor's limitation period does
 * not start until they turn 18, so a waiver signed for an eight-year-old may
 * still matter more than a decade later. Anything past its window is reported
 * for a human to review rather than removed automatically.
 */
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  const provided = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!secret || provided !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - PROOF_RETENTION_MONTHS);

  const stale = await prisma.booking.findMany({
    where: {
      paymentProofKey: { not: null },
      paymentSubmittedAt: { lt: cutoff },
    },
    select: { id: true, paymentProofKey: true },
  });

  let deleted = 0;
  for (const booking of stale) {
    if (!booking.paymentProofKey) continue;
    await deleteObject(booking.paymentProofKey);
    await prisma.booking.update({
      where: { id: booking.id },
      data: { paymentProofKey: null },
    });
    deleted++;
  }

  return NextResponse.json({
    ok: true,
    proofsDeleted: deleted,
    note: "Waivers are never auto-deleted; review them manually.",
  });
}
