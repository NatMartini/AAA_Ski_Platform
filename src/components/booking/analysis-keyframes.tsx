"use client";

import { useEffect, useState } from "react";
import { keyframesSchema, type Keyframes } from "@/lib/freeski/scorecard";
import { clientFetch } from "@/lib/client-fetch";
import { referenceNote, type ReferenceTarget } from "./analysis-scorecard";

/** Rendered still frames for one turn; silently absent when the provider has none. */
export function AnalysisKeyframes({ base, turnId, zh, target = null }: { base: string; turnId: string; zh: boolean; target?: ReferenceTarget | null }) {
  const [manifest, setManifest] = useState<Keyframes | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>, attempts = 0;
    const load = async () => {
      try {
        const response = await clientFetch(`${base}/turns/${turnId}/keyframes`, { cache: "no-store", signal: controller.signal });
        if (!response.ok) return;
        const value = keyframesSchema.parse(await response.json());
        if (controller.signal.aborted || value.turn_id !== turnId) return;
        setManifest(value);
        if (value.status === "pending" && attempts++ < 60) timer = setTimeout(() => void load(), 5000);
      } catch { /* Keyframes are optional; the turn player stays usable. */ }
    };
    void load();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [base, turnId]);
  if (!manifest || manifest.status === "unavailable") return null;
  if (manifest.status === "pending") return <p className="text-xs text-ink-3">{zh ? "关键帧图片生成中…" : "Generating key frames…"}</p>;
  if (!manifest.items.length) return null;
  const note = referenceNote(manifest.items.flatMap(item => item.reference_status ?? []), zh, target);
  return <div className="space-y-2">
    <p className="text-sm font-semibold">{zh ? "关键帧对比" : "Key frames"}</p>
    {note && <p className="text-xs text-ink-3">{note}</p>}
    <div className="grid gap-3 sm:grid-cols-2">{manifest.items.map(item => <figure key={item.keyframe_id} className="space-y-1">
      {/* eslint-disable-next-line @next/next/no-img-element -- private image served by the authenticated report proxy */}
      <img src={`${base}/assets/keyframe?keyframe_id=${item.keyframe_id}`} width={item.width} height={item.height} loading="lazy"
        alt={zh ? item.caption_zh : item.caption_en} className="h-auto w-full rounded-lg bg-surface-2" />
      {/* FreeSki's captions already name the turn and phase. */}
      <figcaption className="text-xs text-ink-2">{zh ? item.caption_zh : item.caption_en}</figcaption>
    </figure>)}</div>
  </div>;
}
