/**
 * 外部データの取得状況を、実際に叩いて確かめるための診断。
 *
 * このアプリは Overpass・国土地理院・ハザードマップポータルへ
 * ブラウザから直接つなぐ。開発環境から到達できないことがあるので、
 * 「実際に使う端末の上で確かめる」手段を用意しておく。
 *
 * とくに次の 2 つは、実データを見ないと確定できない。
 *   - ハザードマップのタイルがどのズームで配信されているか
 *   - タイルに実際に含まれる色（凡例に無い色があれば「深さ不明」に落ちる）
 * この診断は、その両方をその場で列挙する。
 */

import { decodeDemTile } from "./dem";
import { latToTileY, lonToTileX, type LatLng } from "./geo";
import {
  HAZARD_DATASETS,
  matchRank,
  type DepthRank,
  type HazardDataset,
} from "./hazard";
import { OVERPASS_ENDPOINTS } from "./overpass";
import { TILE_SIZE } from "./tileFetch";

export interface TileProbeResult {
  /** HTTP のステータス。ネットワーク段階で失敗したら null。 */
  status: number | null;
  error?: string;
  rgba?: Uint8ClampedArray;
}

export type TileProbe = (url: string) => Promise<TileProbeResult>;

export type FormPoster = (
  url: string,
  data: Record<string, string>,
) => Promise<{ status: number | null; text: string; error?: string }>;

export function createBrowserProbe(signal?: AbortSignal): TileProbe {
  return async (url) => {
    try {
      const res = await fetch(url, { signal, mode: "cors" });
      if (!res.ok) return { status: res.status };
      const bitmap = await createImageBitmap(await res.blob());
      try {
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) return { status: res.status, error: "canvas を使えません" };
        ctx.drawImage(bitmap, 0, 0);
        return {
          status: res.status,
          rgba: ctx.getImageData(0, 0, bitmap.width, bitmap.height).data,
        };
      } finally {
        bitmap.close();
      }
    } catch (e) {
      // CORS で弾かれた場合もここに来る（ブラウザは理由を教えてくれない）。
      return { status: null, error: e instanceof Error ? e.message : String(e) };
    }
  };
}

export function createBrowserFormPoster(signal?: AbortSignal): FormPoster {
  return async (url, data) => {
    try {
      const res = await fetch(url, {
        method: "POST",
        body: new URLSearchParams(data),
        signal,
      });
      return { status: res.status, text: (await res.text()).slice(0, 400) };
    } catch (e) {
      return {
        status: null,
        text: "",
        error: e instanceof Error ? e.message : String(e),
      };
    }
  };
}

export interface EndpointCheck {
  name: string;
  url: string;
  ok: boolean;
  detail: string;
}

export interface ZoomAvailability {
  zoom: number;
  status: number | null;
  ok: boolean;
  error?: string;
}

export interface ColorCount {
  hex: string;
  count: number;
  /** 凡例に一致した段階。一致しなければ null。 */
  rank: DepthRank | null;
}

export interface DatasetDiagnosis {
  id: string;
  label: string;
  /** このデータセットが探索で読みにいくズーム。 */
  preferredZoom: number;
  zooms: ZoomAvailability[];
  /** 色を数えたタイルのズーム。取得できなければ null。 */
  censusZoom: number | null;
  opaquePixels: number;
  colors: ColorCount[];
  /** 凡例に一致しなかった色。ここが空でなければ凡例の定義を見直す手がかりになる。 */
  unmatched: ColorCount[];
}

export interface Diagnosis {
  point: LatLng;
  roads: EndpointCheck[];
  elevation: EndpointCheck & { value: number };
  hazards: DatasetDiagnosis[];
}

export interface DiagnoseOptions {
  /** 調べるズーム。既定は 13〜17。 */
  zooms?: number[];
  datasets?: HazardDataset[];
  probe?: TileProbe;
  post?: FormPoster;
  signal?: AbortSignal;
  onProgress?: (message: string, done: number, total: number) => void;
}

const DEFAULT_ZOOMS = [13, 14, 15, 16, 17];

