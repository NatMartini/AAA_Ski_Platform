/** JSON signatures are capped at 400,000 characters; 1 MiB preserves valid waivers. */
export const MAX_JSON_BODY_BYTES = 1024 * 1024;
const BUFFER_BLOCK_BYTES = 64 * 1024;

export class RequestBodyError extends Error {
  constructor(readonly reason: "too-large" | "invalid-json" | "invalid-form") {
    super(reason);
    this.name = "RequestBodyError";
  }
}

/** Count the actual stream, including when Content-Length is absent or forged. */
export async function readLimitedBody(request: Pick<Request, "body">, maxBytes: number): Promise<Uint8Array<ArrayBuffer>> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new RangeError("Invalid body byte limit");
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  // Coalesce small network chunks so a byte-at-a-time sender cannot create
  // an unbounded number of retained objects while staying below the byte cap.
  const blocks: Uint8Array[] = [];
  let bytes = 0;
  let block: Uint8Array | undefined;
  let used = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        // Cancellation closes the stream immediately; an underlying source's
        // cleanup promise can hang, so rejection must not wait for it.
        void reader.cancel().catch(() => undefined);
        throw new RequestBodyError("too-large");
      }
      let offset = 0;
      while (offset < value.byteLength) {
        if (!block || used === block.byteLength) {
          block = new Uint8Array(Math.min(BUFFER_BLOCK_BYTES, maxBytes));
          blocks.push(block);
          used = 0;
        }
        const length = Math.min(block.byteLength - used, value.byteLength - offset);
        block.set(value.subarray(offset, offset + length), used);
        offset += length;
        used += length;
      }
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(bytes);
  let offset = 0;
  for (const item of blocks) {
    const length = Math.min(item.byteLength, bytes - offset);
    result.set(item.subarray(0, length), offset);
    offset += length;
  }
  return result;
}

type JsonBodyOptions = { maxBytes?: number; allowEmpty?: boolean };
export async function readJsonBody(request: Pick<Request, "body">, options: JsonBodyOptions = {}): Promise<unknown> {
  try {
    const bytes = await readLimitedBody(request, options.maxBytes ?? MAX_JSON_BODY_BYTES);
    if (bytes.byteLength === 0 && options.allowEmpty) return {};
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch (error) {
    if (error instanceof RequestBodyError) throw error;
    throw new RequestBodyError("invalid-json");
  }
}

/** Bound the raw multipart envelope before its parser can allocate files or fields. */
export async function readLimitedFormData(request: Pick<Request, "body" | "headers">, maxBytes: number): Promise<FormData> {
  try {
    const bytes = await readLimitedBody(request, maxBytes);
    return await new Response(bytes, { headers: { "Content-Type": request.headers.get("content-type") ?? "" } }).formData();
  } catch (error) {
    if (error instanceof RequestBodyError) throw error;
    throw new RequestBodyError("invalid-form");
  }
}

export function requestBodyErrorResponse(error: unknown): Response | null {
  if (!(error instanceof RequestBodyError)) return null;
  return Response.json({ error: error.reason }, { status: error.reason === "too-large" ? 413 : 400,
    headers: { "Cache-Control": "private, no-store" } });
}

/** A route must return a body failure, never coerce it into a default action. */
export async function readJsonBodyOrResponse(request: Pick<Request, "body">, options: JsonBodyOptions = {}) {
  try { return { ok: true, data: await readJsonBody(request, options) } as const; }
  catch (error) {
    const response = requestBodyErrorResponse(error);
    if (!response) throw error;
    return { ok: false, response } as const;
  }
}
