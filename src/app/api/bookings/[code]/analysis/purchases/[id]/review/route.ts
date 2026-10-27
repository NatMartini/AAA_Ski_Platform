import { analysisApi, analysisBody, analysisReviewSchema } from "@/lib/video-analysis/api";
import { reviewAnalysisPayment } from "@/lib/video-analysis/service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(req: Request, ctx: { params: Promise<{ code: string; id: string }> }) {
  const { code, id } = await ctx.params;
  return analysisApi(req, async (user) => reviewAnalysisPayment(code, id, user, await analysisBody(req, analysisReviewSchema)));
}
