"use client";

import { useEffect, useRef, useState } from "react";

type Series = { id: string; name: string };
type Month = { month: string; label: string; values: number[] };

const H = 240;
const M = { top: 22, right: 8, bottom: 28, left: 34 };
const PLOT_H = H - M.top - M.bottom;
/** Surface-coloured gap between stacked segments. */
const GAP = 2;
const MAX_BAR = 24;

/**
 * Lesson hours per month, stacked by coach.
 *
 * Colour follows the coach: `series` arrives in a fixed order and slot N is
 * always --series-N, so a coach keeps their colour whatever the numbers do.
 * Identity never rests on colour alone — there is a legend, the tooltip names
 * each coach, and the same numbers sit in the table underneath.
 */
export function MonthlyHoursChart({
  series,
  months,
  labels,
}: {
  series: Series[];
  months: Month[];
  labels: {
    title: string;
    hours: string;
    total: string;
    empty: string;
    table: string;
    month: string;
  };
}) {
  const [active, setActive] = useState<number | null>(null);
  // Laid out in real pixels at the container's width rather than scaling a
  // fixed viewBox, so labels stay 11px and bars stay thin on a phone.
  const frame = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(640);
  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) =>
      setW(Math.max(240, Math.round(entry.contentRect.width))),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const PLOT_W = W - M.left - M.right;

  const totals = months.map((m) => m.values.reduce((a, b) => a + b, 0));
  const max = niceMax(Math.max(0, ...totals));
  const ticks = Array.from({ length: max.steps + 1 }, (_, i) => i * max.step);
  const band = PLOT_W / months.length;
  const barW = Math.min(MAX_BAR, band * 0.5);
  const y = (v: number) => M.top + PLOT_H - (v / max.value) * PLOT_H;
  const color = (i: number) => `var(--series-${i + 1})`;

  const empty = totals.every((t) => t === 0);

  return (
    <figure className="space-y-3">
      <figcaption className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-base font-extrabold tracking-tight">{labels.title}</span>
        {series.length > 1 && (
          <span className="flex flex-wrap gap-3 text-xs text-ink-2">
            {series.map((s, i) => (
              <span key={s.id} className="inline-flex items-center gap-1.5">
                <span
                  aria-hidden
                  className="inline-block size-2.5 rounded-[3px]"
                  style={{ background: color(i) }}
                />
                {s.name}
              </span>
            ))}
          </span>
        )}
      </figcaption>

      {empty ? (
        <p className="rounded-xl bg-surface-2 p-4 text-sm text-ink-2">{labels.empty}</p>
      ) : (
        <div ref={frame} className="relative">
          <svg
            width={W}
            height={H}
            viewBox={`0 0 ${W} ${H}`}
            className="block max-w-full overflow-visible"
            role="group"
            aria-label={labels.title}
          >
            {ticks.map((t) => (
              <g key={t}>
                <line
                  x1={M.left}
                  x2={W - M.right}
                  y1={y(t)}
                  y2={y(t)}
                  stroke="var(--chart-grid)"
                  strokeWidth={1}
                />
                <text
                  x={M.left - 6}
                  y={y(t)}
                  dy="0.32em"
                  textAnchor="end"
                  className="fill-[var(--ink-3)] text-[11px] tabular-nums"
                >
                  {t}
                </text>
              </g>
            ))}

            {months.map((m, i) => {
              const cx = M.left + band * (i + 0.5);
              const x = cx - barW / 2;
              const dim = active !== null && active !== i;
              let base = M.top + PLOT_H;
              const drawn = m.values
                .map((v, s) => ({ v, s }))
                .filter(({ v }) => v > 0);
              return (
                <g
                  key={m.month}
                  tabIndex={0}
                  aria-label={`${m.label}: ${m.values
                    .map((v, s) => `${series[s].name} ${v} ${labels.hours}`)
                    .join(", ")}`}
                  onPointerEnter={() => setActive(i)}
                  onPointerLeave={() => setActive(null)}
                  onFocus={() => setActive(i)}
                  onBlur={() => setActive(null)}
                  className="cursor-default outline-none"
                  style={{ opacity: dim ? 0.45 : 1, transition: "opacity 120ms" }}
                >
                  {/* The hit target is the whole band, not the painted bar. */}
                  <rect
                    x={M.left + band * i}
                    y={M.top}
                    width={band}
                    height={PLOT_H}
                    fill="transparent"
                  />
                  {drawn.map(({ v, s }, k) => {
                    const h = (v / max.value) * PLOT_H;
                    const top = base - h;
                    const isTop = k === drawn.length - 1;
                    // Leave a surface gap under every segment but the first.
                    const bottom = k === 0 ? base : base - GAP;
                    base = top;
                    const segH = Math.max(0, bottom - top);
                    return (
                      <path
                        key={series[s].id}
                        d={isTop ? roundedTop(x, top, barW, segH) : rect(x, top, barW, segH)}
                        fill={color(s)}
                      />
                    );
                  })}
                  {totals[i] > 0 && (
                    <text
                      x={cx}
                      y={y(totals[i]) - 6}
                      textAnchor="middle"
                      className="fill-[var(--ink-2)] text-[11px] font-semibold tabular-nums"
                    >
                      {totals[i]}
                    </text>
                  )}
                  <text
                    x={cx}
                    y={H - 8}
                    textAnchor="middle"
                    className="fill-[var(--ink-3)] text-[11px]"
                  >
                    {m.label}
                  </text>
                  {active === i && (
                    <rect
                      x={M.left + band * i + 2}
                      y={M.top - 4}
                      width={band - 4}
                      height={PLOT_H + 4}
                      rx={6}
                      fill="none"
                      stroke="var(--accent)"
                      strokeOpacity={0.35}
                    />
                  )}
                </g>
              );
            })}
          </svg>

          {active !== null && (
            <div
              role="status"
              className="pointer-events-none absolute top-0 z-10 min-w-36 -translate-x-1/2 rounded-xl border border-border bg-surface p-3 text-xs shadow-[var(--shadow)]"
              style={{
                left: `${Math.min(88, Math.max(12, ((M.left + band * (active + 0.5)) / W) * 100))}%`,
              }}
            >
              <p className="mb-1.5 font-bold text-ink">{months[active].label}</p>
              {months[active].values.map((v, s) => (
                <p key={series[s].id} className="flex items-center gap-2 py-0.5">
                  <span
                    aria-hidden
                    className="inline-block h-0.5 w-3 rounded-full"
                    style={{ background: color(s) }}
                  />
                  <strong className="tabular-nums text-ink">{v}</strong>
                  <span className="text-ink-2">{series[s].name}</span>
                </p>
              ))}
              <p className="mt-1 border-t border-border pt-1 text-ink-2">
                {labels.total} <strong className="tabular-nums text-ink">{totals[active]}</strong>{" "}
                {labels.hours}
              </p>
            </div>
          )}
        </div>
      )}

      <details className="text-sm">
        <summary className="cursor-pointer text-xs font-semibold text-ink-2">
          {labels.table}
        </summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="text-ink-3">
                <th className="py-1.5 pr-3 font-semibold">{labels.month}</th>
                {series.map((s) => (
                  <th key={s.id} className="py-1.5 pr-3 text-right font-semibold">
                    {s.name}
                  </th>
                ))}
                <th className="py-1.5 text-right font-semibold">{labels.total}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {months.map((m, i) => (
                <tr key={m.month}>
                  <th scope="row" className="py-1.5 pr-3 font-semibold text-ink">
                    {m.label}
                  </th>
                  {m.values.map((v, s) => (
                    <td key={series[s].id} className="py-1.5 pr-3 text-right tabular-nums">
                      {v}
                    </td>
                  ))}
                  <td className="py-1.5 text-right font-semibold tabular-nums">{totals[i]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}

/** A clean axis top: 1-2-5 steps, at most four gridlines above zero. */
function niceMax(max: number): { value: number; step: number; steps: number } {
  if (max <= 0) return { value: 4, step: 1, steps: 4 };
  for (const magnitude of [1, 10, 100, 1000]) {
    for (const unit of [1, 2, 5]) {
      const step = unit * magnitude;
      const steps = Math.ceil(max / step);
      if (steps <= 4) return { value: steps * step, step, steps };
    }
  }
  const step = Math.ceil(max / 4);
  return { value: step * 4, step, steps: 4 };
}

function rect(x: number, y: number, w: number, h: number): string {
  return `M${x},${y}h${w}v${h}h${-w}Z`;
}

/** 4px rounded data end on top, square at the baseline. */
function roundedTop(x: number, y: number, w: number, h: number): string {
  const r = Math.min(4, h, w / 2);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}
