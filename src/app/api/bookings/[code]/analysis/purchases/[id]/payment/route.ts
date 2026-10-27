import { analysisApi, analysisBody, analysisPaymentSchema } from "@/lib/video-analysis/api";
import { submitAnalysisPayment } from "@/lib/video-analysis/service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(req: Request, ctx: { params: Promise<{ code: string; id: string }> }) {
  const { code, id } = await ctx.params;
  return analysisApi(req, async (user) => submitAnalysisPayment(code, id, user, (await analysisBody(req, analysisPaymentSchema)).reference));
}
