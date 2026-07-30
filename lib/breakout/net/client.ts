import {
  BALL_R,
  LOB_GRAVITY,
  PADDLE_H,
  PADDLE_W,
  SPIN_ACCEL,
  SPIN_DECAY,
  clamp,
} from "../constants";
import { applyPaddleMotion, DT, type Laser } from "../engine";
import { buildBand, buildStage } from "../stages";
import type { RenderState } from "../render";
import type { Ball, Block, ItemDrop, Paddle, PlayerInput, Side } from "../types";
import { cloneInput, emptyInput } from "../types";
import {
  encodeInput,
  INPUT_REDUNDANCY,
  INTERP_DELAY_MS,
  PROTOCOL_VERSION,
  rotateInput,
  type ClientMessage,
  type NetConfig,
  type ServerMessage,
  type SnapPaddle,
  type Snapshot,
  type WireInput,
} from "./protocol";

/** 外挿しすぎない上限（秒）。これ以上先は読まない */
const MAX_EXTRAPOLATE = 0.2;
/** 権威位置とのズレをこの速さで寄せる（1フレームあたり px）。瞬間移動させない */
const BALL_CORRECTION = 4;
/** これを超えてズレていたら諦めて瞬間的に合わせる */
const BALL_SNAP = 90;

export type ClientPhase = "connecting" | "lobby" | "playing" | "over";

