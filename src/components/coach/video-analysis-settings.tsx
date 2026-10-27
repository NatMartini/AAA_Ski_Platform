"use client";

import { useCallback, useEffect, useState } from "react";
import { clientFetch } from "@/lib/client-fetch";
import type { Locale } from "@/i18n/routing";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FieldError, Hint, Input, Label } from "@/components/ui/field";
import { Check, Loader2, RefreshCw } from "lucide-react";
import { useRouter } from "@/i18n/navigation";

export function analysisPriceToCents(value: string): number | null | "invalid" {
  const text = value.trim();
  if (!text) return null;
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return "invalid";
  const cents = Math.round(Number(text) * 100);
  return Number.isSafeInteger(cents) && cents >= 1 && cents <= 1_000_000 ? cents : "invalid";
}

export function VideoAnalysisSettings({ locale, coachId }: { locale: Locale; coachId: string }) {
  const zh = locale === "zh";
  const router = useRouter();
  const [draft, setDraft] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(true);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const failed = zh ? "视频分析价格未能保存或读取，请重试。" : "Could not load or save the video analysis price. Please try again.";

  const load = useCallback(async (signal?: AbortSignal) => {
    setBusy(true);
    const response = await clientFetch("/api/coach/video-analysis/settings", { cache: "no-store", signal });
    const body = await response.json().catch(() => null) as { analysisCreditPriceCents?: number | null } | null;
    if (signal?.aborted) return;
    setBusy(false);
    if (!response.ok || !body || !(body.analysisCreditPriceCents === null || typeof body.analysisCreditPriceCents === "number")) {
      setError(failed);
      return;
    }
    setDraft(body.analysisCreditPriceCents === null ? "" : (body.analysisCreditPriceCents / 100).toFixed(2));
    setLoaded(true);
    setError(null);
  }, [failed]);

  useEffect(() => {
    const controller = new AbortController();
    const initialLoad = window.setTimeout(() => void load(controller.signal), 0);
    return () => { controller.abort(); window.clearTimeout(initialLoad); };
  }, [load]);

  async function save() {
    const cents = analysisPriceToCents(draft);
    if (cents === "invalid") {
      setError(zh ? "请输入 $0.01–$10,000 之间的价格，最多两位小数；留空可关闭购买。" : "Enter a price from $0.01 to $10,000 with up to two decimal places, or leave blank to disable purchases.");
      return;
    }
    setBusy(true);
    setError(null);
    setSaved(false);
    const response = await clientFetch("/api/coach/video-analysis/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ analysisCreditPriceCents: cents, expectedCoachId: coachId }),
    });
    setBusy(false);
    if (!response.ok) {
      const body = await response.json().catch(() => null) as { error?: string } | null;
      setError(body?.error === "session-changed" ? zh ? "登录账号已变化，请检查当前教练后重新填写价格。" : "Your signed-in account changed. Check the current coach before editing this price again." : failed);
      if (body?.error === "session-changed" || response.status === 401 || response.status === 403) router.refresh();
      return;
    }
    setSaved(true);
  }

  return <Card className="space-y-4">
    <CardTitle>{zh ? "额外视频分析价格" : "Extra video analysis price"}</CardTitle>
    <CardDescription>{zh ? "课程完成后，每节 2 小时课包含 3 次、3 小时课包含 5 次共享分析，1v2、1v3 不按人数增加。额外次数按下方价格通过微信付款，由本课教练核对到账后开放。分析失败或无法评分不扣次数。" : "Each completed two-hour lesson includes 3 shared analyses; a three-hour lesson includes 5. Group size does not increase this allowance. Extra credits use the price below, paid by WeChat and unlocked after the lesson coach confirms receipt. Failed or ungradable analyses do not use a credit."}</CardDescription>
    <div className="max-w-sm space-y-2">
      <Label htmlFor="analysis-credit-price">{zh ? "每次额外分析（加元）" : "Price per extra analysis (CAD)"}</Label>
      <Input id="analysis-credit-price" inputMode="decimal" value={draft} disabled={!loaded || busy} placeholder={zh ? "未设置" : "Not set"} onChange={(event) => { setDraft(event.target.value); setSaved(false); setError(null); }} aria-describedby="analysis-price-help" />
      <p id="analysis-price-help" className="text-xs text-ink-3">{zh ? "留空并保存会关闭额外次数购买。此价格单独保存；也需在收款设置中启用微信并提供收款方式。" : "Leave blank and save to disable extra purchases. This price is saved separately. Enable WeChat and add payment details in Payment methods as well."}</p>
      {loaded && !draft.trim() && <Hint>{zh ? "当前未设置价格，学员不能购买额外次数。" : "No price is set. Students cannot purchase extra credits."}</Hint>}
    </div>
    <div className="flex flex-wrap items-center gap-3">
      <Button variant="secondary" disabled={!loaded || busy} onClick={() => void save()}>{busy && <Loader2 className="animate-spin" aria-hidden />}{zh ? "保存分析价格" : "Save analysis price"}</Button>
      {!loaded && !busy && <Button variant="ghost" onClick={() => void load()}><RefreshCw aria-hidden />{zh ? "重新读取" : "Retry loading"}</Button>}
      {saved && <p role="status" className="inline-flex items-center gap-1.5 text-sm text-success"><Check className="size-4" aria-hidden />{zh ? "分析价格已保存" : "Analysis price saved"}</p>}
    </div>
    <FieldError>{error}</FieldError>
  </Card>;
}
