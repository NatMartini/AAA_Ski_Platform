import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({ requireUser: vi.fn(), load: vi.fn() }));
vi.mock("@/lib/auth/require-user", () => ({ requireUser: mocks.requireUser }));
vi.mock("@/lib/notification-store", () => ({ loadNotifications: mocks.load }));
import { GET } from "./route";

beforeEach(() => vi.resetAllMocks());

describe("notification API authentication", () => {
  it.each([401, 403])("rejects HTTP %i accounts before reading any inbox records", async (status) => {
    mocks.requireUser.mockResolvedValue({ ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status }) });
    const response = await GET();
    expect(response.status).toBe(status);
    expect(mocks.load).not.toHaveBeenCalled();
    expect(await response.json()).not.toHaveProperty("items");
  });

  it("uses the authenticated user and forbids shared/browser response caching", async () => {
    const user = { id: "student", role: "CUSTOMER" };
    mocks.requireUser.mockResolvedValue({ ok: true, user });
    mocks.load.mockResolvedValue([{ key: "own-event" }]);
    const response = await GET();
    expect(mocks.load).toHaveBeenCalledWith(user);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toBe("Cookie");
    expect(await response.json()).toEqual({ userId: "student", items: [{ key: "own-event" }] });
  });

  it("returns a retryable error without database/internal details if the inbox cannot load", async () => {
    mocks.requireUser.mockResolvedValue({ ok: true, user: { id: "student", role: "CUSTOMER" } });
    mocks.load.mockRejectedValue(new Error("private database details"));
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Notifications unavailable" });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
});
