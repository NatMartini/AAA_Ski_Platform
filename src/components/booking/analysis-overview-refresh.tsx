"use client";

import { useTransition } from "react";
import { RefreshCw } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";

export function AnalysisOverviewRefresh({ locale }: { locale: "zh" | "en" }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button variant="secondary" size="sm" disabled={pending}
      onClick={() => startTransition(() => router.refresh())}>
      <RefreshCw className={pending ? "animate-spin" : undefined} aria-hidden />
      {locale === "zh" ? "刷新次数" : "Refresh credits"}
    </Button>
  );
}
