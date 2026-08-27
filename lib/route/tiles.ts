/**
 * 地図タイルの定義。すべて出典表示が必要なので、layer ごとに attribution を持たせる。
 */

import { HAZARD_DATASETS } from "./hazard";

export interface TileLayerDef {
  id: string;
  label: string;
  url: string;
  attribution: string;
  maxZoom: number;
  /** タイルが用意されている最大ズーム（それ以上は引き伸ばす）。 */
  maxNativeZoom?: number;
  note?: string;
}

const GSI_ATTR =
  '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noreferrer">国土地理院</a>';
const HAZARD_ATTR =
  '<a href="https://disaportal.gsi.go.jp/" target="_blank" rel="noreferrer">ハザードマップポータルサイト</a>';

export const BASE_LAYERS: TileLayerDef[] = [
  {
    id: "pale",
    label: "淡色地図",
    url: "https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png",
    attribution: GSI_ATTR,
    maxZoom: 19,
    maxNativeZoom: 18,
  },
  {
    id: "std",
    label: "標準地図",
    url: "https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png",
    attribution: GSI_ATTR,
    maxZoom: 19,
    maxNativeZoom: 18,
  },
  {
    id: "relief",
    label: "色別標高図",
    url: "https://cyberjapandata.gsi.go.jp/xyz/relief/{z}/{x}/{y}.png",
    attribution: GSI_ATTR,
    maxZoom: 19,
    maxNativeZoom: 15,
    note: "標高の高低が色で分かる。高台探しに向く。",
  },
  {
    id: "photo",
    label: "写真",
    url: "https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg",
    attribution: GSI_ATTR,
    maxZoom: 19,
    maxNativeZoom: 18,
  },
];

/**
 * 重ねるハザードマップのタイル。
 * 経路探索で使うデータセット（lib/route/hazard.ts）と同じものを地図にも重ねる。
 * 定義を 1 か所にまとめておかないと、「画面に出ている区域」と
 * 「計算で避けている区域」がずれてしまう。
 */
export const HAZARD_LAYERS: TileLayerDef[] = HAZARD_DATASETS.map((d) => ({
  id: d.id,
  label: d.label,
  url: d.url(0, 0, 0).replace("/0/0/0.png", "/{z}/{x}/{y}.png"),
  attribution: HAZARD_ATTR,
  maxZoom: 19,
  maxNativeZoom: d.maxNativeZoom,
  note: d.note,
}));

export const OSM_ATTRIBUTION =
  '道路データ © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors';
