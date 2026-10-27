import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AdditionalAttendees } from "./additional-attendees";

describe("group signing identity fields", () => {
  it("labels each extra adult's own email and each minor's guardian email separately", () => {
    const html = renderToStaticMarkup(createElement(AdditionalAttendees, {
      locale: "en", onChange: () => {},
      attendees: [
        { fullName: "Adult Guest", email: "adult@example.com", isMinor: false },
        { fullName: "Child Guest", email: "parent@example.com", isMinor: true },
      ],
    }));
    expect(html).toContain("Student 2");
    expect(html).toContain("Student 3");
    expect(html).toContain("Student&#x27;s own email");
    expect(html).toContain("Guardian&#x27;s email");
    expect(html).toContain("Payment opens only after everyone has signed");
    expect(html.match(/type="email"/g)).toHaveLength(2);
    expect(html.match(/type="checkbox"/g)).toHaveLength(2);
  });

  it("renders no phantom extra people for a one-student lesson", () => {
    expect(renderToStaticMarkup(createElement(AdditionalAttendees, { locale: "zh", attendees: [], onChange: () => {} }))).toBe("");
  });
});
