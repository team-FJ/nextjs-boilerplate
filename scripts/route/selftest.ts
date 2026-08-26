/**
 * ルート探索のオフライン自己テスト。
 *
 * Overpass も国土地理院も外部サービスなので、CI から叩くわけにはいかない。
 * そこで「合成した街」と「合成した標高タイル」を流し込み、
 * 標高の制約が本当に効いているかをここで確かめる。
 *
 *   npm run route-selftest
 */

import { DEFAULT_COST, findPath, type CostOptions } from "../../lib/route/astar";
import {
  DemSampler,
  decodeDemTile,
  TILE_SIZE,
  type DemSource,
  type TileLoader,
} from "../../lib/route/dem";
import {
  boundsOf,
  haversine,
  tileXToLon,
  tileYToLat,
  type BBox,
  type LatLng,
} from "../../lib/route/geo";
import { buildGraph } from "../../lib/route/graph";
import type { OsmWay } from "../../lib/route/overpass";
import { PROFILES } from "../../lib/route/profiles";
import { searchRoute } from "../../lib/route/search";

let failures = 0;
let checks = 0;

function check(label: string, ok: boolean, detail = "") {
  checks += 1;
  if (!ok) failures += 1;
  const mark = ok ? "  ok" : "FAIL";
  console.log(`${mark}  ${label}${detail ? `  — ${detail}` : ""}`);
}

function near(a: number, b: number, tol: number): boolean {
  return Math.abs(a - b) <= tol;
}

// ---------------------------------------------------------------- 合成の地形
//
// 東西に伸びる街。中央付近の南側だけが低地（標高 2m）になっていて、
// 北へ迂回すれば標高 25m の高台を通れる、という地形にする。

const LAT0 = 35.0;
const LON0 = 139.0;
const ROWS = 21; // 南北 21 本（約 100m 間隔で 2km）
const COLS = 21;
const STEP_LAT = 0.0009; // 約 100m
const STEP_LON = 0.0011; // 約 100m（緯度 35 度）

const LOW_LON_MIN = LON0 + STEP_LON * 8;
const LOW_LON_MAX = LON0 + STEP_LON * 12;
const LOW_LAT_MAX = LAT0 + STEP_LAT * 8;

function terrain(lat: number, lon: number): number {
  const inLowBand =
    lon > LOW_LON_MIN && lon < LOW_LON_MAX && lat < LOW_LAT_MAX;
  return inLowBand ? 2 : 25;
}

/** 標高タイルの PNG 相当（RGBA バイト列）を地形関数から作る。 */
function synthTileLoader(zoom: number): TileLoader {
  return async (url: string) => {
    const m = url.match(/\/(\d+)\/(\d+)\/(\d+)\.png$/);
    if (!m) return null;
    const [z, tx, ty] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (z !== zoom) return null;
    const rgba = new Uint8ClampedArray(TILE_SIZE * TILE_SIZE * 4);
    for (let iy = 0; iy < TILE_SIZE; iy += 1) {
      const lat = tileYToLat(ty + (iy + 0.5) / TILE_SIZE, z);
      for (let ix = 0; ix < TILE_SIZE; ix += 1) {
        const lon = tileXToLon(tx + (ix + 0.5) / TILE_SIZE, z);
        const h = terrain(lat, lon);
        const v = Math.round(h * 100); // 0.01m 単位
        const p = (iy * TILE_SIZE + ix) * 4;
        rgba[p] = (v >> 16) & 0xff;
        rgba[p + 1] = (v >> 8) & 0xff;
        rgba[p + 2] = v & 0xff;
        rgba[p + 3] = 255;
      }
    }
    return decodeDemTile(rgba);
  };
}

const SYNTH_SOURCE: DemSource = {
  id: "synth",
  label: "合成標高",
  zoom: 14,
  url: (z, x, y) => `synth://${z}/${x}/${y}.png`,
};

/** 碁盤の目の街を OSM の way として組み立てる。 */
function synthCity(extraWays: OsmWay[] = []): OsmWay[] {
  const ways: OsmWay[] = [...extraWays];
  let id = 1000;
  for (let r = 0; r < ROWS; r += 1) {
    const geometry = Array.from({ length: COLS }, (_, c) => ({
      lat: LAT0 + r * STEP_LAT,
      lon: LON0 + c * STEP_LON,
    }));
    ways.push({ id: id++, tags: { highway: "residential" }, geometry });
  }
  for (let c = 0; c < COLS; c += 1) {
    const geometry = Array.from({ length: ROWS }, (_, r) => ({
      lat: LAT0 + r * STEP_LAT,
      lon: LON0 + c * STEP_LON,
    }));
    ways.push({ id: id++, tags: { highway: "residential" }, geometry });
  }
  return ways;
}

