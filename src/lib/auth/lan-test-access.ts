import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { setTimeout as pause } from "node:timers/promises";
import { NextResponse } from "next/server";

type Environment = Record<string, string | undefined>;

/** Kept by the browser once the access form is passed. Its value is derived from the session's password. */
export const LAN_TEST_COOKIE = "aaa_ski_lan_test";
/** Where the access form posts. Proxy answers it, so there is no page or route behind it. */
export const LAN_TEST_SIGN_IN_PATH = "/lan-test-access";

/** An extra, session-specific gate for the explicitly enabled LAN demo server. */
export function lanTestAccessEnabled(env: Environment = process.env): boolean {
  return env.NODE_ENV !== "production" && env.DEV_LAN_TEST_PASSWORD !== undefined;
}

const same = (a: string | Buffer, b: string) =>
  timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());

/** A configured password too short to be one gives nobody access. */
function configured(env: Environment): string | null {
  const password = env.DEV_LAN_TEST_PASSWORD ?? "";
  return password.length >= 12 ? password : null;
}

/** What the cookie holds for a password: a keyed digest the password cannot be read back from. */
export function lanTestCookieValue(password: string): string {
  return createHmac("sha256", password).update("aaa-ski-lan-test-access.v1").digest("base64url");
}

function cookieValue(header: string | null, name: string): string | null {
  if (!header || header.length > 8192) return null;
  for (const part of header.split(";")) {
    const at = part.indexOf("=");
    if (at > 0 && part.slice(0, at).trim() === name) return part.slice(at + 1).trim();
  }
  return null;
}

/** Access comes from the form's cookie, or from the credentials a script sends with each request (user `ski`). */
export function hasLanTestAccess(
  headers: Pick<Headers, "get">,
  env: Environment = process.env,
): boolean {
  if (!lanTestAccessEnabled(env)) return true;
  const password = configured(env);
  if (!password) return false;
  const supplied = headers.get("authorization") ?? "";
  if (supplied.length <= 512 && /^Basic [A-Za-z0-9+/]+=*$/i.test(supplied)
    && same(Buffer.from(supplied.slice(6), "base64"), `ski:${password}`)) return true;
  const cookie = cookieValue(headers.get("cookie"), LAN_TEST_COOKIE);
  return cookie !== null && cookie.length <= 128 && same(cookie, lanTestCookieValue(password));
}

const noStore = { "Cache-Control": "private, no-store", Vary: "Authorization, Cookie" };
/** Next's Proxy accepts only an absolute address to go on to; the path stays on the site the request came to. */
const goTo = (path: string, request: Pick<Request, "url">) =>
  new NextResponse(null, { status: 303, headers: { ...noStore, Location: new URL(path, request.url).toString() } });
const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

/** Only a path on this site may follow the form: never another site, and not the form itself. */
function safeNext(value: string | null | undefined): string {
  if (!value || value.length > 2048 || !/^[!-~]+$/.test(value)) return "/";
  // 47 is a slash and 92 a backslash: "//host" and "/\host" both leave the site.
  if (value.charCodeAt(0) !== 47 || value.charCodeAt(1) === 47 || value.charCodeAt(1) === 92) return "/";
  return value === LAN_TEST_SIGN_IN_PATH || value.startsWith(`${LAN_TEST_SIGN_IN_PATH}?`) ? "/" : value;
}

function accessForm(next: string, failed: boolean): NextResponse {
  const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><title>局域网测试访问</title>
<style>body{margin:0;font:16px/1.6 system-ui,sans-serif;background:#f4f6f8;color:#15202b}
main{max-width:26rem;margin:12vh auto 0;padding:1.5rem}h1{font-size:1.25rem;margin:0 0 .5rem}
p{margin:.5rem 0;color:#4a5560;font-size:.9rem}label{display:block;margin-top:1rem;font-weight:600;font-size:.9rem}
input[type=password]{box-sizing:border-box;width:100%;margin-top:.4rem;padding:.7rem .8rem;font-size:16px;border:1px solid #b8c2cc;border-radius:.6rem}
button{margin-top:1rem;width:100%;padding:.75rem;font-size:1rem;font-weight:600;color:#fff;background:#1463d8;border:0;border-radius:.6rem}
.error{color:#b42318;font-weight:600}</style></head>
<body><main><h1>局域网测试访问 <span lang="en">· LAN test access</span></h1>
<p>这是开发用的测试站。请输入这次启动的访问口令。<br><span lang="en">This is a development test site. Enter this session's access password.</span></p>
${failed ? '<p class="error" role="alert">口令不对，请再试一次。 <span lang="en">Wrong password.</span></p>' : ""}
<form method="post" action="${LAN_TEST_SIGN_IN_PATH}"><input type="hidden" name="next" value="${escapeHtml(next)}">
<label for="password">访问口令 <span lang="en">· Access password</span></label>
<input id="password" name="password" type="password" autocomplete="current-password" autocapitalize="off" spellcheck="false" required autofocus>
<button type="submit">进入 <span lang="en">· Enter</span></button></form>
<p>口令在电脑上的启动日志和 storage/lan-test-access.json 里。</p></main></body></html>`;
  return new NextResponse(html, { status: 200, headers: { ...noStore, "Content-Type": "text/html; charset=utf-8" } });
}

/**
 * No access yet. Someone opening a page gets the access form, which works in every browser. The browser's own
 * sign-in prompt is not asked for (no WWW-Authenticate): in-app browsers answer it by themselves, over and over,
 * until they give up with an error. Anything else, such as a data request from a page whose cookie has gone, is
 * refused plainly.
 */
export function lanTestChallenge(request?: Pick<Request, "method" | "url" | "headers">): NextResponse {
  if (request && (request.method === "GET" || request.method === "HEAD") && (request.headers.get("accept") ?? "").includes("text/html")) {
    const { pathname, search } = new URL(request.url);
    if (pathname !== "/api" && !pathname.startsWith("/api/")) return accessForm(safeNext(pathname + search), false);
  }
  return new NextResponse("请先在浏览器里打开这个测试站并输入访问口令。 / Open this test site in a browser and enter the access password first.", {
    status: 401,
    headers: { ...noStore, "Content-Type": "text/plain; charset=utf-8" },
  });
}

async function formFields(request: Request): Promise<URLSearchParams | null> {
  const type = (request.headers.get("content-type") ?? "").toLowerCase();
  if (!type.startsWith("application/x-www-form-urlencoded") || Number(request.headers.get("content-length") ?? 0) > 4096) return null;
  try {
    const text = await request.text();
    return text.length <= 4096 ? new URLSearchParams(text) : null;
  } catch {
    return null;
  }
}

/**
 * The access form's own address. Submitting the right password sets the cookie and goes on to the page first asked
 * for; a wrong one shows the form again after a pause that slows guessing.
 */
export async function lanTestSignIn(request: Request, env: Environment = process.env, wrongPauseMs = 400): Promise<NextResponse> {
  if (request.method !== "POST") return hasLanTestAccess(request.headers, env) ? goTo("/", request) : accessForm("/", false);
  const fields = await formFields(request), password = configured(env);
  const next = safeNext(fields?.get("next")), supplied = fields?.get("password") ?? "";
  if (!password || !supplied || supplied.length > 256 || !same(supplied, password)) {
    await pause(wrongPauseMs);
    return accessForm(next, supplied.length > 0);
  }
  const response = goTo(next, request);
  response.cookies.set({ name: LAN_TEST_COOKIE, value: lanTestCookieValue(password), httpOnly: true, sameSite: "lax", path: "/", maxAge: 12 * 60 * 60 });
  return response;
}
