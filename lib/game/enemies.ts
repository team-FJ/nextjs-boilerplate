import type { BossId, EnemyTypeId } from "./types";

export interface EnemyDef {
  id: EnemyTypeId;
  name: string;
  hp: number;
  score: number;
  w: number;
  h: number;
  color: string;
  accent: string;
  /** 射撃間隔の基準（秒）。0 なら撃たない */
  fireInterval: number;
  /** 編隊を離れて突撃する頻度（0 = しない） */
  diveRate: number;
  shot: "single" | "double" | "aimed" | "bomb" | "spray" | "laser" | "none";
  /** 撃破時に分裂する（splitter） */
  splits?: EnemyTypeId;
  /** 周囲の敵を回復する（healer） */
  heals?: boolean;
  /** 体当たり特化 */
  suicide?: boolean;
  sprite: string[];
}

// ドット絵： X = メインカラー / O = アクセント / # = 影 / . = 透明
const SPR_SCOUT = [
  "XXXXXXXX",
  "XXXXXXXX",
  ".XOOOOX.",
  ".XXXXXX.",
  "..XXXX..",
  "..XXXX..",
  "...XX...",
  "...XX...",
];

const SPR_GLIDER = [
  "XX.......XX",
  ".XXX...XXX.",
  "..XXXXXXX..",
  ".XXXOOOXXX.",
  "XXXXOOOXXXX",
  ".XXXXXXXXX.",
  "...XXXXX...",
  "....XXX....",
];

const SPR_HULK = [
  "..XXXXXXXX..",
  ".XXXXXXXXXX.",
  "XXXXXXXXXXXX",
  "XX########XX",
  "XXOOOOOOOOXX",
  "XXXXXXXXXXXX",
  ".XXXXXXXXXX.",
  "..XXXXXXXX..",
];

const SPR_GUNNER = [
  "...XXXXX...",
  "..XXXXXXX..",
  ".XXXOOOXXX.",
  "XXXXXXXXXXX",
  "XXXXXXXXXXX",
  "XX#XXXXX#XX",
  "XO.......OX",
  "XO.......OX",
];

const SPR_BOMBER = [
  ".XXXXXXXXXX.",
  "XXXXXXXXXXXX",
  "XXXXOOOOXXXX",
  "XXXXXXXXXXXX",
  "X##XXXXXX##X",
  ".XXXXXXXXXX.",
  "..XX....XX..",
  "...OO..OO...",
];

const SPR_ELITE = [
  ".....XX.....",
  "....XXXX....",
  "...XXXXXX...",
  "..XXXOOXXX..",
  ".XXXXOOXXXX.",
  "XXXXXXXXXXXX",
  ".XXXXXXXXXX.",
  "..XX.XX.XX..",
  "...X.XX.X...",
  ".....XX.....",
];

const SPR_TANK = [
  ".XXXXXXXXXX.",
  "XXXXXXXXXXXX",
  "XX########XX",
  "XXOOOOOOOOXX",
  "XX########XX",
  "XXXXXXXXXXXX",
  "XXXXXXXXXXXX",
  ".XX#XXXX#XX.",
  "..XXXXXXXX..",
];

const SPR_GHOST = [
  "..XXXXXX..",
  ".X......X.",
  "X..XXXX..X",
  "X.XOOOOX.X",
  "X.XOOOOX.X",
  "X..XXXX..X",
  ".X......X.",
  "..XXXXXX..",
];

const SPR_KAMIKAZE = [
  "..X....X..",
  "..XX..XX..",
  "..XXXXXX..",
  "..XXOOXX..",
  "...XXXX...",
  "...XXXX...",
  "....XX....",
  "....XX....",
];

const SPR_SPLITTER = [
  ".XXX..XXX.",
  "XXXX..XXXX",
  "XXXXOOXXXX",
  "XXXXOOXXXX",
  "XXXXOOXXXX",
  "XXXXOOXXXX",
  "XXXX..XXXX",
  ".XXX..XXX.",
];

const SPR_HEALER = [
  "...XXXX...",
  "...XOOX...",
  "XXXXOOXXXX",
  "XOOOOOOOOX",
  "XOOOOOOOOX",
  "XXXXOOXXXX",
  "...XOOX...",
  "...XXXX...",
];

const SPR_TURRET = [
  "....XX....",
  "...XXXX...",
  "..XXOOXX..",
  ".XXXOOXXX.",
  "XXXXXXXXXX",
  "X##XXXX##X",
  "XXXXXXXXXX",
  "XX.XXXX.XX",
];

const SPR_MINE = [
  "...XX...",
  "X..XX..X",
  ".XXXXXX.",
  "XXXOOXXX",
  "XXXOOXXX",
  ".XXXXXX.",
  "X..XX..X",
  "...XX...",
];

