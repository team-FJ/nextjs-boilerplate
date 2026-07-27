/** 対戦モードの型定義 */

export type PlayerId = 1 | 2;

/** 1 = 下側プレイヤー（上に撃つ）/ -1 = 上側プレイヤー（下に撃つ） */
export type FireDir = -1 | 1;

export type VersusWeapon = "single" | "spread" | "laser" | "homing";

export type VersusItemKind =
  | "power"
  | "rapid"
  | "spread"
  | "laser"
  | "homing"
  | "shield"
  | "heal"
  | "speed"
  | "energy"
  | "bomb"
  | "slow";

export type BandEnemyId = "drifter" | "twin" | "sniper" | "armored" | "bomber";

export type CpuLevel = "rookie" | "normal" | "veteran" | "ace";

export type VersusMode = "cpu" | "local";

export type VersusPhase =
  | "menu"
  | "countdown"
  | "fighting"
  | "roundEnd"
  | "matchEnd"
  | "paused";

export interface FighterInput {
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
  fire: boolean;
  special: boolean;
}

export const EMPTY_INPUT: FighterInput = {
  left: false,
  right: false,
  up: false,
  down: false,
  fire: false,
  special: false,
};

export interface Fighter {
  id: PlayerId;
  name: string;
  color: string;
  accent: string;
  /** 自陣の上端・下端 */
  zoneTop: number;
  zoneBottom: number;
  dir: FireDir;
  x: number;
  y: number;
  w: number;
  h: number;
  hp: number;
  maxHp: number;
  shield: number;
  maxShield: number;
  /** 射撃エネルギー。連射を抑えるための資源 */
  energy: number;
  maxEnergy: number;
  regen: number;
  power: number;
  weapon: VersusWeapon;
  /** 特殊武装の残り時間（0 で single に戻る） */
  weaponTimer: number;
  rapidTimer: number;
  slowTimer: number;
  speedLevel: number;
  bombs: number;
  fireCooldown: number;
  invincible: number;
  hitFlash: number;
  wins: number;
  /** ラウンド内の統計 */
  shots: number;
  hits: number;
  kills: number;
  pickups: number;
  alive: boolean;
}

export interface VersusBullet {
  /** クライアント側の補間で同じ弾を追跡するための ID */
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  w: number;
  h: number;
  dmg: number;
  /** 0 = 中立ゾーンの敵が撃った弾 */
  owner: PlayerId | 0;
  kind: VersusWeapon | "enemy" | "bomb";
  pierce: number;
  homing: number;
  life: number;
  color: string;
  hitIds?: Set<number>;
}

export interface BandEnemy {
  id: number;
  type: BandEnemyId;
  x: number;
  y: number;
  vx: number;
  /** 上下揺れの基準となる y 座標 */
  baseY: number;
  w: number;
  h: number;
  hp: number;
  maxHp: number;
  t: number;
  fireCooldown: number;
  hitFlash: number;
  /** 最後にダメージを与えたプレイヤー（アイテムの流れる先） */
  lastHitBy: PlayerId | null;
}

export interface VersusItem {
  id: number;
  kind: VersusItemKind;
  /** このアイテムを取得できるプレイヤー */
  owner: PlayerId;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
}

export interface VersusParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
  kind: "spark" | "ring" | "text";
  text?: string;
}

export interface FighterHud {
  id: PlayerId;
  name: string;
  color: string;
  hp: number;
  maxHp: number;
  shield: number;
  energy: number;
  maxEnergy: number;
  power: number;
  weapon: VersusWeapon;
  weaponTimer: number;
  rapid: boolean;
  slowed: boolean;
  speedLevel: number;
  bombs: number;
  wins: number;
  kills: number;
  pickups: number;
}

export interface VersusHudSnapshot {
  phase: VersusPhase;
  round: number;
  roundsToWin: number;
  timeLeft: number;
  countdown: number;
  fighters: [FighterHud, FighterHud];
  enemiesInBand: number;
  overdrive: boolean;
  fps: number;
  lastRoundWinner: PlayerId | 0 | null;
  matchWinner: PlayerId | 0 | null;
  banner: string | null;
}

export interface VersusConfig {
  mode: VersusMode;
  cpuLevel: CpuLevel;
  roundsToWin: number;
  /** 中立ゾーンの敵の湧きやすさ */
  enemyDensity: "low" | "normal" | "high";
}
