import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ run: { findFirst: vi.fn(), findMany: vi.fn(), updateMany: vi.fn(), count: vi.fn(), create: vi.fn() }, config: vi.fn(), materials: vi.fn() }));
vi.mock("../prisma", () => ({ prisma: { actionUpdateRun: mocks.run,
  $transaction: async (work: (tx: unknown) => unknown) => work({ actionUpdateRun: mocks.run }) } }));
vi.mock("./pipeline-config", () => ({ getPipelineConfig: mocks.config }));
vi.mock("./freeski-season", () => ({ freeSkiSeason: { materials: mocks.materials } }));
vi.mock("../freeski/config", () => ({ isFreeSkiConfigured: () => true }));

import { FreeSkiError } from "../freeski/adapter";
import { CURRENT_SEASON } from "../freeski/csia-season";
import { closeInterrupted, prismaRunnerStore } from "./runner-store";
import { toSeasonList } from "./season-list";
import { cancelActionUpdate, getActionUpdateState, startActionUpdate } from "./service";
import { initialSteps, STALE_MS } from "./steps";

const at = new Date("2027-10-01T12:00:00Z");
const published = initialSteps().map(step => step.key === "recognizer" ? { ...step, status: "running" } : { ...step, status: "done" });
const stored = (changes: Record<string, unknown> = {}) => ({ id: "run1", season: "2026-27", status: "SUCCEEDED", list: toSeasonList(CURRENT_SEASON), steps: published,
  log: "one\ntwo", error: null, createdAt: at, startedAt: at, finishedAt: at, requestedBy: { name: "Kevin" }, ...changes });
/** No run has lost its worker unless a test says so. */
const lost = (runs: unknown[] = []) => mocks.run.findMany.mockImplementation(async (query: { where?: unknown }) => query.where ? runs : []);

beforeEach(() => {
  vi.resetAllMocks();
  mocks.config.mockReturnValue({});
  mocks.run.updateMany.mockResolvedValue({ count: 1 });
  mocks.run.count.mockResolvedValue(0);
  lost();
});

describe("asking for an update of the actions", () => {
  it("refuses a list it cannot run, and a server without the generator, before touching the database", async () => {
    const list = toSeasonList(CURRENT_SEASON);
    list.actions.push({ ...list.actions[0] });
    expect(await startActionUpdate("coach", list)).toMatchObject({ ok: false, error: "validation", problems: [{ code: "duplicate" }] });
    mocks.config.mockReturnValue(null);
    expect(await startActionUpdate("coach", toSeasonList(CURRENT_SEASON))).toEqual({ ok: false, error: "not-configured" });
    expect(mocks.run.create).not.toHaveBeenCalled();
  });

  it("queues one run with the list as submitted, and never a second beside it", async () => {
    mocks.run.create.mockResolvedValue(stored({ status: "QUEUED", steps: initialSteps(), log: "", startedAt: null, finishedAt: null }));
    const started = await startActionUpdate("coach", toSeasonList(CURRENT_SEASON));
    expect(started).toMatchObject({ ok: true, run: { status: "QUEUED", season: "2026-27", actions: CURRENT_SEASON.actions.length, log: [], requestedBy: "Kevin" } });
    expect(mocks.run.create).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ data: { season: "2026-27", list: toSeasonList(CURRENT_SEASON), steps: initialSteps(), requestedById: "coach" } }));
    mocks.run.count.mockResolvedValue(1);
    expect(await startActionUpdate("coach", toSeasonList(CURRENT_SEASON))).toEqual({ ok: false, error: "update-running" });
    // Two requests in the same instant: the database lets one through.
    mocks.run.count.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("conflict", { code: "P2034", clientVersion: "test" }));
    expect(await startActionUpdate("coach", toSeasonList(CURRENT_SEASON))).toEqual({ ok: false, error: "update-running" });
    expect(mocks.run.create).toHaveBeenCalledTimes(1);
  });

  it("cancels only a run that is waiting or under way", async () => {
    expect(await cancelActionUpdate("run1")).toBe(true);
    expect(mocks.run.updateMany).toHaveBeenCalledWith({ where: { id: "run1", status: { in: ["QUEUED", "RUNNING"] } }, data: { status: "CANCELLED", finishedAt: expect.any(Date) } });
    mocks.run.updateMany.mockResolvedValue({ count: 0 });
    expect(await cancelActionUpdate("run1")).toBe(false);
  });
});

describe("what the page is shown", () => {
  it("gives the season in use, the latest run in full and earlier ones in short", async () => {
    mocks.run.findFirst.mockResolvedValue(stored({ error: "recognizer:recognizer-failed" }));
    mocks.materials.mockResolvedValue(null);
    const state = await getActionUpdateState("coach", { materials: true });
    expect(state).toMatchObject({ ok: true, coachId: "coach", configured: true, season: { season: CURRENT_SEASON.season }, history: [], materials: { state: "unsupported" } });
    expect(state.known).toHaveLength(19);
    // The run is over: the step it was on did not complete, and is not shown as still going.
    expect(state.run).toMatchObject({ status: "SUCCEEDED", error: "recognizer:recognizer-failed", log: ["one", "two"], actions: 19 });
    expect(state.run!.steps.find(step => step.key === "recognizer")!.status).toBe("failed");
    mocks.materials.mockRejectedValue(new Error("asleep"));
    expect((await getActionUpdateState("coach", { materials: true })).materials).toEqual({ state: "unavailable" });
    // It answers, but in another version's shape.
    mocks.materials.mockRejectedValue(new FreeSkiError("analysis-invalid-response"));
    expect((await getActionUpdateState("coach", { materials: true })).materials).toEqual({ state: "mismatch" });
    expect(await getActionUpdateState("coach")).not.toHaveProperty("materials");
  });
});

describe("runs whose worker went away", () => {
  it("are closed: done when the season was already published, failed otherwise", async () => {
    lost([{ id: "published", steps: published }, { id: "early", steps: initialSteps() }]);
    await closeInterrupted({ actionUpdateRun: mocks.run } as never, at);
    expect(mocks.run.findMany.mock.calls[0][0].where).toEqual({ status: "RUNNING", OR: [{ heartbeatAt: null }, { heartbeatAt: { lt: new Date(at.getTime() - STALE_MS) } }] });
    expect(mocks.run.updateMany.mock.calls.map(call => [call[0].where.id, call[0].data.status, call[0].data.error])).toEqual([["published", "SUCCEEDED", "interrupted"], ["early", "FAILED", "interrupted"]]);
  });

  it("do not block the next request, which one worker takes", async () => {
    const store = prismaRunnerStore({ actionUpdateRun: mocks.run } as never);
    mocks.run.count.mockResolvedValue(1);
    expect(await store.claim(at)).toBeNull();
    mocks.run.count.mockResolvedValue(0);
    mocks.run.findFirst.mockResolvedValue({ id: "next", list: {} });
    expect(await store.claim(at)).toEqual({ id: "next", list: {} });
    expect(mocks.run.updateMany).toHaveBeenLastCalledWith({ where: { id: "next", status: "QUEUED" }, data: { status: "RUNNING", startedAt: at, heartbeatAt: at } });
    // Another worker got there first.
    mocks.run.updateMany.mockResolvedValue({ count: 0 });
    expect(await store.claim(at)).toBeNull();
    expect(await store.save("next", { steps: initialSteps(), log: "", heartbeatAt: at })).toBe(false);
  });
});
