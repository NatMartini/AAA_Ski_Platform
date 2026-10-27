import { describe, expect, it } from "vitest";
import { isTrustedApiWrite } from "./request-origin";

const env = { AUTH_URL: "https://ski.example.com" };
function req(headers: Record<string, string>, method = "POST", url = "https://ski.example.com/api/bookings") {
  return new Request(url, { method, headers: { cookie: "session=private", ...headers } });
}
describe("API write source checks", () => {
  it("accepts the exact configured origin even behind an internal proxy", () => {
    expect(isTrustedApiWrite(req({ origin: "https://ski.example.com" }, "POST", "http://internal:3000/api/bookings"), env)).toBe(true);
  });
  it.each(["https://attacker.example.com", "https://ski.example.com.evil.test", "http://ski.example.com", "https://ski.example.com:444", "null", "https://ski.example.com/path", "https://user@ski.example.com"])(
    "rejects untrusted or malformed origin %s", (origin) => {
      expect(isTrustedApiWrite(req({ origin }), env)).toBe(false);
    });
  it.each(["cross-site", "same-site"])("rejects %s writes even with missing Origin", (site) => {
    expect(isTrustedApiWrite(req({ "sec-fetch-site": site }), env)).toBe(false);
  });
  it("accepts a same-origin browser write when Origin is absent", () => {
    expect(isTrustedApiWrite(req({ "sec-fetch-site": "same-origin" }), env)).toBe(true);
  });
  it("uses the exact referer origin as the older-browser fallback", () => {
    expect(isTrustedApiWrite(req({ referer: "https://ski.example.com/zh/coach" }), env)).toBe(true);
    expect(isTrustedApiWrite(req({ referer: "https://ski.example.com.evil.test/" }), env)).toBe(false);
  });
  it("rejects cookie writes that provide no browser-source evidence", () => {
    expect(isTrustedApiWrite(req({}), env)).toBe(false);
  });
  it("allows a non-browser caller without cookies for route-level bearer authentication", () => {
    expect(isTrustedApiWrite(new Request("https://ski.example.com/api/cron/retention", {
      method: "POST", headers: { authorization: "Bearer cron-test" },
    }), env)).toBe(true);
  });
  it.each(["GET", "HEAD", "OPTIONS"])("leaves %s authentication to the route", (method) => {
    expect(isTrustedApiWrite(req({ origin: "https://evil.example" }, method), env)).toBe(true);
  });
  it("does not trust a spoofed forwarded-host header", () => {
    expect(isTrustedApiWrite(req({ origin: "https://evil.example", "x-forwarded-host": "evil.example" }), env)).toBe(false);
  });
});
