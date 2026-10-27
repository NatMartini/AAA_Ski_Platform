import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { runtimeConfig } from "./freeski-runtime.mjs";

const keys = ["FREESKI_BASE_URL", "FREESKI_DEPLOYMENT_PROFILE", "FREESKI_DEPLOYMENT_ID", "FREESKI_PYTHON",
  "FREESKI_ROOT", "FREESKI_SERVICE_IDENTIFIER", "FREESKI_SERVICE_PASSWORD", "FREESKI_RUNTIME_JWT_SECRET", "FREESKI_RUNTIME_NONCE"];
let previous;
let fixture;
let profile;
let manifest;
beforeEach(() => {
  previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  for (const key of keys) delete process.env[key];
  fixture = mkdtempSync(path.join(os.tmpdir(), "freeski-launcher-contract-"));
  const source = path.join(fixture, "release");
  const python = path.join(fixture, "python.exe");
  mkdirSync(path.join(source, "server", "backend"), { recursive: true });
  mkdirSync(path.join(source, "server", "scripts"), { recursive: true });
  writeFileSync(path.join(source, "server", "backend", "main.py"), "# fixture only");
  writeFileSync(path.join(source, "server", "scripts", "run_integration.py"), "# fixture only");
  writeFileSync(python, "never executed");
  manifest = path.join(fixture, "profile.json");
  profile = { schema_version: 1, profile: "platform-integration", deployment_id: "platform-test",
    host: "127.0.0.1", port: 8100, python, command_root: path.join(source, "server") };
  writeFileSync(manifest, JSON.stringify(profile));
  Object.assign(process.env, { FREESKI_BASE_URL: "http://127.0.0.1:8100", FREESKI_DEPLOYMENT_PROFILE: manifest,
    FREESKI_DEPLOYMENT_ID: "platform-test", FREESKI_SERVICE_IDENTIFIER: "service@example.com",
    FREESKI_SERVICE_PASSWORD: "a".repeat(64) });
});
afterEach(() => {
  for (const key of keys) {
    if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key];
  }
  // Retain tiny temporary fixtures; never recursively delete computed paths.
});

test("independent helper executes the provider release with pinned deployment identity", () => {
  const result = runtimeConfig();
  assert.equal(result.entrypoint, path.join(profile.command_root, "scripts", "run_integration.py"));
  assert.equal(result.python, profile.python);
  assert.equal(result.deployment.deployment_id, "platform-test");
  assert.equal(result.profileFile, manifest);
  assert.equal(result.source, path.resolve(profile.command_root, ".."));
});

test("deployment mismatch is refused before any process or provider login", () => {
  process.env.FREESKI_DEPLOYMENT_ID = "other-instance";
  assert.throws(() => runtimeConfig(), /pinned platform deployment/);
});

test("profile cannot point the helper at a different API port or native product", () => {
  writeFileSync(manifest, JSON.stringify({ ...profile, port: 8000 }));
  assert.throws(() => runtimeConfig(), /pinned platform deployment/);
  writeFileSync(manifest, JSON.stringify({ ...profile, profile: "native" }));
  assert.throws(() => runtimeConfig(), /pinned platform deployment/);
});

test("a local helper never launches for a remote provider URL", () => {
  process.env.FREESKI_BASE_URL = "https://provider.example";
  assert.throws(() => runtimeConfig(), /loopback HTTP/);
});

test("independent profile does not require exposing provider JWT or registration nonce to AAA", () => {
  delete process.env.FREESKI_RUNTIME_JWT_SECRET;
  delete process.env.FREESKI_RUNTIME_NONCE;
  assert.equal(runtimeConfig().deployment.deployment_id, "platform-test");
});

test("legacy helper remains explicit and requires its existing dedicated configuration", () => {
  delete process.env.FREESKI_DEPLOYMENT_PROFILE;
  process.env.FREESKI_PYTHON = profile.python;
  process.env.FREESKI_ROOT = path.resolve(profile.command_root, "..");
  assert.throws(() => runtimeConfig(), /FREESKI_RUNTIME_JWT_SECRET/);
  process.env.FREESKI_RUNTIME_JWT_SECRET = "b".repeat(64);
  process.env.FREESKI_RUNTIME_NONCE = "c".repeat(64);
  const result = runtimeConfig();
  assert.equal(result.deployment, null);
  assert.equal(path.basename(result.entrypoint), "freeski-runtime.py");
});
