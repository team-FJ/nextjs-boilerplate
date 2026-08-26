/**
 * 標高データ（国土地理院の標高タイル）の読み取り。
 *
 * 標高タイルは PNG の RGB に標高を埋め込んだもの。
 *   x = R * 65536 + G * 256 + B
 *   x < 2^23        → 標高 =  x * 0.01 [m]
 *   x = 2^23        → 無効値（データなし）
 *   x > 2^23        → 標高 = (x - 2^24) * 0.01 [m]
 *
 * 出典: https://maps.gsi.go.jp/development/ichiran.html
 *
 * タイルの取得方法（fetch / canvas）は差し替え可能にしてある。
 * こうしておくと Node 上の自己テストで合成タイルを流し込める。
 */

import { clamp, latToTileY, lonToTileX, type BBox } from "./geo";

export const TILE_SIZE = 256;
/** 標高タイルの無効値。PNG では (128, 0, 0)。 */
const INVALID = 1 << 23;

export interface DemSource {
  id: string;
  label: string;
  /** このタイルセットを読む固定ズーム。 */
  zoom: number;
  url: (z: number, x: number, y: number) => string;
}

/** 既定の標高ソース。日本国内は 10m メッシュ、外れたぶんは全球版で補う。 */
export const GSI_DEM_SOURCES: DemSource[] = [
  {
    id: "dem_png",
    label: "国土地理院 標高タイル（10m メッシュ）",
    zoom: 14,
    url: (z, x, y) =>
      `https://cyberjapandata.gsi.go.jp/xyz/dem_png/${z}/${x}/${y}.png`,
  },
  {
    id: "demgm_png",
    label: "国土地理院 標高タイル（全球版）",
    zoom: 8,
    url: (z, x, y) =>
      `https://cyberjapandata.gsi.go.jp/xyz/demgm_png/${z}/${x}/${y}.png`,
  },
];

/** 高精度モード用。5m メッシュは整備範囲が限られるため、空振りは 10m メッシュが受ける。 */
export const GSI_DEM5_SOURCE: DemSource = {
  id: "dem5a_png",
  label: "国土地理院 標高タイル（5m メッシュ）",
  zoom: 15,
  url: (z, x, y) =>
    `https://cyberjapandata.gsi.go.jp/xyz/dem5a_png/${z}/${x}/${y}.png`,
};

/** タイル 1 枚を 256x256 の標高配列にして返す。データが無ければ null。 */
export type TileLoader = (url: string) => Promise<Float32Array | null>;

/** PNG の RGBA バイト列（256x256）を標高配列へ変換する。 */
export function decodeDemTile(rgba: Uint8ClampedArray | Uint8Array): Float32Array {
  const out = new Float32Array(TILE_SIZE * TILE_SIZE);
  for (let i = 0, p = 0; i < out.length; i += 1, p += 4) {
    const x = (rgba[p] << 16) | (rgba[p + 1] << 8) | rgba[p + 2];
    if (x === INVALID || rgba[p + 3] === 0) {
      out[i] = Number.NaN;
    } else {
      out[i] = (x < INVALID ? x : x - (1 << 24)) * 0.01;
    }
  }
  return out;
}

/** ブラウザ用のタイル取得。CORS が効いた画像を canvas 経由で読み出す。 */
export function createBrowserTileLoader(signal?: AbortSignal): TileLoader {
  return async (url) => {
    const res = await fetch(url, { signal, mode: "cors" });
    // 海域や整備範囲外は 404 が返る。エラーではなく「データなし」として扱う。
    if (!res.ok) return null;
    const blob = await res.blob();
    const bitmap = await createImageBitmap(blob);
    try {
      const canvas =
        typeof OffscreenCanvas !== "undefined"
          ? new OffscreenCanvas(bitmap.width, bitmap.height)
          : Object.assign(document.createElement("canvas"), {
              width: bitmap.width,
              height: bitmap.height,
            });
      const ctx = (canvas as HTMLCanvasElement).getContext("2d", {
        willReadFrequently: true,
      });
      if (!ctx) return null;
      ctx.drawImage(bitmap as CanvasImageSource, 0, 0);
      const data = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
      return decodeDemTile(data);
    } finally {
      bitmap.close();
    }
  };
}

interface LoadedSource {
  source: DemSource;
  tiles: Map<string, Float32Array | null>;
}

export interface DemLoadStats {
  requested: number;
  loaded: number;
  missing: number;
}

/**
 * 範囲内の標高タイルをまとめて読み、任意の緯度経度の標高を返せるようにする。
 * 先に登録したソースを優先し、そこが欠測なら次のソースへ落ちる。
 */
