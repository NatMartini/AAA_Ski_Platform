import { analysisApi, analysisBody, requestAnalysisSchema } from "@/lib/video-analysis/api";
import { getVideoAnalysisState, requestVideoAnalysis } from "@/lib/video-analysis/service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ code: string }> };
export async function GET(req: Request, ctx: Context) {
  const { code } = await ctx.params;
  return analysisApi(req, (user) => getVideoAnalysisState(code, user));
}
export async function POST(req: Request, ctx: Context) {
  const { code } = await ctx.params;
  return analysisApi(req, async (user) => requestVideoAnalysis(code, user, await analysisBody(req, requestAnalysisSchema)));
}
