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

// A stopped controller logs nothing, so each failed wake-up says which side it failed on: the token
// file, the connection, or ModelCtrl's answer. Only error names and codes are logged, never the token.
const warn = (problem: string) => console.warn(`[freeski-wake] ${problem}`);
const failure = (error: unknown) => {
  const code = (error as { cause?: { code?: unknown } } | null)?.cause?.code;
  return typeof code === "string" ? code : error instanceof Error ? error.name : "unknown error";
};
// ModelCtrl's own reason when it refuses (a disabled or misregistered service) or cannot start one; it holds no secret.
const said = (body: unknown) => {
  const error = (body as { error?: unknown } | null)?.error;
  return typeof error === "string" && error.trim() ? `: ${error.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 160)}` : "";
};

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
  let token: string;
  try {
    token = (await readFile(config.tokenFile, "utf8")).trim();
  } catch (error) {
    warn(`cannot read the wake token file (${failure(error)})`);
    return null;
  }
  if (!token || /\s/.test(token)) { warn("the wake token file is empty or malformed"); return null; }
  let response: Response;
  try {
    response = await fetch(`${config.url}/start`, {
      method: "POST", redirect: "error", cache: "no-store",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ reason: input.reason.replace(/[^\w:. -]/g, "").slice(0, 120) || "aaa", wait_seconds: waitSeconds }),
      signal: AbortSignal.timeout((waitSeconds + 10) * 1000),
    });
  } catch (error) {
    warn(`cannot reach ModelCtrl (${failure(error)})`);
    return null;
  }
  if (!response.ok) {
    warn(`ModelCtrl refused the wake-up (HTTP ${response.status}${said(await response.json().catch(() => null))})`);
    return null;
  }
  try {
    const body = await response.json() as { state?: unknown };
    if (body.state === "failed") warn(`ModelCtrl could not start the service${said(body)}`);
    if (typeof body.state === "string" && ["stopped", "starting", "ready", "external", "failed"].includes(body.state)) return body.state as ProviderState;
  } catch {
    // Reported below with any other unknown answer.
  }
  warn("ModelCtrl answered the wake-up without a known service state");
  return null;
}

/** Test hook: forget the debounce window. */
export function resetWakeDebounce() {
  lastRequest = 0;
}
