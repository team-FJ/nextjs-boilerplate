/**
 * 地理計算のごく基本的な道具。
 * ここは純粋な関数だけにしてあるので、ブラウザでも Node のテストでもそのまま動く。
 */

export interface LatLng {
  lat: number;
  lon: number;
}

/** 南西・北東で表した矩形。 */
export interface BBox {
  south: number;
  west: number;
  north: number;
  east: number;
}

const EARTH_RADIUS_M = 6371008.8;
const DEG = Math.PI / 180;

/** 2点間の距離（メートル）。 */
export function haversine(a: LatLng, b: LatLng): number {
  const dLat = (b.lat - a.lat) * DEG;
  const dLon = (b.lon - a.lon) * DEG;
  const la1 = a.lat * DEG;
  const la2 = b.lat * DEG;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** 2点を含む最小の矩形に、指定メートルの余白を足したもの。 */
export function boundsOf(points: LatLng[], marginM = 0): BBox {
  let south = Infinity;
  let west = Infinity;
  let north = -Infinity;
  let east = -Infinity;
  for (const p of points) {
    if (p.lat < south) south = p.lat;
    if (p.lat > north) north = p.lat;
    if (p.lon < west) west = p.lon;
    if (p.lon > east) east = p.lon;
  }
  if (marginM > 0) {
    const dLat = marginM / 111320;
    const midLat = (south + north) / 2;
    const dLon = marginM / (111320 * Math.max(0.05, Math.cos(midLat * DEG)));
    south -= dLat;
    north += dLat;
    west -= dLon;
    east += dLon;
  }
  return {
    south: Math.max(-85, south),
    north: Math.min(85, north),
    west: Math.max(-180, west),
    east: Math.min(180, east),
  };
}

/** 矩形の対角線の長さ（メートル）。探索範囲が広すぎないかの判定に使う。 */
export function bboxDiagonalM(b: BBox): number {
  return haversine(
    { lat: b.south, lon: b.west },
    { lat: b.north, lon: b.east },
  );
}

export function bboxCenter(b: BBox): LatLng {
  return { lat: (b.south + b.north) / 2, lon: (b.west + b.east) / 2 };
}

/** 経度 → Web メルカトルのタイル X 座標（小数）。 */
export function lonToTileX(lon: number, z: number): number {
  return ((lon + 180) / 360) * 2 ** z;
}

/** 緯度 → Web メルカトルのタイル Y 座標（小数）。 */
export function latToTileY(lat: number, z: number): number {
  const s = Math.sin(Math.max(-85.05112878, Math.min(85.05112878, lat)) * DEG);
  return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * 2 ** z;
}

/** 座標をキー文字列にする。OSM の交差点は同じ座標を共有するのでこれで同一視できる。 */
export function coordKey(lat: number, lon: number): string {
  return `${lat.toFixed(7)},${lon.toFixed(7)}`;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** タイル X 座標（小数）→ 経度。 */
export function tileXToLon(x: number, z: number): number {
  return (x / 2 ** z) * 360 - 180;
}

/** タイル Y 座標（小数）→ 緯度。 */
export function tileYToLat(y: number, z: number): number {
  const n = Math.PI - 2 * Math.PI * (y / 2 ** z);
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}
