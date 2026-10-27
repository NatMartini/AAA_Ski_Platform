import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { torontoWallTimeToUtc } from "@/lib/time";
import CalendarPage from "./page";

const mocks = vi.hoisted(() => ({
  profiles: vi.fn(),
  days: vi.fn(),
  bookings: vi.fn(),
  user: { id: "customer", role: "CUSTOMER" },
}));

vi.mock("next-intl/server", () => ({ setRequestLocale: vi.fn() }));
vi.mock("@/i18n/navigation", () => ({
  Link: (props: ComponentProps<"a">) => createElement("a", props),
}));
vi.mock("@/lib/auth/require-user", () => ({
  requireUserPage: vi.fn(async () => mocks.user),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    coachProfile: { findMany: mocks.profiles },
    coachDay: { findMany: mocks.days },
    booking: { findMany: mocks.bookings },
  },
}));

const DAY = "2026-01-08";

function lesson(id: string, from: number, to: number, accountId = "other") {
  return {
    id,
    code: `BOOK-${id}`,
    accountId,
    coachDayId: "day",
    startAt: torontoWallTimeToUtc(DAY, from),
    endAt: torontoWallTimeToUtc(DAY, to),
    lessonStartAt: torontoWallTimeToUtc(DAY, from, 10),
    lessonEndAt: torontoWallTimeToUtc(DAY, to),
  };
}

async function render(locale = "zh") {
  return renderToStaticMarkup(
    await CalendarPage({
      params: Promise.resolve({ locale }),
      searchParams: Promise.resolve({ week: "2026-01-05" }),
    }),
  );
}

function rangeText(html: string): string[] {
  return [...html.matchAll(/<ul[^>]*>([\s\S]*?)<\/ul>/g)].flatMap((list) =>
    [...list[1].matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)].map((row) =>
      row[1].replace(/<[^>]+>/g, ""),
    ),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T12:00:00Z"));
  mocks.user.id = "customer";
  mocks.user.role = "CUSTOMER";
  mocks.profiles.mockResolvedValue([
    {
      userId: "coach",
      displayName: "Coach Kevin",
      minHours: 2,
      maxHours: 8,
      leadTimeHours: 24,
      isPublished: true,
      cancellationPolicyZh: "取消政策",
      cancellationPolicyEn: "Cancellation policy",
      emtEnabled: true,
      emtEmail: "coach@example.test",
      rates: [{ lessonType: "riding", regularCents: 6000, earlyBirdCents: null }],
    },
  ]);
  mocks.days.mockResolvedValue([
    {
      id: "day",
      coachId: "coach",
      date: new Date(`${DAY}T00:00:00Z`),
      startHour: 9,
      endHour: 16,
      breakStartHour: 13,
      breakEndHour: 14,
      resort: { slug: "mountain", nameZh: "雪场", nameEn: "Mountain", isActive: true },
    },
  ]);
  mocks.bookings.mockResolvedValue([]);
});

afterEach(() => vi.useRealTimers());

describe("calendar bookable text", () => {
  it("lists only bookable ranges while retaining the lunch bar and booking link", async () => {
    const html = await render();

    expect(rangeText(html)).toEqual(["09:00–13:00可约", "14:00–16:00可约"]);
    expect(html).not.toContain("13:00–14:00");
    expect(html).not.toContain("09:00–16:00");
    expect(html).toContain("repeating-linear-gradient");
    expect(html).toContain("/book/mountain?date=2026-01-08");
  });

  it("excludes booked lessons and one-hour gaps while keeping coach booking links", async () => {
    mocks.user.role = "COACH";
    mocks.bookings.mockResolvedValue([lesson("a", 9, 11), lesson("b", 12, 13)]);
    const html = await render();

    expect(rangeText(html)).toEqual(["14:00–16:00可约"]);
    expect(html).not.toContain("11:00–12:00");
    expect(html).not.toContain("09:10–11:00");
    expect(html).toContain('href="/booking/BOOK-a"');
    expect(html).toContain('href="/booking/BOOK-b"');
  });

  it("keeps a customer's own booking link and hides other booking codes", async () => {
    mocks.bookings.mockResolvedValue([
      lesson("own", 9, 11, "customer"),
      lesson("other", 11, 13),
    ]);
    const html = await render("en");

    expect(rangeText(html)).toEqual(["14:00–16:00Bookable"]);
    expect(html).toContain('href="/booking/BOOK-own"');
    expect(html).not.toContain("BOOK-other");
  });

  it("shows no bookable ranges or booking action inside the minimum notice window", async () => {
    vi.setSystemTime(torontoWallTimeToUtc(DAY, 10, 30));
    const html = await render();

    expect(rangeText(html)).toEqual([]);
    expect(html).not.toContain("/book/mountain/coach");
    expect(html).toContain("repeating-linear-gradient");
  });

  it.each([
    { isPublished: false },
    { rates: [] },
    { cancellationPolicyEn: "" },
    { emtEnabled: false },
  ])("keeps the timetable without claiming bookable time when coach setup is %j", async (setup) => {
    const profiles = await mocks.profiles();
    mocks.profiles.mockResolvedValue([{ ...profiles[0], ...setup }]);
    const html = await render();
    const bars = html.match(/<div aria-hidden="true" class="relative h-6">([\s\S]*?)<\/div>/)?.[1];

    expect(rangeText(html)).toEqual([]);
    expect(html).not.toContain("/book/mountain/coach");
    expect(html).toContain("Coach Kevin");
    expect(bars).toContain("bg-surface-2");
    expect(bars).not.toContain("border-dashed");
  });

  it("keeps existing booking links and timetable bars at an inactive resort without offering new bookings", async () => {
    const days = await mocks.days();
    mocks.days.mockResolvedValue([
      { ...days[0], resort: { ...days[0].resort, isActive: false } },
    ]);
    mocks.bookings.mockResolvedValue([lesson("own", 9, 11, "customer")]);
    const html = await render("en");
    const bars = html.match(/<div aria-hidden="true" class="relative h-6">([\s\S]*?)<\/div>/)?.[1];

    expect(rangeText(html)).toEqual([]);
    expect(html).not.toContain("/book/mountain/coach");
    expect(html).toContain('href="/booking/BOOK-own"');
    expect(html).toContain("Mountain");
    expect(bars).toContain("bg-surface-2");
    expect(bars).not.toContain("border-dashed");
    expect(bars).toContain("repeating-linear-gradient");
  });
});
