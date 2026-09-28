import { cn } from "@/lib/utils";

/**
 * One headline number: a label, the value, and an optional line of context.
 *
 * Proportional figures on purpose — tabular digits make a big standalone
 * number look loose; they are for columns that must line up.
 */
export function StatTile({
  label,
  value,
  sub,
  className,
}: {
  label: string;
  value: string;
  sub?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-border bg-surface p-4 shadow-[var(--shadow-sm)]",
        className,
      )}
    >
      <p className="text-xs font-semibold text-ink-3">{label}</p>
      <p className="font-display mt-1 text-2xl font-extrabold tracking-tight text-ink">
        {value}
      </p>
      {sub && <p className="mt-0.5 text-xs text-ink-2">{sub}</p>}
    </div>
  );
}
