#!/usr/bin/env node
/**
 * One-click launcher for local testing.
 *
 *   npm run launch      (or double-click start.bat on Windows)
 *
 * Gets the whole stack running with no manual steps:
 *   1. Turns on the development sign-in bypass, so no Google OAuth is needed.
 *   2. Finds a working Postgres — an already-running one (native or a container)
 *      is used as-is; otherwise the bundled container is started. Falls back to
 *      a native install on 5432 if Docker will not come up.
 *   3. Applies migrations and seeds resorts + a demo coach/student.
 *   4. Starts the dev server and opens the browser at the sign-in page.
 *
 * It is deliberately chatty: every step prints a ✓ or an explanation, so when
 * something is off it is obvious which step and why.
 */
import { spawn, spawnSync } from "node:child_process";
import net from "node:net";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = path.resolve(import.meta.dirname, "..");
const ENV_FILE = path.join(ROOT, ".env.local");
const IS_WIN = process.platform === "win32";

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

/** Reads a KEY="value" / KEY=value line, unquoted. */
function envValue(text, key) {
  const m = text.match(new RegExp(`^${key}=(.*)$`, "m"));
  if (!m) return undefined;
  return m[1].trim().replace(/^["']|["']$/g, "");
}

/** Sets or replaces a key in .env.local, adding it if absent. */
function setEnv(key, value) {
  let text = readEnv();
  const line = `${key}=${value}`;
  if (new RegExp(`^${key}=.*$`, "m").test(text)) {
    text = text.replace(new RegExp(`^${key}=.*$`, "m"), line);
  } else {
    text = text.replace(/\s*$/, "") + `\n${line}\n`;
  }
  writeFileSync(ENV_FILE, text);
}

// ── database resolution ────────────────────────────────────────────

function parseDbUrl(url) {
  // postgresql://user:pass@host:port/db?params
  const u = new URL(url);
  return {
    url,
    user: decodeURIComponent(u.username) || "postgres",
    password: decodeURIComponent(u.password) || "",
    host: u.hostname || "127.0.0.1",
    port: Number(u.port || 5432),
    database: u.pathname.replace(/^\//, "") || "postgres",
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
    `SELECT 1 FROM pg_database WHERE datname='${db.database}'`,
  ]);
  if (exists.status !== 0) {
    warn(`could not query the server: ${(exists.stderr || "").trim()}`);
    return false;
  }
  if (exists.stdout.trim() !== "1") {
    const created = run(["-d", "postgres", "-c", `CREATE DATABASE "${db.database}"`]);
    if (created.status !== 0) {
      warn(`could not create database: ${(created.stderr || "").trim()}`);
      return false;
    }
    ok(`created database "${db.database}"`);
  }
  run(["-d", db.database, "-c", "CREATE EXTENSION IF NOT EXISTS btree_gist"]);
  return true;
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
        `${process.env.ProgramFiles}\\Docker\\Docker\\Docker Desktop.exe`,
        `${process.env.LOCALAPPDATA}\\Docker\\Docker Desktop.exe`,
      ].find((p) => p && existsSync(p));
      if (exe) spawnSync("cmd", ["/c", "start", "", exe]);
      else warn("could not find Docker Desktop.exe — start it manually");
    } else {
      spawnSync("open", ["-a", "Docker"]);
    }
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
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
    if (await portOpen(db.host, db.port)) return true;
    await sleep(1500);
  }
  return false;
}

/**
 * Returns a reachable, provisioned DATABASE_URL, updating .env.local if the
 * chosen database differs from the configured one.
 */
async function resolveDatabase(configuredUrl) {
  const configured = parseDbUrl(configuredUrl);

  // 1. Already reachable on the configured port — the common case.
  if (await portOpen(configured.host, configured.port)) {
    ok(`Postgres is already up on ${configured.host}:${configured.port}`);
    return configuredUrl;
  }
  info(`nothing is listening on ${configured.host}:${configured.port} yet`);

  // 2. A native install on the standard port, if that is not what we tried.
  if (configured.port !== 5432 && (await portOpen(configured.host, 5432))) {
    const nativeUrl = withPort(configuredUrl, 5432);
    const nativeDb = parseDbUrl(nativeUrl);
    info("found a Postgres on the default port 5432 — using it");
    provisionNative(nativeDb);
    if (await portOpen(nativeDb.host, 5432)) {
      setEnv("DATABASE_URL", `"${nativeUrl}"`);
      ok("using native Postgres on 5432 (updated .env.local)");
      return nativeUrl;
    }
  }

  // 3. Bring up the bundled container.
  if (existsSync(path.join(ROOT, "docker-compose.yml"))) {
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
    if (provisionNative(nativeDb) && (await portOpen(nativeDb.host, 5432))) {
      setEnv("DATABASE_URL", `"${nativeUrl}"`);
      ok("provisioned native Postgres on 5432 (updated .env.local)");
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

  heading("Development sign-in bypass");
  const envText = readEnv();
  if (envValue(envText, "DEV_AUTH_BYPASS") === "1") {
    ok("already on — no account login needed");
  } else {
    setEnv("DEV_AUTH_BYPASS", "1");
    ok("turned on — you can pick an account on the sign-in page");
  }

  const secret = envValue(readEnv(), "AUTH_SECRET");
  if (!secret || secret.startsWith("replace-me")) {
    // dev:demo needs a real secret to mint its cookies; also good hygiene.
    const rnd = (await import("node:crypto")).randomBytes(32).toString("base64");
    setEnv("AUTH_SECRET", `"${rnd}"`);
    ok("generated an AUTH_SECRET");
  }

  heading("Database");
  const configuredUrl = envValue(readEnv(), "DATABASE_URL");
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
  ok("resorts, demo coach (Kevin), student (Wei Zhang) and availability ready");

  heading("Dev server");
  console.log(c.dim("    starting Next.js — this window stays open; Ctrl+C to stop\n"));

  const dev = npmInvocation(["run", "dev"]); // see npmInvocation for the why
  const child = spawn(dev.cmd, dev.args, {
    cwd: ROOT,
    env: process.env,
    stdio: ["inherit", "pipe", "inherit"],
  });

  let opened = false;
  child.stdout.on("data", (buf) => {
    const text = buf.toString();
    process.stdout.write(text);
    const m = text.match(/https?:\/\/localhost:(\d+)/);
    if (m && !opened) {
      opened = true;
      const base = `http://localhost:${m[1]}`;
      setTimeout(() => {
        console.log(
          `\n${c.green("▶")}  ${c.bold("Ready.")} Opening ${c.cyan(`${base}/zh`)}\n` +
            `    ${c.dim("Not signed in — click 登录 and pick Kevin (coach) or Wei Zhang (student).")}\n`,
        );
        openBrowser(`${base}/zh`);
      }, 800);
    }
  });

  const shutdown = () => {
    if (!child.killed) child.kill();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  child.on("exit", (code) => process.exit(code ?? 0));
}

main().catch((err) => die(err instanceof Error ? err.message : String(err)));