export class DemSampler {
  private readonly loaded: LoadedSource[] = [];
  readonly stats: DemLoadStats = { requested: 0, loaded: 0, missing: 0 };

  constructor(
    private readonly sources: DemSource[],
    private readonly loadTile: TileLoader,
    private readonly concurrency = 6,
  ) {}

  /** 使えた標高ソースの名前（出典表示に使う）。 */
  usedSourceLabels(): string[] {
    return this.loaded
      .filter((s) => [...s.tiles.values()].some((t) => t !== null))
      .map((s) => s.source.label);
  }

  /**
   * bbox を覆うタイルを読み込む。
   * 1 番目のソースで穴が空いた場合だけ、次のソースを読みにいく。
   */
  async prepare(bbox: BBox, onProgress?: (done: number, total: number) => void) {
    for (let i = 0; i < this.sources.length; i += 1) {
      const source = this.sources[i];
      const entry: LoadedSource = { source, tiles: new Map() };
      this.loaded.push(entry);

      const keys = tileKeysFor(bbox, source.zoom);
      this.stats.requested += keys.length;
      let done = 0;
      await runPool(keys, this.concurrency, async ({ x, y }) => {
        const key = `${x}/${y}`;
        try {
          const tile = await this.loadTile(source.url(source.zoom, x, y));
          entry.tiles.set(key, tile);
          if (tile) this.stats.loaded += 1;
          else this.stats.missing += 1;
        } catch {
          entry.tiles.set(key, null);
          this.stats.missing += 1;
        }
        done += 1;
        onProgress?.(done, keys.length);
      });

      // このソースで全域が埋まったなら、以降のソースは読まない。
      if (entry.tiles.size > 0 && [...entry.tiles.values()].every((t) => t !== null)) {
        break;
      }
    }
  }

  /** 標高[m]。どのソースにもデータが無ければ NaN。 */
  sample(lat: number, lon: number): number {
    for (const entry of this.loaded) {
      const v = sampleFrom(entry, lat, lon);
      if (!Number.isNaN(v)) return v;
    }
    return Number.NaN;
  }
}

/** バイリニア補間。周囲 4 画素のうち欠測は平均から外す。 */
function sampleFrom(entry: LoadedSource, lat: number, lon: number): number {
  const { zoom } = entry.source;
  const px = lonToTileX(lon, zoom) * TILE_SIZE - 0.5;
  const py = latToTileY(lat, zoom) * TILE_SIZE - 0.5;
  const x0 = Math.floor(px);
  const y0 = Math.floor(py);
  const fx = px - x0;
  const fy = py - y0;

  let sum = 0;
  let weight = 0;
  for (let dy = 0; dy <= 1; dy += 1) {
    for (let dx = 0; dx <= 1; dx += 1) {
      const v = pixelAt(entry, x0 + dx, y0 + dy);
      if (Number.isNaN(v)) continue;
      const w = (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy);
      sum += v * w;
      weight += w;
    }
  }
  return weight > 0.001 ? sum / weight : Number.NaN;
}

/** グローバル画素座標 → 該当タイルの標高値。 */
function pixelAt(entry: LoadedSource, gx: number, gy: number): number {
  const world = TILE_SIZE * 2 ** entry.source.zoom;
  if (gy < 0 || gy >= world) return Number.NaN;
  const wrapped = ((gx % world) + world) % world;
  const tx = Math.floor(wrapped / TILE_SIZE);
  const ty = Math.floor(gy / TILE_SIZE);
  const tile = entry.tiles.get(`${tx}/${ty}`);
  if (!tile) return Number.NaN;
  const ix = wrapped - tx * TILE_SIZE;
  const iy = gy - ty * TILE_SIZE;
  return tile[iy * TILE_SIZE + ix];
}

export function tileKeysFor(bbox: BBox, zoom: number): { x: number; y: number }[] {
  const max = 2 ** zoom - 1;
  const x0 = clamp(Math.floor(lonToTileX(bbox.west, zoom)), 0, max);
  const x1 = clamp(Math.floor(lonToTileX(bbox.east, zoom)), 0, max);
  const y0 = clamp(Math.floor(latToTileY(bbox.north, zoom)), 0, max);
  const y1 = clamp(Math.floor(latToTileY(bbox.south, zoom)), 0, max);
  const keys: { x: number; y: number }[] = [];
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) keys.push({ x, y });
  }
  return keys;
}

/** 同時実行数を抑えて配列を処理する（サーバーに負荷をかけないため）。 */
async function runPool<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor];
      cursor += 1;
      await fn(item);
    }
  });
  await Promise.all(workers);
}
