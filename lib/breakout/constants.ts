import type { Difficulty, ItemGroup, ItemKind, Settings } from "./types";

/**
 * SPIN RALLY のバランス定数。仕様書 docs/breakout-spec.md と対応させること。
 *
 * 設計の要：技は「方向を入れるか入れないか」で2系統に分かれる。
 *
 *   方向なし（ショットのみ）＝ スマッシュ。速度 × POWER_MUL だけの、純粋に強い一撃
 *   方向あり             ＝ 効果が付くかわりに速くならない。向き θ で連続的に変わる
 *       速度倍率 = SKILL_SPEED_BASE + SKILL_SPEED_SWING * sinθ （上 1.25 / 横 1.05 / 下 0.85）
 *       貫通     = max(0, sinθ)   （真上で最大＝ドリル）
 *       スピン   = cosθ × 左右の符号（真横で最大＝カーブ）
 *       ロブ     = sinθ ≦ −SKILL_POLE（真下＝ボレー）
 *
 * 「速さを取るか、効果を取るか」がこの分岐そのものになっている。
 */

export const W = 480;
export const H = 720;

/** 1人・協力モードのプレイ領域 */
export const PLAY_TOP = 46;
export const PLAY_BOTTOM = 706;

export const PADDLE_W = 88;
export const PADDLE_H = 14;
export const PADDLE_W_WIDE = 120;
export const PADDLE_W_NARROW = 60;
export const PADDLE_SPEED = 420;
/** アイスパドル時の加速度（滑る＝止まりにくい） */
export const PADDLE_ICE_ACCEL = 900;
export const SOLO_PADDLE_Y = 660;

export const BALL_R = 6;
export const BALL_START_SPEED = 300;
/**
 * 対戦の初速は 1人モードより速くする。
 * パドル速度 420px/s に対して球が遅いと、追いかけるだけで全部拾えてしまい、
 * カーブもボレーも「読まれてから間に合う」ものになって意味を失う。
 */
export const BALL_VERSUS_START = 380;
export const BALL_MIN_SPEED = 200;
export const BALL_VERSUS_MIN = 300;
export const BALL_MAX_SPEED = 700;
/** 1人モードの通常上限（対戦は BALL_MAX_SPEED まで出る） */
export const BALL_SOLO_MAX = 560;

export const BLOCK_W = 44;
export const BLOCK_H = 24;
export const BLOCK_COLS = 10;
export const BLOCK_LEFT = 20;
export const BLOCK_TOP = 96;
export const BLOCK_ROWS = 8;

/** スマッシュ（方向なし＋ショット）の速度倍率 */
export const POWER_MUL = 1.55;

/** 方向つきの技：速度倍率 = SKILL_SPEED_BASE + SKILL_SPEED_SWING * sinθ */
export const SKILL_SPEED_BASE = 1.18;
export const SKILL_SPEED_SWING = 0.2;
/**
 * ボレーだけは θ の式から外して明示的に落とす。
 * 式に任せると「遅くならないロブ」になってしまい、浮いた球という性格が消える。
 */
export const LOB_SPEED_MUL = 0.8;
/** |sinθ| がこれ以上ならドリル／ボレーとして扱う（それ以外はカーブ） */
export const SKILL_POLE = 0.85;

/** ドリル（上＋ショット）：ブロックを跳ね返らずに突き抜けるフレーム数 */
export const DRILL_FRAMES = 14;
export const DRILL_FRAMES_HEAVY = 30;

/**
 * ボレー（ロブ）。
 *
 * 重力が強いとすぐ落ちてきて使い道が無くなる。
 * 中央で受けた球（上向き 255px/s）が届く高さは v²/2g なので、
 * 620 では 52px＝ブロック2行にも足りなかった。ブロック帯を越える射程が要る。
 */
export const LOB_TIME = 2.6;
export const LOB_TIME_LONG = 3.2;
export const LOB_GRAVITY = 70;

/** カーブ */
export const SPIN_ACCEL = 185;
export const SPIN_DECAY = 1.2;
export const POWERSPIN_MUL = 1.4;

/** 技ゲージ */
export const GAUGE_MAX = 100;
export const GAUGE_BOOST_MAX = 150;
export const GAUGE_REGEN = 22;
/** 方向つきの技の消費 = GAUGE_COST_BASE + GAUGE_COST_SWING * |sinθ| */
export const GAUGE_COST_BASE = 28;
export const GAUGE_COST_SWING = 8;
/** スマッシュ（方向なし）は一番高い */
export const GAUGE_COST_POWER = 40;
export const GAUGE_COST_FAIL = 12;
/** レーザーは自動で撃つ（ショットは技に使うため、入力を奪わない） */
export const LASER_INTERVAL = 0.4;

/** 技の判定：先行入力の受付フレーム数 */
export const PRE_INPUT_FRAMES = 12;
export const STUN_TIME = 0.35;

export interface DifficultySpec {
  label: string;
  /** ジャストミートの判定窓（フレーム）。null なら溜め方式（必ず成立・失敗なし） */
  window: number | null;
  ballSpeedMul: number;
}

export const DIFFICULTY: Record<Difficulty, DifficultySpec> = {
  easy: { label: "やさしい", window: null, ballSpeedMul: 0.9 },
  normal: { label: "ふつう", window: 5, ballSpeedMul: 1 },
  hard: { label: "むずかしい", window: 4, ballSpeedMul: 1.08 },
  expert: { label: "エキスパート", window: 3, ballSpeedMul: 1.16 },
};

