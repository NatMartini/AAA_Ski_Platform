"use client";

import { useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FieldError, Input, Label } from "@/components/ui/field";
import type { Locale } from "@/i18n/routing";
import { Loader2 } from "lucide-react";

const COPY = {
  zh: {
    title: "取消课时包",
    hint: "取消后不能再用它预约。已上过的课仍然保留在记录里。如需退款,请与教练当面结算。",
    reason: "取消原因",
    action: "取消课时包",
    confirm: "确定取消这个课时包?此操作无法撤销。",
    failed: "取消失败:如果还有用它预约、尚未上的课,请先取消那些课。",
  },
  en: {
    title: "Cancel this package",
    hint: "Once cancelled no more lessons can be booked from it. Lessons already taught stay on record. Any refund is settled with the coach directly.",
    reason: "Reason",
    action: "Cancel package",
    confirm: "Cancel this package? This cannot be undone.",
    failed:
      "Could not cancel. If lessons booked from it are still coming up, cancel those first.",
  },
} as const;

export function PackageCancel({
  locale,
  packageCode,
}: {
  locale: Locale;
  packageCode: string;
}) {
  const router = useRouter();
  const c = COPY[locale];
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function cancel() {
    if (!window.confirm(c.confirm)) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/packages/${packageCode}/cancel`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: reason.trim() }),
    });
    setBusy(false);
    if (!res.ok) {
      setError(c.failed);
      return;
    }
    router.refresh();
  }

  return (
    <Card className="space-y-3" style={{ borderColor: "var(--danger-border)" }}>
      <CardTitle>{c.title}</CardTitle>
      <CardDescription>{c.hint}</CardDescription>
      <div className="space-y-1.5">
        <Label htmlFor="package-cancel-reason">{c.reason}</Label>
        <Input
          id="package-cancel-reason"
          value={reason}
          maxLength={500}
          onChange={(e) => setReason(e.target.value)}
        />
      </div>
      <FieldError>{error}</FieldError>
      <Button
        variant="danger"
        className="self-start"
        disabled={busy || !reason.trim()}
        onClick={cancel}
      >
        {busy && <Loader2 className="animate-spin" aria-hidden />}
        {c.action}
      </Button>
    </Card>
  );
}
