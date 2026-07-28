/**
 * 通信対戦のプロトコル定義。
 *
 * 方針：サーバーが唯一の正解（authoritative）を持ち、クライアントは入力しか送らない。
 * 決定論的ロックステップにしないのは、Math.sin などの三角関数が実装依存で
 * iOS(JavaScriptCore) と Android(V8) の間でごく僅かにズレ得るため。4,500 フレームも
 * 回すと「片方の画面だけ弾が当たる」破綻に育つ。
 */

import type { VersusEngine } from "../engine";
import type { FighterInput, PlayerId, VersusConfig, VersusPhase, VersusWeapon } from "../types";

export const PROTOCOL_VERSION = 1;

/** サーバーのシミュレーション周波数 */
export const TICK_HZ = 60;
/** スナップショットの配信頻度。補間前提なのでティックより粗くてよい */
export const SNAPSHOT_HZ = 20;
/**
 * 入力はフレームごとに1つ送り、サーバーは1ティックにつき1つだけ消費する。
 * 「最新の入力で上書き」方式にすると、クライアントの予測とサーバーの適用列が
 * 食い違って巻き戻しが増えるため、キュー方式にしている。
 */
export const INPUT_HZ = 60;
/** 到着ゆらぎを吸収するためにサーバーが溜めておく入力の数 */
export const INPUT_BUFFER = 3;
/** 1パケットに載せる過去の入力の数（パケットロスの穴埋め用） */
export const INPUT_REDUNDANCY = 3;
/** 補間バッファ。この分だけ過去を描画して、到着ゆらぎを吸収する */
export const INTERP_DELAY_MS = 100;

// ---------------------------------------------------------------- 入力

const BIT = { left: 1, right: 2, up: 4, down: 8, fire: 16, special: 32 } as const;

export function encodeInput(input: FighterInput): number {
  let mask = 0;
  if (input.left) mask |= BIT.left;
  if (input.right) mask |= BIT.right;
  if (input.up) mask |= BIT.up;
  if (input.down) mask |= BIT.down;
  if (input.fire) mask |= BIT.fire;
  if (input.special) mask |= BIT.special;
  return mask;
}

export function decodeInput(mask: number): FighterInput {
  return {
    left: (mask & BIT.left) !== 0,
    right: (mask & BIT.right) !== 0,
    up: (mask & BIT.up) !== 0,
    down: (mask & BIT.down) !== 0,
    fire: (mask & BIT.fire) !== 0,
    special: (mask & BIT.special) !== 0,
  };
}

// ---------------------------------------------------------------- スナップショット

export interface SnapFighter {
  x: number;
  y: number;
  hp: number;
  sh: number;
  en: number;
  men: number;
  pw: number;
  /** 移動速度レベル。自機予測をサーバーと一致させるために必要 */
  sp: number;
  wp: VersusWeapon;
  wt: number;
  rp: 0 | 1;
  sl: 0 | 1;
  bm: number;
  wn: number;
  iv: 0 | 1;
  al: 0 | 1;
  kl: number;
  pk: number;
}

export interface SnapBullet {
  i: number;
  x: number;
  y: number;
  /** 0=通常 1=拡散 2=レーザー 3=追尾 4=敵弾 5=ボム */
  k: number;
  o: PlayerId | 0;
}

export interface SnapEnemy {
  i: number;
  x: number;
  y: number;
  t: string;
  hp: number;
  mh: number;
}

export interface SnapItem {
  i: number;
  x: number;
  y: number;
  k: string;
  o: PlayerId;
}

export interface Snapshot {
  tk: number;
  ph: VersusPhase;
  rd: number;
  tl: number;
  cd: number;
  od: 0 | 1;
  bn: string | null;
  lw: PlayerId | 0 | null;
  mw: PlayerId | 0 | null;
  f: [SnapFighter, SnapFighter];
  b: SnapBullet[];
  e: SnapEnemy[];
  it: SnapItem[];
  /** 各プレイヤーの「ここまで処理した入力シーケンス」。予測の巻き戻しに使う */
  ack: [number, number];
}

const BULLET_KIND: Record<string, number> = {
  single: 0,
  spread: 1,
  laser: 2,
  homing: 3,
  enemy: 4,
  bomb: 5,
};
const BULLET_KIND_NAMES = ["single", "spread", "laser", "homing", "enemy", "bomb"];

export const bulletKindName = (k: number): string => BULLET_KIND_NAMES[k] ?? "single";

/** 座標は 1px 単位に丸める。補間して描くので見た目には出ない */
const q = (v: number) => Math.round(v);
const q1 = (v: number) => Math.round(v * 10) / 10;

export function captureSnapshot(engine: VersusEngine, tick: number, ack: [number, number]): Snapshot {
  const fighter = (i: 0 | 1): SnapFighter => {
    const f = engine.fighters[i];
    return {
      x: q1(f.x),
      y: q1(f.y),
      hp: q1(f.hp),
      sh: f.shield,
      en: q(f.energy),
      men: f.maxEnergy,
      pw: f.power,
      sp: f.speedLevel,
      wp: f.weapon,
      wt: q1(f.weaponTimer),
      rp: f.rapidTimer > 0 ? 1 : 0,
      sl: f.slowTimer > 0 ? 1 : 0,
      bm: f.bombs,
      wn: f.wins,
      iv: f.invincible > 0 ? 1 : 0,
      al: f.alive ? 1 : 0,
      kl: f.kills,
      pk: f.pickups,
    };
  };

  return {
    tk: tick,
    ph: engine.phase,
    rd: engine.round,
    tl: q1(Math.max(0, engine.roundTime)),
    cd: q1(engine.countdown),
    od: engine.overdrive ? 1 : 0,
    bn: engine.banner,
    lw: engine.lastRoundWinner,
    mw: engine.matchWinner,
    f: [fighter(0), fighter(1)],
    b: engine.bullets.map((b) => ({
      i: b.id,
      x: q(b.x),
      y: q(b.y),
      k: BULLET_KIND[b.kind] ?? 0,
      o: b.owner,
    })),
    e: engine.enemies.map((e) => ({
      i: e.id,
      x: q(e.x),
      y: q(e.y),
      t: e.type,
      hp: q1(e.hp),
      mh: e.maxHp,
    })),
    it: engine.items.map((i) => ({ i: i.id, x: q(i.x), y: q(i.y), k: i.kind, o: i.owner })),
    ack,
  };
}

// ---------------------------------------------------------------- メッセージ

export type ClientMessage =
  | { t: "join"; v: number; room: string; name?: string }
  | { t: "config"; config: Partial<VersusConfig> }
  | { t: "ready"; ready: boolean }
  /** hist は seq-1, seq-2 ... の入力。1パケット落ちても次のパケットで穴埋めできる */
  | { t: "input"; seq: number; mask: number; hist?: number[] }
  | { t: "ping"; id: number; sent: number }
  | { t: "leave" };

export type ServerMessage =
  | { t: "joined"; you: PlayerId; room: string; config: VersusConfig; peer: boolean }
  | { t: "peer"; connected: boolean; ready: boolean }
  | { t: "config"; config: VersusConfig }
  | { t: "start"; seed: number; config: VersusConfig; tick: number }
  | { t: "snap"; s: Snapshot }
  | { t: "pong"; id: number; sent: number }
  | { t: "over"; winner: PlayerId | 0 }
  | { t: "error"; code: "full" | "version" | "notfound" | "bad"; message: string };
