import type { Prisma, PrismaClient } from "@prisma/client";
import type { RunnerStore } from "./runner";
import { isPublished, readSteps, STALE_MS } from "./steps";

type Runs = Pick<PrismaClient, "actionUpdateRun">;
const json = (value: unknown) => value as Prisma.InputJsonValue;

/**
 * A run whose worker stopped writing is over, and says so instead of looking busy for ever. What it had already put on
 * the site stays there, so such a run counts as done with the rest left out.
 */
export async function closeInterrupted(db: Runs, now = new Date()): Promise<void> {
  const lost = await db.actionUpdateRun.findMany({ where: { status: "RUNNING", OR: [{ heartbeatAt: null }, { heartbeatAt: { lt: new Date(now.getTime() - STALE_MS) } }] },
    select: { id: true, steps: true } });
  for (const run of lost) await db.actionUpdateRun.updateMany({ where: { id: run.id, status: "RUNNING" },
    data: { status: isPublished(readSteps(run.steps)) ? "SUCCEEDED" : "FAILED", error: "interrupted", finishedAt: now } });
}

/**
 * The runs table as the worker uses it. A run is the worker's while its status is RUNNING: cancelling changes the
 * status, and the worker finds out on its next write.
 */
export function prismaRunnerStore(db: Runs): RunnerStore {
  return {
    async claim(now) {
      await closeInterrupted(db, now);
      if (await db.actionUpdateRun.count({ where: { status: "RUNNING" } })) return null;
      const next = await db.actionUpdateRun.findFirst({ where: { status: "QUEUED" }, orderBy: { createdAt: "asc" }, select: { id: true, list: true } });
      if (!next) return null;
      const taken = await db.actionUpdateRun.updateMany({ where: { id: next.id, status: "QUEUED" }, data: { status: "RUNNING", startedAt: now, heartbeatAt: now } });
      return taken.count === 1 ? next : null;
    },
    async save(id, { steps, log, heartbeatAt }) {
      return (await db.actionUpdateRun.updateMany({ where: { id, status: "RUNNING" }, data: { steps: json(steps), log, heartbeatAt } })).count === 1;
    },
    async finish(id, { steps, log, status, error, finishedAt }) {
      await db.actionUpdateRun.updateMany({ where: { id, status: "RUNNING" }, data: { status, error, steps: json(steps), log, finishedAt } });
    },
    async record(id, { steps, log }) {
      await db.actionUpdateRun.updateMany({ where: { id, status: "CANCELLED" }, data: { steps: json(steps), log } });
    },
  };
}
