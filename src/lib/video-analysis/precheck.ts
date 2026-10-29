/**
 * What to tell a student before a clip is uploaded. FreeSki's own evidence gate runs after
 * analysis; these checks use only what the browser can read from the file, so a clip that will
 * clearly fail (portrait, a few seconds, tiny) is caught before a credit is spent.
 */
export type VideoMeta = { durationSec: number | null; width: number | null; height: number | null; bytes: number };
export type FilmingWarning = { code: "too_short" | "too_long" | "portrait" | "low_resolution"; zh: string; en: string; blocking: boolean };

export const MIN_SECONDS = 6;
export const LONG_SECONDS = 90;
export const MIN_SHORT_SIDE = 720;

export function filmingWarnings(meta: VideoMeta): FilmingWarning[] {
  const warnings: FilmingWarning[] = [];
  if (meta.durationSec !== null && meta.durationSec < MIN_SECONDS)
    warnings.push({ code: "too_short", blocking: false, zh: `只有 ${meta.durationSec.toFixed(0)} 秒。至少要拍完整的 5–6 个弯（通常 10 秒以上），不然算不出节奏和连贯性。`,
      en: `Only ${meta.durationSec.toFixed(0)} s. Film at least 5–6 complete turns (usually 10 s or more) or rhythm and flow cannot be measured.` });
  if (meta.durationSec !== null && meta.durationSec > LONG_SECONDS)
    warnings.push({ code: "too_long", blocking: false, zh: `有 ${Math.round(meta.durationSec)} 秒。分析会慢很多，建议剪到一趟（10–30 秒）。`,
      en: `${Math.round(meta.durationSec)} s long. Analysis will be much slower; trim to one run (10–30 s).` });
  if (meta.width !== null && meta.height !== null && meta.height > meta.width)
    warnings.push({ code: "portrait", blocking: false, zh: "竖屏拍摄。横屏能把整个弯都拍进去，人也更大。", en: "Portrait video. Landscape keeps the whole turn in frame with a bigger skier." });
  if (meta.width !== null && meta.height !== null && Math.min(meta.width, meta.height) < MIN_SHORT_SIDE)
    warnings.push({ code: "low_resolution", blocking: false, zh: `分辨率 ${meta.width}×${meta.height} 偏低，远处的人可能识别不出骨架。`,
      en: `${meta.width}×${meta.height} is low; a distant skier may not be recognised.` });
  return warnings;
}

/** The four rules that make the biggest difference to the analysis. */
export const FILMING_GUIDE: { zh: string; en: string }[] = [
  { zh: "从滑雪者正后方或正前方拍，不要从侧面。", en: "Film from directly behind or in front of the skier, not from the side." },
  { zh: "手机横屏，整趟拍进去，至少 5–6 个弯。", en: "Phone in landscape; the whole run, at least 5–6 turns." },
  { zh: "人至少占画面高度的五分之一，画面里不要有其他人。", en: "The skier should fill at least a fifth of the frame height, with nobody else in shot." },
  { zh: "尽量端稳或用三脚架；跟拍时转动镜头，不要走动。", en: "Hold steady or use a tripod; when following, pivot the camera rather than walking." },
];

/** Duration and size of a video file, read in the browser; nulls when it cannot be read in time. */
export function readVideoMetadata(file: File, timeoutMs = 8000): Promise<VideoMeta> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    let settled = false;
    const finish = (meta: Omit<VideoMeta, "bytes">) => {
      if (settled) return;
      settled = true;
      URL.revokeObjectURL(url);
      video.removeAttribute("src");
      resolve({ ...meta, bytes: file.size });
    };
    const timer = window.setTimeout(() => finish({ durationSec: null, width: null, height: null }), timeoutMs);
    video.preload = "metadata";
    video.muted = true;
    video.onloadedmetadata = () => { window.clearTimeout(timer); finish({ durationSec: Number.isFinite(video.duration) ? video.duration : null,
      width: video.videoWidth || null, height: video.videoHeight || null }); };
    video.onerror = () => { window.clearTimeout(timer); finish({ durationSec: null, width: null, height: null }); };
    video.src = url;
  });
}
