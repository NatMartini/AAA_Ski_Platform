import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { listObjects } from "@/lib/storage";
import { deletePaymentProofIfUnreferenced } from "@/lib/payment-proof";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Payment screenshots are kept for two years, then deleted. */
const PROOF_RETENTION_MONTHS = 24;

/** Leave in-flight, not-yet-submitted uploads alone until the next day. */
const ORPHAN_GRACE_HOURS = 24;

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
    const key = booking.paymentProofKey;
    const detached = await prisma.booking.updateMany({
      where: {
        id: booking.id,
        paymentProofKey: key,
        paymentSubmittedAt: { lt: cutoff },
      },
      data: { paymentProofKey: null },
    });
    if (detached.count === 0) continue;
    if (await deletePaymentProofIfUnreferenced(key)) deleted++;
  }

  // Lesson-package screenshots follow the same two-year rule.
  const stalePackages = await prisma.lessonPackage.findMany({
    where: {
      paymentProofKey: { not: null },
      paymentSubmittedAt: { lt: cutoff },
    },
    select: { id: true, paymentProofKey: true },
  });
  for (const pkg of stalePackages) {
    if (!pkg.paymentProofKey) continue;
    const key = pkg.paymentProofKey;
    const detached = await prisma.lessonPackage.updateMany({
      where: {
        id: pkg.id,
        paymentProofKey: key,
        paymentSubmittedAt: { lt: cutoff },
      },
      data: { paymentProofKey: null },
    });
    if (detached.count === 0) continue;
    if (await deletePaymentProofIfUnreferenced(key)) deleted++;
  }

  // Uploading and attaching a proof are separate requests. If the browser is
  // closed between them there is no database row to age out, so scan the
  // private proof prefix as well. The grace period protects active uploads;
  // the helper then locks the owning booking and re-checks references before
  // removing anything.
  const orphanCutoff = new Date(
    Date.now() - ORPHAN_GRACE_HOURS * 60 * 60 * 1000,
  );
  const orphanCandidates = [
    ...(await listObjects("proofs")),
    ...(await listObjects("package-proofs")),
  ].filter((object) => object.modifiedAt < orphanCutoff);

  let orphanProofsDeleted = 0;
  for (const object of orphanCandidates) {
    if (await deletePaymentProofIfUnreferenced(object.key)) {
      orphanProofsDeleted++;
    }
  }

  return NextResponse.json({
    ok: true,
    proofsDeleted: deleted,
    orphanProofsDeleted,
    note: "Waivers are never auto-deleted; review them manually.",
  });
}
