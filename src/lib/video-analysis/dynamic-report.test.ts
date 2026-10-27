import { beforeEach, expect, it, vi } from "vitest";
import type { ActiveUser } from "../auth/require-user";
const mocks = vi.hoisted(() => ({ account: vi.fn(), booking: vi.fn(), request: vi.fn() }));
vi.mock("../prisma", () => ({ prisma: { accountAnalysisJob: { findFirst: mocks.account }, videoAnalysisJob: { findFirst: mocks.booking } } }));
vi.mock("../freeski/adapter", () => ({ requestFreeSkiReportResource: mocks.request,
  readFreeSkiReportJson: (r: Response) => r.json(), FreeSkiError: class extends Error {} }));
import { DynamicReportError, loadDynamicReportSource, readDynamicReport } from "./dynamic-report";
import { sampleExplainer, sampleKeyframes, sampleReport, sampleTeaching } from "../freeski/scorecard.fixtures";
const user = { id: "owner", role: "CUSTOMER" } as ActiveUser;
const upstream = "a".repeat(32);
const row = { id: "job", upstreamJobId: upstream, upstreamDeploymentId: "integration-instance", upstreamApiVersion: 2 };
const input = (resource: string[]) => ({ scope: "account", jobId: "job", user, resource,
  request: new Request("http://localhost/api/report") });
beforeEach(() => { vi.resetAllMocks(); mocks.account.mockResolvedValue(row); });

