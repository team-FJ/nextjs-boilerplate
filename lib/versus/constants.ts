import type { CpuLevel, VersusItemKind, VersusWeapon } from "./types";

/**
 * 対戦モードのバランス定数。
 *
 * 設計方針：撃ち合いが弾幕にならないように「射撃エネルギー」で連射を縛る。
 * クールダウンだけなら押しっぱなしで撃ち続けられてしまうため、
 * 1発ごとにエネルギーを消費し、回復速度が実質的な連射上限になる。
 *   単発コスト 20 / 回復 24 per sec → 継続射撃は毎秒 1.2 発
 *   クールダウン 0.34s → 溜めた分で瞬間的に 3 連射まで可能
 * 強化しても上限が伸びすぎないよう、RAPID は倍率式かつ重ねがけ不可。
 */

export const V_W = 480;
export const V_H = 720;

/** 上側プレイヤーの陣地 */
export const TOP_ZONE = { top: 46, bottom: 268 };
/** 敵が横切る中立ゾーン */
export const BAND = { top: 268, bottom: 452 };
/** 下側プレイヤーの陣地 */
export const BOTTOM_ZONE = { top: 452, bottom: 674 };

export const FIGHTER_W = 28;
export const FIGHTER_H = 24;
/** 被弾判定は見た目より小さく取る */
export const FIGHTER_HIT_W = 16;
export const FIGHTER_HIT_H = 14;

export const MAX_HP = 10;
export const MAX_SHIELD = 2;
export const MAX_POWER = 4;
export const MAX_SPEED_LEVEL = 3;
export const MAX_BOMBS = 2;
export const BASE_SPEED = 188;
export const SPEED_STEP = 26;

export const BASE_ENERGY = 100;
export const ENERGY_CAP = 150;
export const BASE_REGEN = 24;

export const ROUND_TIME = 75;
/** 残りこの秒数を切ると「オーバードライブ」：互いの与ダメージが増えて決着が付きやすくなる */
export const OVERDRIVE_AT = 20;
export const OVERDRIVE_DMG = 1.6;
export const COUNTDOWN_TIME = 3.2;
export const ROUND_END_TIME = 2.6;

export interface VersusWeaponSpec {
  label: string;
  /** 発射間隔（秒） */
  interval: number;
  /** 1発あたりのエネルギー消費 */
  cost: number;
  dmg: number;
  speed: number;
  w: number;
  h: number;
  pierce: number;
  homing: number;
  color: string;
  /** パワーレベルごとの弾の並び（オフセットと角度） */
  pattern: (power: number) => { ox: number; angle: number }[];
}

export const VERSUS_WEAPONS: Record<VersusWeapon, VersusWeaponSpec> = {
  single: {
    label: "SINGLE",
    interval: 0.34,
    cost: 20,
    dmg: 1,
    speed: 460,
    w: 5,
    h: 13,
    pierce: 0,
    homing: 0,
    color: "#ffe86b",
    pattern: (power) =>
      [[{ ox: 0, angle: 0 }],
       [{ ox: -7, angle: 0 }, { ox: 7, angle: 0 }],
       [{ ox: -9, angle: 0 }, { ox: 0, angle: 0 }, { ox: 9, angle: 0 }],
       [{ ox: -13, angle: 0 }, { ox: -4, angle: 0 }, { ox: 4, angle: 0 }, { ox: 13, angle: 0 }]][power - 1],
  },
  spread: {
    label: "SPREAD",
    interval: 0.44,
    cost: 26,
    dmg: 0.8,
    speed: 390,
    w: 5,
    h: 10,
    pierce: 0,
    homing: 0,
    color: "#7dff9b",
    pattern: (power) => {
      const ways = 2 + power;
      const spread = 0.5;
      return Array.from({ length: ways }, (_, i) => ({
        ox: 0,
        angle: -spread / 2 + (spread / (ways - 1)) * i,
      }));
    },
  },
  laser: {
    label: "LASER",
    interval: 0.5,
    cost: 34,
    dmg: 1.2,
    speed: 780,
    w: 4,
    h: 26,
    pierce: 2,
    homing: 0,
    color: "#6fe8ff",
    pattern: (power) =>
      power >= 3
        ? [{ ox: -8, angle: 0 }, { ox: 8, angle: 0 }]
        : [{ ox: 0, angle: 0 }],
  },
  homing: {
    label: "HOMING",
    interval: 0.56,
    cost: 30,
    dmg: 1,
    speed: 260,
    w: 7,
    h: 12,
    pierce: 0,
    homing: 2.2,
    color: "#ff9d5c",
    pattern: (power) =>
      Array.from({ length: Math.min(3, 1 + Math.floor(power / 2)) }, (_, i) => ({
        ox: (i - Math.min(3, 1 + Math.floor(power / 2)) / 2 + 0.5) * 14,
        angle: 0,
      })),
  },
};

