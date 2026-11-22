import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VideoAnalysisPanel } from "./video-analysis-panel";
import { AnalysisCreditPurchase } from "./analysis-credit-purchase";
import type { VideoAnalysisView } from "./video-analysis-types";

vi.mock("@/i18n/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }),
  Link: (props: ComponentProps<"a">) => createElement("a", props) }));

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
  it.each(["zh", "en"] as const)("asks for the action, then the tier, with each tier's price in %s", (locale) => {
    const html = render(initialView, { locale });
    expect(html.indexOf(locale === "zh" ? "1. 视频里的动作" : "1. The action in the video")).toBeLessThan(html.indexOf(locale === "zh" ? "2. 分析档位" : "2. Analysis tier"));
    for (const name of locale === "zh" ? ["简单", "标准", "深度", "完全"] : ["Simple", "Standard", "Deep", "Complete"]) expect(html).toContain(name);
    expect(html).toContain('role="radiogroup"');
    expect(html).not.toContain(locale === "zh" ? "犁式滑行" : "Snowplow gliding");
  });
  it("shows a student's free allowance and closes the paid tiers without the credits for them", () => {
    const html = render({ ...initialView, accountId: "student", quota: { ...initialView.quota, remaining: 0, remainingHalves: 0, freeToday: 2, freeLimit: 5 } }, { accountId: "student" });
    expect(html).toContain("Free · 3 left today");
    expect(html.match(/Not enough credits/g)).toHaveLength(2);
  });
  it("offers no beginner shortcut when parallel improvement is closed, even if certification is open", () => {
    const html = render({ ...initialView, actions: [{ ...initialView.actions[0], available: false },
      { ...initialView.actions[0], id: "certification:level1:demonstration_parallel", pathType: "certification", level: "level1", groupZh: "CSIA 1 级考证", groupEn: "CSIA L1 certification" },
    ] });
    expect(html).not.toContain("Choose parallel-turn analysis");
    expect(html).not.toContain("Improvement · Available");
    expect(html).toContain('value="certification:level1:demonstration_parallel"');
    expect(buttonNamed(html, "Start analysis")?.split(">")[0]).toContain('disabled=""');
  });
  it("keeps the analysis closed without an analysable clip or with the service offline", () => {
    const noVideo = render({ ...initialView, videos: [] });
    const offline = render({ ...initialView, service: { configured: true, available: false } });
    for (const html of [noVideo, offline]) expect(buttonNamed(html, "Start analysis")?.split(">")[0]).toContain('disabled=""');
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
    // Choosing a path/level is explicit, even when open actions exist: the clip's
    // button opens the dialog, whose Start button waits for a chosen action.
    expect(html).toContain('<option value="" selected="">');
    expect(buttonNamed(html, locale === "zh" ? "分析这个视频" : "Analyze this video")?.split(">")[0]).not.toContain('disabled=""');
    expect(buttonNamed(html, locale === "zh" ? "开始分析" : "Start analysis")?.split(">")[0]).toContain('disabled=""');
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
    const html = render({ ...initialView, accountId: "student", quota: { ...initialView.quota, freeTotal: 3, grantTotal: 5, remaining: 7 },
      videos: [{ ...initialView.videos[0], url: "/api/video-analysis/videos/v1" }] }, { accountId: "student", bookedHours: 0 });
    expect(html).toContain("My analyses"); expect(html).not.toContain("shared free analyses");
    expect(html).toContain("Analyse a new video"); expect(html).toContain("Only you can see it");
    expect(html).not.toContain("shared free analyses"); expect(html).not.toContain("Extra analysis credits");
    expect(html).not.toContain("Create WeChat payment order");
  });
  it("shows one clip list and says a lesson's videos are its coach's to analyse", () => {
    const html = render();
    expect(html.match(/<video /g)).toHaveLength(1);
    // A lesson holds no credits of its own any more (owner's decision, 2026-11-07).
    expect(html).toContain("Your coach uploads and analyses this lesson");
    expect(html).not.toContain("shared free analyses");
    expect(html).toContain("Analyse a new video");
    expect(html).not.toContain("Create WeChat payment order");
    // A student whose lesson cannot be analysed by them still adds clips for the coach.
    expect(render({ ...initialView, canAnalyze: false })).toContain("Upload a video");
  });
  it("escapes video captions instead of treating them as HTML", () => {
    const html = render({ ...initialView, videos: [{ ...initialView.videos[0], caption: "<svg onload=alert(1)>clip</svg>" }] });
    expect(html).toContain("&lt;svg onload=alert(1)&gt;clip&lt;/svg&gt;");
    expect(html).not.toContain("<svg onload");
  });
  it.each(["zh", "en"] as const)("points a student to their own account before the lesson is completed too, in %s", (locale) => {
    const html = render({ ...initialView, quota: { ...initialView.quota, active: false, freeTotal: 0, remaining: 0 }, canAnalyze: false }, { completed: false, locale });
    expect(html).toContain(locale === "zh" ? "你自己的视频在“我的分析”里分析" : "analyse your own videos under My analyses");
    expect(html).not.toContain(locale === "zh" ? "额外分析次数" : "Extra analysis credits");
    // The lesson's coach is told they analyse it once it is completed.
    expect(render({ ...initialView, unlimited: true, quota: { ...initialView.quota, active: false } }, { completed: false, locale, isCustomer: false, isOwnCoach: true }))
      .toContain(locale === "zh" ? "课程完成后才能分析" : "once the lesson is completed");
  });
  it("keeps shared-coach readers free of upload, run, purchase and review actions", () => {
    const html = render({ ...initialView, price: { unitCents: 100, currency: "CAD" }, canPurchase: true, canReview: true }, { isCustomer: false, isOwnCoach: false, canUpload: false });
    expect(html).toContain("Lesson clip");
    expect(html).not.toContain("Analyse a new video");
    expect(html).not.toContain("Analyze this video");
    expect(html).not.toContain("Create WeChat payment order");
    expect(html).not.toContain("WeChat receipt checked; confirm");
  });
  it("allows the own coach to upload and analyze without buying their own credits", () => {
    const html = render(initialView, { isCustomer: false, isOwnCoach: true });
    expect(html).toContain("Analyse a new video");
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
    expect(html).toContain(`data-job-label="true">${locale === "zh" ? "平行式 · 目前 CSIA 2 级" : "Parallel turns · Currently CSIA Level 2"}<`);
    expect(html).toContain(`data-job-label="true">${locale === "zh" ? "平行式 · 还没考 CSIA 级别" : "Parallel turns · No CSIA level yet"}<`);
    expect(html).toContain(`data-job-label="true">${locale === "zh" ? "平行式" : "Parallel turns"}<`);
    expect(html).toContain(locale === "zh" ? "全部分析记录（3）" : "All analyses (3)");
  });
  it("asks for the current level only after an improvement action is chosen", () => {
    expect(render()).not.toContain("Your current CSIA level");
  });
  it("blocks delete while a job is queued and shows its reserved credit", () => {
    const html = render({ ...initialView, quota: { ...initialView.quota, reserved: 1, remaining: 1 }, jobs: [{ id: "j1", videoId: "v1", status: "QUEUED", createdAt: "2026-10-06T20:00:00Z", finishedAt: null, errorCode: null, result: null }] });
    expect(html).toContain("Analysis in progress");
    // The clip turns a ring until the server is done.
    expect(html).toContain("Queued; starts when its turn comes");
    expect(html).toContain("animate-spin");
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
    // Students buy on their account page now, through their latest completed lesson's coach.
    const html = renderToStaticMarkup(createElement(AnalysisCreditPurchase, { locale: "en", bookingCode: "test", initialView: { ...initialView,
      purchases: [{ id: "p1", quantity: 2, unitPriceCents: 150, totalCents: 300,
      status: "AWAITING_PAYMENT", paymentSubmittedAt: null, reviewNote: null, updatedAt: "2026-10-06T20:00:00Z" }] } }));
    expect(html).toContain("Buy more analyses");
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

describe("video library", () => {
  afterEach(() => vi.useRealTimers());
  const finished = { id: "j1", videoId: "v1", actionId: "improvement:level1:parallel", status: "SUCCEEDED" as const,
    createdAt: "2026-10-27T18:01:00Z", finishedAt: "2026-10-27T18:05:00Z", errorCode: null,
    result: { gradingStatus: "unavailable", gradingReason: null, score: null, scoreKind: null, coachingZh: [], coachingEn: [] } };
  const clip = { ...initialView.videos[0], uploadedAt: "2026-10-27T18:00:00Z" };

  it.each(["zh", "en"] as const)("shows when a clip was uploaded, submitted and finished in %s", (locale) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-28T12:00:00Z"));
    const html = render({ ...initialView, videos: [clip], jobs: [finished] }, { locale });
    if (locale === "zh") {
      expect(html).toMatch(/上传 <time[^>]*>10月27日 14:00<\/time>/);
      expect(html).toMatch(/分析完成 <time[^>]*>10月27日 14:05<\/time>/);
      expect(html).toContain("用时 4 分钟");
    } else {
      expect(html).toMatch(/Uploaded <time[^>]*>Oct 27, 2:00 p\.m\.<\/time>/);
      expect(html).toMatch(/Analysis finished <time[^>]*>Oct 27, 2:05 p\.m\.<\/time>/);
    }
    expect(html).toContain('href="/video-analysis/report/j1?lesson=test"');
  });

  it("names the year only for a clip from another year", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2027-01-05T12:00:00Z"));
    expect(render({ ...initialView, videos: [clip], jobs: [finished] }, { locale: "zh" })).toContain("2026年10月27日 14:00");
  });

  it("counts clips by where their newest analysis stands once there are several", () => {
    const fresh = { ...clip, id: "v2", caption: "Fresh clip", uploadedAt: "2026-10-28T10:00:00Z" };
    const count = (html: string, label: string) => html.match(new RegExp(`${label}<span[^>]*>(\\d+)<`))?.[1];
    // Two clips need no filter.
    expect(count(render({ ...initialView, videos: [clip, fresh], jobs: [finished] }), "All")).toBeUndefined();
    const more = [3, 4, 5].map(n => ({ ...fresh, id: `v${n}`, caption: `Clip ${n}`, uploadedAt: `2026-10-2${n}T10:00:00Z` }));
    const html = render({ ...initialView, videos: [clip, fresh, ...more], jobs: [finished] });
    expect([count(html, "All"), count(html, "Not analyzed"), count(html, "In progress"), count(html, "Done"), count(html, "Not graded")]).toEqual(["5", "4", "0", "1", "0"]);
    // Newest upload first.
    expect(html.indexOf("Fresh clip")).toBeLessThan(html.indexOf("Lesson clip"));
  });

  it("links a personal report without a lesson and keeps reports of deleted clips reachable", () => {
    const orphan = { ...finished, id: "j0", videoId: null };
    const html = render({ ...initialView, accountId: "student", videos: [clip], jobs: [finished, orphan] }, { accountId: "student" });
    expect(html).toContain('href="/video-analysis/report/j1"');
    expect(html).toContain("Analyses of deleted videos (1)");
    expect(html).toContain('href="/video-analysis/report/j0"');
  });

  it("offers an upload dialog only to people who may upload", () => {
    expect(render()).toContain("Choose a video and upload");
    expect(render(initialView, { isCustomer: false, isOwnCoach: false, canUpload: false })).not.toContain("Choose a video and upload");
  });
});
