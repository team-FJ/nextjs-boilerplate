/**
 * OpenStreetMap の道路データを Overpass API から取ってくる。
 * ブラウザから直接叩くので、サーバーは不要（GitHub Pages でも動く）。
 */

import type { BBox } from "./geo";
import type { OsmTags } from "./profiles";

/** 混雑時に備えて複数のミラーを順に試す。 */
export const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

export interface OsmWay {
  id: number;
  tags: OsmTags;
  /** 道なりの座標列。 */
  geometry: { lat: number; lon: number }[];
  /** 交差点の同一視に使う節点 ID（無い場合は座標で代用する）。 */
  nodes?: number[];
}

export function buildOverpassQuery(bbox: BBox, timeoutSec = 90): string {
  const b = `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`;
  // area=yes（歩行者広場のポリゴンなど）は線として扱えないので除く。
  return `[out:json][timeout:${timeoutSec}];
way["highway"]["highway"!~"^(proposed|construction|raceway|bus_guideway|escape|platform)$"]["area"!="yes"](${b});
out body geom;`;
}

export interface FetchRoadsOptions {
  signal?: AbortSignal;
  endpoints?: string[];
  onAttempt?: (endpoint: string, index: number, total: number) => void;
}

export async function fetchRoads(
  bbox: BBox,
  opts: FetchRoadsOptions = {},
): Promise<OsmWay[]> {
  const endpoints = opts.endpoints ?? OVERPASS_ENDPOINTS;
  const query = buildOverpassQuery(bbox);
  let lastError: unknown = null;

  for (let i = 0; i < endpoints.length; i += 1) {
    const endpoint = endpoints[i];
    opts.onAttempt?.(endpoint, i, endpoints.length);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        body: new URLSearchParams({ data: query }),
        signal: opts.signal,
      });
      if (!res.ok) {
        throw new Error(`Overpass ${res.status} ${res.statusText}`);
      }
      const json = await res.json();
      return parseOverpass(json);
    } catch (err) {
      if (opts.signal?.aborted) throw err;
      lastError = err;
    }
  }
  throw new Error(
    `道路データを取得できませんでした（${endpoints.length} 箇所すべて失敗）: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}

export function parseOverpass(json: unknown): OsmWay[] {
  const elements = (json as { elements?: unknown[] })?.elements;
  if (!Array.isArray(elements)) return [];
  const ways: OsmWay[] = [];
  for (const raw of elements) {
    const el = raw as {
      type?: string;
      id?: number;
      tags?: OsmTags;
      geometry?: { lat: number; lon: number }[];
      nodes?: number[];
    };
    if (el.type !== "way" || !Array.isArray(el.geometry)) continue;
    const geometry = el.geometry.filter(
      (p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lon),
    );
    if (geometry.length < 2) continue;
    ways.push({
      id: el.id ?? ways.length,
      tags: el.tags ?? {},
      geometry,
      nodes: el.nodes && el.nodes.length === el.geometry.length ? el.nodes : undefined,
    });
  }
  return ways;
}
