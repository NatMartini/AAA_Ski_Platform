"use client";

import { useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { FieldError, Hint, Label, Select } from "@/components/ui/field";
import type { Locale } from "@/i18n/routing";
import { Loader2 } from "lucide-react";

const COPY = {
  zh: {
    payee: "买哪位教练的课时包",
    payeeHint: "课费直接付给这位教练,由这位教练确认收款。课时包只能约这位教练上课。",
    buy: "下单并去付款",
    notOnSale: "早鸟已截止,该课时包已停售。",
    failed: "下单失败,请重试。",
  },
  en: {
    payee: "Whose package are you buying?",
    payeeHint:
      "You pay this coach directly and they confirm it. The hours can only be booked with them.",
    buy: "Order and pay",
    notOnSale: "The early bird is over and this package is no longer on sale.",
    failed: "Could not place the order. Please try again.",
  },
} as const;

/** Orders a package from the coach the student chooses to pay. */
export function PackageBuyForm({
  locale,
  offerKey,
  coaches,
}: {
  locale: Locale;
  offerKey: string;
  coaches: { userId: string; displayName: string }[];
}) {
  const router = useRouter();
  const c = COPY[locale];
  const [payeeCoachId, setPayeeCoachId] = useState(coaches[0]?.userId ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function buy() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/packages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ offerKey, payeeCoachId }),
    });
    setBusy(false);
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error === "not-on-sale" ? c.notOnSale : c.failed);
      return;
    }
    const { code } = (await res.json()) as { code: string };
    router.push(`/packages/${code}`);
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor={`payee-${offerKey}`}>{c.payee}</Label>
        <Select
          id={`payee-${offerKey}`}
          className="max-w-xs"
          value={payeeCoachId}
          onChange={(e) => setPayeeCoachId(e.target.value)}
        >
          {coaches.map((coach) => (
            <option key={coach.userId} value={coach.userId}>
              {coach.displayName}
            </option>
          ))}
        </Select>
        <Hint>{c.payeeHint}</Hint>
      </div>
      <FieldError>{error}</FieldError>
      <Button onClick={buy} disabled={busy || !payeeCoachId}>
        {busy && <Loader2 className="animate-spin" aria-hidden />}
        {c.buy}
      </Button>
    </div>
  );
}
