import { createRng, type Rng } from "../game/rng";
import {
  BALL_MAX_SPEED,
  BALL_MIN_SPEED,
  BALL_R,
  BALL_SOLO_MAX,
  BALL_START_SPEED,
  BALL_VERSUS_MIN,
  BALL_VERSUS_START,
  CHAIN_MULS,
  DIFFICULTY,
  GAUGE_BOOST_MAX,
  GAUGE_COST_BASE,
  GAUGE_COST_FAIL,
  GAUGE_COST_SWING,
  GAUGE_MAX,
  GAUGE_REGEN,
  GROUP_WEIGHT,
  H,
  ITEMS,
  ITEM_DROP_RATE,
  ITEM_DROP_RATE_TOUGH,
  ITEM_FALL_SPEED,
  ITEM_MAX_ACTIVE,
  LASER_INTERVAL,
  LIVES,
  LOB_GRAVITY,
  LOB_SPEED_MUL,
  LOB_TIME,
  LOB_TIME_LONG,
  PADDLE_H,
  PADDLE_ICE_ACCEL,
  PADDLE_SPEED,
  PADDLE_W,
  PADDLE_W_NARROW,
  PADDLE_W_WIDE,
  PLAY_BOTTOM,
  PLAY_TOP,
  POWERSPIN_MUL,
  PRE_INPUT_FRAMES,
  DRILL_FRAMES,
  DRILL_FRAMES_HEAVY,
  GAUGE_COST_POWER,
  POWER_MUL,
  SKILL_POLE,
  SKILL_SPEED_BASE,
  SKILL_SPEED_SWING,
  SOLO_PADDLE_Y,
  SPIN_ACCEL,
  SPIN_DECAY,
  STUN_TIME,
  V_DEAD_BOTTOM,
  V_DEAD_TOP,
  V_OVERDRIVE_AT,
  V_OVERDRIVE_SPEED,
  V_POINTS_TO_WIN,
  V_ROUND_TIME,
  V_SERVE_DELAY,
  V_ZONE_BOTTOM,
  V_BAND,
  V_ZONE_TOP,
  W,
  clamp,
} from "./constants";
import { buildBand, buildStage, resetBlockIds } from "./stages";
import type {
  Ball,
  Block,
  Difficulty,
  GameEvent,
  ItemDrop,
  ItemKind,
  Mode,
  Paddle,
  Phase,
  PlayerInput,
  Side,
  SkillAngle,
  SkillKind,
} from "./types";
import { emptyInput } from "./types";

export const DT = 1 / 60;

/** ラグ補償で遡れる上限（ティック）。約200ms を超える申告は現在ティックで判定する */
export const MAX_LAG_COMPENSATION = 12;

/**
 * パドルの移動。**エンジンとクライアントの自機予測で必ずこの関数を共有する。**
 * どちらかに式を書き写すと、少しの違いが巻き戻しの原因になる。
 */
export function applyPaddleMotion(p: Paddle, input: PlayerInput, versus: boolean) {
  // 妨害「リバース」は左右を入れ替えるだけ。画面反転処理とは必ず別系統にする
  const reversed = (p.timers.reverse ?? 0) > 0;
  const left = reversed ? input.right : input.left;
  const right = reversed ? input.left : input.right;
  const dirX = (right ? 1 : 0) - (left ? 1 : 0);

  const speed = PADDLE_SPEED * ((p.timers.narrow ?? 0) > 0 ? 1.05 : 1);
  if ((p.timers.ice ?? 0) > 0) {
    // 滑る：目標速度へ徐々に近づけ、入力を離しても止まりにくい
    const target = dirX * speed;
    const d = target - p.vx;
    const step = PADDLE_ICE_ACCEL * DT;
    p.vx += clamp(d, -step, step);
  } else {
    p.vx = dirX * speed;
  }
  p.x = clamp(p.x + p.vx * DT, p.w / 2, W - p.w / 2);

  if (versus) {
    const zone = p.side === 0 ? V_ZONE_BOTTOM : V_ZONE_TOP;
    const dirY = (input.down ? 1 : 0) - (input.up ? 1 : 0);
    p.vy = dirY * speed * 0.8;
    p.y = clamp(p.y + p.vy * DT, zone.top + p.h, zone.bottom - p.h);
  }
}

export interface EngineConfig {
  mode: Mode;
  difficulty: Difficulty;
  stage?: number;
  seed?: number;
  /** 対戦の開幕サーブをどちらへ出すか。指定しなければ下側 */
  firstServe?: Side;
}

export interface Laser {
  x: number;
  y: number;
  vy: number;
  side: Side;
}

/**
 * SPIN RALLY のゲームエンジン。
 *
 * 描画・React・音声に一切依存しない。音は events に積むだけで、鳴らすのは呼び出し側の責任。
 * この分離のおかげで、Node 上でヘッドレスに走らせてバランスとネットコードを数値で測れる。
 */
