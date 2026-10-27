#!/usr/bin/env node
/**
 * One-click launcher for local testing.
 *
 *   npm run launch      (or double-click start.bat on Windows)
 *
 * Gets the whole local stack running:
 *   1. Turns on the development sign-in bypass, so no Google OAuth is needed.
 *   2. Finds a working Postgres — an already-running one (native or a container)
 *      is SQL-verified and used as-is; otherwise the bundled container is
 *      started. A provisioned local native fallback is session-only.
 *   3. Applies migrations and seeds resorts + a demo coach/student.
 *   4. Starts the dev server and opens the browser at the sign-in page.
 *
 * It is deliberately chatty: every step prints a ✓ or an explanation, so when
 * something is off it is obvious which step and why.
 */
import { spawn, spawnSync } from "node:child_process";
import net from "node:net";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { randomBytes } from "node:crypto";
import { networkInterfaces } from "node:os";
import { startFreeSkiRuntime } from "./freeski-runtime.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const ENV_FILE = path.join(ROOT, ".env.local");
const IS_WIN = process.platform === "win32";
const SERVER_FILE = path.join(ROOT, ".next", "launcher.json");
const WORKER_SCRIPT = path.join(ROOT, "scripts", "video-analysis-worker.ts");
const TSX_CLI = path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

let step = 0;
function heading(msg) {
  step += 1;
  console.log(`\n${c.cyan(`[${step}]`)} ${c.bold(msg)}`);
}
const ok = (msg) => console.log(`    ${c.green("✓")} ${msg}`);
const info = (msg) => console.log(`    ${c.dim(msg)}`);
const warn = (msg) => console.log(`    ${c.yellow("!")} ${msg}`);
function die(msg) {
  console.error(`\n${c.red("✗")} ${msg}\n`);
  process.exit(1);
}

// ── .env.local helpers ─────────────────────────────────────────────

function readEnv() {
  if (!existsSync(ENV_FILE)) {
    // Bootstrap from the example so a fresh checkout still launches.
    const example = path.join(ROOT, ".env.example");
    if (existsSync(example)) {
      writeFileSync(ENV_FILE, readFileSync(example, "utf8"));
      warn(".env.local was missing — created it from .env.example");
    } else {
      die(".env.local is missing and there is no .env.example to copy.");
    }
  }
  return readFileSync(ENV_FILE, "utf8");
}

/** Load the same files as Prisma, preserving variables supplied by the caller. */
function loadEnv() {
  readEnv();
  for (const file of [ENV_FILE, path.join(ROOT, ".env")]) {
    if (existsSync(file)) process.loadEnvFile(file);
  }
}

// ── database resolution ────────────────────────────────────────────

function parseDbUrl(url) {
  // postgresql://user:pass@host:port/db?params
  const u = new URL(url);
  if (!["postgres:", "postgresql:"].includes(u.protocol)) {
    die("DATABASE_URL must use the postgres or postgresql scheme.");
  }
  return {
    url,
    user: decodeURIComponent(u.username) || "postgres",
    password: decodeURIComponent(u.password) || "",
    host: u.hostname.replace(/^\[|\]$/g, "") || "127.0.0.1",
    port: Number(u.port || 5432),
    database: decodeURIComponent(u.pathname.replace(/^\//, "")) || "postgres",
  };
}

function withPort(url, port) {
  const u = new URL(url);
  u.port = String(port);
  return u.toString();
}

/** True if something accepts a TCP connection on the port within `timeout`ms. */
function portOpen(host, port, timeout = 800) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(v);
    };
    socket.setTimeout(timeout);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
    socket.connect(port, host);
  });
}

function findPsql() {
  const onPath = spawnSync(IS_WIN ? "where" : "which", ["psql"], {
    encoding: "utf8",
  });
  if (onPath.status === 0) {
    return onPath.stdout.split(/\r?\n/)[0].trim();
  }
  if (IS_WIN) {
    for (const v of ["18", "17", "16", "15"]) {
      const p = `C:\\Program Files\\PostgreSQL\\${v}\\bin\\psql.exe`;
      if (existsSync(p)) return p;
    }
  }
  return null;
}

