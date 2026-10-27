import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActiveUser } from "../auth/require-user";
import { AnalysisDomainError } from "./quota";

const mocks = vi.hoisted(() => ({ requireUser: vi.fn(), rateLimit: vi.fn(), state: vi.fn(), request: vi.fn(), issue: vi.fn(), list: vi.fn() }));
vi.mock("../auth/require-user", () => ({ requireUser: mocks.requireUser }));
vi.mock("../rate-limit", () => ({ rateLimitOrRespond: mocks.rateLimit }));
vi.mock("./account-service", () => ({ getAccountVideoAnalysisState: mocks.state, requestAccountAnalysis: mocks.request,
  issueAccountAnalysisGrant: mocks.issue, listAccountAnalysisGrants: mocks.list }));
import { GET as walletGET, POST as walletPOST } from "../../app/api/video-analysis/route";
import { GET as grantsGET, POST as grantsPOST } from "../../app/api/coach/video-analysis/grants/route";

const actor: ActiveUser = { id: "coach", name: "Coach", role: "COACH", email: "coach@example.com",
  image: null, phone: null, wechatId: null, tokenIssuedAt: "2026-10-08T17:00:00.000Z" };
const requestKey = "1be5a0bb-fb74-4ac1-a5eb-e18124769448";
const grantBody = { recipientEmail: "customer@example.com", quantity: 3, requestKey, expectedCoachId: "coach" };
const analysisBody = { videoId: "video", actionId: "parallel", requestKey, expectedAccountId: "coach" };
const post = (path: string, body: unknown) => new Request(`http://localhost:3000${path}`, {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireUser.mockResolvedValue({ ok: true, user: actor });
  mocks.rateLimit.mockReturnValue(null);
  mocks.state.mockResolvedValue({ ok: true, accountId: "coach" });
  mocks.request.mockResolvedValue({ ok: true });
  mocks.issue.mockResolvedValue({ ok: true });
  mocks.list.mockResolvedValue({ ok: true, coachId: "coach", grants: [] });
});

describe("account FreeSki API boundaries", () => {
  it("reads a wallet using only the current authenticated identity", async () => {
    const response = await walletGET(new Request("http://localhost:3000/api/video-analysis?accountId=other"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toContain("Cookie");
    expect(mocks.state).toHaveBeenCalledExactlyOnceWith(actor);
  });

  it.each([walletGET, grantsGET])("does not expose any data before authentication", async (get) => {
    mocks.requireUser.mockResolvedValue({ ok: false, response: Response.json({ error: "unauthorized" }, { status: 401 }) });
    expect((await get(new Request("http://localhost:3000/api/video-analysis?expectedCoachId=coach"))).status).toBe(401);
    expect(mocks.state).not.toHaveBeenCalled();
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it.each([undefined, null, ""])("requires an account snapshot on analysis POST (%s)", async (expectedAccountId) => {
    const response = await walletPOST(post("/api/video-analysis", { ...analysisBody, expectedAccountId }));
    expect(response.status).toBe(400);
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it("preserves the account snapshot and never accepts a requested beneficiary override", async () => {
    const response = await walletPOST(post("/api/video-analysis", { ...analysisBody, accountId: "other", grantTotal: 999 }));
    expect(response.status).toBe(200);
    expect(mocks.request).toHaveBeenCalledExactlyOnceWith(actor, analysisBody);
  });

  it.each([undefined, "other"])("requires the current coach snapshot before reading grant logs (%s)", async (id) => {
    const suffix = id ? `?expectedCoachId=${id}` : "";
    const response = await grantsGET(new Request(`http://localhost:3000/api/coach/video-analysis/grants${suffix}`));
    expect(response.status).toBe(409);
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it("passes a valid grant-history snapshot to the freshly checked service", async () => {
    const response = await grantsGET(new Request("http://localhost:3000/api/coach/video-analysis/grants?expectedCoachId=coach"));
    expect(await response.json()).toMatchObject({ coachId: "coach" });
    expect(mocks.list).toHaveBeenCalledExactlyOnceWith(actor);
  });

  it("accepts UI null notes and normalizes a typed address before issuing", async () => {
    const response = await grantsPOST(post("/api/coach/video-analysis/grants", { ...grantBody,
      recipientEmail: " CUSTOMER@EXAMPLE.COM ", note: null }));
    expect(response.status).toBe(200);
    expect(mocks.issue).toHaveBeenCalledExactlyOnceWith(actor, { ...grantBody, note: null });
  });

  it.each([{ quantity: 101 }, { quantity: 1.5 }, { recipientEmail: "bad" }, { expectedCoachId: undefined },
    { requestKey: "not-uuid" }, { note: "x".repeat(501) }])("refuses invalid grant bodies before any write (%j)", async (changes) => {
    expect((await grantsPOST(post("/api/coach/video-analysis/grants", { ...grantBody, ...changes }))).status).toBe(400);
    expect(mocks.issue).not.toHaveBeenCalled();
  });

  it("stream-bounds an oversized grant body before creating any grant", async () => {
    const response = await grantsPOST(post("/api/coach/video-analysis/grants", { ...grantBody, note: "x".repeat(1024 * 1024) }));
    expect(response.status).toBe(413);
    expect(mocks.issue).not.toHaveBeenCalled();
  });

  it("maps revoked instructor authorization to forbidden", async () => {
    mocks.issue.mockRejectedValue(new AnalysisDomainError("forbidden"));
    expect((await grantsPOST(post("/api/coach/video-analysis/grants", grantBody))).status).toBe(403);
  });

  it("respects the shared write limit before parsing or issuing", async () => {
    mocks.rateLimit.mockReturnValue(Response.json({ error: "rate-limited" }, { status: 429 }));
    expect((await grantsPOST(post("/api/coach/video-analysis/grants", grantBody))).status).toBe(429);
    expect(mocks.requireUser).not.toHaveBeenCalled();
    expect(mocks.issue).not.toHaveBeenCalled();
  });
});
