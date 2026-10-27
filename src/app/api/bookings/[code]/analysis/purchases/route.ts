import { analysisApi, analysisBody, analysisPurchaseSchema } from "@/lib/video-analysis/api";
import { createAnalysisPurchase } from "@/lib/video-analysis/service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(req: Request, ctx: { params: Promise<{ code: string }> }) {
  const { code } = await ctx.params;
  return analysisApi(req, async (user) => createAnalysisPurchase(code, user, await analysisBody(req, analysisPurchaseSchema)));
}
