import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ auth: vi.fn(), limit: vi.fn(), state: vi.fn(), request: vi.fn() }));
vi.mock("@/lib/auth/require-user", () => ({ requireUser: mock.auth }));
vi.mock("@/lib/rate-limit", () => ({ rateLimitOrRespond: mock.limit }));
vi.mock("@/lib/video-analysis/coach-feedback", () => ({ getCoachFeedbackState: mock.state, requestCoachFeedback: mock.request }));
import { GET, POST } from "./route";

beforeEach(() => {
  vi.resetAllMocks();
  mock.auth.mockResolvedValue({ ok: true, user: { id: "student", role: "CUSTOMER" } });
  mock.limit.mockReturnValue(null);
  mock.state.mockResolvedValue({ ok: true, status: "NOT_REQUESTED" });
  mock.request.mockResolvedValue({ ok: true, request: { id: "review" } });
});
const body = () => ({ scope: "ACCOUNT", videoId: "clip", expectedAccountId: "student", coachId: "coach",
  requestKey: "11111111-1111-4111-8111-111111111111", consent: true, consentVersion: "video-review-v1", expectedCurrentId: null, expectedRevision: null });
const post = (data: unknown) => POST(new Request("http://localhost/api/video-analysis/coach-feedback", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) }));
describe("human review request API", () => {
  it("requires login even for reading availability", async () => {
    mock.auth.mockResolvedValue({ ok: false, response: Response.json({ error: "Unauthorized" }, { status: 401 }) });
    const response = await GET(new Request("http://localhost/api/video-analysis/coach-feedback?scope=ACCOUNT&videoId=clip"));
    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(mock.state).not.toHaveBeenCalled();
  });
  it("keeps state and mutations private and scoped to the authenticated user", async () => {
    const response = await GET(new Request("http://localhost/api/video-analysis/coach-feedback?scope=ACCOUNT&videoId=clip"));
    expect(response.headers.get("Vary")).toBe("Cookie");
    expect(mock.state).toHaveBeenCalledWith(expect.objectContaining({ id: "student" }), { scope: "ACCOUNT", videoId: "clip" });
    expect((await post(body())).status).toBe(200);
    expect(mock.request).toHaveBeenCalledWith(expect.objectContaining({ id: "student" }), body());
  });
  it.each([{ consent: false }, { consentVersion: "old" }, { modelDraft: "AI text" }, { expectedRevision: -1 }])("rejects malformed or implicit consent fields: %j", async (change) => {
    expect((await post({ ...body(), ...change })).status).toBe(400);
    expect(mock.request).not.toHaveBeenCalled();
  });
  it("requires the course identity for lesson requests", async () => {
    expect((await post({ ...body(), scope: "LESSON" })).status).toBe(400);
    expect(mock.request).not.toHaveBeenCalled();
  });
  it("rate limits writes before domain mutation", async () => {
    mock.limit.mockReturnValue(Response.json({ error: "rate-limit" }, { status: 429 }));
    expect((await post(body())).status).toBe(429);
    expect(mock.request).not.toHaveBeenCalled();
  });
});
