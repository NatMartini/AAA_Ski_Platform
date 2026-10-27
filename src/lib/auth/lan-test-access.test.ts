import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { hasLanTestAccess, lanTestAccessEnabled, lanTestChallenge } from "./lan-test-access";
import { proxy } from "@/proxy";
import { rateLimitOrRespond } from "@/lib/rate-limit";

vi.mock("next-intl/middleware", () => ({ default: () => () => new Response(null) }));

const password = "lan-test-password-for-tests";
const env = { NODE_ENV: "development", DEV_LAN_TEST_PASSWORD: password };
const credential = (value: string) => `Basic ${Buffer.from(value).toString("base64")}`;
const headers = (authorization?: string) => new Headers(authorization ? { authorization } : {});

afterEach(() => vi.unstubAllEnvs());

describe("explicit LAN test access", () => {
  it("does not affect ordinary local development or production authentication", () => {
    expect(lanTestAccessEnabled({ NODE_ENV: "development" })).toBe(false);
    expect(hasLanTestAccess(headers(), { NODE_ENV: "development" })).toBe(true);
    expect(lanTestAccessEnabled({ ...env, NODE_ENV: "production" })).toBe(false);
  });

  it("accepts only the configured account and secret", () => {
    expect(hasLanTestAccess(headers(credential(`ski:${password}`)), env)).toBe(true);
    expect(hasLanTestAccess(headers(credential(`other:${password}`)), env)).toBe(false);
    expect(hasLanTestAccess(headers(credential("ski:wrong")), env)).toBe(false);
  });

  it.each([undefined, "Bearer private", "Basic ###", "Basic ", "Basic " + "a".repeat(513)])(
    "rejects missing or malformed credentials %s", (value) => {
      expect(hasLanTestAccess(headers(value), env)).toBe(false);
    });

  it.each(["", "short"])("fails closed for a configured weak/empty password", (value) => {
    expect(hasLanTestAccess(headers(credential(`ski:${value}`)), { ...env, DEV_LAN_TEST_PASSWORD: value })).toBe(false);
  });

  it("challenges the browser without caching credentials or a private response", () => {
    const response = lanTestChallenge();
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain('Basic realm="AAA Ski LAN test"');
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toBe("Authorization");
  });

  it("gates both document/API entry and uploads that bypass Proxy body cloning", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("DEV_LAN_TEST_PASSWORD", password);
    const url = "http://192.168.31.141:3000";
    vi.stubEnv("AUTH_URL", url);
    expect(proxy(new NextRequest(`${url}/zh/sign-in`)).status).toBe(401);
    expect(proxy(new NextRequest(`${url}/api/notifications`)).status).toBe(401);
    expect(rateLimitOrRespond(new Request(`${url}/api/upload`, { method: "POST", headers: {
      origin: url, cookie: "dev-as=kevin.demo%40example.com",
    } }), "upload", "lan-test")?.status).toBe(401);
    expect(proxy(new NextRequest(`${url}/api/notifications`, { headers: {
      authorization: credential(`ski:${password}`),
    } })).status).toBe(200);
  });

  it("retains exact-origin CSRF protection after passing the LAN gate", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("DEV_LAN_TEST_PASSWORD", password);
    const url = "http://192.168.31.141:3000";
    vi.stubEnv("AUTH_URL", url);
    const write = (origin: string) => proxy(new NextRequest(`${url}/api/bookings`, {
      method: "POST", headers: { origin, authorization: credential(`ski:${password}`) },
    }));
    expect(write(url).status).toBe(200);
    expect(write("http://evil.example").status).toBe(403);
    expect(write("http://localhost:3000").status).toBe(403);
  });
});
