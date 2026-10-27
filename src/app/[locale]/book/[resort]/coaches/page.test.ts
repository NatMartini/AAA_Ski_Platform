import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ChooseCoachPage from "./page";
import AutoAssignPage from "../auto/page";

const mocks = vi.hoisted(() => ({
  role: "CUSTOMER",
  auth: vi.fn(),
  resort: vi.fn(),
  recommend: vi.fn(),
  profiles: vi.fn(),
  redirect: vi.fn((target: unknown) => { throw new Error(`REDIRECT:${JSON.stringify(target)}`); }),
}));
vi.mock("next-intl/server", () => ({ setRequestLocale: vi.fn() }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); } }));
vi.mock("@/lib/auth/require-user", () => ({ requireUserPage: async (input: unknown) => { mocks.auth(input); return { id: "student", role: mocks.role }; } }));
vi.mock("@/lib/prisma", () => ({ prisma: { resort: { findUnique: mocks.resort } } }));
vi.mock("@/lib/booking/recommendation", () => ({ recommendCoaches: mocks.recommend }));
vi.mock("@/lib/coach", () => ({ listBookableCoaches: mocks.profiles }));
vi.mock("@/i18n/navigation", () => ({
  redirect: mocks.redirect,
  Link: ({ href, ...props }: Omit<ComponentProps<"a">, "href"> & { href: string | { pathname: string; query: Record<string, string> } }) => createElement("a", { ...props, href: typeof href === "string" ? href : `${href.pathname}?${new URLSearchParams(href.query)}` }),
}));

const query = { date: "2026-12-04", startHour: "9", hours: "2", requestedSkills: "parallel", level: "intermediate", lessonType: "riding", headcount: "2" };
function props(searchParams: Record<string, string | string[] | undefined> = query, locale = "en") {
  return { params: Promise.resolve({ locale, resort: "msl" }), searchParams: Promise.resolve(searchParams) };
}
function coach(userId: string, bookedHours: number, recommended: boolean) {
  return { userId, displayName: userId === "alisa" ? "Alisa" : "Kevin", bookedHours, recommended,
    levelMatch: userId === "alisa" ? "unlisted" : "listed", matchedSkills: ["parallel"], unmatchedSkills: [],
    csiaLevel: 2, csiaParkLevel: null, avatarUrl: null, bioEn: null, bioZh: null,
    teachableSkills: ["parallel"], customSkills: [], rates: [] };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.role = "CUSTOMER";
  mocks.resort.mockResolvedValue({ isActive: true, nameEn: "Mount St Louis", nameZh: "MSL 雪场" });
  mocks.recommend.mockResolvedValue([coach("alisa", 3, true), coach("kevin", 20, false)]);
  mocks.profiles.mockResolvedValue([coach("alisa", 3, true), coach("kevin", 20, false)]);
});

