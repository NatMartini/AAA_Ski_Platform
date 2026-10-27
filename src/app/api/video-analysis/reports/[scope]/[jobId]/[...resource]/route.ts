import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { requireUser } from "@/lib/auth/require-user";
import { DynamicReportError, readDynamicReport } from "@/lib/video-analysis/dynamic-report";
import {handleCoachingWorkspace} from "@/lib/video-analysis/coaching-workspace";
import {RequestBodyError} from "@/lib/request-body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handle(request: Request, context: { params: Promise<{ scope: string; jobId: string; resource: string[] }> }) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const params = await context.params;
  try {
    return await (["report","turns","assets","explainer"].includes(params.resource[0]) && request.method === "GET"
      ? readDynamicReport({ ...params, user: auth.user, request })
      : handleCoachingWorkspace({ ...params, user: auth.user, request }));
  } catch (error) {
    if (error instanceof DynamicReportError) return NextResponse.json({ error: error.code }, { status: error.status, headers: { "Cache-Control": "private, no-store" } });
    if (error instanceof ZodError) return NextResponse.json({ error: "invalid-provider-response" }, { status: 502, headers: { "Cache-Control": "private, no-store" } });
    if (error instanceof RequestBodyError) return NextResponse.json({error: "invalid-request"}, {status:error.reason==="too-large"?413:400});
    return NextResponse.json({ error: "dynamic-report-unavailable" }, { status: 503, headers: { "Cache-Control": "private, no-store" } });
  }
}
export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const DELETE = handle;
