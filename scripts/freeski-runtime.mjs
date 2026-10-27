#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PRIVATE_ROOT = path.join(ROOT, "storage", "freeski");
const MANIFEST = path.join(PRIVATE_ROOT, "launcher.json");
const WRAPPER = path.join(ROOT, "scripts", "freeski-runtime.py");
const ENV_FILE = path.join(ROOT, ".env.local");

function loadEnv() {
  for (const file of [ENV_FILE, path.join(ROOT, ".env")]) if (existsSync(file)) process.loadEnvFile(file);
}

/** Append only missing dedicated bridge settings. Never replace existing platform configuration. */
function provisionConfig() {
  if (process.env.FREESKI_DEPLOYMENT_PROFILE) return;
  if (!existsSync(ENV_FILE)) throw new Error("Create .env.local before provisioning the FreeSki bridge");
  const defaults = {
    FREESKI_BASE_URL: "http://127.0.0.1:8000",
    FREESKI_SERVICE_IDENTIFIER: "aaa-bridge@example.com",
    FREESKI_SERVICE_PASSWORD: randomBytes(32).toString("hex"),
    FREESKI_RUNTIME_JWT_SECRET: randomBytes(32).toString("hex"),
    FREESKI_RUNTIME_NONCE: randomBytes(32).toString("hex"),
    FREESKI_ROOT: "J:/Freeski/FreeSkiclaude",
    FREESKI_PYTHON: "D:/conda/envs/freeski/python.exe",
  };
  const lines = [];
  for (const [key, value] of Object.entries(defaults)) {
    if (process.env[key]) continue;
    // An empty existing setting should be fixed deliberately, avoiding duplicate env assignments.
    if (new RegExp(`^${key}=`, "m").test(readFileSync(ENV_FILE, "utf8"))) throw new Error(`Existing ${key} is empty; configure it before starting`);
    lines.push(`${key}=${value}`);
    process.env[key] = value;
  }
  if (lines.length) appendFileSync(ENV_FILE, `\n# Dedicated isolated AAA FreeSki bridge (private, never commit)\n${lines.join("\n")}\n`, { mode: 0o600 });
}

export function runtimeConfig() {
  const url = new URL(process.env.FREESKI_BASE_URL ?? "");
  if (url.protocol !== "http:" || !["localhost", "127.0.0.1"].includes(url.hostname) || url.pathname !== "/" || url.username || url.password || url.search || url.hash) {
    throw new Error("The local runtime helper requires a loopback HTTP FREESKI_BASE_URL");
  }
  const port = Number(url.port || "80");
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error("Invalid FreeSki port");
  let deployment = null;
  const profileFile = process.env.FREESKI_DEPLOYMENT_PROFILE;
  if (profileFile) {
    if (!path.isAbsolute(profileFile)) throw new Error("FREESKI_DEPLOYMENT_PROFILE must be absolute");
    deployment = JSON.parse(readFileSync(profileFile, "utf8"));
    if (deployment.schema_version !== 1 || deployment.profile !== "platform-integration"
      || !deployment.deployment_id || deployment.deployment_id !== process.env.FREESKI_DEPLOYMENT_ID
      || deployment.host !== "127.0.0.1" || deployment.port !== port
      || !path.isAbsolute(deployment.python ?? "") || !path.isAbsolute(deployment.command_root ?? "")) {
      throw new Error("Independent FreeSki profile does not match the pinned platform deployment");
    }
  }
  const python = path.resolve(deployment?.python ?? process.env.FREESKI_PYTHON ?? "");
  const source = deployment ? path.resolve(deployment.command_root, "..") : path.resolve(process.env.FREESKI_ROOT ?? "");
  if (!existsSync(python) || !existsSync(path.join(source, "server", "backend", "main.py"))) throw new Error("Configured FreeSki Python/source is missing");
  for (const key of deployment ? ["FREESKI_SERVICE_PASSWORD"] : ["FREESKI_SERVICE_PASSWORD", "FREESKI_RUNTIME_JWT_SECRET", "FREESKI_RUNTIME_NONCE"]) {
    if ((process.env[key] ?? "").length < 32) throw new Error(`Missing strong dedicated ${key}`);
  }
  const entrypoint = deployment ? path.join(deployment.command_root, "scripts", "run_integration.py") : WRAPPER;
  if (!existsSync(entrypoint)) throw new Error("Independent FreeSki release entrypoint is unavailable");
  if (deployment && !process.env.FREESKI_SERVICE_IDENTIFIER?.includes("@")) throw new Error("Dedicated provider service identifier is required");
  return { port, python, source, baseUrl: url.origin, entrypoint, deployment, profileFile };
}

function processAlive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

