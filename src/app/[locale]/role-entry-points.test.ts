import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActiveUser } from "@/lib/auth/require-user";
import { SiteHeader } from "@/components/site-header";
import en from "@/messages/en.json";
import zh from "@/messages/zh.json";
import HomePage from "./page";
import ChooseResortPage from "./book/page";
import ChooseCoachPage from "./book/[resort]/page";
import PickSlotPage from "./book/[resort]/[coach]/page";
import AutoAssignPage from "./book/[resort]/auto/page";
import PackagesPage from "./packages/page";
import PricesPage from "./prices/page";
import MyBookingsPage from "./my/bookings/page";

const mocks = vi.hoisted(() => ({
  user: null as ActiveUser | null,
  locale: "en" as "zh" | "en",
  pathname: "/",
  resorts: vi.fn(),
  redirect: vi.fn((target: { href: string | object; locale: string }) => {
    throw new Error(`REDIRECT:${target.locale}:${JSON.stringify(target.href)}`);
  }),
}));

vi.mock("next-intl/server", () => ({
  setRequestLocale: vi.fn(),
  getTranslations: async (namespace: string) => (key: string, values?: Record<string, string>) => {
    const messages = (mocks.locale === "zh" ? zh : en) as Record<string, Record<string, unknown>>;
    return String(messages[namespace][key]).replace(/\{(\w+)\}/g, (_, name) => values?.[name] ?? name);
  },
}));
vi.mock("@/i18n/navigation", () => ({
  Link: (props: ComponentProps<"a">) => createElement("a", props),
  redirect: mocks.redirect,
  usePathname: () => mocks.pathname,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("NOT_FOUND"); },
}));
vi.mock("@/lib/auth/require-user", () => ({
  getUser: async () => mocks.user,
  requireUserPage: async () => {
    if (!mocks.user) throw new Error("SIGN_IN_REQUIRED");
    return mocks.user;
  },
}));
vi.mock("@/lib/prisma", () => ({
  prisma: { resort: { findMany: mocks.resorts } },
}));
vi.mock("@/lib/coach", () => ({
  listBookableCoaches: async () => [],
  pickCoachForLevel: async () => null,
  canAcceptBookings: () => true,
}));
vi.mock("@/lib/auth/dev-bypass", () => ({ devBypassEnabled: () => true }));
vi.mock("@/components/locale-switch", () => ({ LocaleSwitch: () => null }));
vi.mock("@/components/theme-toggle", () => ({ ThemeToggle: () => null }));
vi.mock("@/components/sign-out-button", () => ({ SignOutButton: () => null }));
vi.mock("@/components/notification-bell", () => ({
  NotificationBell: ({ userId }: { userId: string }) => createElement("button", { "data-notification-user": userId }, "Notifications"),
}));

function activeUser(role: ActiveUser["role"]): ActiveUser {
  return {
    id: "active-user",
    email: "person@example.test",
    name: "Kevin",
    image: null,
    role,
    phone: null,
    wechatId: null,
    tokenIssuedAt: null,
  };
}

function links(html: string): string[] {
  return [...html.matchAll(/href="([^"]+)"/g)].map((link) => link[1]);
}

/** The header repeats its sections in the phone tab bar; compare each destination once. */
function destinations(html: string): string[] {
  return [...new Set(links(html))].sort();
}

function pageProps<P extends Record<string, string>>(params: P) {
  return { params: Promise.resolve(params), searchParams: Promise.resolve({}) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.locale = "en";
  mocks.pathname = "/";
  mocks.user = null;
  mocks.resorts.mockResolvedValue([]);
});

const COACH_ROLES = ["COACH", "ADMIN"] as const;
const LOCALES = ["zh", "en"] as const;
const COACH_CASES = COACH_ROLES.flatMap((role) => LOCALES.map((locale) => ({ role, locale })));

