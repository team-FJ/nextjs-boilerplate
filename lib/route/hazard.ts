/**
 * ハザードマップ（重ねるハザードマップのラスタタイル）から、
 * その地点の「想定浸水深」を読み取る。
 *
 * 標高タイルと違い、ハザードマップのタイルは**凡例の色**で浸水深の段階を表している。
 * つまり数値ではなく色分類なので、
 *   - 補間はしない（隣り合う段階の中間色を作ってしまうため）
 *   - 色は許容差つきで最も近い凡例に寄せる（輪郭のアンチエイリアス対策）
 *   - どの凡例にも寄らない着色は「区域内・深さ不明」として安全側に倒す
 * という扱いにしてある。
 *
 * 3 つの状態を区別することが大事：
 *   1. タイルが無い          → その市区町村でハザードマップが未整備（判定できない）
 *   2. タイルはあるが透明     → 浸水想定区域の外（＝浸水しない想定）
 *   3. タイルがあり着色       → 浸水想定区域の内（色が深さの段階）
 *
 * 出典: ハザードマップポータルサイト（https://disaportal.gsi.go.jp/）
 */

import { latToTileY, lonToTileX, type BBox } from "./geo";
import { tileKeysFor } from "./dem";
import { runPool, TILE_SIZE, type RgbaLoader } from "./tileFetch";

export interface DepthRank {
  color: [number, number, number];
  /** この段階の下限[m]。 */
  min: number;
  /** この段階の上限[m]。最上位は Infinity。 */
  max: number;
  label: string;
}

/**
 * 浸水深ランクの標準色（洪水・内水・高潮・津波で共通に使われている 6 色）。
 * 段階の区切りだけがデータセットごとに違う。
 */
const RANK_COLORS: [number, number, number][] = [
  [247, 245, 169], // #F7F5A9
  [255, 216, 192], // #FFD8C0
  [255, 183, 183], // #FFB7B7
  [255, 145, 145], // #FF9191
  [242, 133, 201], // #F285C9
  [220, 122, 220], // #DC7ADC
];

/** 区切り（m）の配列から凡例を組み立てる。境界は「以上・未満」。 */
function ranksFromThresholds(thresholds: number[]): DepthRank[] {
  return RANK_COLORS.slice(0, thresholds.length + 1).map((color, i) => {
    const min = i === 0 ? 0 : thresholds[i - 1];
    const max = i < thresholds.length ? thresholds[i] : Number.POSITIVE_INFINITY;
    const label =
      i === 0
        ? `${max}m 未満`
        : max === Number.POSITIVE_INFINITY
          ? `${min}m 以上`
          : `${min}〜${max}m`;
    return { color, min, max, label };
  });
}

export type HazardKind = "depth" | "zone";

export interface HazardDataset {
  id: string;
  label: string;
  /** 選択肢に出す短い名前。 */
  short: string;
  kind: HazardKind;
  url: (z: number, x: number, y: number) => string;
  /** 読みにいくズーム（前から順に試す）。 */
  zooms: number[];
  /** 地図に重ねるときの最大ズーム。 */
  maxNativeZoom: number;
  /** kind が "depth" のときの凡例。 */
  ranks: DepthRank[];
  note?: string;
}

const RASTER = (name: string) => (z: number, x: number, y: number) =>
  `https://disaportaldata.gsi.go.jp/raster/${name}/${z}/${x}/${y}.png`;

/** 洪水・内水・高潮で使われる区切り。 */
const FLOOD_THRESHOLDS = [0.5, 3, 5, 10, 20];
/** 津波（新凡例）の区切り。浅いほうが細かい。 */
const TSUNAMI_THRESHOLDS = [0.3, 1, 3, 5, 10];

