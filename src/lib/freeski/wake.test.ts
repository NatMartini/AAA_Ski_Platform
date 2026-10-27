import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getWakeConfig, resetWakeDebounce, wakeFreeSkiProvider } from "./wake";

let dir: string, tokenFile: string;
const fetcher = vi.fn();
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "wake-"));
  tokenFile = path.join(dir, "token.txt");
  await writeFile(tokenFile, "scoped-token-value\n");
  vi.stubEnv("MODELCTRL_URL", "http://127.0.0.1:8765");
  vi.stubEnv("FREESKI_WAKE_SERVICE", "freeski-8100");
  vi.stubEnv("FREESKI_WAKE_TOKEN_FILE", tokenFile);
  vi.stubGlobal("fetch", fetcher);
  fetcher.mockReset();
  resetWakeDebounce();
});
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  await rm(dir, { recursive: true, force: true });
});

describe("ModelCtrl wake configuration", () => {
  it.each(["https://127.0.0.1:8765", "http://example.com:8765", "http://user:pw@127.0.0.1:8765", "http://127.0.0.1:8765/api", "http://127.0.0.1:8765/?x=1", "not a url"])(
    "only sends the scoped token to a bare loopback controller, not %s", url => {
      expect(getWakeConfig({ MODELCTRL_URL: url, FREESKI_WAKE_SERVICE: "freeski-8100", FREESKI_WAKE_TOKEN_FILE: "t" })).toBeNull();
    });
  it("is disabled without a service or token file, or with an unsafe service id", () => {
    expect(getWakeConfig({ MODELCTRL_URL: "http://127.0.0.1:8765", FREESKI_WAKE_TOKEN_FILE: "t" })).toBeNull();
    expect(getWakeConfig({ MODELCTRL_URL: "http://127.0.0.1:8765", FREESKI_WAKE_SERVICE: "freeski-8100" })).toBeNull();
    expect(getWakeConfig({ MODELCTRL_URL: "http://127.0.0.1:8765", FREESKI_WAKE_SERVICE: "../stop", FREESKI_WAKE_TOKEN_FILE: "t" })).toBeNull();
  });
});

describe("waking the on-demand provider", () => {
  it("posts a sanitized reason with the scoped token and reports the state", async () => {
    fetcher.mockResolvedValue(Response.json({ state: "ready", busy: false }));
    expect(await wakeFreeSkiProvider({ reason: "upload <video>/1", waitSeconds: 500 })).toBe("ready");
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe("http://127.0.0.1:8765/api/services/freeski-8100/start");
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer scoped-token-value");
    expect(JSON.parse(init.body)).toEqual({ reason: "upload video1", wait_seconds: 120 });
  });
  it("returns null instead of throwing on rejection, malformed replies or a missing token", async () => {
    fetcher.mockResolvedValueOnce(new Response("denied", { status: 401 }));
    expect(await wakeFreeSkiProvider({ reason: "a", waitSeconds: 1 })).toBeNull();
    fetcher.mockResolvedValueOnce(Response.json({ state: "teleported" }));
    expect(await wakeFreeSkiProvider({ reason: "a", waitSeconds: 1 })).toBeNull();
    fetcher.mockRejectedValueOnce(new Error("connect ECONNREFUSED"));
    expect(await wakeFreeSkiProvider({ reason: "a", waitSeconds: 1 })).toBeNull();
    vi.stubEnv("FREESKI_WAKE_TOKEN_FILE", path.join(dir, "missing.txt"));
    expect(await wakeFreeSkiProvider({ reason: "a", waitSeconds: 1 })).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it("sends one non-waiting wake-up per burst of failing page requests", async () => {
    fetcher.mockImplementation(async () => Response.json({ state: "starting" }));
    expect(await wakeFreeSkiProvider({ reason: "page" })).toBe("starting");
    expect(await wakeFreeSkiProvider({ reason: "page" })).toBeNull();
    expect(await wakeFreeSkiProvider({ reason: "dispatcher", waitSeconds: 30 })).toBe("starting");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("does nothing when wake-up is not configured", async () => {
    vi.stubEnv("MODELCTRL_URL", "");
    expect(await wakeFreeSkiProvider({ reason: "a" })).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