export class BreakoutEngine {
  readonly mode: Mode;
  readonly difficulty: Difficulty;
  stage: number;
  tick = 0;
  time = 0;
  phase: Phase = "ready";
  /** ready / roundEnd の残り時間 */
  waitTime = V_SERVE_DELAY;

  blocks: Block[] = [];
  balls: Ball[] = [];
  paddles: Paddle[] = [];
  items: ItemDrop[] = [];
  lasers: Laser[] = [];

  lives = LIVES;
  chain = 0;
  bestChain = 0;
  timeLeft = V_ROUND_TIME;
  overdrive = false;
  winner: Side | null = null;
  /** 対戦：次にサーブする側 */
  serveTo: Side = 0;
  /** 中立ブロック帯を組んだときのシード。シャッフルで変わるので通信対戦で同期する */
  bandSeed = 0;

  events: GameEvent[] = [];
  private rng: Rng;
  private nextBallId = 1;
  private nextItemId = 1;
  private prevInputs: PlayerInput[] = [];

  constructor(config: EngineConfig) {
    this.mode = config.mode;
    this.difficulty = config.difficulty;
    this.stage = config.stage ?? 1;
    this.rng = createRng(config.seed ?? 12345);
    this.serveTo = config.firstServe ?? 0;
    resetBlockIds();
    this.setupPaddles();
    this.setupField();
    this.resetBall();
  }

  // ---------------------------------------------------------------- setup

  private makePaddle(index: number, side: Side, x: number, y: number): Paddle {
    return {
      index,
      side,
      x,
      y,
      w: PADDLE_W,
      h: PADDLE_H,
      vx: 0,
      vy: 0,
      gauge: GAUGE_MAX,
      gaugeMax: GAUGE_MAX,
      stun: 0,
      pending: null,
      hitTick: -999,
      hitBall: -1,
      timers: {},
      magnet: 0,
      drill: 0,
      floor: 0,
      wall: 0,
      laserCd: 0,
      prevFire: false,
      score: 0,
      points: 0,
      lastSkill: null,
    };
  }

  private setupPaddles() {
    if (this.mode === "versus") {
      this.paddles = [
        this.makePaddle(0, 0, W / 2, V_ZONE_BOTTOM.bottom - 30),
        this.makePaddle(1, 1, W / 2, V_ZONE_TOP.top + 30),
      ];
    } else if (this.mode === "coop") {
      this.paddles = [
        this.makePaddle(0, 0, W / 2 - 90, SOLO_PADDLE_Y),
        this.makePaddle(1, 0, W / 2 + 90, SOLO_PADDLE_Y),
      ];
    } else {
      this.paddles = [this.makePaddle(0, 0, W / 2, SOLO_PADDLE_Y)];
    }
    this.prevInputs = this.paddles.map(() => emptyInput());
  }

  private setupField() {
    if (this.mode === "versus") {
      this.bandSeed = this.stage * 977 + 13;
      this.blocks = buildBand(this.bandSeed);
    } else {
      this.blocks = buildStage(this.stage);
    }
  }

  /** 中立ブロック帯を組み直す（シャッフル・通信対戦の同期） */
  rebuildBand(seed: number) {
    this.bandSeed = seed;
    this.blocks = buildBand(seed);
  }

  /**
   * ボールを配り直す。
   *
   * 対戦では失点した側へ配る。**中立ブロック帯の内側から出さないこと**——
   * 帯の中で湧くとブロックに埋まった状態から始まり、どちらへ弾かれるかが運になる。
   */
  resetBall() {
    this.balls = [];
    this.items = [];
    this.lasers = [];
    const versus = this.mode === "versus";
    const toward: Side = versus ? this.serveTo : 0;
    const speed =
      (versus ? BALL_VERSUS_START : BALL_START_SPEED) * DIFFICULTY[this.difficulty].ballSpeedMul;
    // 1人・協力は必ず上（ブロック側）へ、対戦は受け手の側へ向かって出す
    const dir = versus ? (toward === 0 ? 1 : -1) : -1;
    const angle = this.rng.range(-0.35, 0.35);
    this.balls.push({
      id: this.nextBallId++,
      x: W / 2,
      y: versus
        ? toward === 0
          ? V_BAND.bottom + 24
          : V_BAND.top - 24
        : SOLO_PADDLE_Y - 40,
      vx: Math.sin(angle) * speed,
      vy: Math.cos(angle) * speed * dir,
      r: BALL_R,
      spin: 0,
      spinT: 0,
      lob: 0,
      lobG: 1,
      pierce: 0,
      owner: toward === 0 ? 1 : 0,
      stuck: null,
      stuckOffset: 0,
      lastSkill: null,
      lastSkillBy: -1,
    });
    this.phase = "ready";
    this.waitTime = V_SERVE_DELAY;
  }

  // ---------------------------------------------------------------- step

