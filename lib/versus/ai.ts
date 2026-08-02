import { clamp, createRng, type Rng } from "../game/rng";
import { CPU_PROFILES, VERSUS_WEAPONS } from "./constants";
import type { VersusEngine } from "./engine";
import type { BoostId, CpuLevel, Fighter, FighterInput, PlayerId } from "./types";

/**
 * CPU 思考ルーチン。
 * 「反応間隔ごとに方針を決め、その方針に沿って動く」構造にして、
 * 難易度を反応速度・狙いのブレ・回避距離で表現する。
 */
export class VersusAi {
  private level: CpuLevel;
  private think = 0;
  private targetX = 0;
  private targetY = 0;
  private wantFire = false;
  private wantBomb = false;
  private jitter = 0;

  private rng: Rng;
  private rand: (min: number, max: number) => number;
  private random: () => number;

  constructor(
    private readonly id: PlayerId,
    level: CpuLevel,
    /** 指定すると思考が再現可能になる（検証用） */
    seed?: number,
  ) {
    this.level = level;
    this.rng = createRng(seed ?? Math.floor(Math.random() * 0xffffffff));
    this.rand = (min, max) => min + this.rng.next() * (max - min);
    this.random = () => this.rng.next();
  }

  setLevel(level: CpuLevel) {
    this.level = level;
  }

  update(engine: VersusEngine, dt: number): FighterInput {
    const me = engine.fighters[this.id - 1];
    const foe = engine.fighters[this.id === 1 ? 1 : 0];
    const profile = CPU_PROFILES[this.level];

    this.think -= dt;
    if (this.think <= 0) {
      this.think = profile.reaction * this.rand(0.8, 1.25);
      this.decide(engine, me, foe);
    }

    const dead = engine.phase !== "fighting" || !me.alive;
    if (dead) {
      return { left: false, right: false, up: false, down: false, fire: false, special: false };
    }

    return {
      left: this.targetX < me.x - 5,
      right: this.targetX > me.x + 5,
      up: this.targetY < me.y - 6,
      down: this.targetY > me.y + 6,
      fire: this.wantFire,
      special: this.wantBomb,
    };
  }

  private decide(engine: VersusEngine, me: Fighter, foe: Fighter) {
    const profile = CPU_PROFILES[this.level];
    this.jitter = this.rand(-profile.aimError, profile.aimError);
    this.wantBomb = false;

    // 1) 回避：自分に向かってくる弾を探す
    const threat = this.nearestThreat(engine, me, profile.dodgeRange);
    if (threat) {
      const escape = threat.x < me.x ? 1 : -1;
      this.targetX = clamp(me.x + escape * 90, 20, 460);
      // 横に逃げつつ、弾の来る方向から少しだけ下がる
      const retreat = me.id === 1 ? 18 : -18;
      this.targetY = clamp(me.y + retreat, me.zoneTop + 16, me.zoneBottom - 16);
      // 回避中でも隙があれば撃つ
      this.wantFire = Math.abs(foe.x - me.x) < 26 && me.energy > profile.energyFloor;
      return;
    }

    // 2) 自陣に落ちてきたアイテムを拾う
    const item = engine.items
      .filter((i) => i.owner === me.id)
      .map((i) => ({ i, d: Math.hypot(i.x - me.x, i.y - me.y) }))
      .sort((a, b) => a.d - b.d)[0];
    if (item && this.random() < profile.greed) {
      this.targetX = item.i.x;
      this.targetY = clamp(item.i.y, me.zoneTop + 16, me.zoneBottom - 16);
      this.wantFire = me.energy > me.maxEnergy * 0.8;
      return;
    }

    // 3) 中立ゾーンの敵を撃つ（倒せばアイテムが自分に流れる）
    const enemy = engine.enemies
      .map((e) => ({ e, d: Math.abs(e.x - me.x) }))
      .filter((x) => x.d < 150)
      .sort((a, b) => a.d - b.d)[0];

    // 4) 基本は相手を狙う
    const aimX = foe.x + this.jitter;
    const enemyPriority = enemy && (enemy.d < Math.abs(aimX - me.x) || !foe.alive);
    this.targetX = clamp(enemyPriority ? enemy.e.x : aimX, 20, 460);

    // 前線を維持しつつ、体力が減ったら距離を取る
    const forward = me.id === 1 ? me.zoneTop + 26 : me.zoneBottom - 26;
    const back = me.id === 1 ? me.zoneBottom - 26 : me.zoneTop + 26;
    this.targetY = me.hp <= me.maxHp * 0.35 ? back : forward + (back - forward) * 0.35;

    const spec = VERSUS_WEAPONS[me.weapon];
    const aligned = Math.abs(this.targetX - me.x) < 22;
    const hasEnergy = me.energy > Math.max(spec.cost, profile.energyFloor);
    this.wantFire = aligned && hasEnergy && this.random() > profile.hesitation;

    // ボムは相手に正対しているときだけ使う
    if (me.bombs > 0 && Math.abs(foe.x - me.x) < 20 && this.random() < 0.5) {
      this.wantBomb = true;
    }
  }

  /** 自分に向かって飛んでくる弾のうち最も近いもの */
  private nearestThreat(engine: VersusEngine, me: Fighter, range: number) {
    let best: (typeof engine.bullets)[number] | null = null;
    let bestD = Infinity;
    for (const b of engine.bullets) {
      if (b.owner === me.id) continue;
      const approaching = (b.y < me.y && b.vy > 0) || (b.y > me.y && b.vy < 0);
      if (!approaching) continue;
      const dy = Math.abs(b.y - me.y);
      if (dy > range) continue;
      // 進路が自分の横幅にかかるか
      const timeToReach = dy / Math.max(1, Math.abs(b.vy));
      const predictedX = b.x + b.vx * timeToReach;
      if (Math.abs(predictedX - me.x) > 26) continue;
      if (dy < bestD) {
        bestD = dy;
        best = b;
      }
    }
    return best;
  }

  /**
   * 逆転強化の選択。人間と同じ土俵に乗せるため、CPU も必ず1つ取る。
   * 生存に効くものを軽く優先しつつ、毎回同じにならないよう乱数で崩す。
   */
  pickBoost(options: BoostId[]): BoostId {
    if (options.length === 0) return "armor";
    const weight: Record<string, number> = { armor: 3, guard: 3, regen: 2, power: 2, barrier: 2, swift: 1, payload: 1, focus: 1 };
    let best = options[0];
    let bestScore = -Infinity;
    for (const id of options) {
      const score = (weight[id] ?? 1) + this.random() * 2;
      if (score > bestScore) {
        bestScore = score;
        best = id;
      }
    }
    return best;
  }
}
