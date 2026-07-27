import { clamp } from "../../game/rng";
import {
  BASE_SPEED,
  BOTTOM_ZONE,
  SLOW_FACTOR,
  SPEED_STEP,
  TOP_ZONE,
  V_W,
} from "../constants";
import type { FighterInput, PlayerId, VersusConfig, VersusPhase } from "../types";
import {
  encodeInput,
  INPUT_REDUNDANCY,
  INTERP_DELAY_MS,
  PROTOCOL_VERSION,
  type ClientMessage,
  type ServerMessage,
  type SnapBullet,
  type SnapEnemy,
  type SnapFighter,
  type SnapItem,
  type Snapshot,
} from "./protocol";

export interface ClientOptions {
  send: (message: ClientMessage) => void;
  /** 補間の遅延（ms）。回線が荒れるときは大きくする */
  interpDelayMs?: number;
}

export interface ViewFighter extends SnapFighter {
  id: PlayerId;
}

export interface ClientView {
  phase: VersusPhase;
  round: number;
  timeLeft: number;
  countdown: number;
  overdrive: boolean;
  banner: string | null;
  lastRoundWinner: PlayerId | 0 | null;
  matchWinner: PlayerId | 0 | null;
  fighters: [ViewFighter, ViewFighter];
  bullets: SnapBullet[];
  enemies: SnapEnemy[];
  items: SnapItem[];
}

interface PendingInput {
  seq: number;
  input: FighterInput;
  dt: number;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * クライアント側のネットワーク処理。
 *
 * - 自機は入力を即座に反映（予測）し、サーバーの答えが届いたら差分を補正する
 * - 相手・敵・弾・アイテムは INTERP_DELAY_MS だけ過去を描画して滑らかに見せる
 * - 被弾・アイテム取得・勝敗は一切予測しない（サーバーの結果のみ）
 */
export class NetClient {
  you: PlayerId | null = null;
  room = "";
  config: VersusConfig | null = null;
  peerConnected = false;
  peerReady = false;
  started = false;
  matchWinner: PlayerId | 0 | null = null;
  rttMs = 0;
  /** 直近の巻き戻し量（px）。これが大きいとゴムのように引き戻されて見える */
  lastCorrection = 0;
  /** 適用したスナップショット数（検証時のサンプリング用） */
  snapshotsApplied = 0;

  private name?: string;
  private send: (message: ClientMessage) => void;
  private interpDelay: number;
  private buffer: { at: number; snap: Snapshot }[] = [];
  private pending: PendingInput[] = [];
  private seq = 0;
  private lastMask = -1;
  /** 直近に送った入力（ロスの穴埋め用に次のパケットへ相乗りさせる） */
  private maskHistory: number[] = [];
  private predicted: { x: number; y: number } | null = null;
  /** 適用済みスナップショットの最新ティック。順序が入れ替わって届いた古い分は捨てる */
  private lastSnapTick = -1;
  /** 補正を一気に反映すると跳ねるので、少しずつ寄せるためのオフセット */
  private smooth = { x: 0, y: 0 };
  private pingTimer = 0;
  private pingId = 0;
  /** 入室・準備完了の再送用（パケットが落ちても待ちぼうけにならないように） */
  private wantReady = false;
  private handshakeTimer = 0;

  constructor(options: ClientOptions) {
    this.send = options.send;
    this.interpDelay = options.interpDelayMs ?? INTERP_DELAY_MS;
  }

  join(room: string, name?: string) {
    this.room = room;
    this.name = name;
    this.send({ t: "join", v: PROTOCOL_VERSION, room, name });
  }

  setReady(ready: boolean) {
    this.wantReady = ready;
    this.send({ t: "ready", ready });
  }

  setConfig(config: Partial<VersusConfig>) {
    this.send({ t: "config", config });
  }

  leave() {
    this.send({ t: "leave" });
  }

  // ---------------------------------------------------------------- 受信

