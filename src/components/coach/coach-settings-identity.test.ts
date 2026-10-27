import { isValidElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CoachSettingsForm, type CoachSettings } from "./coach-settings-form";
import { VideoAnalysisSettings } from "./video-analysis-settings";

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), refresh: vi.fn(), stateCount: 0, price: false }));
vi.mock("@/lib/client-fetch", () => ({ clientFetch: mocks.fetch }));
vi.mock("@/i18n/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("react", async (importOriginal) => ({ ...await importOriginal<typeof import("react")>(),
  useEffect: vi.fn(), useCallback: (callback: unknown) => callback,
  useState: (initial: unknown) => {
    const index = mocks.stateCount++;
    const value = mocks.price && index < 3 ? ["25", true, false][index] : typeof initial === "function" ? initial() : initial;
    return [value, vi.fn()];
  },
}));

const coachId = "original-coach";
const initial: CoachSettings = { displayName: "Original", avatarKey: null, bioZh: "", bioEn: "", csiaLevel: null, csiaParkLevel: null,
  teachableSkills: [], teachableLevels: [], rates: [{ lessonType: "riding", regularCents: 10000, earlyBirdCents: null }],
  extraPersonCents: 0, maxGroupSize: 1, minHours: 2, maxHours: 4, leadTimeHours: 24, emtEnabled: false, emtEmail: "", emtName: "",
  wechatPayEnabled: false, wechatPayQrKey: null, alipayEnabled: false, alipayQrKey: null, wechatId: "", contactEmail: "", contactPhone: "",
  cancellationPolicyZh: "Policy", cancellationPolicyEn: "Policy", isPublished: false, icsToken: "test" };
function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  return isValidElement<{ children?: ReactNode }>(node) ? textOf(node.props.children) : "";
}
function nodes(node: ReactNode): ReturnType<typeof CoachSettingsForm>[] {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!isValidElement<{ children?: ReactNode }>(node)) return [];
  return [node as ReturnType<typeof CoachSettingsForm>, ...nodes(node.props.children)];
}
async function save(price: boolean) {
  mocks.price = price;
  const tree = price ? VideoAnalysisSettings({ locale: "en", coachId }) : CoachSettingsForm({ locale: "en", coachId, initial });
  const button = nodes(tree).find((node) => node.props.onClick && textOf(node) === (price ? "Save analysis price" : "Save settings"))!;
  button.props.onClick();
  await vi.waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(1));
  await vi.waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
}
beforeEach(() => { vi.clearAllMocks(); mocks.stateCount = 0; mocks.price = false; mocks.fetch.mockResolvedValue(Response.json({ error: "session-changed" }, { status: 409 })); });

describe("coach settings session snapshots", () => {
  it("binds the actual main settings save to its original SSR coach", async () => {
    await save(false);
    expect(mocks.fetch.mock.calls[0][0]).toBe("/api/coach/settings");
    expect(JSON.parse(mocks.fetch.mock.calls[0][1].body).expectedCoachId).toBe(coachId);
  });
  it("binds the independent price save to the original SSR coach without a retry", async () => {
    await save(true);
    expect(mocks.fetch.mock.calls[0][0]).toBe("/api/coach/video-analysis/settings");
    expect(JSON.parse(mocks.fetch.mock.calls[0][1].body)).toEqual({ analysisCreditPriceCents: 2500, expectedCoachId: coachId });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });
});