  step(inputs: PlayerInput[]) {
    this.tick++;
    this.time += DT;

    if (this.phase === "gameOver" || this.phase === "stageClear") return;

    if (this.phase === "ready" || this.phase === "roundEnd") {
      this.waitTime -= DT;
      // 待機中もパドルは動かせる（構えを作れるようにする）
      this.paddles.forEach((p, i) => this.movePaddle(p, inputs[i] ?? emptyInput()));
      if (this.waitTime <= 0) {
        if (this.phase === "roundEnd") this.resetBall();
        else this.phase = "playing";
      }
      return;
    }

    this.paddles.forEach((p, i) => {
      const input = inputs[i] ?? emptyInput();
      this.movePaddle(p, input);
      this.handleFire(p, input);
      this.tickPaddleTimers(p);
      this.prevInputs[i] = { ...input, analog: input.analog ? { ...input.analog } : null };
    });

    this.updateBlocks();
    this.updateBalls();
    this.updateLasers();
    this.updateItems();

    if (this.mode === "versus") this.updateVersusClock();
    else this.checkStageClear();
  }

  // ---------------------------------------------------------------- paddle

  private zoneFor(p: Paddle) {
    if (this.mode !== "versus") return null;
    return p.side === 0 ? V_ZONE_BOTTOM : V_ZONE_TOP;
  }

  private movePaddle(p: Paddle, input: PlayerInput) {
    applyPaddleMotion(p, input, this.mode === "versus");

    // 吸着中のボールを連れて動く
    for (const b of this.balls) {
      if (b.stuck === p.index) {
        b.x = clamp(p.x + b.stuckOffset, b.r, W - b.r);
        b.y = p.y - (p.side === 0 ? p.h / 2 + b.r : -(p.h / 2 + b.r));
      }
    }
  }

  private tickPaddleTimers(p: Paddle) {
    for (const key of Object.keys(p.timers) as ItemKind[]) {
      const left = (p.timers[key] ?? 0) - DT;
      if (left <= 0) delete p.timers[key];
      else p.timers[key] = left;
    }
    p.w = (p.timers.wide ?? 0) > 0 ? PADDLE_W_WIDE : (p.timers.narrow ?? 0) > 0 || (p.timers.shrink ?? 0) > 0 ? PADDLE_W_NARROW : PADDLE_W;
    p.gaugeMax = (p.timers.gaugeboost ?? 0) > 0 ? GAUGE_BOOST_MAX : GAUGE_MAX;
    if (p.stun > 0) p.stun = Math.max(0, p.stun - DT);
    // レーザーは自動で撃つ。ショットは技に使うので入力を奪わない
    if (p.laserCd > 0) p.laserCd -= DT;
    if ((p.timers.laser ?? 0) > 0 && p.laserCd <= 0) {
      p.laserCd = LASER_INTERVAL;
      const dir = p.side === 0 ? -1 : 1;
      this.lasers.push({ x: p.x - 18, y: p.y, vy: 620 * dir, side: p.side });
      this.lasers.push({ x: p.x + 18, y: p.y, vy: 620 * dir, side: p.side });
      this.events.push({ type: "laser" });
    }
    if ((p.timers.jam ?? 0) <= 0) p.gauge = Math.min(p.gaugeMax, p.gauge + GAUGE_REGEN * DT);
    if (p.lastSkill && this.time - p.lastSkill.t > 0.4) p.lastSkill = null;

    // 先行入力が長すぎたら空振り
    const window = DIFFICULTY[this.difficulty].window;
    if (p.pending && window !== null && this.tick - p.pending.tick > PRE_INPUT_FRAMES) {
      p.pending = null;
      p.gauge = Math.max(0, p.gauge - GAUGE_COST_FAIL);
      p.stun = STUN_TIME;
      p.lastSkill = { kind: "fail", t: this.time };
      this.events.push({ type: "skill", kind: "fail", side: p.side, x: p.x, y: p.y });
    }
  }

  /**
   * 入力の向きから技の打ち出し角 θ を求める。
   *
   * sin = 相手側（＝ブロック側）へどれだけ倒したか（+1 で真上＝スマッシュ、−1 でボレー）
   * cos = 横へどれだけ倒したか（1 で真横＝最大カーブ）
   *
   * 「相手の方向に倒す＝スマッシュ」で統一するため、上側プレイヤーは画面の下が前方になる。
   */
  private angleOf(p: Paddle, input: PlayerInput): SkillAngle | null {
    let ix: number;
    let iy: number;
    if (input.analog) {
      ix = input.analog.x;
      iy = input.analog.y;
    } else {
      ix = (input.right ? 1 : 0) - (input.left ? 1 : 0);
      iy = (input.down ? 1 : 0) - (input.up ? 1 : 0);
    }
    const len = Math.hypot(ix, iy);
    if (len < 0.35) return null;
    ix /= len;
    iy /= len;
    // 前方（相手側）を正にする
    const forward = p.side === 0 ? -iy : iy;
    return { sin: clamp(forward, -1, 1), cos: Math.abs(ix), sign: Math.sign(ix) || 1 };
  }

