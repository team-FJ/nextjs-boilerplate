/**
 * 住所・地名から座標を引く（国土地理院の地名検索 API）。
 * 使えなかった場合は地図クリックで指定してもらえばよいので、失敗しても致命ではない。
 */

import type { LatLng } from "./geo";

const ENDPOINT = "https://msearch.gsi.go.jp/address-search/AddressSearch";

export interface GeocodeHit extends LatLng {
  title: string;
}

export async function geocode(
  query: string,
  signal?: AbortSignal,
): Promise<GeocodeHit[]> {
  const q = query.trim();
  if (!q) return [];
  const res = await fetch(`${ENDPOINT}?q=${encodeURIComponent(q)}`, { signal });
  if (!res.ok) throw new Error(`住所検索に失敗しました（${res.status}）`);
  const json: unknown = await res.json();
  if (!Array.isArray(json)) return [];
  const hits: GeocodeHit[] = [];
  for (const raw of json) {
    const f = raw as {
      geometry?: { coordinates?: [number, number] };
      properties?: { title?: string };
    };
    const c = f.geometry?.coordinates;
    if (!c || !Number.isFinite(c[0]) || !Number.isFinite(c[1])) continue;
    hits.push({ lon: c[0], lat: c[1], title: f.properties?.title ?? q });
  }
  return hits.slice(0, 8);
}
