import { analysisApi } from "@/lib/video-analysis/api";
import { cancelAnalysisPurchase } from "@/lib/video-analysis/service";
import { readJsonBody } from "@/lib/request-body";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(req: Request, ctx: { params: Promise<{ code: string; id: string }> }) {
  const { code, id } = await ctx.params;
  return analysisApi(req, async (user) => {
    await readJsonBody(req, { allowEmpty: true });
    return cancelAnalysisPurchase(code, id, user);
  });
}
