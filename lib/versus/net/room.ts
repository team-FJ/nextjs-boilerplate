import { SilentAudio } from "../../game/audio";
import { DEFAULT_SETTINGS } from "../../game/constants";
import { VersusEngine } from "../engine";
import { EMPTY_INPUT, type FighterInput, type PlayerId, type VersusConfig } from "../types";
import {
  captureSnapshot,
  decodeInput,
  PROTOCOL_VERSION,
  INPUT_BUFFER,
  SNAPSHOT_HZ,
  TICK_HZ,
  type ClientMessage,
  type ServerMessage,
} from "./protocol";

export interface RoomHooks {
  /** 指定プレイヤーへ送信する。トランスポート（WebSocket 等）はここで差し替える */
  send: (player: PlayerId, message: ServerMessage) => void;
  /** 切断の通知など、部屋が空になったら呼ばれる */
  onEmpty?: () => void;
}

const TICK_DT = 1 / TICK_HZ;
const SNAPSHOT_INTERVAL = 1 / SNAPSHOT_HZ;
/** 相手が落ちてからこの秒数を過ぎたら不戦勝にする */
const DISCONNECT_FORFEIT = 15;

interface QueuedInput {
  seq: number;
  input: FighterInput;
}

interface Slot {
  connected: boolean;
  ready: boolean;
  /** 未消費の入力（1ティックにつき1つ消費する） */
  queue: QueuedInput[];
  /** 最後に消費した入力。キューが空のときはこれを繰り返す */
  input: FighterInput;
  /** 最後に消費した入力のシーケンス番号（クライアントの巻き戻し基準） */
  seq: number;
  /** 受信済みの最大シーケンス（重複・逆順の判定用） */
  received: number;
  /** キューが空でティックを迎えた回数（回線品質の指標） */
  starved: number;
  /** ゆらぎ吸収のバッファが溜まったか。溜まるまでは消費を待つ */
  primed: boolean;
  /** 切断された時刻（秒） */
  lostAt: number | null;
}

const DEFAULT_CONFIG: VersusConfig = {
  mode: "local",
  cpuLevel: "normal",
  roundsToWin: 2,
  enemyDensity: "normal",
};

/**
 * 1部屋ぶんの権威サーバー。トランスポート非依存で、
 * WebSocket でも Durable Object でもテスト用の仮想ネットワークでも同じように動く。
 */
export class GameRoom {
  readonly id: string;
  readonly engine: VersusEngine;
  config: VersusConfig = { ...DEFAULT_CONFIG };
  started = false;
  finished = false;
  tick = 0;

  private hooks: RoomHooks;
  private slots: Record<PlayerId, Slot> = {
    1: this.emptySlot(),
    2: this.emptySlot(),
  };
  /** 試合のシード。指定すると同じ展開を再現できる */
  private seed?: number;
  private finalWinner: PlayerId | 0 = 0;
  private resendTimer = 0;
  private resendLeft = 0;
  private accumulator = 0;
  private snapshotTimer = 0;
  private elapsed = 0;

  private emptySlot(): Slot {
    return {
      connected: false,
      ready: false,
      queue: [],
      input: { ...EMPTY_INPUT },
      seq: 0,
      received: 0,
      starved: 0,
      primed: false,
      lostAt: null,
    };
  }

  constructor(id: string, hooks: RoomHooks, options: { seed?: number } = {}) {
    this.id = id;
    this.hooks = hooks;
    this.seed = options.seed;
    this.engine = new VersusEngine({ ...DEFAULT_SETTINGS }, new SilentAudio(), this.config);
  }

  get playerCount(): number {
    return (this.slots[1].connected ? 1 : 0) + (this.slots[2].connected ? 1 : 0);
  }

  // ---------------------------------------------------------------- 接続

  /** 空きスロットに座らせる。満室なら null */
  connect(): PlayerId | null {
    for (const id of [1, 2] as PlayerId[]) {
      if (!this.slots[id].connected) {
        const ready = this.slots[id].ready;
        this.slots[id] = this.emptySlot();
        this.slots[id].connected = true;
        this.slots[id].ready = ready && false;
        return id;
      }
    }
    return null;
  }

