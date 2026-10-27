import { describe, expect, it, vi } from "vitest";
import { MAX_JSON_BODY_BYTES, readJsonBody, readJsonBodyOrResponse, readLimitedBody,
  readLimitedFormData, RequestBodyError } from "./request-body";

function streamed(chunks: Uint8Array<ArrayBuffer>[], headers: Record<string, string> = {}) {
  let index = 0;
  const cancel = vi.fn();
  return { cancel, request: { headers: new Headers(headers), body: new ReadableStream<Uint8Array<ArrayBuffer>>({
    pull(controller) {
      if (index < chunks.length) controller.enqueue(chunks[index++]);
      else controller.close();
    }, cancel,
  }) } };
}
const encode = (text: string) => new TextEncoder().encode(text);

describe("bounded actual request streams", () => {
  const lengthHeaders: Record<string, string>[] = [{}, { "content-length": "1" }];
  it.each(lengthHeaders)("rejects actual bytes over the limit independently of headers", async (headers) => {
    const { request, cancel } = streamed([encode("1234"), encode("5678"), encode("ignored")], headers);
    await expect(readLimitedBody(request, 7)).rejects.toMatchObject({ reason: "too-large" });
    expect(cancel).toHaveBeenCalledOnce();
  });
  it("does not wait for an underlying cancellation promise which never resolves", async () => {
    const cancel = vi.fn(() => new Promise<void>(() => undefined));
    const request = { body: new ReadableStream<Uint8Array<ArrayBuffer>>({ start(controller) { controller.enqueue(encode("oversized")); }, cancel }) };
    await expect(readLimitedBody(request, 2)).rejects.toMatchObject({ reason: "too-large" });
    expect(cancel).toHaveBeenCalledOnce();
  });
  it("accepts exactly the cap, coalescing small chunks and preserving split UTF-8", async () => {
    const bytes = encode(JSON.stringify({ name: "雪山" }));
    const { request } = streamed(Array.from(bytes, (value) => Uint8Array.of(value)));
    expect(await readJsonBody(request, { maxBytes: bytes.byteLength })).toEqual({ name: "雪山" });
  });
  it("counts bytes rather than Unicode characters", async () => {
    const { request } = streamed([encode('"雪雪"')]);
    await expect(readJsonBody(request, { maxBytes: 4 })).rejects.toMatchObject({ reason: "too-large" });
  });
  it("accepts a legitimate maximum-size waiver canvas request", async () => {
    const signatureImage = "data:image/png;base64," + "A".repeat(399_978);
    const payload = { signatureImage, typedName: "学员", consentToElectronic: true,
      agreedCheckboxes: { risk: true } };
    const bytes = encode(JSON.stringify(payload));
    expect(bytes.byteLength).toBeLessThan(MAX_JSON_BODY_BYTES);
    expect(await readJsonBody(streamed([bytes]).request)).toEqual(payload);
  });
  it.each(["{broken", " ", ""])('reports invalid nonempty JSON instead of using a default action: "%s"', async (text) => {
    const result = await readJsonBodyOrResponse(streamed([encode(text)]).request);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Unexpected parsed body");
    expect(result.response.status).toBe(400);
    expect(await result.response.json()).toEqual({ error: "invalid-json" });
  });
  it("only permits a truly empty optional body, never malformed or oversized cancellation/completion data", async () => {
    expect(await readJsonBody({ body: null }, { allowEmpty: true })).toEqual({});
    await expect(readJsonBody(streamed([encode("{broken")]).request, { allowEmpty: true }))
      .rejects.toBeInstanceOf(RequestBodyError);
    const result = await readJsonBodyOrResponse(streamed([new Uint8Array(MAX_JSON_BODY_BYTES + 1)]).request, { allowEmpty: true });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Unexpected accepted body");
    expect(result.response.status).toBe(413);
    expect(await result.response.json()).toEqual({ error: "too-large" });
  });
  it("classifies malformed UTF-8 and interrupted bodies without leaking transport errors", async () => {
    await expect(readJsonBody(streamed([Uint8Array.of(0xff)]).request)).rejects.toMatchObject({ reason: "invalid-json" });
    const request = { body: new ReadableStream<Uint8Array<ArrayBuffer>>({ start(controller) { controller.error(new Error("private transport details")); } }) };
    await expect(readJsonBody(request)).rejects.toMatchObject({ reason: "invalid-json", message: "invalid-json" });
  });
});

describe("bounded multipart envelopes", () => {
  const boundary = "test-boundary";
  const form = encode(`--${boundary}\r\nContent-Disposition: form-data; name="caption"\r\n\r\n雪山\r\n--${boundary}--\r\n`);
  it("parses a valid bounded envelope without cloning or reading the original body twice", async () => {
    const request = streamed([form.subarray(0, 30), form.subarray(30)], { "content-type": `multipart/form-data; boundary=${boundary}` }).request;
    const parsed = await readLimitedFormData(request, form.byteLength);
    expect(parsed.get("caption")).toBe("雪山");
  });
  it("cancels oversized multipart before parsing despite a forged content length", async () => {
    const { request, cancel } = streamed([form], { "content-type": `multipart/form-data; boundary=${boundary}`, "content-length": "1" });
    await expect(readLimitedFormData(request, form.byteLength - 1)).rejects.toMatchObject({ reason: "too-large" });
    expect(cancel).toHaveBeenCalledOnce();
  });
  it("returns a typed safe error for malformed multipart", async () => {
    await expect(readLimitedFormData(streamed([encode("not a form")], { "content-type": "multipart/form-data" }).request, 100))
      .rejects.toMatchObject({ reason: "invalid-form", message: "invalid-form" });
  });
});
