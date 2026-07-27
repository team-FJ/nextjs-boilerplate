import type { BandEnemyId, VersusItemKind } from "./types";

export interface BandEnemyDef {
  id: BandEnemyId;
  name: string;
  hp: number;
  w: number;
  h: number;
  /** 横断速度 */
  speed: number;
  color: string;
  accent: string;
  /** 射撃間隔（秒）。0 なら撃たない */
  fireInterval: number;
  /** both = 上下同時 / nearest = 近い方へ / none */
  attack: "none" | "both" | "nearest" | "bombBoth";
  /** 上下に揺れる振幅 */
  wave: number;
  /** 撃破時のアイテム抽選で使う重み付け（レアが出やすいほど大きい） */
  rareBias: number;
  /** 確定でこのアイテムを落とす場合 */
  fixedDrop?: VersusItemKind;
  sprite: string[];
}

const SPR_DRIFTER = [
  "..XXXX..",
  ".XXXXXX.",
  "XXOXXOXX",
  "XXXXXXXX",
  "XXXXXXXX",
  "XXOXXOXX",
  ".XXXXXX.",
  "..XXXX..",
];

const SPR_TWIN = [
  "...OO...",
  "..XXXX..",
  ".XXXXXX.",
  "XX.XX.XX",
  "XX.XX.XX",
  ".XXXXXX.",
  "..XXXX..",
  "...OO...",
];

const SPR_SNIPER = [
  "....X....",
  "...XXX...",
  "..XXOXX..",
  ".XXXXXXX.",
  "XXXXXXXXX",
  ".XXXXXXX.",
  "..XX.XX..",
  ".X.....X.",
];

const SPR_ARMORED = [
  "XX......XX",
  "XXXXXXXXXX",
  "XXOXXXXOXX",
  "XXXXXXXXXX",
  "XXXXXXXXXX",
  "XXOXXXXOXX",
  "XXXXXXXXXX",
  "XX......XX",
];

const SPR_BOMBER = [
  "..OOOO..",
  ".XXXXXX.",
  "XXXXXXXX",
  "XX#XX#XX",
  "XXXXXXXX",
  ".XXXXXX.",
  "..X..X..",
  ".O....O.",
];

export const BAND_ENEMIES: Record<BandEnemyId, BandEnemyDef> = {
  drifter: {
    id: "drifter",
    name: "ドリフター",
    hp: 2,
    w: 26,
    h: 26,
    speed: 96,
    color: "#7de2ff",
    accent: "#1b3a4d",
    fireInterval: 0,
    attack: "none",
    wave: 14,
    rareBias: 0,
    sprite: SPR_DRIFTER,
  },
  twin: {
    id: "twin",
    name: "ツインキャノン",
    hp: 3,
    w: 26,
    h: 26,
    speed: 74,
    color: "#8dff9b",
    accent: "#1d4a24",
    fireInterval: 2.1,
    attack: "both",
    wave: 8,
    rareBias: 0.2,
    sprite: SPR_TWIN,
  },
  sniper: {
    id: "sniper",
    name: "スナイパー",
    hp: 3,
    w: 28,
    h: 24,
    speed: 62,
    color: "#ffd93d",
    accent: "#4d3c00",
    fireInterval: 2.6,
    attack: "nearest",
    wave: 4,
    rareBias: 0.35,
    sprite: SPR_SNIPER,
  },
  armored: {
    id: "armored",
    name: "アーマード",
    hp: 9,
    w: 34,
    h: 26,
    speed: 42,
    color: "#9aa7bd",
    accent: "#2a3140",
    fireInterval: 3.4,
    attack: "both",
    wave: 0,
    rareBias: 1,
    sprite: SPR_ARMORED,
  },
  bomber: {
    id: "bomber",
    name: "ボマー",
    hp: 4,
    w: 28,
    h: 26,
    speed: 58,
    color: "#c58dff",
    accent: "#33174d",
    fireInterval: 2.8,
    attack: "bombBoth",
    wave: 18,
    rareBias: 0.5,
    sprite: SPR_BOMBER,
  },
};

/** 出現テーブル：経過時間に応じて手強い機体が混ざる */
export function pickEnemyType(elapsed: number, rnd: () => number): BandEnemyId {
  const table: [BandEnemyId, number][] = [
    ["drifter", 34],
    ["twin", 22 + elapsed * 0.2],
    ["sniper", 14 + elapsed * 0.25],
    ["bomber", elapsed > 15 ? 12 + elapsed * 0.15 : 0],
    ["armored", elapsed > 25 ? 8 + elapsed * 0.12 : 0],
  ];
  const total = table.reduce((s, [, w]) => s + w, 0);
  let roll = rnd() * total;
  for (const [id, w] of table) {
    roll -= w;
    if (roll <= 0) return id;
  }
  return "drifter";
}

export const VERSUS_FIGHTER_SPRITE = [
  ".....X.....",
  ".....X.....",
  "....XOX....",
  "...XXOXX...",
  "..XXXOXXX..",
  ".XXXXXXXXX.",
  "XXXX###XXXX",
  "X#X.....X#X",
  "..O.....O..",
];
