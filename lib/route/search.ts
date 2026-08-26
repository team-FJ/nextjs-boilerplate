/**
 * 経路探索の入口。
 * 「道路データの取得 → 標高の取得 → グラフ構築 → 探索 → 集計」までを一続きにする。
 * 通信は全部ブラウザから直接行うので、サーバーは要らない。
 */

import {
  DEFAULT_COST,
  exploreReachable,
  findPath,
  isEdgeAllowed,
  tracePath,
  type CostOptions,
} from "./astar";
import {
  createBrowserTileLoader,
  DemSampler,
  GSI_DEM5_SOURCE,
  GSI_DEM_SOURCES,
  type DemSource,
  type TileLoader,
} from "./dem";
import { bboxDiagonalM, boundsOf, clamp, haversine, type BBox, type LatLng } from "./geo";
import { buildGraph, type RoadGraph } from "./graph";
import { fetchRoads, type OsmWay } from "./overpass";
import { PROFILES, type ProfileId } from "./profiles";

/** 一度に扱える範囲の上限。これを超えると Overpass もブラウザも辛い。 */
export const MAX_SEARCH_DIAGONAL_M = 40_000;

export interface RoutePoint {
  lat: number;
  lon: number;
  /** 標高[m]。不明なら NaN。 */
  ele: number;
  /** 出発地からの累積距離[m]。 */
  dist: number;
}

export interface RouteStats {
  distanceM: number;
  durationSec: number;
  minElevation: number;
  maxElevation: number;
  avgElevation: number;
  ascentM: number;
  descentM: number;
  /** 指定標高を下回る区間の合計距離[m]。 */
  belowThresholdM: number;
  /** 標高が取得できなかった区間の合計距離[m]。 */
  unknownM: number;
}

export interface RouteResult {
  points: RoutePoint[];
  stats: RouteStats;
  /** 通る主な道路の名前（表示用、多い順）。 */
  roadNames: string[];
}

export interface SnapInfo {
  requested: LatLng;
  point: LatLng;
  distanceM: number;
  elevation: number;
  /** 標高条件を満たす道が近くに無く、離れた地点から探索したか。 */
  relaxed: boolean;
}

export interface SearchProgress {
  stage: "roads" | "elevation" | "graph" | "search" | "done";
  message: string;
  ratio?: number;
}

export interface SearchParams {
  start: LatLng;
  goal: LatLng;
  profileId: ProfileId;
  cost: CostOptions;
  /** 5m メッシュを優先して使う（精度は上がるが読み込みは増える）。 */
  highPrecisionDem?: boolean;
  signal?: AbortSignal;
  onProgress?: (p: SearchProgress) => void;
  /** テスト用の差し替え口。 */
  loadRoads?: (bbox: BBox) => Promise<OsmWay[]>;
  loadTile?: TileLoader;
}

export interface SearchResult {
  bbox: BBox;
  /** 標高条件を満たすルート。見つからなければ null。 */
  safe: RouteResult | null;
  /** 比較用の、条件なしの最短ルート。 */
  shortest: RouteResult | null;
  startSnap: SnapInfo;
  goalSnap: SnapInfo;
  /**
   * 目的地へ到達できなかったときの代替行き先。
   * 条件を満たしたまま行ける範囲で、いちばん標高が高い地点。
   */
  fallback: { point: LatLng; elevation: number; route: RouteResult } | null;
  warnings: string[];
  demSourceLabels: string[];
  graphSummary: { nodes: number; edges: number; ways: number; unknownElevation: number };
}

