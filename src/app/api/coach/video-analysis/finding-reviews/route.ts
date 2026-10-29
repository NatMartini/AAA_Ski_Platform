import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/require-user";
import { DynamicReportError } from "@/lib/video-analysis/dynamic-report";
import { listCoachFindingReviews } from "@/lib/video-analysis/finding-reviews";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A coach's own verdicts on FreeSki findings, for export to FreeSki's calibration. */
export async function GET() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  try {
    return NextResponse.json(await listCoachFindingReviews(auth.user), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof DynamicReportError) return NextResponse.json({ error: error.code }, { status: error.status });
    throw error;
  }
}
