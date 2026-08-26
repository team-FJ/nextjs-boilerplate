"use client";

import { useMemo, useRef } from "react";
import {
  HAZARD_INUNDATED,
  HAZARD_MAPPED,
  HAZARD_ZONE,
} from "@/lib/route/hazard";
import type { RoutePoint } from "@/lib/route/search";

interface Props {
  points: RoutePoint[];
  /** 比較用（通常の最短ルート）。 */
  compare?: RoutePoint[] | null;
  /** 標高の足切りを表示するか（していない場合は線を出さない）。 */
  showElevationThreshold: boolean;
  minElevation: number;
  /** ハザードマップの帯を出すか。 */
  showHazard: boolean;
  onHover: (p: RoutePoint | null) => void;
}

/** 想定浸水深の帯の色。凡例の色に合わせてある。 */
function depthColor(depth: number, flags: number): string | null {
  if (!(flags & HAZARD_MAPPED)) return "#cbd5e1"; // 未整備
  if (flags & HAZARD_ZONE) return "#a16207";
  if (!(flags & HAZARD_INUNDATED)) return null; // 区域外＝色を塗らない
  if (Number.isNaN(depth)) return "#fca5a5"; // 区域内・深さ不明
  if (depth <= 0.5) return "#F7F5A9";
  if (depth <= 3) return "#FFD8C0";
  if (depth <= 5) return "#FFB7B7";
  if (depth <= 10) return "#FF9191";
  if (depth <= 20) return "#F285C9";
  return "#DC7ADC";
}

// パネル幅で描かれるので、viewBox は実寸に近くしておく。
// 大きくしすぎると縮小がかかって、目盛りの文字が読めなくなる。
const W = 420;
const H = 190;
const PAD_L = 34;
const PAD_R = 10;
const PAD_T = 16;
const PAD_B = 24;
const FONT = 11;

