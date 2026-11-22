import type { ActiveUser } from "../auth/require-user";
import { prisma } from "../prisma";
import { readFreeSkiReportJson, requestFreeSkiReportResource } from "../freeski/adapter";
import { coachingReportSchema } from "../freeski/report-v2";
import { scorecardSchema, THINKING_LEVELS, withoutOverallScore, type Teaching, type ThinkingLevel } from "../freeski/scorecard";
import { DynamicReportError, loadDynamicReportSource } from "./dynamic-report";
import { renderAnalysisReportPdf } from "./report-pdf";
import { readableThinking, storedTier, TIER_FEATURES, type AnalysisTier } from "./tiers";

type Source = Awaited<ReturnType<typeof loadDynamicReportSource>>;

/**
 * FreeSki's written explanation at the deepest level already written, if FreeSki answers within a few seconds.
 * Reading the default level is what opening the report does anyway; a deeper level is read only once written.
 */
async function writtenTeaching(job: Source, tier: AnalysisTier): Promise<Teaching | null> {
  if (!job.upstreamJobId || !job.upstreamDeploymentId || job.upstreamApiVersion !== 2) return null;
  const signal = AbortSignal.timeout(8_000);
  const read = async (thinking?: ThinkingLevel) => {
    const response = await requestFreeSkiReportResource({ jobId: job.upstreamJobId!, deploymentId: job.upstreamDeploymentId!,
      resource: "report", thinking, signal });
    if (!response.ok) { await response.body?.cancel(); return null; }
    const report = coachingReportSchema.parse(await readFreeSkiReportJson(response));
    return report.jobId === job.upstreamJobId ? report : null;
  };
  try {
    const first = await read();
    if (!first) return null;
    const ready = first.teachingLevels?.filter(item => item.status === "ready").map(item => item.level) ?? [];
    // No deeper than the analysis's tier pays for.
    const deepest = THINKING_LEVELS.filter(level => level !== "none" && ready.includes(level) && readableThinking(tier).includes(level)).pop();
    return (deepest ? (await read(deepest).catch(() => null))?.teaching : null) ?? first.teaching;
  } catch {
    // An offline or starting FreeSki leaves the measurements and the movement explanations, which the site holds.
    return null;
  }
}

/** The finished report as a PDF download, for anyone who may read the report. */
export async function downloadReportPdf(input: { scope: string; jobId: string; user: ActiveUser; zh: boolean }): Promise<Response> {
  const job = await loadDynamicReportSource(input.scope, input.jobId, input.user);
  if (job.status !== "SUCCEEDED") throw new DynamicReportError(409, "report-not-ready");
  const video = !job.videoId ? null : input.scope === "account"
    ? await prisma.accountAnalysisVideo.findUnique({ where: { id: job.videoId }, select: { caption: true } })
    : await prisma.lessonVideo.findUnique({ where: { id: job.videoId }, select: { caption: true } });
  const tier = storedTier(job.tier);
  const card = scorecardSchema.safeParse((job.result as Record<string, unknown> | null)?.scorecard).data ?? null;
  const written = await writtenTeaching(job, tier);
  // The overall score is withheld on the site, and so is prose quoting it.
  const teaching = written ? withoutOverallScore(written, card?.overall.score ?? null) : null;
  const bytes = await renderAnalysisReportPdf({ zh: input.zh, actionId: job.actionId, caption: video?.caption ?? null,
    // A simple analysis is the written conclusion alone, without the scores.
    submittedAt: job.createdAt, finishedAt: job.finishedAt, result: TIER_FEATURES[tier].scores ? job.result : null, teaching,
    explanations: TIER_FEATURES[tier].explanations });
  const day = (job.finishedAt ?? job.createdAt).toISOString().slice(0, 10);
  return new Response(Buffer.from(bytes), { headers: { "Content-Type": "application/pdf",
    "Content-Disposition": `attachment; filename="freeski-report-${day}.pdf"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}
