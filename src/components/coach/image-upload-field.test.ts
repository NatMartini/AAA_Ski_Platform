import { isValidElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ImageUploadField } from "./image-upload-field";
import { QrUploadField } from "./qr-upload-field";
import { CoachSettingsForm, type CoachSettings } from "./coach-settings-form";

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), refresh: vi.fn() }));
vi.mock("@/lib/client-fetch", () => ({ clientFetch: mocks.fetch }));
vi.mock("@/i18n/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("react", async (importOriginal) => ({ ...await importOriginal<typeof import("react")>(),
  useRef: () => ({ current: null }),
  useState: (initial: unknown) => [typeof initial === "function" ? initial() : initial, vi.fn()],
}));

function nodes(node: ReactNode): ReturnType<typeof ImageUploadField>[] {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!isValidElement<{ children?: ReactNode }>(node)) return [];
  return [node as ReturnType<typeof ImageUploadField>, ...nodes(node.props.children)];
}
const coachId = "coach-A";
const props = { coachId, purpose: "coach-avatar" as const, previewSrc: `/api/files/avatar/${coachId}`,
  previewAlt: "Coach A", hasImage: false, labels: { upload: "Upload", replace: "Replace", failed: "Failed", tooLarge: "Too large", sessionChanged: "Session changed" },
  onUploaded: vi.fn() };

function selectImage(extra = {}) {
  const input = nodes(ImageUploadField({ ...props, ...extra })).find((node) => node.type === "input")!;
  const event = { target: { files: [new File(["image"], "avatar.png", { type: "image/png" })], value: "avatar.png" } };
  input.props.onChange(event);
}

beforeEach(() => { vi.clearAllMocks(); mocks.fetch.mockResolvedValue(Response.json({ key: "uploaded-key" })); });

describe("coach image upload identity", () => {
  it.each(["coach-avatar", "payment-qr"])("sends the displayed coach identity for %s", async (purpose) => {
    selectImage({ purpose, ...(purpose === "payment-qr" ? { kind: "wechat" } : {}) });
    await vi.waitFor(() => expect(props.onUploaded).toHaveBeenCalledWith("uploaded-key"));
    const [path, init] = mocks.fetch.mock.calls[0];
    expect(path).toBe("/api/upload");
    expect(init.method).toBe("POST");
    expect(init.body.get("expectedCoachId")).toBe(coachId);
    expect(init.body.get("purpose")).toBe(purpose);
    expect(init.body.get("file")).toBeInstanceOf(File);
    if (purpose === "payment-qr") expect(init.body.get("kind")).toBe("wechat");
  });
  it("refreshes a cross-tab identity conflict without applying an uploaded key or retrying", async () => {
    mocks.fetch.mockResolvedValue(Response.json({ error: "session-changed" }, { status: 409 }));
    selectImage();
    await vi.waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
    expect(props.onUploaded).not.toHaveBeenCalled();
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });
  it.each(["wechat", "alipay"] as const)("passes the SSR owner through the %s QR wrapper", (kind) => {
    const field = QrUploadField({ kind, coachId, locale: "en", currentKey: null, onUploaded: props.onUploaded });
    expect(field.type).toBe(ImageUploadField);
    expect(field.props.coachId).toBe(coachId);
    expect(field.props.kind).toBe(kind);
  });
  it("passes the SSR owner to the avatar and both QR settings entry points", () => {
    const initial: CoachSettings = { displayName: "A", avatarKey: null, bioZh: "", bioEn: "", csiaLevel: null, csiaParkLevel: null,
      teachableSkills: [], teachableLevels: [], rates: [], extraPersonCents: 0, maxGroupSize: 1, minHours: 2, maxHours: 4,
      leadTimeHours: 24, emtEnabled: false, emtEmail: "", emtName: "", wechatPayEnabled: true, wechatPayQrKey: null,
      alipayEnabled: true, alipayQrKey: null, wechatId: "", contactEmail: "", contactPhone: "", cancellationPolicyZh: "",
      cancellationPolicyEn: "", isPublished: false, icsToken: "test-token" };
    const fields = nodes(CoachSettingsForm({ coachId, locale: "en", initial })).filter((node) => node.type === ImageUploadField || node.type === QrUploadField);
    expect(fields).toHaveLength(3);
    expect(fields.every((field) => field.props.coachId === coachId)).toBe(true);
  });
});
