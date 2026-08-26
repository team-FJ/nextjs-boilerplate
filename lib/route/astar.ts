/**
 * 経路探索の本体。
 *
 * 設計の要点は 2 つ。
 *   1. 指定標高より低い道は「重みを上げる」のではなく、辺ごとはじく（ハード制約）。
 *      重み付けだけだと、遠回りが嫌になった瞬間に低地へ降りてしまうため。
 *   2. 制約を満たす道の中では、余裕（安全マージン）の少ない低い道ほど割高にして、
 *      できるだけ高いところを通らせる（ソフトな高台優先）。
 *
 * 重みは必ず「実距離以上」になるようにしてあるので、
 * 直線距離をヒューリスティックにした A* が最適解を返す。
 */

import { clamp, haversine } from "./geo";
import type { RoadGraph } from "./graph";
import { HAZARD_MAPPED, HAZARD_ZONE } from "./hazard";

export interface CostOptions {
  /** これ未満の標高の道は通らない[m]（ハード制約）。 */
  minElevation: number;
  /** 上乗せしたい余裕[m]。この高さまでは「低め」と見なして割高にする。 */
  safetyMargin: number;
  /** 高台優先の強さ。0 で最短距離、大きいほど遠回りしてでも高いところを通る。 */
  highGroundBias: number;
  /** 上り 1m あたり何 m 歩いたぶんの負担と見なすか。 */
  climbPenaltyPerM: number;
  /** トンネル・地下道を避ける。 */
  avoidUnderground: boolean;
  /** 階段を避ける。 */
  avoidSteps: boolean;
  /** 標高が取得できなかった道を通ってよいか。 */
  allowUnknownElevation: boolean;

  /** ハザードマップによる判定を使うか。 */
  hazardEnabled: boolean;
  /**
   * 想定浸水深がこれを超える道は通らない[m]。
   * 0 なら「浸水想定区域には一切入らない」という意味になる。
   */
  hazardMaxDepth: number;
  /** 区域内だが凡例の色に一致せず、深さが読めない道を避ける。 */
  hazardAvoidUnknownDepth: boolean;
  /** ハザードマップが未整備の区域の道を通ってよいか。 */
  hazardAllowUnmapped: boolean;
  /** 土砂災害警戒区域などの「区域内かどうか」で判定するものを避ける。 */
  hazardAvoidZones: boolean;
  /** しきい値以下でも浸水想定区域をどれだけ避けるか。 */
  hazardBias: number;
}

/** 浸水深のペナルティを最大にする深さ[m]。これ以上は同じ重さに扱う。 */
const HAZARD_DEPTH_REF = 5;

export const DEFAULT_COST: CostOptions = {
  minElevation: 5,
  safetyMargin: 5,
  highGroundBias: 1.5,
  climbPenaltyPerM: 4,
  avoidUnderground: true,
  avoidSteps: false,
  allowUnknownElevation: false,
  hazardEnabled: false,
  hazardMaxDepth: 0,
  hazardAvoidUnknownDepth: true,
  hazardAllowUnmapped: true,
  hazardAvoidZones: true,
  hazardBias: 2,
};

/** 辺の代表標高＝両端のうち低いほう。低いほうで判定しないと谷を見逃す。 */
export function edgeMinElevation(g: RoadGraph, e: number): number {
  const a = g.nodeEle[g.edgeFrom[e]];
  const b = g.nodeEle[g.edgeTo[e]];
  if (Number.isNaN(a)) return b;
  if (Number.isNaN(b)) return a;
  return Math.min(a, b);
}

/**
 * 辺の代表的なハザード判定。
 * 両端のうち「厳しいほう」を採る。深さ不明が混じれば不明のまま扱う。
 */
export function edgeHazard(
  g: RoadGraph,
  e: number,
): { depth: number; flags: number } {
  const a = g.edgeFrom[e];
  const b = g.edgeTo[e];
  const da = g.nodeDepth[a];
  const db = g.nodeDepth[b];
  const depth = Number.isNaN(da) || Number.isNaN(db) ? Number.NaN : Math.max(da, db);
  return { depth, flags: g.nodeHazard[a] | g.nodeHazard[b] };
}