  handle(message: ServerMessage, now: number) {
    switch (message.t) {
      case "joined":
        this.you = message.you;
        this.room = message.room;
        this.config = message.config;
        this.peerConnected = message.peer;
        break;
      case "peer":
        this.peerConnected = message.connected;
        this.peerReady = message.ready;
        break;
      case "config":
        this.config = message.config;
        break;
      case "start":
        this.started = true;
        this.config = message.config;
        this.lastSnapTick = -1;
        this.buffer = [];
        this.pending = [];
        this.predicted = null;
        this.smooth = { x: 0, y: 0 };
        break;
      case "snap":
        this.onSnapshot(message.s, now);
        break;
      case "pong":
        this.rttMs = Math.max(0, now - message.sent);
        break;
      case "over":
        this.matchWinner = message.winner;
        break;
      case "error":
        break;
    }
  }

  private onSnapshot(snap: Snapshot, now: number) {
    // ゆらぎで前後して届くことがある。古いスナップショットを適用すると
    // 権威位置が巻き戻り、そのぶんだけ自機がガクつく。
    if (snap.tk <= this.lastSnapTick) return;
    this.lastSnapTick = snap.tk;
    this.snapshotsApplied += 1;
    // 決着の通知が届かなくても、スナップショットに載っている結果で確定できる
    if (snap.mw !== null && this.matchWinner === null) this.matchWinner = snap.mw;
    this.buffer.push({ at: now, snap });
    // 補間に必要な分だけ残す
    while (this.buffer.length > 40) this.buffer.shift();

    if (!this.you) return;
    const mine = snap.f[this.you - 1];
    const ack = snap.ack[this.you - 1];

    // サーバーが処理済みの入力は捨てる
    this.pending = this.pending.filter((p) => p.seq > ack);

    // 権威位置から、未処理の入力を積み直す（リコンサイル）
    const before = this.predicted;
    let x = mine.x;
    let y = mine.y;
    for (const p of this.pending) {
      const moved = this.step(x, y, p.input, p.dt, mine);
      x = moved.x;
      y = moved.y;
    }
    if (before) {
      const dx = before.x - x;
      const dy = before.y - y;
      this.lastCorrection = Math.hypot(dx, dy);
      // 小さなズレは徐々に寄せる。大きくズレたときは素直に飛ばす
      if (this.lastCorrection < 24) {
        this.smooth.x = clamp(this.smooth.x + dx, -24, 24);
        this.smooth.y = clamp(this.smooth.y + dy, -24, 24);
      } else {
        this.smooth = { x: 0, y: 0 };
      }
    }
    this.predicted = { x, y };
  }

  // ---------------------------------------------------------------- 送信と予測

  /** 毎フレーム呼ぶ。入力の送信と自機予測を進める */
  update(dt: number, input: FighterInput, now: number) {
    // 開始前は、入室と準備完了を定期的に送り直す。
    // 1パケット落ちただけで永久に始まらない、という事故を防ぐ。
    if (!this.started) {
      this.handshakeTimer += dt;
      if (this.handshakeTimer >= 1) {
        this.handshakeTimer = 0;
        if (!this.you) this.send({ t: "join", v: PROTOCOL_VERSION, room: this.room, name: this.name });
        else if (this.wantReady) this.send({ t: "ready", ready: true });
      }
    }
    if (!this.you) return;

    // 入力はフレームごとに1つ送る。サーバーも1ティックにつき1つ消費するので、
    // 予測の巻き戻し単位とサーバーの適用単位が 1:1 で対応する。
    this.seq += 1;
    const mask = encodeInput(input);
    this.lastMask = mask;
    this.send({ t: "input", seq: this.seq, mask, hist: this.maskHistory.slice(0, INPUT_REDUNDANCY) });
    this.maskHistory.unshift(mask);
    if (this.maskHistory.length > INPUT_REDUNDANCY) this.maskHistory.length = INPUT_REDUNDANCY;

    this.pingTimer += dt;
    if (this.pingTimer >= 1) {
      this.pingTimer = 0;
      this.pingId += 1;
      this.send({ t: "ping", id: this.pingId, sent: now });
    }

    const latest = this.latest();
    if (!latest || !this.started) return;
    const mine = latest.f[this.you - 1];

    if (!this.predicted) this.predicted = { x: mine.x, y: mine.y };
    // 送った入力は、サーバーが処理を認めるまで保持しておく
    this.pending.push({ seq: this.seq, input, dt });
    if (this.pending.length > 120) this.pending.shift();

    const moved = this.step(this.predicted.x, this.predicted.y, input, dt, mine);
    this.predicted = moved;

    // 溜めた補正を少しずつ解消する
    const decay = Math.min(1, dt * 6);
    this.smooth.x *= 1 - decay;
    this.smooth.y *= 1 - decay;
  }