  /** 方向なし（スマッシュ）が一番高い。カーブを主役に置くため横が一番安い */
  private skillCost(angle: SkillAngle | null) {
    if (!angle) return GAUGE_COST_POWER;
    return GAUGE_COST_BASE + GAUGE_COST_SWING * Math.abs(angle.sin);
  }

  private handleFire(p: Paddle, input: PlayerInput) {
    const prev = this.prevInputs[p.index] ?? emptyInput();
    const pressed = input.fire && !prev.fire;
    if (!pressed) return;
    /**
     * 通信対戦のラグ補償。
     *
     * 入力は片道の遅延ぶん遅れて届く。受信した瞬間の盤面で判定すると、
     * 参加側だけがその遅延ぶん不利になり、タイミング技が成立しなくなる。
     * クライアントが載せてきた「押したときのティック」まで遡って判定する。
     */
    const pressTick = this.tick - clamp(input.pressAge ?? 0, 0, MAX_LAG_COMPENSATION);

    // 吸着中なら発射が最優先
    const stuckBall = this.balls.find((b) => b.stuck === p.index);
    if (stuckBall) {
      stuckBall.stuck = null;
      const speed =
        (this.mode === "versus" ? BALL_VERSUS_START : BALL_START_SPEED) *
        DIFFICULTY[this.difficulty].ballSpeedMul;
      const dir = p.side === 0 ? -1 : 1;
      stuckBall.vx = clamp(stuckBall.stuckOffset / (p.w / 2), -1, 1) * speed * 0.6;
      stuckBall.vy = dir * speed;
      return;
    }

    // 方向を入れずに押したら「スマッシュ」＝速さだけの一撃。
    // 方向を入れると効果が付くかわりに速くならない。この分岐が技の背骨。
    const angle = this.angleOf(p, input);

    if (p.stun > 0) return;
    if (p.gauge < this.skillCost(angle)) return;

    /**
     * すでに接触が済んでいるなら、判定窓の内側にある限り遡って適用する。
     *
     * ここは **|pressTick - hitTick| <= window** でなければならない。
     * 「押したのは接触より前だが、通信の遅れでサーバーに届いたのは接触の後」という入力が
     * 毎回起きるため、pressTick >= hitTick に限ると先行入力にも後入力にも拾われず、
     * 参加側だけ空振りになる（実測で成立率が 53% まで落ちた）。
     */
    const window = DIFFICULTY[this.difficulty].window;
    if (window !== null && Math.abs(pressTick - p.hitTick) <= window) {
      const ball = this.balls.find((b) => b.id === p.hitBall);
      if (ball) {
        this.applySkill(p, ball, angle);
        p.hitTick = -999;
        return;
      }
    }
    p.pending = { angle, tick: pressTick };
  }

  // ---------------------------------------------------------------- skills

  private applySkill(p: Paddle, ball: Ball, a: SkillAngle | null) {
    const cost = this.skillCost(a);
    if (p.gauge < cost) return;
    p.gauge -= cost;

    const speed = Math.hypot(ball.vx, ball.vy);
    const [minSpeed, maxSpeed] = this.speedRange();

    // 方向なし＝スマッシュ。速くするだけで、曲がりも貫通も付かない
    if (!a) {
      this.setSpeed(ball, clamp(speed * POWER_MUL, minSpeed, maxSpeed));
      ball.spin = 0;
      ball.spinT = 0;
      ball.lob = 0;
      this.finishSkill(p, ball, "smash");
      return;
    }

    const mul = SKILL_SPEED_BASE + SKILL_SPEED_SWING * a.sin;
    const next = clamp(speed * mul, minSpeed, maxSpeed);

    let kind: SkillKind = "curve";
    if (a.sin >= SKILL_POLE) {
      kind = "drill";
      ball.pierce = (p.timers.heavysmash ?? 0) > 0 ? DRILL_FRAMES_HEAVY : DRILL_FRAMES;
      ball.spin = 0;
      ball.spinT = 0;
      this.setSpeed(ball, next);
    } else if (a.sin <= -SKILL_POLE) {
      kind = "lob";
      ball.lob = (p.timers.longlob ?? 0) > 0 ? LOB_TIME_LONG : LOB_TIME;
      // 重力は「打った側」へ向く。飛び越えて相手側へ落ちる山なりになる
      ball.lobG = p.side === 0 ? 1 : -1;
      ball.spin = 0;
      ball.spinT = 0;
      // 浮いた遅い球にする（θ の式のままだとほとんど減速しない）
      this.setSpeed(ball, clamp(speed * LOB_SPEED_MUL, minSpeed * 0.8, maxSpeed));
    } else {
      const spinMul = (p.timers.powerspin ?? 0) > 0 ? POWERSPIN_MUL : 1;
      ball.spin = a.cos * a.sign * spinMul;
      ball.spinT = SPIN_DECAY;
      // 斜め上は少しだけ貫通する（上ほどドリル寄り、という連続性を保つ）
      const heavy = (p.timers.heavysmash ?? 0) > 0 ? DRILL_FRAMES_HEAVY : DRILL_FRAMES;
      ball.pierce = Math.max(ball.pierce, Math.round(Math.max(0, a.sin) * heavy));
      this.setSpeed(ball, next);
    }

    if (p.drill > 0) {
      p.drill--;
      ball.pierce = Math.max(ball.pierce, 60);
    }

    this.finishSkill(p, ball, kind);
  }