/** 対戦モードのフィールド */
export const V_DEAD_TOP = 40;
export const V_ZONE_TOP = { top: 56, bottom: 216 };
export const V_BAND = { top: 300, bottom: 420, rows: 5 };
export const V_ZONE_BOTTOM = { top: 504, bottom: 664 };
export const V_DEAD_BOTTOM = 680;
export const V_POINTS_TO_WIN = 5;
export const V_ROUND_TIME = 90;
export const V_OVERDRIVE_AT = 20;
export const V_OVERDRIVE_SPEED = 1.15;
export const V_SERVE_DELAY = 1.2;

export const LIVES = 3;
/** 協力モードの連携チェイン倍率 */
export const CHAIN_MULS = [1, 1.2, 1.5, 2, 2.5, 3];

/** アイテム */
export const ITEM_DROP_RATE = 0.12;
export const ITEM_DROP_RATE_TOUGH = 0.25;
export const ITEM_FALL_SPEED = 120;
export const ITEM_MAX_ACTIVE = 3;
export const ITEM_DEFAULT_TIME = 16;

export interface ItemSpec {
  label: string;
  group: ItemGroup;
  /** 効果時間（秒）。0 は即時 or 回数制 */
  time: number;
  /** 対戦モード専用か */
  versusOnly?: boolean;
  /** 1人・協力モード専用か */
  soloOnly?: boolean;
  icon: string;
  color: string;
}

export const ITEMS: Record<ItemKind, ItemSpec> = {
  // A群：強化
  wide: { label: "ワイド", group: "buff", time: 16, icon: "W", color: "#5ad2ff" },
  magnet: { label: "マグネット", group: "buff", time: 0, icon: "M", color: "#5ad2ff" },
  multi: { label: "マルチボール", group: "buff", time: 0, icon: "3", color: "#5ad2ff" },
  laser: { label: "レーザー", group: "buff", time: 12, icon: "L", color: "#5ad2ff" },
  powerspin: { label: "パワースピン", group: "buff", time: 20, icon: "S", color: "#7affc4" },
  heavysmash: { label: "ヘビースマッシュ", group: "buff", time: 20, icon: "H", color: "#7affc4" },
  longlob: { label: "ロングロブ", group: "buff", time: 20, icon: "V", color: "#7affc4" },
  gaugeboost: { label: "ゲージブースト", group: "buff", time: 24, icon: "G", color: "#ffe86b" },
  refill: { label: "リフィル", group: "buff", time: 0, icon: "+", color: "#ffe86b" },
  slow: { label: "スロー", group: "buff", time: 12, soloOnly: true, icon: "▼", color: "#5ad2ff" },
  floor: { label: "フロアシールド", group: "buff", time: 0, icon: "=", color: "#7affc4" },
  oneup: { label: "1UP", group: "buff", time: 0, icon: "♥", color: "#ff7ab8" },
  // B群：妨害（対戦のみ）
  shrink: { label: "シュリンク", group: "hinder", time: 12, versusOnly: true, icon: "N", color: "#ff9b4a" },
  jam: { label: "ジャム", group: "hinder", time: 6, versusOnly: true, icon: "J", color: "#ff9b4a" },
  reverse: { label: "リバース", group: "hinder", time: 5, versusOnly: true, icon: "R", color: "#ff9b4a" },
  blind: { label: "ブラインド", group: "hinder", time: 5, versusOnly: true, icon: "B", color: "#ff9b4a" },
  ice: { label: "アイスパドル", group: "hinder", time: 8, versusOnly: true, icon: "I", color: "#ff9b4a" },
  wall: { label: "ウォール", group: "hinder", time: 8, versusOnly: true, icon: "#", color: "#ff9b4a" },
  // C群：盤面・スコア
  bomb: { label: "ボム", group: "field", time: 0, soloOnly: true, icon: "*", color: "#ffb057" },
  drill: { label: "ドリル", group: "field", time: 0, icon: "D", color: "#ffb057" },
  score2: { label: "スコア倍率", group: "field", time: 12, soloOnly: true, icon: "×", color: "#ffb057" },
  chainkeep: { label: "チェインキープ", group: "field", time: 0, soloOnly: true, icon: "C", color: "#ffb057" },
  shuffle: { label: "シャッフル", group: "field", time: 0, versusOnly: true, icon: "~", color: "#ffb057" },
  // D群：トラップ
  narrow: { label: "ナロー", group: "trap", time: 10, icon: "n", color: "#ff5470" },
  accel: { label: "アクセル", group: "trap", time: 10, icon: "!", color: "#ff5470" },
  gaugedown: { label: "ゲージダウン", group: "trap", time: 0, icon: "-", color: "#ff5470" },
};

/** 抽選テーブルの比率（仕様書 §5.1） */
export const GROUP_WEIGHT: Record<ItemGroup, number> = {
  buff: 55,
  hinder: 15,
  field: 15,
  trap: 15,
};

export const DEFAULT_SETTINGS: Settings = {
  difficulty: "normal",
  bgm: 0.5,
  sfx: 0.7,
  scanline: true,
};

export const clamp = (v: number, min: number, max: number) => (v < min ? min : v > max ? max : v);
