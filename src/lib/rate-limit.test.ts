import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetRateLimits, checkRateLimit, clientKey, rateLimitOrRespond } from "./rate-limit";

const request = (ip: string, extra: HeadersInit = {}) => new Request("http://localhost:3000/api/upload", {
  method: "POST", headers: { "x-forwarded-for": ip, ...extra },
});

describe("request source and bounded rate limits", () => {
  beforeEach(() => { __resetRateLimits(); vi.stubEnv("TRUST_PROXY_HEADERS", "false"); });
  afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); __resetRateLimits(); });

  it("does not let direct clients reset counters using forged forwarded headers", () => {
    for (let i = 0; i < 20; i++) expect(checkRateLimit(request(`192.0.2.${i}`), "upload", "test").allowed).toBe(true);
    expect(checkRateLimit(request("203.0.113.1"), "upload", "test").allowed).toBe(false);
    expect(clientKey(request("192.0.2.1", { "x-real-ip": "203.0.113.1" }))).toBe("local");
  });

  it("accepts valid addresses only when a trusted proxy is explicitly configured", () => {
    vi.stubEnv("TRUST_PROXY_HEADERS", "true");
    expect(clientKey(request("192.0.2.1, 127.0.0.1"))).toBe("192.0.2.1");
    expect(clientKey(request("2001:db8::1"))).toBe("2001:db8::1");
    expect(clientKey(request("arbitrary-counter-name"))).toBe("local");
    expect(clientKey(request(""))).toBe("local");
  });

  it("caps unique buckets without evicting a client's active counter", () => {
    vi.useFakeTimers();
    vi.stubEnv("TRUST_PROXY_HEADERS", "true");
    for (let i = 0; i < 5000; i++) expect(checkRateLimit(request("192.0.2.1"), "auth", `scope-${i}`).allowed).toBe(true);
    expect(checkRateLimit(request("192.0.2.2"), "auth", "new-scope").allowed).toBe(false);
    for (let i = 0; i < 19; i++) expect(checkRateLimit(request("192.0.2.1"), "auth", "scope-0").allowed).toBe(true);
    expect(checkRateLimit(request("192.0.2.1"), "auth", "scope-0").allowed).toBe(false);
    vi.advanceTimersByTime(60_001);
    expect(checkRateLimit(request("192.0.2.2"), "auth", "new-scope").allowed).toBe(true);
  });

  it("rejects cross-origin multipart writes before consuming the body", async () => {
    const req = request("192.0.2.1", { cookie: "session=secret", origin: "https://evil.example", "sec-fetch-site": "cross-site" });
    const response = rateLimitOrRespond(req, "upload", "test");
    expect(response?.status).toBe(403);
    expect(req.bodyUsed).toBe(false);
    expect(await response?.json()).toEqual({ error: "untrusted-origin" });
  });

  it("allows the canonical same-origin write and returns Retry-After on exhaustion", () => {
    vi.stubEnv("AUTH_URL", "http://localhost:3000");
    const req = request("192.0.2.1", { cookie: "session=secret", origin: "http://localhost:3000" });
    for (let i = 0; i < 20; i++) expect(rateLimitOrRespond(req, "upload", "test")).toBeNull();
    const response = rateLimitOrRespond(req, "upload", "test");
    expect(response?.status).toBe(429);
    expect(Number(response?.headers.get("Retry-After"))).toBeGreaterThan(0);
  });
});
