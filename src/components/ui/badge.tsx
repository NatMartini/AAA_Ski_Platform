import * as React from "react";
import { cn } from "@/lib/utils";

export type BadgeTone = "neutral" | "accent" | "success" | "warning" | "danger" | "video";

const TONES: Record<BadgeTone, string> = {
  neutral: "border-border bg-surface-2 text-ink-2",
  accent: "border-transparent bg-accent-soft text-accent",
  success: "border-transparent bg-success-bg text-success",
  warning: "border-amber-border bg-amber-bg text-amber",
  danger: "border-danger-border bg-danger-bg text-danger",
  video: "border-transparent bg-cat-video-soft text-cat-video",
};

/** Compact status label. `dot` adds a leading marker in the text colour. */
export function Badge({
  tone = "neutral",
  dot,
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone; dot?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-semibold",
        TONES[tone],
        className,
      )}
      {...props}
    >
      {dot && <span aria-hidden className="size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}
