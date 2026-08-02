import { clamp } from "../game/rng";
import { BOMB_SPEC, V_H, V_W, VERSUS_WEAPONS } from "./constants";
import { zonesFor, getCourse } from "./courses";
import type { VersusEngine } from "./engine";
import type { FighterInput, PlayerId } from "./types";

/**
 * 学習で作る CPU。
 *
 * 手書きのルール（ai.ts）は「反応速度・狙いのブレ・回避距離」を数値で調整する形なので、
 * ルールが想定していない動きは出せない。ここでは盤面を数値の並び（特徴量）にして、
 * 小さなニューラルネットに入力 → 操作を出力させる。重みは自己対戦の進化戦略で決める。
 *
 * 誤差逆伝播は使わない。行列演算も自前なので、追加のライブラリは要らない。
 * 学習結果は数値の配列なので、静的サイトにそのまま載せられる。
 */

export const OBS_SIZE = 32;
export const HIDDEN_SIZE = 24;
export const ACT_SIZE = 6;

export const WEIGHT_COUNT =
  OBS_SIZE * HIDDEN_SIZE + HIDDEN_SIZE + HIDDEN_SIZE * ACT_SIZE + ACT_SIZE;

/** 見ている脅威（弾）の数 */
const THREATS = 3;

/**
 * 盤面から特徴量を作る。
 *
 * すべて自陣を下、相手を上とした「自分から見た向き」に直してから正規化する。
 * こうしておくと P1 用に学習した重みが P2 でもそのまま使える（学習量が半分で済む）。
 */
export function observe(engine: VersusEngine, id: PlayerId): Float64Array {
  const o = new Float64Array(OBS_SIZE);
  const me = engine.fighters[id - 1];
  const foe = engine.fighters[id === 1 ? 1 : 0];
  const zones = zonesFor(getCourse(engine.config.course));
  const myZone = id === 1 ? zones.bottom : zones.top;
  // 下側プレイヤーはそのまま、上側プレイヤーは上下反転して「自分が下」に揃える
  const flip = id === 1 ? 1 : -1;
  const fy = (y: number) => (flip === 1 ? y : V_H - y);

  const zoneTop = flip === 1 ? myZone.top : V_H - myZone.bottom;
  const zoneBottom = flip === 1 ? myZone.bottom : V_H - myZone.top;
  const zoneH = Math.max(1, zoneBottom - zoneTop);

  let i = 0;
  // --- 自分の状態 ---
  o[i++] = (me.x / V_W) * 2 - 1;
  o[i++] = ((fy(me.y) - zoneTop) / zoneH) * 2 - 1;
  o[i++] = me.hp / me.maxHp;
  o[i++] = me.energy / Math.max(1, me.maxEnergy);
  o[i++] = me.shield / 2;
  o[i++] = (me.power - 1) / 3;
  o[i++] = me.bombs / 2;
  o[i++] = me.speedLevel / 3;
  o[i++] = me.weapon === "single" ? 0 : 1;
  o[i++] = me.invincible > 0 ? 1 : 0;
  o[i++] = me.fireCooldown > 0 ? 1 : 0;
  o[i++] = me.slowTimer > 0 ? 1 : 0;

  // --- 相手 ---
  o[i++] = (foe.x - me.x) / V_W;
  o[i++] = (fy(foe.y) - fy(me.y)) / V_H;
  o[i++] = foe.hp / foe.maxHp;
  o[i++] = foe.energy / Math.max(1, foe.maxEnergy);

  // --- 迫ってくる弾（近い順に3つ） ---
  const threats: { dx: number; dy: number; vy: number }[] = [];
  for (const b of engine.bullets) {
    if (b.owner === id) continue;
    const by = fy(b.y);
    const my = fy(me.y);
    const dy = by - my;
    // 自分より上（＝これから降ってくる側）だけ見る
    if (dy > 40) continue;
    threats.push({ dx: b.x - me.x, dy, vy: flip === 1 ? b.vy : -b.vy });
  }
  threats.sort((a, b) => Math.abs(a.dy) + Math.abs(a.dx) * 0.4 - (Math.abs(b.dy) + Math.abs(b.dx) * 0.4));
  for (let t = 0; t < THREATS; t++) {
    const th = threats[t];
    o[i++] = th ? clamp(th.dx / 120, -1, 1) : 0;
    o[i++] = th ? clamp(th.dy / 200, -1, 1) : 0;
    o[i++] = th ? clamp(th.vy / 500, -1, 1) : 0;
  }
  o[i++] = Math.min(1, threats.length / 8);

  // --- 中立ゾーンの敵（一番近いもの） ---
  let ne: { dx: number; dy: number; hp: number } | null = null;
  let nd = Infinity;
  for (const e of engine.enemies) {
    const d = Math.abs(e.x - me.x) + Math.abs(fy(e.y) - fy(me.y)) * 0.5;
    if (d < nd) {
      nd = d;
      ne = { dx: e.x - me.x, dy: fy(e.y) - fy(me.y), hp: e.hp / Math.max(1, e.maxHp) };
    }
  }
  o[i++] = ne ? clamp(ne.dx / 200, -1, 1) : 0;
  o[i++] = ne ? clamp(ne.dy / 300, -1, 1) : 0;
  o[i++] = ne ? ne.hp : 0;

  // --- 自分が拾えるアイテム（一番近いもの） ---
  let it: { dx: number; dy: number } | null = null;
  let idd = Infinity;
  for (const item of engine.items) {
    if (item.owner !== id) continue;
    const d = Math.abs(item.x - me.x) + Math.abs(fy(item.y) - fy(me.y));
    if (d < idd) {
      idd = d;
      it = { dx: item.x - me.x, dy: fy(item.y) - fy(me.y) };
    }
  }
  o[i++] = it ? clamp(it.dx / 200, -1, 1) : 0;
  o[i++] = it ? clamp(it.dy / 300, -1, 1) : 0;
  o[i++] = it ? 1 : 0;

  // --- 壁（自分の正面にあるもの） ---
  let wallAhead = 0;
  for (const w of engine.walls) {
    if (w.hp <= 0) continue;
    if (Math.abs(w.x - me.x) < w.w / 2 + 10) wallAhead = 1;
  }
  o[i++] = wallAhead;

  // --- 試合の状況 ---
  o[i++] = clamp(engine.roundTime / 75, 0, 1);
  o[i++] = engine.overdrive ? 1 : 0;
  o[i++] = clamp((me.hp - foe.hp) / 10, -1, 1);
  o[i++] = 1; // バイアス項

  return o;
}

