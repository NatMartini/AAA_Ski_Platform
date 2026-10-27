import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

type Environment = Record<string, string | undefined>;

/** An extra, session-specific gate for the explicitly enabled LAN demo server. */
export function lanTestAccessEnabled(env: Environment = process.env): boolean {
  return env.NODE_ENV !== "production" && env.DEV_LAN_TEST_PASSWORD !== undefined;
}

export function hasLanTestAccess(
  headers: Pick<Headers, "get">,
  env: Environment = process.env,
): boolean {
  if (!lanTestAccessEnabled(env)) return true;
  const password = env.DEV_LAN_TEST_PASSWORD ?? "";
  if (password.length < 12) return false;
  const supplied = headers.get("authorization") ?? "";
  if (supplied.length > 512 || !/^Basic [A-Za-z0-9+/]+=*$/i.test(supplied)) return false;
  const expected = `ski:${password}`;
  const decoded = Buffer.from(supplied.slice(6), "base64");
  return timingSafeEqual(
    createHash("sha256").update(decoded).digest(),
    createHash("sha256").update(expected).digest(),
  );
}

export function lanTestChallenge(): NextResponse {
  return new NextResponse("请输入局域网测试访问口令 / Enter the LAN test credentials.", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="AAA Ski LAN test", charset="UTF-8"',
      "Cache-Control": "private, no-store",
      "Content-Type": "text/plain; charset=utf-8",
      Vary: "Authorization",
    },
  });
}
