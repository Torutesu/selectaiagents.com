"use client";

import { useEffect, useRef, useState } from "react";

export interface ChartSeries {
  key: string;
  label: string;
  values: number[];
  /** CSS color, normally a `var(--series-n)` token. */
  color: string;
}

const HEIGHT = 240;
const M = { top: 8, right: 16, bottom: 24, left: 44 };
const GAP = 2;
const RADIUS = 4;

function compact(n: number) {
  return new Intl.NumberFormat("en", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n);
}

function niceMax(v: number): { max: number; step: number } {
  if (v <= 0) return { max: 1, step: 1 };
  const raw = v / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step =
    [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  return { max: Math.ceil(v / step) * step, step };
}

function shortDate(iso: string) {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** Column path with a rounded top (data end) and a square base. */
function topRounded(x: number, y: number, w: number, h: number) {
  const r = Math.min(RADIUS, h, w / 2);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

/** Daily stacked columns (or plain columns for one series), OpenRouter-rankings style. */
export function UsageChart({
  days,
  series,
  label,
}: {
  days: string[];
  series: ChartSeries[];
  label: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const totals = days.map((_, i) =>
    series.reduce((s, x) => s + x.values[i], 0),
  );
  const { max, step } = niceMax(Math.max(...totals));
  const plotW = Math.max(width - M.left - M.right, 0);
  const plotH = HEIGHT - M.top - M.bottom;
  const band = plotW / days.length;
  const barW = Math.min(24, Math.max(band - GAP, 1));
  const y = (v: number) => M.top + plotH - (v / max) * plotH;
  const ticks = Array.from(
    { length: Math.round(max / step) + 1 },
    (_, i) => i * step,
  );

  const tipLeft =
    hover === null
      ? 0
      : Math.min(Math.max(M.left + band * (hover + 0.5), 90), width - 90);

  return (
    <figure className="space-y-3">
      {series.length > 1 && (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
          {series.map((s) => (
            <li key={s.key} className="flex items-center gap-1.5">
              <span
                className="inline-block h-2.5 w-2.5 rounded-sm"
                style={{ background: s.color }}
              />
              {s.label}
            </li>
          ))}
        </ul>
      )}
      <div ref={ref} className="relative" onPointerLeave={() => setHover(null)}>
        {width > 0 && (
          <svg width={width} height={HEIGHT} role="img" aria-label={label}>
            {ticks.map((t) => (
              <g key={t}>
                <line
                  x1={M.left}
                  x2={width - M.right}
                  y1={y(t)}
                  y2={y(t)}
                  stroke="var(--color-line)"
                  strokeWidth={1}
                />
                <text
                  x={M.left - 8}
                  y={y(t)}
                  dy="0.32em"
                  textAnchor="end"
                  fontSize={11}
                  fill="var(--color-muted)"
                >
                  {compact(t)}
                </text>
              </g>
            ))}
            {days.map((d, i) =>
              i % 7 === (days.length - 1) % 7 ? (
                <text
                  key={d}
                  x={M.left + band * (i + 0.5)}
                  y={HEIGHT - 6}
                  textAnchor="middle"
                  fontSize={11}
                  fill="var(--color-muted)"
                >
                  {shortDate(d)}
                </text>
              ) : null,
            )}
            {days.map((d, i) => {
              const x = M.left + band * i + (band - barW) / 2;
              let acc = 0;
              const segs = series
                .map((s) => {
                  const v = s.values[i];
                  const y0 = y(acc);
                  acc += v;
                  return { s, v, top: y(acc), bottom: y0 };
                })
                .filter((g) => g.v > 0);
              return (
                <g
                  key={d}
                  tabIndex={0}
                  aria-label={`${shortDate(d)}: ${compact(totals[i])} calls`}
                  onPointerEnter={() => setHover(i)}
                  onFocus={() => setHover(i)}
                  onBlur={() => setHover(null)}
                  className="outline-none"
                  opacity={hover === null || hover === i ? 1 : 0.55}
                >
                  <rect
                    x={M.left + band * i}
                    y={M.top}
                    width={band}
                    height={plotH}
                    fill="transparent"
                  />
                  {segs.map((g, j) => {
                    const h = Math.max(
                      g.bottom - g.top - (j > 0 ? GAP : 0),
                      0.5,
                    );
                    return j === segs.length - 1 ? (
                      <path
                        key={g.s.key}
                        d={topRounded(x, g.top, barW, h)}
                        fill={g.s.color}
                      />
                    ) : (
                      <rect
                        key={g.s.key}
                        x={x}
                        y={g.top}
                        width={barW}
                        height={h}
                        fill={g.s.color}
                      />
                    );
                  })}
                </g>
              );
            })}
          </svg>
        )}
        {hover !== null && (
          <div
            className="pointer-events-none absolute top-0 z-10 w-44 -translate-x-1/2 rounded-lg border border-line bg-surface p-2.5 text-xs shadow-lg"
            style={{ left: tipLeft }}
          >
            <div className="mb-1.5 flex justify-between text-muted">
              <span>{shortDate(days[hover])}</span>
              <span className="font-semibold text-ink">
                {compact(totals[hover])}
              </span>
            </div>
            {series.length > 1 &&
              [...series].reverse().map((s) => (
                <div key={s.key} className="flex items-center gap-1.5 py-0.5">
                  <span
                    className="inline-block h-0.5 w-3 rounded"
                    style={{ background: s.color }}
                  />
                  <span className="flex-1 truncate text-muted">{s.label}</span>
                  <span className="font-semibold tabular-nums text-ink">
                    {compact(s.values[hover])}
                  </span>
                </div>
              ))}
          </div>
        )}
      </div>
    </figure>
  );
}