export interface PolicyWeights {
  /** OBS_SIZE * HIDDEN_SIZE + HIDDEN_SIZE + HIDDEN_SIZE * ACT_SIZE + ACT_SIZE */
  w: number[];
}

/** 32 → 24 → 6 の全結合。中間層 tanh、出力も tanh */
export function forward(weights: number[], obs: Float64Array): Float64Array {
  const hidden = new Float64Array(HIDDEN_SIZE);
  let p = 0;
  for (let h = 0; h < HIDDEN_SIZE; h++) {
    let sum = 0;
    for (let i = 0; i < OBS_SIZE; i++) sum += obs[i] * weights[p++];
    hidden[h] = Math.tanh(sum + weights[OBS_SIZE * HIDDEN_SIZE + h]);
  }
  p = OBS_SIZE * HIDDEN_SIZE + HIDDEN_SIZE;
  const out = new Float64Array(ACT_SIZE);
  for (let a = 0; a < ACT_SIZE; a++) {
    let sum = 0;
    for (let h = 0; h < HIDDEN_SIZE; h++) sum += hidden[h] * weights[p + a * HIDDEN_SIZE + h];
    out[a] = Math.tanh(sum + weights[p + ACT_SIZE * HIDDEN_SIZE + a]);
  }
  return out;
}

/** 出力を操作に直す。0 を閾値にして押す／押さないを決める */
export function toInput(out: Float64Array): FighterInput {
  return {
    left: out[0] > 0.15,
    right: out[1] > 0.15,
    up: out[2] > 0.15,
    down: out[3] > 0.15,
    fire: out[4] > 0,
    special: out[5] > 0.4,
  };
}

/** 学習した重みで動く CPU */
export class NeuralAi {
  constructor(
    private readonly id: PlayerId,
    private readonly weights: number[],
  ) {}

  update(engine: VersusEngine): FighterInput {
    const me = engine.fighters[this.id - 1];
    if (engine.phase !== "fighting" || !me.alive) {
      return { left: false, right: false, up: false, down: false, fire: false, special: false };
    }
    const raw = toInput(forward(this.weights, observe(engine, this.id)));
    // 上側プレイヤーは「自分が下」に揃えた座標で考えているので、上下を戻す
    if (this.id === 2) return { ...raw, up: raw.down, down: raw.up };
    return raw;
  }
}

/** 参考値：使っていない定数への参照を型検査に残しておく */
export const NEURAL_META = { bombCost: BOMB_SPEC.dmg, weaponCount: Object.keys(VERSUS_WEAPONS).length };
