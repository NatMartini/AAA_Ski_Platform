#!/usr/bin/env node
/** Replace only an idle, launcher-owned dispatcher, preserving all reservations. */
import { spawn, spawnSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { PrismaClient } from "@prisma/client";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(root, ".next", "launcher.json");
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const processes = () => {
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
    "Get-CimInstance Win32_Process | Where-Object {$_.Name -eq 'node.exe'} | Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Json -Compress"],
  { encoding: "utf8", windowsHide: true });
  if (result.status !== 0) throw new Error("Cannot verify current dispatcher identity");
  const parsed = JSON.parse(result.stdout);
  return Array.isArray(parsed) ? parsed : [parsed];
};

async function main() {
  if (process.platform !== "win32") throw new Error("This controlled restart requires the Windows launcher");
  for (const file of [".env.local", ".env"]) {
    const absolute = path.join(root, file);
    if (existsSync(absolute)) process.loadEnvFile(absolute);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const owner = manifest.worker;
  const expectedScript = path.join(root, "scripts", "video-analysis-worker.ts");
  if (path.resolve(manifest.root) !== root || !/^[a-f0-9]{32}$/.test(owner?.ownerToken ?? "") ||
      path.resolve(owner.script) !== expectedScript ||
      path.resolve(owner.stopFile) !== path.join(root, "tmp", `video-analysis-worker.${owner.ownerToken}.stop`))
    throw new Error("Launcher ownership does not match this workspace");
  const current = processes();
  const existing = current.find((row) => row.ProcessId === owner.pid);
  if (!existing?.CommandLine?.includes(owner.script) || !existing.CommandLine.includes(owner.ownerToken))
    throw new Error("Current dispatcher process does not match the launcher owner");
  const childIds = current.filter((row) => row.ParentProcessId === owner.pid).map((row) => row.ProcessId);
  const prisma = new PrismaClient();
  try {
    const assertIdle = async () => {
      const [booking, account] = await Promise.all([
        prisma.videoAnalysisJob.count({ where: { status: { in: ["QUEUED", "RUNNING"] } } }),
        prisma.accountAnalysisJob.count({ where: { status: { in: ["QUEUED", "RUNNING"] } } }),
      ]);
      if (booking || account) throw new Error("Active customer reservations detected; restart deferred");
    };
    await assertIdle();
    console.log("Verified idle booking/account queues and launcher-owned dispatcher");
    mkdirSync(path.dirname(owner.stopFile), { recursive: true });
    writeFileSync(owner.stopFile, "stop\n");
    const deadline = Date.now() + 20_000;
    while ([owner.pid, ...childIds].some(alive) && Date.now() < deadline) await delay(200);
    if ([owner.pid, ...childIds].some(alive)) throw new Error("Original dispatcher has not exited; no processes were killed");
    await assertIdle();
    const latest = JSON.parse(readFileSync(manifestPath, "utf8"));
    if (latest.serverToken !== manifest.serverToken || latest.worker?.pid !== owner.pid)
      throw new Error("Launcher ownership changed during restart");
    // The old process has consumed its marker. Reuse the same owner/path so
    // the existing launcher's shutdown closure controls the replacement too.
    rmSync(owner.stopFile, { force: true });
    const logRoot = path.join(root, "storage", "freeski");
    mkdirSync(logRoot, { recursive: true });
    const stdout = openSync(path.join(logRoot, "analysis-dispatcher.stdout.log"), "a");
    const stderr = openSync(path.join(logRoot, "analysis-dispatcher.stderr.log"), "a");
    const replacement = spawn(owner.node, [owner.tsxCli, owner.script, `--owner-token=${owner.ownerToken}`],
      { cwd: root, env: process.env, detached: true, windowsHide: true, stdio: ["ignore", stdout, stderr] });
    closeSync(stdout); closeSync(stderr);
    await new Promise((resolve, reject) => { replacement.once("spawn", resolve); replacement.once("error", reject); });
    latest.worker.pid = replacement.pid;
    const stagedManifest = `${manifestPath}.dispatcher-restart.tmp`;
    writeFileSync(stagedManifest, JSON.stringify(latest));
    renameSync(stagedManifest, manifestPath);
    replacement.unref();
    await delay(1_000);
    if (!alive(replacement.pid)) throw new Error("Replacement dispatcher exited; durable jobs remain queued");
    console.log(`Dispatcher replaced safely: old PID ${owner.pid}, new PID ${replacement.pid}; Next/API unchanged`);
  } finally { await prisma.$disconnect(); }
}

main().catch((error) => {
  // Include only our fixed operational messages, never Prisma/config details.
  const safe = ["Active customer reservations detected; restart deferred", "Original dispatcher has not exited; no processes were killed",
    "Launcher ownership changed during restart", "Replacement dispatcher exited; durable jobs remain queued"];
  console.error(safe.includes(error?.message) ? error.message : "Controlled dispatcher restart failed; inspect ownership/configuration locally");
  process.exitCode = 1;
});
