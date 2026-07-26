import { describe, expect, it } from "vitest";
import { __internal } from "./date-calendar";

const { monthShape, monthKey } = __internal;

/*
 * The grid maths, pinned.
 *
 * This is the part that silently goes wrong: an off-by-one in the leading
 * blanks shifts every date in the month by a column, which looks plausible
 * enough that nobody notices until a student books a Tuesday thinking it was
 * a Saturday.
 */
describe("monthShape", () => {
  it("counts the days in a month", () => {
    expect(monthShape("2026-01").days).toBe(31);
    expect(monthShape("2026-04").days).toBe(30);
    expect(monthShape("2026-02").days).toBe(28);
  });

  it("handles February in a leap year", () => {
    expect(monthShape("2028-02").days).toBe(29);
  });

  it("pads to a Monday-first grid", () => {
    // 1 Dec 2026 is a Tuesday, so one blank cell precedes it.
    expect(monthShape("2026-12").leading).toBe(1);
    // 1 Feb 2026 is a Sunday — the last column, so six blanks precede it.
    expect(monthShape("2026-02").leading).toBe(6);
    // 1 Jun 2026 is a Monday: no padding at all.
    expect(monthShape("2026-06").leading).toBe(0);
  });
});

describe("monthKey", () => {
  it("groups a date key by its month", () => {
    expect(monthKey("2026-12-25")).toBe("2026-12");
    expect(monthKey("2027-01-02")).toBe("2027-01");
  });
});
