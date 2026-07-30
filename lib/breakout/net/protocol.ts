/**
 * BLOCK RALLY 通信対戦のプロトコル。
 *
 * 方針は INVADER ASSAULT と同じ：**サーバー権威＋クライアント予測＋巻き戻し補正**。
 * 決定論的ロックステップは採用しない（JavaScript では端末間で計算結果が一致しないため）。
 *
 * 本作固有の要件が2つある。
 *  1. ボールは補間ではなく**外挿**で描く（§6.2）。打ち返す対象が遅れて見えると
 *     タイミング技が成立しない。そのため速度もスナップショットに載せる。
 *  2. 技の判定は**ラグ補償**する（§6.3）。押した時点のサーバーティックを一緒に送り、
 *     サーバーはそこまで遡って成立を判定する。
 */

import type { BreakoutEngine } from "../engine";
import type { Difficulty, ItemKind, PlayerInput, Side } from "../types";

export const PROTOCOL_VERSION = 1;

/** サーバーのシミュレーション周波数 */
export const TICK_HZ = 60;
/** スナップショットの配信頻度 */
export const SNAPSHOT_HZ = 20;
/** 到着ゆらぎを吸収するためにサーバーが溜めておく入力の数 */
export const INPUT_BUFFER = 3;
/** 1パケットに載せる過去の入力の数（ロスの穴埋め用） */
export const INPUT_REDUNDANCY = 3;
/** 相手パドル・アイテムの補間バッファ（ボールには使わない） */
export const INTERP_DELAY_MS = 100;

// ---------------------------------------------------------------- 入力

const BIT = { left: 1, right: 2, up: 4, down: 8, fire: 16 } as const;
/** アナログ角度なしを表す値 */
const NO_ANGLE = 255;

export interface WireInput {
  /** 方向とショットのビット */
  m: number;
  /** スティックの生角度を 0-254 に量子化したもの。255 は「アナログなし」 */
  a: number;
}

export function encodeInput(input: PlayerInput): WireInput {
  let m = 0;
  if (input.left) m |= BIT.left;
  if (input.right) m |= BIT.right;
  if (input.up) m |= BIT.up;
  if (input.down) m |= BIT.down;
  if (input.fire) m |= BIT.fire;
  let a = NO_ANGLE;
  if (input.analog) {
    const angle = Math.atan2(input.analog.y, input.analog.x); // -π..π
    a = Math.round(((angle + Math.PI) / (Math.PI * 2)) * 254);
    if (a < 0) a = 0;
    if (a > 254) a = 254;
  }
  return { m, a };
}

export function decodeInput(wire: WireInput): PlayerInput {
  const angle = wire.a === NO_ANGLE ? null : (wire.a / 254) * Math.PI * 2 - Math.PI;
  return {
    left: (wire.m & BIT.left) !== 0,
    right: (wire.m & BIT.right) !== 0,
    up: (wire.m & BIT.up) !== 0,
    down: (wire.m & BIT.down) !== 0,
    fire: (wire.m & BIT.fire) !== 0,
    analog: angle === null ? null : { x: Math.cos(angle), y: Math.sin(angle) },
  };
}

/**
 * 参加側（上側プレイヤー）の入力を、フィールド座標へ回して渡す。
 *
 * **描画の反転と対で必ず使うこと。** 参加側の画面は 180 度回して描くので、
 * 回した分だけ入力も回さないと、上下左右がすべて逆になる。
 * 本作では技の方向がそのまま意味を持つため、忘れると「上を押したのにボレーが出る」。
 */
export function rotateInput(input: PlayerInput): PlayerInput {
  return {
    left: input.right,
    right: input.left,
    up: input.down,
    down: input.up,
    fire: input.fire,
    analog: input.analog ? { x: -input.analog.x, y: -input.analog.y } : null,
    pressAge: input.pressAge,
  };
}

// ---------------------------------------------------------------- スナップショット

const q = (v: number) => Math.round(v);
const q1 = (v: number) => Math.round(v * 10) / 10;

export interface SnapPaddle {
  x: number;
  y: number;
  w: number;
  /** 技ゲージと上限 */
  g: number;
  gm: number;
  /** 硬直しているか */
  st: 0 | 1;
  pt: number;
  sc: number;
  /** 効果中のアイテム（残り秒）。自機予測でも使うので必ず送る */
  tm: Partial<Record<ItemKind, number>>;
  mg: number;
  dr: number;
  fl: number;
  wl: number;
}

