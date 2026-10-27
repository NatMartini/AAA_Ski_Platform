import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { normalizePrismaAlignment } from "./prisma-schema-identity.mjs";

const root = path.resolve(import.meta.dirname, "..");
const require = createRequire(import.meta.url);
const source = path.join(root, "prisma", "schema.prisma");
const generated = path.join(root, "node_modules", ".prisma", "client", "schema.prisma");

let sameVersion = false;
try {
  sameVersion = require("@prisma/client").Prisma.prismaVersion.client ===
    require("@prisma/client/package.json").version;
} catch {
  // A fresh checkout may not have a generated client yet.
}

// Do not replace a current engine DLL: Windows locks it while the test server
// is connected. Compare both schema and installed client version first.
if (
  sameVersion && existsSync(generated) &&
  normalizePrismaAlignment(readFileSync(source, "utf8")) ===
    normalizePrismaAlignment(readFileSync(generated, "utf8"))
) {
  process.exit(0);
}

const result = spawnSync(process.execPath, [require.resolve("prisma/build/index.js"), "generate"], {
  cwd: root,
  stdio: "inherit",
  env: process.env,
});
if (result.error || result.status !== 0) {
  console.error(
    "Prisma client generation failed. If the local test server is running, " +
    "stop it with stop.bat, run npm run prisma:ensure, then launch it again.",
  );
  process.exit(result.status || 1);
}
