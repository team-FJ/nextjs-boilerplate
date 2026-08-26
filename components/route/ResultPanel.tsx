"use client";

import ElevationProfile from "./ElevationProfile";
import type { RoutePoint, RouteResult, SearchResult } from "@/lib/route/search";
import { OSM_ATTRIBUTION } from "@/lib/route/tiles";

interface Props {
  result: SearchResult | null;
  minElevation: number;
  showShortest: boolean;
  onHover: (p: RoutePoint | null) => void;
  onDownloadGpx: () => void;
}

export function formatDistance(m: number): string {
  if (!Number.isFinite(m)) return "—";
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(2)} km`;
}

export function formatDuration(sec: number): string {
  if (!Number.isFinite(sec)) return "—";
  const min = Math.round(sec / 60);
  if (min < 60) return `約 ${min} 分`;
  return `約 ${Math.floor(min / 60)} 時間 ${min % 60} 分`;
}

function formatEle(v: number): string {
  return Number.isNaN(v) ? "不明" : `${v.toFixed(1)} m`;
}

export default function ResultPanel({
  result,
  minElevation,
  showShortest,
  onHover,
  onDownloadGpx,
}: Props) {
  if (!result) {
    return (
      <div className="p-4 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
        <p>
          出発地と目的地を決めて「ルートを探す」を押すと、
          <strong>指定した標高より低い道を一切使わない</strong>経路を探します。
        </p>
        <p className="mt-2">
          道路データは OpenStreetMap、標高は国土地理院の標高タイルを、
          ブラウザから直接読み込んで計算します。
        </p>
      </div>
    );
  }

  const main = result.safe ?? result.fallback?.route ?? null;
  const isFallback = !result.safe && !!result.fallback;

  return (
    <div className="flex flex-col gap-4 p-4">
      {result.warnings.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {result.warnings.map((w, i) => (
            <li
              key={i}
              className="rounded border-l-4 border-amber-500 bg-amber-50 px-3 py-2 text-sm leading-relaxed dark:bg-amber-950/30"
            >
              {w}
            </li>
          ))}
        </ul>
      )}

      {!main && (
        <p className="rounded border-l-4 border-red-600 bg-red-50 px-3 py-2 text-sm dark:bg-red-950/30">
          条件に合うルートが見つかりませんでした。「通らない標高」を下げるか、
          目的地を近くの高台に変えて試してください。
        </p>
      )}

      {main && (
        <>
          <div>
            <h2 className="mb-2 text-sm font-bold tracking-wide text-slate-500 dark:text-slate-400">
              {isFallback
                ? "到達できる範囲で最も高い地点までのルート"
                : `標高 ${minElevation}m 以上だけを通るルート`}
            </h2>
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <Stat label="距離" value={formatDistance(main.stats.distanceM)} />
              <Stat label="所要時間" value={formatDuration(main.stats.durationSec)} />
              <Stat
                label="最低標高"
                value={formatEle(main.stats.minElevation)}
                emphasis={
                  main.stats.minElevation >= minElevation ? "good" : "bad"
                }
              />
              <Stat label="平均標高" value={formatEle(main.stats.avgElevation)} />
              <Stat label="最高標高" value={formatEle(main.stats.maxElevation)} />
              <Stat
                label="累積の上り"
                value={`${Math.round(main.stats.ascentM)} m`}
              />
            </dl>
            {main.stats.belowThresholdM > 0 && (
              <p className="mt-2 text-sm text-red-700 dark:text-red-400">
                このルートには指定標高を下回る区間が
                {formatDistance(main.stats.belowThresholdM)}含まれます。
              </p>
            )}
            {main.stats.unknownM > 0 && (
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                標高が分からない区間: {formatDistance(main.stats.unknownM)}
              </p>
            )}
            {main.roadNames.length > 0 && (
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                主な道: {main.roadNames.join(" → ")}
              </p>
            )}
          </div>

          <div>
            <h2 className="mb-1 text-sm font-bold tracking-wide text-slate-500 dark:text-slate-400">
              標高の断面
            </h2>
            <ElevationProfile
              points={main.points}
              compare={showShortest ? result.shortest?.points ?? null : null}
              minElevation={minElevation}
              onHover={onHover}
            />
            <p className="text-xs text-slate-500 dark:text-slate-400">
              なぞると、その地点が地図上に表示されます。赤い帯が「通らない標高」です。
            </p>
          </div>

          {result.shortest && showShortest && (
            <Comparison
              safe={main}
              shortest={result.shortest}
              minElevation={minElevation}
            />
          )}

          <button
            type="button"
            onClick={onDownloadGpx}
            className="self-start rounded border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-800"
          >
            GPX で保存する
          </button>
        </>
      )}

      <footer className="border-t border-slate-200 pt-3 text-xs leading-relaxed text-slate-500 dark:border-slate-700 dark:text-slate-400">
        <p dangerouslySetInnerHTML={{ __html: OSM_ATTRIBUTION }} />
        {result.demSourceLabels.length > 0 && (
          <p>標高: {result.demSourceLabels.join(" / ")}</p>
        )}
        <p>
          道路 {result.graphSummary.ways.toLocaleString()} 本 / 交差点{" "}
          {result.graphSummary.nodes.toLocaleString()} 点から計算
        </p>
        <p className="mt-2 text-amber-700 dark:text-amber-500">
          標高データは地形の高さであり、実際の浸水域・通行止め・建物の状況は反映していません。
          避難の際は必ず自治体の指示とハザードマップを優先してください。
        </p>
      </footer>
    </div>
  );
}

function Stat({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: string;
  emphasis?: "good" | "bad";
}) {
  const tone =
    emphasis === "good"
      ? "text-teal-700 dark:text-teal-400"
      : emphasis === "bad"
        ? "text-red-700 dark:text-red-400"
        : "";
  return (
    <div
      data-stat={label}
      className="rounded border border-slate-200 px-2 py-1.5 dark:border-slate-700"
    >
      <dt className="text-xs text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className={`text-base font-bold tabular-nums ${tone}`}>{value}</dd>
    </div>
  );
}

function Comparison({
  safe,
  shortest,
  minElevation,
}: {
  safe: RouteResult;
  shortest: RouteResult;
  minElevation: number;
}) {
  const extra = safe.stats.distanceM - shortest.stats.distanceM;
  const extraSec = safe.stats.durationSec - shortest.stats.durationSec;
  return (
    <div className="rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-700">
      <h2 className="mb-1 text-sm font-bold tracking-wide text-slate-500 dark:text-slate-400">
        通常の最短ルートとの比較
      </h2>
      <p>
        最短ルートは {formatDistance(shortest.stats.distanceM)}、
        最低標高 {formatEle(shortest.stats.minElevation)}。
      </p>
      {shortest.stats.belowThresholdM > 0 && (
        <p className="mt-1 text-red-700 dark:text-red-400">
          最短ルートは標高 {minElevation}m 未満の区間を
          {formatDistance(shortest.stats.belowThresholdM)}通ります。
        </p>
      )}
      <p className="mt-1">
        高台ルートは {extra >= 0 ? "+" : ""}
        {formatDistance(Math.abs(extra))}
        {extra >= 0 ? "長く" : "短く"}、時間差は約{" "}
        {Math.abs(Math.round(extraSec / 60))} 分です。
      </p>
    </div>
  );
}
