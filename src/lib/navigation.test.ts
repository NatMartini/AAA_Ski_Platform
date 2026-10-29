import { describe, expect, it } from "vitest";
import { activeNav, navSections } from "./navigation";

const hrefs = (role: Parameters<typeof navSections>[0]) =>
  navSections(role).flatMap((section) => [section.href, ...section.items.map((item) => item.href)]);

describe("site map by role", () => {
  it("never gives students coach pages or coaches student pages", () => {
    expect(hrefs("CUSTOMER").some((href) => href.startsWith("/coach"))).toBe(false);
    for (const role of ["COACH", "ADMIN"] as const) {
      expect(hrefs(role)).not.toEqual(expect.arrayContaining(["/book"]));
      expect(hrefs(role).filter((href) => ["/book", "/prices", "/packages", "/my/bookings"].includes(href))).toEqual([]);
    }
    expect(hrefs(null)).toEqual(["/", "/video-analysis"]);
  });

  it("puts video analysis in its own section for everyone", () => {
    for (const role of [null, "CUSTOMER", "COACH"] as const)
      expect(navSections(role).find((section) => section.key === "video")?.href).toBe("/video-analysis");
  });
});

describe("current section and page", () => {
  const student = navSections("CUSTOMER");
  const coach = navSections("COACH");
  const at = (pathname: string, sections = student) => {
    const { section, item } = activeNav(pathname, sections);
    return [section?.key ?? null, item?.href ?? null];
  };

  it.each([
    ["/", ["home", null]],
    ["/book", ["book", "/book"]],
    ["/book/mountain/coach", ["book", "/book"]],
    ["/prices", ["book", "/prices"]],
    ["/packages/PKG-1", ["book", "/packages"]],
    ["/my/bookings", ["lessons", "/my/bookings"]],
    // A booking is not the booking flow, even though both start with "/book".
    ["/booking/SKI-1", ["lessons", "/my/bookings"]],
    ["/video-analysis/report/job", ["video", "/video-analysis"]],
    ["/legal/terms", [null, null]],
  ] as const)("places a student on %s", (pathname, expected) => {
    expect(at(pathname)).toEqual(expected);
  });

  it.each([
    ["/coach", ["dashboard", null]],
    ["/coach/bookings", ["lessons", "/coach/bookings"]],
    // The longest matching page wins over its parent.
    ["/coach/bookings/new", ["lessons", "/coach/bookings/new"]],
    ["/booking/SKI-1", ["lessons", "/coach/bookings"]],
    ["/calendar", ["lessons", "/calendar"]],
    ["/coach/students/abc", ["students", "/coach/students"]],
    ["/coach/video-analysis", ["video", "/coach/video-analysis"]],
    ["/video-analysis", ["video", "/video-analysis"]],
    ["/coach/settings", ["admin", "/coach/settings"]],
  ] as const)("places a coach on %s", (pathname, expected) => {
    expect(at(pathname, coach)).toEqual(expected);
  });
});
