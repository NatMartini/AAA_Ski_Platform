import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const THREAD = "01a0fec1-db67-7ec0-9e72-75a41aa21910";
export const TASK = "AAA-Ski-Chat-Hourly-Continue-01a0fec1";
const DIR = path.join(ROOT, "storage", "thread-continuation", THREAD);
const STATE = path.join(DIR, "state.json");
const CONFIG = path.join(DIR, "config.json");
const PREFIX = `[AAA_HOURLY_CONTINUE:${THREAD}]`;
const sha = value => createHash("sha256").update(value).digest("hex");
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
function write(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.renameSync(temporary, file);
}

export function userRequest(record) {
  if (record.type !== "response_item" || record.payload?.type !== "message" || record.payload.role !== "user") return null;
  let text = (record.payload.content ?? []).filter(part => part.type === "input_text").map(part => part.text).join("\n").trim();
  // Context and a real request can share one message. Remove only recognized
  // leading wrappers, never the substantive text following their closing tag.
  for (;;) {
    const stripped = text.replace(/^<(environment_context|in-app-browser-context|subagent_notification)\b[^>]*>[\s\S]*?<\/\1>\s*/i, "")
      .replace(/^# AGENTS\.md instructions[^\r\n]*\s*<INSTRUCTIONS>[\s\S]*?<\/INSTRUCTIONS>\s*/i, "").trim();
    if (stripped === text) break;
    text = stripped;
  }
  text = text.replace(/^## My request:\s*/i, "").trim();
  if (!text || text.startsWith(PREFIX) || /^<(?:environment_context|in-app-browser-context|subagent_notification)\b/i.test(text)
    || text.startsWith("# AGENTS.md instructions")) return null;
  return { hash: sha(String(record.timestamp) + "\n" + text), at: record.timestamp };
}

/** A repeated activation must not undo completion or a manual scheduler stop. */
export function activationNeeded(state, snapshot) {
  if (!snapshot.request) throw new Error("No substantive user request found");
  return state.requestHash !== snapshot.request.hash;
}

function completionMatches(state, snapshot, expected) {
  return /^[a-f0-9]{64}$/.test(expected ?? "") && state.requestHash === expected && snapshot.request?.hash === expected;
}

/** Run under the state lock; injected I/O permits race tests without a scheduler. */
export async function completeCurrentRequest({ expected, evidence, inspect, load, save, toggleTask, now = () => new Date().toISOString() }) {
  const state = load();
  if (!completionMatches(state, await inspect(), expected)) throw new Error("A new request arrived, or the completion request identity is missing");
  const completed = { ...state, status: "complete", evidence: [evidence], completedAt: now() };
  save(completed);
  // The state lock serializes our own activate/complete/status writers. The
  // transcript has an independent writer, so check immediately before AND
  // after disabling, repairing the task if real user input arrived in between.
  let snapshot = await inspect();
  if (!completionMatches(load(), snapshot, expected)) {
    save({ ...state, status: "active", evidence: [], completionRejectedAt: now() });
    throw new Error("Completion rejected because a new request arrived");
  }
  try { toggleTask(false); }
  catch (error) { save({ ...state, completionRejectedAt: now() }); throw error; }
  snapshot = await inspect();
  if (!completionMatches(load(), snapshot, expected)) {
    // Retain the old request hash: the newly arrived request must still pass
    // through normal explicit activation rather than inheriting completion.
    save({ ...state, status: "active", evidence: [], completionRejectedAt: now() });
    toggleTask(true);
    throw new Error("Completion rejected; new user work kept the hourly task active");
  }
}

async function withStateLock(work) {
  fs.mkdirSync(DIR, { recursive: true });
  const lock = path.join(DIR, "state.lock");
  let handle;
  for (let attempt = 0; attempt < 30; attempt++) {
    try { handle = fs.openSync(lock, "wx"); break; }
    catch (error) {
      if (error.code !== "EEXIST") throw error;
      let owner;
      try { owner = read(lock); process.kill(owner.pid, 0); }
      catch (checkError) {
        if (checkError.code === "ESRCH" && owner?.threadId === THREAD) {
          fs.unlinkSync(lock); continue;
        }
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  if (handle === undefined) throw new Error("Continuation state is busy; no scheduler changes made");
  try {
    fs.writeFileSync(handle, JSON.stringify({ pid: process.pid, threadId: THREAD }));
    return await work();
  } finally { fs.closeSync(handle); fs.unlinkSync(lock); }
}

export async function inspectSession(file) {
  let request = null, limits = null;
  // Read-only transcript access: never open auth files or alter Codex storage.
  const lines = readline.createInterface({ input: fs.createReadStream(file, "utf8"), crlfDelay: Infinity });
  for await (const line of lines) {
    if (!/"(?:user|token_count)"/.test(line)) continue;
    try {
      const record = JSON.parse(line);
      request = userRequest(record) ?? request;
      if (record.type === "event_msg" && record.payload?.type === "token_count" && record.payload.rate_limits) limits = record.payload.rate_limits;
    } catch { /* A live writer may not have finished its last line yet. */ }
  }
  return { request, limits, modifiedAt: fs.statSync(file).mtimeMs };
}

export function decision(state, snapshot, now = Date.now()) {
  if (!snapshot.request) return "no-user-request";
  if (state.status === "complete" && state.requestHash === snapshot.request.hash && state.evidence?.length) return "complete";
  if (now - snapshot.modifiedAt < 10 * 60_000) return "chat-busy";
  const windows = [snapshot.limits?.primary, snapshot.limits?.secondary].filter(Boolean);
  if (windows.some(window => window.used_percent >= 100 && Number(window.resets_at) * 1000 > now)) return "quota-wait";
  return "continue";
}

function taskControl(enabled) {
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
    `$task = Get-ScheduledTask -TaskName $env:AAA_CONTINUE_TASK_NAME -TaskPath '\\' -ErrorAction Stop; ` +
    `$expectedArgs = '-NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy RemoteSigned -File "' + $env:AAA_CONTINUE_RUNNER + '"'; ` +
    `$actualUser = (New-Object Security.Principal.NTAccount($task.Principal.UserId)).Translate([Security.Principal.SecurityIdentifier]).Value; ` +
    `$currentUser = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value; ` +
    `if ($task.Actions.Count -ne 1 -or $task.Actions[0].Execute -ne $env:AAA_CONTINUE_POWERSHELL -or $task.Actions[0].Arguments -ne $expectedArgs -or $task.Actions[0].WorkingDirectory -ne $env:AAA_CONTINUE_WORKSPACE -or $actualUser -ne $currentUser) { throw 'Scheduled task ownership mismatch' }; ` +
    (typeof enabled === "boolean" ? `${enabled ? "Enable" : "Disable"}-ScheduledTask -TaskName $env:AAA_CONTINUE_TASK_NAME -TaskPath '\\' -ErrorAction Stop | Out-Null`
      : `[bool]$task.Settings.Enabled | ConvertTo-Json -Compress`)],
  { windowsHide: true, encoding: "utf8", env: { ...process.env, AAA_CONTINUE_TASK_NAME: TASK,
    AAA_CONTINUE_RUNNER: path.join(ROOT, "scripts", "hourly-continue.ps1"), AAA_CONTINUE_WORKSPACE: ROOT,
    AAA_CONTINUE_POWERSHELL: path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe") } });
  if (result.status !== 0) throw new Error("Could not update the hourly scheduled task; inspect Windows Task Scheduler.");
  return typeof enabled === "boolean" ? enabled : JSON.parse(result.stdout.trim());
}
const toggle = enabled => taskControl(enabled);

export function continuationOutcome(exitCode, logText) {
  return exitCode === 0 ? "continuation-finished" : /already has an active writer|thread-store conflict/.test(logText)
    ? "writer-busy" : /usage limit|rate.limit|quota|try again at/i.test(logText) ? "quota-wait" : "continuation-failed";
}
function logTail(file, budget = 256 * 1024) {
  const handle = fs.openSync(file, "r");
  try {
    const size = fs.fstatSync(handle).size, length = Math.min(size, budget);
    const bytes = Buffer.alloc(length);
    fs.readSync(handle, bytes, 0, length, size - length);
    return bytes.toString("utf8");
  } finally { fs.closeSync(handle); }
}
async function status(outcome, extra = {}) {
  await withStateLock(async () => {
    const state = fs.existsSync(STATE) ? read(STATE) : {};
    write(STATE, { ...state, lastCheckAt: new Date().toISOString(), lastOutcome: outcome, ...extra });
  });
  console.log(JSON.stringify({ outcome, task: TASK, thread: THREAD }));
}

async function main(args) {
  const config = read(CONFIG);
  if (config.threadId !== THREAD || path.resolve(config.workspace) !== ROOT || path.basename(config.codexExe).toLowerCase() !== "codex.exe"
    || !path.basename(config.sessionFile).includes(THREAD)) throw new Error("Continuation identity mismatch");
  const snapshot = await inspectSession(config.sessionFile);
  const state = fs.existsSync(STATE) ? read(STATE) : {};
  if (args.includes("--activate")) {
    const activated = await withStateLock(async () => {
      const latest = await inspectSession(config.sessionFile);
      const current = fs.existsSync(STATE) ? read(STATE) : {};
      if (!activationNeeded(current, latest)) return false;
      toggle(true);
      write(STATE, { ...current, status: "active", requestHash: latest.request.hash, requestAt: latest.request.at,
        evidence: [], activatedAt: new Date().toISOString() });
      return true;
    });
    return status(activated ? "armed" : "activation-unchanged");
  }
  if (args.includes("--complete")) {
    const expected = args[args.indexOf("--expected-request") + 1];
    const evidenceArg = args.indexOf("--evidence");
    if (evidenceArg < 0) throw new Error("Completion requires a reviewable evidence document");
    const evidence = path.resolve(ROOT, args[evidenceArg + 1] ?? "");
    if (!evidence.startsWith(ROOT + path.sep) || !fs.statSync(evidence).isFile()) throw new Error("Evidence must be a workspace document");
    await withStateLock(() => completeCurrentRequest({ expected, evidence: path.relative(ROOT, evidence),
      inspect: () => inspectSession(config.sessionFile), load: () => read(STATE), save: value => write(STATE, value), toggleTask: toggle }));
    return status("complete-disabled");
  }
  const outcome = decision(state, snapshot);
  if (args.includes("--check")) {
    console.log(JSON.stringify({ task: TASK, thread: THREAD, outcome, requestHash: snapshot.request?.hash, state: state.status,
      schedulerEnabled: taskControl(), willInvokeModel: false }));
    return;
  }
  if (!args.includes("--run")) throw new Error("Use --check, --run, --activate or --complete");
  if (!taskControl()) return status("scheduler-disabled");
  if (outcome === "complete") {
    await withStateLock(() => completeCurrentRequest({ expected: snapshot.request.hash, evidence: state.evidence[0],
      inspect: () => inspectSession(config.sessionFile), load: () => read(STATE), save: value => write(STATE, value), toggleTask: toggle }));
    return status("complete-disabled");
  }
  if (outcome !== "continue") return status(outcome);
  const lock = path.join(DIR, "runner.lock");
  let handle;
  try { handle = fs.openSync(lock, "wx"); }
  catch (error) {
    if (error.code !== "EEXIST") throw error;
    let owner;
    try { owner = read(lock); process.kill(owner.pid, 0); }
    catch (checkError) {
      if (checkError.code !== "ESRCH" || owner?.threadId !== THREAD) return status("lock-needs-review");
      fs.unlinkSync(lock);
      handle = fs.openSync(lock, "wx");
    }
    if (handle === undefined) return status("runner-busy");
  }
  fs.writeFileSync(handle, JSON.stringify({ pid: process.pid, threadId: THREAD, at: new Date().toISOString() }));
  try {
    const prepared = await withStateLock(async () => {
      const latest = await inspectSession(config.sessionFile);
      const current = fs.existsSync(STATE) ? read(STATE) : {};
      const next = decision(current, latest);
      if (next !== "continue") return { outcome: next };
      write(STATE, { ...current, status: "active", requestHash: latest.request.hash, requestAt: latest.request.at,
        lastCheckAt: new Date().toISOString(), lastOutcome: "running" });
      return { outcome: next, latest };
    });
    if (prepared.outcome !== "continue") return status(prepared.outcome);
    const latest = prepared.latest;
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const log = path.join(DIR, "logs", stamp + ".jsonl");
    fs.mkdirSync(path.dirname(log), { recursive: true });
    const output = fs.openSync(log, "a", 0o600);
    const prompt = `${PREFIX}\n这是用户授权的每小时续作检查。继续本会话最新尚未完成的任务，先读取 docs/CURRENT_TASK.md 与实际文件/运行状态，保留用户的新约束。当前用户请求标识 ${latest.request.hash}。\n若任务正在其他进程执行，不并发修改；额度尚未恢复则保持未完成、等待下一小时，不绕过限制、不循环重试。继续必要实现和验证，不凭健康检查或模拟结果宣称真实分析通过。不要给用户发送例行无变化状态，只有实质进展、完成、失败或需要用户操作时才说明。\n所有已授权任务真正完成后，先写清验收证据，再执行 node scripts/hourly-continue.mjs --complete --expected-request ${latest.request.hash} --evidence docs/IMPLEMENTATION_STATUS.md 停用该任务；如果有新用户请求导致标识不匹配则继续处理新任务。未完成时更新 docs/CURRENT_TASK.md，不能把一次CLI正常退出当作项目完成。\n`;
    let exitCode;
    try {
      const child = spawn(config.codexExe, ["exec", "--approve-for-me", "--add-dir", "J:\\Freeski\\FreeSkiclaude",
        "--add-dir", "J:\\Freeski\\deployments", "--add-dir", "J:\\Model_ctrl", "--color", "never", "--json",
        "--output-last-message", path.join(DIR, "logs", stamp + "-final.md"), "resume", THREAD, "-"],
      { cwd: ROOT, windowsHide: true, stdio: ["pipe", output, output] });
      // A rejected busy writer may exit before consuming stdin. Its normal
      // nonzero exit/receipt must still be recorded rather than crashing Node.
      child.stdin.on("error", () => {});
      child.stdin.end(prompt, "utf8");
      exitCode = await new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", code => resolve(code)); });
    } finally { fs.closeSync(output); }
    // Successful CLI exit is a completed wakeup, never proof the task is done.
    const result = continuationOutcome(exitCode, logTail(log));
    write(path.join(DIR, "logs", stamp + ".receipt.json"), { outcome: result, exitCode, threadId: THREAD, at: new Date().toISOString(), requestHash: latest.request.hash });
    await status(result);
    // Completion owns scheduler changes through its guarded transaction. Never
    // disable from a stale child-exit snapshot or interpret exit 0 as success.
  } finally { fs.closeSync(handle); fs.unlinkSync(lock); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