export function isEdgeAllowed(g: RoadGraph, e: number, o: CostOptions): boolean {
  const way = g.ways[g.edgeWay[e]];
  if (o.avoidUnderground && way.underground) return false;
  if (o.avoidSteps && way.steps) return false;

  if (o.hazardEnabled && !isHazardAllowed(g, e, o)) return false;

  const ele = edgeMinElevation(g, e);
  if (Number.isNaN(ele)) return o.allowUnknownElevation;
  return ele >= o.minElevation;
}

function isHazardAllowed(g: RoadGraph, e: number, o: CostOptions): boolean {
  const { depth, flags } = edgeHazard(g, e);
  if (o.hazardAvoidZones && flags & HAZARD_ZONE) return false;
  // タイルが 1 枚も無い＝その市区町村でハザードマップが未整備。
  // 判定できないだけで「危険」ではないので、既定では通す（警告は別に出す）。
  if (!(flags & HAZARD_MAPPED)) return o.hazardAllowUnmapped;
  if (Number.isNaN(depth)) return !o.hazardAvoidUnknownDepth;
  return depth <= o.hazardMaxDepth;
}

export function edgeWeight(g: RoadGraph, e: number, o: CostOptions): number {
  const len = g.edgeLen[e];
  const ele = edgeMinElevation(g, e);
  const cutoff = o.minElevation + Math.max(0, o.safetyMargin);

  // 標高不明の道は「ぎりぎりの低地」と同じ扱いにして最後の手段にする。
  let lowness: number;
  if (Number.isNaN(ele)) {
    lowness = 1;
  } else if (cutoff > o.minElevation) {
    lowness = clamp((cutoff - ele) / (cutoff - o.minElevation), 0, 1);
  } else {
    lowness = ele < cutoff ? 1 : 0;
  }

  const from = g.nodeEle[g.edgeFrom[e]];
  const to = g.nodeEle[g.edgeTo[e]];
  const climb =
    Number.isNaN(from) || Number.isNaN(to) ? 0 : Math.max(0, to - from);

  return (
    len * (1 + o.highGroundBias * lowness + o.hazardBias * hazardLowness(g, e, o)) +
    o.climbPenaltyPerM * climb
  );
}

/**
 * ハザードの「避けたさ」を 0〜1 で返す。
 * しきい値を満たしていても、浸かる想定の道より浸からない道を選ばせるために使う。
 */
function hazardLowness(g: RoadGraph, e: number, o: CostOptions): number {
  if (!o.hazardEnabled) return 0;
  const { depth, flags } = edgeHazard(g, e);
  if (flags & HAZARD_ZONE) return 1;
  if (Number.isNaN(depth)) return 1;
  if (depth > 0) return clamp(depth / HAZARD_DEPTH_REF, 0.25, 1);
  // 未整備の区域は判定できないぶんだけ、わずかに割高にしておく。
  return flags & HAZARD_MAPPED ? 0 : 0.15;
}

/** f 値の小さい順に取り出す二分ヒープ。 */
class MinHeap {
  private keys: Float64Array;
  private vals: Int32Array;
  private size = 0;

  constructor(capacity: number) {
    const cap = Math.max(16, capacity);
    this.keys = new Float64Array(cap);
    this.vals = new Int32Array(cap);
  }

  get length(): number {
    return this.size;
  }

  push(key: number, val: number) {
    if (this.size === this.keys.length) this.grow();
    let i = this.size;
    this.size += 1;
    this.keys[i] = key;
    this.vals[i] = val;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.keys[parent] <= this.keys[i]) break;
      this.swap(i, parent);
      i = parent;
    }
  }

  pop(): number {
    const top = this.vals[0];
    this.size -= 1;
    if (this.size > 0) {
      this.keys[0] = this.keys[this.size];
      this.vals[0] = this.vals[this.size];
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let small = i;
        if (l < this.size && this.keys[l] < this.keys[small]) small = l;
        if (r < this.size && this.keys[r] < this.keys[small]) small = r;
        if (small === i) break;
        this.swap(i, small);
        i = small;
      }
    }
    return top;
  }

  private swap(a: number, b: number) {
    const k = this.keys[a];
    this.keys[a] = this.keys[b];
    this.keys[b] = k;
    const v = this.vals[a];
    this.vals[a] = this.vals[b];
    this.vals[b] = v;
  }

  private grow() {
    const keys = new Float64Array(this.keys.length * 2);
    keys.set(this.keys);
    this.keys = keys;
    const vals = new Int32Array(this.vals.length * 2);
    vals.set(this.vals);
    this.vals = vals;
  }
}

