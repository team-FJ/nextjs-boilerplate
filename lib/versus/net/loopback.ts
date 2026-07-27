/**
 * テスト用の仮想ネットワーク。
 * 遅延・ゆらぎ（ジッタ）・パケットロスを注入して、実回線に近い条件で
 * サーバーとクライアントの挙動を検証するために使う。
 */

import { createRng } from "../../game/rng";

export interface LinkConditions {
  /** 片道遅延（ms） */
  latencyMs: number;
  /** 遅延のゆらぎ幅（±ms） */
  jitterMs: number;
  /** パケットロス率（0-1） */
  lossRate: number;
  seed?: number;
}

interface Packet {
  due: number;
  size: number;
  deliver: () => void;
}

export class VirtualNetwork {
  now = 0;
  sent = 0;
  dropped = 0;
  bytes = 0;

  private queue: Packet[] = [];
  private rng: () => number;
  private conditions: LinkConditions;

  constructor(conditions: LinkConditions) {
    this.conditions = conditions;
    this.rng = createRng(conditions.seed ?? 12345).next;
  }

  setConditions(conditions: Partial<LinkConditions>) {
    this.conditions = { ...this.conditions, ...conditions };
  }

  /** payload はサイズ計測にのみ使う */
  send(payload: unknown, deliver: () => void) {
    const size = JSON.stringify(payload).length;
    this.sent += 1;
    if (this.rng() < this.conditions.lossRate) {
      this.dropped += 1;
      return;
    }
    this.bytes += size;
    const jitter = (this.rng() * 2 - 1) * this.conditions.jitterMs;
    const delay = Math.max(0, this.conditions.latencyMs + jitter);
    this.queue.push({ due: this.now + delay, size, deliver });
  }

  /** 指定ミリ秒だけ時間を進め、到着したパケットを配送する */
  advance(dtMs: number) {
    this.now += dtMs;
    if (this.queue.length === 0) return;
    // 到着順に並べ替えてから配送する（ジッタで前後することがある）
    this.queue.sort((a, b) => a.due - b.due);
    while (this.queue.length && this.queue[0].due <= this.now) {
      const packet = this.queue.shift();
      packet?.deliver();
    }
  }

  get lossPercent(): number {
    return this.sent === 0 ? 0 : (this.dropped / this.sent) * 100;
  }
}
