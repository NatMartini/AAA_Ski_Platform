import { coachFeedbackApi } from "@/lib/video-analysis/coach-feedback-api";
import { listAssignedCoachFeedback } from "@/lib/video-analysis/coach-feedback";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(req: Request) { return coachFeedbackApi(req, listAssignedCoachFeedback); }
