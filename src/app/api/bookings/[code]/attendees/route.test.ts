import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), roster: vi.fn(), reissue: vi.fn() }));
vi.mock("@/lib/auth/require-user", () => ({ requireUser: mocks.auth }));
vi.mock("@/lib/booking/attendees", () => ({ loadAttendeeRoster: mocks.roster, reissueAttendeeInvite: mocks.reissue }));
vi.mock("@/lib/rate-limit", () => ({ rateLimitOrRespond: () => null }));
import { GET, POST } from "./route";
import { POST as nestedPost } from "./[attendeeId]/invite/route";
const user = { id: "buyer", email: "buyer@example.test", role: "CUSTOMER" };
const ctx = { params: Promise.resolve({ code: "SKI-GROUP" }) };
beforeEach(() => { vi.resetAllMocks(); mocks.auth.mockResolvedValue({ ok: true, user }); });

describe("personal invitation API boundaries", () => {
  it("requires authentication before reading attendee identities", async () => {
    mocks.auth.mockResolvedValue({ ok: false, response: new Response(null, { status: 401 }) });
    expect((await GET(new Request("http://localhost/api"), ctx)).status).toBe(401);
    expect(mocks.roster).not.toHaveBeenCalled();
  });
  it("marks attendee identities private and never caches them", async () => {
    mocks.roster.mockResolvedValue({ ok: true, attendees: [{ id: "guest", fullName: "Guest" }], allSigned: false, canManage: true });
    const response = await GET(new Request("http://localhost/api"), ctx);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toBe("Cookie");
    expect(mocks.roster).toHaveBeenCalledWith("SKI-GROUP", user);
  });
  it("rejects malformed or missing attendee IDs without regenerating a token", async () => {
    for (const body of [null, {}, { attendeeId: 123 }, { attendeeId: "" }]) {
      const response = await POST(new Request("http://localhost/api", { method: "POST", body: JSON.stringify(body) }), ctx);
      expect(response.status).toBe(400);
    }
    expect(mocks.reissue).not.toHaveBeenCalled();
  });
  it.each(["forbidden", "not-invitable", "expired"])("keeps rejected reissues from exposing signing links: %s", async (reason) => {
    mocks.reissue.mockResolvedValue({ ok: false, reason });
    const response = await nestedPost(new Request("http://localhost/api", { method: "POST" }), {
      params: Promise.resolve({ code: "SKI-GROUP", attendeeId: "guest" }),
    });
    expect(response.status).toBe(reason === "forbidden" ? 403 : 409);
    expect(await response.json()).toEqual({ error: reason });
  });
  it("returns the manual link privately using the requested language", async () => {
    mocks.reissue.mockResolvedValue({ ok: true, signingUrl: "http://localhost/en/w/personal-token", invitation: { to: "guest@example.test" } });
    const response = await nestedPost(new Request("http://localhost/api", { method: "POST", headers: { "x-locale": "en" } }), {
      params: Promise.resolve({ code: "SKI-GROUP", attendeeId: "guest" }),
    });
    expect(mocks.reissue).toHaveBeenCalledWith("SKI-GROUP", "guest", user, "en");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
});
