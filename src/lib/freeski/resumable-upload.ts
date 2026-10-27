import {createHash} from "node:crypto";
import {createReadStream} from "node:fs";
import {open, realpath, stat} from "node:fs/promises";
import path from "node:path";
import type {FreeSkiActionSelection} from "./actions";

export class ResumableUploadError extends Error {
  constructor(readonly reason: "invalid-video" | "invalid-response" | "unavailable" | "cancelled") {super(reason);}
}
type Send = (endpoint: string, init: RequestInit, signal?: AbortSignal) => Promise<Response>;
const id = /^[a-f0-9]{32}$/;
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string,unknown> : {};
async function json(response: Response) {
  if (!response.ok) {await response.body?.cancel(); throw new ResumableUploadError("unavailable");}
  if (!response.body) throw new ResumableUploadError("invalid-response");
  const reader = response.body.getReader(); let total = 0; const chunks: Uint8Array[] = [];
  try {
    for (;;) {const {done,value} = await reader.read(); if (done) break; total += value.byteLength;
      if (total > 64 * 1024) {await reader.cancel(); throw new ResumableUploadError("invalid-response");} chunks.push(value);}
    return object(JSON.parse(Buffer.concat(chunks).toString("utf8")));
  } catch (error) {if (error instanceof ResumableUploadError) throw error; throw new ResumableUploadError("invalid-response");}
  finally {reader.releaseLock();}
}

/** Resumes the provider's received chunks. At most one chunk lives in memory. */
export async function submitResumableVideo(input: {videoPath: string; maxBytes: number; requestKey: string;
  selection: FreeSkiActionSelection; send: Send; signal?: AbortSignal}): Promise<string> {
  const failIfCancelled = () => {if (input.signal?.aborted) throw new ResumableUploadError("cancelled");};
  failIfCancelled();
  let full: string, original: Awaited<ReturnType<typeof stat>>, extension: string;
  try {
    const root = await realpath(/* turbopackIgnore: true */ path.resolve(/* turbopackIgnore: true */ process.env.STORAGE_DIR ?? path.join(process.cwd(),"storage")));
    full = await realpath(input.videoPath); const relative = path.relative(root,full);
    extension = path.extname(full).toLowerCase(); original = await stat(full);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative) || !original.isFile() || original.size <= 0 || original.size > input.maxBytes || ![".mp4",".mov",".m4v",".avi",".mkv"].includes(extension)) throw Error();
  } catch {throw new ResumableUploadError("invalid-video");}
  const hash = createHash("sha256");
  try {for await (const chunk of createReadStream(full,{signal:input.signal})) hash.update(chunk);}
  catch {failIfCancelled(); throw new ResumableUploadError("invalid-video");}
  failIfCancelled();
  const session = await json(await input.send("/api/integrations/v2/uploads", {method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({client_request_id:input.requestKey,file_name:`lesson${extension}`,total_bytes:original.size,sha256:hash.digest("hex"),
      action_name:input.selection.actionName,skill_family:input.selection.skillFamily,path_type:input.selection.pathType,
      level:input.selection.level,...(input.selection.currentLevel?{current_level:input.selection.currentLevel}:{}),rubric:"csia"})},input.signal));
  const size = session.chunkSize, uploadId = session.uploadId, received = session.receivedChunks;
  if (session.version !== 2 || typeof uploadId !== "string" || !id.test(uploadId) || size !== 524288) throw new ResumableUploadError("invalid-response");
  if (session.state === "submitted" && typeof session.jobId === "string" && id.test(session.jobId)) return session.jobId;
  if (session.version !== 2 || typeof uploadId !== "string" || !id.test(uploadId) || typeof size !== "number" || !Number.isSafeInteger(size) || size < 1024 || size > 1024 * 1024 ||
      session.totalChunks !== Math.ceil(original.size / size) || !Array.isArray(received) || received.length > session.totalChunks ||
      received.some(index => typeof index !== "number" || !Number.isSafeInteger(index) || index < 0 || index >= Number(session.totalChunks)) || new Set(received).size !== received.length ||
      !["receiving","assembling","submitting"].includes(String(session.state))) throw new ResumableUploadError("invalid-response");
  const already = new Set(received); const handle = await open(full,"r");
  try {
    for (let index = 0; index < Number(session.totalChunks); index++) {
      failIfCancelled(); if (already.has(index) || session.state !== "receiving") continue;
      const length = Math.min(size,original.size - index * size), buffer = Buffer.alloc(length);
      let offset = 0;
      while (offset < length) {const result = await handle.read(buffer,offset,length-offset,index*size+offset); if (!result.bytesRead) throw new ResumableUploadError("invalid-video"); offset += result.bytesRead;}
      const response = await input.send(`/api/integrations/v2/uploads/${uploadId}/chunks/${index}`,{method:"PUT",headers:{"Content-Type":"application/octet-stream","X-Chunk-SHA256":createHash("sha256").update(buffer).digest("hex")},body:new Uint8Array(buffer)},input.signal);
      await json(response);
    }
    const current = await handle.stat();
    if (current.size !== original.size || current.mtimeMs !== original.mtimeMs || current.ino !== original.ino) throw new ResumableUploadError("invalid-video");
  } finally {await handle.close();}
  failIfCancelled();
  const completed = await json(await input.send(`/api/integrations/v2/uploads/${uploadId}/complete`,{method:"POST"},input.signal));
  if (completed.state !== "submitted" || typeof completed.jobId !== "string" || !id.test(completed.jobId)) throw new ResumableUploadError("unavailable");
  return completed.jobId;
}
