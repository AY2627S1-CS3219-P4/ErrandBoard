import { useId, useState } from "react";
import type { CreditDistributionBin } from "../api/adminStats";
import "./CreditHistogram.css";

interface CreditHistogramProps {
  bins: CreditDistributionBin[];
  /** Total accounts, used to show each bar's share in the tooltip. */
  total: number;
  loading?: boolean;
}

// Single-series magnitude chart (a histogram of available-credit balances): column bars,
// one hue (the app accent), recessive baseline, per-bar hover tooltip, no legend (the
// heading names it). Rendered as inline SVG so it themes with the app's CSS tokens.
export function CreditHistogram({ bins, total, loading = false }: CreditHistogramProps) {
  const titleId = useId();
  const [hovered, setHovered] = useState<number | null>(null);

  // Geometry in a fixed viewBox; the SVG scales responsively to its container width.
  const width = 560;
  const height = 240;
  const pad = { top: 16, right: 16, bottom: 44, left: 40 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  const maxCount = Math.max(1, ...bins.map((b) => b.count));
  // "Nice" top: round the axis max up so gridlines land on round numbers.
  const axisMax = niceMax(maxCount);
  const barGap = 10;
  const barW = bins.length > 0 ? (plotW - barGap * (bins.length - 1)) / bins.length : 0;

  const y = (count: number) => pad.top + plotH - (count / axisMax) * plotH;
  const ticks = axisTicks(axisMax);

  if (loading) {
    return <div className="credit-histogram-empty" role="status">Loading distribution…</div>;
  }

  const hasData = bins.some((b) => b.count > 0);

  return (
    <figure className="credit-histogram" aria-labelledby={titleId}>
      <figcaption id={titleId} className="credit-histogram-caption">
        Available-credit distribution — accounts per balance band
      </figcaption>

      <div className="credit-histogram-plot">
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Histogram of accounts by available-credit band" preserveAspectRatio="xMidYMid meet">
          {/* horizontal gridlines + y labels */}
          {ticks.map((t) => (
            <g key={t}>
              <line
                className="credit-histogram-grid"
                x1={pad.left}
                x2={width - pad.right}
                y1={y(t)}
                y2={y(t)}
              />
              <text className="credit-histogram-axis-label" x={pad.left - 8} y={y(t)} textAnchor="end" dominantBaseline="middle">
                {t}
              </text>
            </g>
          ))}

          {/* baseline */}
          <line className="credit-histogram-baseline" x1={pad.left} x2={width - pad.right} y1={pad.top + plotH} y2={pad.top + plotH} />

          {/* bars */}
          {bins.map((bin, i) => {
            const x = pad.left + i * (barW + barGap);
            const barH = (bin.count / axisMax) * plotH;
            const isHovered = hovered === i;
            return (
              <g
                key={bin.label}
                onMouseEnter={() => setHovered(i)}
                onMouseLeave={() => setHovered((cur) => (cur === i ? null : cur))}
              >
                {/* full-height hit target so hover works even over empty bins */}
                <rect x={x} y={pad.top} width={barW} height={plotH} fill="transparent" />
                <rect
                  className={`credit-histogram-bar ${isHovered ? "is-hovered" : ""}`}
                  x={x}
                  y={pad.top + plotH - barH}
                  width={barW}
                  height={Math.max(bin.count > 0 ? 2 : 0, barH)}
                  rx={4}
                />
                {/* direct count label above each non-empty bar */}
                {bin.count > 0 && (
                  <text className="credit-histogram-value" x={x + barW / 2} y={pad.top + plotH - barH - 6} textAnchor="middle">
                    {bin.count}
                  </text>
                )}
                {/* x-axis band label */}
                <text className="credit-histogram-axis-label" x={x + barW / 2} y={pad.top + plotH + 18} textAnchor="middle">
                  {bin.label}
                </text>
              </g>
            );
          })}
        </svg>

        {/* tooltip */}
        {hovered !== null && bins[hovered] && (
          <div className="credit-histogram-tooltip" role="tooltip">
            <strong>{bins[hovered].label} credits</strong>
            <span>
              {bins[hovered].count} {bins[hovered].count === 1 ? "account" : "accounts"}
              {total > 0 && ` · ${Math.round((bins[hovered].count / total) * 100)}%`}
            </span>
          </div>
        )}
      </div>

      {!hasData && <p className="credit-histogram-empty">No credit accounts yet.</p>}

      <p className="credit-histogram-xtitle">Available balance (credits)</p>
    </figure>
  );
}

// Round an axis maximum up to a readable round number.
function niceMax(value: number): number {
  if (value <= 5) return 5;
  if (value <= 10) return 10;
  const magnitude = Math.pow(10, Math.floor(Math.log10(value)));
  const step = magnitude / 2;
  return Math.ceil(value / step) * step;
}

// Up to ~4 evenly spaced integer ticks including 0 and the max.
function axisTicks(max: number): number[] {
  const count = 4;
  const step = max / count;
  const ticks: number[] = [];
  for (let i = 0; i <= count; i++) {
    const t = Math.round(step * i);
    if (ticks[ticks.length - 1] !== t) ticks.push(t);
  }
  return ticks;
}
