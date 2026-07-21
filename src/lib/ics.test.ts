import { describe, expect, it } from "vitest";
import {
  buildCalendar,
  escapeText,
  foldLine,
  formatUtc,
  googleCalendarUrl,
} from "./ics";
import { torontoWallTimeToUtc } from "./time";

describe("formatUtc", () => {
  it("uses the iCalendar basic UTC format", () => {
    expect(formatUtc(new Date("2026-01-08T18:05:00.000Z"))).toBe(
      "20260108T180500Z",
    );
  });
});

describe("escapeText", () => {
  it("escapes the reserved characters", () => {
    expect(escapeText("a,b;c")).toBe("a\\,b\\;c");
    expect(escapeText("line1\nline2")).toBe("line1\\nline2");
  });

  it("escapes backslashes before anything else", () => {
    // A naive order would turn "\" into "\\\\" after the comma rule ran.
    expect(escapeText("a\\b,c")).toBe("a\\\\b\\,c");
  });

  it("leaves Chinese untouched", () => {
    expect(escapeText("小明的课")).toBe("小明的课");
  });
});

describe("foldLine", () => {
  it("leaves short lines alone", () => {
    expect(foldLine("SUMMARY:short")).toEqual(["SUMMARY:short"]);
  });

  it("folds long ASCII lines with a leading space", () => {
    const line = `DESCRIPTION:${"x".repeat(200)}`;
    const folded = foldLine(line);
    expect(folded.length).toBeGreaterThan(1);
    for (const part of folded.slice(1)) expect(part.startsWith(" ")).toBe(true);
    expect(folded.join("").replace(/\n /g, "")).toContain("x".repeat(50));
  });

  it("counts octets, not characters, so CJK is not split mid-sequence", () => {
    const line = `SUMMARY:${"课".repeat(60)}`; // 3 bytes each
    const folded = foldLine(line);
    const encoder = new TextEncoder();
    for (const part of folded) {
      expect(encoder.encode(part).length).toBeLessThanOrEqual(76);
    }
    // Nothing lost or mangled in the round trip.
    expect(folded.map((p, i) => (i === 0 ? p : p.slice(1))).join("")).toBe(line);
  });
});

describe("buildCalendar", () => {
  const event = {
    uid: "booking-1@aaa-ski",
    sequence: 0,
    start: torontoWallTimeToUtc("2026-01-08", 13, 5),
    end: torontoWallTimeToUtc("2026-01-08", 14, 55),
    summary: "小明 · Kevin",
    description: "SKI-8F3K2M",
    location: "Mount St. Louis Moonstone",
    cancelled: false,
    lastModified: new Date("2026-01-06T12:00:00Z"),
  };

  it("wraps events in a valid VCALENDAR", () => {
    const ics = buildCalendar({ name: "Kevin", events: [event] });
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.trimEnd().endsWith("END:VCALENDAR")).toBe(true);
    expect(ics).toContain("BEGIN:VEVENT");
    expect(ics).toContain("UID:booking-1@aaa-ski");
    expect(ics).toContain("DTSTART:20260108T180500Z");
    expect(ics).toContain("DTEND:20260108T195500Z");
    expect(ics).toContain("STATUS:CONFIRMED");
  });

  it("uses CRLF line endings throughout", () => {
    const ics = buildCalendar({ name: "Kevin", events: [event] });
    const bareNewlines = ics.split("\n").filter((l) => !l.endsWith("\r"));
    // Only the trailing empty string after the final CRLF.
    expect(bareNewlines).toEqual([""]);
  });

  it("marks cancelled events so subscribers remove them", () => {
    const ics = buildCalendar({
      name: "Kevin",
      events: [{ ...event, cancelled: true, sequence: 2 }],
    });
    expect(ics).toContain("STATUS:CANCELLED");
    expect(ics).toContain("SEQUENCE:2");
  });

  it("handles an empty schedule", () => {
    const ics = buildCalendar({ name: "Kevin", events: [] });
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).not.toContain("BEGIN:VEVENT");
  });
});

describe("googleCalendarUrl", () => {
  it("builds a prefilled template link", () => {
    const url = googleCalendarUrl({
      title: "Ski lesson",
      start: torontoWallTimeToUtc("2026-01-08", 13, 5),
      end: torontoWallTimeToUtc("2026-01-08", 14, 55),
      details: "SKI-8F3K2M",
      location: "MSL",
    });
    expect(url).toContain("calendar.google.com");
    expect(url).toContain("dates=20260108T180500Z%2F20260108T195500Z");
  });
});
