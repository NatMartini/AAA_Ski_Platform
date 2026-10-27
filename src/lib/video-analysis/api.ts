import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "../auth/require-user";
import type { ActiveUser } from "../auth/require-user";
import { rateLimitOrRespond } from "../rate-limit";
import { AnalysisDomainError } from "./quota";
import { readJsonBody, requestBodyErrorResponse } from "../request-body";

function privateResponse<T extends Response>(response: T): T {
  response.headers.set("Cache-Control", "private, no-store");
  const vary = response.headers.get("Vary");
  response.headers.set("Vary", vary ? `${vary}, Cookie` : "Cookie");
  return response;
}

export async function analysisApi(req: Request, work: (user: ActiveUser) => Promise<unknown>) {
  if (req.method !== "GET") {
    const limited = rateLimitOrRespond(req, "write", "video-analysis");
    if (limited) return privateResponse(limited);
  }
  const auth = await requireUser();
  if (!auth.ok) return privateResponse(auth.response);
  try { return privateResponse(NextResponse.json(await work(auth.user))); }
  catch (error) {
    const bodyError = requestBodyErrorResponse(error);
    if (bodyError) return privateResponse(bodyError);
    if (error instanceof AnalysisDomainError) return privateResponse(NextResponse.json({ error: error.reason }, { status:
      ["not-found", "video-not-found"].includes(error.reason) ? 404 : error.reason === "forbidden" ? 403 : 409 }));
    if (error instanceof z.ZodError) return privateResponse(NextResponse.json({ error: "validation" }, { status: 400 }));
    throw error;
  }
}
export async function analysisBody<T>(req: Request, schema: z.ZodType<T>): Promise<T> {
  return schema.parse(await readJsonBody(req));
}
export const requestAnalysisSchema = z.object({ videoId: z.string().min(1), actionId: z.string().min(1).max(80), requestKey: z.uuid() });
export const analysisPurchaseSchema = z.object({ quantity: z.number().int().min(1).max(50), requestKey: z.uuid(),
  expectedUnitPriceCents: z.number().int().min(1).max(1_000_000) });
export const analysisPaymentSchema = z.object({ reference: z.string().trim().max(200).optional() });
export const analysisReviewSchema = z.object({ action: z.enum(["confirm", "reject"]), note: z.string().trim().max(500).optional(),
  expectedUpdatedAt: z.iso.datetime(), manualReceipt: z.object({ method: z.literal("WECHAT"), reference: z.string().trim().max(200).optional() }).optional(),
}).refine((d) => !d.manualReceipt || d.action === "confirm");
