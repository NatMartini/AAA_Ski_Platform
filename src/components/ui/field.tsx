import * as React from "react";
import { cn } from "@/lib/utils";

export function Label({
  className,
  ...props
}: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn("block text-sm font-semibold text-ink", className)}
      {...props}
    />
  );
}

const controlBase =
  "w-full min-h-11 rounded-xl border border-border-strong bg-surface px-3.5 py-2.5 text-[15px] text-ink transition-colors placeholder:text-ink-3 hover:border-accent/50 focus:border-accent focus:outline-none focus:ring-4 focus:ring-[var(--accent-soft)] disabled:opacity-50";

export function Input({
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(controlBase, className)} {...props} />;
}

export function Select({
  className,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        controlBase,
        // Native arrow is replaced with an inline chevron so the control looks
        // the same on Windows, macOS and Android.
        "appearance-none bg-no-repeat pr-10 font-semibold",
        "bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%238496a8%22 stroke-width=%222.5%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22><polyline points=%226 9 12 15 18 9%22/></svg>')]",
        "bg-[position:right_0.75rem_center] bg-[size:1.1rem]",
        className,
      )}
      {...props}
    />
  );
}

export function Textarea({
  className,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(controlBase, "min-h-24 leading-relaxed", className)}
      {...props}
    />
  );
}

/** Inline form error. Pair with aria-describedby on the control. */
export function FieldError({ children }: { children?: React.ReactNode }) {
  if (!children) return null;
  return (
    <p
      role="alert"
      className="animate-fade-in text-sm font-medium text-danger"
    >
      {children}
    </p>
  );
}

export function Hint({ children }: { children?: React.ReactNode }) {
  if (!children) return null;
  return <p className="text-xs leading-relaxed text-ink-3">{children}</p>;
}
