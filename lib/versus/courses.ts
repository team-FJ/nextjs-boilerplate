import { V_H, V_W } from "./constants";
import type { CourseId, CourseZones, VersusCourse, WallDef } from "./types";

/**
 * 対戦コース。
 *
 * 上下の余白を除いた 628px を「自陣・中立ゾーン・自陣」で分け合う。
 * 陣地の高さ（zoneH）だけ決めれば中立ゾーンの高さは自動で決まるので、
 * 合計がずれて陣地が消える、という壊れ方をしない。
 *
 * 壁は上半分だけ書く。フィールドは 180 度回して対称なので（P2 の画面は
 * それを利用して「自分が下」に見せている）、下半分は自動で作る。
 * 手で両方書くと必ず非対称なコースが混ざるため、書けないようにしてある。
 *
 * 壁は弾だけを止める。中立ゾーンの敵は壁をすり抜ける（経路探索を持ち込むと
 * サーバーとクライアントで挙動を合わせるのが一気に難しくなるため）。
 */

/** 上下の余白 */
export const FIELD_MARGIN = 46;
/** 陣地＋中立ゾーン＋陣地 に使える高さ */
export const FIELD_H = V_H - FIELD_MARGIN * 2;

export const MIN_ZONE_H = 130;
export const MAX_ZONE_H = 280;

/** 中央（180度回転の中心） */
const CX = V_W / 2;
const CY = V_H / 2;

/** 壁1枚を書くための短縮。x,y は中心座標 */
const wall = (x: number, y: number, w: number, h: number, hp = 12): WallDef => ({ x, y, w, h, hp });

const COURSE_LIST: VersusCourse[] = [
  {
    id: "standard",
    name: "スタンダード",
    desc: "基本の広さ。まずはここから",
    zoneH: 222,
    enemyRate: 1,
    halfWalls: [],
  },
  {
    id: "close",
    name: "クローズ",
    desc: "中立ゾーンが狭い。距離が近く展開が速い",
    zoneH: 264,
    enemyRate: 0.8,
    halfWalls: [],
  },
  {
    id: "long",
    name: "ロングレンジ",
    desc: "中立ゾーンが広い。敵の取り合いが主戦場",
    zoneH: 180,
    enemyRate: 1.25,
    halfWalls: [],
  },
  {
    id: "duel",
    name: "デュエル",
    desc: "中立ゾーンがほぼ無い。純粋な撃ち合い",
    zoneH: 280,
    enemyRate: 0.5,
    halfWalls: [],
  },
  {
    id: "swarm",
    name: "スウォーム",
    desc: "陣地が狭く敵が多い。避ける場所が少ない",
    zoneH: 140,
    enemyRate: 1.7,
    halfWalls: [],
  },
  {
    id: "barricade",
    name: "バリケード",
    desc: "中央に遮蔽。真正面からの撃ち合いが通らない",
    zoneH: 222,
    enemyRate: 1,
    halfWalls: [wall(CX - 96, 318, 92, 18), wall(CX + 96, 318, 92, 18)],
  },
  {
    id: "gate",
    name: "ゲート",
    desc: "中央の隙間しか弾が通らない。狙う場所が決まる",
    zoneH: 210,
    enemyRate: 1.1,
    halfWalls: [wall(72, 330, 144, 20, 16), wall(V_W - 72, 330, 144, 20, 16)],
  },
  {
    id: "pillars",
    name: "ピラー",
    desc: "細い柱が4本。角度を変えれば通る",
    zoneH: 222,
    enemyRate: 1,
    halfWalls: [wall(84, 320, 20, 76), wall(V_W - 84, 320, 20, 76)],
  },
  {
    id: "shelter",
    name: "シェルター",
    desc: "自陣の前に遮蔽。守りに入れるが敵も取りにくい",
    zoneH: 200,
    enemyRate: 1.15,
    halfWalls: [wall(CX, 268, 150, 18, 14)],
  },
  {
    id: "crossfire",
    name: "クロスファイア",
    desc: "ずらして置かれた壁。斜めの撃ち合いになる",
    zoneH: 205,
    enemyRate: 1.05,
    halfWalls: [wall(110, 300, 110, 16), wall(V_W - 110, 348, 110, 16)],
  },
  {
    id: "fortress",
    name: "フォートレス",
    desc: "分厚く硬い壁。壊すには手数がいる",
    zoneH: 216,
    enemyRate: 0.95,
    halfWalls: [wall(CX - 110, 322, 96, 34, 34), wall(CX + 110, 322, 96, 34, 34)],
  },
  {
    id: "glass",
    name: "グラスハウス",
    desc: "脆い壁がたくさん。撃つそばから崩れていく",
    zoneH: 200,
    enemyRate: 1.1,
    halfWalls: [
      wall(60, 300, 40, 16, 3),
      wall(140, 322, 40, 16, 3),
      wall(220, 300, 40, 16, 3),
      wall(300, 322, 40, 16, 3),
      wall(380, 300, 40, 16, 3),
      wall(440, 322, 40, 16, 3),
    ],
  },
  {
    id: "labyrinth",
    name: "ラビリンス",
    desc: "広い中立ゾーンに障害物。抜け道を探す",
    zoneH: 168,
    enemyRate: 1.3,
    halfWalls: [
      wall(70, 286, 76, 16),
      wall(230, 316, 76, 16),
      wall(390, 286, 76, 16),
      wall(150, 348, 16, 60),
      wall(330, 348, 16, 60),
    ],
  },
];

export const COURSES: Record<CourseId, VersusCourse> = Object.fromEntries(
  COURSE_LIST.map((c) => [c.id, c]),
) as Record<CourseId, VersusCourse>;

export const COURSE_IDS: CourseId[] = COURSE_LIST.map((c) => c.id);

export const DEFAULT_COURSE: CourseId = "standard";

export function getCourse(id: CourseId | undefined): VersusCourse {
  return COURSES[id ?? DEFAULT_COURSE] ?? COURSES[DEFAULT_COURSE];
}

/** コースから陣地・中立ゾーンの座標を出す */
export function zonesFor(course: VersusCourse): CourseZones {
  const zoneH = Math.max(MIN_ZONE_H, Math.min(MAX_ZONE_H, course.zoneH));
  const bandH = FIELD_H - zoneH * 2;
  const topBottom = FIELD_MARGIN + zoneH;
  return {
    top: { top: FIELD_MARGIN, bottom: topBottom },
    band: { top: topBottom, bottom: topBottom + bandH },
    bottom: { top: topBottom + bandH, bottom: FIELD_MARGIN + FIELD_H },
  };
}

/**
 * 壁の全枚数を出す。上半分の定義を 180 度回して下半分を作る。
 * ちょうど中心にある壁は回しても同じ場所なので複製しない。
 */
export function wallsFor(course: VersusCourse): WallDef[] {
  const out: WallDef[] = [];
  for (const w of course.halfWalls) {
    out.push(w);
    const mx = V_W - w.x;
    const my = V_H - w.y;
    if (Math.abs(mx - w.x) < 0.5 && Math.abs(my - w.y) < 0.5) continue;
    out.push({ ...w, x: mx, y: my });
  }
  return out;
}

/** 中心からの距離で使う（テスト用に公開） */
export const FIELD_CENTER = { x: CX, y: CY };