/** Ensures the database and the btree_gist extension exist on a native install. */
function provisionNative(db) {
  const psql = findPsql();
  if (!psql) {
    warn("psql not found — cannot auto-create the database on the native server");
    return false;
  }
  const env = { ...process.env, PGPASSWORD: db.password };
  const run = (args) =>
    spawnSync(psql, ["-U", db.user, "-h", db.host, "-p", String(db.port), ...args], {
      env,
      encoding: "utf8",
    });

  const exists = run([
    "-d",
    "postgres",
    "-tAc",
    `SELECT 1 FROM pg_database WHERE datname='${db.database.replaceAll("'", "''")}'`,
  ]);
  if (exists.status !== 0) {
    warn(`could not query the server: ${(exists.stderr || "").trim()}`);
    return false;
  }
  if (exists.stdout.trim() !== "1") {
    const created = run([
      "-d", "postgres", "-c",
      `CREATE DATABASE "${db.database.replaceAll('"', '""')}"`,
    ]);
    if (created.status !== 0) {
      warn(`could not create database: ${(created.stderr || "").trim()}`);
      return false;
    }
    ok(`created database "${db.database}"`);
  }
  const extension = run([
    "-d", db.database, "-c", "CREATE EXTENSION IF NOT EXISTS btree_gist",
  ]);
  if (extension.status !== 0) {
    warn("could not provision btree_gist on the native server");
    return false;
  }
  return true;
}

/** Confirm SQL authentication, not merely that an unrelated process owns a port. */
async function databaseReady(url) {
  const { PrismaClient } = await import("@prisma/client");
  const client = new PrismaClient({ datasourceUrl: url });
  try {
    await client.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  } finally {
    await client.$disconnect();
  }
}

function dockerReady() {
  const r = spawnSync("docker", ["info"], { encoding: "utf8", timeout: 15000 });
  return r.status === 0;
}