  /** 技が成立したあとの共通処理（連携チェインの判定と通知） */
  private finishSkill(p: Paddle, ball: Ball, kind: SkillKind) {
    // 協力：ボレーで上げた球を相方がスマッシュで叩くと連携成立
    if (
      this.mode === "coop" &&
      kind === "smash" &&
      ball.lastSkill === "lob" &&
      ball.lastSkillBy !== p.index
    ) {
      this.chain = Math.min(CHAIN_MULS.length - 1, this.chain + 1);
      this.bestChain = Math.max(this.bestChain, this.chain);
      this.events.push({ type: "chain", count: this.chain });
    }
    ball.lastSkill = kind;
    ball.lastSkillBy = p.index;
    p.lastSkill = { kind, t: this.time };
    this.events.push({ type: "skill", kind, side: p.side, x: ball.x, y: ball.y });
  }

  /** モードごとの速度レンジ */
  private speedRange(): [number, number] {
    return this.mode === "versus"
      ? [BALL_VERSUS_MIN, BALL_MAX_SPEED]
      : [BALL_MIN_SPEED, BALL_SOLO_MAX];
  }

  private setSpeed(ball: Ball, speed: number) {
    const cur = Math.hypot(ball.vx, ball.vy) || 1;
    ball.vx = (ball.vx / cur) * speed;
    ball.vy = (ball.vy / cur) * speed;
  }

  // ---------------------------------------------------------------- balls

  private updateBlocks() {
    for (const b of this.blocks) {
      if (!b.alive || b.kind !== "moving") continue;
      b.phase += DT * 1.1;
      b.x = clamp(b.baseX + Math.sin(b.phase) * 40, 0, W - b.w);
    }
  }

  private updateBalls() {
    for (const ball of [...this.balls]) {
      if (ball.stuck !== null) continue;
      const speed = Math.hypot(ball.vx, ball.vy);
      const steps = Math.max(1, Math.ceil((speed * DT) / 4));
      const sdt = DT / steps;

      // スピン（マグヌス力の簡易版）とロブの重力
      if (ball.spinT > 0) {
        const s = ball.spin * (ball.spinT / SPIN_DECAY);
        const len = speed || 1;
        const px = -ball.vy / len;
        const py = ball.vx / len;
        ball.vx += px * SPIN_ACCEL * s * DT;
        ball.vy += py * SPIN_ACCEL * s * DT;
        this.setSpeed(ball, speed);
        ball.spinT = Math.max(0, ball.spinT - DT);
      }
      if (ball.lob > 0) {
        ball.vy += LOB_GRAVITY * ball.lobG * DT;
        ball.lob = Math.max(0, ball.lob - DT);
      }
      if (ball.pierce > 0) ball.pierce--;

      for (let i = 0; i < steps; i++) {
        ball.x += ball.vx * sdt;
        ball.y += ball.vy * sdt;
        this.collideWalls(ball);
        if (ball.lob <= 0) this.collideBlocks(ball);
        this.collidePaddles(ball);
        if (this.collideBounds(ball)) break;
      }
    }
  }

  private collideWalls(ball: Ball) {
    if (ball.x - ball.r < 0) {
      ball.x = ball.r;
      ball.vx = Math.abs(ball.vx);
      this.events.push({ type: "wall", x: ball.x, y: ball.y });
    } else if (ball.x + ball.r > W) {
      ball.x = W - ball.r;
      ball.vx = -Math.abs(ball.vx);
      this.events.push({ type: "wall", x: ball.x, y: ball.y });
    }
    if (this.mode !== "versus" && ball.y - ball.r < PLAY_TOP) {
      ball.y = PLAY_TOP + ball.r;
      ball.vy = Math.abs(ball.vy);
      this.events.push({ type: "wall", x: ball.x, y: ball.y });
    }
  }

  private collideBlocks(ball: Ball) {
    for (const b of this.blocks) {
      if (!b.alive) continue;
      if (
        ball.x + ball.r < b.x ||
        ball.x - ball.r > b.x + b.w ||
        ball.y + ball.r < b.y ||
        ball.y - ball.r > b.y + b.h
      ) {
        continue;
      }
      const overlapX = Math.min(ball.x + ball.r - b.x, b.x + b.w - (ball.x - ball.r));
      const overlapY = Math.min(ball.y + ball.r - b.y, b.y + b.h - (ball.y - ball.r));
      const pierce = ball.pierce > 0 && b.kind !== "solid";
      if (!pierce) {
        if (overlapX < overlapY) {
          ball.vx = -ball.vx;
          ball.x += ball.vx > 0 ? overlapX : -overlapX;
        } else {
          ball.vy = -ball.vy;
          ball.y += ball.vy > 0 ? overlapY : -overlapY;
        }
      }
      this.damageBlock(b, this.attackerOf(ball));
      return;
    }
  }

