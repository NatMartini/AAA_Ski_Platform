import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ActiveUser } from "@/lib/auth/require-user";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), overview: vi.fn(), account: vi.fn(), course: vi.fn() }));
vi.mock("next-intl/server", () => ({ setRequestLocale: vi.fn() }));
vi.mock("@/i18n/navigation", () => ({ Link: (props: ComponentProps<"a">) => createElement("a", props),
  useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/auth/require-user", () => ({ requireUserPage: mocks.auth }));
vi.mock("@/lib/video-analysis/overview", () => ({ getVideoAnalysisOverview: mocks.overview }));
vi.mock("@/lib/video-analysis/account-service", () => ({ getAccountVideoAnalysisState: mocks.account }));
vi.mock("@/lib/video-analysis/service", () => ({ getVideoAnalysisState: mocks.course }));
import VideoAnalysisPage from "./page";

const user: ActiveUser = { id: "student", role: "CUSTOMER", email: "student@test.example", name: "Student",
  image: null, phone: null, wechatId: null, tokenIssuedAt: null };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue(user);
  const view = { ok: true, accountId: user.id, quota: { active: true, unlimited: false, freeTotal: 3, lessonCount: 1, lessonTotal: 3, paidTotal: 0, grantTotal: 0,
    earned: 6, used: 0, reserved: 0, remaining: 6 },
    grants: [], price: null, service: { configured: true, available: true }, actions: [], canAnalyze: false, canUpload: false,
    canPurchase: false, canReview: false, videos: [], jobs: [], purchases: [], payment: { coachName: "", wechatEnabled: false, wechatId: null, wechatQrUrl: null } };
  mocks.account.mockResolvedValue(view);
  mocks.course.mockResolvedValue({ ...view, quota: { ...view.quota, freeTotal: 3, remaining: 3 }, canUpload: true });
  mocks.overview.mockResolvedValue({ totals: { remaining: 3, freeTotal: 3, paidTotal: 0, used: 0, reserved: 0 },
    courses: [{ code: "COURSE", hours: 2, headcount: 3, includedCredits: 3, startAt: new Date("2026-01-01T14:00:00Z"),
      lessonStartAt: new Date("2026-01-01T14:10:00Z"), lessonEndAt: new Date("2026-01-01T16:00:00Z"),
      coachName: "Kevin", resort: { nameZh: "雪场", nameEn: "Resort" },
      quota: { active: true, freeTotal: 3, paidTotal: 0, used: 0, reserved: 0, remaining: 3 } }] });
});
describe("FreeSki analysis landing page", () => {
  it("requires authentication before reading course balances", async () => {
    mocks.auth.mockRejectedValue(new Error("SIGN_IN_REQUIRED"));
    await expect(VideoAnalysisPage({ params: Promise.resolve({ locale: "zh" }), searchParams: Promise.resolve({}) })).rejects.toThrow("SIGN_IN_REQUIRED");
    expect(mocks.overview).not.toHaveBeenCalled();
    expect(mocks.auth).toHaveBeenCalledWith({ locale: "zh", callbackPath: "/zh/video-analysis" });
  });
  it.each(["zh", "en"])("shows the actual balance, attribution and lesson link in %s", async locale => {
    const html = renderToStaticMarkup(await VideoAnalysisPage({ params: Promise.resolve({ locale }), searchParams: Promise.resolve({}) }));
    expect(html).toContain(locale === "zh" ? "来自 Kevin 的个人项目" : "From Kevin’s personal project");
    // One account, one count by the title, a line of statistics, then the analyses (owner's decision, 2026-11-07).
    expect(html).toContain('data-testid="analysis-remaining">6<');
    expect(html).toContain(locale === "zh" ? "可分析" : "analyses left");
    expect(html).toContain(locale === "zh" ? "共获得 6 次" : "6 received");
    expect(html).toContain(locale === "zh" ? "我的分析" : "My analyses");
    // Lessons fold away below, with a link to each lesson's videos.
    expect(html).toContain('href="/video-analysis?lesson=COURSE#workspace"');
    expect(html).toContain(locale === "zh" ? "2 小时课 · 1v3" : "2-hour lesson · 1-to-3");
    expect(mocks.overview).toHaveBeenCalledWith(user);
  });
  it("counts joining, lessons, coach grants and purchases in the one account, and opens it by default", async () => {
    const account = await mocks.account();
    mocks.account.mockResolvedValue({ ...account, quota: { ...account.quota, grantTotal: 5, earned: 11, remaining: 10, used: 1 }, canUpload: true, canAnalyze: true });
    const html = renderToStaticMarkup(await VideoAnalysisPage({ params: Promise.resolve({ locale: "zh" }), searchParams: Promise.resolve({}) }));
    expect(html).toContain('data-testid="analysis-remaining">10<');
    expect(html).toContain("我的分析");
    expect(html).toContain("注册 3 · 上课 1 节 × 3 = 3 · 教练发放 5 · 购买 0");
    expect(html).not.toContain("额外分析次数");
    expect(mocks.course).not.toHaveBeenCalled();
  });
  it("lets a student buy more through the coach of their latest completed lesson", async () => {
    const overview = await mocks.overview();
    mocks.overview.mockResolvedValue({ ...overview, courses: overview.courses.map((course: object) => ({ ...course, isCustomer: true })) });
    const lesson = await mocks.course();
    mocks.course.mockResolvedValue({ ...lesson, price: { unitCents: 500, currency: "CAD" }, canPurchase: true,
      payment: { coachName: "Kevin", wechatEnabled: true, wechatId: null, wechatQrUrl: null } });
    const html = renderToStaticMarkup(await VideoAnalysisPage({ params: Promise.resolve({ locale: "zh" }), searchParams: Promise.resolve({}) }));
    expect(mocks.course).toHaveBeenCalledWith("COURSE", user);
    expect(html).toContain("买更多次数");
    expect(html).toContain("付给 Kevin");
    expect(html).toContain("生成微信付款订单");
  });
  it("never fetches a foreign lesson workspace from an untrusted query", async () => {
    await VideoAnalysisPage({ params: Promise.resolve({ locale: "zh" }), searchParams: Promise.resolve({ lesson: "FOREIGN" }) });
    expect(mocks.course).not.toHaveBeenCalled();
    expect(mocks.account).toHaveBeenCalledWith(user);
  });
  it.each(["CUSTOMER", "COACH"] as const)("gives an empty $role account its own workflow", async role => {
    mocks.auth.mockResolvedValue({ ...user, role });
    mocks.overview.mockResolvedValue({ courses: [] });
    const account = await mocks.account();
    mocks.account.mockResolvedValue({ ...account, quota: { ...account.quota, freeTotal: 0, lessonCount: 0, lessonTotal: 0, earned: 0, remaining: 0 } });
    const html = renderToStaticMarkup(await VideoAnalysisPage({ params: Promise.resolve({ locale: "en" }), searchParams: Promise.resolve({}) }));
    expect(html).toContain(`href="${role === "COACH" ? "/coach" : "/book"}"`);
    expect(html).toContain('data-testid="analysis-remaining">0<');
  });
});
