"use client";

import React from "react";
import { MetricsDriftPoint, PolicyChangeMarker } from "@/types/contracts";

export interface CleanRateChartProps {
  drift?: MetricsDriftPoint[];
  policyChanges?: PolicyChangeMarker[];
  loading?: boolean;
}

export const CleanRateChart: React.FC<CleanRateChartProps> = ({
  drift = [],
  policyChanges = [],
  loading = false,
}) => {
  if (loading) {
    return (
      <div className="w-full bg-white rounded-lg border border-outline-dim p-7 md:p-8 shadow-xs mb-14">
        <div className="flex items-center justify-between pb-6 border-b border-surface-dim mb-6">
          <h2 className="font-mono text-[11px] font-semibold text-on-surface uppercase tracking-wider">
            First-pass clean rate
          </h2>
          <span className="font-mono text-[11px] text-outline">Loading metrics...</span>
        </div>
        <div className="w-full h-60 flex items-center justify-center font-mono text-[12px] text-on-surface-variant">
          <span className="w-2 h-2 rounded-full bg-accent-ochre animate-pulse mr-2"></span>
          Loading drift history...
        </div>
      </div>
    );
  }

  const hasData = drift && drift.length > 0;
  const latestRate = hasData ? drift[drift.length - 1].first_pass_clean_rate : null;

  // Chart coordinate mapping
  const paddingX = 60;
  const usableWidth = 1000 - 2 * paddingX;
  const topY = 35;
  const bottomY = 195;
  const usableHeight = bottomY - topY;

  const points = hasData
    ? drift.map((d, i) => {
        const x =
          drift.length === 1
            ? 500
            : paddingX + (i / (drift.length - 1)) * usableWidth;
        const rate = Math.max(0, Math.min(1, d.first_pass_clean_rate ?? 0));
        const y = bottomY - rate * usableHeight;
        return { x, y, rate, windowEnd: d.window_end, runs: d.runs };
      })
    : [];

  const linePath =
    points.length > 1
      ? "M " + points.map((p) => `${p.x} ${p.y}`).join(" L ")
      : "";

  const areaPath =
    points.length > 1
      ? `M ${points[0].x} ${bottomY} L ` +
        points.map((p) => `${p.x} ${p.y}`).join(" L ") +
        ` L ${points[points.length - 1].x} ${bottomY} Z`
      : "";

  // Map policy changes to X positions if timestamp spans are available
  const policyMarkers = (policyChanges || []).map((pc) => {
    let pcX = 500;
    if (points.length >= 2) {
      const startMs = new Date(points[0].windowEnd).getTime();
      const endMs = new Date(points[points.length - 1].windowEnd).getTime();
      const pcMs = new Date(pc.at).getTime();
      if (endMs > startMs && !isNaN(pcMs)) {
        const ratio = Math.max(0, Math.min(1, (pcMs - startMs) / (endMs - startMs)));
        pcX = paddingX + ratio * usableWidth;
      }
    }
    return { ...pc, x: pcX };
  });

  const formatShortDate = (isoStr: string) => {
    try {
      const d = new Date(isoStr);
      if (isNaN(d.getTime())) return isoStr;
      return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    } catch {
      return isoStr;
    }
  };

  return (
    <div className="w-full bg-white rounded-lg border border-outline-dim p-7 md:p-8 shadow-xs mb-14">
      <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-2 pb-6 border-b border-surface-dim mb-6">
        <div className="flex items-center gap-3">
          <h2 className="font-mono text-[11px] font-semibold text-on-surface uppercase tracking-wider">
            First-pass clean rate
          </h2>
          <span className="text-outline-dim">·</span>
          <span className="font-mono text-[11px] text-on-surface-variant">
            Rolling clean window (last 10 runs)
          </span>
        </div>
        {latestRate !== null && (
          <div className="font-mono text-[11px] text-on-surface">
            Latest rate:{" "}
            <span className="font-semibold text-accent-ochre">
              {Math.round(latestRate * 100)}%
            </span>
          </div>
        )}
      </div>

      {!hasData ? (
        <div className="w-full h-60 flex flex-col items-center justify-center border border-dashed border-outline-dim rounded bg-[#faf8f0]/40 text-center px-4">
          <p className="font-mono text-[12px] text-on-surface-variant font-medium">
            No drift data recorded yet
          </p>
          <p className="font-mono text-[10px] text-outline mt-1 max-w-sm">
            Clean rate drift is computed from live verification runs. Complete runs to observe accuracy trends over time.
          </p>
        </div>
      ) : (
        <>
          {/* Chart Visual Container */}
          <div className="w-full relative">
            <svg
              className="w-full h-60 overflow-visible"
              fill="none"
              preserveAspectRatio="none"
              viewBox="0 0 1000 240"
            >
              <defs>
                <linearGradient id="curveGradient" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor="#fd6b36" stopOpacity="0.12" />
                  <stop offset="100%" stopColor="#fd6b36" stopOpacity="0.0" />
                </linearGradient>
                <pattern
                  height="32"
                  id="chartGridLines"
                  patternUnits="userSpaceOnUse"
                  width="1000"
                >
                  <line
                    stroke="#f4ede2"
                    strokeDasharray="2 3"
                    strokeWidth="1"
                    x1="0"
                    x2="1000"
                    y1="32"
                    y2="32"
                  />
                </pattern>
              </defs>

              {/* Horizontal Background Grid */}
              <rect fill="url(#chartGridLines)" height="160" width="1000" y="35" />
              <line stroke="#e0d9ce" strokeWidth="1" x1="0" x2="1000" y1={bottomY} y2={bottomY} />

              {/* Policy Change Markers */}
              {policyMarkers.map((marker, idx) => (
                <g key={`marker-${idx}`}>
                  <line
                    stroke="#ac3400"
                    strokeDasharray="3 3"
                    strokeWidth="1.5"
                    x1={marker.x}
                    x2={marker.x}
                    y1={25}
                    y2={bottomY}
                  />
                  <rect
                    fill="#ffffff"
                    height="18"
                    rx="3"
                    stroke="#ac3400"
                    strokeWidth="1"
                    width="120"
                    x={marker.x - 60}
                    y={5}
                  />
                  <text
                    className="font-mono text-[9px] font-semibold"
                    fill="#ac3400"
                    textAnchor="middle"
                    x={marker.x}
                    y={17}
                  >
                    ⚑ {marker.name} ({marker.from}→{marker.to})
                  </text>
                </g>
              ))}

              {/* Area Gradient Fill under Curve */}
              {areaPath && <path d={areaPath} fill="url(#curveGradient)" />}

              {/* Main Trend Line */}
              {linePath && (
                <path
                  d={linePath}
                  fill="none"
                  stroke="#1e1b15"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                />
              )}

              {/* Plotted Reference Points */}
              {points.map((pt, i) => {
                const isLast = i === points.length - 1;
                if (isLast) {
                  return (
                    <g key={`pt-${i}`}>
                      <circle
                        className="animate-ping"
                        cx={pt.x}
                        cy={pt.y}
                        fill="#ac3400"
                        fillOpacity="0.2"
                        r="6"
                        style={{ transformOrigin: `${pt.x}px ${pt.y}px` }}
                      />
                      <circle
                        cx={pt.x}
                        cy={pt.y}
                        fill="#ac3400"
                        r="4"
                        stroke="#ffffff"
                        strokeWidth="1.5"
                      />
                      <text
                        className="font-mono text-[10px] font-semibold"
                        fill="#ac3400"
                        textAnchor="middle"
                        x={pt.x}
                        y={pt.y - 10}
                      >
                        {Math.round(pt.rate * 100)}%
                      </text>
                    </g>
                  );
                }
                return (
                  <circle
                    cx={pt.x}
                    cy={pt.y}
                    fill="#ffffff"
                    key={`pt-${i}`}
                    r="3.5"
                    stroke="#1e1b15"
                    strokeWidth="1.5"
                  />
                );
              })}
            </svg>

            {/* Y-Axis Labels Overlay */}
            <div className="absolute left-0 top-0 h-[200px] -translate-x-1 sm:-translate-x-3 pointer-events-none flex flex-col justify-between font-mono text-[10px] text-outline">
              <span>100%</span>
              <span>80%</span>
              <span>60%</span>
              <span>40%</span>
              <span>20%</span>
              <span>0%</span>
            </div>
          </div>

          {/* X-Axis Labels */}
          <div className="w-full flex items-center justify-between pt-3 font-mono text-[11px] text-on-surface-variant px-1 border-t border-surface-dim">
            {points.length <= 4 ? (
              points.map((p, idx) => (
                <span key={`lbl-${idx}`} className={idx === points.length - 1 ? "font-semibold text-accent-ochre" : ""}>
                  {formatShortDate(p.windowEnd)} ({p.runs} runs)
                </span>
              ))
            ) : (
              <>
                <span>{formatShortDate(points[0].windowEnd)}</span>
                <span className="hidden sm:inline">
                  {formatShortDate(points[Math.floor(points.length / 2)].windowEnd)}
                </span>
                <span className="font-semibold text-accent-ochre">
                  {formatShortDate(points[points.length - 1].windowEnd)} ({points[points.length - 1].runs} runs)
                </span>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
};