  /** そのボールを最後に打ったパドル（＝得点とアイテムの帰属先） */
  private attackerOf(ball: Ball): Paddle {
    return (
      this.paddles[ball.lastSkillBy] ??
      this.paddles.find((p) => p.side === ball.owner) ??
      this.paddles[0]
    );
  }

  private damageBlock(b: Block, by: Paddle) {
    if (b.kind === "solid") {
      this.events.push({ type: "blockHit", x: b.x + b.w / 2, y: b.y + b.h / 2 });
      return;
    }
    b.hp -= 1;
    if (b.hp > 0) {
      this.events.push({ type: "blockHit", x: b.x + b.w / 2, y: b.y + b.h / 2 });
      return;
    }
    b.alive = false;
    this.events.push({ type: "blockBreak", x: b.x + b.w / 2, y: b.y + b.h / 2, kind: b.kind });

    const mul = CHAIN_MULS[this.chain] * ((by.timers.score2 ?? 0) > 0 ? 2 : 1);
    by.score += Math.round(100 * mul);

    if (b.kind === "explosive") this.explode(b, by);
    this.maybeDropItem(b, by.side);
  }

  private explode(center: Block, by: Paddle) {
    const cx = center.x + center.w / 2;
    const cy = center.y + center.h / 2;
    for (const b of this.blocks) {
      if (!b.alive || b.kind === "solid") continue;
      const d = Math.hypot(b.x + b.w / 2 - cx, b.y + b.h / 2 - cy);
      if (d <= center.w * 1.6) {
        b.hp = 0;
        b.alive = false;
        this.events.push({ type: "blockBreak", x: b.x + b.w / 2, y: b.y + b.h / 2, kind: b.kind });
        this.maybeDropItem(b, by.side);
      }
    }
  }

  private maybeDropItem(b: Block, owner: Side) {
    if (this.items.length >= ITEM_MAX_ACTIVE) return;
    const rate = b.kind === "tough" ? ITEM_DROP_RATE_TOUGH : ITEM_DROP_RATE;
    if (!this.rng.chance(rate)) return;
    const kind = this.rollItem();
    if (!kind) return;
    this.items.push({
      id: this.nextItemId++,
      kind,
      x: b.x + b.w / 2,
      y: b.y + b.h / 2,
      vy: owner === 0 ? ITEM_FALL_SPEED : -ITEM_FALL_SPEED,
      owner,
    });
  }

  private rollItem(): ItemKind | null {
    const pool = (Object.keys(ITEMS) as ItemKind[]).filter((k) => {
      const spec = ITEMS[k];
      if (spec.versusOnly && this.mode !== "versus") return false;
      if (spec.soloOnly && this.mode === "versus") return false;
      if (k === "chainkeep" && this.mode !== "coop") return false;
      return true;
    });
    let total = 0;
    const weights = pool.map((k) => {
      const w = GROUP_WEIGHT[ITEMS[k].group];
      total += w;
      return w;
    });
    let roll = this.rng.next() * total;
    for (let i = 0; i < pool.length; i++) {
      roll -= weights[i];
      if (roll <= 0) return pool[i];
    }
    return pool[pool.length - 1] ?? null;
  }

