import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { VideoAnalysisPanel } from "./video-analysis-panel";
import type { VideoAnalysisView } from "./video-analysis-types";

vi.mock("@/i18n/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const initialView: VideoAnalysisView = {
  ok: true,
  quota: { active: true, freeTotal: 3, paidTotal: 0, used: 1, reserved: 0, remaining: 2 },
  price: null,
  service: { configured: true, available: true },
  actions: [{ id: "parallel", labelZh: "平行式", labelEn: "Parallel turns", pathType: "improvement", level: null,
    available: true, groupZh: "技术提升", groupEn: "Improvement" }],
  canAnalyze: true, canPurchase: false, canReview: false, canUpload: true,
  videos: [{ id: "v1", caption: "Lesson clip", url: "/api/bookings/test/videos/v1", canDelete: true, contentType: "video/mp4", analysisSupported: true }],
  jobs: [], purchases: [],
  payment: { coachName: "Kevin", wechatEnabled: true, wechatId: "kevin-test", wechatQrUrl: null },
};

function render(view: VideoAnalysisView = initialView, extras = {}) {
  return renderToStaticMarkup(createElement(VideoAnalysisPanel, { locale: "en", bookingCode: "test", bookedHours: 2,
    completed: true, isCustomer: true, isOwnCoach: false, canUpload: true, initialVideos: [], initialView: view, ...extras }));
}
function buttonNamed(html: string, text: string) {
  return [...html.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/g)].map((match) => match[0]).find((button) => button.includes(text));
}

