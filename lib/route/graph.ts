/**
 * OSM の道路データと標高から、経路探索用のグラフを組み立てる。
 *
 * 節点・辺は型付き配列に平坦化して持つ。数万規模になっても
 * 探索が重くならないようにするため。
 */

import { coordKey, haversine, type LatLng } from "./geo";
import type { DemSampler } from "./dem";
import type { OsmWay } from "./overpass";
import { isSteps, isUnderground, type Profile } from "./profiles";

export interface WayMeta {
  id: number;
  name: string;
  highway: string;
  /** トンネル・地下道。災害時は既定で避ける。 */
  underground: boolean;
  steps: boolean;
}

export interface RoadGraph {
  nodeCount: number;
  nodeLat: Float64Array;
  nodeLon: Float64Array;
  /** 標高[m]。データが無ければ NaN。 */
  nodeEle: Float32Array;
  edgeCount: number;
  edgeFrom: Int32Array;
  edgeTo: Int32Array;
  /** 辺の長さ[m]。 */
  edgeLen: Float32Array;
  edgeWay: Int32Array;
  /** 隣接リスト（CSR）。node i の辺は adjEdges[adjStart[i] .. adjStart[i+1]) 。 */
  adjStart: Int32Array;
  adjEdges: Int32Array;
  ways: WayMeta[];
  /** 最寄り節点探索用の格子索引。 */
  index: GridIndex;
}

export interface BuildGraphResult {
  graph: RoadGraph;
  /** 標高が取れなかった節点の数。 */
  unknownElevation: number;
}

function isOnewayForward(tags: Record<string, string>): boolean {
  const v = tags.oneway;
  if (v === "yes" || v === "true" || v === "1") return true;
  return tags.junction === "roundabout" && v !== "no";
}

function isOnewayBackward(tags: Record<string, string>): boolean {
  const v = tags.oneway;
  return v === "-1" || v === "reverse";
}

export function buildGraph(
  ways: OsmWay[],
  profile: Profile,
  dem: DemSampler | null,
): BuildGraphResult {
  const nodeIndex = new Map<string | number, number>();
  const lat: number[] = [];
  const lon: number[] = [];

  const edgeFrom: number[] = [];
  const edgeTo: number[] = [];
  const edgeLen: number[] = [];
  const edgeWay: number[] = [];
  const meta: WayMeta[] = [];

  const nodeIdFor = (
    way: OsmWay,
    i: number,
    p: { lat: number; lon: number },
  ): number => {
    // 節点 ID があればそれを、無ければ座標をキーにする。
    // OSM の交差点は節点を共有するので、座標一致でも同じ判定になる。
    const key = way.nodes ? way.nodes[i] : coordKey(p.lat, p.lon);
    const found = nodeIndex.get(key);
    if (found !== undefined) return found;
    const idx = lat.length;
    nodeIndex.set(key, idx);
    lat.push(p.lat);
    lon.push(p.lon);
    return idx;
  };

  for (const way of ways) {
    if (!profile.allows(way.tags)) continue;
    const wayIdx = meta.length;
    meta.push({
      id: way.id,
      name: way.tags.name ?? way.tags["name:ja"] ?? "",
      highway: way.tags.highway ?? "",
      underground: isUnderground(way.tags),
      steps: isSteps(way.tags),
    });

    const forward = !profile.respectOneway || !isOnewayBackward(way.tags);
    const backward = !profile.respectOneway || !isOnewayForward(way.tags);

    let prev = nodeIdFor(way, 0, way.geometry[0]);
    for (let i = 1; i < way.geometry.length; i += 1) {
      const cur = nodeIdFor(way, i, way.geometry[i]);
      if (cur === prev) continue;
      const len = haversine(
        { lat: lat[prev], lon: lon[prev] },
        { lat: lat[cur], lon: lon[cur] },
      );
      if (forward) {
        edgeFrom.push(prev);
        edgeTo.push(cur);
        edgeLen.push(len);
        edgeWay.push(wayIdx);
      }
      if (backward) {
        edgeFrom.push(cur);
        edgeTo.push(prev);
        edgeLen.push(len);
        edgeWay.push(wayIdx);
      }
      prev = cur;
    }
  }

  const nodeCount = lat.length;
  const nodeEle = new Float32Array(nodeCount);
  let unknownElevation = 0;
  for (let i = 0; i < nodeCount; i += 1) {
    const e = dem ? dem.sample(lat[i], lon[i]) : Number.NaN;
    nodeEle[i] = e;
    if (Number.isNaN(e)) unknownElevation += 1;
  }

  // 隣接リストを CSR に詰め直す。
  const edgeCount = edgeFrom.length;
  const adjStart = new Int32Array(nodeCount + 1);
  for (let e = 0; e < edgeCount; e += 1) adjStart[edgeFrom[e] + 1] += 1;
  for (let i = 0; i < nodeCount; i += 1) adjStart[i + 1] += adjStart[i];
  const cursor = Int32Array.from(adjStart.subarray(0, nodeCount));
  const adjEdges = new Int32Array(edgeCount);
  for (let e = 0; e < edgeCount; e += 1) {
    adjEdges[cursor[edgeFrom[e]]] = e;
    cursor[edgeFrom[e]] += 1;
  }

  const nodeLat = Float64Array.from(lat);
  const nodeLon = Float64Array.from(lon);

  return {
    graph: {
      nodeCount,
      nodeLat,
      nodeLon,
      nodeEle,
      edgeCount,
      edgeFrom: Int32Array.from(edgeFrom),
      edgeTo: Int32Array.from(edgeTo),
      edgeLen: Float32Array.from(edgeLen),
      edgeWay: Int32Array.from(edgeWay),
      adjStart,
      adjEdges,
      ways: meta,
      index: new GridIndex(nodeLat, nodeLon),
    },
    unknownElevation,
  };
}