it("scopes personal report reads to the owner before touching upstream", async () => {
  mocks.account.mockResolvedValue(null);
  await expect(readDynamicReport(input(["report"]))).rejects.toMatchObject({ status: 404 });
  expect(mocks.account).toHaveBeenCalledWith({ where: { id: "job", accountId: "owner", videoId: { not: null }, refundedAt: null, status: { in: ["QUEUED", "RUNNING", "SUCCEEDED"] } } });
  expect(mocks.request).not.toHaveBeenCalled();
});
it("a different coach has no booking video report grant", async () => {
  mocks.booking.mockResolvedValue(null);
  await expect(loadDynamicReportSource("booking", "job", { ...user, id: "other", role: "COACH" })).rejects.toBeInstanceOf(DynamicReportError);
  expect(mocks.booking.mock.calls[0][0].where.booking.OR).toEqual([{ accountId: "other" }, { coachId: "other" }]);
});
it("does not try a legacy job against the new deployment", async () => {
  mocks.account.mockResolvedValue({ ...row, upstreamDeploymentId: null });
  await expect(readDynamicReport(input(["report"]))).rejects.toMatchObject({ status: 409 });
  expect(mocks.request).not.toHaveBeenCalled();
});
it("rejects a report from another instance and strips no credentials into errors", async () => {
  mocks.request.mockResolvedValue(Response.json({ version: 2, deploymentId: "another", jobId: upstream,
    measurementStatus: "ready", modelStatus: "pending", modelAssessment: null, modelError: null, referenceAvailability: {}, turns: [], evidenceId: null }));
  await expect(readDynamicReport(input(["report"]))).rejects.toMatchObject({ status: 502, code: "invalid-provider-identity" });
});
it("rechecks local permissions after waiting for the provider", async () => {
  mocks.account.mockResolvedValueOnce(row).mockResolvedValueOnce(null);
  mocks.request.mockResolvedValue(Response.json({}));
  await expect(readDynamicReport(input(["report"]))).rejects.toMatchObject({ status: 404 });
});
it("cancels the upstream body when local permission was revoked in flight", async () => {
  const cancelled = vi.fn();
  mocks.account.mockResolvedValueOnce(row).mockResolvedValueOnce(null);
  mocks.request.mockResolvedValue(new Response(new ReadableStream({ cancel: cancelled })));
  await expect(readDynamicReport(input(["assets", "background"]))).rejects.toMatchObject({ status: 404 });
  expect(cancelled).toHaveBeenCalledOnce();
});
it("rejects a changed upstream identity before releasing bytes", async () => {
  mocks.account.mockResolvedValueOnce(row).mockResolvedValueOnce({ ...row, upstreamDeploymentId: "changed" });
  mocks.request.mockResolvedValue(new Response("private"));
  await expect(readDynamicReport(input(["assets", "background"]))).rejects.toMatchObject({ code: "analysis-source-changed" });
});
it("streams an authorized bounded Range without buffering a whole clip", async () => {
  mocks.request.mockResolvedValue(new Response(new Uint8Array([1,2,3]), { status: 206,
    headers: { "content-type": "video/mp4", "content-length": "3", "content-range": "bytes 4-6/100" } }));
  const request = new Request("http://localhost/assets?turn_id=turn_0", { headers: { Range: "bytes=4-6" } });
  const response = await readDynamicReport({ ...input(["assets", "background"]), request });
  expect(response.status).toBe(206); expect(response.headers.get("content-range")).toBe("bytes 4-6/100");
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([1,2,3]);
});
it("aborts a media stream that exceeds the provider's declared byte length", async () => {
  mocks.request.mockResolvedValue(new Response(new Uint8Array([1,2,3,4]), {
    headers: { "content-type": "video/mp4", "content-length": "3" },
  }));
  const response = await readDynamicReport(input(["assets", "background"]));
  await expect(response.arrayBuffer()).rejects.toThrow("Provider media exceeded declared budget");
});
it("does not release media bytes after a local video grant is revoked during streaming",async()=>{
  mocks.account.mockResolvedValueOnce(row).mockResolvedValueOnce(row).mockResolvedValueOnce(null);
  mocks.request.mockResolvedValue(new Response(new Uint8Array([1,2,3]),{headers:{"content-type":"video/mp4","content-length":"3"}}));
  const response=await readDynamicReport(input(["assets","background"]));
  await expect(response.arrayBuffer()).rejects.toMatchObject({status:404});
});
it.each(["0", "33554433", "invalid"])("rejects a background outside the declared media budget: %s", async length => {
  const cancelled = vi.fn();
  mocks.request.mockResolvedValue(new Response(new ReadableStream({ cancel: cancelled }), {
    headers: { "content-type": "video/mp4", "content-length": length },
  }));
  await expect(readDynamicReport(input(["assets", "background"]))).rejects.toMatchObject({ code: "media-budget-exceeded" });
  expect(cancelled).toHaveBeenCalledOnce();
});
it("rejects a Range response whose byte interval disagrees with its declared length", async () => {
  const cancelled = vi.fn();
  mocks.request.mockResolvedValue(new Response(new ReadableStream({ cancel: cancelled }), { status: 206,
    headers: { "content-type": "video/mp4", "content-length": "3", "content-range": "bytes 4-8/100" },
  }));
  await expect(readDynamicReport(input(["assets", "background"]))).rejects.toMatchObject({ code: "invalid-provider-range" });
  expect(cancelled).toHaveBeenCalledOnce();
});
it("rejects arbitrary resource and turn paths before upstream", async () => {
  await expect(readDynamicReport(input(["assets", "../../secrets"]))).rejects.toMatchObject({ status: 404 });
  expect(mocks.request).not.toHaveBeenCalled();
});
const keyframeRequest = (id: string) => ({ ...input(["assets", "keyframe"]), request: new Request(`http://localhost/api/report?keyframe_id=${id}`) });
const pinnedReport = (overrides: Record<string, unknown> = {}) => Response.json({ ...sampleReport, deploymentId: "integration-instance", jobId: upstream, ...overrides });
it("passes FreeSki's sample report through with only cited teaching", async () => {
  const teaching = { ...sampleTeaching, strengths: [...sampleTeaching.strengths, { ...sampleTeaching.strengths[0], fact_ids: ["f_unknown"] }] };
  mocks.request.mockResolvedValue(pinnedReport({ teaching }));
  const body = await (await readDynamicReport(input(["report"]))).json();
  expect(body.teaching.strengths).toHaveLength(sampleTeaching.strengths.length);
  expect(body.scorecard.overall.score).toBe(sampleReport.scorecard.overall.score);
  expect(body).toMatchObject({ teachingStatus: "ready", explainerStatus: "ready" });
});
it("proxies a turn keyframe manifest and a bounded webp keyframe image", async () => {
  const turn = sampleKeyframes.turn_id;
  mocks.request.mockResolvedValueOnce(Response.json(sampleKeyframes));
  const manifest = await readDynamicReport(input(["turns", turn, "keyframes"]));
  expect((await manifest.json()).items).toHaveLength(3);
  expect(mocks.request).toHaveBeenLastCalledWith(expect.objectContaining({ resource: "keyframes", turnId: turn }));
  const id = sampleKeyframes.items[0].keyframe_id;
  mocks.request.mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), { headers: { "Content-Type": "image/webp" } }));
  const image = await readDynamicReport(keyframeRequest(id));
  expect(image.headers.get("content-type")).toBe("image/webp");
  expect(image.headers.get("cache-control")).toBe("private, no-store");
  expect(new Uint8Array(await image.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  expect(mocks.request).toHaveBeenLastCalledWith(expect.objectContaining({ resource: "keyframe", keyframeId: id, turnId: undefined }));
});
it("rejects keyframes for another turn, non-webp images, oversized images and malformed ids", async () => {
  mocks.request.mockResolvedValueOnce(Response.json(sampleKeyframes));
  await expect(readDynamicReport(input(["turns", "turn_9", "keyframes"]))).rejects.toMatchObject({ status: 502, code: "invalid-provider-turn" });
  const id = sampleKeyframes.items[0].keyframe_id;
  mocks.request.mockResolvedValueOnce(new Response("<svg/>", { headers: { "Content-Type": "image/svg+xml" } }));
  await expect(readDynamicReport(keyframeRequest(id))).rejects.toMatchObject({ status: 502, code: "invalid-provider-media" });
  mocks.request.mockResolvedValueOnce(new Response(new Uint8Array(400 * 1024 + 1), { headers: { "Content-Type": "image/webp" } }));
  await expect(readDynamicReport(keyframeRequest(id))).rejects.toMatchObject({ status: 502, code: "media-budget-exceeded" });
  mocks.request.mockClear();
  await expect(readDynamicReport(keyframeRequest("../secret"))).rejects.toMatchObject({ status: 404 });
  await expect(readDynamicReport(input(["turns", "turn_2", "keyframes", "x"]))).rejects.toMatchObject({ status: 404 });
  await expect(readDynamicReport(input(["explainer", "x"]))).rejects.toMatchObject({ status: 404 });
  expect(mocks.request).not.toHaveBeenCalled();
});
it("proxies the explainer manifest and streams a bounded explainer video Range", async () => {
  mocks.request.mockResolvedValueOnce(Response.json(sampleExplainer));
  const manifest = await (await readDynamicReport(input(["explainer"]))).json();
  expect(manifest.segments.length).toBe(sampleExplainer.segments.length);
  expect(mocks.request).toHaveBeenLastCalledWith(expect.objectContaining({ resource: "explainer", turnId: undefined }));
  mocks.request.mockResolvedValueOnce(new Response(new Uint8Array(10), { status: 206, headers: { "Content-Type": "video/mp4",
    "Content-Length": "10", "Content-Range": "bytes 0-9/2000" } }));
  const ranged = { ...input(["assets", "explainer"]), request: new Request("http://localhost/api/report", { headers: { Range: "bytes=0-9" } }) };
  const video = await readDynamicReport(ranged);
  expect(video.status).toBe(206);
  expect(video.headers.get("content-range")).toBe("bytes 0-9/2000");
  expect((await video.arrayBuffer()).byteLength).toBe(10);
  expect(mocks.request).toHaveBeenLastCalledWith(expect.objectContaining({ resource: "explainer-video", range: "bytes=0-9" }));
});
it("refuses an explainer video above the 24 MiB budget", async () => {
  mocks.request.mockResolvedValueOnce(new Response(new Uint8Array(1), { headers: { "Content-Type": "video/mp4",
    "Content-Length": String(24 * 1024 * 1024 + 1) } }));
  await expect(readDynamicReport(input(["assets", "explainer"]))).rejects.toMatchObject({ status: 502, code: "media-budget-exceeded" });
});