async function portOpen(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    const finish = (open) => { socket.destroy(); resolve(open); };
    socket.setTimeout(1_000, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

async function jsonRequest(baseUrl, endpoint, init = {}) {
  const response = await fetch(`${baseUrl}${endpoint}`, { ...init, redirect: "error", signal: AbortSignal.timeout(5_000) });
  if (!response.ok) return { status: response.status, data: null };
  return { status: response.status, data: await response.json() };
}

async function provisionIdentity(config) {
  const readiness = await jsonRequest(config.baseUrl, "/health");
  if (!readiness.data?.isolated || readiness.data.featureNewScorer !== false || readiness.data.identityGate !== true) {
    throw new Error("Refusing to authenticate or provision against an unrelated FreeSki service");
  }
  if (config.deployment && readiness.data.deploymentId !== config.deployment.deployment_id) {
    throw new Error("FreeSki service is a different deployment; no credentials were sent");
  }
  const password = process.env.FREESKI_SERVICE_PASSWORD;
  const identifier = process.env.FREESKI_SERVICE_IDENTIFIER;
  const login = () => jsonRequest(config.baseUrl, "/api/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ identifier, password }),
  });
  let session = await login();
  if (session.status === 401) {
    if (config.deployment) throw new Error("Provision the dedicated identity in the independent FreeSki deployment");
    const registration = await jsonRequest(config.baseUrl, "/api/auth/register", {
      method: "POST", headers: { "Content-Type": "application/json", "X-AAA-Runtime-Nonce": process.env.FREESKI_RUNTIME_NONCE },
      body: JSON.stringify({ email: identifier, username: "aaa_platform_bridge", password }),
    });
    if (registration.status >= 400) throw new Error(`Dedicated service registration failed (${registration.status})`);
    session = await login();
  }
  if (session.status !== 200 || !session.data?.access_token || session.data.user?.email !== identifier) throw new Error("Dedicated service login failed");
  const headers = { Authorization: `Bearer ${session.data.access_token}`, "Content-Type": "application/json" };
  if (!session.data.user.onboarded) {
    const onboard = await jsonRequest(config.baseUrl, "/api/profile", { method: "PUT", headers, body: JSON.stringify({ complete: true }) });
    if (onboard.status !== 200) throw new Error("Service onboarding failed");
  }
  const health = await jsonRequest(config.baseUrl, "/api/aaa/health", { headers });
  if (!health.data?.isolated || health.data.featureNewScorer !== false || health.data.identityGate !== true) throw new Error("Isolated bridge health verification failed");
}

export async function startFreeSkiRuntime() {
  loadEnv();
  provisionConfig();
  const config = runtimeConfig();
  if (existsSync(MANIFEST)) {
    const recorded = JSON.parse(readFileSync(MANIFEST, "utf8"));
    if (Number.isInteger(recorded.pid) && processAlive(recorded.pid)) {
      if (recorded.wrapper !== config.entrypoint || recorded.python !== config.python || recorded.port !== config.port
        || (config.deployment && recorded.deploymentId !== config.deployment.deployment_id)) {
        throw new Error("Runtime process manifest does not match this configured bridge");
      }
      if (process.platform === "win32") {
        const verify = "$m=Get-Content -LiteralPath $env:AAA_FREESKI_MANIFEST -Raw | ConvertFrom-Json; $p=Get-CimInstance Win32_Process -Filter ('ProcessId = '+$m.pid); $profileOk=(-not $m.profileFile) -or ($p.CommandLine -match ('(?:^|[\\s\"])[\"]?'+[regex]::Escape($m.profileFile)+'(?:[\"]|\\s|$)')); if(-not $p -or $p.ExecutablePath -ine $m.python -or -not $p.CommandLine.Contains($m.wrapper) -or -not $profileOk){exit 2}";
        const checked = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", verify], { windowsHide: true, stdio: "ignore", env: { ...process.env, AAA_FREESKI_MANIFEST: MANIFEST } });
        if (checked.status !== 0) throw new Error("Runtime PID no longer belongs to this bridge; left it untouched");
      } else if (!readFileSync(`/proc/${recorded.pid}/cmdline`, "utf8").split("\0").includes(config.entrypoint)) {
        throw new Error("Runtime PID no longer belongs to this bridge; left it untouched");
      }
      if (config.deployment && process.platform !== "win32" && !readFileSync(`/proc/${recorded.pid}/cmdline`, "utf8").split("\0").includes(config.profileFile)) throw new Error("Runtime profile does not match the configured deployment");
      await provisionIdentity(config);
      console.log(`Isolated FreeSki runtime already running on loopback:${config.port}`);
      return recorded.pid;
    }
  }
  if (await portOpen(config.port)) throw new Error("FreeSki port is already occupied; refusing to attach or modify that service");
  mkdirSync(PRIVATE_ROOT, { recursive: true });
  const stdout = openSync(path.join(PRIVATE_ROOT, "runtime.stdout.log"), "a");
  const stderr = openSync(path.join(PRIVATE_ROOT, "runtime.stderr.log"), "a");
  const args = config.deployment ? ["-I", config.entrypoint, "--profile", config.profileFile] : [WRAPPER];
  const child = spawn(config.python, args, {
    cwd: config.deployment ? config.deployment.command_root : ROOT, detached: true, windowsHide: true, stdio: ["ignore", stdout, stderr],
    env: { ...process.env, FREESKI_ROOT: config.source, AAA_FREESKI_PORT: String(config.port), PYTHONDONTWRITEBYTECODE: "1", PYTHONUNBUFFERED: "1" },
  });
  closeSync(stdout);
  closeSync(stderr);
  await new Promise((resolve, reject) => { child.once("spawn", resolve); child.once("error", () => reject(new Error("FreeSki runtime process could not start"))); });
  child.unref();
  writeFileSync(MANIFEST, JSON.stringify({ pid: child.pid, python: config.python, wrapper: config.entrypoint, port: config.port,
    deploymentId: config.deployment?.deployment_id, profileFile: config.profileFile, createdAt: new Date().toISOString() }, null, 2));
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (!processAlive(child.pid)) throw new Error("FreeSki runtime exited; inspect private runtime.stderr.log");
    try {
      const health = await jsonRequest(config.baseUrl, "/health");
      if (health.data?.ok && health.data?.isolated) {
        await provisionIdentity(config);
        console.log(`Isolated FreeSki runtime ready on loopback:${config.port}; new scorer disabled, identity gate enabled`);
        return child.pid;
      }
    } catch { /* Imports can take several seconds; retry within the startup deadline. */ }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("FreeSki runtime startup timed out; inspect private runtime.stderr.log");
}

export async function stopFreeSkiRuntime() {
  if (!existsSync(MANIFEST)) return;
  const recorded = JSON.parse(readFileSync(MANIFEST, "utf8"));
  let allowedEntrypoint = WRAPPER;
  if (recorded.profileFile) {
    const pinned = JSON.parse(readFileSync(recorded.profileFile, "utf8"));
    if (pinned.schema_version !== 1 || pinned.profile !== "platform-integration" || pinned.deployment_id !== recorded.deploymentId
      || !path.isAbsolute(pinned.command_root ?? "") || path.resolve(pinned.python ?? "") !== recorded.python) throw new Error("Independent deployment manifest changed; service left untouched");
    allowedEntrypoint = path.join(pinned.command_root, "scripts", "run_integration.py");
  }
  if (!Number.isInteger(recorded.pid) || recorded.pid <= 0 || recorded.wrapper !== allowedEntrypoint || !Number.isInteger(recorded.port) || recorded.port < 1 || recorded.port > 65535) throw new Error("Invalid runtime process manifest");
  if (processAlive(recorded.pid)) {
    if (process.platform === "win32") {
      // Verify the exact executable and wrapper before stopping: PID reuse must not kill another app.
      const script = "$m=Get-Content -LiteralPath $env:AAA_FREESKI_MANIFEST -Raw | ConvertFrom-Json; $p=Get-CimInstance Win32_Process -Filter ('ProcessId = '+$m.pid); $profileOk=(-not $m.profileFile) -or ($p.CommandLine -match ('(?:^|[\\s\"])[\"]?'+[regex]::Escape($m.profileFile)+'(?:[\"]|\\s|$)')); if($p -and $p.ExecutablePath -ieq $m.python -and $p.CommandLine.Contains($m.wrapper) -and $profileOk){Stop-Process -Id $m.pid} elseif($p){exit 2}";
      const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true, stdio: "ignore", env: { ...process.env, AAA_FREESKI_MANIFEST: MANIFEST } });
      if (result.status !== 0) throw new Error("Runtime process identity did not match; left it running");
    } else {
      const args = readFileSync(`/proc/${recorded.pid}/cmdline`, "utf8").split("\0");
      if (!args.includes(allowedEntrypoint)) throw new Error("Runtime process identity did not match; left it running");
      if (recorded.profileFile && !args.includes(recorded.profileFile)) throw new Error("Runtime profile identity did not match; left it running");
      process.kill(recorded.pid, "SIGTERM");
    }
  }
  // Windows termination can return before sockets are closed. An immediate restart must not race it.
  const deadline = Date.now() + 10_000;
  while (processAlive(recorded.pid) || await portOpen(recorded.port)) {
    if (Date.now() >= deadline) throw new Error("Owned runtime termination is pending or its port was rebound; no other service was touched");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (existsSync(MANIFEST)) {
    const current = JSON.parse(readFileSync(MANIFEST, "utf8"));
    if (current.pid === recorded.pid && current.createdAt === recorded.createdAt) rmSync(MANIFEST, { force: true });
  }
  console.log("Stopped the isolated AAA FreeSki runtime");
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  try {
    const command = process.argv[2] ?? "start";
    if (command === "start") await startFreeSkiRuntime();
    else if (command === "stop") await stopFreeSkiRuntime();
    else if (command === "status") {
      const manifest = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, "utf8")) : null;
      console.log(manifest && processAlive(manifest.pid) ? "Isolated FreeSki runtime process is running" : "Isolated FreeSki runtime is stopped");
    } else throw new Error("Usage: node scripts/freeski-runtime.mjs start|stop|status");
  } catch (error) {
    console.error(error instanceof Error ? error.message : "FreeSki runtime operation failed");
    process.exitCode = 1;
  }
}