export const HAZARD_DATASETS: HazardDataset[] = [
  {
    id: "flood_l2",
    label: "洪水浸水想定区域（想定最大規模）",
    short: "洪水（最大規模）",
    kind: "depth",
    url: RASTER("01_flood_l2_shinsuishin_data"),
    zooms: [14, 13],
    maxNativeZoom: 17,
    ranks: ranksFromThresholds(FLOOD_THRESHOLDS),
    note: "河川氾濫。想定しうる最大規模の降雨によるもの。",
  },
  {
    id: "flood_l1",
    label: "洪水浸水想定区域（計画規模）",
    short: "洪水（計画規模）",
    kind: "depth",
    url: RASTER("01_flood_l1_shinsuishin_data"),
    zooms: [14, 13],
    maxNativeZoom: 17,
    ranks: ranksFromThresholds(FLOOD_THRESHOLDS),
  },
  {
    id: "tsunami",
    label: "津波浸水想定",
    short: "津波",
    kind: "depth",
    url: RASTER("04_tsunami_newlegend_data"),
    zooms: [14, 13],
    maxNativeZoom: 17,
    ranks: ranksFromThresholds(TSUNAMI_THRESHOLDS),
    note: "沿岸部のみ。内陸には整備されていない。",
  },
  {
    id: "hightide",
    label: "高潮浸水想定区域",
    short: "高潮",
    kind: "depth",
    url: RASTER("03_hightide_l2_shinsuishin_data"),
    zooms: [14, 13],
    maxNativeZoom: 17,
    ranks: ranksFromThresholds(FLOOD_THRESHOLDS),
  },
  {
    id: "naisui",
    label: "内水浸水想定区域",
    short: "内水氾濫",
    kind: "depth",
    url: RASTER("02_naisui_shinsuishin_data"),
    zooms: [14, 13],
    maxNativeZoom: 17,
    ranks: ranksFromThresholds(FLOOD_THRESHOLDS),
    note: "下水の処理能力を超えた雨による市街地の浸水。",
  },
  {
    id: "dosekiryu",
    label: "土砂災害警戒区域（土石流）",
    short: "土石流",
    kind: "zone",
    url: RASTER("05_dosekiryukeikaikuiki"),
    zooms: [14, 13],
    maxNativeZoom: 17,
    ranks: [],
    note: "区域内は深さではなく「入らない」で判定する。",
  },
  {
    id: "kyukeisha",
    label: "土砂災害警戒区域（急傾斜地の崩壊）",
    short: "急傾斜地",
    kind: "zone",
    url: RASTER("05_kyukeishakeikaikuiki"),
    zooms: [14, 13],
    maxNativeZoom: 17,
    ranks: [],
  },
];

export function findDataset(id: string): HazardDataset | undefined {
  return HAZARD_DATASETS.find((d) => d.id === id);
}

// ------------------------------------------------------------------ 判定結果

/** ハザード判定のビットフラグ。1 バイトに収めてグラフに持たせる。 */
export const HAZARD_MAPPED = 1; // タイルを取得できた（＝整備されている）
export const HAZARD_INUNDATED = 2; // 浸水想定区域の内側
export const HAZARD_DEPTH_UNKNOWN = 4; // 着色されているが凡例に一致しない
export const HAZARD_ZONE = 8; // 土砂災害警戒区域などのゾーン系

export interface HazardSample {
  /** 想定浸水深の上限[m]。区域外なら 0、深さが分からなければ NaN。 */
  depth: number;
  flags: number;
  /** 最も深い段階の表示名。 */
  label: string;
}

export const SAFE_SAMPLE: HazardSample = { depth: 0, flags: 0, label: "" };

// -------------------------------------------------------------------- 読み取り

interface LoadedLayer {
  dataset: HazardDataset;
  zoom: number;
  tiles: Map<string, Uint8ClampedArray | null>;
}

export interface HazardLoadStats {
  requested: number;
  loaded: number;
  missing: number;
}

/** 凡例の色に寄せるときの許容差（RGB のユークリッド距離）。 */
const COLOR_TOLERANCE = 46;
/** 透明とみなすアルファ。輪郭は半透明になることがある。 */
const ALPHA_THRESHOLD = 110;

export class HazardSampler {
  private readonly layers: LoadedLayer[] = [];
  readonly stats: HazardLoadStats = { requested: 0, loaded: 0, missing: 0 };

  constructor(
    private readonly datasets: HazardDataset[],
    private readonly loadTile: RgbaLoader,
    /**
     * 判定する画素の半径。0 なら真上の 1 画素だけ。
     * 1 以上にすると周囲も見て「最も深い段階」を採る（安全側）。
     */
    private readonly sampleRadiusPx = 1,
    private readonly concurrency = 6,
  ) {}

  get enabled(): boolean {
    return this.datasets.length > 0;
  }

  usedLabels(): string[] {
    return this.layers
      .filter((l) => [...l.tiles.values()].some((t) => t !== null))
      .map((l) => l.dataset.label);
  }

  async prepare(bbox: BBox, onProgress?: (done: number, total: number) => void) {
    // 進捗の分母は「最初のズームで必要な枚数」。
    // ズームを落として読み直したぶんは、分母を増やさず打ち切る。
    const total = this.datasets.reduce(
      (n, d) => n + tileKeysFor(bbox, d.zooms[0]).length,
      0,
    );
    let done = 0;
    const tick = () => {
      done = Math.min(total, done + 1);
      onProgress?.(done, total);
    };

    for (const dataset of this.datasets) {
      for (const zoom of dataset.zooms) {
        const keys = tileKeysFor(bbox, zoom);
        const tiles = new Map<string, Uint8ClampedArray | null>();
        this.stats.requested += keys.length;
        await runPool(keys, this.concurrency, async ({ x, y }) => {
          try {
            const tile = await this.loadTile(dataset.url(zoom, x, y));
            tiles.set(`${x}/${y}`, tile);
            if (tile) this.stats.loaded += 1;
            else this.stats.missing += 1;
          } catch {
            tiles.set(`${x}/${y}`, null);
            this.stats.missing += 1;
          }
          tick();
        });
        const gotSomething = [...tiles.values()].some((t) => t !== null);
        if (gotSomething || zoom === dataset.zooms[dataset.zooms.length - 1]) {
          this.layers.push({ dataset, zoom, tiles });
          break;
        }
      }
    }
  }

