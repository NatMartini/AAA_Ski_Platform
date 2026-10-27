import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { activationNeeded, completeCurrentRequest, continuationOutcome, decision, userRequest, THREAD } from "./hourly-continue.mjs";
const now = Date.now();
const snapshot = { request: { hash: "new" }, modifiedAt: now - 3600_000, limits: null };
test("completion requires current request identity and evidence; a newer task reopens work", () => {
  assert.equal(decision({ status: "complete", requestHash: "new", evidence: ["report"] }, snapshot, now), "complete");
  assert.equal(decision({ status: "complete", requestHash: "old", evidence: ["report"] }, snapshot, now), "continue");
  assert.equal(decision({ status: "complete", requestHash: "new", evidence: [] }, snapshot, now), "continue");
});
test("recent activity and exhausted quota defer without a model call", () => {
  assert.equal(decision({}, { ...snapshot, modifiedAt: now }, now), "chat-busy");
  for (const name of ["primary", "secondary"]) assert.equal(decision({}, { ...snapshot, limits: { [name]: { used_percent: 100, resets_at: now / 1000 + 3600 } } }, now), "quota-wait");
  assert.equal(decision({}, { ...snapshot, limits: { primary: { used_percent: 100, resets_at: now / 1000 - 1 } } }, now), "continue");
});
test("scheduler prompts and ambient context do not count as new user work", () => {
  const record = message => ({ type: "response_item", timestamp: "test", payload: { type: "message", role: "user", content: [{ type: "input_text", text: message }] } });
  assert.equal(userRequest(record(`[AAA_HOURLY_CONTINUE:${THREAD}]\ncontinue`)), null);
  assert.equal(userRequest(record("<environment_context>test</environment_context>")), null);
  assert.equal(userRequest(record("# AGENTS.md instructions for project")), null);
  assert.match(userRequest(record("继续当前任务")).hash, /^[a-f0-9]{64}$/);
});

const record = text => ({ type: "response_item", timestamp: "2026-10-23T12:00:00Z", payload: {
  type: "message", role: "user", content: [{ type: "input_text", text }] } });
test("recognized ambient wrappers preserve a real request in the same message", () => {
  const request = "继续当前任务";
  const expected = userRequest(record(request));
  for (const wrapper of [
    '<environment_context><cwd>J:/AAA_Ski_platform</cwd></environment_context>\n',
    '<in-app-browser-context source="ambient-ui-state">test</in-app-browser-context>\n',
    '# AGENTS.md instructions for project\n<INSTRUCTIONS>test</INSTRUCTIONS>\n',
    '<subagent_notification agent="test">done</subagent_notification>\n',
  ]) {
    assert.deepEqual(userRequest(record(wrapper + '## My request:\n' + request)), expected);
    assert.equal(userRequest(record(wrapper)), null);
    assert.equal(userRequest(record(wrapper + `[AAA_HOURLY_CONTINUE:${THREAD}]\ncontinue`)), null);
  }
});

test("activation is only needed for initialization or a genuinely new request", () => {
  assert.equal(activationNeeded({}, snapshot), true);
  assert.equal(activationNeeded({ status: "active", requestHash: "old" }, snapshot), true);
  for (const status of ["active", "complete", "disabled"]) {
    assert.equal(activationNeeded({ status, requestHash: "new" }, snapshot), false);
  }
  assert.throws(() => activationNeeded({}, { request: null }), /No substantive/);
});