export async function diagnose(
  point: LatLng,
  opts: DiagnoseOptions = {},
): Promise<Diagnosis> {
  const zooms = opts.zooms ?? DEFAULT_ZOOMS;
  const datasets = opts.datasets ?? HAZARD_DATASETS;
  const probe = opts.probe ?? createBrowserProbe(opts.signal);
  const post = opts.post ?? createBrowserFormPoster(opts.signal);

  const total = OVERPASS_ENDPOINTS.length + 1 + datasets.length * zooms.length;
  let done = 0;
  const tick = (message: string) => {
    done += 1;
    opts.onProgress?.(message, done, total);
  };

  // --- 道路データ -------------------------------------------------------
  const roads: EndpointCheck[] = [];
  for (const endpoint of OVERPASS_ENDPOINTS) {
    const query = `[out:json][timeout:10];node(around:30,${point.lat},${point.lon});out 1;`;
    const res = await post(endpoint, { data: query });
    let ok = false;
    let detail: string;
    if (res.status === null) {
      detail = `つながりません（${res.error ?? "原因不明"}）`;
    } else if (res.status !== 200) {
      detail = `HTTP ${res.status}`;
    } else {
      try {
        const json = JSON.parse(res.text.startsWith("{") ? res.text : "{}") as {
          elements?: unknown[];
        };
        ok = Array.isArray(json.elements);
        detail = ok ? "応答あり" : "JSON の形が想定と違います";
      } catch {
        // 応答が途中で切れていても、JSON らしければ通じていると見なす。
        ok = res.text.includes('"elements"');
        detail = ok ? "応答あり" : "JSON を読めませんでした";
      }
    }
    roads.push({ name: hostOf(endpoint), url: endpoint, ok, detail });
    tick(`道路データ: ${hostOf(endpoint)}`);
  }

  // --- 標高 -------------------------------------------------------------
  const demZoom = 14;
  const demUrl = `https://cyberjapandata.gsi.go.jp/xyz/dem_png/${demZoom}/${Math.floor(
    lonToTileX(point.lon, demZoom),
  )}/${Math.floor(latToTileY(point.lat, demZoom))}.png`;
  const demRes = await probe(demUrl);
  let elevation: Diagnosis["elevation"];
  if (demRes.rgba) {
    const tile = decodeDemTile(demRes.rgba);
    const value = tile[pixelIndex(point, demZoom)];
    elevation = {
      name: "国土地理院 標高タイル（10m メッシュ）",
      url: demUrl,
      ok: !Number.isNaN(value),
      detail: Number.isNaN(value)
        ? "タイルはあるが、この地点は無効値（海域など）"
        : `標高 ${value.toFixed(1)}m を読み取れました`,
      value,
    };
  } else {
    elevation = {
      name: "国土地理院 標高タイル（10m メッシュ）",
      url: demUrl,
      ok: false,
      detail:
        demRes.status === null
          ? `つながりません（${demRes.error ?? "原因不明"}）`
          : `HTTP ${demRes.status}`,
      value: Number.NaN,
    };
  }
  tick("標高タイル");

  // --- ハザードマップ ---------------------------------------------------
  const hazards: DatasetDiagnosis[] = [];
  for (const dataset of datasets) {
    const availability: ZoomAvailability[] = [];
    let censusZoom: number | null = null;
    let census: { colors: ColorCount[]; opaque: number } = { colors: [], opaque: 0 };

    for (const zoom of zooms) {
      const url = dataset.url(
        zoom,
        Math.floor(lonToTileX(point.lon, zoom)),
        Math.floor(latToTileY(point.lat, zoom)),
      );
      const res = await probe(url);
      const ok = !!res.rgba;
      availability.push({ zoom, status: res.status, ok, error: res.error });
      if (ok) {
        // 凡例に無い色を見つけるのが目的なので、
        // 着色画素がいちばん多かったタイルの結果を採る。
        const counted = countColors(res.rgba!, dataset.ranks);
        if (censusZoom === null || counted.opaque > census.opaque) {
          censusZoom = zoom;
          census = counted;
        }
      }
      tick(`${dataset.short} z${zoom}`);
    }
    hazards.push({
      id: dataset.id,
      label: dataset.label,
      preferredZoom: dataset.zooms[0],
      zooms: availability,
      censusZoom,
      opaquePixels: census.opaque,
      colors: census.colors,
      unmatched: census.colors.filter((c) => c.rank === null),
    });
  }

  return { point, roads, elevation, hazards };
}

/** タイルに含まれる不透明な色を数える。多い順。 */
export function countColors(
  rgba: Uint8ClampedArray,
  ranks: DepthRank[],
  alphaThreshold = 110,
  limit = 16,
): { colors: ColorCount[]; opaque: number } {
  const counts = new Map<number, number>();
  let opaque = 0;
  for (let p = 0; p + 3 < rgba.length; p += 4) {
    if (rgba[p + 3] < alphaThreshold) continue;
    opaque += 1;
    const key = (rgba[p] << 16) | (rgba[p + 1] << 8) | rgba[p + 2];
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const colors = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([key, count]) => ({
      hex: `#${key.toString(16).padStart(6, "0").toUpperCase()}`,
      count,
      rank: matchRank(ranks, [
        (key >> 16) & 0xff,
        (key >> 8) & 0xff,
        key & 0xff,
        255,
      ]),
    }));
  return { colors, opaque };
}

function pixelIndex(point: LatLng, zoom: number): number {
  const px = Math.floor(lonToTileX(point.lon, zoom) * TILE_SIZE) % TILE_SIZE;
  const py = Math.floor(latToTileY(point.lat, zoom) * TILE_SIZE) % TILE_SIZE;
  return py * TILE_SIZE + px;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
