import { readFile } from "node:fs/promises";

export type ProviderState = "stopped" | "starting" | "ready" | "external" | "failed";
type WakeConfig = { url: string; tokenFile: string };

/** ModelCtrl owns the on-demand FreeSki provider; AAA only asks it to start or stay up. */
export function getWakeConfig(env: Record<string, string | undefined> = process.env): WakeConfig | null {
  const service = env.FREESKI_WAKE_SERVICE?.trim(), tokenFile = env.FREESKI_WAKE_TOKEN_FILE?.trim();
  if (!service || !tokenFile || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(service)) return null;
  try {
    const base = new URL(env.MODELCTRL_URL ?? "");
    // The scoped token may only travel to the local controller.
    if (base.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(base.hostname) ||
        base.username || base.password || base.search || base.hash || base.pathname !== "/") return null;
    return { url: `${base.origin}/api/services/${service}`, tokenFile };
  } catch {
    return null;
  }
}

let lastRequest = 0;

/**
 * Requests a start (or keep-alive) and reports the provider state, or null when wake-up is not
 * configured or failed. Never throws and never exposes the token. Without waiting, repeated calls
 * within ten seconds are skipped so a burst of failing requests sends one wake-up.
 */
export async function wakeFreeSkiProvider(input: { reason: string; waitSeconds?: number }): Promise<ProviderState | null> {
  const config = getWakeConfig();
  if (!config) return null;
  const waitSeconds = Math.max(0, Math.min(120, Math.floor(input.waitSeconds ?? 0)));
  if (waitSeconds === 0 && Date.now() - lastRequest < 10_000) return null;
  lastRequest = Date.now();
  try {
    const token = (await readFile(config.tokenFile, "utf8")).trim();
    if (!token || /\s/.test(token)) return null;
    const response = await fetch(`${config.url}/start`, {
      method: "POST", redirect: "error", cache: "no-store",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ reason: input.reason.replace(/[^\w:. -]/g, "").slice(0, 120) || "aaa", wait_seconds: waitSeconds }),
      signal: AbortSignal.timeout((waitSeconds + 10) * 1000),
    });
    if (!response.ok) { await response.body?.cancel(); return null; }
    const state = (await response.json() as { state?: unknown }).state;
    return typeof state === "string" && ["stopped", "starting", "ready", "external", "failed"].includes(state) ? state as ProviderState : null;
  } catch {
    return null;
  }
}

/** Test hook: forget the debounce window. */
export function resetWakeDebounce() {
  lastRequest = 0;
}
