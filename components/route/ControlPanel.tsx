"use client";

import { useEffect, useRef, useState } from "react";
import { geocode, type GeocodeHit } from "@/lib/route/geocode";
import type { LatLng } from "@/lib/route/geo";
import { HAZARD_DATASETS } from "@/lib/route/hazard";
import { PROFILES } from "@/lib/route/profiles";
import { hasNoConstraint, PRESETS, type RouteSettings } from "@/lib/route/settings";
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

/** 想定浸水深のしきい値。凡例の段階の上限に合わせてある。 */
const DEPTH_CHOICES = [
  { value: 0, label: "区域に入らない", hint: "浸水想定区域を一切通りません（最も厳しい）" },
  { value: 0.5, label: "0.5m 未満は通る", hint: "くるぶし〜膝下程度の浸水想定は許容します" },
  { value: 3, label: "3m 未満は通る", hint: "1 階が浸かる想定までは許容します" },
  { value: 5, label: "5m 未満は通る", hint: "深い浸水想定だけを避けます" },
];

const DEPTH_SETS = HAZARD_DATASETS.filter((d) => d.kind === "depth");
const ZONE_SETS = HAZARD_DATASETS.filter((d) => d.kind === "zone");

export default function ControlPanel(p: Props) {
  const { settings: s, onChange } = p;
  const selectedDepthSets = s.hazardDatasetIds.filter((id) =>
    DEPTH_SETS.some((d) => d.id === id),
  );

  const toggleDataset = (id: string, on: boolean) =>
    onChange({
      hazardDatasetIds: on
        ? [...s.hazardDatasetIds, id]
        : s.hazardDatasetIds.filter((x) => x !== id),
    });

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

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-bold tracking-wide text-slate-500 dark:text-slate-400">
          2. 想定する災害
        </h2>
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              title={preset.description}
              onClick={() => onChange(preset.patch)}
              className={`rounded-full border px-2.5 py-1 text-xs ${
                matchesPreset(s, preset.patch)
                  ? "border-amber-600 bg-amber-600 text-white"
                  : "border-slate-300 hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-800"
              }`}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-bold tracking-wide text-slate-500 dark:text-slate-400">
          3. ハザードマップで避ける
        </h2>
        <div
          data-testid="hazard-section"
          className="rounded-lg border border-sky-300 bg-sky-50 p-3 dark:border-sky-800/60 dark:bg-sky-950/30"
        >
          <Check
            label="ハザードマップの想定浸水深で判定する"
            hint="ハザードマップが持っているのは「標高」ではなく「想定浸水深」です。避難の可否はこちらが直接の指標になります。"
            checked={s.hazardEnabled}
            onChange={(v) => onChange({ hazardEnabled: v })}
          />
          {s.hazardEnabled && (
            <>
              <fieldset className="mt-3 flex flex-col gap-1.5">
                <legend className="text-sm font-medium">使う区域図</legend>
                {DEPTH_SETS.map((d) => (
                  <label key={d.id} className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={s.hazardDatasetIds.includes(d.id)}
                      onChange={(e) => toggleDataset(d.id, e.target.checked)}
                    />
                    <span>
                      {d.label}
                      {d.note && (
                        <span className="block text-xs text-slate-500 dark:text-slate-400">
                          {d.note}
                        </span>
                      )}
                    </span>
                  </label>
                ))}
                {ZONE_SETS.map((d) => (
                  <label key={d.id} className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={s.hazardDatasetIds.includes(d.id)}
                      onChange={(e) => toggleDataset(d.id, e.target.checked)}
                    />
                    <span>
                      {d.label}
                      <span className="block text-xs text-slate-500 dark:text-slate-400">
                        深さではなく「区域内かどうか」で判定します。
                      </span>
                    </span>
                  </label>
                ))}
              </fieldset>

              {selectedDepthSets.length > 0 && (
                <fieldset className="mt-3 flex flex-col gap-1.5">
                  <legend className="text-sm font-medium">どこまで許容するか</legend>
                  {DEPTH_CHOICES.map((c) => (
                    <label key={c.value} className="flex items-start gap-2 text-sm">
                      <input
                        type="radio"
                        name="hazard-depth"
                        data-testid={`depth-${c.value}`}
                        className="mt-1"
                        checked={s.hazardMaxDepth === c.value}
                        onChange={() => onChange({ hazardMaxDepth: c.value })}
                      />
                      <span>
                        {c.label}
                        <span className="block text-xs text-slate-500 dark:text-slate-400">
                          {c.hint}
                        </span>
                      </span>
                    </label>
                  ))}
                </fieldset>
              )}

              {s.hazardDatasetIds.length === 0 && (
                <p className="mt-2 text-xs text-red-700 dark:text-red-400">
                  区域図が 1 つも選ばれていません。ハザードマップによる判定は働きません。
                </p>
              )}
            </>
          )}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-bold tracking-wide text-slate-500 dark:text-slate-400">
          4. 標高でも制限する（任意）
        </h2>
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-700/60 dark:bg-amber-950/30">
          <Check
            label="指定した標高より低い道は通らない"
            hint="ハザードマップが未整備の区域を補うのに使えます。"
            checked={s.elevationEnabled}
            onChange={(v) => onChange({ elevationEnabled: v })}
          />
          {s.elevationEnabled && (
            <>
              <label className="mt-3 flex items-baseline gap-2 text-sm font-medium">
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
            </>
          )}
        </div>
      </section>

      {hasNoConstraint(s) && (
        <p className="rounded border-l-4 border-red-600 bg-red-50 px-3 py-2 text-xs leading-relaxed dark:bg-red-950/30">
          ハザードマップも標高も条件に入っていません。このままだと通常の最短ルートと同じものが出ます。
        </p>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-bold tracking-wide text-slate-500 dark:text-slate-400">
          5. 移動手段
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
            label="浸水想定をどれだけ避けるか"
            hint="しきい値を満たしていても、浸かる想定の道より浸からない道を選びます。"
            value={s.hazardBias}
            min={0}
            max={10}
            step={0.5}
            onChange={(v) => onChange({ hazardBias: v })}
          />
          <Check
            label="区域内で深さが読めない道を避ける"
            hint="着色はされているのに凡例の色に一致しない場合、安全側に倒して避けます。"
            checked={s.hazardAvoidUnknownDepth}
            onChange={(v) => onChange({ hazardAvoidUnknownDepth: v })}
          />
          <Check
            label="ハザードマップ未整備の区域も通る"
            hint="区域図が無い場所は判定できません。外すと、そこを一切通らなくなります。"
            checked={s.hazardAllowUnmapped}
            onChange={(v) => onChange({ hazardAllowUnmapped: v })}
          />
          <Check
            label="判定を周囲 1 画素まで広げる"
            hint="道が区域の境界ぎりぎりに描かれている場合の取りこぼしを防ぎます。"
            checked={s.hazardSampleRadius > 0}
            onChange={(v) => onChange({ hazardSampleRadius: v ? 1 : 0 })}
          />
          <hr className="border-slate-200 dark:border-slate-700" />
          <Slider
            label="標高の安全マージン"
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
          <hr className="border-slate-200 dark:border-slate-700" />
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
            hint="災害を考えない従来のルートを灰色の点線で重ねます。"
            checked={s.showShortest}
            onChange={(v) => onChange({ showShortest: v })}
          />
        </div>
      </details>

      {p.directDistanceM !== null && p.directDistanceM > 8000 && (
        <p className="rounded border-l-4 border-amber-500 bg-amber-50 px-3 py-2 text-xs leading-relaxed dark:bg-amber-950/30">
          2 地点が {Math.round(p.directDistanceM / 1000)}km 離れています。
          範囲が広いほど道路データとハザードマップの読み込みに時間がかかります。
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

/** 目安ボタンが今の設定と一致しているか。 */
function matchesPreset(s: RouteSettings, patch: Partial<RouteSettings>): boolean {
  return Object.entries(patch).every(([key, value]) => {
    const cur = s[key as keyof RouteSettings];
    if (Array.isArray(value) && Array.isArray(cur)) {
      return value.length === cur.length && value.every((v) => cur.includes(v as never));
    }
    return cur === value;
  });
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
      <span className="flex items-start gap-2">
        <input
          type="checkbox"
          className="mt-1"
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
