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
  const view = { ok: true, accountId: user.id, quota: { active: true, freeTotal: 0, paidTotal: 0, grantTotal: 0, used: 0, reserved: 0, remaining: 0 },
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
    expect(html).toContain('data-testid="analysis-remaining">3<');
    expect(html).toContain('href="/video-analysis?lesson=COURSE#workspace"');
    expect(html).toContain(locale === "zh" ? "视频库" : "Video library");
    expect(html).toContain(locale === "zh" ? "显示每个视频的上传、提交和完成时间" : "when each video was uploaded, submitted and finished");
    expect(html).toContain(locale === "zh" ? "2 小时课 · 1v3" : "2-hour lesson · 1-to-3");
    expect(html).not.toContain("× 3");
    expect(mocks.overview).toHaveBeenCalledWith(user);
  });
  it("combines account and lesson balances and defaults to personal credits without transferring lesson credits", async () => {
    const account = await mocks.account();
    mocks.account.mockResolvedValue({ ...account, quota: { ...account.quota, grantTotal: 5, remaining: 4, used: 1 }, canUpload: true, canAnalyze: true });
    const html = renderToStaticMarkup(await VideoAnalysisPage({ params: Promise.resolve({ locale: "zh" }), searchParams: Promise.resolve({}) }));
    expect(html).toContain('data-testid="analysis-remaining">7<');
    expect(html).toContain("我的 FreeSki 视频分析");
    expect(html).toContain("教练累计发放 5 次");
    expect(html).not.toContain("额外分析次数");
    expect(mocks.course).not.toHaveBeenCalled();
  });
  it("never fetches a foreign lesson workspace from an untrusted query", async () => {
    await VideoAnalysisPage({ params: Promise.resolve({ locale: "zh" }), searchParams: Promise.resolve({ lesson: "FOREIGN" }) });
    expect(mocks.course).not.toHaveBeenCalled();
    expect(mocks.account).toHaveBeenCalledWith(user);
  });
  it.each(["CUSTOMER", "COACH"] as const)("gives an empty $role account its own workflow", async role => {
    mocks.auth.mockResolvedValue({ ...user, role });
    mocks.overview.mockResolvedValue({ courses: [], totals: { remaining: 0, freeTotal: 0, paidTotal: 0, used: 0, reserved: 0 } });
    const html = renderToStaticMarkup(await VideoAnalysisPage({ params: Promise.resolve({ locale: "en" }), searchParams: Promise.resolve({}) }));
    expect(html).toContain(`href="${role === "COACH" ? "/coach" : "/book"}"`);
    expect(html).toContain('data-testid="analysis-remaining">0<');
  });
});