/** bbox の外へ出た区間を落とし、範囲内の連続部分だけを way として返す。 */
function clipWays(ways: OsmWay[], b: BBox): OsmWay[] {
  const inside = (p: { lat: number; lon: number }) =>
    p.lat >= b.south && p.lat <= b.north && p.lon >= b.west && p.lon <= b.east;
  const out: OsmWay[] = [];
  for (const way of ways) {
    let run: { lat: number; lon: number }[] = [];
    const flush = () => {
      if (run.length >= 2) out.push({ ...way, id: way.id * 100 + out.length, geometry: run });
      run = [];
    };
    for (const p of way.geometry) {
      if (inside(p)) run.push(p);
      else flush();
    }
    flush();
  }
  return out;
}

const START: LatLng = { lat: LAT0, lon: LON0 };
const GOAL: LatLng = { lat: LAT0, lon: LON0 + STEP_LON * (COLS - 1) };

async function main() {
  console.log("== 標高タイルのエンコード／デコード ==");
  {
    const rgba = new Uint8ClampedArray([
      0, 0, 0, 255, // 0.00m
      0, 3, 232, 255, // 1000 * 0.01 = 10.00m
      255, 255, 255, 255, // 0xFFFFFF → (x - 2^24) * 0.01 = -0.01m
      128, 0, 0, 255, // 無効値
    ]);
    const t = decodeDemTile(rgba);
    check("0m", near(t[0], 0, 1e-6), `${t[0]}`);
    check("10m", near(t[1], 10, 1e-6), `${t[1]}`);
    check("負の標高", near(t[2], -0.01, 1e-6), `${t[2]}`);
    check("無効値は NaN", Number.isNaN(t[3]));
  }

  console.log("\n== 標高サンプラ ==");
  const bbox: BBox = boundsOf([START, GOAL], 500);
  const dem = new DemSampler([SYNTH_SOURCE], synthTileLoader(14));
  await dem.prepare(bbox);
  {
    const high = dem.sample(LAT0, LON0);
    const low = dem.sample(LAT0, (LOW_LON_MIN + LOW_LON_MAX) / 2);
    check("高台の標高を復元できる", near(high, 25, 0.2), `${high.toFixed(2)}m`);
    check("低地の標高を復元できる", near(low, 2, 0.2), `${low.toFixed(2)}m`);
  }

  console.log("\n== グラフ構築 ==");
  const ways = synthCity();
  const { graph } = buildGraph(ways, PROFILES.foot, dem);
  {
    check(
      "交差点が共有される",
      graph.nodeCount === ROWS * COLS,
      `${graph.nodeCount} 節点（期待 ${ROWS * COLS}）`,
    );
    check("双方向の辺が張られる", graph.edgeCount === 2 * 2 * ROWS * (COLS - 1));
  }

  console.log("\n== 一方通行（車） ==");
  {
    const oneway: OsmWay[] = [
      {
        id: 1,
        tags: { highway: "residential", oneway: "yes" },
        geometry: [
          { lat: LAT0, lon: LON0 },
          { lat: LAT0, lon: LON0 + STEP_LON },
        ],
      },
    ];
    const car = buildGraph(oneway, PROFILES.car, null);
    const foot = buildGraph(oneway, PROFILES.foot, null);
    check("車は一方通行を守る", car.graph.edgeCount === 1);
    check("徒歩は一方通行を無視する", foot.graph.edgeCount === 2);
  }

  console.log("\n== 通行不可の道 ==");
  {
    const tunnel: OsmWay[] = [
      {
        id: 2,
        tags: { highway: "residential", tunnel: "yes" },
        geometry: [
          { lat: LAT0, lon: LON0 },
          { lat: LAT0, lon: LON0 + STEP_LON },
        ],
      },
    ];
    const { graph: g } = buildGraph(tunnel, PROFILES.foot, null);
    const opts: CostOptions = {
      ...DEFAULT_COST,
      minElevation: -1000,
      allowUnknownElevation: true,
      avoidUnderground: true,
    };
    check("トンネルは経路に採用されない", findPath(g, 0, 1, opts).path === null);
    check(
      "許可すれば通れる",
      findPath(g, 0, 1, { ...opts, avoidUnderground: false }).path !== null,
    );
    const motorway = buildGraph(
      [{ id: 3, tags: { highway: "motorway" }, geometry: tunnel[0].geometry }],
      PROFILES.foot,
      null,
    );
    check("徒歩で高速道路は使わない", motorway.graph.edgeCount === 0);
  }

  console.log("\n== 低地を避けるルート選定 ==");
  const common = {
    start: START,
    goal: GOAL,
    profileId: "foot" as const,
    // Overpass と同じく、範囲の外へはみ出したぶんは返さない。
    loadRoads: async (b: BBox) => clipWays(synthCity(), b),
    loadTile: synthTileLoader(14),
  };

  const plain = await searchRoute({
    ...common,
    cost: { ...DEFAULT_COST, minElevation: -1000, highGroundBias: 0, climbPenaltyPerM: 0 },
  });
  const strict = await searchRoute({
    ...common,
    cost: { ...DEFAULT_COST, minElevation: 10, safetyMargin: 5, highGroundBias: 1.5 },
  });

  {
    const p = plain.safe;
    const s = strict.safe;
    check("制約なしでルートが出る", !!p);
    check("制約ありでもルートが出る", !!s);
    if (p && s) {
      check(
        "制約なしのルートは低地を通ってしまう",
        p.stats.minElevation < 10,
        `最低 ${p.stats.minElevation.toFixed(1)}m`,
      );
      check(
        "制約ありのルートは指定標高を割らない",
        s.stats.minElevation >= 10,
        `最低 ${s.stats.minElevation.toFixed(1)}m`,
      );
      check(
        "指定標高未満の走行距離が 0",
        s.stats.belowThresholdM === 0,
        `${s.stats.belowThresholdM.toFixed(0)}m`,
      );
      check(
        "低地を避けたぶん遠回りになる",
        s.stats.distanceM > p.stats.distanceM,
        `${Math.round(p.stats.distanceM)}m → ${Math.round(s.stats.distanceM)}m`,
      );
      check(
        "始点と終点は指定どおり",
        haversine(s.points[0], START) < 60 &&
          haversine(s.points[s.points.length - 1], GOAL) < 60,
      );
      check(
        "比較用の最短ルートも一緒に返る",
        !!strict.shortest && strict.shortest.stats.minElevation < 10,
      );
    }
  }

  console.log("\n== 到達できないときの代替地点 ==");
  {
    // 街全体を 25m にしても、40m 以上という条件では通れる道が 1 本も無い。
    const impossible = await searchRoute({
      ...common,
      cost: { ...DEFAULT_COST, minElevation: 40 },
    });
    check("条件が厳しすぎればルートは出ない", impossible.safe === null);
    check("理由が警告として出る", impossible.warnings.length > 0, impossible.warnings[0] ?? "");
  }
  {
    // 出発地だけを低地に置くと、条件を満たす最寄りの道まで下がって案内する。
    const fromLow = await searchRoute({
      ...common,
      start: { lat: LAT0, lon: (LOW_LON_MIN + LOW_LON_MAX) / 2 },
      cost: { ...DEFAULT_COST, minElevation: 10 },
    });
    check("低地の出発地は条件を満たす道へ寄せられる", fromLow.startSnap.relaxed);
    check("寄せた地点の標高は条件を満たす", fromLow.startSnap.elevation >= 10);
    check("そこからのルートは出る", !!fromLow.safe);
  }

  console.log("\n== 高台優先の強さ ==");
  {
    // 中央の低地（2m）でも「4m 以上」なら通れないが、
    // しきい値を 0m にすると通れる。bias を上げれば避けるようになる。
    const throughLow = await searchRoute({
      ...common,
      cost: { ...DEFAULT_COST, minElevation: 0, safetyMargin: 0, highGroundBias: 0, climbPenaltyPerM: 0 },
    });
    const avoidLow = await searchRoute({
      ...common,
      cost: { ...DEFAULT_COST, minElevation: 0, safetyMargin: 10, highGroundBias: 8, climbPenaltyPerM: 0 },
    });
    const a = throughLow.safe?.stats.minElevation ?? Number.NaN;
    const b = avoidLow.safe?.stats.minElevation ?? Number.NaN;
    check("bias 0 では最短優先で低地を通る", a < 10, `最低 ${a.toFixed(1)}m`);
    check("bias を上げると低地を避ける", b > a, `最低 ${a.toFixed(1)}m → ${b.toFixed(1)}m`);
  }

  console.log(
    `\n${failures === 0 ? "すべて通過" : `${failures} 件が失敗`}（${checks} 項目）`,
  );
  if (failures > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
