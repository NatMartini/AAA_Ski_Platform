import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, type ActiveUser } from "../auth/require-user";
import { rateLimitOrRespond } from "../rate-limit";
import { requestBodyErrorResponse } from "../request-body";
import { AnalysisDomainError } from "./quota";

export async function coachFeedbackApi(req: Request, work: (user: ActiveUser) => Promise<unknown>) {
  function privateResponse(response: Response) {
    response.headers.set("Cache-Control", "private, no-store");
    response.headers.set("Vary", "Cookie");
    return response;
  }
  if (!["GET", "HEAD"].includes(req.method)) {
    const limited = rateLimitOrRespond(req, "write", "coach-video-feedback");
    if (limited) return privateResponse(limited);
  }
  const auth = await requireUser();
  if (!auth.ok) return privateResponse(auth.response);
  try {
    const result = await work(auth.user);
    return privateResponse(result instanceof Response ? result : NextResponse.json(result));
  } catch (error) {
    const bodyError = requestBodyErrorResponse(error);
    if (bodyError) return privateResponse(bodyError);
    if (error instanceof z.ZodError) return privateResponse(NextResponse.json({ error: "validation" }, { status: 400 }));
    if (error instanceof AnalysisDomainError) return privateResponse(NextResponse.json({ error: error.reason }, { status:
      ["not-found", "video-not-found"].includes(error.reason) ? 404 : error.reason === "forbidden" ? 403 : 409 }));
    throw error;
  }
}

export const feedbackSubjectSchema = z.strictObject({ scope: z.enum(["LESSON", "ACCOUNT"]), videoId: z.string().min(1).max(100),
  bookingCode: z.string().min(1).max(100).optional() });
export const feedbackRequestSchema = feedbackSubjectSchema.extend({
  expectedAccountId: z.string().min(1).max(100), coachId: z.string().min(1).max(100), requestKey: z.uuid(),
  consent: z.literal(true), consentVersion: z.literal("video-review-v1"),
  expectedCurrentId: z.string().min(1).max(100).nullable(), expectedRevision: z.number().int().min(1).nullable(),
});
export const feedbackUpdateSchema = z.strictObject({ action: z.enum(["start", "save", "publish"]), expectedRevision: z.number().int().min(1),
  text: z.string().max(8000).optional(), watchedVideo: z.boolean().optional(), authoredByMe: z.boolean().optional(), publishConfirmed: z.boolean().optional() });
export const feedbackCancelSchema = z.strictObject({ expectedRevision: z.number().int().min(1) });
