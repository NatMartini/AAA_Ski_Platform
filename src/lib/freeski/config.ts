export type FreeSkiConfig = {
  baseUrl: string;
  deploymentId?: string;
  identifier: string;
  password: string;
  requestTimeoutMs: number;
  analysisTimeoutMs: number;
  pollIntervalMs: number;
  maxVideoBytes: number;
};

/** HTTP is allowed only on loopback; remote deployments must use HTTPS. */
export function safeFreeSkiBaseUrl(raw: string | undefined): string | null {
  try {
    if (!raw) return null;
    const url = new URL(raw);
    const local = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
    if (url.username || url.password || url.search || url.hash || url.pathname !== "/") return null;
    if (url.protocol !== "https:" && !(local && url.protocol === "http:")) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function boundedInteger(raw: string | undefined, fallback: number, min: number, max: number): number {
  if (!raw || !/^\d+$/.test(raw)) return fallback;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n >= min && n <= max ? n : fallback;
}

export function getFreeSkiConfig(env: Record<string, string | undefined> = process.env): FreeSkiConfig | null {
  const baseUrl = safeFreeSkiBaseUrl(env.FREESKI_BASE_URL);
  const identifier = env.FREESKI_SERVICE_IDENTIFIER?.trim();
  const password = env.FREESKI_SERVICE_PASSWORD;
  if (!baseUrl || !identifier || !password || password.length < 16) return null;
  const deploymentId = env.FREESKI_DEPLOYMENT_ID?.trim();
  if (deploymentId && !/^[a-zA-Z0-9][a-zA-Z0-9._-]{2,79}$/.test(deploymentId)) return null;
  return {
    baseUrl,
    ...(deploymentId ? { deploymentId } : {}),
    identifier,
    password,
    requestTimeoutMs: boundedInteger(env.FREESKI_REQUEST_TIMEOUT_MS, 120_000, 5_000, 300_000),
    analysisTimeoutMs: boundedInteger(env.FREESKI_ANALYSIS_TIMEOUT_MS, 3_000_000, 60_000, 3_300_000),
    pollIntervalMs: boundedInteger(env.FREESKI_POLL_INTERVAL_MS, 2_000, 500, 10_000),
    maxVideoBytes: 200 * 1024 * 1024,
  };
}

export function isFreeSkiConfigured(): boolean {
  return getFreeSkiConfig() !== null;
}
