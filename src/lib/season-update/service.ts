import { Prisma } from "@prisma/client";
import type { CsiaSeason } from "../freeski/csia-season";
import { FreeSkiError } from "../freeski/adapter";
import { isFreeSkiConfigured } from "../freeski/config";
import { prisma } from "../prisma";
import { freeSkiSeason, type SeasonMaterials } from "./freeski-season";
import { getPipelineConfig } from "./pipeline-config";
import { closeInterrupted } from "./runner-store";
import { KNOWN_ACTIONS, listProblems, seasonListSchema, type ListProblem, type SeasonList } from "./season-list";
import { readCurrentSeason } from "./season-store";
import { initialSteps, isActive, readSteps, RUN_STATUSES, type RunSummary, type RunView } from "./steps";

/** The admin side of "update the actions": what the page shows, starting a run and cancelling one. The worker does the run. */
const SUMMARY = { id: true, season: true, status: true, list: true, steps: true, error: true, createdAt: true, startedAt: true, finishedAt: true,
  requestedBy: { select: { name: true } } } as const;
type Stored = Prisma.ActionUpdateRunGetPayload<{ select: typeof SUMMARY }>;

function summary(run: Stored): RunSummary {
  const active = isActive(run.status), list = seasonListSchema.safeParse(run.list);
  return { id: run.id, season: run.season, status: RUN_STATUSES.find(status => status === run.status) ?? "FAILED",
    // A step still marked as running in a run that is over was cut short.
    steps: readSteps(run.steps).map(step => !active && step.status === "running" ? { ...step, status: "failed" as const } : step),
    error: run.error, actions: list.success ? list.data.actions.length : 0, requestedBy: run.requestedBy.name,
    createdAt: run.createdAt.toISOString(), startedAt: run.startedAt?.toISOString() ?? null, finishedAt: run.finishedAt?.toISOString() ?? null };
}
const view = (run: Stored & { log: string }): RunView => ({ ...summary(run), log: run.log ? run.log.split("\n") : [] });

export type MaterialsState = { state: "ready"; data: SeasonMaterials } | { state: "unsupported" | "unavailable" | "mismatch" };
export type ActionUpdateState = {
  ok: true; coachId: string; season: CsiaSeason; known: typeof KNOWN_ACTIONS;
  /** Whether this server has the generator's Python and FreeSki's checkout named in its environment. */
  configured: boolean;
  run: RunView | null; history: RunSummary[]; materials?: MaterialsState;
};

/** What FreeSki holds for the season. It may be asleep: asking wakes it, and the page asks again. */
async function readMaterials(): Promise<MaterialsState> {
  if (!isFreeSkiConfigured()) return { state: "unavailable" };
  try {
    const data = await freeSkiSeason.materials(AbortSignal.timeout(8_000));
    return data ? { state: "ready", data } : { state: "unsupported" };
  } catch (error) {
    // Answered, but not in the shape this site reads: FreeSki is running another version of its season API.
    return { state: error instanceof FreeSkiError && error.code === "analysis-invalid-response" ? "mismatch" : "unavailable" };
  }
}

export async function getActionUpdateState(coachId: string, options: { materials?: boolean } = {}): Promise<ActionUpdateState> {
  await closeInterrupted(prisma);
  const [latest, history, materials] = await Promise.all([
    prisma.actionUpdateRun.findFirst({ orderBy: { createdAt: "desc" }, select: { ...SUMMARY, log: true } }),
    prisma.actionUpdateRun.findMany({ orderBy: { createdAt: "desc" }, skip: 1, take: 8, select: SUMMARY }),
    options.materials ? readMaterials() : undefined,
  ]);
  return { ok: true, coachId, season: readCurrentSeason(), known: KNOWN_ACTIONS, configured: getPipelineConfig() !== null,
    run: latest ? view(latest) : null, history: history.map(summary), ...(materials ? { materials } : {}) };
}

export type StartResult = { ok: true; run: RunView } | { ok: false; error: "validation"; problems: ListProblem[] } | { ok: false; error: "not-configured" | "update-running" };

export async function startActionUpdate(coachId: string, list: SeasonList): Promise<StartResult> {
  const problems = listProblems(list);
  if (problems.length) return { ok: false, error: "validation", problems };
  if (!getPipelineConfig()) return { ok: false, error: "not-configured" };
  await closeInterrupted(prisma);
  try {
    const run = await prisma.$transaction(async tx => {
      if (await tx.actionUpdateRun.count({ where: { status: { in: ["QUEUED", "RUNNING"] } } })) return null;
      return tx.actionUpdateRun.create({ data: { season: list.season, list, steps: initialSteps(), requestedById: coachId }, select: { ...SUMMARY, log: true } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return run ? { ok: true, run: view(run) } : { ok: false, error: "update-running" };
  } catch (error) {
    // Two requests at once: one wins, the other is told an update is under way.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") return { ok: false, error: "update-running" };
    throw error;
  }
}

/** Stops a run that is waiting or under way. The worker ends its step within seconds; what is already on the site stays. */
export async function cancelActionUpdate(runId: string): Promise<boolean> {
  return (await prisma.actionUpdateRun.updateMany({ where: { id: runId, status: { in: ["QUEUED", "RUNNING"] } },
    data: { status: "CANCELLED", finishedAt: new Date() } })).count === 1;
}