async function startDockerPostgres(db) {
  if (!dockerReady()) {
    info("Docker is not running — trying to start Docker Desktop…");
    if (IS_WIN) {
      const exe = [
        process.env.ProgramFiles && path.join(process.env.ProgramFiles, "Docker", "Docker", "Docker Desktop.exe"),
        process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Docker", "Docker Desktop.exe"),
      ].find((candidate) => candidate && existsSync(candidate));
      if (!exe) {
        warn("Docker Desktop was not found — start it manually or use native PostgreSQL");
        return false;
      }
      const desktop = spawn(exe, [], {
        detached: true, stdio: "ignore", windowsHide: true,
      });
      desktop.on("error", () => warn("Docker Desktop could not start; open it manually"));
      desktop.unref();
    } else if (process.platform === "darwin") {
      spawnSync("open", ["-a", "Docker"]);
    } else {
      warn("Start the Docker engine before using the bundled database");
      return false;
    }
    const engineDeadline = Date.now() + 120_000;
    while (Date.now() < engineDeadline) {
      await sleep(3000);
      if (dockerReady()) break;
    }
    if (!dockerReady()) return false;
    ok("Docker engine is up");
  }

  const up = spawnSync("docker", ["compose", "up", "-d", "postgres"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  if (up.status !== 0) {
    warn(`docker compose failed: ${(up.stderr || "").trim().split("\n").pop()}`);
    return false;
  }
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if ((await portOpen(db.host, db.port)) && (await databaseReady(db.url))) {
      return true;
    }
    await sleep(1500);
  }
  return false;
}

/**
 * Returns a database that accepts authenticated SQL. Any local fallback only
 * affects this launcher session; the configured .env.local is preserved.
 */
async function resolveDatabase(configuredUrl) {
  const configured = parseDbUrl(configuredUrl);

  // 1. Already reachable on the configured port — the common case.
  if (await portOpen(configured.host, configured.port)) {
    if (await databaseReady(configuredUrl)) {
      ok(`Postgres SQL connection verified on ${configured.host}:${configured.port}`);
      return configuredUrl;
    }
    die(
      "The configured database port is open, but SQL authentication failed.\n" +
      "    Check DATABASE_URL and the PostgreSQL account/database; no fallback was used.",
    );
  }
  info(`nothing is listening on ${configured.host}:${configured.port} yet`);

  if (!["localhost", "127.0.0.1", "[::1]", "::1"].includes(configured.host)) {
    die("The configured remote database is unavailable. Start it or fix DATABASE_URL.");
  }

  // 2. A native install on the standard port, if that is not what we tried.
  if (configured.port !== 5432 && (await portOpen(configured.host, 5432))) {
    const nativeUrl = withPort(configuredUrl, 5432);
    const nativeDb = parseDbUrl(nativeUrl);
    info("found a Postgres on the default port 5432 — using it");
    if (provisionNative(nativeDb) && (await databaseReady(nativeUrl))) {
      ok("using authenticated native Postgres on 5432 for this session");
      return nativeUrl;
    }
  }

  // 3. Bring up the bundled container.
  if (
    configured.port === 5434 &&
    configured.database === "ski" &&
    existsSync(path.join(ROOT, "docker-compose.yml"))
  ) {
    info("starting the bundled Postgres container…");
    if (await startDockerPostgres(configured)) {
      ok(`container Postgres is up on ${configured.host}:${configured.port}`);
      return configuredUrl;
    }
  }

  // 4. Last resort: a native server we can provision.
  if (findPsql()) {
    const nativeUrl = withPort(configuredUrl, 5432);
    const nativeDb = parseDbUrl(nativeUrl);
    if (provisionNative(nativeDb) && (await databaseReady(nativeUrl))) {
      ok("provisioned authenticated native Postgres on 5432 for this session");
      return nativeUrl;
    }
  }

  die(
    "Could not reach or start a Postgres database.\n" +
      "    Start Docker Desktop and re-run, or install/start PostgreSQL on 5432.",
  );
}

// ── shell helpers ──────────────────────────────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * How to invoke npm on this platform.
 *
 * On Windows npm is npm.cmd, and since Node 22.12 / 24 the runtime refuses to
 * spawn a `.cmd` directly. Going through `cmd /c npm …` sidesteps that without
 * the shell:true option, which would otherwise print a deprecation warning on
 * every launch.
 */
function npmInvocation(args) {
  return IS_WIN
    ? { cmd: "cmd.exe", args: ["/c", "npm", ...args] }
    : { cmd: "npm", args };
}

/**
 * Runs an npm script to completion. Dies on failure.
 *
 * `quiet` captures the script's own output and only shows it if the step fails,
 * so routine seed chatter does not clutter the launcher window.
 */
function runNpm(scriptArgs, label, { quiet = false } = {}) {
  const { cmd, args } = npmInvocation(scriptArgs);
  const r = spawnSync(cmd, args, {
    cwd: ROOT,
    stdio: quiet ? ["ignore", "pipe", "pipe"] : "inherit",
    env: process.env,
    encoding: quiet ? "utf8" : undefined,
    windowsHide: true,
  });
  if (r.error) die(`${label} could not start: ${r.error.message}`);
  if (r.status !== 0) {
    if (quiet) process.stderr.write((r.stdout ?? "") + (r.stderr ?? ""));
    die(`${label} failed (exit ${r.status}).`);
  }
}

function openBrowser(url) {
  try {
    if (IS_WIN) spawnSync("cmd", ["/c", "start", "", url], { shell: false });
    else if (process.platform === "darwin") spawnSync("open", [url]);
    else spawnSync("xdg-open", [url]);
  } catch {
    // Non-fatal; the URL is printed anyway.
  }
}

// ── main ───────────────────────────────────────────────────────────

async function main() {
  console.log(c.bold("\n🎿  AAA Ski Platform — launcher\n"));

  if (process.env.NODE_ENV === "production") {
    die("The demo launcher is development-only. Use npm run start for production.");
  }
  if (typeof process.loadEnvFile !== "function") {
    die("The launcher requires Node.js 20.12 or newer.");
  }
  if (existsSync(SERVER_FILE)) {
    let recorded;
    try {
      recorded = JSON.parse(readFileSync(SERVER_FILE, "utf8"));
    } catch {
      die("Cannot read .next/launcher.json. Check the recorded server before retrying.");
    }
    if (recorded.root !== ROOT || !Number.isInteger(recorded.pid) || recorded.pid <= 0) {
      die("The recorded launcher state is invalid; check .next/launcher.json before retrying.");
    }
    try {
      process.kill(recorded.pid, 0);
      die("A recorded test server is still running. Use stop.bat before starting another.");
    } catch (err) {
      if (err.code !== "ESRCH") {
        die("Cannot verify the recorded server process. Check it before retrying.");
      }
      if (recorded.worker) {
        if (!IS_WIN) die("A prior worker is recorded. Stop it before replacing the launcher state.");
        const stopped = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", path.join(ROOT, "scripts", "stop-dev.ps1"), "-WorkerOnly"], { windowsHide: true, stdio: "inherit" });
        if (stopped.status !== 0) die("Could not safely stop the recorded previous analysis worker; its state was preserved.");
      }
      rmSync(SERVER_FILE, { force: true });
    }
  }
  loadEnv();
  if (process.env.NODE_ENV === "production") {
    die("The demo launcher is development-only. Remove NODE_ENV=production from local demo configuration.");
  }

  const requestedPort = Number(process.env.PORT ?? 3000);
  if (!Number.isInteger(requestedPort) || requestedPort < 1 || requestedPort > 65535) {
    die("PORT must be an integer from 1 to 65535.");
  }
  const host = process.env.SKI_LAUNCH_HOST ?? "127.0.0.1";
  const lan = host !== "127.0.0.1";
  if (lan) {
    const parts = host.split(".").map(Number);
    const privateAddress = net.isIP(host) === 4 && (parts[0] === 10 ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
      (parts[0] === 192 && parts[1] === 168));
    const assigned = Object.values(networkInterfaces()).flat().some((entry) => entry?.address === host && !entry.internal);
    if (!privateAddress || !assigned) die("SKI_LAUNCH_HOST must be 127.0.0.1 or this computer's assigned private LAN IPv4 address.");
    if (process.env.DEV_LAN_TEST_PASSWORD !== undefined && process.env.DEV_LAN_TEST_PASSWORD.length < 12) {
      die("DEV_LAN_TEST_PASSWORD must contain at least 12 characters.");
    }
    process.env.DEV_LAN_TEST_PASSWORD ??= randomBytes(12).toString("base64url");
  }
  let port = requestedPort;
  while (await portOpen(host, port)) {
    if (process.env.PORT || port >= requestedPort + 10) {
      die(`Port ${port} is already in use. Set PORT to an unused port.`);
    }
    port += 1;
  }
  const base = `http://${lan ? host : "localhost"}:${port}`;
  process.env.AUTH_URL = base;
  process.env.NEXT_PUBLIC_BASE_URL = base;

  heading("Development sign-in bypass");
  process.env.DEV_AUTH_BYPASS = "1";
  ok("enabled for this session — pick an account on the sign-in page");
  if (lan) {
    heading("LAN test access");
    info(`address: ${base}/zh; username: ski; password: ${process.env.DEV_LAN_TEST_PASSWORD}`);
    const accessFile = path.join(ROOT, "storage", "lan-test-access.json");
    mkdirSync(path.dirname(accessFile), { recursive: true });
    writeFileSync(accessFile, JSON.stringify({ base, username: "ski", password: process.env.DEV_LAN_TEST_PASSWORD,
      createdAt: new Date().toISOString() }, null, 2), { mode: 0o600 });
  }

  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.startsWith("replace-me")) {
    // Only this demo session needs the generated secret.
    const rnd = (await import("node:crypto")).randomBytes(32).toString("base64");
    process.env.AUTH_SECRET = rnd;
    ok("generated a session AUTH_SECRET without changing .env.local");
  }

  // Generate before loading Prisma: on Windows the loaded engine DLL cannot
  // be replaced, even after a SQL probe disconnects the client.
  heading("Prisma client");
  runNpm(["run", "prisma:ensure"], "Prisma client preparation", { quiet: true });
  ok("generated client matches the schema");

  heading("Database");
  const configuredUrl = process.env.DATABASE_URL;
  if (!configuredUrl) die("DATABASE_URL is not set in .env.local");
  const dbUrl = await resolveDatabase(configuredUrl);
  // Make sure the child processes below see the resolved URL even if we just
  // rewrote it, without relying on them re-reading the file.
  process.env.DATABASE_URL = dbUrl;

  heading("Migrations");
  runNpm(["run", "db:deploy"], "prisma migrate deploy");
  ok("schema up to date");

  heading("Seed data");
  runNpm(["run", "db:seed"], "resort seed", { quiet: true });
  runNpm(["run", "dev:demo"], "demo coach/student seed", { quiet: true });
  ok("resorts, demo coaches (Kevin/Alisa), student (Wei Zhang) and availability ready");

  heading("FreeSki analysis service");
  let analysisReady = false;
  if (process.env.FREESKI_DEPLOYMENT_PROFILE || (process.env.FREESKI_ROOT && process.env.FREESKI_PYTHON)) {
    try {
      await startFreeSkiRuntime();
      // The helper provisions missing secrets directly in this process before child env is copied.
      // Re-read missing local settings; preserve session auth/DB overrides and caller configuration.
      loadEnv();
      analysisReady = true;
      ok("isolated AAA FreeSki service verified; original FreeSki data remains separate");
    } catch {
      warn("FreeSki bridge is unavailable. See storage/freeski/runtime.stderr.log; course testing can continue.");
    }
  } else if (process.env.FREESKI_BASE_URL && process.env.FREESKI_DEPLOYMENT_ID) {
    // Externally managed provider (started and stopped by FreeSki/ModelCtrl): check it, never start or stop it.
    // The dispatcher runs either way and keeps analyses queued while the provider is down.
    analysisReady = true;
    try {
      const response = await fetch(new URL("/health", process.env.FREESKI_BASE_URL), { redirect: "error", signal: AbortSignal.timeout(3_000) });
      const health = response.ok ? await response.json() : null;
      if (health?.isolated === true && health.deploymentId === process.env.FREESKI_DEPLOYMENT_ID) ok(`external FreeSki provider ${health.deploymentId} is reachable`);
      else warn("The FreeSki provider answered with a different identity; analyses stay queued until it matches.");
    } catch {
      info("The external FreeSki provider is not running now; queued analyses wait until it starts.");
    }
  } else {
    info("FreeSki is not configured; use node scripts/freeski-runtime.mjs start to provision this machine");
  }

  let worker;
  let workerState;
  const startWorker = () => {
    if (!analysisReady || process.env.SKI_LAUNCH_WORKER === "0") return;
    const ownerToken = randomBytes(16).toString("hex");
    const stopFile = path.join(ROOT, "tmp", `video-analysis-worker.${ownerToken}.stop`);
    mkdirSync(path.dirname(stopFile), { recursive: true });
    worker = spawn(process.execPath, [TSX_CLI, WORKER_SCRIPT, `--owner-token=${ownerToken}`], {
      cwd: ROOT, env: process.env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
    });
    worker.stdout.on("data", (buf) => process.stdout.write(`    ${buf.toString()}`));
    worker.stderr.on("data", (buf) => process.stderr.write(`    ${buf.toString()}`));
    worker.on("error", () => warn("Analysis worker could not start; course testing can continue."));
    if (worker.pid) {
      workerState = { pid: worker.pid, script: WORKER_SCRIPT, tsxCli: TSX_CLI, node: process.execPath, ownerToken, stopFile };
    }
  };
  if (process.env.SKI_LAUNCH_WORKER === "0") info("analysis worker skipped for this launcher session");

  heading("Dev server");
  console.log(c.dim("    starting Next.js — this window stays open; Ctrl+C to stop\n"));

  const nextCli = path.join(ROOT, "node_modules", "next", "dist", "bin", "next");
  const serverToken = randomBytes(16).toString("hex");
  const child = spawn(process.execPath, [
    `--title=aaa-ski-test-server-${serverToken}`,
    nextCli, "dev", ROOT, "--hostname", host, "--port", String(port),
  ], {
    cwd: ROOT,
    env: process.env,
    stdio: ["inherit", "pipe", "inherit"],
    windowsHide: true,
  });
  if (!child.pid) die("Next.js could not start.");
  startWorker();
  mkdirSync(path.dirname(SERVER_FILE), { recursive: true });
  writeFileSync(SERVER_FILE, JSON.stringify({ pid: child.pid, root: ROOT, nextCli, node: process.execPath, base, host, lan, serverToken, worker: workerState }));

  let opened = false;
  let outputTail = "";
  child.stdout.on("data", (buf) => {
    const text = buf.toString();
    process.stdout.write(text);
    outputTail = (outputTail + text.replace(/\x1b\[[0-9;]*m/g, "")).slice(-4000);
    if (/Ready in/.test(outputTail) && !opened) {
      opened = true;
      void (async () => {
        const response = await fetch(`${base}/zh/sign-in`, {
          signal: AbortSignal.timeout(120_000),
          headers: lan ? { Authorization: `Basic ${Buffer.from(`ski:${process.env.DEV_LAN_TEST_PASSWORD}`).toString("base64")}` } : {},
        });
        if (!response.ok) {
          warn(`The sign-in page returned HTTP ${response.status}; check the server output.`);
          return;
        }
        console.log(
          `\n${c.green("▶")}  ${c.bold("Ready.")} Opening ${c.cyan(`${base}/zh`)}\n` +
            `    ${c.dim("Click 登录 and pick Kevin/Alisa (coach) or Wei Zhang/Alex Chen/Sam Li (student).")}\n`,
        );
        if (process.env.SKI_LAUNCH_OPEN_BROWSER !== "0") openBrowser(`${base}/zh`);
      })().catch(() => warn(`Could not verify sign-in readiness. Check ${base}/zh/sign-in.`));
    }
  });

  let shutdownPromise;
  const shutdown = (code = 0, stopNext = true) => {
    if (shutdownPromise) return shutdownPromise;
    shutdownPromise = (async () => {
      if (workerState && worker) {
        writeFileSync(workerState.stopFile, "stop\n");
        const deadline = Date.now() + 10_000;
        while (worker.exitCode === null && worker.signalCode === null && Date.now() < deadline) await sleep(100);
        if (worker.exitCode === null && worker.signalCode === null) {
          // Verification and final process-tree cleanup are centralized in the project's stop script.
          if (IS_WIN) spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", path.join(ROOT, "scripts", "stop-dev.ps1"), "-WorkerOnly"], { windowsHide: true, stdio: "ignore" });
          else worker.kill("SIGTERM");
        }
      }
      if (stopNext && child.exitCode === null && child.signalCode === null) {
        if (IS_WIN) spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", path.join(ROOT, "scripts", "stop-dev.ps1")], { windowsHide: true, stdio: "ignore" });
        else child.kill("SIGTERM");
      }
      try {
        const current = JSON.parse(readFileSync(SERVER_FILE, "utf8"));
        if (current.serverToken === serverToken) rmSync(SERVER_FILE, { force: true });
      } catch { /* State may already have been removed by stop.bat. */ }
      process.exit(code);
    })();
    return shutdownPromise;
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
  child.on("error", (err) => {
    warn(`Next.js could not start: ${err.message}`);
    void shutdown(1, false);
  });
  child.on("exit", (code) => {
    void shutdown(code ?? 0, false);
  });
}

main().catch((err) => die(err instanceof Error ? err.message : String(err)));
