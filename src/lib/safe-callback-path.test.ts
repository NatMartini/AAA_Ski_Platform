import { describe, expect, it } from "vitest";
import { safeCallbackPath } from "./safe-callback-path";

describe("safe sign-in return path", () => {
  it.each([
    "javascript:alert(document.domain)", "data:text/html,<script>alert(1)</script>",
    "https://evil.test", "//evil.test", "/\\evil.test", "/%5cevil.test", "/%2f%2fevil.test",
    "/%252f%252fevil.test", "/en/..//evil.test", "/en/%2e%2e//evil.test", "/%00evil", "/%0aevil",
    " /en", "/en\r\n", "/bad%escape", "", null, ["/en", "//evil.test"],
  ])("rejects unsafe or malformed callback %j", (value) => {
    expect(safeCallbackPath(value, "/zh")).toBe("/zh");
  });
  it("keeps a complete relative booking selection and fragment", () => {
    const path = "/en/book/msl/coaches?date=2026-12-04&startHour=9&hours=2&requestedSkills=parallel%2Ccustom%3A123#video-analysis";
    expect(safeCallbackPath(path, "/zh")).toBe(path);
  });
  it("normalizes safe dot segments without allowing them to create an external return", () => {
    expect(safeCallbackPath("/en/book/../coach", "/zh")).toBe("/en/coach");
  });
});
