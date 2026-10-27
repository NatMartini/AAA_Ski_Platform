import { afterEach, describe, expect, it, vi } from "vitest";
import { clientRandomUUID } from "./browser-helpers";

afterEach(() => vi.unstubAllGlobals());

describe("HTTP LAN random request IDs", () => {
  it("uses the browser's native cryptographic UUID when available", () => {
    const source = { randomUUID: vi.fn(function (this: unknown) {
      expect(this).toBe(source);
      return "native-uuid";
    }), getRandomValues: vi.fn() };
    vi.stubGlobal("crypto", source);
    expect(clientRandomUUID()).toBe("native-uuid");
    expect(source.getRandomValues).not.toHaveBeenCalled();
  });

  it.each([
    [0, "00000000-0000-4000-8000-000000000000"],
    [255, "ffffffff-ffff-4fff-bfff-ffffffffffff"],
  ])("sets UUID version and variant while preserving cryptographic bytes (%i)", (byte, expected) => {
    const getRandomValues = vi.fn((bytes: Uint8Array) => bytes.fill(byte));
    vi.stubGlobal("crypto", { getRandomValues });
    expect(clientRandomUUID()).toBe(expected);
    expect(getRandomValues).toHaveBeenCalledTimes(1);
    expect(getRandomValues.mock.calls[0][0]).toHaveLength(16);
  });

  it("draws fresh entropy for each new ID when randomUUID is unavailable", () => {
    let draw = 0;
    vi.stubGlobal("crypto", { getRandomValues: (bytes: Uint8Array) => bytes.fill(++draw) });
    expect(clientRandomUUID()).not.toBe(clientRandomUUID());
  });

  it.each([undefined, {}])("fails rather than using insecure randomness when crypto is unavailable", (source) => {
    vi.stubGlobal("crypto", source);
    expect(() => clientRandomUUID()).toThrow("Secure random generation is unavailable.");
  });
});
