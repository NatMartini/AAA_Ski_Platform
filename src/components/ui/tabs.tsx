"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export type TabItem<K extends string> = { key: K; label: React.ReactNode; count?: number };

/** A row of filter tabs. Scrolls sideways on phones instead of wrapping. */
export function SegmentedTabs<K extends string>({
  items,
  value,
  onChange,
  label,
  className,
}: {
  items: readonly TabItem<K>[];
  value: K;
  onChange: (key: K) => void;
  label: string;
  className?: string;
}) {
  return (
    <div role="tablist" aria-label={label} className={cn("scrollbar-none -mx-1 flex gap-1 overflow-x-auto px-1", className)}>
      {items.map((item) => {
        const selected = item.key === value;
        return (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(item.key)}
            className={cn(
              "press inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-sm font-semibold",
              selected
                ? "border-ink bg-ink text-surface"
                : "border-border bg-surface text-ink-2 hover:border-border-strong hover:text-ink",
            )}
          >
            {item.label}
            {item.count !== undefined && (
              <span
                data-numeric
                className={cn(
                  "rounded-full px-1.5 text-xs",
                  selected ? "bg-surface/20 text-surface" : "bg-surface-2 text-ink-3",
                )}
              >
                {item.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