  /** その地点で最も厳しい判定を返す。複数のデータセットを重ねた場合は最大値。 */
  sample(lat: number, lon: number): HazardSample {
    if (this.layers.length === 0) return SAFE_SAMPLE;
    let depth = 0;
    let flags = 0;
    let label = "";
    let depthUnknownOnly = true;

    for (const layer of this.layers) {
      const hit = sampleLayer(layer, lat, lon, this.sampleRadiusPx);
      flags |= hit.flags;
      if (hit.rank) {
        depthUnknownOnly = false;
        if (hit.rank.max > depth) {
          depth = hit.rank.max;
          label = `${layer.dataset.short} ${hit.rank.label}`;
        }
      } else if (hit.flags & HAZARD_ZONE) {
        if (!label) label = `${layer.dataset.short} 区域内`;
      } else if (hit.flags & HAZARD_DEPTH_UNKNOWN) {
        if (!label) label = `${layer.dataset.short} 区域内（深さ不明）`;
      }
    }

    // 着色はされているのに段階が読めなかった場合は、深さを断定しない。
    if (depthUnknownOnly && flags & HAZARD_DEPTH_UNKNOWN) {
      return { depth: Number.NaN, flags, label };
    }
    return { depth, flags, label };
  }
}

interface LayerHit {
  flags: number;
  rank: DepthRank | null;
}

function sampleLayer(
  layer: LoadedLayer,
  lat: number,
  lon: number,
  radius: number,
): LayerHit {
  const { zoom } = layer;
  const px = Math.floor(lonToTileX(lon, zoom) * TILE_SIZE);
  const py = Math.floor(latToTileY(lat, zoom) * TILE_SIZE);

  let flags = 0;
  let best: DepthRank | null = null;

  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      const pixel = pixelAt(layer, px + dx, py + dy);
      if (!pixel) continue; // タイルが無い＝未整備
      flags |= HAZARD_MAPPED;
      if (pixel[3] < ALPHA_THRESHOLD) continue; // 透明＝区域外
      if (layer.dataset.kind === "zone") {
        flags |= HAZARD_ZONE;
        continue;
      }
      flags |= HAZARD_INUNDATED;
      const rank = matchRank(layer.dataset.ranks, pixel);
      if (!rank) {
        flags |= HAZARD_DEPTH_UNKNOWN;
      } else if (!best || rank.max > best.max) {
        best = rank;
      }
    }
  }
  return { flags, rank: best };
}

/** 最も近い凡例の色に寄せる。許容差を超えたら「不明」。 */
export function matchRank(
  ranks: DepthRank[],
  pixel: [number, number, number, number] | Uint8ClampedArray,
): DepthRank | null {
  let best: DepthRank | null = null;
  let bestDist = COLOR_TOLERANCE * COLOR_TOLERANCE;
  for (const rank of ranks) {
    const dr = pixel[0] - rank.color[0];
    const dg = pixel[1] - rank.color[1];
    const db = pixel[2] - rank.color[2];
    const d = dr * dr + dg * dg + db * db;
    if (d < bestDist) {
      bestDist = d;
      best = rank;
    }
  }
  return best;
}

function pixelAt(
  layer: LoadedLayer,
  gx: number,
  gy: number,
): [number, number, number, number] | null {
  const world = TILE_SIZE * 2 ** layer.zoom;
  if (gy < 0 || gy >= world) return null;
  const wrapped = ((gx % world) + world) % world;
  const tx = Math.floor(wrapped / TILE_SIZE);
  const ty = Math.floor(gy / TILE_SIZE);
  const tile = layer.tiles.get(`${tx}/${ty}`);
  if (!tile) return null;
  const ix = wrapped - tx * TILE_SIZE;
  const iy = gy - ty * TILE_SIZE;
  const p = (iy * TILE_SIZE + ix) * 4;
  return [tile[p], tile[p + 1], tile[p + 2], tile[p + 3]];
}

/** 深さ[m]を「◯m」の表示にする。判定できないときは注記を返す。 */
export function formatDepth(depth: number, flags: number): string {
  if (!(flags & HAZARD_MAPPED)) return "ハザードマップ未整備";
  if (Number.isNaN(depth)) return "区域内（深さ不明）";
  if (depth === 0) return "浸水想定なし";
  if (!Number.isFinite(depth)) return "20m 以上";
  return `${depth}m 未満`;
}