import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/require-user";
import { rateLimitOrRespond } from "@/lib/rate-limit";
import { readJsonBodyOrResponse } from "@/lib/request-body";
import { deleteObject, readObject } from "@/lib/storage";
import { lockedAccount, recoverExpiredAccountAnalysisJobs } from "@/lib/video-analysis/account-service";
import { AnalysisDomainError } from "@/lib/video-analysis/quota";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: RouteContext<"/api/video-analysis/videos/[videoId]">) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { videoId } = await ctx.params;
  const video = await prisma.accountAnalysisVideo.findFirst({ where: { id: videoId, accountId: auth.user.id } });
  if (!video) return NextResponse.json({ error: "not-found" }, { status: 404 });
  try {
    return new NextResponse(new Uint8Array(await readObject(video.storageKey)), {
      headers: { "Content-Type": video.contentType, "Content-Disposition": "inline",
        "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
    });
  } catch {
    return NextResponse.json({ error: "not-found" }, { status: 404 });
  }
}

export async function DELETE(req: Request, ctx: RouteContext<"/api/video-analysis/videos/[videoId]">) {
  const limited = rateLimitOrRespond(req, "write", "account-analysis-video-delete");
  if (limited) return limited;
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const body = await readJsonBodyOrResponse(req, { allowEmpty: true });
  if (!body.ok) return body.response;
  const { videoId } = await ctx.params;
  try {
    await recoverExpiredAccountAnalysisJobs([auth.user.id]);
    const removed = await lockedAccount(auth.user.id, async tx => {
      const video = await tx.accountAnalysisVideo.findFirst({ where: { id: videoId, accountId: auth.user.id } });
      if (!video) throw new AnalysisDomainError("video-not-found");
      if (await tx.accountAnalysisJob.count({ where: { videoId, status: { in: ["QUEUED", "RUNNING"] } } })) {
        throw new AnalysisDomainError("analysis-in-progress");
      }
      // Keep the credit ledger even when the clip and its report are erased.
      await tx.accountAnalysisJob.updateMany({ where: { videoId }, data: { result: Prisma.DbNull } });
      await tx.accountAnalysisVideo.delete({ where: { id: videoId } });
      return video;
    });
    await deleteObject(removed.storageKey).catch(() => null);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof AnalysisDomainError) return NextResponse.json({ error: error.reason }, { status:
      error.reason === "video-not-found" ? 404 : error.reason === "forbidden" ? 403 : 409 });
    throw error;
  }
}
