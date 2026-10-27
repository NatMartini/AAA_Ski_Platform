import { open } from "node:fs/promises";
import { Readable } from "node:stream";
import { resolveKey } from "../storage";
import type { ActiveUser } from "../auth/require-user";
import { AnalysisDomainError } from "./quota";
import { getCoachFeedbackVideo } from "./coach-feedback";

/** Single byte range, including suffix ranges; malformed/multipart requests fail closed. */
export function reviewVideoRange(header: string | null, size: number): { start: number; end: number } | null {
  if (header === null) return { start: 0, end: size - 1 };
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2]) || !Number.isSafeInteger(size) || size < 1) return null;
  if (!match[1]) {
    const suffix = Number(match[2]);
    return Number.isSafeInteger(suffix) && suffix > 0 ? { start: Math.max(0, size - suffix), end: size - 1 } : null;
  }
  const start = Number(match[1]);
  const end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  return Number.isSafeInteger(start) && Number.isSafeInteger(end) && start >= 0 && start <= end && start < size ? { start, end } : null;
}

export async function streamCoachFeedbackVideo(req: Request, id: string, user: ActiveUser) {
  const source = await getCoachFeedbackVideo(id, user);
  if (!["video/mp4", "video/quicktime", "video/webm"].includes(source.contentType)) throw new AnalysisDomainError("video-not-found");
  const file = await open(resolveKey(source.storageKey), "r").catch(() => null);
  if (!file) throw new AnalysisDomainError("video-not-found");
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size !== source.bytes || stat.size <= 0) throw new AnalysisDomainError("video-not-found");
    // Authorization already ran, even if the request will be rejected as 416.
    const range = reviewVideoRange(req.headers.get("range"), stat.size);
    if (!range) {
      await file.close();
      return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${stat.size}`, "Accept-Ranges": "bytes" } });
    }
    const partial = req.headers.has("range");
    const headers = { "Content-Type": source.contentType, "Content-Disposition": "inline",
      "Content-Length": String(range.end - range.start + 1), "Accept-Ranges": "bytes", "X-Content-Type-Options": "nosniff",
      ...(partial ? { "Content-Range": `bytes ${range.start}-${range.end}/${stat.size}` } : {}) };
    if (req.method === "HEAD") {
      await file.close();
      return new Response(null, { status: partial ? 206 : 200, headers });
    }
    // Recheck after opening the file. A cancel/reassignment which won the lock
    // prevents this fetch from counting as viewing or opening a new stream.
    await getCoachFeedbackVideo(id, user, true);
    const stream = file.createReadStream({ start: range.start, end: range.end, autoClose: true });
    return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, { status: partial ? 206 : 200, headers });
  } catch (error) {
    await file.close().catch(() => undefined);
    throw error;
  }
}
