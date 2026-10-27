import { z } from "zod";
import { analysisApi, analysisBody, requestAnalysisSchema } from "@/lib/video-analysis/api";
import { getAccountVideoAnalysisState, requestAccountAnalysis } from "@/lib/video-analysis/account-service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const schema = requestAnalysisSchema.extend({ expectedAccountId: z.string().min(1).max(128) });
export async function GET(req: Request) {
  return analysisApi(req, (user) => getAccountVideoAnalysisState(user));
}
export async function POST(req: Request) {
  return analysisApi(req, async (user) => requestAccountAnalysis(user, await analysisBody(req, schema)));
}
