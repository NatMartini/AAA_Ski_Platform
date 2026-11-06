/**
 * The on-demand FreeSki service stops when idle. While it is down the report proxy answers 503 and
 * asks ModelCtrl to start it without waiting (docs/FREESKI_SERVICE_BOUNDARY.md); it answers again
 * about 5 s later. Pages ask again every 5 s, for about two minutes.
 */
export const STARTUP_RETRY_MS = 5_000;
export const STARTUP_RETRIES = 24;

/**
 * Sends a report read again while it answers 503 and returns the first other response, or the last
 * 503 once the retries run out. A 404 or 409 is final and returned at once. `onStarting` runs before
 * each wait; an abort during a wait rejects. Reads only: a write may already have been accepted.
 */
export async function retryWhileStarting(send: () => Promise<Response>,
  { signal, onStarting }: { signal?: AbortSignal; onStarting?: () => void } = {}): Promise<Response> {
  for (let retry = 0; ; retry++) {
    const response = await send();
    if (response.status !== 503 || retry >= STARTUP_RETRIES || signal?.aborted) return response;
    await response.body?.cancel();
    onStarting?.();
    await pause(STARTUP_RETRY_MS, signal);
  }
}

function pause(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason); return; }
    const stop = () => { clearTimeout(timer); reject(signal?.reason); };
    const timer = setTimeout(() => { signal?.removeEventListener("abort", stop); resolve(); }, ms);
    signal?.addEventListener("abort", stop, { once: true });
  });
}
