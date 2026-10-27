import { z } from "zod";
import { analysisApi, analysisBody } from "@/lib/video-analysis/api";
import { AnalysisDomainError } from "@/lib/video-analysis/quota";
import { issueAccountAnalysisGrant, listAccountAnalysisGrants } from "@/lib/video-analysis/account-service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const schema = z.object({ recipientEmail: z.string().trim().toLowerCase().max(254).pipe(z.email()),
  quantity: z.number().int().min(1).max(100), note: z.string().trim().max(500).nullish(),
  requestKey: z.uuid(), expectedCoachId: z.string().min(1).max(128) });
export async function GET(req: Request) {
  return analysisApi(req, async (user) => {
    if (new URL(req.url).searchParams.get("expectedCoachId") !== user.id) throw new AnalysisDomainError("state-changed");
    return listAccountAnalysisGrants(user);
  });
}
export async function POST(req: Request) {
  return analysisApi(req, async (user) => issueAccountAnalysisGrant(user, await analysisBody(req, schema)));
}
