import { isValidElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CoachReviewPanel } from "./coach-review-panel";

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), refresh: vi.fn(), stateCount: 0, reason: "" }));
vi.mock("@/lib/client-fetch", () => ({ clientFetch: mocks.fetch }));
vi.mock("@/i18n/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("react", async (importOriginal) => ({ ...await importOriginal<typeof import("react")>(),
  useRef: () => ({ current: null }),
  useState: (initial: unknown) => { const count = mocks.stateCount++; return [count === 0 ? mocks.reason : initial, vi.fn()]; },
}));

const version = "2026-10-07T10:00:00.000Z";
const props = { locale: "en" as const, target: { kind: "booking" as const, code: "SKI-TEST" },
  confirmed: false, submitted: true, hasProof: true, proofUploadedBy: "CUSTOMER" as const,
  paymentMethod: "EMT" as const, paymentReference: "ref-A", canReview: true,
  canUploadProof: false, expectedUpdatedAt: version };

function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  return isValidElement<{ children?: ReactNode }>(node) ? textOf(node.props.children) : "";
}
function nodes(node: ReactNode): ReturnType<typeof CoachReviewPanel>[] {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!isValidElement<{ children?: ReactNode }>(node)) return [];
  return [node as ReturnType<typeof CoachReviewPanel>, ...nodes(node.props.children)];
}
function action(name: string, extra = {}) {
  const tree = CoachReviewPanel({ ...props, ...extra });
  const button = nodes(tree).find((node) => node.props.onClick && textOf(node) === name);
  if (!button) throw new Error(`Missing action ${name}`);
  return button.props.onClick as () => Promise<void>;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.stateCount = 0;
  mocks.reason = "";
  mocks.fetch.mockResolvedValue(Response.json({ ok: true }));
});

describe("payment review snapshots", () => {
  it("confirms the precise displayed booking version", async () => {
    await action("Confirm payment")();
    const body = JSON.parse(mocks.fetch.mock.calls[0][1].body);
    expect(body).toEqual({ action: "confirm", note: null, expectedUpdatedAt: version });
  });
  it("rejects the precise displayed package version", async () => {
    mocks.reason = "Transfer not received";
    await action("Reject payment", { target: { kind: "package", code: "PKG-TEST" } })();
    expect(mocks.fetch.mock.calls[0][0]).toBe("/api/packages/PKG-TEST/review");
    expect(JSON.parse(mocks.fetch.mock.calls[0][1].body)).toEqual({ action: "reject", note: mocks.reason, expectedUpdatedAt: version });
  });
  it("includes the original snapshot version when recording a direct receipt", async () => {
    await action("Payment received — confirm", { submitted: false, hasProof: false, canReview: false, canConfirmReceipt: true })();
    expect(JSON.parse(mocks.fetch.mock.calls[0][1].body)).toEqual({ action: "confirm", expectedUpdatedAt: version, manualReceipt: { method: "EMT" } });
  });
  it("binds the displayed proof URL to the same snapshot version", () => {
    const image = nodes(CoachReviewPanel(props)).find((node) => node.type === "img");
    expect(image?.props.src).toBe(`/api/bookings/SKI-TEST/proof?v=${encodeURIComponent(version)}`);
  });
  it("uses the exact new version returned by its package WeChat submission", async () => {
    const submittedVersion = "2026-10-07T10:00:01.123Z";
    mocks.fetch.mockResolvedValueOnce(Response.json({ ok: true, updatedAt: submittedVersion }));
    await action("Received the student's WeChat payment", { target: { kind: "package", code: "PKG-TEST" }, submitted: false, hasProof: false, canReview: false, canUploadProof: true })();
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(mocks.fetch.mock.calls[0][0]).toBe("/api/packages/PKG-TEST/payment");
    expect(mocks.fetch.mock.calls[1][0]).toBe("/api/packages/PKG-TEST/review");
    expect(JSON.parse(mocks.fetch.mock.calls[1][1].body).expectedUpdatedAt).toBe(submittedVersion);
  });
  it("never falls back to an old or freshly fetched version if submission omitted its version", async () => {
    await action("Received the student's WeChat payment", { target: { kind: "package", code: "PKG-TEST" }, submitted: false, hasProof: false, canReview: false, canUploadProof: true })();
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.refresh).toHaveBeenCalled();
  });
  it("refreshes a stale review conflict without retrying the mutation", async () => {
    mocks.fetch.mockResolvedValue(Response.json({ error: "state-changed" }, { status: 409 }));
    await action("Confirm payment")();
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.refresh).toHaveBeenCalled();
  });
});