/** ボム：1発だけ撃てる大弾。相手の弾を消しながら進む */
export const BOMB_SPEC = {
  dmg: 3,
  speed: 300,
  w: 22,
  h: 22,
  color: "#ff8ad6",
};

export const RAPID_MULTIPLIER = 0.78;
export const RAPID_REGEN_BONUS = 8;
export const RAPID_DURATION = 12;
export const WEAPON_DURATION = 16;
export const SLOW_DURATION = 3;
export const SLOW_FACTOR = 0.55;

export const VERSUS_ITEMS: Record<
  VersusItemKind,
  { short: string; name: string; desc: string; color: string; weight: number; rare?: boolean }
> = {
  power: { short: "P", name: "パワー", desc: "弾数 +1（最大4）", color: "#ffcf3d", weight: 20 },
  rapid: { short: "R", name: "ラピッド", desc: "12秒 連射間隔 -22% / エネルギー回復up", color: "#ffe86b", weight: 10 },
  spread: { short: "W", name: "スプレッド", desc: "16秒 拡散弾", color: "#7dff9b", weight: 10 },
  laser: { short: "L", name: "レーザー", desc: "16秒 貫通レーザー", color: "#6fe8ff", weight: 9 },
  homing: { short: "H", name: "ホーミング", desc: "16秒 追尾弾", color: "#ff9d5c", weight: 8 },
  shield: { short: "B", name: "バリア", desc: "被弾を1回無効（最大2）", color: "#7ec8ff", weight: 12 },
  heal: { short: "+", name: "リペア", desc: "耐久 +2", color: "#8dff5a", weight: 9 },
  speed: { short: "▲", name: "スピード", desc: "移動速度 +1（最大3）", color: "#9dffe0", weight: 9 },
  energy: { short: "E", name: "エネルギー", desc: "最大エネルギー +10 して全回復", color: "#c58dff", weight: 9 },
  bomb: { short: "★", name: "ボム", desc: "大弾を1発ストック（最大2）", color: "#ff8ad6", weight: 7, rare: true },
  slow: { short: "T", name: "スロー", desc: "相手を3秒だけ鈍足にする", color: "#a0c4ff", weight: 6, rare: true },
};

export interface CpuProfile {
  label: string;
  description: string;
  /** 判断を更新する間隔（秒）。大きいほど鈍い */
  reaction: number;
  /** 狙いのブレ（px） */
  aimError: number;
  /** 回避を始める距離 */
  dodgeRange: number;
  /** 射撃をためらう確率 */
  hesitation: number;
  /** アイテムを取りに行く積極性 */
  greed: number;
  /** エネルギーをどこまで使い切るか */
  energyFloor: number;
}

export const CPU_PROFILES: Record<CpuLevel, CpuProfile> = {
  rookie: {
    label: "ルーキー",
    description: "動きが鈍く、狙いも甘い",
    reaction: 0.34,
    aimError: 46,
    dodgeRange: 90,
    hesitation: 0.45,
    greed: 0.4,
    energyFloor: 45,
  },
  normal: {
    label: "ノーマル",
    description: "そこそこ避けて、そこそこ当ててくる",
    reaction: 0.2,
    aimError: 26,
    dodgeRange: 104,
    hesitation: 0.22,
    greed: 0.7,
    energyFloor: 30,
  },
  veteran: {
    label: "ベテラン",
    description: "回避が速く、アイテムも譲らない",
    reaction: 0.12,
    aimError: 14,
    dodgeRange: 138,
    hesitation: 0.1,
    greed: 0.9,
    energyFloor: 22,
  },
  ace: {
    label: "エース",
    description: "ほぼ隙なし。中立ゾーンも支配してくる",
    reaction: 0.07,
    aimError: 7,
    dodgeRange: 168,
    hesitation: 0.03,
    greed: 1,
    energyFloor: 20,
  },
};

export const ENEMY_DENSITY: Record<"low" | "normal" | "high", { min: number; max: number; ramp: number }> = {
  low: { min: 2.6, max: 4.4, ramp: 0.012 },
  normal: { min: 1.7, max: 3.1, ramp: 0.016 },
  high: { min: 1.1, max: 2.1, ramp: 0.02 },
};

export const PLAYER_COLORS = {
  p1: { color: "#5aa9ff", accent: "#e8f1ff" },
  p2: { color: "#ff6fa5", accent: "#ffe8f1" },
};
