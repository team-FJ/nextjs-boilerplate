"use client";

import { useCallback, useRef, useState } from "react";
import Link from "next/link";

import { diagnose, type Diagnosis } from "@/lib/route/diagnose";
import type { LatLng } from "@/lib/route/geo";

/** 区域図が整備されていそうな地点。診断はその地点のタイルを見るので、当たりを付けやすくする。 */
const PRESETS: { label: string; note: string; point: LatLng }[] = [
  { label: "高知市", note: "津波・洪水", point: { lat: 33.5597, lon: 133.5311 } },
  { label: "沼津市", note: "津波", point: { lat: 35.0955, lon: 138.8635 } },
  { label: "名古屋市港区", note: "津波・高潮・洪水", point: { lat: 35.108, lon: 136.847 } },
  { label: "東京都江東区", note: "洪水・高潮", point: { lat: 35.6726, lon: 139.8172 } },
  { label: "広島市安佐南区", note: "土砂災害", point: { lat: 34.46, lon: 132.45 } },
];

export default function DiagnosePanel() {
  const [point, setPoint] = useState<LatLng>(PRESETS[0].point);
  const [result, setResult] = useState<Diagnosis | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const run = useCallback(async () => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setError(null);
    setResult(null);
    setCopied(false);
    setProgress("診断を始めます…");
    try {
      const res = await diagnose(point, {
        signal: ctrl.signal,
        onProgress: (message, done, total) =>
          setProgress(`${message}（${done}/${total}）`),
      });
      if (!ctrl.signal.aborted) setResult(res);
    } catch (e) {
      if (!ctrl.signal.aborted) {
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      if (!ctrl.signal.aborted) setProgress(null);
    }
  }, [point]);

  const copy = useCallback(async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(toReport(result));
      setCopied(true);
    } catch {
      setError("クリップボードへコピーできませんでした。");
    }
  }, [result]);

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-5">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-bold">データ取得の診断</h1>
        <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-400">
          このページは、避難ルート検索が使う外部データに
          <strong>この端末から実際につながるか</strong>を確かめます。
          あわせて、ハザードマップのタイルが<strong>どのズームで配信されているか</strong>と、
          タイルに含まれる色が<strong>凡例と一致しているか</strong>を列挙します。
        </p>
        <Link
          href="/route"
          className="self-start text-sm text-teal-700 underline dark:text-teal-400"
        >
          ← ルート検索へ戻る
        </Link>
      </header>

      <section className="flex flex-col gap-3 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              title={p.note}
              onClick={() => setPoint(p.point)}
              className={`rounded-full border px-2.5 py-1 text-xs ${
                p.point.lat === point.lat && p.point.lon === point.lon
                  ? "border-teal-600 bg-teal-600 text-white"
                  : "border-slate-300 hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-800"
              }`}
            >
              {p.label}
              <span className="ml-1 opacity-70">{p.note}</span>
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col text-xs">
            緯度
            <input
              type="number"
              step="0.0001"
              value={point.lat}
              onChange={(e) => setPoint({ ...point, lat: Number(e.target.value) })}
              className="w-32 rounded border border-slate-300 bg-white px-2 py-1 text-sm tabular-nums dark:border-slate-600 dark:bg-slate-900"
            />
          </label>
          <label className="flex flex-col text-xs">
            経度
            <input
              type="number"
              step="0.0001"
              value={point.lon}
              onChange={(e) => setPoint({ ...point, lon: Number(e.target.value) })}
              className="w-32 rounded border border-slate-300 bg-white px-2 py-1 text-sm tabular-nums dark:border-slate-600 dark:bg-slate-900"
            />
          </label>
          <button
            type="button"
            onClick={() => void run()}
            disabled={progress !== null}
            className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-bold text-white disabled:bg-slate-400"
          >
            {progress ? "診断中…" : "診断する"}
          </button>
        </div>
        {progress && (
          <p className="text-xs text-slate-500 dark:text-slate-400">{progress}</p>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
      </section>

      {result && (
        <>
          <Summary result={result} />

          <section>
            <h2 className="mb-2 text-sm font-bold tracking-wide text-slate-500 dark:text-slate-400">
              道路データ（Overpass API）
            </h2>
            <ul className="flex flex-col gap-1 text-sm">
              {result.roads.map((r) => (
                <li key={r.url} className="flex items-start gap-2">
                  <Mark ok={r.ok} />
                  <span>
                    {r.name}
                    <span className="block text-xs text-slate-500 dark:text-slate-400">
                      {r.detail}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h2 className="mb-2 text-sm font-bold tracking-wide text-slate-500 dark:text-slate-400">
              標高タイル
            </h2>
            <p className="flex items-start gap-2 text-sm">
              <Mark ok={result.elevation.ok} />
              <span>
                {result.elevation.name}
                <span className="block text-xs text-slate-500 dark:text-slate-400">
                  {result.elevation.detail}
                </span>
              </span>
            </p>
          </section>

          <section className="flex flex-col gap-4">
            <h2 className="text-sm font-bold tracking-wide text-slate-500 dark:text-slate-400">
              ハザードマップのタイル
            </h2>
            {result.hazards.map((h) => (
              <div
                key={h.id}
                data-testid={`diag-${h.id}`}
                className="rounded-lg border border-slate-200 p-3 dark:border-slate-700"
              >
                <h3 className="text-sm font-medium">{h.label}</h3>
                <div className="mt-1 flex flex-wrap gap-1">
                  {h.zooms.map((z) => (
                    <span
                      key={z.zoom}
                      title={z.error ?? (z.status === null ? "接続失敗" : `HTTP ${z.status}`)}
                      className={`rounded px-1.5 py-0.5 text-xs tabular-nums ${
                        z.ok
                          ? "bg-teal-100 text-teal-900 dark:bg-teal-900 dark:text-teal-100"
                          : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"
                      } ${z.zoom === h.preferredZoom ? "ring-2 ring-amber-500" : ""}`}
                    >
                      z{z.zoom}
                      {z.ok ? "" : ` ${z.status ?? "×"}`}
                    </span>
                  ))}
                </div>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  枠付きが探索で使うズーム。
                  {h.censusZoom === null
                    ? "この地点ではタイルを取得できませんでした（未整備の可能性）。"
                    : `z${h.censusZoom} のタイルで色を数えました（着色 ${h.opaquePixels.toLocaleString()} 画素）。`}
                </p>
                {h.colors.length > 0 && (
                  <ul className="mt-2 flex flex-col gap-1">
                    {h.colors.map((c) => (
                      <li key={c.hex} className="flex items-center gap-2 text-xs">
                        <span
                          className="inline-block h-4 w-6 shrink-0 rounded border border-slate-300"
                          style={{ background: c.hex }}
                        />
                        <code className="tabular-nums">{c.hex}</code>
                        <span className="tabular-nums text-slate-500 dark:text-slate-400">
                          {c.count.toLocaleString()} 画素
                        </span>
                        <span
                          className={
                            c.rank
                              ? "text-slate-700 dark:text-slate-300"
                              : "font-medium text-red-700 dark:text-red-400"
                          }
                        >
                          {c.rank ? c.rank.label : "凡例に無い色（深さ不明として扱われます）"}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </section>

          <section className="flex flex-col gap-2">
            <button
              type="button"
              onClick={() => void copy()}
              className="self-start rounded border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-800"
            >
              {copied ? "コピーしました" : "結果をテキストでコピー"}
            </button>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              凡例に無い色が出た場合、その色と段階の対応を
              <code className="mx-1">lib/route/hazard.ts</code>
              に足すと、深さまで判定できるようになります。
            </p>
          </section>
        </>
      )}
    </main>
  );
}

function Mark({ ok }: { ok: boolean }) {
  return (
    <span
      className={`mt-0.5 inline-block h-4 w-4 shrink-0 rounded-full text-center text-[10px] leading-4 text-white ${
        ok ? "bg-teal-700" : "bg-red-700"
      }`}
      aria-label={ok ? "成功" : "失敗"}
    >
      {ok ? "✓" : "!"}
    </span>
  );
}

function Summary({ result }: { result: Diagnosis }) {
  const roadsOk = result.roads.some((r) => r.ok);
  const preferredMissing = result.hazards.filter(
    (h) => h.zooms.some((z) => z.ok) && !h.zooms.some((z) => z.zoom === h.preferredZoom && z.ok),
  );
  const unmatched = result.hazards.filter((h) => h.unmatched.length > 0);

  return (
    <section
      data-testid="diag-summary"
      className="flex flex-col gap-1.5 rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-700"
    >
      <h2 className="text-sm font-bold tracking-wide text-slate-500 dark:text-slate-400">
        まとめ
      </h2>
      <p className="flex items-start gap-2">
        <Mark ok={roadsOk} />
        {roadsOk ? "道路データにつながります。" : "道路データにつながりません。"}
      </p>
      <p className="flex items-start gap-2">
        <Mark ok={result.elevation.ok} />
        {result.elevation.ok
          ? "標高タイルを読めます。"
          : "標高タイルを読めません。"}
      </p>
      <p className="flex items-start gap-2">
        <Mark ok={preferredMissing.length === 0} />
        {preferredMissing.length === 0
          ? "探索で使うズームは配信されています。"
          : `探索で使うズームが無いものがあります: ${preferredMissing
              .map((h) => h.label)
              .join("、")}（1 段下げて読み直す動作になります）`}
      </p>
      <p className="flex items-start gap-2">
        <Mark ok={unmatched.length === 0} />
        {unmatched.length === 0
          ? "見つかった色はすべて凡例と一致しました。"
          : `凡例に無い色があります: ${unmatched
              .map((h) => `${h.label}（${h.unmatched.map((c) => c.hex).join(", ")}）`)
              .join(" / ")}`}
      </p>
    </section>
  );
}

/** 貼り付けて共有できる形の報告。 */
export function toReport(r: Diagnosis): string {
  const lines: string[] = [];
  lines.push(`# 避難ルート検索 データ診断`);
  lines.push(`地点: ${r.point.lat.toFixed(5)}, ${r.point.lon.toFixed(5)}`);
  lines.push("");
  lines.push("## 道路データ");
  for (const e of r.roads) lines.push(`- ${e.ok ? "OK" : "NG"} ${e.name}: ${e.detail}`);
  lines.push("");
  lines.push("## 標高");
  lines.push(`- ${r.elevation.ok ? "OK" : "NG"} ${r.elevation.detail}`);
  lines.push("");
  lines.push("## ハザードマップ");
  for (const h of r.hazards) {
    const zooms = h.zooms
      .map((z) => `z${z.zoom}:${z.ok ? "OK" : (z.status ?? "接続失敗")}`)
      .join(" ");
    lines.push(`- ${h.label}（探索は z${h.preferredZoom}）`);
    lines.push(`  ${zooms}`);
    if (h.censusZoom === null) {
      lines.push("  タイルなし（未整備の可能性）");
      continue;
    }
    lines.push(`  z${h.censusZoom} の着色 ${h.opaquePixels} 画素`);
    for (const c of h.colors) {
      lines.push(`  ${c.hex} ${c.count} 画素 → ${c.rank ? c.rank.label : "凡例に無い色"}`);
    }
  }
  return lines.join("\n");
}
