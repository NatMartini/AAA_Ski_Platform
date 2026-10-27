import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/require-user";
import { rateLimitOrRespond } from "@/lib/rate-limit";
import { buildKey, deleteObject, KEY_PREFIX, writeObject } from "@/lib/storage";
import { checkVideo, MAX_VIDEO_BYTES, VideoRejected } from "@/lib/upload/video";
import { readLimitedFormData, requestBodyErrorResponse } from "@/lib/request-body";
import { lockedAccount } from "@/lib/video-analysis/account-service";
import { AnalysisDomainError } from "@/lib/video-analysis/quota";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Personal clips use the signed-in account; granting coaches cannot read them. */
export async function POST(req: Request) {
  const limited = rateLimitOrRespond(req, "upload", "account-analysis-video");
  if (limited) return limited;
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const accountId = auth.user.id;
  if (!await prisma.accountAnalysisGrant.count({ where: { accountId } })) {
    return NextResponse.json({ error: "quota-not-granted" }, { status: 409 });
  }
  let stagedKey: string | undefined;
  try {
    const form = await readLimitedFormData(req, MAX_VIDEO_BYTES + 64 * 1024);
    if (form.get("expectedAccountId") !== accountId) {
      return NextResponse.json({ error: "state-changed" }, { status: 409 });
    }
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "no-file" }, { status: 400 });
    if (file.size > MAX_VIDEO_BYTES) return NextResponse.json({ error: "too-large" }, { status: 413 });
    const caption = form.get("caption");
    const bytes = Buffer.from(await file.arrayBuffer());
    const checked = checkVideo(bytes, file.type);
    stagedKey = buildKey(KEY_PREFIX.accountVideo(accountId), checked.extension);
    const written = await writeObject(stagedKey, bytes);
    const video = await lockedAccount(accountId, async tx => {
      if (!await tx.accountAnalysisGrant.count({ where: { accountId } })) throw new AnalysisDomainError("quota-not-granted");
      if (await tx.accountAnalysisVideo.count({ where: { accountId } }) >= 100) throw new AnalysisDomainError("too-many");
      return tx.accountAnalysisVideo.create({ data: { accountId, uploadedById: accountId,
        storageKey: written.key, contentType: checked.contentType, bytes: written.bytes,
        caption: typeof caption === "string" && caption.trim() ? caption.trim().slice(0, 200) : null },
        select: { id: true, caption: true, bytes: true, uploadedAt: true } });
    });
    return NextResponse.json(video, { status: 201 });
  } catch (error) {
    if (stagedKey) await deleteObject(stagedKey).catch(() => null);
    const bodyError = requestBodyErrorResponse(error);
    if (bodyError) return bodyError;
    if (error instanceof VideoRejected) return NextResponse.json({ error: error.code }, { status: error.code === "too-large" ? 413 : 400 });
    if (error instanceof AnalysisDomainError) return NextResponse.json({ error: error.reason }, { status: error.reason === "forbidden" ? 403 : 409 });
    throw error;
  }
}
