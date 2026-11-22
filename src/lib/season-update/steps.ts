/**
 * "Update the actions": what a run does, in order, and how it reports. Shared by the worker that runs it and the page
 * that shows it, so nothing here touches the server.
 */
export const UPDATE_STEPS = ["materials", "references", "sampling", "generation", "checks", "publish", "recognizer"] as const;
export type UpdateStepKey = (typeof UPDATE_STEPS)[number];
export type StepStatus = "pending" | "running" | "done" | "skipped" | "failed";
export type Note = { zh: string; en: string };
export type UpdateStep = { key: UpdateStepKey; status: StepStatus; note: Note | null; progress: number | null; startedAt: string | null; finishedAt: string | null };
export const RUN_STATUSES = ["QUEUED", "RUNNING", "SUCCEEDED", "FAILED", "CANCELLED"] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];
export const isActive = (status: string) => status === "QUEUED" || status === "RUNNING";
/** A running update whose worker has not written for this long has lost it. */
export const STALE_MS = 90_000;

export const STEP_INFO: Record<UpdateStepKey, { zh: string; en: string; gistZh: string; gistEn: string }> = {
  materials: { zh: "核对材料", en: "Check the material", gistZh: "看指南和示范视频齐不齐", gistEn: "Whether the guides and demonstration videos are there" },
  references: { zh: "解析示范视频", en: "Analyse the demonstrations", gistZh: "提取新示范视频里的动作（要用显卡）", gistEn: "Reads the movement in new demonstration videos (uses the GPU)" },
  sampling: { zh: "采样示范弯", en: "Sample the demonstration turns", gistZh: "从每个动作的示范里取出标准的一个弯", gistEn: "Takes the typical turn out of each action's demonstrations" },
  generation: { zh: "生成标准动作", en: "Generate the standards", gistZh: "按指南和采样生成每个动作的 3D 示范，再用评分核对", gistEn: "Builds each action's 3D standard from the guide and the samples, then scores it" },
  checks: { zh: "检查结果", en: "Check the results", gistZh: "每个动作都生成了、能打开、分数正常才发布", gistEn: "Publishes only when every action was made, opens and scores normally" },
  publish: { zh: "发布", en: "Publish", gistZh: "换上新的标准动作和动作列表", gistEn: "Puts the new standards and the list on the site" },
  recognizer: { zh: "更新 FreeSki 评分", en: "Update FreeSki's scoring", gistZh: "FreeSki 收录新的标准动作，按它重建评分标准和自动识别", gistEn: "FreeSki takes the new standards and rebuilds its scoring and action recognition from them" },
};

export const initialSteps = (): UpdateStep[] => UPDATE_STEPS.map(key => ({ key, status: "pending", note: null, progress: null, startedAt: null, finishedAt: null }));

const text = (value: unknown) => typeof value === "string" ? value.slice(0, 600) : null;
/** Steps as stored, read leniently: a record written by other code never breaks the page. */
export function readSteps(raw: unknown): UpdateStep[] {
  const stored = Array.isArray(raw) ? raw as Record<string, unknown>[] : [];
  return UPDATE_STEPS.map(key => {
    const found = stored.find(step => step && typeof step === "object" && step.key === key) ?? {};
    const note = found.note && typeof found.note === "object" ? found.note as Record<string, unknown> : null;
    const zh = text(note?.zh), en = text(note?.en);
    return { key, status: (["pending", "running", "done", "skipped", "failed"] as const).find(status => status === found.status) ?? "pending",
      note: zh && en ? { zh, en } : null,
      progress: typeof found.progress === "number" && Number.isFinite(found.progress) ? Math.min(1, Math.max(0, found.progress)) : null,
      startedAt: text(found.startedAt), finishedAt: text(found.finishedAt) };
  });
}

/** True once the new standards and list are on the site, whatever happened afterwards. */
export const isPublished = (steps: readonly UpdateStep[]) => steps.some(step => step.key === "publish" && step.status === "done");

export type RunView = {
  id: string; season: string; status: RunStatus; steps: UpdateStep[]; log: string[]; error: string | null; actions: number;
  requestedBy: string | null; createdAt: string; startedAt: string | null; finishedAt: string | null;
};
export type RunSummary = Omit<RunView, "log">;
