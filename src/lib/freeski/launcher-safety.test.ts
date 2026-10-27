import { afterEach, describe, expect, it } from "vitest";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

const fixtures: string[] = [];
afterEach(async () => {
  for (const directory of fixtures.splice(0)) await rm(directory, { recursive: true, force: true });
});

/** Executes the real stop script against a copied project and fake OS process calls. */
async function stopFixture(scenario: string, workerOnly = false) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "aaa-stop-fixture-"));
  fixtures.push(directory);
  await mkdir(path.join(directory, "scripts"));
  await mkdir(path.join(directory, ".next"));
  await copyFile(path.resolve("scripts/stop-dev.ps1"), path.join(directory, "scripts", "stop-dev.ps1"));
  const token = "a".repeat(32);
  const workerToken = "b".repeat(32);
  const state = { pid: 1001, root: directory, nextCli: path.join(directory, "node_modules", "next", "dist", "bin", "next"), node: process.execPath,
    serverToken: token, worker: { pid: 1002, script: path.join(directory, "scripts", "video-analysis-worker.ts"),
      tsxCli: path.join(directory, "node_modules", "tsx", "dist", "cli.mjs"), node: process.execPath, ownerToken: workerToken,
      stopFile: path.join(directory, "tmp", `video-analysis-worker.${workerToken}.stop`) } };
  if (scenario === "bad-stop-path") state.worker.stopFile = path.join(directory, "outside.stop");
  await writeFile(path.join(directory, ".next", "launcher.json"), JSON.stringify(state));
  const harness = `
$global:fixtureState = Get-Content -LiteralPath (Join-Path $PSScriptRoot '.next/launcher.json') -Raw | ConvertFrom-Json
$global:scenario = $env:AAA_STOP_TEST_SCENARIO
function Get-CimInstance {
  param($ClassName, $Filter)
  $number = [int]([regex]::Match($Filter, '\\d+').Value)
  if ($number -eq 1001) {
    if ($global:scenario -eq 'orphan') { return $null }
    $cmd = "node $($global:fixtureState.nextCli) dev $PSScriptRoot --title=aaa-ski-test-server-$($global:fixtureState.serverToken)"
    if ($global:scenario -eq 'bad-server') { $cmd = 'node unrelated-app.js' }
    if ($global:scenario -eq 'recycled-token') { $cmd = "node $($global:fixtureState.nextCli) dev $PSScriptRoot --title=aaa-ski-test-server-cccccccccccccccccccccccccccccccc" }
    return [pscustomobject]@{Name='node.exe';ExecutablePath=$global:fixtureState.node;CommandLine=$cmd}
  }
  if ($number -eq 1002) {
    if (Test-Path -LiteralPath $global:fixtureState.worker.stopFile) { return $null }
    $cmd = "node $($global:fixtureState.worker.tsxCli) $($global:fixtureState.worker.script) --owner-token=$($global:fixtureState.worker.ownerToken)"
    if ($global:scenario -eq 'bad-worker') { $cmd = 'node unrelated-worker.js' }
    return [pscustomobject]@{Name='node.exe';ExecutablePath=$global:fixtureState.node;CommandLine=$cmd}
  }
  throw 'The stop script queried a process outside this fixture'
}
function taskkill.exe {
  param([Parameter(ValueFromRemainingArguments=$true)][string[]]$Arguments)
  Add-Content -LiteralPath (Join-Path $PSScriptRoot 'killed.txt') -Value ($Arguments -join ' ')
  $global:LASTEXITCODE = 0
}
if ($global:scenario -eq 'cleanup-race') {
  $global:cleanupAttempts = 0
  function Remove-Item {
    [CmdletBinding()] param([string]$LiteralPath)
    if (++$global:cleanupAttempts -eq 1) { throw [System.UnauthorizedAccessException]::new('Concurrent launcher cleanup') }
    Microsoft.PowerShell.Management\\Remove-Item -LiteralPath $LiteralPath -ErrorAction Stop
  }
}
. (Join-Path $PSScriptRoot 'scripts/stop-dev.ps1') ${workerOnly ? "-WorkerOnly" : ""}
`;
  await writeFile(path.join(directory, "harness.ps1"), harness);
  const execution = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", path.join(directory, "harness.ps1")], {
    windowsHide: true, timeout: 5_000, encoding: "utf8", env: { ...process.env, AAA_STOP_TEST_SCENARIO: scenario },
  });
  const killedFile = path.join(directory, "killed.txt");
  return { execution, directory, state, killed: existsSync(killedFile) ? await readFile(killedFile, "utf8") : "",
    marker: existsSync(state.worker.stopFile), manifest: existsSync(path.join(directory, ".next", "launcher.json")) };
}

describe.skipIf(process.platform !== "win32")("Launcher process ownership and graceful stop", () => {
  it("requests graceful worker stop before stopping only the project's Next process", async () => {
    const result = await stopFixture("graceful");
    expect(result.execution.status, result.execution.stderr).toBe(0);
    expect(result.marker).toBe(true);
    expect(result.killed.trim()).toBe("/PID 1001 /T /F");
    expect(result.manifest).toBe(false);
  });
  it("also stops an orphaned worker when Next has already exited", async () => {
    const result = await stopFixture("orphan");
    expect(result.execution.status, result.execution.stderr).toBe(0);
    expect(result.marker).toBe(true);
    expect(result.killed).toBe("");
    expect(result.manifest).toBe(false);
  });
  it("does not report stop failure when the launcher concurrently removes process state", async () => {
    const result = await stopFixture("cleanup-race");
    expect(result.execution.status, result.execution.stderr).toBe(0);
    expect(result.killed.trim()).toBe("/PID 1001 /T /F");
    expect(result.manifest).toBe(false);
  });
  it.each(["bad-worker", "bad-server", "recycled-token", "bad-stop-path"])("leaves unrelated processes and files untouched for %s", async (scenario) => {
    const result = await stopFixture(scenario);
    expect(result.execution.status).not.toBe(0);
    expect(result.marker).toBe(false);
    expect(result.killed).toBe("");
    expect(result.manifest).toBe(true);
  });
  it("worker-only stop never kills Next or removes its process state", async () => {
    const result = await stopFixture("bad-server", true);
    expect(result.execution.status, result.execution.stderr).toBe(0);
    expect(result.marker).toBe(true);
    expect(result.killed).toBe("");
    expect(result.manifest).toBe(true);
  });
});
