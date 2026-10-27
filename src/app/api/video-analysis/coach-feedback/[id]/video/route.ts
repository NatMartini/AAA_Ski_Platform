import { coachFeedbackApi } from "@/lib/video-analysis/coach-feedback-api";
import { streamCoachFeedbackVideo } from "@/lib/video-analysis/coach-feedback-media";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
export async function GET(req: Request, ctx: Context) {
  return coachFeedbackApi(req, async (user) => streamCoachFeedbackVideo(req, (await ctx.params).id, user));
}
export const HEAD = GET;