export interface SnapBall {
  i: number;
  x: number;
  y: number;
  /** 外挿のために速度も送る（補間ではなく外挿で描くため） */
  vx: number;
  vy: number;
  sp: number;
  spt: number;
  lb: number;
  lg: number;
  pc: number;
  o: Side;
}

export interface SnapItem {
  i: number;
  x: number;
  y: number;
  k: ItemKind;
  o: Side;
}

export interface Snapshot {
  tk: number;
  ph: string;
  wt: number;
  tl: number;
  od: 0 | 1;
  /** 勝者。null は未決 */
  wn: Side | null;
  sv: Side;
  /** 中立ブロック帯のシード（対戦）。シャッフルで変わったら参加側も組み直す */
  bs: number;
  /** ステージ番号（協力）。ブロックの並びはここから組み立てる */
  sg: number;
  /** 共有ライフと連携チェイン（協力） */
  lv: number;
  ch: number;
  /** ブロックの残り耐久（id 順）。0 は破壊済み */
  bl: number[];
  p: [SnapPaddle, SnapPaddle];
  b: SnapBall[];
  it: SnapItem[];
  ls: { x: number; y: number; vy: number; s: Side }[];
  /** 各プレイヤーの「ここまで処理した入力シーケンス」。予測の巻き戻しに使う */
  ack: [number, number];
}

export function captureSnapshot(
  engine: BreakoutEngine,
  tick: number,
  ack: [number, number],
): Snapshot {
  const paddle = (i: 0 | 1): SnapPaddle => {
    const p = engine.paddles[i];
    return {
      x: q1(p.x),
      y: q1(p.y),
      w: p.w,
      g: q(p.gauge),
      gm: p.gaugeMax,
      st: p.stun > 0 ? 1 : 0,
      pt: p.points,
      sc: p.score,
      tm: p.timers,
      mg: p.magnet,
      dr: p.drill,
      fl: p.floor,
      wl: p.wall,
    };
  };
  return {
    tk: tick,
    ph: engine.phase,
    wt: q1(engine.waitTime),
    tl: q1(engine.timeLeft),
    od: engine.overdrive ? 1 : 0,
    wn: engine.winner,
    sv: engine.serveTo,
    bs: engine.bandSeed,
    sg: engine.stage,
    lv: engine.lives,
    ch: engine.chain,
    bl: engine.blocks.map((b) => (b.alive ? (b.hp === Infinity ? 9 : b.hp) : 0)),
    p: [paddle(0), paddle(1)],
    b: engine.balls.map((b) => ({
      i: b.id,
      x: q1(b.x),
      y: q1(b.y),
      vx: q1(b.vx),
      vy: q1(b.vy),
      sp: q1(b.spin),
      spt: q1(b.spinT),
      lb: q1(b.lob),
      lg: b.lobG,
      pc: b.pierce,
      o: b.owner,
    })),
    it: engine.items.map((i) => ({ i: i.id, x: q(i.x), y: q(i.y), k: i.kind, o: i.owner })),
    ls: engine.lasers.map((l) => ({ x: q(l.x), y: q(l.y), vy: l.vy, s: l.side })),
    ack,
  };
}

// ---------------------------------------------------------------- メッセージ

export interface NetConfig {
  difficulty: Difficulty;
  /** 対戦か協力か。協力では画面を反転せず、2枚のパドルが同じ下辺に並ぶ */
  mode: "versus" | "coop";
}

export type ClientMessage =
  | { t: "join"; v: number; room: string }
  | { t: "config"; config: Partial<NetConfig> }
  | { t: "ready"; ready: boolean }
  /**
   * seq はクライアントのフレーム番号。hist は seq-1, seq-2 ... の入力で、
   * 1パケット落ちても次のパケットで穴埋めできるようにする。
   * st は「押した時点で見えていたサーバーティック」。ラグ補償に使う。
   */
  | { t: "input"; seq: number; in: WireInput; st: number; hist?: WireInput[] }
  | { t: "ping"; id: number; sent: number }
  | { t: "leave" };

export type ServerMessage =
  | { t: "joined"; you: Side; room: string; config: NetConfig; peer: boolean }
  | { t: "peer"; connected: boolean; ready: boolean }
  | { t: "config"; config: NetConfig }
  | { t: "start"; seed: number; config: NetConfig; tick: number; firstServe: Side }
  | { t: "snap"; s: Snapshot }
  | { t: "pong"; id: number; sent: number }
  | { t: "over"; winner: Side | null }
  | { t: "error"; code: "full" | "version" | "notfound" | "bad"; message: string };
