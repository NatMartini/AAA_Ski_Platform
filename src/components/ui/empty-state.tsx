import * as React from "react";
import { cn } from "@/lib/utils";

/** What a list shows when it has nothing yet, with the next step to take. */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border-strong bg-surface px-6 py-10 text-center",
        className,
      )}
    >
      {icon && (
        <span className="flex size-12 items-center justify-center rounded-2xl bg-surface-2 text-ink-3 [&_svg]:size-6">
          {icon}
        </span>
      )}
      <div className="space-y-1">
        <p className="font-semibold">{title}</p>
        {description && <p className="mx-auto max-w-md text-sm text-ink-2">{description}</p>}
      </div>
      {action}
    </div>
  );
}