describe("coach choice after an exact time selection", () => {
  it.each([{}, { ...query, startHour: "9.5" }, { ...query, date: "2026-02-30" }, { ...query, hours: ["2", "3"] }])("returns incomplete or malformed context to time selection: %j", async (context) => {
    await expect(ChooseCoachPage(props(context))).rejects.toThrow("REDIRECT");
    expect(mocks.redirect).toHaveBeenCalledWith(expect.objectContaining({ href: expect.objectContaining({ pathname: "/book/msl", query: expect.objectContaining({ selectionError: "missing" }) }) }));
    expect(mocks.recommend).not.toHaveBeenCalled();
    expect(mocks.resort).not.toHaveBeenCalled();
  });
  it("requests only exact-slot matches and keeps level advisory with choices among matching coaches", async () => {
    const html = renderToStaticMarkup(await ChooseCoachPage(props()));
    expect(mocks.recommend).toHaveBeenCalledWith({ resortSlug: "msl", dateKey: query.date, startHour: 9, hours: 2,
      skills: ["parallel"], level: "intermediate", lessonType: "riding", headcount: 2 }, "student");
    expect(html).toContain("Alisa");
    expect(html).toContain("Kevin");
    expect(html).toContain("3h scheduled this season");
    expect(html).toContain("Recommended");
    expect(html).toContain("Confirm level suitability with this coach");
    expect(html).toContain("Selected skills");
    expect(html).toContain("All selected skills matched");
    expect(html).toContain("first match coaches who teach all your selected skills");
    expect(html).toContain("Only coaches matching all selected skills are listed");
    expect(html.match(/aria-label="Matching skills"/g)).toHaveLength(2);
    expect(html).not.toContain("Please confirm:");
    const links = [...html.matchAll(/href="([^"]+)"/g)].map((match) => match[1].replaceAll("&amp;", "&"));
    for (const id of ["alisa", "kevin"]) {
      const choice = new URL(links.find((link) => link.startsWith(`/book/msl/${id}?`))!, "https://test.invalid");
      for (const [key, value] of Object.entries(query)) expect(choice.searchParams.get(key)).toBe(value);
    }
  });
  it.each(["zh", "en"])("shows a clear unavailable selection in %s without substituting a coach or time", async (locale) => {
    mocks.recommend.mockResolvedValue([]);
    const html = renderToStaticMarkup(await ChooseCoachPage(props(query, locale)));
    expect(html).toContain(locale === "zh" ? "这个选择暂无可约教练" : "No coaches are available for this selection");
    expect(html).toContain("date=2026-12-04");
    expect(html).toContain("startHour=9");
    expect(html).toContain("hours=2");
    expect(html).not.toContain("/book/msl/kevin");
    expect(html).toContain(locale === "zh" ? "请调整动作或时间" : "Adjust your skills or time");
    expect(html).toContain("requestedSkills=parallel");
    expect(html).not.toContain("selectionError=unavailable");
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
  it("never offers an unsupported lighter coach even if a stale recommendation includes them", async () => {
    mocks.recommend.mockResolvedValue([{ ...coach("alisa", 1, true), teachableSkills: [] }, coach("kevin", 20, true)]);
    const html = renderToStaticMarkup(await ChooseCoachPage(props()));
    expect(html).not.toContain("/book/msl/alisa?");
    expect(html).not.toContain("1h scheduled this season");
    expect(html).toContain("/book/msl/kevin?");
    expect(html).toContain("20h scheduled this season");
  });
  it("requires one coach to support every builtin and custom action and shows each matched badge", async () => {
    const key = "custom:11111111-1111-4111-8111-111111111111";
    const customSkills = [{ id: key.slice(7), key, zh: "雪场路线", en: "Trail tactics" }];
    const builtinOnly = coach("alisa", 1, false);
    const customOnly = { ...coach("custom-only", 2, false), teachableSkills: [], customSkills };
    const fullMatch = { ...coach("kevin", 20, true), customSkills, matchedSkills: ["parallel", key] };
    mocks.recommend.mockResolvedValue([builtinOnly, customOnly, fullMatch]);
    mocks.profiles.mockResolvedValue([builtinOnly, customOnly, fullMatch]);
    const html = renderToStaticMarkup(await ChooseCoachPage(props({ ...query, requestedSkills: `parallel,${key}` })));
    expect(html).not.toContain("/book/msl/alisa?");
    expect(html).not.toContain("/book/msl/custom-only?");
    expect(html).toContain("/book/msl/kevin?");
    expect(html.match(/aria-label="Matching skills"/g)).toHaveLength(1);
    expect(html).toContain("Trail tactics");
    expect(html).toContain(`requestedSkills=parallel%2C${encodeURIComponent(key)}`);
  });
  it("uses the advertised custom name in an empty result while preserving the selection", async () => {
    const key = "custom:11111111-1111-4111-8111-111111111111";
    mocks.recommend.mockResolvedValue([]);
    mocks.profiles.mockResolvedValue([{ ...coach("alisa", 1, true), customSkills: [{ id: key.slice(7), key, zh: "雪场路线", en: "Trail tactics" }] }]);
    const html = renderToStaticMarkup(await ChooseCoachPage(props({ ...query, requestedSkills: key })));
    expect(mocks.profiles).toHaveBeenCalledWith("msl");
    expect(html).toContain("Trail tactics");
    expect(html).toContain(`requestedSkills=${encodeURIComponent(key)}`);
    expect(html).not.toContain("/book/msl/alisa?");
  });
  it.each(["zh", "en"])("keeps deleted custom focus readable in an empty result in %s", async (locale) => {
    const key = "custom:33333333-3333-4333-8333-333333333333";
    mocks.recommend.mockResolvedValue([]);
    const html = renderToStaticMarkup(await ChooseCoachPage(props({ ...query, requestedSkills: key }, locale)));
    expect(html).toContain(locale === "zh" ? "自定义动作（当前未提供）" : "Custom skill (not currently offered)");
    expect(html).toContain(`requestedSkills=${encodeURIComponent(key)}`);
  });
  it("allows a no-focus exact-slot choice without inventing supported actions", async () => {
    mocks.recommend.mockResolvedValue([{ ...coach("alisa", 1, true), teachableSkills: [], matchedSkills: [] }]);
    const html = renderToStaticMarkup(await ChooseCoachPage(props({ ...query, requestedSkills: "" })));
    expect(html).toContain("No skills selected; showing coaches available at this time.");
    expect(html).toContain("/book/msl/alisa?");
    expect(html).not.toContain("All selected skills matched");
  });
  it.each(["COACH", "ADMIN"])("keeps %s in the coach portal before student data reads", async (role) => {
    mocks.role = role;
    await expect(ChooseCoachPage(props())).rejects.toThrow("REDIRECT");
    expect(mocks.redirect).toHaveBeenCalledWith({ href: "/coach/bookings/new", locale: "en" });
    expect(mocks.resort).not.toHaveBeenCalled();
    expect(mocks.recommend).not.toHaveBeenCalled();
  });
  it("makes auto recommendation a choice list preserving the exact selection", async () => {
    await expect(AutoAssignPage(props())).rejects.toThrow("REDIRECT");
    expect(mocks.redirect).toHaveBeenCalledWith({ href: { pathname: "/book/msl/coaches", query: { ...query, recommend: "true" } }, locale: "en" });
    expect(mocks.recommend).not.toHaveBeenCalled();
  });
  it("keeps complete selections in sign-in callback URLs for coach choice and auto", async () => {
    await ChooseCoachPage(props({ ...query, recommend: "true" }));
    const coachCallback = new URL(mocks.auth.mock.calls[0][0].callbackPath, "https://test.invalid");
    expect(coachCallback.pathname).toBe("/en/book/msl/coaches");
    for (const [key, value] of Object.entries(query)) expect(coachCallback.searchParams.get(key)).toBe(value);
    expect(coachCallback.searchParams.get("recommend")).toBe("true");
    await expect(AutoAssignPage(props())).rejects.toThrow("REDIRECT");
    const autoCallback = new URL(mocks.auth.mock.calls[1][0].callbackPath, "https://test.invalid");
    expect(autoCallback.pathname).toBe("/en/book/msl/auto");
    for (const [key, value] of Object.entries(query)) expect(autoCallback.searchParams.get(key)).toBe(value);
  });
  it("preserves a requested date and optional preferences when auto lacks the full time", async () => {
    const partial = { askedDate: "2026-12-04", level: "intermediate", requestedSkills: "parallel", lessonType: "park", headcount: "3" };
    await expect(AutoAssignPage(props(partial))).rejects.toThrow("REDIRECT");
    expect(mocks.redirect).toHaveBeenCalledWith({ href: { pathname: "/book/msl", query: { ...partial, selectionError: "missing" } }, locale: "en" });
  });
});
