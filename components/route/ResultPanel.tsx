"use client";

import ElevationProfile from "./ElevationProfile";
import { HAZARD_MAPPED, HAZARD_ZONE } from "@/lib/route/hazard";
import type { RoutePoint, RouteResult, SearchResult } from "@/lib/route/search";
import type { RouteSettings } from "@/lib/route/settings";
import { OSM_ATTRIBUTION } from "@/lib/route/tiles";

interface Props {
  result: SearchResult | null;
  settings: RouteSettings;
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

/** 経路上の想定浸水深の要約。 */
function formatRouteDepth(r: RouteResult): string {
  const s = r.stats;
  if (s.depthUnknownM > 0 && s.maxDepth === 0) return "区域内（深さ不明）";
  if (s.inundatedM === 0) return "浸水想定なし";
  if (!Number.isFinite(s.maxDepth)) return "20m 以上";
  return `${s.maxDepth}m 未満`;
}

export default function ResultPanel({
  result,
  settings,
  showShortest,
  onHover,
  onDownloadGpx,
}: Props) {
  if (!result) {
    return (
      <div className="p-4 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
        <p>
          出発地と目的地を決めて「ルートを探す」を押すと、
          <strong>ハザードマップの想定浸水域を通らない</strong>経路を探します。
        </p>
        <p className="mt-2">
          道路データは OpenStreetMap、浸水想定はハザードマップポータルサイト、
          標高は国土地理院の標高タイルを、ブラウザから直接読み込んで計算します。
        </p>
      </div>
    );
  }

  const hazardOn = settings.hazardEnabled && settings.hazardDatasetIds.length > 0;
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
          条件に合うルートが見つかりませんでした。許容する浸水深を上げるか、
          目的地を近くの安全な場所に変えて試してください。
        </p>
      )}

      {main && (
        <>
          <div>
            <h2 className="mb-2 text-sm font-bold tracking-wide text-slate-500 dark:text-slate-400">
              {isFallback
                ? "到達できる範囲で最も安全な地点までのルート"
                : hazardOn
                  ? "浸水想定を避けたルート"
                  : `標高 ${settings.minElevation}m 以上だけを通るルート`}
            </h2>
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <Stat label="距離" value={formatDistance(main.stats.distanceM)} />
              <Stat label="所要時間" value={formatDuration(main.stats.durationSec)} />
              {hazardOn && (
                <Stat
                  label="最大想定浸水深"
                  value={formatRouteDepth(main)}
                  emphasis={main.stats.inundatedM === 0 ? "good" : "bad"}
                />
              )}
              <Stat
                label="最低標高"
                value={formatEle(main.stats.minElevation)}
                emphasis={
                  !settings.elevationEnabled
                    ? undefined
                    : main.stats.minElevation >= settings.minElevation
                      ? "good"
                      : "bad"
                }
              />
              <Stat label="最高標高" value={formatEle(main.stats.maxElevation)} />
              <Stat
                label="累積の上り"
                value={`${Math.round(main.stats.ascentM)} m`}
              />
            </dl>

            {hazardOn && (
              <ul className="mt-2 flex flex-col gap-0.5 text-sm">
                {main.stats.inundatedM > 0 && (
                  <li className="text-red-700 dark:text-red-400">
                    浸水想定区域の中を {formatDistance(main.stats.inundatedM)} 通ります。
                  </li>
                )}
                {main.stats.zoneM > 0 && (
                  <li className="text-amber-700 dark:text-amber-500">
                    土砂災害警戒区域の中を {formatDistance(main.stats.zoneM)} 通ります。
                  </li>
                )}
                {main.stats.unmappedM > 0 && (
                  <li className="text-slate-500 dark:text-slate-400">
                    ハザードマップ未整備の区域: {formatDistance(main.stats.unmappedM)}
                    （判定できていません）
                  </li>
                )}
              </ul>
            )}

            {settings.elevationEnabled && main.stats.belowThresholdM > 0 && (
              <p className="mt-2 text-sm text-red-700 dark:text-red-400">
                指定標高を下回る区間が {formatDistance(main.stats.belowThresholdM)}
                含まれます。
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
              標高の断面と浸水想定
            </h2>
            <ElevationProfile
              points={main.points}
              compare={showShortest ? result.shortest?.points ?? null : null}
              showElevationThreshold={settings.elevationEnabled}
              minElevation={settings.minElevation}
              showHazard={hazardOn}
              onHover={onHover}
            />
            <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">
              なぞると、その地点が地図上に表示されます。
              {hazardOn && "下の帯が想定浸水深です（色が濃いほど深い／灰色は未整備）。"}
              {settings.elevationEnabled && "赤い帯が「通らない標高」です。"}
            </p>
          </div>

          {result.shortest && showShortest && (
            <Comparison
              safe={main}
              shortest={result.shortest}
              settings={settings}
              hazardOn={hazardOn}
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
        {result.hazardSourceLabels.length > 0 && (
          <p>浸水想定: {result.hazardSourceLabels.join(" / ")}（ハザードマップポータルサイト）</p>
        )}
        {result.demSourceLabels.length > 0 && (
          <p>標高: {result.demSourceLabels.join(" / ")}</p>
        )}
        <p>
          道路 {result.graphSummary.ways.toLocaleString()} 本 / 交差点{" "}
          {result.graphSummary.nodes.toLocaleString()} 点から計算
        </p>
        <p className="mt-2 text-amber-700 dark:text-amber-500">
          ハザードマップは想定であり、実際の浸水域・通行止め・建物の状況とは異なります。
          避難の際は必ず自治体の指示を優先してください。
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
  settings,
  hazardOn,
}: {
  safe: RouteResult;
  shortest: RouteResult;
  settings: RouteSettings;
  hazardOn: boolean;
}) {
  const extra = safe.stats.distanceM - shortest.stats.distanceM;
  const extraSec = safe.stats.durationSec - shortest.stats.durationSec;
  const shortestMapped =
    shortest.points.some((p) => p.hazard & HAZARD_MAPPED) ||
    shortest.points.some((p) => p.hazard & HAZARD_ZONE);
  return (
    <div className="rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-700">
      <h2 className="mb-1 text-sm font-bold tracking-wide text-slate-500 dark:text-slate-400">
        通常の最短ルートとの比較
      </h2>
      <p>
        最短ルートは {formatDistance(shortest.stats.distanceM)}、
        最低標高 {formatEle(shortest.stats.minElevation)}。
      </p>
      {hazardOn && shortestMapped && shortest.stats.inundatedM > 0 && (
        <p className="mt-1 text-red-700 dark:text-red-400">
          最短ルートは浸水想定区域を {formatDistance(shortest.stats.inundatedM)} 通り、
          最も深いところで {formatRouteDepth(shortest)} 浸かる想定です。
        </p>
      )}
      {settings.elevationEnabled && shortest.stats.belowThresholdM > 0 && (
        <p className="mt-1 text-red-700 dark:text-red-400">
          最短ルートは標高 {settings.minElevation}m 未満の区間を
          {formatDistance(shortest.stats.belowThresholdM)}通ります。
        </p>
      )}
      <p className="mt-1">
        避けたルートは {extra >= 0 ? "+" : ""}
        {formatDistance(Math.abs(extra))}
        {extra >= 0 ? "長く" : "短く"}、時間差は約{" "}
        {Math.abs(Math.round(extraSec / 60))} 分です。
      </p>
    </div>
  );
}
