"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import ControlPanel, { type PickTarget } from "./ControlPanel";
import MapView from "./MapView";
import ResultPanel from "./ResultPanel";
import { boundsOf, haversine, type BBox, type LatLng } from "@/lib/route/geo";
import { toGpx } from "@/lib/route/gpx";
import {
  searchRoute,
  type RoutePoint,
  type SearchProgress,
  type SearchResult,
} from "@/lib/route/search";
import {
  DEFAULT_SETTINGS,
  loadSettings,
  saveSettings,
  toCostOptions,
  type RouteSettings,
} from "@/lib/route/settings";

export default function RouteApp() {
  const [settings, setSettings] = useState<RouteSettings>(DEFAULT_SETTINGS);
  const [start, setStart] = useState<LatLng | null>(null);
  const [goal, setGoal] = useState<LatLng | null>(null);
  const [pick, setPick] = useState<PickTarget>("start");
  const [result, setResult] = useState<SearchResult | null>(null);
  const [progress, setProgress] = useState<SearchProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hover, setHover] = useState<RoutePoint | null>(null);
  const [fitBounds, setFitBounds] = useState<BBox | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  useEffect(() => setSettings(loadSettings()), []);
  useEffect(() => () => abortRef.current?.abort(), []);

  // 結果は設定欄の下に積まれるので、探索が終わったらそこまで送る。
  // 描画が済んでから動かしたいので、result の更新後の効果として実行する。
  useEffect(() => {
    if (result) {
      resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [result]);

  const change = useCallback((patch: Partial<RouteSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      saveSettings(next);
      return next;
    });
  }, []);

  const setPoint = useCallback((which: "start" | "goal", p: LatLng | null) => {
    if (which === "start") setStart(p);
    else setGoal(p);
    // 住所検索や現在地から決めたときも、地図タップの案内は引っ込める。
    if (p) setPick((cur) => (cur === which ? null : cur));
  }, []);

  const handleMapClick = useCallback(
    (p: LatLng) => {
      const target: PickTarget = pick ?? (!start ? "start" : !goal ? "goal" : null);
      if (!target) return;
      setPoint(target, p);
      // 出発地を置いたら、そのまま目的地の指定へ進む。
      setPick(target === "start" && !goal ? "goal" : null);
    },
    [pick, start, goal, setPoint],
  );

  const run = useCallback(async () => {
    if (!start || !goal) return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setError(null);
    setResult(null);
    setHover(null);
    setProgress({ stage: "roads", message: "準備しています…" });
    try {
      const res = await searchRoute({
        start,
        goal,
        profileId: settings.profileId,
        cost: toCostOptions(settings),
        highPrecisionDem: settings.highPrecisionDem,
        hazardDatasetIds: settings.hazardDatasetIds,
        hazardSampleRadius: settings.hazardSampleRadius,
        signal: ctrl.signal,
        onProgress: (p) => {
          if (!ctrl.signal.aborted) setProgress(p);
        },
      });
      if (ctrl.signal.aborted) return;
      setResult(res);
      setFitBounds(routeBounds(res, start, goal));
    } catch (e) {
      if (ctrl.signal.aborted) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (!ctrl.signal.aborted) setProgress(null);
    }
  }, [start, goal, settings]);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    setProgress(null);
  }, []);

  const mainRoute = result?.safe ?? result?.fallback?.route ?? null;

  const downloadGpx = useCallback(() => {
    if (!mainRoute) return;
    const blob = new Blob([toGpx(mainRoute.points, "避難ルート")], {
      type: "application/gpx+xml",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "hinan-route.gpx";
    a.click();
    URL.revokeObjectURL(url);
  }, [mainRoute]);

  const safeLine = useMemo(
    () => result?.safe?.points.map((p) => ({ lat: p.lat, lon: p.lon })) ?? null,
    [result],
  );
  const shortestLine = useMemo(
    () => result?.shortest?.points.map((p) => ({ lat: p.lat, lon: p.lon })) ?? null,
    [result],
  );
  const fallbackLine = useMemo(
    () =>
      !result?.safe && result?.fallback
        ? result.fallback.route.points.map((p) => ({ lat: p.lat, lon: p.lon }))
        : null,
    [result],
  );

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-white text-slate-900 lg:flex-row dark:bg-slate-950 dark:text-slate-100">
      <div className="relative order-1 h-[52vh] w-full shrink-0 lg:order-2 lg:h-full lg:flex-1">
        <MapView
          start={start}
          goal={goal}
          onPick={handleMapClick}
          onMoveStart={(p) => setStart(p)}
          onMoveGoal={(p) => setGoal(p)}
          safeLine={safeLine}
          shortestLine={shortestLine}
          fallbackLine={fallbackLine}
          fallbackPoint={
            !result?.safe && result?.fallback ? result.fallback.point : null
          }
          hover={hover ? { lat: hover.lat, lon: hover.lon } : null}
          baseLayerId={settings.baseLayerId}
          overlayIds={settings.overlayIds}
          overlayOpacity={settings.overlayOpacity}
          showShortest={settings.showShortest}
          fitBounds={fitBounds}
        />
        {pick && (
          <div className="pointer-events-none absolute left-1/2 top-3 z-[1000] -translate-x-1/2 rounded-full bg-slate-900/85 px-4 py-1.5 text-sm text-white shadow">
            {pick === "start" ? "出発地" : "目的地"}を地図でタップしてください
          </div>
        )}
        {progress && (
          <div className="absolute left-1/2 top-1/2 z-[1000] flex -translate-x-1/2 -translate-y-1/2 items-center gap-3 rounded-lg bg-slate-900/90 px-4 py-3 text-sm text-white shadow-lg">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            <span>{progress.message}</span>
            <button
              type="button"
              onClick={cancel}
              className="rounded border border-white/40 px-2 py-0.5 text-xs"
            >
              中止
            </button>
          </div>
        )}
        {hover && (
          <div className="absolute bottom-3 left-1/2 z-[1000] -translate-x-1/2 rounded bg-slate-900/85 px-3 py-1 text-xs tabular-nums text-white">
            {(hover.dist / 1000).toFixed(2)} km 地点 / 標高{" "}
            {Number.isNaN(hover.ele) ? "不明" : `${hover.ele.toFixed(1)} m`}
          </div>
        )}
      </div>

      <aside className="order-2 flex w-full flex-1 flex-col overflow-y-auto border-t border-slate-200 lg:order-1 lg:h-full lg:w-[400px] lg:flex-none lg:border-r lg:border-t-0 dark:border-slate-800">
        <header className="border-b border-slate-200 px-4 py-3 dark:border-slate-800">
          <h1 className="text-lg font-bold">避難ルート検索</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            ハザードマップの浸水想定を通らない経路を探します
          </p>
        </header>

        {error && (
          <p className="m-4 rounded border-l-4 border-red-600 bg-red-50 px-3 py-2 text-sm dark:bg-red-950/30">
            {error}
          </p>
        )}

        <ControlPanel
          settings={settings}
          onChange={change}
          start={start}
          goal={goal}
          pick={pick}
          onPickChange={setPick}
          onSetPoint={setPoint}
          onSwap={() => {
            setStart(goal);
            setGoal(start);
          }}
          onSearch={() => void run()}
          running={progress !== null}
          canSearch={!!start && !!goal}
          directDistanceM={start && goal ? haversine(start, goal) : null}
        />

        <div ref={resultRef} className="border-t border-slate-200 dark:border-slate-800">
          <ResultPanel
            result={result}
            settings={settings}
            showShortest={settings.showShortest}
            onHover={setHover}
            onDownloadGpx={downloadGpx}
          />
        </div>
      </aside>
    </div>
  );
}

/** 表示すべきものが全部収まる範囲を返す。 */
function routeBounds(res: SearchResult, start: LatLng, goal: LatLng): BBox {
  const pts: LatLng[] = [start, goal];
  for (const r of [res.safe, res.shortest, res.fallback?.route]) {
    if (r) for (const p of r.points) pts.push({ lat: p.lat, lon: p.lon });
  }
  return boundsOf(pts, 150);
}