/**
 * 緯度経度を等間隔で切った格子に節点を放り込むだけの索引。
 * 最寄り節点を求めるときに、全件走査を避けるために使う。
 */
export class GridIndex {
  private readonly cells = new Map<string, number[]>();
  private readonly cell = 0.002; // だいたい 200m 四方

  constructor(
    private readonly lat: Float64Array,
    private readonly lon: Float64Array,
  ) {
    for (let i = 0; i < lat.length; i += 1) {
      const key = this.keyOf(lat[i], lon[i]);
      const bucket = this.cells.get(key);
      if (bucket) bucket.push(i);
      else this.cells.set(key, [i]);
    }
  }

  private keyOf(lat: number, lon: number): string {
    return `${Math.floor(lat / this.cell)}/${Math.floor(lon / this.cell)}`;
  }

  /**
   * 条件を満たす最寄り節点を返す。見つからなければ -1。
   * accept を渡すと「その節点を使ってよいか」で絞り込める。
   */
  nearest(
    target: LatLng,
    accept?: (node: number) => boolean,
    maxRings = 40,
  ): { node: number; distance: number } {
    const gy = Math.floor(target.lat / this.cell);
    const gx = Math.floor(target.lon / this.cell);
    let best = -1;
    let bestDist = Infinity;

    for (let ring = 0; ring <= maxRings; ring += 1) {
      for (let dy = -ring; dy <= ring; dy += 1) {
        for (let dx = -ring; dx <= ring; dx += 1) {
          // すでに見た内側の輪はとばす。
          if (ring > 0 && Math.abs(dy) !== ring && Math.abs(dx) !== ring) continue;
          const bucket = this.cells.get(`${gy + dy}/${gx + dx}`);
          if (!bucket) continue;
          for (const node of bucket) {
            if (accept && !accept(node)) continue;
            const d = haversine(target, {
              lat: this.lat[node],
              lon: this.lon[node],
            });
            if (d < bestDist) {
              bestDist = d;
              best = node;
            }
          }
        }
      }
      // 1 つ見つけたあと、取りこぼしが無いよう 1 輪だけ余分に見る。
      if (best >= 0 && bestDist <= ring * this.cell * 111320) break;
    }
    return { node: best, distance: best >= 0 ? bestDist : Infinity };
  }
}