export async function searchRoute(params: SearchParams): Promise<SearchResult> {
  const { start, goal, signal } = params;
  const notify = (p: SearchProgress) => params.onProgress?.(p);
  const warnings: string[] = [];

  const direct = haversine(start, goal);
  // 低地を避けるぶんの遠回りが入るので、直線距離よりだいぶ広めに取る。
  const margin = clamp(direct * 0.6, 1200, 8000);
  const bbox = boundsOf([start, goal], margin);
  const diagonal = bboxDiagonalM(bbox);
  if (diagonal > MAX_SEARCH_DIAGONAL_M) {
    throw new Error(
      `探索範囲が広すぎます（対角 ${Math.round(diagonal / 1000)}km）。` +
        `2 地点の距離を ${Math.round(MAX_SEARCH_DIAGONAL_M / 2000)}km 程度までにしてください。`,
    );
  }

  notify({ stage: "roads", message: "道路データを取得しています…" });
  const loadRoads =
    params.loadRoads ?? ((b: BBox) => fetchRoads(b, { signal }));
  const ways = await loadRoads(bbox);
  if (ways.length === 0) {
    throw new Error("この範囲に道路データが見つかりませんでした。");
  }

  notify({ stage: "elevation", message: "標高データを取得しています…", ratio: 0 });
  const sources: DemSource[] = params.highPrecisionDem
    ? [GSI_DEM5_SOURCE, ...GSI_DEM_SOURCES]
    : GSI_DEM_SOURCES;
  const dem = new DemSampler(
    sources,
    params.loadTile ?? createBrowserTileLoader(signal),
  );
  // 道路データは bbox の境界をまたいだ形で返ってくる。
  // 境界付近の節点が「標高不明」にならないよう、標高だけ少し広めに読む。
  const demBBox = boundsOf(
    [
      { lat: bbox.south, lon: bbox.west },
      { lat: bbox.north, lon: bbox.east },
    ],
    500,
  );
  await dem.prepare(demBBox, (done, total) =>
    notify({
      stage: "elevation",
      message: `標高データを取得しています…（${done}/${total}）`,
      ratio: total > 0 ? done / total : 0,
    }),
  );

  if (dem.stats.loaded === 0) {
    warnings.push(
      "標高タイルを 1 枚も取得できませんでした。" +
        "通信環境か、国土地理院のサーバーへの接続をご確認ください。",
    );
  }

  notify({ stage: "graph", message: "道路網を組み立てています…" });
  const profile = PROFILES[params.profileId];
  const { graph, unknownElevation } = buildGraph(ways, profile, dem);
  if (graph.nodeCount === 0) {
    throw new Error(`この範囲に「${profile.label}」で通れる道がありませんでした。`);
  }
  if (unknownElevation > 0) {
    const pct = Math.round((unknownElevation / graph.nodeCount) * 100);
    if (pct >= 5) {
      warnings.push(
        `標高を取得できなかった地点が ${pct}% あります（海上・整備範囲外の可能性）。`,
      );
    }
  }

  notify({ stage: "search", message: "ルートを計算しています…" });
  const cost = { ...DEFAULT_COST, ...params.cost };
  const startSnap = snap(graph, start, cost);
  const goalSnap = snap(graph, goal, cost);

  if (startSnap.noneAvailable || goalSnap.noneAvailable) {
    warnings.push(
      `探索範囲内に標高 ${cost.minElevation}m 以上の道がありません。` +
        "「通らない標高」を下げるか、地点を変えてください。",
    );
  } else {
    if (startSnap.relaxed) {
      warnings.push(
        `出発地の周辺は標高 ${cost.minElevation}m 未満です。` +
          `条件を満たす最寄りの道（約 ${Math.round(startSnap.distanceM)}m 先）から案内します。`,
      );
    }
    if (goalSnap.relaxed) {
      warnings.push(
        `目的地の周辺は標高 ${cost.minElevation}m 未満です。` +
          `条件を満たす最寄りの道（約 ${Math.round(goalSnap.distanceM)}m 手前）までを案内します。`,
      );
    }
  }

  const safePath =
    startSnap.node >= 0 && goalSnap.node >= 0
      ? findPath(graph, startSnap.node, goalSnap.node, cost).path
      : null;
  const safe = safePath ? buildRoute(graph, safePath, profile.speedKmh, cost) : null;

  // 比較用：標高もトンネルも気にしない、いつもの最短ルート。
  const plainCost: CostOptions = {
    ...cost,
    minElevation: -Infinity,
    safetyMargin: 0,
    highGroundBias: 0,
    climbPenaltyPerM: 0,
    avoidUnderground: false,
    avoidSteps: false,
    allowUnknownElevation: true,
  };
  const plainStart = graph.index.nearest(start).node;
  const plainGoal = graph.index.nearest(goal).node;
  const plainPath =
    plainStart >= 0 && plainGoal >= 0
      ? findPath(graph, plainStart, plainGoal, plainCost).path
      : null;
  const shortest = plainPath
    ? buildRoute(graph, plainPath, profile.speedKmh, cost)
    : null;

  let fallback: SearchResult["fallback"] = null;
  if (!safe && startSnap.node >= 0) {
    fallback = findHighestReachable(graph, startSnap.node, cost, profile.speedKmh);
    if (fallback) {
      warnings.push(
        `条件を満たしたまま目的地へ抜ける道が見つかりませんでした。` +
          `到達できる範囲で最も高い地点（標高 ${fallback.elevation.toFixed(1)}m）への経路を表示します。`,
      );
    } else {
      warnings.push(
        "条件を満たす道が出発地の周辺にありません。最低標高を下げて試してください。",
      );
    }
  }

  notify({ stage: "done", message: "完了" });

  return {
    bbox,
    safe,
    shortest,
    startSnap: toSnapInfo(graph, start, startSnap),
    goalSnap: toSnapInfo(graph, goal, goalSnap),
    fallback,
    warnings,
    demSourceLabels: dem.usedSourceLabels(),
    graphSummary: {
      nodes: graph.nodeCount,
      edges: graph.edgeCount,
      ways: graph.ways.length,
      unknownElevation,
    },
  };
}

