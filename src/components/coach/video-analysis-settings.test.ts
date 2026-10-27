import { describe, expect, it, vi } from "vitest";
import { analysisPriceToCents } from "./video-analysis-settings";

vi.mock("@/i18n/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

describe("extra analysis price draft", () => {
  it.each(["", " "])("keeps an unset price disabled: %j", (value) => {
    expect(analysisPriceToCents(value)).toBeNull();
  });
  it.each([["0.01", 1], ["1.50", 150], [" 25 ", 2500], ["10000", 1_000_000]])("converts a valid explicitly entered price %s", (value, cents) => {
    expect(analysisPriceToCents(value as string)).toBe(cents);
  });
  it.each(["0", "-1", "10000.01", "1.001", "1e2", "NaN", "Infinity", "abc", ".50"])("rejects invalid or ambiguous price %s", (value) => {
    expect(analysisPriceToCents(value)).toBe("invalid");
  });
});