  disconnect(player: PlayerId) {
    const slot = this.slots[player];
    if (!slot.connected) return;
    slot.connected = false;
    slot.ready = false;
    slot.input = { ...EMPTY_INPUT };
    slot.queue = [];
    slot.lostAt = this.elapsed;
    const other = this.other(player);
    if (this.slots[other].connected) {
      this.hooks.send(other, { t: "peer", connected: false, ready: false });
    }
    if (this.playerCount === 0) this.hooks.onEmpty?.();
  }

  private other(player: PlayerId): PlayerId {
    return player === 1 ? 2 : 1;
  }

  // ---------------------------------------------------------------- 受信

  receive(player: PlayerId, message: ClientMessage) {
    const slot = this.slots[player];
    if (!slot.connected) return;

    switch (message.t) {
      case "join": {
        if (message.v !== PROTOCOL_VERSION) {
          this.hooks.send(player, {
            t: "error",
            code: "version",
            message: "アプリのバージョンが違います。ページを再読み込みしてください",
          });
          return;
        }
        this.hooks.send(player, {
          t: "joined",
          you: player,
          room: this.id,
          config: this.config,
          peer: this.slots[this.other(player)].connected,
        });
        const other = this.other(player);
        if (this.slots[other].connected) {
          this.hooks.send(other, { t: "peer", connected: true, ready: this.slots[player].ready });
        }
        break;
      }
      case "config": {
        // 部屋の設定を変えられるのは先に入った方（ホスト）だけ
        if (player !== 1 || this.started) return;
        this.config = { ...this.config, ...message.config, mode: "local" };
        this.broadcast({ t: "config", config: this.config });
        break;
      }
      case "ready": {
        slot.ready = message.ready;
        this.hooks.send(this.other(player), {
          t: "peer",
          connected: this.slots[this.other(player)].connected ? true : false,
          ready: slot.ready,
        });
        this.maybeStart();
        break;
      }
      case "input": {
        // すでに消費した分より古いものだけ捨てる。
        // ゆらぎで前後して届いた入力は、順番に並べ直して受け入れる
        // （捨てるとサーバーの入力が枯れて、クライアントの予測とズレる）。
        const add = (seq: number, mask: number) => {
          if (seq <= slot.seq) return;
          if (slot.queue.some((q) => q.seq === seq)) return;
          slot.queue.push({ seq, input: decodeInput(mask) });
        };
        // 落ちたパケットの穴を、相乗りしてきた履歴で埋める
        message.hist?.forEach((mask, i) => add(message.seq - (i + 1), mask));
        add(message.seq, message.mask);
        slot.received = Math.max(slot.received, message.seq);
        slot.queue.sort((a, b) => a.seq - b.seq);
        // 溜まりすぎたら古いものから間引く（極端な遅延で試合が遅れないように）
        while (slot.queue.length > 30) slot.queue.shift();
        break;
      }
      case "ping":
        this.hooks.send(player, { t: "pong", id: message.id, sent: message.sent });
        break;
      case "leave":
        this.disconnect(player);
        break;
    }
  }

  private maybeStart() {
    if (this.started || this.finished) return;
    if (!this.slots[1].connected || !this.slots[2].connected) return;
    if (!this.slots[1].ready || !this.slots[2].ready) return;
    this.start();
  }

  /** テストから同じ試合を再現できるようにシードを渡せる */
  start(seed = this.seed ?? Math.floor(Math.random() * 0xffffffff)) {
    this.started = true;
    this.tick = 0;
    this.engine.startMatch(this.config, seed);
    this.broadcast({ t: "start", seed, config: this.config, tick: this.tick });
    this.sendSnapshot();
  }

  private broadcast(message: ServerMessage) {
    for (const id of [1, 2] as PlayerId[]) {
      if (this.slots[id].connected) this.hooks.send(id, message);
    }
  }

  // ---------------------------------------------------------------- 更新

