/**
 * 地図タイルの定義。すべて出典表示が必要なので、layer ごとに attribution を持たせる。
 */

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

/** 重ねるハザードマップのタイル。避けたい範囲を目で確かめるために使う。 */
export const HAZARD_LAYERS: TileLayerDef[] = [
  {
    id: "flood",
    label: "洪水浸水想定（想定最大規模）",
    url: "https://disaportaldata.gsi.go.jp/raster/01_flood_l2_shinsuishin_data/{z}/{x}/{y}.png",
    attribution: HAZARD_ATTR,
    maxZoom: 19,
    maxNativeZoom: 17,
  },
  {
    id: "tsunami",
    label: "津波浸水想定",
    url: "https://disaportaldata.gsi.go.jp/raster/04_tsunami_newlegend_data/{z}/{x}/{y}.png",
    attribution: HAZARD_ATTR,
    maxZoom: 19,
    maxNativeZoom: 17,
  },
  {
    id: "hightide",
    label: "高潮浸水想定",
    url: "https://disaportaldata.gsi.go.jp/raster/03_hightide_l2_shinsuishin_data/{z}/{x}/{y}.png",
    attribution: HAZARD_ATTR,
    maxZoom: 19,
    maxNativeZoom: 17,
  },
  {
    id: "doseki",
    label: "土砂災害警戒区域（土石流）",
    url: "https://disaportaldata.gsi.go.jp/raster/05_dosekiryukeikaikuiki/{z}/{x}/{y}.png",
    attribution: HAZARD_ATTR,
    maxZoom: 19,
    maxNativeZoom: 17,
  },
];

export const OSM_ATTRIBUTION =
  '道路データ © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors';
