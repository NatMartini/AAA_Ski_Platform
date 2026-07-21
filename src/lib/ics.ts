/**
 * iCalendar feed for a coach's schedule.
 *
 * Google Calendar subscribes to this by URL, which needs no OAuth, no consent
 * screen and no stored token. The trade-off is refresh latency — Google polls
 * external feeds on its own schedule, sometimes up to a day — so the booking
 * page also offers a one-click "add to Google Calendar" link for anything
 * needed immediately.
 */

export type IcsEvent = {
  uid: string;
  /** Bumped on every change so subscribers replace rather than duplicate. */
  sequence: number;
  start: Date;
  end: Date;
  summary: string;
  description: string;
  location: string;
  /** CANCELLED tells a subscriber to remove an event it already has. */
  cancelled: boolean;
  lastModified: Date;
};

export function buildCalendar(opts: {
  name: string;
  events: IcsEvent[];
}): string {
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//AAA Ski Platform//Coach Schedule//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(opts.name)}`,
    "X-WR-TIMEZONE:America/Toronto",
    // A hint only; Google decides its own poll interval.
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
  ];

  for (const event of opts.events) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${event.uid}`,
      `SEQUENCE:${event.sequence}`,
      `DTSTAMP:${formatUtc(event.lastModified)}`,
      `DTSTART:${formatUtc(event.start)}`,
      `DTEND:${formatUtc(event.end)}`,
      `SUMMARY:${escapeText(event.summary)}`,
      `DESCRIPTION:${escapeText(event.description)}`,
      `LOCATION:${escapeText(event.location)}`,
      `STATUS:${event.cancelled ? "CANCELLED" : "CONFIRMED"}`,
      `LAST-MODIFIED:${formatUtc(event.lastModified)}`,
      "END:VEVENT",
    );
  }

  lines.push("END:VCALENDAR");

  // RFC 5545 wants CRLF line endings and lines folded at 75 octets.
  return lines.flatMap(foldLine).join("\r\n") + "\r\n";
}

/** UTC basic format: 20260108T180500Z */
export function formatUtc(date: Date): string {
  return `${date.toISOString().replace(/[-:]/g, "").split(".")[0]}Z`;
}

/**
 * Escapes the characters iCalendar treats specially. Backslash must be handled
 * first or it would double-escape the sequences added afterwards.
 */
export function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/**
 * Folds a long line to 75 octets with a leading space on continuations.
 *
 * Counted in UTF-8 bytes, not characters: a Chinese name is three bytes per
 * character, and splitting mid-sequence would corrupt it. The split point is
 * therefore chosen on a character boundary that keeps the chunk under the
 * octet limit.
 */
export function foldLine(line: string): string[] {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return [line];

  const out: string[] = [];
  let current = "";
  let currentBytes = 0;
  let limit = 75;

  for (const char of line) {
    const size = encoder.encode(char).length;
    if (currentBytes + size > limit) {
      out.push(current);
      current = " "; // continuation marker
      currentBytes = 1;
      limit = 75;
    }
    current += char;
    currentBytes += size;
  }
  if (current) out.push(current);
  return out;
}

/** One-click "add to Google Calendar" link for a single lesson. */
export function googleCalendarUrl(opts: {
  title: string;
  start: Date;
  end: Date;
  details: string;
  location: string;
}): string {
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: opts.title,
    dates: `${formatUtc(opts.start)}/${formatUtc(opts.end)}`,
    details: opts.details,
    location: opts.location,
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