export const ENEMY_DEFS: Record<EnemyTypeId, EnemyDef> = {
  scout: {
    id: "scout",
    name: "スカウト",
    hp: 1,
    score: 30,
    w: 24,
    h: 24,
    color: "#7de2ff",
    accent: "#1b3a4d",
    fireInterval: 3.6,
    diveRate: 0,
    shot: "single",
    sprite: SPR_SCOUT,
  },
  glider: {
    id: "glider",
    name: "グライダー",
    hp: 2,
    score: 50,
    w: 30,
    h: 22,
    color: "#8dff9b",
    accent: "#1d4a24",
    fireInterval: 3.2,
    diveRate: 0,
    shot: "single",
    sprite: SPR_GLIDER,
  },
  hulk: {
    id: "hulk",
    name: "ハルク",
    hp: 3,
    score: 80,
    w: 32,
    h: 22,
    color: "#ffb45c",
    accent: "#4a2a0d",
    fireInterval: 2.8,
    diveRate: 0.05,
    shot: "double",
    sprite: SPR_HULK,
  },
  gunner: {
    id: "gunner",
    name: "ガンナー",
    hp: 3,
    score: 120,
    w: 30,
    h: 22,
    color: "#ff7a8a",
    accent: "#4d1520",
    fireInterval: 2.0,
    diveRate: 0.05,
    shot: "aimed",
    sprite: SPR_GUNNER,
  },
  bomber: {
    id: "bomber",
    name: "ボマー",
    hp: 5,
    score: 180,
    w: 34,
    h: 24,
    color: "#c58dff",
    accent: "#33174d",
    fireInterval: 3.0,
    diveRate: 0.1,
    shot: "bomb",
    sprite: SPR_BOMBER,
  },
  elite: {
    id: "elite",
    name: "エリート",
    hp: 6,
    score: 260,
    w: 32,
    h: 28,
    color: "#ffd93d",
    accent: "#4d3c00",
    fireInterval: 2.2,
    diveRate: 0.25,
    shot: "spray",
    sprite: SPR_ELITE,
  },
  tank: {
    id: "tank",
    name: "タンク",
    hp: 14,
    score: 400,
    w: 40,
    h: 30,
    color: "#9aa7bd",
    accent: "#2a3140",
    fireInterval: 2.6,
    diveRate: 0,
    shot: "double",
    sprite: SPR_TANK,
  },
  ghost: {
    id: "ghost",
    name: "ゴースト",
    hp: 4,
    score: 220,
    w: 28,
    h: 24,
    color: "#b9c0d8",
    accent: "#3a4056",
    fireInterval: 2.6,
    diveRate: 0.2,
    shot: "single",
    sprite: SPR_GHOST,
  },
  kamikaze: {
    id: "kamikaze",
    name: "カミカゼ",
    hp: 2,
    score: 150,
    w: 26,
    h: 26,
    color: "#ff6b3d",
    accent: "#4d1a08",
    fireInterval: 0,
    diveRate: 0.9,
    shot: "none",
    suicide: true,
    sprite: SPR_KAMIKAZE,
  },
  splitter: {
    id: "splitter",
    name: "スプリッタ",
    hp: 5,
    score: 200,
    w: 30,
    h: 24,
    color: "#5ce8b0",
    accent: "#0f4536",
    fireInterval: 3.0,
    diveRate: 0.08,
    shot: "single",
    splits: "scout",
    sprite: SPR_SPLITTER,
  },
  healer: {
    id: "healer",
    name: "ヒーラー",
    hp: 8,
    score: 300,
    w: 28,
    h: 24,
    color: "#ffe86b",
    accent: "#4d4400",
    fireInterval: 0,
    diveRate: 0,
    shot: "none",
    heals: true,
    sprite: SPR_HEALER,
  },
  turret: {
    id: "turret",
    name: "タレット",
    hp: 10,
    score: 280,
    w: 30,
    h: 26,
    color: "#ff9d5c",
    accent: "#4a2408",
    fireInterval: 1.6,
    diveRate: 0,
    shot: "laser",
    sprite: SPR_TURRET,
  },
  mine: {
    id: "mine",
    name: "マイン",
    hp: 3,
    score: 90,
    w: 24,
    h: 24,
    color: "#ff5d8f",
    accent: "#4d0f26",
    fireInterval: 0,
    diveRate: 0,
    shot: "none",
    suicide: true,
    sprite: SPR_MINE,
  },
};

export const PLAYER_SPRITE = [
  ".....X.....",
  ".....X.....",
  "....XOX....",
  "....XOX....",
  "..XXXOXXX..",
  ".XXXXOXXXX.",
  "XXXXXXXXXXX",
  "X#XXXXXXX#X",
  "X#X.....X#X",
  "..O.....O..",
];