interface SnapResult {
  node: number;
  distanceM: number;
  relaxed: boolean;
  /** 条件を満たす道が範囲内に 1 本も無かった。 */
  noneAvailable: boolean;
}

/**
 * 指定地点を道路上の節点に寄せる。
 * まず条件を満たす道を探し、無ければ条件を外した最寄りの道に寄せて「緩めた」と記録する。
 */
function snap(g: RoadGraph, target: LatLng, o: CostOptions): SnapResult {
  const usable = (node: number) => {
    for (let i = g.adjStart[node]; i < g.adjStart[node + 1]; i += 1) {
      if (isEdgeAllowed(g, g.adjEdges[i], o)) return true;
    }
    return false;
  };
  const strict = g.index.nearest(target, usable);
  const loose = g.index.nearest(target);
  if (strict.node < 0) {
    return {
      node: loose.node,
      distanceM: loose.distance,
      relaxed: loose.node >= 0,
      noneAvailable: true,
    };
  }
  // 条件なしの最寄りより明らかに遠いなら、低地から抜け出す必要があるということ。
  const relaxed = strict.distance > loose.distance + 30;
  return { node: strict.node, distanceM: strict.distance, relaxed, noneAvailable: false };
}

function toSnapInfo(g: RoadGraph, requested: LatLng, s: SnapResult): SnapInfo {
  if (s.node < 0) {
    return {
      requested,
      point: requested,
      distanceM: Infinity,
      elevation: Number.NaN,
      relaxed: true,
    };
  }
  return {
    requested,
    point: { lat: g.nodeLat[s.node], lon: g.nodeLon[s.node] },
    distanceM: s.distanceM,
    elevation: g.nodeEle[s.node],
    relaxed: s.relaxed,
  };
}

