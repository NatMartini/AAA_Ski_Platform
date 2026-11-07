"use client";

import { useRef, useState } from "react";
import { ChevronDown, Loader2 } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { clientFetch } from "@/lib/client-fetch";
import { clientRandomUUID } from "@/lib/browser-helpers";
import { formatMoneyShort } from "@/lib/pricing";
import { Button } from "@/components/ui/button";
import { FieldError, Hint, Input, Label } from "@/components/ui/field";
import { AnalysisPurchase } from "./video-analysis-panel";
import type { VideoAnalysisView } from "./video-analysis-types";

function failureText(code: string | undefined, zh: boolean) {
  if (code === "price-not-configured" || code === "wechat-unavailable" || code === "purchase-not-configured")
    return zh ? "教练尚未设置额外分析价格或微信收款方式，请联系教练。" : "The coach has not configured extra analysis pricing or WeChat payment. Contact your coach.";
  if (code === "price-changed") return zh ? "分析价格已变化，已刷新最新价格。请核对后重新生成订单。" : "The analysis price changed and has been refreshed; check it before creating another order.";
  if (code === "state-changed") return zh ? "付款订单已更新，已刷新当前状态。" : "The payment order changed; its current status has been refreshed.";
  return zh ? "操作未完成，请刷新检查当前状态后重试。" : "The action could not be completed. Refresh to check its status before retrying.";
}

/**
 * Buying more analyses: paid by WeChat to the coach of the student's latest completed lesson, and added to the
 * student's account once that coach confirms receipt (owner's decision, 2026-11-07).
 */
export function AnalysisCreditPurchase({ locale, bookingCode, initialView }: { locale: Locale; bookingCode: string; initialView: VideoAnalysisView }) {
  const zh = locale === "zh";
  const router = useRouter();
  const [view, setView] = useState(initialView);
  const [quantity, setQuantity] = useState("1");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const keys = useRef(new Map<string, string>());
  const base = `/api/bookings/${bookingCode}/analysis`;
  const pending = view.purchases.some(purchase => ["AWAITING_PAYMENT", "PENDING_PAYMENT_REVIEW", "PAYMENT_REJECTED"].includes(purchase.status));
  if (!view.price && view.purchases.length === 0) return null;

  const key = (operation: string) => {
    if (!keys.current.has(operation)) keys.current.set(operation, clientRandomUUID());
    return keys.current.get(operation)!;
  };
  async function reload() {
    const response = await clientFetch(base, { cache: "no-store" });
    const body = await response.json().catch(() => null) as VideoAnalysisView | null;
    if (response.ok && body?.ok) setView(body);
    // A confirmed order changes the count by the title.
    router.refresh();
  }
  async function act(operation: string, path: string, body: unknown) {
    if (busy) return false;
    setBusy(operation); setError(null); setMessage(null);
    try {
      const response = await clientFetch(path, { method: "POST", headers: { "content-type": "application/json", "x-locale": locale }, body: JSON.stringify(body) });
      const data = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) { setError(failureText(data.error, zh)); await reload(); return false; }
      keys.current.delete(operation);
      await reload();
      return true;
    } finally { setBusy(null); }
  }
  async function buy() {
    const count = /^\d+$/.test(quantity) ? Number(quantity) : NaN;
    if (!Number.isInteger(count) || count < 1 || count > 50) { setError(zh ? "请选择 1–50 次额外分析。" : "Choose between 1 and 50 extra analyses."); return; }
    const operation = `purchase:${count}`;
    if (await act(operation, `${base}/purchases`, { quantity: count, expectedUnitPriceCents: view.price?.unitCents, requestKey: key(operation) }))
      setMessage(zh ? "已生成订单，请按订单金额微信付款，然后点“我已用微信付款”。" : "Your order is ready. Pay its amount by WeChat, then press “I paid by WeChat”.");
  }

  return <details open={pending || undefined} className="group rounded-2xl border border-border bg-surface shadow-[var(--shadow-sm)]">
    <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-2 px-4 text-sm font-semibold">
      <span>{zh ? "买更多次数" : "Buy more analyses"}{view.price && <span className="font-normal text-ink-3"> · {zh ? "每次" : "each"} {formatMoneyShort(view.price.unitCents)} CAD · {zh ? "付给" : "paid to"} {view.payment.coachName}</span>}</span>
      <ChevronDown className="size-4 shrink-0 transition-transform group-open:rotate-180" aria-hidden />
    </summary>
    <div className="space-y-3 border-t border-border p-4">
      <Hint>{zh ? "微信付款后通知教练，教练核对到账后，次数加到你的账户里。每笔订单保留下单时的价格。" : "Pay by WeChat and notify your coach; once they check receipt, the analyses are added to your account. Each order keeps its original price."}</Hint>
      {view.canPurchase && view.price && <div className="flex flex-wrap items-end gap-3">
        <div className="w-28 space-y-2"><Label htmlFor="analysis-buy-quantity">{zh ? "购买次数" : "Analyses"}</Label>
          <Input id="analysis-buy-quantity" type="number" min={1} max={50} step={1} value={quantity} disabled={Boolean(busy)} onChange={event => setQuantity(event.target.value)} /></div>
        <Button variant="secondary" disabled={Boolean(busy)} onClick={() => void buy()}>{busy?.startsWith("purchase:") && <Loader2 className="animate-spin" aria-hidden />}{zh ? "生成微信付款订单" : "Create WeChat payment order"}</Button>
      </div>}
      {view.price && !view.payment.wechatEnabled && <p className="text-sm text-ink-3">{zh ? "教练暂未启用微信收款，请联系教练。" : "The coach has not enabled WeChat payment. Contact your coach."}</p>}
      {message && <p role="status" className="text-sm font-medium text-success">{message}</p>}
      <FieldError>{error}</FieldError>
      {view.purchases.map(purchase => <AnalysisPurchase key={purchase.id} purchase={purchase} locale={locale} isCustomer canReview={false} payment={view.payment}
        busy={Boolean(busy)} onAction={(path, body) => act(`order:${purchase.id}`, `${base}/purchases/${purchase.id}/${path}`, body)} />)}
    </div>
  </details>;
}
