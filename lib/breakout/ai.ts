import { W, clamp } from "./constants";
import type { BreakoutEngine } from "./engine";
import type { Ball, PlayerInput, Side } from "./types";

export type CpuLevel = 1 | 2 | 3 | 4;

interface CpuSpec {
  label: string;
  /** 反応の鈍さ（フレーム） */
  lag: number;
  /** 狙いのブレ（px） */
  aimError: number;
  /** 技を狙う確率 */
  skillRate: number;
  /** 技のタイミングのブレ（フレーム） */
  timingError: number;
  /** 前に出る度合い（0 = 引いて守る、1 = 前に出る） */
  aggression: number;
}

/** ボールがこの距離まで近づいたら、狙いを固定して動かさない（＝読み直せない） */
const COMMIT_DISTANCE = 200;

export const CPU_LEVELS: Record<CpuLevel, CpuSpec> = {
  1: { label: "やさしい", lag: 12, aimError: 46, skillRate: 0.2, timingError: 6, aggression: 0.2 },
  2: { label: "ふつう", lag: 8, aimError: 30, skillRate: 0.45, timingError: 4, aggression: 0.4 },
  3: { label: "つよい", lag: 5, aimError: 18, skillRate: 0.7, timingError: 2, aggression: 0.6 },
  4: { label: "最強", lag: 2, aimError: 8, skillRate: 0.9, timingError: 1, aggression: 0.8 },
};

/**
 * 対戦モードの CPU。
 *
 * エンジンと同じく描画に依存しないので、ヘッドレスで CPU 同士を戦わせて
 * バランスを数値で測れる（scripts/breakout/sim.ts）。
 */
export class CpuPlayer {
  private input: PlayerInput = {
    left: false,
    right: false,
    up: false,
    down: false,
    fire: false,
    analog: null,
  };
  private targetX = W / 2;
  private cooldown = 0;
  private nextRand = Math.random;

  constructor(
    readonly side: Side,
    readonly level: CpuLevel,
    random?: () => number,
  ) {
    if (random) this.nextRand = random;
  }

  /** 自分側へ向かってくるボールのうち、一番早く届くもの */
  private incoming(engine: BreakoutEngine): Ball | null {
    let best: Ball | null = null;
    let bestT = Infinity;
    const me = engine.paddles.find((p) => p.side === this.side);
    if (!me) return null;
    for (const b of engine.balls) {
      const toward = this.side === 0 ? b.vy > 0 : b.vy < 0;
      if (!toward) continue;
      const t = (me.y - b.y) / (b.vy || 1);
      if (t > 0 && t < bestT) {
        bestT = t;
        best = b;
      }
    }
    return best;
  }

  /** 壁の反射だけを考慮して着弾点を読む（スピンとロブは読めない＝人間と同じ土俵にする） */
  private predictX(ball: Ball, targetY: number): number {
    let x = ball.x;
    let vx = ball.vx;
    const t = (targetY - ball.y) / (ball.vy || 1);
    let remaining = Math.max(0, t);
    while (remaining > 0) {
      const wall = vx > 0 ? (W - ball.r - x) / vx : vx < 0 ? (ball.r - x) / vx : Infinity;
      if (wall < remaining && wall > 0) {
        x += vx * wall;
        vx = -vx;
        remaining -= wall;
      } else {
        x += vx * remaining;
        remaining = 0;
      }
    }
    return clamp(x, 0, W);
  }

  think(engine: BreakoutEngine): PlayerInput {
    const spec = CPU_LEVELS[this.level];
    const me = engine.paddles.find((p) => p.side === this.side);
    const input = this.input;
    input.left = input.right = input.up = input.down = input.fire = false;
    input.analog = null;
    if (!me) return input;

    const ball = this.incoming(engine);
    // 人間と同じく「途中で狙いを決めたら、あとは大きくは動かせない」ようにする。
    // 最後の瞬間まで読み直せる CPU にすると、カーブもボレーも全部拾われて技の意味が消える。
    const committed = !!ball && Math.abs(ball.y - me.y) < COMMIT_DISTANCE;
    if (!committed && engine.tick % Math.max(1, spec.lag) === 0) {
      this.targetX = ball
        ? this.predictX(ball, me.y) + (this.nextRand() * 2 - 1) * spec.aimError
        : W / 2;
    }

    const dx = this.targetX - me.x;
    if (Math.abs(dx) > 6) {
      input.left = dx < 0;
      input.right = dx > 0;
    }

    // 前後：ボールが遠いときは前に出て、近づいたら引いて守る
    if (ball) {
      const dist = Math.abs(ball.y - me.y);
      const advance = dist > 260 ? spec.aggression : 0;
      if (advance > 0.35) {
        input.up = this.side === 0;
        input.down = this.side === 1;
      } else if (dist < 160) {
        input.up = this.side === 1;
        input.down = this.side === 0;
      }
    }

    if (this.cooldown > 0) this.cooldown--;

    // 技：接触までの残りフレームを読んで、判定窓に入るタイミングで押す
    if (ball && this.cooldown <= 0 && this.nextRand() < spec.skillRate) {
      const frames = ((me.y - ball.y) / (ball.vy || 1)) * 60;
      const jitter = (this.nextRand() * 2 - 1) * spec.timingError;
      if (frames + jitter <= 3 && frames > -2 && Math.abs(dx) < 40) {
        const roll = this.nextRand();
        // 中立ブロックが厚いときはボレーで飛び越え、薄いときはスマッシュで押し込む
        const bandLeft = engine.blocks.filter((b) => b.alive).length;
        const lobBias = bandLeft > 20 ? 0.45 : 0.2;
        if (roll < lobBias) {
          input.up = this.side === 1;
          input.down = this.side === 0;
          input.left = input.right = false;
        } else if (roll < lobBias + 0.35) {
          input.up = this.side === 0;
          input.down = this.side === 1;
          input.left = input.right = false;
        } else {
          // カーブ：相手のいない側へ曲げる
          const foe = engine.paddles.find((p) => p.side !== this.side);
          const toRight = foe ? foe.x < W / 2 : this.nextRand() < 0.5;
          input.left = !toRight;
          input.right = toRight;
          input.up = input.down = false;
        }
        input.fire = true;
        this.cooldown = 10;
      }
    }
    return input;
  }
}
