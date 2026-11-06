import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clientFetch } from "../client-fetch";
import { coachingReportSchema } from "./report-v2";
import { sampleReport } from "./scorecard.fixtures";
import { retryWhileStarting, STARTUP_RETRIES, STARTUP_RETRY_MS } from "./startup-retry";

const starting = () => Response.json({ error: "dynamic-report-unavailable" }, { status: 503 });

beforeEach(() => { vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] }); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("report reads while the on-demand FreeSki service starts", () => {
  it("asks again every 5 s and returns the report once the service answers", async () => {
    // Opening a report while the service is stopped: the proxy wakes it and answers 503 until it is up.
    const fetch = vi.fn().mockResolvedValueOnce(starting()).mockResolvedValueOnce(starting()).mockResolvedValueOnce(Response.json(sampleReport));
    vi.stubGlobal("fetch", fetch);
    const onStarting = vi.fn();
    const read = retryWhileStarting(() => clientFetch("/report", { cache: "no-store" }), { onStarting });
    await vi.advanceTimersByTimeAsync(0);
    expect(onStarting).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(STARTUP_RETRY_MS - 1);
    expect(fetch).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(fetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(STARTUP_RETRY_MS);
    const report = coachingReportSchema.parse(await (await read).json());
    expect(report.turns.length).toBeGreaterThan(0);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(onStarting).toHaveBeenCalledTimes(2);
  });

  it.each([404, 409, 502])("returns a definite %i at once", async status => {
    const send = vi.fn().mockResolvedValue(Response.json({ error: "dynamic-report-unavailable" }, { status }));
    const onStarting = vi.fn();
    expect((await retryWhileStarting(send, { onStarting })).status).toBe(status);
    expect(send).toHaveBeenCalledOnce();
    expect(onStarting).not.toHaveBeenCalled();
  });

  it("gives up after about two minutes and returns the last 503", async () => {
    const send = vi.fn(async () => starting());
    let settled: Response | undefined;
    void retryWhileStarting(send).then(response => { settled = response; });
    expect(STARTUP_RETRIES * STARTUP_RETRY_MS).toBe(120_000);
    await vi.advanceTimersByTimeAsync(STARTUP_RETRIES * STARTUP_RETRY_MS - 1);
    expect(settled).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(settled?.status).toBe(503);
    expect(send).toHaveBeenCalledTimes(STARTUP_RETRIES + 1);
  });

  it("stops asking when the page leaves", async () => {
    const send = vi.fn(async () => starting());
    const controller = new AbortController();
    const read = retryWhileStarting(send, { signal: controller.signal });
    await vi.advanceTimersByTimeAsync(STARTUP_RETRY_MS);
    expect(send).toHaveBeenCalledTimes(2);
    controller.abort();
    await expect(read).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(STARTUP_RETRIES * STARTUP_RETRY_MS);
    expect(send).toHaveBeenCalledTimes(2);
  });
});
