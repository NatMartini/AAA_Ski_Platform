import type { ActiveUser } from "../auth/require-user";
import { prisma } from "../prisma";
import { requestFreeSkiReportResource, readFreeSkiReportJson, FreeSkiError } from "../freeski/adapter";
import { coachingReportSchema, decodeCompactPose, turnManifestSchema } from "../freeski/report-v2";
import { explainerSchema, KEYFRAME_ID, keyframesSchema, MAX_EXPLAINER_BYTES, MAX_KEYFRAME_BYTES } from "../freeski/scorecard";

export class DynamicReportError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); }
}

export async function loadDynamicReportSource(scope: string, id: string, user: ActiveUser) {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new DynamicReportError(404, "not-found");
  const eligible = { refundedAt: null, status: { in: ["QUEUED", "RUNNING", "SUCCEEDED"] } };
  if (scope === "account") {
    const job = await prisma.accountAnalysisJob.findFirst({ where: { id, accountId: user.id, videoId: { not: null }, ...eligible } });
    if (!job) throw new DynamicReportError(404, "not-found");
    return job;
  }
  if (scope === "booking") {
    const job = await prisma.videoAnalysisJob.findFirst({ where: { id, videoId: { not: null }, ...eligible, booking: {
      OR: [{ accountId: user.id }, ...(user.role === "COACH" ? [{ coachId: user.id }] : [])],
    } } });
    if (!job) throw new DynamicReportError(404, "not-found");
    return job;
  }
  throw new DynamicReportError(404, "not-found");
}

