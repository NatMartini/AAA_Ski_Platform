import * as React from "react";
import { cn } from "@/lib/utils";

export function Label({
  className,
  ...props
}: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn("block text-sm font-medium text-foreground", className)}
      {...props}
    />
  );
}

const controlBase =
  "w-full min-h-11 rounded-lg border border-border bg-surface px-3 text-sm text-foreground placeholder:text-muted-foreground disabled:opacity-50";

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
  return <select className={cn(controlBase, className)} {...props} />;
}

export function Textarea({
  className,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(controlBase, "min-h-24 py-2 leading-relaxed", className)}
      {...props}
    />
  );
}

/** Inline form error. Pair with aria-describedby on the control. */
export function FieldError({ children }: { children?: React.ReactNode }) {
  if (!children) return null;
  return (
    <p role="alert" className="text-sm text-red-600 dark:text-red-400">
      {children}
    </p>
  );
}

export function Hint({ children }: { children?: React.ReactNode }) {
  if (!children) return null;
  return <p className="text-xs text-muted-foreground">{children}</p>;
}
