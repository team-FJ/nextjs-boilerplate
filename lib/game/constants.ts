import type { CarryPolicy, Difficulty, Settings, ThemeName } from "./types";

/** 論理解像度（縦画面）。実画面へは CSS でスケールする */
export const VIEW_W = 480;
export const VIEW_H = 720;

/** プレイフィールドの上下マージン */
export const FIELD_TOP = 56;
export const FIELD_BOTTOM = VIEW_H - 24;

export const FIXED_DT = 1 / 60;
export const MAX_FRAME_SKIP = 5;

export const MAX_POWER = 5;
export const MAX_OPTIONS = 4;
export const MAX_SPEED_LEVEL = 5;
export const PLAYER_BASE_SPEED = 210;
export const PLAYER_SPEED_STEP = 34;
export const PLAYER_MAX_HP = 3;
export const PLAYER_MAX_SHIELD = 3;
export const START_LIVES = 3;
export const START_BOMBS = 2;
export const MAX_BOMBS = 5;
export const RESPAWN_INVINCIBLE = 2.2;
export const TRAIL_LENGTH = 90;

export const COMBO_TIMEOUT = 2.4;

export interface DifficultyProfile {
  label: string;
  enemyHp: number;
  enemySpeed: number;
  enemyFire: number;
  bulletSpeed: number;
  itemChance: number;
  scoreMul: number;
  startLives: number;
  description: string;
}

/**
 * ステージ間で強化をどれだけ持ち越すか。
 *
 * 全部持ち越すと、9面あたりで強さが頭打ちになり中盤が消化試合になる
 * （通しで計測したところ、9〜13面が7〜32秒・被弾0で終わっていた）。
 * 難易度が上のものほど持ち越しを絞って、終盤まで手応えが残るようにする。
 */
export const CARRY_POLICY: Record<Difficulty, CarryPolicy> = {
  easy: {
    weapon: true,
    powerDecay: 0,
    optionDecay: 0,
    keepSpeed: true,
    keepShield: true,
    bombs: "keep",
    healOnStage: true,
  },
  normal: {
    weapon: true,
    powerDecay: 0,
    optionDecay: 0,
    keepSpeed: true,
    keepShield: true,
    bombs: "keep",
    healOnStage: true,
  },
  hard: {
    // 武装とパワーは残し、オプションポッドを1基だけ返す。
    // 計測すると、火力の伸びを止めているのは主にポッドの数だった。
    // パワーまで削ると手数が足りず、進めなくなって難易度調整にならない。
    // シールドとボムも持ち越さないので、毎ステージ拾い直す動機が生まれる。
    weapon: true,
    powerDecay: 0,
    optionDecay: 1,
    keepSpeed: true,
    keepShield: false,
    bombs: "one",
    healOnStage: true,
  },
  insane: {
    // 武装は初期化。パワーとポッドも大きく返し、毎ステージ組み直す前提にする。
    weapon: false,
    powerDecay: 1,
    optionDecay: 2,
    keepSpeed: true,
    keepShield: false,
    bombs: "one",
    healOnStage: true,
  },
};

export const DIFFICULTY: Record<Difficulty, DifficultyProfile> = {
  easy: {
    label: "簡単",
    enemyHp: 0.75,
    enemySpeed: 0.8,
    enemyFire: 0.6,
    bulletSpeed: 0.82,
    itemChance: 1.5,
    scoreMul: 0.8,
    startLives: 5,
    description: "ゆっくり・弾少なめ。強化はすべて次の面へ引き継ぐ",
  },
  normal: {
    label: "普通",
    enemyHp: 1,
    enemySpeed: 1,
    enemyFire: 1,
    bulletSpeed: 1,
    itemChance: 1,
    scoreMul: 1,
    startLives: 3,
    description: "標準バランス。強化はすべて次の面へ引き継ぐ",
  },
  hard: {
    label: "難しい",
    enemyHp: 1.35,
    enemySpeed: 1.18,
    enemyFire: 1.45,
    bulletSpeed: 1.15,
    itemChance: 0.8,
    scoreMul: 1.4,
    startLives: 3,
    description: "弾幕が厚い。次の面へ移るとポッド1基・シールド・ボムを失う",
  },
  insane: {
    label: "極限",
    enemyHp: 1.8,
    enemySpeed: 1.35,
    enemyFire: 2,
    bulletSpeed: 1.3,
    itemChance: 0.6,
    scoreMul: 2,
    startLives: 2,
    description: "情け無用。武装も初期化され、毎面ゼロから組み直す",
  },
};

export const DEFAULT_SETTINGS: Settings = {
  difficulty: "normal",
  autoFire: true,
  screenShake: true,
  particles: "normal",
  crt: true,
  starfield: true,
  sfxVolume: 0.6,
  bgmVolume: 0.35,
  showFps: false,
  control: "keyboard",
  colorBlind: false,
  optionFormation: "trail",
};

export interface Theme {
  name: ThemeName;
  label: string;
  bgTop: string;
  bgBottom: string;
  star: string;
  nebula: string;
  grid: string;
  accent: string;
}

