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
    title: "调整课时",
    hint: "给学员加课时(例如补课)填正数,扣课时填负数。每次调整都会连同原因一起记录,学员也能看到。已经约掉或上过的课时不能扣回。",
    hours: "增减小时数",
    reason: "原因",
    save: "保存调整",
    belowUsed: "扣减后会少于已约掉的课时,不能这样调整。",
    failed: "调整失败,请重试。",
  },
  en: {
    title: "Adjust hours",
    hint: "Add hours (a make-up lesson, say) with a positive number, take them away with a negative one. Every change is kept with its reason, and the student can see it. Hours already booked or taught cannot be taken back.",
    hours: "Hours to add or remove",
    reason: "Reason",
    save: "Save adjustment",
    belowUsed: "That would leave fewer hours than are already booked.",
    failed: "Could not save. Please try again.",
  },
} as const;

/** The selling coach adds or removes hours on a package, with a reason. */
export function PackageAdjust({
  locale,
  packageCode,
}: {
  locale: Locale;
  packageCode: string;
}) {
  const router = useRouter();
  const c = COPY[locale];
  const [hours, setHours] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const delta = Number(hours);
  const valid = Number.isInteger(delta) && delta !== 0 && reason.trim().length > 0;

  async function save() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/packages/${packageCode}/adjust`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hours: delta, reason: reason.trim() }),
    });
    setBusy(false);
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error === "below-used" ? c.belowUsed : c.failed);
      return;
    }
    setHours("");
    setReason("");
    router.refresh();
  }

  return (
    <Card className="space-y-3">
      <CardTitle>{c.title}</CardTitle>
      <CardDescription>{c.hint}</CardDescription>
      <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
        <div className="space-y-1.5">
          <Label htmlFor="adjust-hours">{c.hours}</Label>
          <Input
            id="adjust-hours"
            inputMode="numeric"
            placeholder="+2 / -1"
            value={hours}
            onChange={(e) => setHours(e.target.value.replace(/[^\d+-]/g, ""))}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="adjust-reason">{c.reason}</Label>
          <Input
            id="adjust-reason"
            value={reason}
            maxLength={200}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
      </div>
      <FieldError>{error}</FieldError>
      <Button className="self-start" disabled={busy || !valid} onClick={save}>
        {busy && <Loader2 className="animate-spin" aria-hidden />}
        {c.save}
      </Button>
    </Card>
  );
}