describe("unified lesson video analysis panel", () => {
  it.each(["zh", "en"] as const)("guides beginners from snowplow to parallel without offering unsupported analysis in %s", (locale) => {
    const html = render(initialView, { locale });
    const stages = locale === "zh" ? ["犁式滑行 / 停止", "连续犁式转弯", "半犁式并腿", "平行式转弯"] : ["Snowplow gliding / stopping", "Linked snowplow turns", "Wedge-to-parallel", "Parallel turns"];
    const stagePositions = stages.map((stage) => html.indexOf(stage));
    expect(stagePositions.every((position) => position >= 0)).toBe(true);
    expect(stagePositions).toEqual([...stagePositions].sort((left, right) => left - right));
    expect(html.match(new RegExp(locale === "zh" ? "暂未开放分析" : "Analysis not available yet", "g"))).toHaveLength(3);
    expect(html).toContain(locale === "zh" ? "技术提升 · 已开放" : "Improvement · Available");
    expect(buttonNamed(html, locale === "zh" ? "选择平行式转弯分析" : "Choose parallel-turn analysis")?.split(">")[0]).not.toContain('disabled=""');
    expect(html).not.toMatch(/<option[^>]*value="(?:snowplow|linking_snowplow|wedge_basic|intro_parallel)"/);
    expect(html).toContain(locale === "zh" ? "日常练习请选择「技术提升」" : "Choose Improvement for everyday practice");
  });
  it.each(["zh", "en"] as const)("keeps the beginner explanation private in the personal workspace in %s", (locale) => {
    const html = render({ ...initialView, accountId: "student" }, { accountId: "student", locale });
    expect(html).toContain(locale === "zh" ? "个人视频可以先上传保留，仍仅你本人可见" : "you can upload personal clips to keep them, visible only to you");
    expect(html).not.toContain(locale === "zh" ? "上传给教练查看" : "for your coach to review");
  });
  it("offers no beginner shortcut when parallel improvement is closed, even if certification is open", () => {
    const html = render({ ...initialView, actions: [{ ...initialView.actions[0], available: false },
      { ...initialView.actions[0], id: "certification:level1:demonstration_parallel", pathType: "certification", level: "level1", groupZh: "CSIA 1 级考证", groupEn: "CSIA L1 certification" },
    ] });
    expect(html).not.toContain("Choose parallel-turn analysis");
    expect(html).not.toContain("Improvement · Available");
    expect(html).toContain('value="certification:level1:demonstration_parallel"');
    expect(buttonNamed(html, "Analyze this video")?.split(">")[0]).toContain('disabled=""');
  });
  it("requires an analyzable clip and service availability before choosing the beginner shortcut", () => {
    const noVideo = render({ ...initialView, videos: [] });
    const offline = render({ ...initialView, service: { configured: true, available: false } });
    for (const html of [noVideo, offline]) {
      expect(buttonNamed(html, "Choose parallel-turn analysis")?.split(">")[0]).toContain('disabled=""');
    }
  });
  it.each(["zh", "en"] as const)("groups actions by FreeSki path and certification level in %s", (locale) => {
    const html = render({ ...initialView, actions: [initialView.actions[0],
      { id: "certification:level1:demonstration_parallel", labelZh: "示范平行式", labelEn: "Demonstration parallel", pathType: "certification", level: "level1", available: true, groupZh: "CSIA 1 级", groupEn: "CSIA Level 1" },
      { id: "certification:level2:demonstration_parallel", labelZh: "示范平行式", labelEn: "Demonstration parallel", pathType: "certification", level: "level2", available: true, groupZh: "CSIA 2 级", groupEn: "CSIA Level 2" },
    ] }, { locale });
    expect(html).toContain(`<optgroup label="${locale === "zh" ? "技术提升" : "Improvement"}">`);
    expect(html).toContain(`<optgroup label="${locale === "zh" ? "CSIA 1 级" : "CSIA Level 1"}">`);
    expect(html).toContain(`<optgroup label="${locale === "zh" ? "CSIA 2 级" : "CSIA Level 2"}">`);
    expect(html).toContain('value="certification:level1:demonstration_parallel"');
    expect(html).toContain('value="certification:level2:demonstration_parallel"');
    // Choosing a path/level is explicit, even when open actions exist.
    expect(html).toContain('<option value="" selected="">');
    expect(buttonNamed(html, locale === "zh" ? "分析这个视频" : "Analyze this video")?.split(">")[0]).toContain('disabled=""');
  });
  it.each(["zh", "en"] as const)("shows closed actions without allowing their selection in %s", (locale) => {
    const html = render({ ...initialView, actions: [initialView.actions[0],
      { ...initialView.actions[0], id: "carving", labelZh: "刻滑", labelEn: "Carving", available: false },
    ] }, { locale });
    expect(html).toContain(`<option value="carving" disabled="">${locale === "zh" ? "刻滑（暂未开放）" : "Carving (Not available)"}</option>`);
    expect(html).toContain(`<option value="parallel">${locale === "zh" ? "平行式" : "Parallel turns"}</option>`);
  });
  it("disables the picker and submission when the entire catalog is closed", () => {
    const html = render({ ...initialView, actions: [{ ...initialView.actions[0], available: false }] });
    expect(html).toMatch(/<select[^>]*disabled=""/);
    expect(buttonNamed(html, "Analyze this video")?.split(">")[0]).toContain('disabled=""');
  });
  it.each(["zh", "en"] as const)("explains a missing catalog and preserves historical action labels in %s", (locale) => {
    const html = render({ ...initialView, actions: [], jobs: [{ id: "j1", videoId: "v1", actionId: "carving", status: "SUCCEEDED",
      createdAt: "2026-10-06T20:00:00Z", finishedAt: "2026-10-06T20:00:01Z", errorCode: null, result: null }] }, { locale });
    expect(html).toContain(locale === "zh" ? "FreeSki 动作目录暂不可用" : "The FreeSki action catalog is temporarily unavailable");
    expect(html).toContain(locale === "zh" ? "刻滑" : "Carving");
    expect(html).not.toContain("<select");
    expect(buttonNamed(html, locale === "zh" ? "分析这个视频" : "Analyze this video")?.split(">")[0]).toContain('disabled=""');
  });
  it("keeps the service-offline message when its action catalog is also unavailable", () => {
    const html = render({ ...initialView, actions: [], service: { configured: true, available: false } });
    expect(html).toContain("Video analysis is not ready");
    expect(html).toContain("The FreeSki action catalog is temporarily unavailable");
  });
  it("uses standalone grants without a fake lesson, course price or payment actions", () => {
    const html = render({ ...initialView, accountId: "student", quota: { ...initialView.quota, freeTotal: 0, grantTotal: 5, remaining: 4 },
      videos: [{ ...initialView.videos[0], url: "/api/video-analysis/videos/v1" }] }, { accountId: "student", bookedHours: 0 });
    expect(html).toContain("My FreeSki video analysis"); expect(html).toContain("5 credits issued by coaches");
    expect(html).toContain("Upload skiing video"); expect(html).toContain("visible only to you");
    expect(html).not.toContain("shared free analyses"); expect(html).not.toContain("Extra analysis credits");
    expect(html).not.toContain("Create WeChat payment order");
  });
  it("shows one clip list, shared entitlement, upload and unset-price state", () => {
    const html = render();
    expect(html.match(/<video /g)).toHaveLength(1);
    expect(html).toContain("2-hour lesson includes 3 shared free analyses");
    expect(html).toContain("2 available · 1 used · 0 processing");
    expect(html).toContain("Upload lesson video");
    expect(html).toContain("Purchases are unavailable");
    expect(html).not.toContain("Create WeChat payment order");
  });
  it("escapes video captions instead of treating them as HTML", () => {
    const html = render({ ...initialView, videos: [{ ...initialView.videos[0], caption: "<svg onload=alert(1)>clip</svg>" }] });
    expect(html).toContain("&lt;svg onload=alert(1)&gt;clip&lt;/svg&gt;");
    expect(html).not.toContain("<svg onload");
  });
  it.each(["zh", "en"] as const)("shows future entitlement but no spending before completion in %s", (locale) => {
    const html = render({ ...initialView, quota: { ...initialView.quota, active: false, freeTotal: 0, remaining: 0 }, canAnalyze: false }, { completed: false, locale });
    expect(html).toContain(locale === "zh" ? "本节 2 小时课包含 3 次共享免费分析" : "3 shared free analyses");
    expect(html).toContain(locale === "zh" ? "待课程完成后解锁" : "Credits unlock after the lesson is completed");
    expect(html).not.toContain(locale === "zh" ? "额外分析次数" : "Extra analysis credits");
  });
  it("keeps shared-coach readers free of upload, run, purchase and review actions", () => {
    const html = render({ ...initialView, price: { unitCents: 100, currency: "CAD" }, canPurchase: true, canReview: true }, { isCustomer: false, isOwnCoach: false, canUpload: false });
    expect(html).toContain("Lesson clip");
    expect(html).not.toContain("Upload lesson video");
    expect(html).not.toContain("Analyze this video");
    expect(html).not.toContain("Create WeChat payment order");
    expect(html).not.toContain("WeChat receipt checked; confirm");
  });
  it("allows the own coach to upload and analyze without buying their own credits", () => {
    const html = render(initialView, { isCustomer: false, isOwnCoach: true });
    expect(html).toContain("Upload lesson video");
    expect(html).toContain("Analyze this video");
    expect(html).not.toContain("Create WeChat payment order");
  });
  it("preserves WebM playback with a clear analysis conversion hint and disabled selector", () => {
    const html = render({ ...initialView, videos: [{ ...initialView.videos[0], contentType: "video/webm", analysisSupported: false }] });
    expect(html).toContain("<video ");
    expect(html).toContain("This video can be viewed. Upload MP4 or MOV for analysis.");
    expect(html).toMatch(/<select[^>]*disabled=""/);
    expect(buttonNamed(html, "Analyze this video")?.split(">")[0]).toContain("disabled=\"\"");
  });
  it("keeps ungradable feedback visible even when the refunded job is marked failed", () => {
    const html = render({ ...initialView, jobs: [{ id: "j1", videoId: "v1", status: "FAILED", createdAt: "2026-10-06T20:00:00Z", finishedAt: "2026-10-06T20:00:01Z", errorCode: "UNGRADEABLE", result: { gradingStatus: "unavailable", gradingReason: "wrong-action", score: null, scoreKind: null, coachingZh: [], coachingEn: ["Use a complete turns clip"] } }] });
    expect(html).toContain("Analysis failed; no credit used");
    expect(html).toContain("detected action does not match");
    expect(html).toContain("Use a complete turns clip");
    expect(html).not.toContain("Technical score");
  });
  it.each(["zh", "en"] as const)("labels a job with the skier's current level and the catalog action in %s", (locale) => {
    const job = (id: string, actionId: string) => ({ id, videoId: "v1", status: "QUEUED" as const, createdAt: "2026-10-06T20:00:00Z",
      finishedAt: null, errorCode: null, result: null, actionId });
    const html = render({ ...initialView, jobs: [job("j1", "improvement:level2:parallel"), job("j2", "improvement:none:parallel"), job("j3", "parallel")] }, { locale });
    expect(html).toContain(locale === "zh" ? "平行式 · 目前 CSIA 2 级 ·" : "Parallel turns · Currently CSIA Level 2 ·");
    expect(html).toContain(locale === "zh" ? "平行式 · 还没考 CSIA 级别 ·" : "Parallel turns · No CSIA level yet ·");
    expect(html).toContain(locale === "zh" ? "<span>平行式 ·</span>" : "<span>Parallel turns ·</span>");
  });
  it("asks for the current level only after an improvement action is chosen", () => {
    expect(render()).not.toContain("Your current CSIA level");
  });
  it("blocks delete while a job is queued and shows its reserved credit", () => {
    const html = render({ ...initialView, quota: { ...initialView.quota, reserved: 1, remaining: 1 }, jobs: [{ id: "j1", videoId: "v1", status: "QUEUED", createdAt: "2026-10-06T20:00:00Z", finishedAt: null, errorCode: null, result: null }] });
    expect(html).toContain("1 processing");
    expect(html).toContain("Analysis in progress");
    expect(buttonNamed(html, "Delete video")?.split(">")[0]).toContain("disabled=\"\"");
  });
  it.each(["zh", "en"] as const)("shows the supplied queue reason as text in %s", (locale) => {
    const html = render({ ...initialView, jobs: [{ id: "j1", videoId: "v1", status: "QUEUED",
      createdAt: "2026-10-06T20:00:00Z", finishedAt: null, errorCode: null, result: null,
      queueReason: "待命：等待门卫切换" }] }, { locale });
    expect(html).toContain(locale === "zh" ? "排队原因：待命：等待门卫切换" : "Waiting reason: 待命：等待门卫切换");
    expect(html).toContain(locale === "zh" ? "排队中" : "Queued");
  });
  it.each([undefined, null, "", "  "])("keeps the generic queued status without an actual reason (%s)", (queueReason) => {
    const html = render({ ...initialView, jobs: [{ id: "j1", videoId: "v1", status: "QUEUED",
      createdAt: "2026-10-06T20:00:00Z", finishedAt: null, errorCode: null, result: null, queueReason }] });
    expect(html).toContain("Queued");
    expect(html).not.toContain("Waiting reason:");
  });
  it.each(["RUNNING", "SUCCEEDED", "FAILED"] as const)("hides an old queue reason when the job is %s", (status) => {
    const html = render({ ...initialView, jobs: [{ id: "j1", videoId: "v1", status,
      createdAt: "2026-10-06T20:00:00Z", finishedAt: null, errorCode: null, result: null,
      queueReason: "old queue reason" }] });
    expect(html).not.toContain("Waiting reason:");
    expect(html).not.toContain("old queue reason");
  });
  it("escapes markup in a queue reason instead of rendering HTML", () => {
    const html = render({ ...initialView, jobs: [{ id: "j1", videoId: "v1", status: "QUEUED",
      createdAt: "2026-10-06T20:00:00Z", finishedAt: null, errorCode: null, result: null,
      queueReason: "<img src=x onerror=alert(1)>" }] });
    expect(html).toContain("Waiting reason: &lt;img src=x onerror=alert(1)&gt;");
    expect(html).not.toContain("<img src=x");
  });
  it.each([
    ["zh", "compute_offline", "分析算力暂时不在线，任务已保留，恢复后自动开始。等待不算超时，分析完成才扣次数。"],
    ["en", "waiting_for_compute", "Waiting for analysis compute; it starts automatically when compute is free. Waiting never times out, and a credit is used only when the analysis completes."],
  ] as const)("tells a %s student the job waits for compute (%s)", (locale, computeWait, text) => {
    const html = render({ ...initialView, jobs: [{ id: "j1", videoId: "v1", status: "QUEUED",
      createdAt: "2026-10-06T20:00:00Z", finishedAt: null, errorCode: null, result: null, computeWait }] }, { locale });
    expect(html).toContain(text);
    expect(html).toContain(locale === "zh" ? "排队中" : "Queued");
  });
  it.each([["RUNNING", "compute_offline"], ["QUEUED", "toString"], ["QUEUED", "gpu_on_fire"]] as const)(
    "shows no compute wait for a %s job reporting %s", (status, computeWait) => {
      const html = render({ ...initialView, jobs: [{ id: "j1", videoId: "v1", status,
        createdAt: "2026-10-06T20:00:00Z", finishedAt: null, errorCode: null, result: null,
        computeWait: computeWait as "compute_offline" }] });
      expect(html).not.toContain("Waiting never times out");
    });
  it("displays an existing purchase at its frozen price after current pricing is disabled", () => {
    const html = render({ ...initialView, purchases: [{ id: "p1", quantity: 2, unitPriceCents: 150, totalCents: 300,
      status: "AWAITING_PAYMENT", paymentSubmittedAt: null, reviewNote: null, updatedAt: "2026-10-06T20:00:00Z" }] });
    expect(html).toContain("2 extra analyses");
    expect(html).toContain("$3");
    expect(html).toContain("I paid by WeChat; notify coach");
    expect(html).not.toContain("Create WeChat payment order");
  });
  it("shows receipt-review actions only to the lesson coach", () => {
    const view: VideoAnalysisView = { ...initialView, canReview: true, purchases: [{ id: "p1", quantity: 2, unitPriceCents: 150, totalCents: 300,
      status: "PENDING_PAYMENT_REVIEW", paymentSubmittedAt: "2026-10-06T20:00:00Z", reviewNote: null, updatedAt: "2026-10-06T20:00:00Z" }] };
    const own = render(view, { isCustomer: false, isOwnCoach: true });
    expect(own).toContain("WeChat receipt checked; confirm");
    expect(own).toContain("Reject payment");
    expect(own).not.toContain("I paid by WeChat; notify coach");
    expect(render(view, { isCustomer: false, isOwnCoach: false, canUpload: false })).not.toContain("WeChat receipt checked; confirm");
  });
});
