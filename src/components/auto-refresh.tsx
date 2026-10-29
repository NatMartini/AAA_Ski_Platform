"use client";

import { useEffect } from "react";
import { useRouter } from "@/i18n/navigation";

/** Re-reads the server page on an interval while it is visible, e.g. until an analysis finishes. */
export function AutoRefresh({ intervalMs = 5000 }: { intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [router, intervalMs]);
  return null;
}
