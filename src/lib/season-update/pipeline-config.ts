import { existsSync } from "node:fs";
import path from "node:path";

/**
 * Where a season update finds its tools. The generator scripts are this repository's own (scripts/standard-motion);
 * they read FreeSki's demonstration poses and score with its code, so they run on its Python against its checkout.
 * Both are named in the server's environment only: nothing a browser sends can choose a program or a folder.
 */
export type PipelineConfig = { python: string; freeskiDir: string; scriptsDir: string; root: string; workers: number };

export function getPipelineConfig(env: Record<string, string | undefined> = process.env, root = process.cwd()): PipelineConfig | null {
  const python = env.SEASON_PIPELINE_PYTHON?.trim(), freeskiDir = env.SEASON_PIPELINE_FREESKI_DIR?.trim();
  if (!python || !freeskiDir || !path.isAbsolute(python) || !path.isAbsolute(freeskiDir)) return null;
  const scriptsDir = path.join(/* turbopackIgnore: true */ root, "scripts", "standard-motion");
  if (!existsSync(/* turbopackIgnore: true */ python) || !existsSync(/* turbopackIgnore: true */ path.join(freeskiDir, "engines", "scorecard.py"))
    || !existsSync(/* turbopackIgnore: true */ path.join(scriptsDir, "generate.py"))) return null;
  const workers = /^\d{1,2}$/.test(env.SEASON_PIPELINE_WORKERS ?? "") ? Math.min(16, Math.max(1, Number(env.SEASON_PIPELINE_WORKERS))) : 6;
  return { python, freeskiDir, scriptsDir, root, workers };
}
