import { describe, expect, it } from "vitest";
import { FINDING_KEY, findingKey } from "./finding-key";

describe("finding keys", () => {
  it("is stable for the same sentence and changes when the sentence changes", () => {
    const key = findingKey("improvement", "第4弯的收弯完成度只有 33.4 分。");
    expect(key).toMatch(FINDING_KEY);
    expect(findingKey("improvement", "第4弯的收弯完成度只有  33.4 分。 ")).toBe(key);
    expect(findingKey("improvement", "第4弯的收弯完成度只有 33.5 分。")).not.toBe(key);
    expect(findingKey("strength", "第4弯的收弯完成度只有 33.4 分。")).not.toBe(key);
  });
  it("tells apart sentences that only differ in order", () => {
    expect(findingKey("drill", "ab")).not.toBe(findingKey("drill", "ba"));
  });
});
