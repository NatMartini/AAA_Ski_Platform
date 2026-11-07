import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

const SIZES = { sm: 16, md: 28, lg: 48 } as const;

/**
 * A turning ring for work the server is still doing. It keeps turning until the work is done; the label says
 * what is happening, and is what a screen reader announces.
 */
export function Spinner({ size = "md", label, className }: { size?: keyof typeof SIZES; label?: ReactNode; className?: string }) {
  const px = SIZES[size];
  return <span role="status" className={cn("inline-flex items-center gap-2.5", className)}>
    <svg width={px} height={px} viewBox="0 0 48 48" className="shrink-0 animate-spin [animation-duration:1.1s]" aria-hidden>
      <circle cx="24" cy="24" r="19" fill="none" stroke="currentColor" strokeOpacity=".2" strokeWidth="5" />
      <circle cx="24" cy="24" r="19" fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round" strokeDasharray="38 120" />
    </svg>
    {label ? <span className="min-w-0">{label}</span> : <span className="sr-only">Loading</span>}
  </span>;
}
