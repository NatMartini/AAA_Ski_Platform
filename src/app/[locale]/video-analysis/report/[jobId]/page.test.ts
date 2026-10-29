import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ActiveUser } from "@/lib/auth/require-user";
import { AnalysisDomainError } from "@/lib/video-analysis/quota";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), account: vi.fn(), course: vi.fn() }));
vi.mock("next-intl/server", () => ({ setRequestLocale: vi.fn() }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); } }));
vi.mock("@/i18n/navigation", () => ({ Link: (props: ComponentProps<"a">) => createElement("a", props),
  useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/auth/require-user", () => ({ requireUserPage: mocks.auth }));
vi.mock("@/lib/video-analysis/account-service", () => ({ getAccountVideoAnalysisState: mocks.account }));
vi.mock("@/lib/video-analysis/service", () => ({ getVideoAnalysisState: mocks.course }));
import AnalysisReportPage from "./page";

const user: ActiveUser = { id: "student", role: "CUSTOMER", email: "student@test.example", name: "Student",
  image: null, phone: null, wechatId: null, tokenIssuedAt: null };
const job = { id: "job1", videoId: "v1", actionId: "improvement:level1:parallel", status: "SUCCEEDED",
  createdAt: new Date("2026-10-27T18:01:00Z"), finishedAt: new Date("2026-10-27T18:05:00Z"), errorCode: null,
  result: { gradingStatus: "unavailable", gradingReason: "wrong-action", score: null, scoreKind: null, coachingZh: [], coachingEn: [] } };
const state = { ok: true, quota: { active: true, freeTotal: 0, paidTotal: 0, used: 1, reserved: 0, remaining: 0 }, price: null,
  service: { configured: true, available: true }, actions: [], canAnalyze: false, canPurchase: false, canReview: false, canUpload: true,
  videos: [{ id: "v1", caption: "Second run", uploadedAt: new Date("2026-10-27T18:00:00Z"), url: "/api/video-analysis/videos/v1", canDelete: true, contentType: "video/mp4" }],
  jobs: [job], purchases: [], payment: { coachName: "", wechatEnabled: false, wechatId: null, wechatQrUrl: null } };
const open = (jobId: string, query: Record<string, string> = {}, locale = "zh") =>
  AnalysisReportPage({ params: Promise.resolve({ locale, jobId }), searchParams: Promise.resolve(query) });

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-28T12:00:00Z"));
  mocks.auth.mockResolvedValue(user);
  mocks.account.mockResolvedValue(state);
  mocks.course.mockResolvedValue(state);
});
afterEach(() => vi.useRealTimers());

describe("analysis report page", () => {
  it("signs in back to the same report, lesson included", async () => {
    mocks.auth.mockRejectedValue(new Error("SIGN_IN_REQUIRED"));
    await expect(open("job1", { lesson: "SKI-1" })).rejects.toThrow("SIGN_IN_REQUIRED");
    expect(mocks.auth).toHaveBeenCalledWith({ locale: "zh", callbackPath: "/zh/video-analysis/report/job1?lesson=SKI-1" });
    expect(mocks.course).not.toHaveBeenCalled();
  });

  it("shows the clip's timeline and the report from the viewer's own wallet", async () => {
    const html = renderToStaticMarkup(await open("job1"));
    expect(mocks.account).toHaveBeenCalledWith(user);
    expect(html).toContain("Second run");
    expect(html).toContain("上传视频");
    expect(html).toContain("10月27日 14:00");
    expect(html).toContain("提交分析");
    expect(html).toContain("10月27日 14:01");
    expect(html).toContain("分析完成");
    expect(html).toContain("10月27日 14:05");
    expect(html).toContain("识别到的动作与所选动作不一致");
    expect(html).toContain('href="/video-analysis?source=account#workspace"');
  });

  it("reads a lesson report through the lesson's own access check", async () => {
    const html = renderToStaticMarkup(await open("job1", { lesson: "SKI-1" }));
    expect(mocks.course).toHaveBeenCalledWith("SKI-1", user);
    expect(mocks.account).not.toHaveBeenCalled();
    expect(html).toContain('href="/video-analysis?lesson=SKI-1#workspace"');
  });

  it.each(["not-found", "forbidden"] as const)("hides a lesson the viewer cannot see (%s)", async (reason) => {
    mocks.course.mockRejectedValue(new AnalysisDomainError(reason));
    await expect(open("job1", { lesson: "FOREIGN" })).rejects.toThrow("NOT_FOUND");
  });

  it("does not find a job outside the viewer's wallet", async () => {
    await expect(open("someone-elses-job")).rejects.toThrow("NOT_FOUND");
  });

  it("keeps a report whose clip was deleted", async () => {
    mocks.account.mockResolvedValue({ ...state, videos: [] });
    const html = renderToStaticMarkup(await open("job1", {}, "en"));
    expect(html).toContain("This video was deleted; its report is kept.");
    expect(html).toContain("The detected action does not match the selected action.");
  });

  it("says a queued job updates by itself", async () => {
    mocks.account.mockResolvedValue({ ...state, jobs: [{ ...job, status: "QUEUED", finishedAt: null, result: null, computeWait: "waiting_for_compute" }] });
    const html = renderToStaticMarkup(await open("job1"));
    expect(html).toContain("完成后本页自动更新");
    expect(html).toContain("正在等待分析算力");
    expect(html).not.toContain("分析报告</h2>");
  });
});