  private collidePaddles(ball: Ball) {
    for (const p of this.paddles) {
      const halfH = p.h / 2;
      if (
        ball.x + ball.r < p.x - p.w / 2 ||
        ball.x - ball.r > p.x + p.w / 2 ||
        ball.y + ball.r < p.y - halfH ||
        ball.y - ball.r > p.y + halfH
      ) {
        continue;
      }
      // 自分の方へ向かってきている時だけ反射する（内部に入り込んだ時の二重反射を防ぐ）
      const approaching = p.side === 0 ? ball.vy > 0 : ball.vy < 0;
      if (!approaching) continue;

      const forward = p.side === 0 ? -1 : 1;
      ball.y = p.y + forward * (halfH + ball.r);

      if (p.magnet > 0) {
        p.magnet--;
        ball.stuck = p.index;
        ball.stuckOffset = clamp(ball.x - p.x, -p.w / 2, p.w / 2);
        ball.vx = 0;
        ball.vy = 0;
        ball.spin = 0;
        ball.spinT = 0;
        ball.lob = 0;
        this.events.push({ type: "paddleHit", x: ball.x, y: ball.y });
        return;
      }

      const [minSpeed, maxSpeed] = this.speedRange();
      const speed = clamp(Math.hypot(ball.vx, ball.vy), minSpeed, maxSpeed);
      // 当たった位置で角度が変わる（中央＝正面、端＝±60°）
      const offset = clamp((ball.x - p.x) / (p.w / 2), -1, 1);
      const angle = offset * (Math.PI / 3);
      ball.vx = Math.sin(angle) * speed + p.vx * 0.25;
      ball.vy = forward * Math.cos(angle) * speed;
      this.setSpeed(ball, speed);
      ball.spin = 0;
      ball.spinT = 0;
      ball.lob = 0;
      ball.owner = p.side;
      ball.lastSkill = null;
      ball.lastSkillBy = p.index;
      p.hitTick = this.tick;
      p.hitBall = ball.id;
      this.events.push({ type: "paddleHit", x: ball.x, y: ball.y });

      // 先行入力があれば、判定窓の内側なら成立・外側なら空振り
      if (p.pending) {
        const window = DIFFICULTY[this.difficulty].window;
        const late = this.tick - p.pending.tick;
        if (window === null || late <= window) {
          this.applySkill(p, ball, p.pending.angle);
        } else {
          p.gauge = Math.max(0, p.gauge - GAUGE_COST_FAIL);
          p.stun = STUN_TIME;
          p.lastSkill = { kind: "fail", t: this.time };
          this.events.push({ type: "skill", kind: "fail", side: p.side, x: p.x, y: p.y });
        }
        p.pending = null;
      }
      return;
    }
  }

  /** デッドライン（落球・失点）の判定。処理したら true */
  private collideBounds(ball: Ball): boolean {
    if (this.mode === "versus") {
      if (ball.y - ball.r > V_DEAD_BOTTOM) return this.concede(ball, 0);
      if (ball.y + ball.r < V_DEAD_TOP) return this.concede(ball, 1);
      return false;
    }
    if (ball.y - ball.r > PLAY_BOTTOM) {
      const guard = this.paddles.find((p) => p.floor > 0);
      if (guard) {
        guard.floor--;
        ball.y = PLAY_BOTTOM - ball.r;
        ball.vy = -Math.abs(ball.vy);
        this.events.push({ type: "wall", x: ball.x, y: ball.y });
        return false;
      }
      this.balls = this.balls.filter((b) => b.id !== ball.id);
      if (this.balls.length === 0) this.loseLife();
      return true;
    }
    return false;
  }

  /** 対戦：side 側が失点する */
  private concede(ball: Ball, side: Side): boolean {
    const victim = this.paddles.find((p) => p.side === side);
    if (victim && victim.wall > 0 && (victim.timers.wall ?? 0) > 0) {
      victim.wall--;
      if (victim.wall <= 0) delete victim.timers.wall;
      const forward = side === 0 ? -1 : 1;
      ball.y = (side === 0 ? V_DEAD_BOTTOM : V_DEAD_TOP) + forward * ball.r * 2;
      ball.vy = Math.abs(ball.vy) * forward;
      this.events.push({ type: "wall", x: ball.x, y: ball.y });
      return false;
    }
    if (victim && victim.floor > 0) {
      victim.floor--;
      const forward = side === 0 ? -1 : 1;
      ball.y = (side === 0 ? V_DEAD_BOTTOM : V_DEAD_TOP) + forward * ball.r * 2;
      ball.vy = Math.abs(ball.vy) * forward;
      this.events.push({ type: "wall", x: ball.x, y: ball.y });
      return false;
    }
    const scorer: Side = side === 0 ? 1 : 0;
    const winnerPaddle = this.paddles.find((p) => p.side === scorer)!;
    winnerPaddle.points++;
    this.events.push({ type: "score", side: scorer });
    this.serveTo = side;
    if (winnerPaddle.points >= V_POINTS_TO_WIN) {
      this.winner = scorer;
      this.phase = "gameOver";
      this.events.push({ type: "gameOver" });
    } else {
      this.phase = "roundEnd";
      this.waitTime = V_SERVE_DELAY;
      this.balls = [];
    }
    return true;
  }

  private loseLife() {
    this.lives--;
    const keep = this.paddles.some((p) => p.timers.chainkeep !== undefined);
    if (!keep) this.chain = 0;
    else this.paddles.forEach((p) => delete p.timers.chainkeep);
    this.events.push({ type: "miss", side: 0 });
    if (this.lives <= 0) {
      this.phase = "gameOver";
      this.events.push({ type: "gameOver" });
    } else {
      this.resetBall();
    }
  }

  // ---------------------------------------------------------------- lasers / items

  private updateLasers() {
    for (const l of [...this.lasers]) {
      l.y += l.vy * DT;
      if (l.y < 0 || l.y > H) {
        this.lasers = this.lasers.filter((x) => x !== l);
        continue;
      }
      const hit = this.blocks.find(
        (b) => b.alive && l.x >= b.x && l.x <= b.x + b.w && l.y >= b.y && l.y <= b.y + b.h,
      );
      if (hit) {
        this.damageBlock(hit, this.paddles.find((p) => p.side === l.side) ?? this.paddles[0]);
        this.lasers = this.lasers.filter((x) => x !== l);
      }
    }
  }