export interface SearchOutcome {
  /** 出発地から目的地までの節点列。到達できなければ null。 */
  path: number[] | null;
  /** 探索で確定した節点数（デバッグ・表示用）。 */
  visited: number;
  /** 経路の重み合計。 */
  cost: number;
}

/** A*。goal に到達したら打ち切る。 */
export function findPath(
  g: RoadGraph,
  start: number,
  goal: number,
  o: CostOptions,
  maxPops = 4_000_000,
): SearchOutcome {
  if (start < 0 || goal < 0) return { path: null, visited: 0, cost: 0 };
  if (start === goal) return { path: [start], visited: 1, cost: 0 };

  const dist = new Float64Array(g.nodeCount).fill(Infinity);
  const prevEdge = new Int32Array(g.nodeCount).fill(-1);
  const done = new Uint8Array(g.nodeCount);
  const heap = new MinHeap(1024);

  const goalLat = g.nodeLat[goal];
  const goalLon = g.nodeLon[goal];
  const h = (n: number) =>
    haversine(
      { lat: g.nodeLat[n], lon: g.nodeLon[n] },
      { lat: goalLat, lon: goalLon },
    );

  dist[start] = 0;
  heap.push(h(start), start);
  let visited = 0;
  let pops = 0;

  while (heap.length > 0) {
    const node = heap.pop();
    pops += 1;
    if (pops > maxPops) break;
    if (done[node]) continue;
    done[node] = 1;
    visited += 1;
    if (node === goal) {
      return { path: tracePath(g, prevEdge, start, goal), visited, cost: dist[goal] };
    }
    for (let i = g.adjStart[node]; i < g.adjStart[node + 1]; i += 1) {
      const e = g.adjEdges[i];
      if (!isEdgeAllowed(g, e, o)) continue;
      const next = g.edgeTo[e];
      if (done[next]) continue;
      const nd = dist[node] + edgeWeight(g, e, o);
      if (nd < dist[next]) {
        dist[next] = nd;
        prevEdge[next] = e;
        heap.push(nd + h(next), next);
      }
    }
  }
  return { path: null, visited, cost: Infinity };
}

export interface ReachableResult {
  dist: Float64Array;
  prevEdge: Int32Array;
  /** 到達できた節点の数。 */
  count: number;
}

/**
 * 制約を満たす道だけを使って、出発地からどこまで行けるかを全部調べる。
 * 目的地へ行けなかったときに「では、どこまでなら安全に行けるのか」を示すために使う。
 */
export function exploreReachable(
  g: RoadGraph,
  start: number,
  o: CostOptions,
  maxPops = 4_000_000,
): ReachableResult {
  const dist = new Float64Array(g.nodeCount).fill(Infinity);
  const prevEdge = new Int32Array(g.nodeCount).fill(-1);
  const done = new Uint8Array(g.nodeCount);
  const heap = new MinHeap(1024);
  let count = 0;
  let pops = 0;

  if (start >= 0) {
    dist[start] = 0;
    heap.push(0, start);
  }
  while (heap.length > 0) {
    const node = heap.pop();
    pops += 1;
    if (pops > maxPops) break;
    if (done[node]) continue;
    done[node] = 1;
    count += 1;
    for (let i = g.adjStart[node]; i < g.adjStart[node + 1]; i += 1) {
      const e = g.adjEdges[i];
      if (!isEdgeAllowed(g, e, o)) continue;
      const next = g.edgeTo[e];
      if (done[next]) continue;
      const nd = dist[node] + edgeWeight(g, e, o);
      if (nd < dist[next]) {
        dist[next] = nd;
        prevEdge[next] = e;
        heap.push(nd, next);
      }
    }
  }
  return { dist, prevEdge, count };
}

export function tracePath(
  g: RoadGraph,
  prevEdge: Int32Array,
  start: number,
  goal: number,
): number[] | null {
  const path: number[] = [goal];
  let cur = goal;
  let guard = 0;
  while (cur !== start) {
    const e = prevEdge[cur];
    if (e < 0 || guard > g.nodeCount + 8) return null;
    cur = g.edgeFrom[e];
    path.push(cur);
    guard += 1;
  }
  path.reverse();
  return path;
}