export interface BossDef {
  id: BossId;
  name: string;
  hp: number;
  score: number;
  w: number;
  h: number;
  color: string;
  accent: string;
  phases: number;
  /** 各フェーズで使用する攻撃パターン */
  patterns: BossAttack[][];
  parts: { name: string; ox: number; oy: number; r: number; hp: number }[];
  shape: "carrier" | "hydra" | "sentinel" | "devourer" | "twin" | "overmind";
}

export type BossAttack =
  | "fan"
  | "aimedBurst"
  | "spiral"
  | "wall"
  | "laserSweep"
  | "ring"
  | "minions"
  | "homingOrbs"
  | "cross"
  | "rain";

export const BOSS_DEFS: Record<BossId, BossDef> = {
  carrier: {
    id: "carrier",
    name: "母艦 ヴァンガード",
    hp: 260,
    score: 5000,
    w: 170,
    h: 84,
    color: "#8fa6c4",
    accent: "#ff7a3c",
    phases: 2,
    patterns: [
      ["fan", "aimedBurst", "minions"],
      ["wall", "fan", "aimedBurst", "minions"],
    ],
    parts: [
      { name: "左砲", ox: -62, oy: 10, r: 18, hp: 60 },
      { name: "右砲", ox: 62, oy: 10, r: 18, hp: 60 },
    ],
    shape: "carrier",
  },
  hydra: {
    id: "hydra",
    name: "多頭艦 ヒュドラ",
    hp: 420,
    score: 9000,
    w: 180,
    h: 100,
    color: "#8dff9b",
    accent: "#ffd93d",
    phases: 3,
    patterns: [
      ["ring", "aimedBurst"],
      ["spiral", "minions", "fan"],
      ["spiral", "wall", "homingOrbs"],
    ],
    parts: [
      { name: "第一頭", ox: -60, oy: -6, r: 20, hp: 90 },
      { name: "第二頭", ox: 0, oy: -18, r: 22, hp: 110 },
      { name: "第三頭", ox: 60, oy: -6, r: 20, hp: 90 },
    ],
    shape: "hydra",
  },
  sentinel: {
    id: "sentinel",
    name: "監視者 センチネル",
    hp: 560,
    score: 12000,
    w: 150,
    h: 150,
    color: "#6fe8ff",
    accent: "#ff5d8f",
    phases: 3,
    patterns: [
      ["laserSweep", "ring"],
      ["cross", "laserSweep", "homingOrbs"],
      ["spiral", "cross", "rain"],
    ],
    parts: [
      { name: "上部コア", ox: 0, oy: -46, r: 22, hp: 120 },
      { name: "下部コア", ox: 0, oy: 46, r: 22, hp: 120 },
    ],
    shape: "sentinel",
  },
  devourer: {
    id: "devourer",
    name: "捕食者 デヴァウラー",
    hp: 760,
    score: 16000,
    w: 200,
    h: 120,
    color: "#c58dff",
    accent: "#8dff5a",
    phases: 3,
    patterns: [
      ["wall", "minions", "fan"],
      ["rain", "homingOrbs", "spiral"],
      ["spiral", "ring", "wall", "laserSweep"],
    ],
    parts: [
      { name: "顎", ox: 0, oy: 34, r: 26, hp: 150 },
      { name: "左翼", ox: -76, oy: -8, r: 20, hp: 110 },
      { name: "右翼", ox: 76, oy: -8, r: 20, hp: 110 },
    ],
    shape: "devourer",
  },
  twinFang: {
    id: "twinFang",
    name: "双牙 ツインファング",
    hp: 900,
    score: 20000,
    w: 210,
    h: 110,
    color: "#ff9d5c",
    accent: "#6fe8ff",
    phases: 4,
    patterns: [
      ["aimedBurst", "cross"],
      ["laserSweep", "minions"],
      ["spiral", "rain", "homingOrbs"],
      ["spiral", "wall", "ring", "laserSweep"],
    ],
    parts: [
      { name: "左牙", ox: -84, oy: 0, r: 24, hp: 170 },
      { name: "右牙", ox: 84, oy: 0, r: 24, hp: 170 },
    ],
    shape: "twin",
  },
  overmind: {
    id: "overmind",
    name: "超越体 オーバーマインド",
    hp: 1500,
    score: 50000,
    w: 230,
    h: 170,
    color: "#ff5d8f",
    accent: "#ffd93d",
    phases: 5,
    patterns: [
      ["ring", "aimedBurst"],
      ["spiral", "minions"],
      ["laserSweep", "cross", "wall"],
      ["rain", "homingOrbs", "spiral"],
      ["spiral", "ring", "cross", "wall", "rain"],
    ],
    parts: [
      { name: "第一衛星", ox: -80, oy: -40, r: 20, hp: 180 },
      { name: "第二衛星", ox: 80, oy: -40, r: 20, hp: 180 },
      { name: "第三衛星", ox: -80, oy: 46, r: 20, hp: 180 },
      { name: "第四衛星", ox: 80, oy: 46, r: 20, hp: 180 },
    ],
    shape: "overmind",
  },
};