/** 到達できる範囲で最も標高が高い地点を探し、そこまでの経路を作る。 */
function findHighestReachable(
  g: RoadGraph,
  start: number,
  o: CostOptions,
  speedKmh: number,
): SearchResult["fallback"] {
  const { dist, prevEdge, count } = exploreReachable(g, start, o);
  if (count <= 1) return null;
  let best = -1;
  let bestEle = -Infinity;
  for (let n = 0; n < g.nodeCount; n += 1) {
    if (!Number.isFinite(dist[n])) continue;
    const ele = g.nodeEle[n];
    if (Number.isNaN(ele)) continue;
    if (ele > bestEle) {
      bestEle = ele;
      best = n;
    }
  }
  if (best < 0 || best === start) return null;
  const path = tracePath(g, prevEdge, start, best);
  if (!path) return null;
  return {
    point: { lat: g.nodeLat[best], lon: g.nodeLon[best] },
    elevation: bestEle,
    route: buildRoute(g, path, speedKmh, o),
  };
}

/** 節点列 → 座標つき経路と各種集計。 */
export function buildRoute(
  g: RoadGraph,
  path: number[],
  speedKmh: number,
  o: CostOptions,
): RouteResult {
  const points: RoutePoint[] = [];
  let total = 0;
  let ascent = 0;
  let descent = 0;
  let below = 0;
  let unknown = 0;
  let eleSum = 0;
  let eleWeight = 0;
  let minEle = Infinity;
  let maxEle = -Infinity;
  const nameLength = new Map<string, number>();

  for (let i = 0; i < path.length; i += 1) {
    const n = path[i];
    const ele = g.nodeEle[n];
    if (i > 0) {
      const prev = path[i - 1];
      const seg = haversine(
        { lat: g.nodeLat[prev], lon: g.nodeLon[prev] },
        { lat: g.nodeLat[n], lon: g.nodeLon[n] },
      );
      total += seg;
      const prevEle = g.nodeEle[prev];
      if (!Number.isNaN(prevEle) && !Number.isNaN(ele)) {
        const d = ele - prevEle;
        if (d > 0) ascent += d;
        else descent -= d;
      }
      const segEle =
        Number.isNaN(prevEle) || Number.isNaN(ele)
          ? Number.NaN
          : Math.min(prevEle, ele);
      if (Number.isNaN(segEle)) unknown += seg;
      else {
        if (segEle < o.minElevation) below += seg;
        eleSum += segEle * seg;
        eleWeight += seg;
      }
      const edge = findEdge(g, prev, n);
      if (edge >= 0) {
        const name = g.ways[g.edgeWay[edge]].name;
        if (name) nameLength.set(name, (nameLength.get(name) ?? 0) + seg);
      }
    }
    if (!Number.isNaN(ele)) {
      if (ele < minEle) minEle = ele;
      if (ele > maxEle) maxEle = ele;
    }
    points.push({ lat: g.nodeLat[n], lon: g.nodeLon[n], ele, dist: total });
  }

  // 徒歩は上りぶんの時間を足す（標高差 600m ≒ 1 時間、いわゆるネイスミスの法則）。
  const flatSec = (total / 1000 / speedKmh) * 3600;
  const climbSec = speedKmh <= 8 ? ascent * 6 : 0;

  return {
    points,
    stats: {
      distanceM: total,
      durationSec: flatSec + climbSec,
      minElevation: Number.isFinite(minEle) ? minEle : Number.NaN,
      maxElevation: Number.isFinite(maxEle) ? maxEle : Number.NaN,
      avgElevation: eleWeight > 0 ? eleSum / eleWeight : Number.NaN,
      ascentM: ascent,
      descentM: descent,
      belowThresholdM: below,
      unknownM: unknown,
    },
    roadNames: [...nameLength.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([name]) => name),
  };
}

function findEdge(g: RoadGraph, from: number, to: number): number {
  for (let i = g.adjStart[from]; i < g.adjStart[from + 1]; i += 1) {
    const e = g.adjEdges[i];
    if (g.edgeTo[e] === to) return e;
  }
  return -1;
}
