"use client";

import { useEffect, useRef, useState } from "react";

type Month = { month: string; label: string; hours: number };

const H = 240;
const M = { top: 22, right: 8, bottom: 28, left: 34 };
const PLOT_H = H - M.top - M.bottom;
const MAX_BAR = 24;

/**
 * One coach's lesson hours per month, as columns.
 *
 * A single series, so the title names it and there is no legend. Every value
 * is on its column, in the hover/focus tooltip and in the table underneath,
 * so nothing depends on seeing the bars.
 */
export function MonthlyHoursChart({
  months,
  labels,
}: {
  months: Month[];
  labels: {
    title: string;
    hours: string;
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

  const max = niceMax(Math.max(0, ...months.map((m) => m.hours)));
  const ticks = Array.from({ length: max.steps + 1 }, (_, i) => i * max.step);
  const band = PLOT_W / months.length;
  const barW = Math.min(MAX_BAR, band * 0.5);
  const y = (v: number) => M.top + PLOT_H - (v / max.value) * PLOT_H;
  const empty = months.every((m) => m.hours === 0);

  return (
    <figure className="space-y-3">
      <figcaption className="text-base font-extrabold tracking-tight">
        {labels.title}
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
              const top = y(m.hours);
              return (
                <g
                  key={m.month}
                  tabIndex={0}
                  aria-label={`${m.label}: ${m.hours} ${labels.hours}`}
                  onPointerEnter={() => setActive(i)}
                  onPointerLeave={() => setActive(null)}
                  onFocus={() => setActive(i)}
                  onBlur={() => setActive(null)}
                  className="cursor-default outline-none"
                  style={{
                    opacity: active !== null && active !== i ? 0.45 : 1,
                    transition: "opacity 120ms",
                  }}
                >
                  {/* The hit target is the whole band, not the painted bar. */}
                  <rect
                    x={M.left + band * i}
                    y={M.top}
                    width={band}
                    height={PLOT_H}
                    fill="transparent"
                  />
                  {m.hours > 0 && (
                    <>
                      <path
                        d={roundedTop(cx - barW / 2, top, barW, M.top + PLOT_H - top)}
                        fill="var(--chart-bar)"
                      />
                      <text
                        x={cx}
                        y={top - 6}
                        textAnchor="middle"
                        className="fill-[var(--ink-2)] text-[11px] font-semibold tabular-nums"
                      >
                        {m.hours}
                      </text>
                    </>
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
              className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 rounded-xl border border-border bg-surface px-3 py-2 text-xs shadow-[var(--shadow)]"
              style={{
                left: `${Math.min(88, Math.max(12, ((M.left + band * (active + 0.5)) / W) * 100))}%`,
              }}
            >
              <p className="font-bold text-ink">{months[active].label}</p>
              <p className="text-ink-2">
                <strong className="tabular-nums text-ink">{months[active].hours}</strong>{" "}
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
        <table className="mt-2 w-full text-left text-xs">
          <thead>
            <tr className="text-ink-3">
              <th className="py-1.5 pr-3 font-semibold">{labels.month}</th>
              <th className="py-1.5 text-right font-semibold">{labels.hours}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {months.map((m) => (
              <tr key={m.month}>
                <th scope="row" className="py-1.5 pr-3 font-semibold text-ink">
                  {m.label}
                </th>
                <td className="py-1.5 text-right tabular-nums">{m.hours}</td>
              </tr>
            ))}
          </tbody>
        </table>
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

/** 4px rounded data end on top, square at the baseline. */
function roundedTop(x: number, y: number, w: number, h: number): string {
  const r = Math.min(4, h, w / 2);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}
