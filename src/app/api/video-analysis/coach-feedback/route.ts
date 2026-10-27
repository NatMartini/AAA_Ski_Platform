import { analysisBody } from "@/lib/video-analysis/api";
import { coachFeedbackApi, feedbackRequestSchema, feedbackSubjectSchema } from "@/lib/video-analysis/coach-feedback-api";
import { getCoachFeedbackState, requestCoachFeedback } from "@/lib/video-analysis/coach-feedback";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  return coachFeedbackApi(req, async (user) => {
    const url = new URL(req.url);
    const subject = feedbackSubjectSchema.parse({ scope: url.searchParams.get("scope"), videoId: url.searchParams.get("videoId"),
      ...(url.searchParams.has("bookingCode") ? { bookingCode: url.searchParams.get("bookingCode") } : {}) });
    return getCoachFeedbackState(user, subject);
  });
}
export async function POST(req: Request) {
  return coachFeedbackApi(req, async (user) => requestCoachFeedback(user, await analysisBody(req,
    feedbackRequestSchema.refine((input) => input.scope !== "LESSON" || Boolean(input.bookingCode), { path: ["bookingCode"], message: "Required for lessons" }))));
}
