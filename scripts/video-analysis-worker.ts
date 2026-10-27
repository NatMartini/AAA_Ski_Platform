import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { isFreeSkiConfigured } from "../src/lib/freeski/config";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const controller = new AbortController();

async function main() {
  for (const file of [path.join(ROOT, ".env.local"), path.join(ROOT, ".env")]) if (existsSync(file)) process.loadEnvFile(file);
  const args = process.argv.slice(2);
  if (args.some((arg) => !["--stop", "--once"].includes(arg) && !arg.startsWith("--owner-token=") && !arg.startsWith("--job="))) throw new Error("Unknown analysis worker option");
  const ownerArg = args.find((arg) => arg.startsWith("--owner-token="));
  const ownerToken = ownerArg?.slice("--owner-token=".length);
  if (ownerArg && (!ownerToken || !/^[a-f0-9]{32}$/.test(ownerToken))) throw new Error("Invalid worker owner token");
  const stopFile = path.join(ROOT, "tmp", ownerToken ? `video-analysis-worker.${ownerToken}.stop` : "video-analysis-worker.stop");
  if (args.includes("--stop")) {
    mkdirSync(path.dirname(stopFile), { recursive: true });
    writeFileSync(stopFile, "stop\n");
    console.log("Requested dispatcher stop; reservations stay queued and broker analysis remains durable");
    return;
  }
  if (!isFreeSkiConfigured()) throw new Error("Dedicated FreeSki service configuration is missing");
  const once = args.includes("--once");
  const jobArg = args.find((arg) => arg.startsWith("--job="));
  const jobId = jobArg?.slice("--job=".length);
  if (jobArg && (!jobId || !/^[A-Za-z0-9_-]{1,100}$/.test(jobId))) throw new Error("Invalid job identifier");
  // Environment must be loaded before Prisma and storage capture their configuration.
  const { createBusinessAnalysisDispatcher } = await import("../src/lib/freeski/dispatcher");
  const { prisma } = await import("../src/lib/prisma");
  const dispatcher = await createBusinessAnalysisDispatcher(jobId);
  // A managed worker's unique marker may already contain a stop requested during imports.
  if (!ownerToken) rmSync(stopFile, { force: true });
  process.once("SIGINT", () => controller.abort());
  process.once("SIGTERM", () => controller.abort());
  const monitor = (async () => {
    while (!controller.signal.aborted) {
      if (existsSync(stopFile)) { controller.abort(); break; }
      try { await delay(500, undefined, { signal: controller.signal }); } catch { break; }
    }
  })();
  console.log("Analysis dispatcher ready; all durable jobs queued through ModelCtrl, no resident model");
  try {
    do {
      if (controller.signal.aborted) break;
      try {
        const result = await dispatcher.tick(controller.signal);
        if (result.settled) console.log(`Analysis dispatcher settled ${result.settled} verified result(s)`);
        if (jobId && result.observed === 0) break;
      } catch {
        // Transient DB/runtime failures keep reservations for a later sweep.
        // Never dump credentials, provider responses or private file paths.
      }
      if (!once) {
        try { await delay(2_000, undefined, { signal: controller.signal }); } catch { break; }
      }
      if (once) break;
    } while (!controller.signal.aborted);
  } finally {
    controller.abort();
    await monitor;
    await dispatcher.close();
    await prisma.$disconnect();
  }
  console.log("Analysis worker stopped safely");
}

main().catch(() => {
  // Never dump an upstream response, credential or database URL into process logs.
  console.error("Analysis worker stopped after an operational error; stale reservations recover automatically");
  process.exitCode = 1;
});