export default function ElevationProfile({
  points,
  compare,
  showElevationThreshold,
  minElevation,
  showHazard,
  onHover,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null);

  const view = useMemo(() => {
    const all = [...points, ...(compare ?? [])];
    const eles = all.map((p) => p.ele).filter((e) => !Number.isNaN(e));
    const xMax = Math.max(1, ...all.map((p) => p.dist));
    const lo = Math.min(minElevation, ...(eles.length ? eles : [0]));
    const hi = Math.max(minElevation + 1, ...(eles.length ? eles : [1]));
    const span = Math.max(5, hi - lo);
    const yMin = lo - span * 0.12;
    const yMax = hi + span * 0.12;
    const x = (d: number) => PAD_L + (d / xMax) * (W - PAD_L - PAD_R);
    const y = (e: number) =>
      H - PAD_B - ((e - yMin) / (yMax - yMin)) * (H - PAD_T - PAD_B);
    return { x, y, xMax, yMin, yMax };
  }, [points, compare, minElevation]);

  // 標高が取れない区間で線が飛ばないよう、連続部分ごとに分けて描く。
  const runs = useMemo(() => splitRuns(points), [points]);
  const compareRuns = useMemo(() => splitRuns(compare ?? []), [compare]);
  const thresholdY = view.y(minElevation);
  const areaBottom = H - PAD_B;

  // 想定浸水深の帯。区間ごとに「厳しいほう」の色で塗る。
  const hazardBands = useMemo(() => {
    const bands: { from: number; to: number; color: string }[] = [];
    for (let i = 1; i < points.length; i += 1) {
      const a = points[i - 1];
      const b = points[i];
      const flags = a.hazard | b.hazard;
      const depth =
        Number.isNaN(a.depth) || Number.isNaN(b.depth)
          ? Number.NaN
          : Math.max(a.depth, b.depth);
      const color = depthColor(depth, flags);
      if (!color) continue;
      const last = bands[bands.length - 1];
      if (last && last.color === color && last.to === a.dist) last.to = b.dist;
      else bands.push({ from: a.dist, to: b.dist, color });
    }
    return bands;
  }, [points]);

  const ticks = useMemo(() => {
    const step = niceStep((view.yMax - view.yMin) / 4);
    const out: number[] = [];
    for (let v = Math.ceil(view.yMin / step) * step; v <= view.yMax; v += step) {
      out.push(Number(v.toFixed(6)));
    }
    return out;
  }, [view]);

  const handleMove = (clientX: number) => {
    const svg = svgRef.current;
    if (!svg || points.length === 0) return;
    const rect = svg.getBoundingClientRect();
    const ratio = (clientX - rect.left) / rect.width;
    const px = ratio * W;
    const d =
      ((px - PAD_L) / (W - PAD_L - PAD_R)) * view.xMax;
    let best = points[0];
    let bestDiff = Infinity;
    for (const p of points) {
      const diff = Math.abs(p.dist - d);
      if (diff < bestDiff) {
        bestDiff = diff;
        best = p;
      }
    }
    onHover(best);
  };

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${W} ${H}`}
      className="h-auto w-full touch-none select-none"
      onMouseMove={(e) => handleMove(e.clientX)}
      onMouseLeave={() => onHover(null)}
      onTouchStart={(e) => handleMove(e.touches[0].clientX)}
      onTouchMove={(e) => handleMove(e.touches[0].clientX)}
      onTouchEnd={() => onHover(null)}
      role="img"
      aria-label="ルートの標高断面図"
    >
      {/* 指定標高より下の帯。ここに線が入っていなければ条件を満たしている。 */}
      {showElevationThreshold && (
        <>
          <rect
            x={PAD_L}
            y={thresholdY}
            width={W - PAD_L - PAD_R}
            height={Math.max(0, areaBottom - thresholdY)}
            fill="#ef4444"
            opacity={0.12}
          />
          <line
            x1={PAD_L}
            x2={W - PAD_R}
            y1={thresholdY}
            y2={thresholdY}
            stroke="#dc2626"
            strokeWidth={1.5}
            strokeDasharray="6 5"
          />
          <text x={PAD_L + 4} y={thresholdY - 4} fontSize={FONT} fill="#dc2626">
            通らない標高 {minElevation}m
          </text>
        </>
      )}

      {ticks.map((t) => (
        <g key={t}>
          <line
            x1={PAD_L}
            x2={W - PAD_R}
            y1={view.y(t)}
            y2={view.y(t)}
            stroke="currentColor"
            opacity={0.12}
          />
          <text
            x={PAD_L - 5}
            y={view.y(t) + 4}
            fontSize={FONT}
            textAnchor="end"
            fill="currentColor"
            opacity={0.6}
          >
            {t}
          </text>
        </g>
      ))}

      {compareRuns.map((run, i) => (
        <path
          key={`c${i}`}
          d={linePath(run, view.x, view.y)}
          fill="none"
          stroke="#94a3b8"
          strokeWidth={2}
          strokeDasharray="5 5"
        />
      ))}

      {runs.map((run, i) => (
        <g key={i}>
          <path
            d={`${linePath(run, view.x, view.y)} L ${view.x(
              run[run.length - 1].dist,
            )} ${areaBottom} L ${view.x(run[0].dist)} ${areaBottom} Z`}
            fill="#0d9488"
            opacity={0.18}
          />
          <path
            d={linePath(run, view.x, view.y)}
            fill="none"
            stroke="#0d9488"
            strokeWidth={2.5}
          />
        </g>
      ))}

      {showHazard &&
        hazardBands.map((band, i) => (
          <rect
            key={`h${i}`}
            x={view.x(band.from)}
            y={areaBottom + 2}
            width={Math.max(0.6, view.x(band.to) - view.x(band.from))}
            height={5}
            fill={band.color}
          />
        ))}

      <text
        x={W - PAD_R}
        y={H - 7}
        fontSize={FONT}
        textAnchor="end"
        fill="currentColor"
        opacity={0.6}
      >
        {(view.xMax / 1000).toFixed(2)} km
      </text>
      <text x={PAD_L} y={H - 7} fontSize={FONT} fill="currentColor" opacity={0.6}>
        0 km
      </text>
      <text
        x={6}
        y={PAD_T}
        fontSize={FONT}
        fill="currentColor"
        opacity={0.6}
      >
        m
      </text>
    </svg>
  );
}

function splitRuns(points: RoutePoint[]): RoutePoint[][] {
  const runs: RoutePoint[][] = [];
  let cur: RoutePoint[] = [];
  for (const p of points) {
    if (Number.isNaN(p.ele)) {
      if (cur.length > 1) runs.push(cur);
      cur = [];
    } else {
      cur.push(p);
    }
  }
  if (cur.length > 1) runs.push(cur);
  return runs;
}

function linePath(
  run: RoutePoint[],
  x: (d: number) => number,
  y: (e: number) => number,
): string {
  return run
    .map((p, i) => `${i === 0 ? "M" : "L"} ${x(p.dist).toFixed(1)} ${y(p.ele).toFixed(1)}`)
    .join(" ");
}

/** 目盛りを 1 / 2 / 5 の刻みに丸める。 */
function niceStep(raw: number): number {
  const exp = Math.floor(Math.log10(Math.max(raw, 1e-6)));
  const base = 10 ** exp;
  const n = raw / base;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * base;
}