  /** 経過秒を渡して進める。呼び出し側の周期は問わない（内部で固定ステップに刻む） */
  update(dt: number) {
    this.elapsed += dt;
    if (this.finished) {
      this.resendFinish(dt);
      return;
    }
    if (!this.started) return;

    // 相手が落ちている間は試合を止めて待つ
    const waiting = !this.slots[1].connected || !this.slots[2].connected;
    if (waiting) {
      const lost = [1, 2].find((id) => !this.slots[id as PlayerId].connected) as PlayerId;
      const lostAt = this.slots[lost].lostAt ?? this.elapsed;
      if (this.elapsed - lostAt > DISCONNECT_FORFEIT) {
        this.finish(this.other(lost));
      }
      return;
    }

    this.accumulator += dt;
    let steps = 0;
    while (this.accumulator >= TICK_DT && steps < 8) {
      this.engine.update(TICK_DT, [this.consumeInput(1), this.consumeInput(2)]);
      this.accumulator -= TICK_DT;
      this.tick += 1;
      steps += 1;

      // ラウンド間は自動で進める（片方が押さないと進まない状態を作らない）
      if (this.engine.phase === "roundEnd" && this.engine.roundEndTimer <= 0) {
        this.engine.nextRound();
      }
      if (this.engine.phase === "matchEnd" && !this.finished) {
        this.finish(this.engine.matchWinner ?? 0);
      }
    }
    if (steps >= 8) this.accumulator = 0;

    this.snapshotTimer += dt;
    if (this.snapshotTimer >= SNAPSHOT_INTERVAL) {
      this.snapshotTimer = 0;
      this.sendSnapshot();
    }
  }

  /**
   * 1ティックぶんの入力を取り出す。
   * キューが溜まりすぎているときは追いつくために多めに消費し、
   * 空のときは直前の入力を繰り返す（＝ボタンを押しっぱなしと同じ扱い）。
   */
  private consumeInput(player: PlayerId): FighterInput {
    const slot = this.slots[player];
    // 到着のゆらぎを吸収するため、少し溜まってから消費を始める。
    // 空のまま消費を続けると入力が途切れ、クライアントの予測とズレる。
    if (!slot.primed) {
      if (slot.queue.length >= INPUT_BUFFER) slot.primed = true;
      else {
        slot.starved += 1;
        return slot.input;
      }
    }
    // 1ティックにつき必ず1つだけ消費する。
    // 「溜まったぶんを飛ばして追いつく」処理を入れると、飛ばした入力のぶんだけ
    // クライアントの予測とズレる（実測でちょうど1スナップショット分の巻き戻しになった）。
    // ゆらぎで一時的に溜まっても、消費し続ければ自然に解消する。
    const next: QueuedInput | undefined = slot.queue.shift();
    if (next) {
      slot.input = next.input;
      slot.seq = next.seq;
    } else {
      // 入力が間に合わなかったら直前の入力を維持し、バッファを積み直す
      slot.starved += 1;
      slot.primed = false;
    }
    return slot.input;
  }

  /** 回線品質の目安：入力が間に合わなかった回数 */
  starvation(player: PlayerId): number {
    return this.slots[player].starved;
  }

  private sendSnapshot() {
    const snap = captureSnapshot(this.engine, this.tick, [this.slots[1].seq, this.slots[2].seq]);
    this.broadcast({ t: "snap", s: snap });
  }

  private finish(winner: PlayerId | 0) {
    if (this.finished) return;
    this.finished = true;
    this.finalWinner = winner;
    this.resendTimer = 0;
    this.resendLeft = 5;
    this.sendSnapshot();
    this.broadcast({ t: "over", winner });
  }

  /** 決着の通知が落ちても伝わるよう、しばらく再送する */
  private resendFinish(dt: number) {
    if (!this.finished || this.resendLeft <= 0) return;
    this.resendTimer += dt;
    if (this.resendTimer < 0.5) return;
    this.resendTimer = 0;
    this.resendLeft -= 1;
    this.sendSnapshot();
    this.broadcast({ t: "over", winner: this.finalWinner });
  }

  /** ラウンド終了時刻など、UI 側から状態を覗くため */
  get roundEndTimer(): number {
    return this.engine.roundEndTimer;
  }
}
