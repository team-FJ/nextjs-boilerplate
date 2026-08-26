"use client";

import { useEffect, useRef, useState } from "react";
import { geocode, type GeocodeHit } from "@/lib/route/geocode";
import type { LatLng } from "@/lib/route/geo";
import { PROFILES } from "@/lib/route/profiles";
import { PRESETS, type RouteSettings } from "@/lib/route/settings";
import { BASE_LAYERS, HAZARD_LAYERS } from "@/lib/route/tiles";

export type PickTarget = "start" | "goal" | null;

interface Props {
  settings: RouteSettings;
  onChange: (patch: Partial<RouteSettings>) => void;
  start: LatLng | null;
  goal: LatLng | null;
  pick: PickTarget;
  onPickChange: (t: PickTarget) => void;
  onSetPoint: (which: "start" | "goal", p: LatLng | null) => void;
  onSwap: () => void;
  onSearch: () => void;
  running: boolean;
  canSearch: boolean;
  /** 2 地点の直線距離[m]。広すぎるときに注意を出すために使う。 */
  directDistanceM: number | null;
}

export default function ControlPanel(p: Props) {
  const { settings: s, onChange } = p;
  const activePreset = PRESETS.find(
    (x) => x.minElevation === s.minElevation && x.safetyMargin === s.safetyMargin,
  );

  return (
    <div className="flex flex-col gap-5 p-4">
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-bold tracking-wide text-slate-500 dark:text-slate-400">
          1. 地点を決める
        </h2>
        <PointRow
          label="出発地"
          testId="point-start"
          accent="bg-teal-700"
          point={p.start}
          picking={p.pick === "start"}
          onPick={() => p.onPickChange(p.pick === "start" ? null : "start")}
          onResolve={(hit) => p.onSetPoint("start", hit)}
          onClear={() => p.onSetPoint("start", null)}
          allowGeolocation
        />
        <PointRow
          label="目的地"
          testId="point-goal"
          accent="bg-red-700"
          point={p.goal}
          picking={p.pick === "goal"}
          onPick={() => p.onPickChange(p.pick === "goal" ? null : "goal")}
          onResolve={(hit) => p.onSetPoint("goal", hit)}
          onClear={() => p.onSetPoint("goal", null)}
        />
        <button
          type="button"
          onClick={p.onSwap}
          className="self-start rounded border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          出発地と目的地を入れ替える
        </button>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-bold tracking-wide text-slate-500 dark:text-slate-400">
          2. 通らない標高を決める
        </h2>
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-700/60 dark:bg-amber-950/30">
          <label className="flex items-baseline gap-2 text-sm font-medium">
            標高
            <input
              type="number"
              value={s.minElevation}
              min={-10}
              max={500}
              step={1}
              onChange={(e) =>
                onChange({ minElevation: clampNumber(e.target.value, -10, 500, 0) })
              }
              className="w-24 rounded border border-slate-300 bg-white px-2 py-1 text-right text-lg font-bold tabular-nums dark:border-slate-600 dark:bg-slate-900"
            />
            m 未満の道は通らない
          </label>
          <input
            type="range"
            min={0}
            max={60}
            step={1}
            value={Math.min(60, Math.max(0, s.minElevation))}
            onChange={(e) => onChange({ minElevation: Number(e.target.value) })}
            className="mt-2 w-full accent-amber-600"
            aria-label="通らない標高"
          />
          <div className="mt-2 flex flex-wrap gap-1.5">
            {PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                title={preset.description}
                onClick={() =>
                  onChange({
                    minElevation: preset.minElevation,
                    safetyMargin: preset.safetyMargin,
                  })
                }
                className={`rounded-full border px-2.5 py-1 text-xs ${
                  activePreset?.id === preset.id
                    ? "border-amber-600 bg-amber-600 text-white"
                    : "border-slate-300 hover:bg-white dark:border-slate-600 dark:hover:bg-slate-800"
                }`}
              >
                {preset.label}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
            この高さを下回る道は、遠回りになっても使いません。
            {activePreset ? `（${activePreset.description}）` : ""}
          </p>
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-bold tracking-wide text-slate-500 dark:text-slate-400">
          3. 移動手段
        </h2>
        <div className="flex gap-2">
          {Object.values(PROFILES).map((profile) => (
            <button
              key={profile.id}
              type="button"
              onClick={() => onChange({ profileId: profile.id })}
              className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium ${
                s.profileId === profile.id
                  ? "border-teal-600 bg-teal-600 text-white"
                  : "border-slate-300 hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-800"
              }`}
            >
              {profile.label}
            </button>
          ))}
        </div>
      </section>

      <details className="rounded-lg border border-slate-200 dark:border-slate-700">
        <summary className="cursor-pointer px-3 py-2 text-sm font-medium">
          詳しい設定
        </summary>
        <div className="flex flex-col gap-4 border-t border-slate-200 p-3 dark:border-slate-700">
          <Slider
            label="安全のための余裕"
            hint="この高さまでは「低め」と見なして、なるべく通らないようにします。"
            value={s.safetyMargin}
            min={0}
            max={40}
            step={1}
            unit="m"
            onChange={(v) => onChange({ safetyMargin: v })}
          />
          <Slider
            label="高台をどれだけ優先するか"
            hint="0 で最短距離。大きいほど、遠回りしてでも高いところを選びます。"
            value={s.highGroundBias}
            min={0}
            max={10}
            step={0.5}
            onChange={(v) => onChange({ highGroundBias: v })}
          />
          <Slider
            label="上り坂の負担"
            hint="上り 1m を、平地 何 m ぶんの負担と見なすか。大きくすると急な登坂を避けます。"
            value={s.climbPenaltyPerM}
            min={0}
            max={20}
            step={1}
            unit="m"
            onChange={(v) => onChange({ climbPenaltyPerM: v })}
          />
          <Check
            label="トンネル・地下道を避ける"
            hint="浸水・崩落のおそれがあるため、既定で避けます。"
            checked={s.avoidUnderground}
            onChange={(v) => onChange({ avoidUnderground: v })}
          />
          <Check
            label="階段を避ける"
            hint="車いす・ベビーカーなどで移動する場合に。"
            checked={s.avoidSteps}
            onChange={(v) => onChange({ avoidSteps: v })}
          />
          <Check
            label="標高が分からない道も通る"
            hint="標高タイルが無い区域（整備範囲外など）の道を許可します。"
            checked={s.allowUnknownElevation}
            onChange={(v) => onChange({ allowUnknownElevation: v })}
          />
          <Check
            label="標高を 5m メッシュで読む"
            hint="精度は上がりますが、読み込みが増えます。整備範囲外は自動で 10m メッシュに戻ります。"
            checked={s.highPrecisionDem}
            onChange={(v) => onChange({ highPrecisionDem: v })}
          />
        </div>
      </details>

      <details className="rounded-lg border border-slate-200 dark:border-slate-700">
        <summary className="cursor-pointer px-3 py-2 text-sm font-medium">
          地図の表示
        </summary>
        <div className="flex flex-col gap-3 border-t border-slate-200 p-3 dark:border-slate-700">
          <label className="flex flex-col gap-1 text-sm">
            背景の地図
            <select
              value={s.baseLayerId}
              onChange={(e) => onChange({ baseLayerId: e.target.value })}
              className="rounded border border-slate-300 bg-white px-2 py-1 dark:border-slate-600 dark:bg-slate-900"
            >
              {BASE_LAYERS.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.label}
                </option>
              ))}
            </select>
          </label>
          <fieldset className="flex flex-col gap-1.5">
            <legend className="text-sm">重ねるハザードマップ</legend>
            {HAZARD_LAYERS.map((l) => (
              <label key={l.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={s.overlayIds.includes(l.id)}
                  onChange={(e) =>
                    onChange({
                      overlayIds: e.target.checked
                        ? [...s.overlayIds, l.id]
                        : s.overlayIds.filter((x) => x !== l.id),
                    })
                  }
                />
                {l.label}
              </label>
            ))}
          </fieldset>
          <Slider
            label="重ねる濃さ"
            value={s.overlayOpacity}
            min={0.1}
            max={1}
            step={0.05}
            onChange={(v) => onChange({ overlayOpacity: v })}
          />
          <Check
            label="通常の最短ルートも表示する"
            hint="標高を考えない従来のルートを灰色の点線で重ねます。"
            checked={s.showShortest}
            onChange={(v) => onChange({ showShortest: v })}
          />
        </div>
      </details>

      {p.directDistanceM !== null && p.directDistanceM > 8000 && (
        <p className="rounded border-l-4 border-amber-500 bg-amber-50 px-3 py-2 text-xs leading-relaxed dark:bg-amber-950/30">
          2 地点が {Math.round(p.directDistanceM / 1000)}km 離れています。
          範囲が広いほど道路データの読み込みに時間がかかります（数十秒かかることがあります）。
        </p>
      )}
      <button
        type="button"
        disabled={!p.canSearch || p.running}
        onClick={p.onSearch}
        className="sticky bottom-0 rounded-lg bg-teal-700 px-4 py-3 text-base font-bold text-white shadow-lg disabled:cursor-not-allowed disabled:bg-slate-400 dark:disabled:bg-slate-700"
      >
        {p.running ? "計算中…" : "ルートを探す"}
      </button>
    </div>
  );
}

function clampNumber(raw: string, lo: number, hi: number, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
}

function Slider(props: {
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="flex items-baseline justify-between">
        <span>{props.label}</span>
        <span className="tabular-nums font-medium">
          {props.value}
          {props.unit ?? ""}
        </span>
      </span>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))}
        className="accent-teal-700"
      />
      {props.hint && (
        <span className="text-xs text-slate-500 dark:text-slate-400">{props.hint}</span>
      )}
    </label>
  );
}

function Check(props: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex flex-col gap-0.5 text-sm">
      <span className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={props.checked}
          onChange={(e) => props.onChange(e.target.checked)}
        />
        {props.label}
      </span>
      {props.hint && (
        <span className="pl-6 text-xs text-slate-500 dark:text-slate-400">
          {props.hint}
        </span>
      )}
    </label>
  );
}

function PointRow(props: {
  label: string;
  testId: string;
  accent: string;
  point: LatLng | null;
  picking: boolean;
  onPick: () => void;
  onResolve: (p: LatLng) => void;
  onClear: () => void;
  allowGeolocation?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<GeocodeHit[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const runSearch = async () => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setBusy(true);
    setError(null);
    try {
      const found = await geocode(query, ctrl.signal);
      setHits(found);
      if (found.length === 0) setError("該当する地名が見つかりませんでした。");
    } catch (e) {
      if (!ctrl.signal.aborted) {
        setError(e instanceof Error ? e.message : "住所検索に失敗しました。");
      }
    } finally {
      if (!ctrl.signal.aborted) setBusy(false);
    }
  };

  const locate = () => {
    if (!navigator.geolocation) {
      setError("この端末では現在地を取得できません。");
      return;
    }
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setBusy(false);
        props.onResolve({ lat: pos.coords.latitude, lon: pos.coords.longitude });
      },
      (err) => {
        setBusy(false);
        setError(`現在地を取得できませんでした（${err.message}）`);
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  return (
    <div
      data-testid={props.testId}
      className="rounded-lg border border-slate-200 p-2 dark:border-slate-700"
    >
      <div className="flex items-center gap-2">
        <span className={`h-3 w-3 shrink-0 rounded-full ${props.accent}`} />
        <span className="text-sm font-medium">{props.label}</span>
        <span className="ml-auto text-xs tabular-nums text-slate-500 dark:text-slate-400">
          {props.point
            ? `${props.point.lat.toFixed(5)}, ${props.point.lon.toFixed(5)}`
            : "未設定"}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={props.onPick}
          className={`rounded border px-2 py-1 text-xs ${
            props.picking
              ? "border-teal-600 bg-teal-600 text-white"
              : "border-slate-300 hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-800"
          }`}
        >
          {props.picking ? "地図をタップしてください" : "地図で選ぶ"}
        </button>
        {props.allowGeolocation && (
          <button
            type="button"
            onClick={locate}
            className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-800"
          >
            現在地
          </button>
        )}
        {props.point && (
          <button
            type="button"
            onClick={props.onClear}
            className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-800"
          >
            消す
          </button>
        )}
      </div>
      <div className="mt-2 flex gap-1.5">
        <input
          type="search"
          value={query}
          placeholder="住所・地名で探す"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void runSearch();
            }
          }}
          className="min-w-0 flex-1 rounded border border-slate-300 bg-white px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-900"
        />
        <button
          type="button"
          onClick={() => void runSearch()}
          disabled={busy || query.trim() === ""}
          className="rounded border border-slate-300 px-2 py-1 text-xs disabled:opacity-50 dark:border-slate-600"
        >
          検索
        </button>
      </div>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      {hits.length > 0 && (
        <ul className="mt-1 max-h-40 overflow-y-auto rounded border border-slate-200 text-sm dark:border-slate-700">
          {hits.map((hit, i) => (
            <li key={`${hit.title}-${i}`}>
              <button
                type="button"
                onClick={() => {
                  props.onResolve({ lat: hit.lat, lon: hit.lon });
                  setHits([]);
                }}
                className="w-full px-2 py-1.5 text-left hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                {hit.title}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
