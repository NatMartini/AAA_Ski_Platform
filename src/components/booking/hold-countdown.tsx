"use client";

import { useEffect, useState } from "react";
import { useRouter } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { Timer } from "lucide-react";
import { formatTorontoDateTime } from "@/lib/time";

/**
 * Counts down the slot hold, including the longer group-signing window.
 *
 * The server is the authority — this is only so the student is not surprised.
 * When it reaches zero the page refreshes so the real, expired status is shown
 * rather than a stale "still yours".
 */
export function HoldCountdown({
  expiresAt,
  locale,
  signOnly = false,
}: {
  expiresAt: string;
  locale: Locale;
  /** A lesson-package booking: only the waiver is left, nothing to pay. */
  signOnly?: boolean;
}) {
  const router = useRouter();
  // Server and browser initially render the same fixed deadline. Starting a
  // live timer in the effect avoids a hydration mismatch across a second tick.
  const [remaining, setRemaining] = useState<number | null>(null);

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

  if (remaining !== null && remaining <= 0) return null;
  const deadline = formatTorontoDateTime(new Date(expiresAt), locale);
  if (remaining === null || remaining >= 48 * 3_600_000) return (
    <p role="status" className="flex items-center gap-3 rounded-xl border border-border bg-surface-2 p-4 text-sm text-ink-2">
      <Timer className="size-4 shrink-0 text-accent" aria-hidden />
      <span>{locale === "zh" ? "预留截止（多伦多时间）：" : "Reserved until (Toronto time): "}<time dateTime={expiresAt} className="font-bold text-ink">{deadline}</time>
        <span className="block text-xs">{locale === "zh"
          ? signOnly ? "截止前完成签署，超时会释放时段。" : "截止前完成全部签字并提交付款，超时会释放时段。"
          : signOnly ? "Sign before the deadline, or the slot is released." : "Collect all signatures and submit payment before the deadline."}</span>
      </span>
    </p>
  );

  const totalSeconds = Math.floor(remaining / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const hours = Math.floor(minutes / 60);
  const seconds = totalSeconds % 60;
  const urgent = totalSeconds < 300;

  return (
    <p
      role="status"
      className="flex items-center gap-3 rounded-xl border p-4 text-sm"
      style={
        urgent
          ? {
              background: "var(--danger-bg)",
              borderColor: "var(--danger-border)",
              color: "var(--danger)",
            }
          : {
              background: "var(--amber-bg)",
              borderColor: "var(--amber-border)",
              color: "var(--amber)",
            }
      }
    >
      {/* The ring only pulses in the last five minutes — a permanent animation
          would just become wallpaper. */}
      <span
        className={`flex size-9 shrink-0 items-center justify-center rounded-full ${
          urgent ? "animate-pulse-ring" : ""
        }`}
        style={{ background: "color-mix(in srgb, currentColor 12%, transparent)" }}
      >
        <Timer className="size-4" aria-hidden />
      </span>
      <span className="font-medium">
        {locale === "zh" ? "请在 " : "Finish within "}
        <strong className="text-base font-extrabold tabular-nums">
          {hours > 0
            ? `${hours}:${String(minutes % 60).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
            : `${minutes}:${String(seconds).padStart(2, "0")}`}
        </strong>
        {locale === "zh"
          ? signOnly
            ? " 内完成签署,否则时段将自动释放。"
            : " 内完成全部学员签署并提交付款，否则时段将自动释放。"
          : signOnly
            ? " to sign, or the slot is released."
            : " to collect all signatures and submit payment, or the slot is released."}
      </span>
    </p>
  );
}

function msLeft(iso: string): number {
  return Math.max(0, new Date(iso).getTime() - Date.now());
}