function completionHarness(requests, failDisable = false) {
  const expected = "a".repeat(64);
  let state = { status: "active", requestHash: expected, evidence: [] }, checks = 0;
  const toggles = [];
  const options = { expected, evidence: "docs/IMPLEMENTATION_STATUS.md",
    inspect: async () => ({ request: { hash: requests[Math.min(checks++, requests.length - 1)] } }),
    load: () => structuredClone(state), save: next => { state = structuredClone(next); },
    toggleTask: enabled => { if (failDisable && !enabled) throw new Error("scheduler unavailable"); toggles.push(enabled); },
    now: () => "test-time" };
  return { expected, options, toggles, state: () => state };
}
test("completion disables only the same request after evidence is persisted", async () => {
  const h = completionHarness(["a".repeat(64)]);
  await completeCurrentRequest(h.options);
  assert.deepEqual(h.toggles, [false]);
  assert.deepEqual(h.state().evidence, ["docs/IMPLEMENTATION_STATUS.md"]);
  assert.equal(h.state().status, "complete");
});
test("a newer request before completion cannot disable or overwrite the active state", async () => {
  const h = completionHarness(["b".repeat(64)]);
  await assert.rejects(completeCurrentRequest(h.options), /new request arrived/);
  assert.deepEqual(h.toggles, []);
  assert.equal(h.state().status, "active");
});
test("a request arriving after evidence is saved rejects completion before disabling", async () => {
  const h = completionHarness(["a".repeat(64), "b".repeat(64)]);
  await assert.rejects(completeCurrentRequest(h.options), /new request arrived/);
  assert.deepEqual(h.toggles, []);
  assert.equal(h.state().status, "active");
  assert.deepEqual(h.state().evidence, []);
});
test("a request arriving during scheduler disable restores active continuation", async () => {
  const h = completionHarness(["a".repeat(64), "a".repeat(64), "b".repeat(64)]);
  await assert.rejects(completeCurrentRequest(h.options), /new user work/);
  assert.deepEqual(h.toggles, [false, true]);
  assert.equal(h.state().status, "active");
  assert.equal(activationNeeded(h.state(), { request: { hash: "b".repeat(64) } }), true);
});
test("scheduler failure does not leave a falsely completed state", async () => {
  const h = completionHarness(["a".repeat(64)], true);
  await assert.rejects(completeCurrentRequest(h.options), /scheduler unavailable/);
  assert.equal(h.state().status, "active");
  assert.deepEqual(h.toggles, []);
});
test("CLI success is a wakeup outcome, never project completion; busy and quota errors back off", () => {
  assert.equal(continuationOutcome(0, ""), "continuation-finished");
  assert.equal(continuationOutcome(1, "already has an active writer"), "writer-busy");
  assert.equal(continuationOutcome(1, "thread-store conflict"), "writer-busy");
  assert.equal(continuationOutcome(1, "Usage limit reached; try again at 18:00"), "quota-wait");
  assert.equal(continuationOutcome(1, "unexpected error"), "continuation-failed");
});

for (const mismatch of ["owner", "action"]) test(`installer rejects foreign task ${mismatch} without mutation`, { skip: process.platform !== "win32" }, () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  // Stub only scheduler metadata, in a separate PowerShell process. Every
  // mutating cmdlet is a trap; no real task is enabled, disabled or registered.
  const script = `
    $ErrorActionPreference = 'Stop'
    function Get-ScheduledTask {
      [CmdletBinding()] param($TaskName, $TaskPath)
      $runner = Join-Path $env:AAA_CONTINUE_TEST_ROOT 'scripts\\hourly-continue.ps1'
      $arguments = '-NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy RemoteSigned -File "' + $runner + '"'
      [pscustomobject]@{
        Principal=[pscustomobject]@{UserId=$(if ($env:AAA_CONTINUE_TEST_MISMATCH -eq 'owner') { 'SYSTEM' } else { [Security.Principal.WindowsIdentity]::GetCurrent().Name })}
        Actions=@([pscustomobject]@{
          Execute=$(if ($env:AAA_CONTINUE_TEST_MISMATCH -eq 'action') { 'unrelated.exe' } else { "$env:SystemRoot\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" })
          Arguments=$arguments; WorkingDirectory=$env:AAA_CONTINUE_TEST_ROOT
        })
        Settings=[pscustomobject]@{Enabled=$false}
      }
    }
    function New-Item { throw 'MUTATION ATTEMPTED' }
    function Register-ScheduledTask { throw 'MUTATION ATTEMPTED' }
    function Enable-ScheduledTask { throw 'MUTATION ATTEMPTED' }
    function Disable-ScheduledTask { throw 'MUTATION ATTEMPTED' }
    try {
      & (Join-Path $env:AAA_CONTINUE_TEST_ROOT 'scripts\\install-hourly-continue.ps1') -CheckOnly
      throw 'Foreign task was accepted'
    } catch {
      if ($_.Exception.Message -ne 'An existing task has a different owner or action. It was left unchanged.') { throw }
      Write-Output 'foreign-task-rejected-without-mutation'
    }
  `;
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    windowsHide: true, encoding: "utf8", env: { ...process.env, CODEX_THREAD_ID: THREAD,
      AAA_CONTINUE_TEST_ROOT: root, AAA_CONTINUE_TEST_MISMATCH: mismatch },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /foreign-task-rejected-without-mutation/);
});
