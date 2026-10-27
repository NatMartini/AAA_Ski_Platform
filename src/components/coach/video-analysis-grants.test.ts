import { isValidElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { VideoAnalysisGrants } from "./video-analysis-grants";

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(), refresh: vi.fn(), stateIndex: 0,
  email: " Student@Example.com ", quantity: "5", note: " practice ", setters: [] as ReturnType<typeof vi.fn>[],
}));
vi.mock("@/lib/client-fetch", () => ({ clientFetch: mocks.fetch }));
vi.mock("@/i18n/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("react", async (importOriginal) => ({
  ...await importOriginal<typeof import("react")>(),
  useEffect: vi.fn(), useCallback: (callback: unknown) => callback,
  useRef: (value: unknown) => ({ current: value }),
  useState: (initial: unknown) => {
    const index = mocks.stateIndex++;
    const setter = vi.fn();
    mocks.setters[index] = setter;
    return [index < 3 ? [mocks.email, mocks.quantity, mocks.note][index] : initial, setter];
  },
}));

type TestNode = { type: unknown; props: { children?: ReactNode; onSubmit?: (event: { preventDefault: () => void }) => void; onClick?: () => void } };
function nodes(node: ReactNode): TestNode[] {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!isValidElement<{ children?: ReactNode }>(node)) return [];
  return [node, ...nodes(node.props.children)];
}
function workspace() {
  const shell = VideoAnalysisGrants({ locale: "en", coachId: "coach-original" });
  const render = shell.type as (props: { locale: "en"; coachId: string }) => ReactNode;
  return nodes(render(shell.props));
}
function formSubmission() {
  const form = workspace().find((node) => node.type === "form")!;
  return () => form.props.onSubmit!({ preventDefault: vi.fn() });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.stateIndex = 0;
  mocks.email = " Student@Example.com ";
  mocks.quantity = "5";
  mocks.note = " practice ";
  mocks.setters = [];
  mocks.fetch.mockResolvedValue(Response.json({ error: "network-error" }, { status: 503 }));
});

describe("coach-issued FreeSki credit identity and retries", () => {
  it("keys the full workspace to the SSR coach so an account change discards drafts", () => {
    expect(VideoAnalysisGrants({ locale: "en", coachId: "coach-original" }).key).toBe("coach-original");
    expect(VideoAnalysisGrants({ locale: "en", coachId: "coach-new" }).key).toBe("coach-new");
  });

  it("submits the original coach snapshot and preserves one UUID after an ambiguous network failure", async () => {
    const submit = formSubmission();
    submit();
    await vi.waitFor(() => expect(mocks.setters[5]).toHaveBeenLastCalledWith(false));
    submit();
    await vi.waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(2));
    const first = JSON.parse(mocks.fetch.mock.calls[0][1].body);
    const second = JSON.parse(mocks.fetch.mock.calls[1][1].body);
    expect(first).toEqual({ recipientEmail: "student@example.com", quantity: 5, note: "practice", expectedCoachId: "coach-original", requestKey: expect.stringMatching(/^[0-9a-f-]{36}$/i) });
    expect(second).toEqual(first);
  });

  it("does not start a second mutation while the first response is pending", async () => {
    let finish!: (response: Response) => void;
    mocks.fetch.mockImplementation(() => new Promise<Response>((resolve) => { finish = resolve; }));
    const submit = formSubmission();
    submit();
    submit();
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    finish(Response.json({ error: "network-error" }, { status: 503 }));
    await vi.waitFor(() => expect(mocks.setters[5]).toHaveBeenLastCalledWith(false));
  });

  it.each(["session-changed", "state-changed"])("blocks the stale form and refreshes without retrying after %s", async (error) => {
    mocks.fetch.mockResolvedValue(Response.json({ error }, { status: 409 }));
    const submit = formSubmission();
    submit();
    await vi.waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
    submit();
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.setters[3]).toHaveBeenCalledWith([]);
    expect(mocks.setters[6]).toHaveBeenCalledWith(true);
  });

  it("binds the history reload to the same coach after a successful grant", async () => {
    mocks.fetch.mockResolvedValueOnce(Response.json({ ok: true }, { status: 201 }));
    mocks.fetch.mockResolvedValueOnce(Response.json({ ok: true, coachId: "coach-original", grants: [] }));
    formSubmission()();
    await vi.waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(2));
    expect(mocks.fetch.mock.calls[1][0]).toBe("/api/coach/video-analysis/grants?expectedCoachId=coach-original");
    expect(mocks.fetch.mock.calls[1][1]).toEqual({ cache: "no-store", signal: undefined });
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("clears private grant history if a response belongs to another signed-in coach", async () => {
    mocks.fetch.mockResolvedValueOnce(Response.json({ ok: true }, { status: 201 }));
    mocks.fetch.mockResolvedValueOnce(Response.json({ ok: true, coachId: "coach-new", grants: [] }));
    formSubmission()();
    await vi.waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
    expect(mocks.setters[3]).toHaveBeenCalledWith([]);
    expect(mocks.setters[6]).toHaveBeenCalledWith(true);
  });

  it.each(["0", "101", "1.5", "1e2", "NaN"])("does not issue invalid quantity %s", (quantity) => {
    mocks.quantity = quantity;
    formSubmission()();
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.setters[7]).toHaveBeenCalledWith(expect.stringContaining("whole number from 1 to 100"));
  });
});