  /** サーバーと同じ移動計算。ここがズレると予測が外れる */
  private step(x: number, y: number, input: FighterInput, dt: number, mine: SnapFighter) {
    const zone = this.you === 1 ? BOTTOM_ZONE : TOP_ZONE;
    const speed = (BASE_SPEED + mine.sp * SPEED_STEP) * (mine.sl ? SLOW_FACTOR : 1);
    let dx = 0;
    let dy = 0;
    if (input.left) dx -= 1;
    if (input.right) dx += 1;
    if (input.up) dy -= 1;
    if (input.down) dy += 1;
    if (dx !== 0 || dy !== 0) {
      const len = Math.hypot(dx, dy) || 1;
      x += (dx / len) * speed * dt;
      y += (dy / len) * speed * dt;
    }
    return {
      x: clamp(x, 14, V_W - 14),
      y: clamp(y, zone.top + 14, zone.bottom - 14),
    };
  }

  private latest(): Snapshot | null {
    return this.buffer.length ? this.buffer[this.buffer.length - 1].snap : null;
  }

  // ---------------------------------------------------------------- 描画用ビュー

  /** 補間済み＋自機予測を載せた、描画のための状態 */
  getView(now: number): ClientView | null {
    const latest = this.latest();
    if (!latest || !this.you) return null;

    const target = now - this.interpDelay;
    let older = this.buffer[0];
    let newer = this.buffer[this.buffer.length - 1];
    for (let i = 0; i < this.buffer.length - 1; i++) {
      if (this.buffer[i].at <= target && this.buffer[i + 1].at >= target) {
        older = this.buffer[i];
        newer = this.buffer[i + 1];
        break;
      }
    }
    const span = newer.at - older.at;
    const t = span > 0 ? clamp((target - older.at) / span, 0, 1) : 1;

    const mergeById = <T extends { i: number; x: number; y: number }>(a: T[], b: T[]): T[] => {
      const map = new Map(a.map((e) => [e.i, e]));
      return b.map((entity) => {
        const prev = map.get(entity.i);
        if (!prev) return entity;
        return { ...entity, x: lerp(prev.x, entity.x, t), y: lerp(prev.y, entity.y, t) };
      });
    };

    const fighters = [0, 1].map((i) => {
      const prev = older.snap.f[i];
      const next = newer.snap.f[i];
      const id = (i + 1) as PlayerId;
      // 自分は予測位置、相手は補間位置
      if (id === this.you && this.predicted) {
        return { ...latest.f[i], id, x: this.predicted.x + this.smooth.x, y: this.predicted.y + this.smooth.y };
      }
      return { ...next, id, x: lerp(prev.x, next.x, t), y: lerp(prev.y, next.y, t) };
    }) as [ViewFighter, ViewFighter];

    return {
      phase: latest.ph,
      round: latest.rd,
      timeLeft: latest.tl,
      countdown: latest.cd,
      overdrive: latest.od === 1,
      banner: latest.bn,
      lastRoundWinner: latest.lw,
      matchWinner: latest.mw,
      fighters,
      bullets: mergeById(older.snap.b, newer.snap.b),
      enemies: mergeById(older.snap.e, newer.snap.e),
      items: mergeById(older.snap.it, newer.snap.it),
    };
  }
}
