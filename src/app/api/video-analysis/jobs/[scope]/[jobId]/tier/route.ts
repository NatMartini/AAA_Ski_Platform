import { prisma } from "@/lib/prisma";
import { analysisApi, analysisBody, tierChangeSchema } from "@/lib/video-analysis/api";
import { changeAccountAnalysisTier } from "@/lib/video-analysis/account-service";
import { AnalysisDomainError } from "@/lib/video-analysis/quota";
import { changeLessonAnalysisTier } from "@/lib/video-analysis/service";
import { prepareJobOutputs } from "@/lib/video-analysis/prepare";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Moves an analysis to another tier: a personal one is charged the difference, a lesson one is its coach's and free. */
export async function POST(req: Request, context: { params: Promise<{ scope: string; jobId: string }> }) {
  const { scope, jobId } = await context.params;
  return analysisApi(req, async (user) => {
    const body = await analysisBody(req, tierChangeSchema);
    if (scope !== "account" && scope !== "booking") throw new AnalysisDomainError("not-found");
    let changed;
    if (scope === "account") changed = await changeAccountAnalysisTier(user, { jobId, tier: body.tier, expectedAccountId: body.expectedAccountId ?? "" });
    else {
      const job = await prisma.videoAnalysisJob.findUnique({ where: { id: jobId }, select: { booking: { select: { code: true } } } });
      if (!job) throw new AnalysisDomainError("not-found");
      changed = await changeLessonAnalysisTier(job.booking.code, jobId, user, body.tier);
    }
    // What the new tier shows may all exist already: one look now spares the wait for the dispatcher's next round.
    if ("phase" in changed.job) await prepareJobOutputs(scope, jobId, { signal: AbortSignal.timeout(8_000) }).catch(() => null);
    return changed;
  });
}