export const THEMES: Record<ThemeName, Theme> = {
  space: {
    name: "space",
    label: "深宇宙",
    bgTop: "#05060f",
    bgBottom: "#0b1026",
    star: "#cfe3ff",
    nebula: "rgba(70,110,220,0.16)",
    grid: "rgba(90,140,255,0.08)",
    accent: "#5aa9ff",
  },
  nebula: {
    name: "nebula",
    label: "星雲域",
    bgTop: "#170a24",
    bgBottom: "#2a0f3f",
    star: "#ffd9f6",
    nebula: "rgba(200,80,220,0.18)",
    grid: "rgba(220,120,255,0.08)",
    accent: "#d879ff",
  },
  ice: {
    name: "ice",
    label: "氷晶帯",
    bgTop: "#04141c",
    bgBottom: "#0b2f3d",
    star: "#dffaff",
    nebula: "rgba(90,220,255,0.14)",
    grid: "rgba(120,240,255,0.09)",
    accent: "#5ce8ff",
  },
  magma: {
    name: "magma",
    label: "溶融惑星",
    bgTop: "#1d0603",
    bgBottom: "#3d1206",
    star: "#ffd7b0",
    nebula: "rgba(255,110,40,0.16)",
    grid: "rgba(255,140,60,0.08)",
    accent: "#ff7a3c",
  },
  toxic: {
    name: "toxic",
    label: "汚染宙域",
    bgTop: "#08160a",
    bgBottom: "#123016",
    star: "#d9ffcf",
    nebula: "rgba(120,255,90,0.14)",
    grid: "rgba(150,255,110,0.08)",
    accent: "#8dff5a",
  },
  void: {
    name: "void",
    label: "虚無回廊",
    bgTop: "#000000",
    bgBottom: "#0a0a12",
    star: "#9aa0b5",
    nebula: "rgba(120,120,160,0.10)",
    grid: "rgba(160,160,200,0.06)",
    accent: "#b9c0d8",
  },
  sunrise: {
    name: "sunrise",
    label: "恒星圏",
    bgTop: "#2a1030",
    bgBottom: "#5b2440",
    star: "#ffe9c9",
    nebula: "rgba(255,170,90,0.16)",
    grid: "rgba(255,190,120,0.08)",
    accent: "#ffb45c",
  },
  cyber: {
    name: "cyber",
    label: "電脳網",
    bgTop: "#04101a",
    bgBottom: "#062033",
    star: "#b8ffff",
    nebula: "rgba(0,220,255,0.12)",
    grid: "rgba(0,255,220,0.10)",
    accent: "#22ffd0",
  },
};

export const WEAPON_LABEL: Record<string, string> = {
  vulcan: "VULCAN",
  spread: "SPREAD",
  laser: "LASER",
  missile: "MISSILE",
  wave: "WAVE",
  rail: "RAIL",
};

export const ITEM_LABEL: Record<string, { short: string; name: string; desc: string; color: string }> = {
  power: { short: "P", name: "パワーアップ", desc: "武装レベル +1（最大5）", color: "#ffcf3d" },
  spread: { short: "S", name: "スプレッド", desc: "拡散ショットに換装", color: "#7dff9b" },
  laser: { short: "L", name: "レーザー", desc: "貫通レーザーに換装", color: "#6fe8ff" },
  missile: { short: "M", name: "ミサイル", desc: "追尾ミサイルに換装", color: "#ff9d5c" },
  wave: { short: "W", name: "ウェーブ", desc: "広範囲波動砲に換装", color: "#c58dff" },
  rail: { short: "R", name: "レールガン", desc: "高威力貫通弾に換装", color: "#ff6fa5" },
  option: { short: "O", name: "オプション", desc: "随伴ポッド +1（最大4）", color: "#ffe86b" },
  shield: { short: "B", name: "バリア", desc: "シールドを全回復", color: "#7ec8ff" },
  speed: { short: "▲", name: "スピード", desc: "移動速度 +1（最大5）", color: "#9dffe0" },
  rapid: { short: "R+", name: "ラピッド", desc: "12秒間 連射速度2倍", color: "#ffe86b" },
  bomb: { short: "★", name: "ボム", desc: "全画面ボム +1", color: "#ff8ad6" },
  life: { short: "1UP", name: "残機", desc: "残機 +1", color: "#8dff5a" },
  score2x: { short: "×2", name: "スコア2倍", desc: "15秒間 得点2倍", color: "#ffd166" },
  slow: { short: "T", name: "スロー", desc: "8秒間 敵と弾が減速", color: "#a0c4ff" },
  magnet: { short: "U", name: "マグネット", desc: "12秒間 アイテム自動回収", color: "#ffb3c1" },
  freeze: { short: "❄", name: "フリーズ", desc: "5秒間 敵の行動停止", color: "#b8f2ff" },
  pierce: { short: "≫", name: "ピアース", desc: "10秒間 全弾が貫通", color: "#ff9ff3" },
  heal: { short: "+", name: "リペア", desc: "耐久を1回復", color: "#7bed9f" },
};

export const POWERUP_DURATION: Record<string, number> = {
  rapid: 12,
  score2x: 15,
  slow: 8,
  magnet: 12,
  freeze: 5,
  pierce: 10,
  invincible: RESPAWN_INVINCIBLE,
};
