import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { hasLanTestAccess, LAN_TEST_COOKIE, LAN_TEST_SIGN_IN_PATH, lanTestAccessEnabled, lanTestChallenge, lanTestCookieValue, lanTestSignIn } from "./lan-test-access";
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

  it("refuses without caching, and without asking for the browser's own sign-in prompt", () => {
    const response = lanTestChallenge();
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toBe("Authorization, Cookie");
  });
  it("accepts the access form's cookie and nothing made from another password", () => {
    const cookie = (value: string) => new Headers({ cookie: `theme=dark; ${LAN_TEST_COOKIE}=${value}; dev-as=kevin` });
    expect(hasLanTestAccess(cookie(lanTestCookieValue(password)), env)).toBe(true);
    expect(hasLanTestAccess(cookie(lanTestCookieValue("another-password-1")), env)).toBe(false);
    expect(hasLanTestAccess(cookie(password), env)).toBe(false);
    expect(hasLanTestAccess(cookie(""), env)).toBe(false);
    expect(lanTestCookieValue(password)).not.toContain(password);
  });

  it("gives a person opening a page the access form, without the browser's own sign-in prompt", async () => {
    const page = lanTestChallenge(new Request("http://192.168.31.141:3000/zh/video-analysis?source=account&x=<b>", { headers: { accept: "text/html,application/xhtml+xml" } }));
    expect(page.status).toBe(200);
    expect(page.headers.get("www-authenticate")).toBeNull();
    expect(page.headers.get("content-type")).toContain("text/html");
    expect(page.headers.get("cache-control")).toBe("private, no-store");
    const html = await page.text();
    expect(html).toContain(`<form method="post" action="${LAN_TEST_SIGN_IN_PATH}">`);
    expect(html).toContain('name="next" value="/zh/video-analysis?source=account&#38;x=%3Cb%3E"');
    expect(html).toContain('type="password"');
    expect(html).not.toContain(password);
    // Data requests and scripts are refused plainly: a form would be no use to them.
    for (const request of [new Request("http://192.168.31.141:3000/zh", { headers: { accept: "text/x-component" } }),
      new Request("http://192.168.31.141:3000/api/notifications", { headers: { accept: "text/html" } }),
      new Request("http://192.168.31.141:3000/zh", { method: "POST", headers: { accept: "text/html" } })]) {
      const refused = lanTestChallenge(request);
      expect(refused.status).toBe(401);
      expect(refused.headers.get("www-authenticate")).toBeNull();
    }
  });

  const submit = (fields: Record<string, string>, headers: Record<string, string> = {}) => new Request(`http://192.168.31.141:3000${LAN_TEST_SIGN_IN_PATH}`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", ...headers }, body: new URLSearchParams(fields).toString() });

  it("lets the right password in and sends it on to the page first asked for", async () => {
    const response = await lanTestSignIn(submit({ password, next: "/zh/coach/actions?tab=1" }), env, 0);
    expect(response.status).toBe(303);
    // Absolute, as Next's Proxy requires, and on the site the form was posted to.
    expect(response.headers.get("location")).toBe("http://192.168.31.141:3000/zh/coach/actions?tab=1");
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`${LAN_TEST_COOKIE}=${lanTestCookieValue(password)}`);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=lax/i);
    expect(cookie).toMatch(/Path=\//);
    expect(cookie).not.toMatch(/Secure/i);
    expect(hasLanTestAccess(new Headers({ cookie: cookie.split(";")[0] }), env)).toBe(true);
  });

  it("shows the form again for a wrong or missing password and sets nothing", async () => {
    const wrong = await lanTestSignIn(submit({ password: "not-the-password", next: "/zh" }), env, 0);
    expect(wrong.status).toBe(200);
    expect(wrong.headers.get("set-cookie")).toBeNull();
    const html = await wrong.text();
    expect(html).toContain("口令不对");
    expect(html).toContain('name="next" value="/zh"');
    const empty = await lanTestSignIn(submit({ next: "/zh" }), env, 0);
    expect(await empty.text()).not.toContain("口令不对");
    expect((await lanTestSignIn(submit({ password }, { "content-type": "text/plain" }), env, 0)).headers.get("set-cookie")).toBeNull();
    expect((await lanTestSignIn(submit({ password: `ski:${password}` }), { ...env, DEV_LAN_TEST_PASSWORD: "short" }, 0)).status).toBe(200);
  });

  it("never sends the browser to another site after the form", async () => {
    const backslash = String.fromCharCode(92);
    for (const next of ["//evil.example/zh", `/${backslash}evil.example`, "https://evil.example", "zh", LAN_TEST_SIGN_IN_PATH, `${LAN_TEST_SIGN_IN_PATH}?again=1`, "/zh\nx", ""]) {
      expect((await lanTestSignIn(submit({ password, next }), env, 0)).headers.get("location")).toBe("http://192.168.31.141:3000/");
    }
  });

  it("opens the form at its own address and passes on someone who already has access", async () => {
    const open = (headers: Record<string, string> = {}) => lanTestSignIn(new Request(`http://192.168.31.141:3000${LAN_TEST_SIGN_IN_PATH}`, { headers }), env, 0);
    expect((await open()).status).toBe(200);
    const through = await open({ cookie: `${LAN_TEST_COOKIE}=${lanTestCookieValue(password)}` });
    expect(through.status).toBe(303);
    expect(through.headers.get("location")).toBe("http://192.168.31.141:3000/");
  });

  it("gates both document/API entry and uploads that bypass Proxy body cloning", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("DEV_LAN_TEST_PASSWORD", password);
    const url = "http://192.168.31.141:3000";
    vi.stubEnv("AUTH_URL", url);
    expect((await proxy(new NextRequest(`${url}/zh/sign-in`))).status).toBe(401);
    expect((await proxy(new NextRequest(`${url}/api/notifications`))).status).toBe(401);
    expect(rateLimitOrRespond(new Request(`${url}/api/upload`, { method: "POST", headers: {
      origin: url, cookie: "dev-as=kevin.demo%40example.com",
    } }), "upload", "lan-test")?.status).toBe(401);
    expect((await proxy(new NextRequest(`${url}/api/notifications`, { headers: {
      authorization: credential(`ski:${password}`),
    } }))).status).toBe(200);
  });

  it("retains exact-origin CSRF protection after passing the LAN gate", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("DEV_LAN_TEST_PASSWORD", password);
    const url = "http://192.168.31.141:3000";
    vi.stubEnv("AUTH_URL", url);
    const write = (origin: string) => proxy(new NextRequest(`${url}/api/bookings`, {
      method: "POST", headers: { origin, authorization: credential(`ski:${password}`) },
    }));
    expect((await write(url)).status).toBe(200);
    expect((await write("http://evil.example")).status).toBe(403);
    expect((await write("http://localhost:3000")).status).toBe(403);
  });
  it("runs the form through Proxy: the form for a page, the cookie after it, then the site", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("DEV_LAN_TEST_PASSWORD", password);
    const url = "http://192.168.31.141:3000";
    vi.stubEnv("AUTH_URL", url);
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    const page = await proxy(new NextRequest(`${url}/zh/sign-in`, { headers: { accept: "text/html", "x-forwarded-for": "192.168.31.77", "user-agent": "TestBrowser/1" } }));
    expect(page.status).toBe(200);
    expect(await page.text()).toContain(`action="${LAN_TEST_SIGN_IN_PATH}"`);
    expect(log).toHaveBeenLastCalledWith("[lan-test] 192.168.31.77 was shown the access form (TestBrowser/1)");
    const passed = await proxy(new NextRequest(`${url}${LAN_TEST_SIGN_IN_PATH}`, { method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ password, next: "/zh/sign-in" }).toString() }));
    expect(passed.status).toBe(303);
    expect(passed.headers.get("location")).toBe("http://192.168.31.141:3000/zh/sign-in");
    expect(log).toHaveBeenLastCalledWith(expect.stringContaining("passed the access form"));
    const cookie = (passed.headers.get("set-cookie") ?? "").split(";")[0];
    expect((await proxy(new NextRequest(`${url}/api/notifications`, { headers: { cookie } }))).status).toBe(200);
    // With the cookie the page request reaches locale routing (mocked to an empty answer), not the form.
    expect(await (await proxy(new NextRequest(`${url}/zh/sign-in`, { headers: { cookie, accept: "text/html" } }))).text()).toBe("");
    expect(rateLimitOrRespond(new Request(`${url}/api/upload`, { method: "POST", headers: { origin: url, cookie } }), "upload", "lan-test-cookie")).toBeNull();
    log.mockRestore();
  });

  it("has no access form when the LAN gate is off", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("DEV_LAN_TEST_PASSWORD", undefined);
    const response = await proxy(new NextRequest(`http://localhost:3000${LAN_TEST_SIGN_IN_PATH}`, { headers: { accept: "text/html" } }));
    expect(await response.text()).toBe("");
  });
});
