import { afterEach, describe, expect, it, vi } from "vitest";
import { clientFetch } from "./client-fetch";

afterEach(() => vi.unstubAllGlobals());

describe("clientFetch", () => {
  it("returns a failed response when the connection drops without retrying a write", async () => {
    const fetch = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetch);

    const response = await clientFetch("/api/bookings", {
      method: "POST",
      body: JSON.stringify({ participantId: "student" }),
    });

    expect(response.ok).toBe(false);
    expect(await response.json()).toEqual({ error: "network-error" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("preserves an API conflict and its body for the form to explain", async () => {
    const conflict = Response.json({ error: "slot-taken" }, { status: 409 });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(conflict));

    const response = await clientFetch("/api/bookings", { method: "POST" });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "slot-taken" });
  });

  it("passes upload data and request options through unchanged", async () => {
    const body = new FormData();
    body.set("purpose", "proof");
    const init = { method: "POST", body };
    const success = Response.json({ key: "proofs/booking/image.webp" });
    const fetch = vi.fn().mockResolvedValue(success);
    vi.stubGlobal("fetch", fetch);

    expect(await clientFetch("/api/upload", init)).toBe(success);
    expect(fetch).toHaveBeenCalledWith("/api/upload", init);
  });
});