/** Read-only consumer: no model calls, credit writes, or arbitrary upstream addresses. */
export async function readDynamicReport(input: { scope: string; jobId: string; resource: string[];
  user: ActiveUser; request: Request }): Promise<Response> {
  const job = await loadDynamicReportSource(input.scope, input.jobId, input.user);
  if (!job.upstreamJobId || !job.upstreamDeploymentId || job.upstreamApiVersion !== 2) throw new DynamicReportError(409, "dynamic-report-unavailable");
  const resource = input.resource;
  const query = new URL(input.request.url).searchParams;
  const turnId = query.get("turn_id") ?? undefined, keyframeId = query.get("keyframe_id") ?? undefined;
  const turnPath = resource[0] === "turns" && /^turn_\d{1,5}$/.test(resource[1] ?? "");
  const kind = resource.length === 1 && resource[0] === "report" ? "report"
    : resource.length === 2 && turnPath ? "turn"
    : resource.length === 3 && turnPath && resource[2] === "keyframes" ? "keyframes"
    : resource.length === 2 && resource[0] === "assets" && resource[1] === "keyframe" && KEYFRAME_ID.test(keyframeId ?? "") ? "keyframe"
    : resource.length === 1 && resource[0] === "explainer" ? "explainer"
    : resource.length === 2 && resource[0] === "assets" && resource[1] === "explainer" ? "explainer-video"
    : resource.length === 2 && resource[0] === "assets" && ["background", "user-pose", "reference-pose"].includes(resource[1])
      ? resource[1] as "background" | "user-pose" | "reference-pose" : null;
  if (!kind || turnId && !/^turn_\d{1,5}$/.test(turnId)) throw new DynamicReportError(404, "not-found");
  const video = kind === "background" || kind === "explainer-video";
  let response: Response;
  try {
    response = await requestFreeSkiReportResource({ jobId: job.upstreamJobId, deploymentId: job.upstreamDeploymentId,
      resource: kind, turnId: kind === "turn" || kind === "keyframes" ? resource[1]
        : kind === "keyframe" || kind === "explainer" || kind === "explainer-video" ? undefined : turnId,
      keyframeId: kind === "keyframe" ? keyframeId : undefined,
      range: video ? input.request.headers.get("range") ?? undefined : undefined,
      signal: input.request.signal });
  } catch (error) {
    if (error instanceof FreeSkiError) throw new DynamicReportError(503, "dynamic-report-unavailable");
    throw error;
  }
  // A permission or video deletion that won while the network request waited
  // must be observed before returning any media bytes.
  try {
    const current = await loadDynamicReportSource(input.scope, input.jobId, input.user);
    if (current.upstreamJobId !== job.upstreamJobId || current.upstreamDeploymentId !== job.upstreamDeploymentId || current.upstreamApiVersion !== job.upstreamApiVersion)
      throw new DynamicReportError(409, "analysis-source-changed");
  } catch (error) {
    await response.body?.cancel();
    throw error;
  }
  if (response.status === 416) {
    await response.body?.cancel();
    const range = response.headers.get("content-range");
    return new Response(null, { status: 416, headers: { "Cache-Control": "private, no-store",
      ...(range && /^bytes \*\/\d+$/.test(range) ? { "Content-Range": range } : {}) } });
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new DynamicReportError(response.status === 404 ? 404 : 503, "dynamic-report-unavailable");
  }
  const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
  if (kind === "keyframe") {
    if (response.headers.get("content-type")?.split(";")[0] !== "image/webp" || !response.body) {
      await response.body?.cancel(); throw new DynamicReportError(502, "invalid-provider-media");
    }
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (const reader = response.body.getReader();;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_KEYFRAME_BYTES) { await reader.cancel(); throw new DynamicReportError(502, "media-budget-exceeded"); }
      chunks.push(value);
    }
    if (!total) throw new DynamicReportError(502, "invalid-provider-media");
    return new Response(Buffer.concat(chunks), { headers: { ...headers, "Content-Type": "image/webp", "Content-Length": String(total) } });
  }
  if (!video) {
    const body = await readFreeSkiReportJson(response);
    if (kind === "report") {
      const report = coachingReportSchema.parse(body);
      if (report.jobId !== job.upstreamJobId || report.deploymentId !== job.upstreamDeploymentId) throw new DynamicReportError(502, "invalid-provider-identity");
      return Response.json(report, { headers });
    }
    if (kind === "turn") {
      const manifest = turnManifestSchema.parse(body);
      if (manifest.turnId !== resource[1] || manifest.endMs <= manifest.startMs) throw new DynamicReportError(502, "invalid-provider-turn");
      return Response.json(manifest, { headers });
    }
    if (kind === "keyframes") {
      const manifest = keyframesSchema.parse(body);
      if (manifest.turn_id !== resource[1]) throw new DynamicReportError(502, "invalid-provider-turn");
      return Response.json(manifest, { headers });
    }
    if (kind === "explainer") return Response.json(explainerSchema.parse(body), { headers });
    decodeCompactPose(body);
    const raw = body as Record<string, unknown>;
    const allowed = ["schema_version", "frame_count", "joint_count", "joint_names", "connections", "resolution", "coordinate_space",
      "coordinate_step", "layout", "xy_b64", "confidence_b64", "observed_b64", "timestamps_b64"];
    // Decode validation above rejects unknown layouts; explicit selection strips
    // unrelated provider metadata rather than publishing its whole response.
    const safe = Object.fromEntries(allowed.map(key => [key, key === "layout" ? {
      xy: "int32-le/frame/joint/xy", confidence: "uint8/frame/joint", timestamps: "float64-le/seconds",
      observed: "uint8/frame/joint/0_missing_1_observed", missing: "observed==0",
    } : raw[key]]));
    return Response.json(safe, { headers });
  }
  if (response.headers.get("content-type")?.split(";")[0] !== "video/mp4" || !response.body) {
    await response.body?.cancel(); throw new DynamicReportError(502, "invalid-provider-media");
  }
  const length = Number(response.headers.get("content-length"));
  if (!Number.isSafeInteger(length) || length <= 0 || length > (kind === "explainer-video" ? MAX_EXPLAINER_BYTES : 32 * 1024 * 1024)) {
    await response.body.cancel(); throw new DynamicReportError(502, "media-budget-exceeded");
  }
  const contentRange = response.headers.get("content-range");
  if (response.status === 206 && (!contentRange || !/^bytes \d+-\d+\/\d+$/.test(contentRange))) {
    await response.body.cancel(); throw new DynamicReportError(502, "invalid-provider-range");
  }
  if (contentRange) {
    const values = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(contentRange);
    const [start, end, total] = values ? values.slice(1).map(Number) : [];
    if (!values || ![start, end, total].every(Number.isSafeInteger) || start < 0 || end < start || total <= end || end - start + 1 !== length) {
      await response.body.cancel(); throw new DynamicReportError(502, "invalid-provider-range");
    }
  }
  let sent = 0;
  const bounded = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({ async transform(chunk, controller) {
    const current = await loadDynamicReportSource(input.scope, input.jobId, input.user);
    if (current.upstreamJobId !== job.upstreamJobId || current.upstreamDeploymentId !== job.upstreamDeploymentId || current.upstreamApiVersion !== 2)
      throw new DynamicReportError(409, "analysis-source-changed");
    sent += chunk.byteLength;
    if (sent > length) { controller.error(new Error("Provider media exceeded declared budget")); return; }
    controller.enqueue(chunk);
  },flush(){if(sent!==length)throw new Error("Incomplete provider media");} }));
  return new Response(bounded, { status: response.status, headers: { ...headers, "Content-Type": "video/mp4",
    "Content-Length": String(length), "Accept-Ranges": "bytes", ...(contentRange ? { "Content-Range": contentRange } : {}) } });
}
