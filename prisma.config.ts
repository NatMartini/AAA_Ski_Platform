import { defineConfig } from "prisma/config";

// Next.js reads .env.local; the Prisma CLI only reads .env. Rather than keep
// DATABASE_URL in two places (and inevitably let them drift), load .env.local
// here so both sides read the same file.
// process.loadEnvFile does not overwrite variables that are already set, so a
// real environment (CI, production) still wins.
for (const file of [".env.local", ".env"]) {
  try {
    process.loadEnvFile(file);
  } catch {
    // Missing file is fine — the variables may come from the environment.
  }
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    seed: "tsx prisma/seed.ts",
  },
});
