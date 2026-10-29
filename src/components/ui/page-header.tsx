import * as React from "react";
import { cn } from "@/lib/utils";
import { TONE_TILE, type Tone } from "./tone";

/**
 * The title block at the top of every page: optional category icon, title,
 * one-line description and the page's main actions on the right.
 */
export function PageHeader({
  title,
  description,
  icon,
  tone = "book",
  actions,
  eyebrow,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  icon?: React.ReactNode;
  tone?: Tone;
  actions?: React.ReactNode;
  eyebrow?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-4", className)}>
      <div className="flex min-w-0 items-start gap-3.5">
        {icon && (
          <span
            className={cn(
              "mt-0.5 flex size-11 shrink-0 items-center justify-center rounded-xl [&_svg]:size-5",
              TONE_TILE[tone],
            )}
          >
            {icon}
          </span>
        )}
        <div className="min-w-0 space-y-1">
          {eyebrow && <div className="text-xs font-semibold text-ink-3">{eyebrow}</div>}
          <h1 className="break-words text-2xl sm:text-[1.75rem]">{title}</h1>
          {description && (
            <p className="max-w-2xl text-sm leading-relaxed text-ink-2">{description}</p>
          )}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** A heading for a group of content inside a page. */
export function SectionHeading({
  title,
  description,
  actions,
  className,
  id,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-end justify-between gap-3", className)}>
      <div className="min-w-0 space-y-0.5">
        <h2 id={id} className="text-lg">{title}</h2>
        {description && <p className="text-sm text-ink-2">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