function blankPaddle(index: number, side: Side): Paddle {
  return {
    index,
    side,
    x: 240,
    y: side === 0 ? 634 : 86,
    w: PADDLE_W,
    h: PADDLE_H,
    vx: 0,
    vy: 0,
    gauge: 100,
    gaugeMax: 100,
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

function applySnapPaddle(p: Paddle, s: SnapPaddle) {
  p.x = s.x;
  p.y = s.y;
  p.w = s.w;
  p.gauge = s.g;
  p.gaugeMax = s.gm;
  p.stun = s.st ? 1 : 0;
  p.points = s.pt;
  p.score = s.sc;
  p.timers = { ...s.tm };
  p.magnet = s.mg;
  p.drill = s.dr;
  p.floor = s.fl;
  p.wall = s.wl;
}

/**
 * 通信対戦のクライアント。
 *
 * 予測するのは**自分のパドルだけ**。得点・ブロック破壊・アイテム取得・勝敗はサーバーの結果に従う。
 * ボールだけは補間せず**外挿**する（§6.2）——打ち返す対象が遅れて見えると技が成立しないため。
 */
export class BreakoutClient {
  you: Side = 0;
  phase: ClientPhase = "connecting";
  peerConnected = false;
  peerReady = false;
  ready = false;
  config: NetConfig = { difficulty: "normal", mode: "versus" };
  winner: Side | null = null;
  error: string | null = null;

  /** 検証用の計測値 */
  stats = {
    rollback: 0,
    rollbackMax: 0,
    corrections: 0,
    snapshots: 0,
    stale: 0,
    rtt: 0,
    /** 巻き戻しのたびに再適用した入力の本数。0 なら予測が働いていない */
    unackedTotal: 0,
  };

  private send: (message: ClientMessage) => void;
  private now: () => number;

  private snap: Snapshot | null = null;
  private prevSnap: Snapshot | null = null;
  private snapAt = 0;
  private prevSnapAt = 0;

  private seq = 0;
  /** 未確定の入力。**必ず複製して積む**（参照のまま持つと巻き戻しが「いまの入力」で行われる） */
  private unacked: { seq: number; input: PlayerInput }[] = [];
  private history: WireInput[] = [];

  /** 予測した自分のパドル */
  private mine: Paddle;
  /** 補間して描く相手のパドル */
  private theirs: Paddle;
  private blocks: Block[] = [];
  /** いま組み立ててあるブロックの元（対戦は帯のシード、協力はステージ番号の符号反転） */
  private blocksKey: number | null = null;
  private balls: Ball[] = [];
  /** 表示位置と外挿位置のズレ。少しずつ 0 へ近づける */
  private ballOffsets = new Map<number, { x: number; y: number }>();
  private items: ItemDrop[] = [];
  private lasers: Laser[] = [];
  private accumulator = 0;
  private elapsed = 0;
  private pingId = 0;
  private lastPingAt = 0;
  /**
   * 入室・準備完了は落ちると永久に試合が始まらないので、届いたことが分かるまで再送する。
   * （仮想ネットワークのロス1%で実際に踏んだ）
   */
  private roomName = "";
  private lastRetryAt = 0;

  constructor(options: { send: (message: ClientMessage) => void; now?: () => number }) {
    this.send = options.send;
    this.now = options.now ?? (() => performance.now());
    this.mine = blankPaddle(0, 0);
    this.theirs = blankPaddle(1, 1);
  }

  /** 協力ではパドルが2枚とも下側に並ぶ。対戦では上下に分かれる */
  private resetPaddles() {
    const coop = this.config.mode === "coop";
    const otherIndex = this.you === 0 ? 1 : 0;
    this.mine = blankPaddle(this.you, coop ? 0 : (this.you as Side));
    this.theirs = blankPaddle(otherIndex, coop ? 0 : (otherIndex as Side));
    if (coop) {
      this.mine.y = 660;
      this.theirs.y = 660;
      this.mine.x = this.you === 0 ? 150 : 330;
      this.theirs.x = this.you === 0 ? 330 : 150;
    }
  }

  join(room: string) {
    this.roomName = room;
    this.send({ t: "join", v: PROTOCOL_VERSION, room });
  }

  setReady(ready: boolean) {
    this.ready = ready;
    this.send({ t: "ready", ready });
  }

  leave() {
    this.send({ t: "leave" });
  }

  // ---------------------------------------------------------------- 受信

  receive(message: ServerMessage) {
    switch (message.t) {
      case "joined": {
        this.you = message.you;
        this.config = message.config;
        this.peerConnected = message.peer;
        this.resetPaddles();
        this.phase = "lobby";
        break;
      }
      case "peer":
        this.peerConnected = message.connected;
        this.peerReady = message.ready;
        break;
      case "config":
        this.config = message.config;
        break;
      case "start":
        this.config = message.config;
        this.resetPaddles();
        this.blocksKey = null;
        this.phase = "playing";
        this.winner = null;
        this.seq = 0;
        this.unacked = [];
        this.history = [];
        this.snap = null;
        this.prevSnap = null;
        break;
      case "snap":
        this.applySnapshot(message.s);
        break;
      case "pong":
        this.stats.rtt = this.now() - message.sent;
        break;
      case "over":
        this.winner = message.winner;
        this.phase = "over";
        break;
      case "error":
        this.error = message.message;
        break;
    }
  }

  private applySnapshot(s: Snapshot) {
    // 前後して届いたスナップショットは無視する（権威位置が巻き戻ってガクつく）
    if (this.snap && s.tk <= this.snap.tk) {
      this.stats.stale++;
      return;
    }
    this.stats.snapshots++;
    this.prevSnap = this.snap;
    this.prevSnapAt = this.snapAt;
    this.snap = s;
    this.snapAt = this.now();

    // ブロックは種類と座標をシード（対戦）／ステージ番号（協力）から作り、
    // 耐久だけスナップショットで合わせる
    const key = this.config.mode === "coop" ? -s.sg : s.bs;
    if (key !== this.blocksKey) {
      this.blocksKey = key;
      this.blocks = this.config.mode === "coop" ? buildStage(s.sg) : buildBand(s.bs);
    }
    for (let i = 0; i < this.blocks.length; i++) {
      const hp = s.bl[i] ?? 0;
      this.blocks[i].alive = hp > 0;
      this.blocks[i].hp = hp === 9 ? Infinity : hp;
    }

    // 自分のパドルは権威位置に戻してから、未確定の入力を再適用する（巻き戻し補正）
    const before = this.mine.x;
    const beforeY = this.mine.y;
    applySnapPaddle(this.mine, s.p[this.you]);
    const ack = s.ack[this.you];
    this.unacked = this.unacked.filter((u) => u.seq > ack);
    this.stats.unackedTotal += this.unacked.length;
    for (const u of this.unacked) {
      applyPaddleMotion(this.mine, u.input, this.config.mode === "versus");
    }
    const moved = Math.hypot(this.mine.x - before, this.mine.y - beforeY);
    this.stats.rollback += moved;
    this.stats.rollbackMax = Math.max(this.stats.rollbackMax, moved);

    applySnapPaddle(this.theirs, s.p[this.you === 0 ? 1 : 0]);

    this.items = s.it.map((i) => ({
      id: i.i,
      kind: i.k,
      x: i.x,
      y: i.y,
      vy: i.o === 0 ? 120 : -120,
      owner: i.o,
    }));
    this.lasers = s.ls.map((l) => ({ x: l.x, y: l.y, vy: l.vy, side: l.s }));
    this.syncBalls(s);
  }

  /**
   * ボールは補間せず外挿する。
   *
   * 位置のズレは「見えている位置と外挿位置の差」を持ち越して少しずつ減らす。
   * **表示位置そのものを1フレームNpxずつ動かしてはいけない**——球は毎フレーム
   * 6〜10px 進むので、それでは表示が恒久的に遅れる（実測で60px遅れた）。
   */
  private syncBalls(s: Snapshot) {
    const targets = this.extrapolatedTargets();
    const next: Ball[] = [];
    const offsets = new Map<number, { x: number; y: number }>();
    for (const sb of s.b) {
      const old = this.balls.find((b) => b.id === sb.i);
      const target = targets.get(sb.i);
      const ball: Ball = {
        id: sb.i,
        x: sb.x,
        y: sb.y,
        vx: sb.vx,
        vy: sb.vy,
        r: BALL_R,
        spin: sb.sp,
        spinT: sb.spt,
        lob: sb.lb,
        lobG: sb.lg,
        pierce: sb.pc,
        owner: sb.o,
        stuck: null,
        stuckOffset: 0,
        lastSkill: null,
        lastSkillBy: -1,
      };
      if (target) {
        ball.x = target.x;
        ball.y = target.y;
        ball.vx = target.vx;
        ball.vy = target.vy;
        ball.lob = target.lob;
        ball.spinT = target.spinT;
      }
      if (old && target) {
        // いま見えている位置とのズレを持ち越す（この差だけを少しずつ0へ近づける）
        const dx = old.x - target.x;
        const dy = old.y - target.y;
        const gap = Math.hypot(dx, dy);
        if (gap > 0.01 && gap < BALL_SNAP) {
          offsets.set(sb.i, { x: dx, y: dy });
          ball.x = old.x;
          ball.y = old.y;
          this.stats.corrections++;
        }
      }
      next.push(ball);
    }
    this.balls = next;
    this.ballOffsets = offsets;
  }

  // ---------------------------------------------------------------- 更新

  /**
   * 毎フレーム呼ぶ。入力を送り、自分のパドルを予測し、ボールを外挿する。
   *
   * input は**画面座標**で渡す。参加側（上側）の反転はこの中で行う。
   * 描画の反転（view().flip）と対になっているので、**必ず両方をここで面倒を見ること**。
   */
  update(input: PlayerInput) {
    const now = this.now();
    this.retryControl(now);
    if (this.phase === "playing" && now - this.lastPingAt > 1000) {
      this.lastPingAt = now;
      this.send({ t: "ping", id: ++this.pingId, sent: now });
    }
    if (this.phase !== "playing") {
      // 試合が始まる前は入力を送らない。
      // 送るとサーバーのキューに溜まり続け、開始後ずっと遅れて処理されることになる
      return;
    }

    this.accumulator += DT;
    this.elapsed += DT;

    // ---- 画面の反転と入力の反転は必ず対にする ----
    // 参加側（上側）は座標を 180 度回して描くので、入力も同じだけ回してから送る。
    // 片方だけ直すと再発するため、この2行は絶対に離さない。
    const flipped = this.config.mode === "versus" && this.you === 1;
    const fieldInput = flipped ? rotateInput(input) : input;

    // 押した時点のサーバーティック（ラグ補償の基準）
    const st = Math.round(this.serverTick());

    this.seq += 1;
    const wire = encodeInput(fieldInput);
    this.send({
      t: "input",
      seq: this.seq,
      in: wire,
      st,
      hist: this.history.slice(0, INPUT_REDUNDANCY),
    });
    this.history.unshift(wire);
    if (this.history.length > INPUT_REDUNDANCY) this.history.pop();

    // 未確定入力は必ず複製して積む（参照のまま持つと再計算が「いまの入力」で行われる）
    this.unacked.push({ seq: this.seq, input: cloneInput(fieldInput) });
    if (this.unacked.length > 120) this.unacked.shift();

    applyPaddleMotion(this.mine, fieldInput, this.config.mode === "versus");
    this.extrapolateBalls();
    this.moveItems();
  }

  /**
   * 入室と準備完了の再送。
   *
   * どちらも1発落ちるとロビーから進めなくなる。返事（joined / start）が来るまで
   * 定期的に送り直す。サーバー側は同じメッセージを何度受け取っても構わない作りにしてある。
   */
  private retryControl(now: number) {
    if (now - this.lastRetryAt < 600) return;
    if (this.phase === "connecting" && this.roomName) {
      this.lastRetryAt = now;
      this.send({ t: "join", v: PROTOCOL_VERSION, room: this.roomName });
    } else if (this.phase === "lobby" && this.ready) {
      this.lastRetryAt = now;
      this.send({ t: "ready", ready: true });
    }
  }

  /** いまのサーバーティックの推定値。スナップショットの到着時刻と片道遅延から求める */
  private serverTick(): number {
    if (!this.snap) return 0;
    const elapsed = (this.now() - this.snapAt) / 1000 + this.stats.rtt / 2000;
    return this.snap.tk + elapsed * 60;
  }

  /**
   * ボールを現在時刻まで進める。
   *
   * 相手パドルやアイテムのように 100ms 過去を補間すると、打ち返す対象が遅れて見えて
   * タイミング技が成立しなくなる。ボールだけは等速（ロブ中は重力込み）で先へ進める。
   */
  private extrapolateBalls() {
    if (!this.snap) return;
    const targets = this.extrapolatedTargets();
    for (const ball of this.balls) {
      const t = targets.get(ball.id);
      if (!t) continue;
      // ズレはここで減らす。表示位置は必ず「外挿位置＋残りのズレ」にする
      const offset = this.ballOffsets.get(ball.id);
      if (offset) {
        const len = Math.hypot(offset.x, offset.y);
        if (len <= BALL_CORRECTION) {
          this.ballOffsets.delete(ball.id);
        } else {
          const k = (len - BALL_CORRECTION) / len;
          offset.x *= k;
          offset.y *= k;
        }
      }
      const left = this.ballOffsets.get(ball.id);
      ball.x = t.x + (left?.x ?? 0);
      ball.y = t.y + (left?.y ?? 0);
      ball.vx = t.vx;
      ball.vy = t.vy;
      ball.lob = t.lob;
      ball.spinT = t.spinT;
    }
  }

  /** スナップショットから「いまの位置」を計算する（当たり判定は行わない） */
  private extrapolatedTargets() {
    const out = new Map<number, { x: number; y: number; vx: number; vy: number; lob: number; spinT: number }>();
    const snap = this.snap;
    if (!snap) return out;
    const dt = clamp((this.now() - this.snapAt) / 1000 + this.stats.rtt / 2000, 0, MAX_EXTRAPOLATE);
    for (const sb of snap.b) {
      let x = sb.x;
      let y = sb.y;
      let vx = sb.vx;
      let vy = sb.vy;
      let lob = sb.lb;
      let spinT = sb.spt;
      let left = dt;
      while (left > 0) {
        const step = Math.min(DT, left);
        if (spinT > 0) {
          // エンジンと同じ式にすること。垂直成分は**更新前の速度**から求め、
          // 最後に速さを元に戻す（カーブは向きだけ変えて速さは変えない）
          const speed = Math.hypot(vx, vy) || 1;
          const px = -vy / speed;
          const py = vx / speed;
          const s = sb.sp * (spinT / SPIN_DECAY);
          vx += px * SPIN_ACCEL * s * step;
          vy += py * SPIN_ACCEL * s * step;
          const after = Math.hypot(vx, vy) || 1;
          vx = (vx / after) * speed;
          vy = (vy / after) * speed;
          spinT = Math.max(0, spinT - step);
        }
        if (lob > 0) {
          vy += LOB_GRAVITY * sb.lg * step;
          lob = Math.max(0, lob - step);
        }
        x += vx * step;
        y += vy * step;
        // 壁だけは読める（跳ね返りを外挿しないと画面外まで飛んで見える）
        if (x < BALL_R) {
          x = BALL_R;
          vx = Math.abs(vx);
        } else if (x > 480 - BALL_R) {
          x = 480 - BALL_R;
          vx = -Math.abs(vx);
        }
        left -= step;
      }
      out.set(sb.i, { x, y, vx, vy, lob, spinT });
    }
    return out;
  }

  private moveItems() {
    for (const item of this.items) item.y += item.vy * DT;
    for (const laser of this.lasers) laser.y += laser.vy * DT;
  }

  // ---------------------------------------------------------------- 描画用

  /** 相手のパドルは 100ms 過去を補間して滑らかに見せる（ボールとは扱いを変える） */
  private interpolateOpponent() {
    if (!this.snap || !this.prevSnap) return;
    const renderAt = this.now() - INTERP_DELAY_MS;
    const span = this.snapAt - this.prevSnapAt;
    if (span <= 0) return;
    const t = clamp((renderAt - this.prevSnapAt) / span, 0, 1);
    const other = this.you === 0 ? 1 : 0;
    const a = this.prevSnap.p[other];
    const b = this.snap.p[other];
    this.theirs.x = a.x + (b.x - a.x) * t;
    this.theirs.y = a.y + (b.y - a.y) * t;
  }

  view(): RenderState & { flip: boolean } {
    this.interpolateOpponent();
    // paddles は必ずサーバーと同じ並び（添字 0,1）にする
    const paddles = this.you === 0 ? [this.mine, this.theirs] : [this.theirs, this.mine];
    return {
      mode: this.config.mode,
      time: this.elapsed,
      blocks: this.blocks,
      balls: this.balls,
      paddles,
      items: this.items,
      lasers: this.lasers,
      // 描画の反転。入力の反転（update 内）と必ず対で扱う。
      // 協力は同じ画面を2人で見るので反転しない
      flip: this.config.mode === "versus" && this.you === 1,
    };
  }

  /** HUD 用。自分視点で [自分, 相手] に並べ替える */
  hud() {
    const snap = this.snap;
    const other = this.you === 0 ? 1 : 0;
    return {
      points: [snap?.p[this.you].pt ?? 0, snap?.p[other].pt ?? 0] as [number, number],
      gauges: [this.mine.gauge, this.theirs.gauge],
      gaugeMaxes: [this.mine.gaugeMax, this.theirs.gaugeMax],
      stun: [this.mine.stun > 0, this.theirs.stun > 0],
      timeLeft: snap?.tl ?? 0,
      overdrive: snap?.od === 1,
      lives: snap?.lv ?? 0,
      chain: snap?.ch ?? 0,
      stage: snap?.sg ?? 1,
      score: (snap?.p[0].sc ?? 0) + (snap?.p[1].sc ?? 0),
      waiting: snap?.ph === "ready" || snap?.ph === "roundEnd",
      blind: (this.mine.timers.blind ?? 0) > 0,
    };
  }
}

export const emptyPlayerInput = emptyInput;
