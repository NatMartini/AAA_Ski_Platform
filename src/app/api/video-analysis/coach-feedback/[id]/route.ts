import { analysisBody } from "@/lib/video-analysis/api";
import { coachFeedbackApi, feedbackCancelSchema, feedbackUpdateSchema } from "@/lib/video-analysis/coach-feedback-api";
import { cancelCoachFeedback, getCoachFeedback, updateCoachFeedback } from "@/lib/video-analysis/coach-feedback";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
export async function GET(req: Request, ctx: Context) {
  return coachFeedbackApi(req, async (user) => getCoachFeedback((await ctx.params).id, user));
}
export async function PATCH(req: Request, ctx: Context) {
  return coachFeedbackApi(req, async (user) => updateCoachFeedback((await ctx.params).id, user, await analysisBody(req, feedbackUpdateSchema)));
}
export async function DELETE(req: Request, ctx: Context) {
  return coachFeedbackApi(req, async (user) => cancelCoachFeedback((await ctx.params).id, user, (await analysisBody(req, feedbackCancelSchema)).expectedRevision));
}