describe("role-specific navigation", () => {
  it.each(COACH_CASES)("gives $role only coach navigation in $locale and retains notifications", async ({ role, locale }) => {
    mocks.user = activeUser(role);
    mocks.locale = locale;
    mocks.pathname = "/coach/schedule";
    const html = renderToStaticMarkup(await SiteHeader({ user: mocks.user, locale }));

    // Sections, plus the pages of the lessons section the coach is in.
    expect(destinations(html)).toEqual(["/calendar", "/coach", "/coach/availability", "/coach/bookings",
      "/coach/bookings/new", "/coach/schedule", "/coach/stats", "/coach/students", "/video-analysis"]);
    expect(html).toContain('data-notification-user="active-user"');
    expect(html).toContain(locale === "zh" ? "代学员建课" : "Book for a student");
  });

  it("shows each coach section's own pages and marks the current one", async () => {
    mocks.user = activeUser("COACH");
    mocks.pathname = "/coach/video-reviews";
    const html = renderToStaticMarkup(await SiteHeader({ user: mocks.user, locale: "en" }));

    expect(links(html)).toEqual(expect.arrayContaining(["/video-analysis", "/coach/video-analysis", "/coach/video-reviews"]));
    expect(links(html)).not.toContain("/coach/bookings/new");
    expect(html).toMatch(/<a href="\/coach\/video-reviews" aria-current="page"/);
  });

  it.each(COACH_CASES)("makes the $role home a coach workspace in $locale", async ({ role, locale }) => {
    mocks.user = activeUser(role);
    mocks.locale = locale;
    const html = renderToStaticMarkup(await HomePage(pageProps({ locale })));

    expect(links(html)).toEqual(["/coach", "/video-analysis", "/coach/schedule", "/coach/bookings/new", "/calendar",
      "/coach/students", "/coach/packages", "/video-analysis", "/coach/video-analysis", "/coach/video-reviews"]);
    expect(html).toContain(locale === "zh" ? "待办事项" : "pending actions");
    expect(html).not.toContain(locale === "zh" ? "课时包 4 小时" : "4 hours at Blue Mountain");
  });

  it("keeps student booking and purchase links on the header and home", async () => {
    mocks.user = activeUser("CUSTOMER");
    mocks.pathname = "/prices";
    const header = renderToStaticMarkup(await SiteHeader({ user: mocks.user, locale: "en" }));
    const home = renderToStaticMarkup(await HomePage(pageProps({ locale: "en" })));

    expect(destinations(header)).toEqual(["/", "/book", "/calendar", "/my/bookings", "/packages", "/prices", "/video-analysis"]);
    expect(header).toMatch(/<a href="\/prices" aria-current="page"/);
    // The home banner offers booking and video analysis first, then every feature by category.
    expect(links(home)).toEqual(["/book", "/video-analysis", "/book", "/prices", "/packages", "/calendar", "/my/bookings", "/video-analysis"]);
    expect(home).not.toContain('href="/coach"');
  });

  it("keeps signed-out visitors on the private sign-in landing page", async () => {
    const header = renderToStaticMarkup(await SiteHeader({ user: null, locale: "en" }));
    const home = renderToStaticMarkup(await HomePage(pageProps({ locale: "en" })));

    expect(destinations(header)).toEqual(["/", "/sign-in", "/video-analysis"]);
    expect(links(home)).toEqual(["/sign-in", "/video-analysis"]);
    expect(header).not.toContain("Notifications");
    expect(home).not.toContain("/packages");
  });
});

const ENTRY_POINTS = [
  {
    path: "/book",
    destination: "/coach/bookings/new",
    run: (locale: string) => ChooseResortPage(pageProps({ locale })),
  },
  {
    path: "/book/mountain",
    destination: "/coach/bookings/new",
    run: (locale: string) => ChooseCoachPage(pageProps({ locale, resort: "mountain" })),
  },
  {
    path: "/book/mountain/coach",
    destination: "/coach/bookings/new",
    run: (locale: string) => PickSlotPage(pageProps({ locale, resort: "mountain", coach: "coach" })),
  },
  {
    path: "/book/mountain/auto",
    destination: "/coach/bookings/new",
    run: (locale: string) => AutoAssignPage(pageProps({ locale, resort: "mountain" })),
  },
  {
    path: "/packages",
    destination: "/coach/packages",
    run: (locale: string) => PackagesPage(pageProps({ locale })),
  },
  {
    path: "/prices",
    destination: "/coach/settings",
    run: (locale: string) => PricesPage(pageProps({ locale })),
  },
  {
    path: "/my/bookings",
    destination: "/coach/bookings",
    run: (locale: string) => MyBookingsPage(pageProps({ locale })),
  },
];

describe("student page entry points", () => {
  it.each(ENTRY_POINTS.flatMap((entry) => COACH_CASES.map((identity) => ({ ...entry, ...identity }))))(
    "routes $role away from $path to $destination in $locale before loading student data",
    async ({ role, locale, destination, run }) => {
      mocks.user = activeUser(role);
      mocks.locale = locale;

      await expect(run(locale)).rejects.toThrow("REDIRECT:");
      expect(mocks.redirect).toHaveBeenCalledWith({ href: destination, locale });
      expect(mocks.resorts).not.toHaveBeenCalled();
    },
  );

  it("still lets customers open the self-booking entry page", async () => {
    mocks.user = activeUser("CUSTOMER");
    const html = renderToStaticMarkup(await ChooseResortPage(pageProps({ locale: "en" })));

    expect(html).toContain(en.booking.stepResort);
    expect(mocks.resorts).toHaveBeenCalledOnce();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("still requires sign-in before protected booking pages", async () => {
    await expect(ChooseResortPage(pageProps({ locale: "en" }))).rejects.toThrow("SIGN_IN_REQUIRED");
    expect(mocks.resorts).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});