  private updateItems() {
    for (const item of [...this.items]) {
      item.y += item.vy * DT;
      if (item.y < -20 || item.y > H + 20) {
        this.items = this.items.filter((i) => i.id !== item.id);
        continue;
      }
      for (const p of this.paddles) {
        if (p.side !== item.owner) continue;
        if (
          Math.abs(item.x - p.x) < p.w / 2 + 10 &&
          Math.abs(item.y - p.y) < p.h / 2 + 10
        ) {
          this.applyItem(p, item.kind);
          this.items = this.items.filter((i) => i.id !== item.id);
          break;
        }
      }
    }
  }

  private opponentOf(p: Paddle): Paddle | undefined {
    return this.paddles.find((o) => o.side !== p.side);
  }

  applyItem(p: Paddle, kind: ItemKind) {
    const spec = ITEMS[kind];
    const target = spec.group === "hinder" ? this.opponentOf(p) : p;
    this.events.push({ type: "item", kind, side: p.side });
    if (!target) return;

    switch (kind) {
      case "magnet":
        p.magnet = 3;
        break;
      case "multi": {
        const src = this.balls[0];
        if (src) {
          for (const sign of [-1, 1]) {
            const speed = Math.hypot(src.vx, src.vy) || BALL_START_SPEED;
            const a = Math.atan2(src.vy, src.vx) + sign * 0.4;
            this.balls.push({
              ...src,
              id: this.nextBallId++,
              vx: Math.cos(a) * speed,
              vy: Math.sin(a) * speed,
              spin: 0,
              spinT: 0,
              lob: 0,
              pierce: 0,
              stuck: null,
            });
          }
        }
        break;
      }
      case "refill":
        p.gauge = p.gaugeMax;
        break;
      case "floor":
        p.floor = Math.min(3, p.floor + 1);
        break;
      case "oneup":
        if (this.mode === "versus") p.floor = Math.min(3, p.floor + 1);
        else this.lives++;
        break;
      case "drill":
        p.drill = Math.min(3, p.drill + 1);
        break;
      case "bomb": {
        // 一番下に残っているブロックを起点に爆破する
        const lowest = this.blocks.filter((b) => b.alive).sort((a, b) => b.y - a.y)[0];
        if (lowest) this.explode(lowest, p);
        break;
      }
      case "shuffle":
        this.rebuildBand(this.tick * 31 + 7);
        break;
      case "wall":
        p.wall = 3;
        p.timers.wall = spec.time;
        break;
      case "gaugedown":
        p.gauge = Math.floor(p.gauge / 2);
        break;
      case "slow":
        for (const b of this.balls) this.setSpeed(b, Math.hypot(b.vx, b.vy) * 0.85);
        target.timers[kind] = spec.time;
        break;
      case "accel":
        for (const b of this.balls) this.setSpeed(b, Math.hypot(b.vx, b.vy) * 1.25);
        target.timers[kind] = spec.time;
        break;
      default:
        if (spec.time > 0) target.timers[kind] = spec.time;
        break;
    }
    // ワイドとナローは同時に成立しない
    if (kind === "wide") delete target.timers.narrow;
    if (kind === "narrow" || kind === "shrink") delete target.timers.wide;
  }

  // ---------------------------------------------------------------- clocks

  private updateVersusClock() {
    this.timeLeft = Math.max(0, this.timeLeft - DT);
    if (!this.overdrive && this.timeLeft <= V_OVERDRIVE_AT) {
      this.overdrive = true;
      for (const b of this.balls) this.setSpeed(b, Math.hypot(b.vx, b.vy) * V_OVERDRIVE_SPEED);
    }
    if (this.timeLeft <= 0) {
      const [a, b] = this.paddles;
      // 得点 → 中立ブロック撃破数（＝スコア）→ 引き分け
      this.winner = a.points !== b.points ? (a.points > b.points ? a.side : b.side) : a.score !== b.score ? (a.score > b.score ? a.side : b.side) : null;
      this.phase = "gameOver";
      this.events.push({ type: "gameOver" });
    }
  }

  private checkStageClear() {
    const remaining = this.blocks.some((b) => b.alive && b.kind !== "solid");
    if (!remaining) {
      this.phase = "stageClear";
      this.events.push({ type: "stageClear" });
    }
  }

  /** 次のステージへ進む（1人・協力） */
  nextStage() {
    this.stage++;
    resetBlockIds();
    this.setupField();
    this.paddles.forEach((p) => {
      p.timers = {};
      p.gauge = p.gaugeMax;
      p.pending = null;
      p.stun = 0;
    });
    this.resetBall();
  }

  drainEvents(): GameEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  totalScore() {
    return this.paddles.reduce((sum, p) => sum + p.score, 0);
  }
}
