"use client";

import { useEffect, useState } from "react";
import { useRouter } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { Timer } from "lucide-react";

/**
 * Counts down the 30-minute slot hold.
 *
 * The server is the authority — this is only so the student is not surprised.
 * When it reaches zero the page refreshes so the real, expired status is shown
 * rather than a stale "still yours".
 */
export function HoldCountdown({
  expiresAt,
  locale,
}: {
  expiresAt: string;
  locale: Locale;
}) {
  const router = useRouter();
  const [remaining, setRemaining] = useState(() => msLeft(expiresAt));

  useEffect(() => {
    const id = setInterval(() => {
      const next = msLeft(expiresAt);
      setRemaining(next);
      if (next <= 0) {
        clearInterval(id);
        router.refresh();
      }
    }, 1000);
    return () => clearInterval(id);
  }, [expiresAt, router]);

  if (remaining <= 0) return null;

  const totalSeconds = Math.floor(remaining / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const urgent = totalSeconds < 300;

  return (
    <p
      role="status"
      className={
        urgent
          ? "flex items-center gap-2 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-800 dark:text-red-200"
          : "flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-900 dark:text-amber-100"
      }
    >
      <Timer className="size-4 shrink-0" aria-hidden />
      <span>
        {locale === "zh" ? "请在 " : "Finish within "}
        <strong className="tabular-nums">
          {minutes}:{String(seconds).padStart(2, "0")}
        </strong>
        {locale === "zh"
          ? " 内完成签署与付款,否则时段将自动释放。"
          : " or the slot is released."}
      </span>
    </p>
  );
}

function msLeft(iso: string): number {
  return Math.max(0, new Date(iso).getTime() - Date.now());
}
