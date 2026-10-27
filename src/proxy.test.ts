import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { config, proxy } from "./proxy";

vi.mock("next-intl/middleware", () => ({ default: () => () => new Response(null) }));

describe("API origin protection and upload routing", () => {
  it.each(["/api/bookings", "/api/coach/settings", "/api/bookings/SKI/analysis", "/api/bookings/SKI/review", "/api/packages/SKI/review", "/api/waiver-invites/token"])(
    "protects the write entry %s", (pathname) => {
      expect(unstable_doesMiddlewareMatch({ config, url: `http://localhost:3000${pathname}` })).toBe(true);
      const response = proxy(new NextRequest(`http://localhost:3000${pathname}`, {
        method: "POST", headers: { cookie: "session=private", origin: "https://evil.example" },
      }));
      expect(response.status).toBe(403);
    });

  it.each(["/api/upload", "/api/bookings/SKI/videos", "/api/bookings/SKI/videos/clip", "/api/video-analysis/videos", "/api/video-analysis/videos/clip"])(
    "avoids Proxy's 10MB body cloning for guarded upload route %s", (pathname) => {
      expect(unstable_doesMiddlewareMatch({ config, url: `http://localhost:3000${pathname}` })).toBe(false);
    });

  it("leaves API GET auth to the route and document routes to locale routing", () => {
    expect(proxy(new NextRequest("http://localhost:3000/api/bookings/SKI", { headers: { origin: "https://evil.example" } })).status).toBe(200);
    expect(unstable_doesMiddlewareMatch({ config, url: "http://localhost:3000/zh/coach" })).toBe(true);
    expect(unstable_doesMiddlewareMatch({ config, url: "http://localhost:3000/_next/static/file.js" })).toBe(false);
  });
});
