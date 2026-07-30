import { BreakoutEngine, DT, MAX_LAG_COMPENSATION } from "../engine";
import type { Difficulty, PlayerInput, Side } from "../types";
import { emptyInput } from "../types";
import {
  captureSnapshot,
  decodeInput,
  INPUT_BUFFER,
  PROTOCOL_VERSION,
  SNAPSHOT_HZ,
  type ClientMessage,
  type NetConfig,
  type ServerMessage,
} from "./protocol";

export interface RoomHooks {
  /** 指定プレイヤーへ送信する。トランスポート（P2P / WebSocket / 別タブ）はここで差し替える */
  send: (player: Side, message: ServerMessage) => void;
  onEmpty?: () => void;
}

const SNAPSHOT_INTERVAL = 1 / SNAPSHOT_HZ;
/** 相手が落ちてからこの秒数を過ぎたら不戦勝にする */
const DISCONNECT_FORFEIT = 15;

interface QueuedInput {
  seq: number;
  input: PlayerInput;
  /** 押した時点でクライアントが見ていたサーバーティック */
  st: number;
}

interface Slot {
  connected: boolean;
  ready: boolean;
  queue: QueuedInput[];
  input: PlayerInput;
  seq: number;
  received: number;
  starved: number;
  primed: boolean;
  lostAt: number | null;
}

/**
 * 1部屋ぶんの権威サーバー。
 *
 * トランスポート非依存なので、進行役の端末のブラウザ内でも、Node のテストでも、
 * 仮想ネットワークを挟んだ検証でも、まったく同じコードが動く。
 */
export class BreakoutRoom {
  readonly id: string;
  engine: BreakoutEngine;
  config: NetConfig = { difficulty: "normal", mode: "versus" };
  started = false;
  finished = false;
  tick = 0;

  private hooks: RoomHooks;
  private slots: Record<Side, Slot> = { 0: this.emptySlot(), 1: this.emptySlot() };
  private seed?: number;
  private finalWinner: Side | null = null;
  private resendTimer = 0;
  private resendLeft = 0;
  private accumulator = 0;
  private snapshotTimer = 0;
  private elapsed = 0;
  /** ラグ補償で実際に遡ったティック数（検証用） */
  lagSamples: number[] = [];

  private emptySlot(): Slot {
    return {
      connected: false,
      ready: false,
      queue: [],
      input: emptyInput(),
      seq: 0,
      received: 0,
      starved: 0,
      primed: false,
      lostAt: null,
    };
  }

  constructor(
    id: string,
    hooks: RoomHooks,
    options: { seed?: number; difficulty?: Difficulty; mode?: "versus" | "coop" } = {},
  ) {
    this.id = id;
    this.hooks = hooks;
    this.seed = options.seed;
    if (options.difficulty) this.config.difficulty = options.difficulty;
    if (options.mode) this.config.mode = options.mode;
    this.engine = this.newEngine(options.seed ?? 1, 0);
  }

  private newEngine(seed: number, firstServe: Side) {
    return new BreakoutEngine({
      mode: this.config.mode,
      difficulty: this.config.difficulty,
      seed,
      firstServe,
    });
  }

  get playerCount(): number {
    return (this.slots[0].connected ? 1 : 0) + (this.slots[1].connected ? 1 : 0);
  }

  // ---------------------------------------------------------------- 接続

  /** 空きスロットに座らせる。満室なら null。0 = 下側（進行役）、1 = 上側 */
  connect(): Side | null {
    for (const id of [0, 1] as Side[]) {
      if (!this.slots[id].connected) {
        this.slots[id] = this.emptySlot();
        this.slots[id].connected = true;
        return id;
      }
    }
    return null;
  }

  disconnect(player: Side) {
    const slot = this.slots[player];
    if (!slot.connected) return;
    slot.connected = false;
    slot.ready = false;
    slot.input = emptyInput();
    slot.queue = [];
    slot.lostAt = this.elapsed;
    const other = this.other(player);
    if (this.slots[other].connected) {
      this.hooks.send(other, { t: "peer", connected: false, ready: false });
    }
    if (this.playerCount === 0) this.hooks.onEmpty?.();
  }

  private other(player: Side): Side {
    return player === 0 ? 1 : 0;
  }

  // ---------------------------------------------------------------- 受信

  receive(player: Side, message: ClientMessage) {
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
          this.hooks.send(other, { t: "peer", connected: true, ready: slot.ready });
        }
        break;
      }
      case "config": {
        // 設定を変えられるのは進行役（下側）だけ
        if (player !== 0 || this.started) return;
        this.config = { ...this.config, ...message.config };
        this.broadcast({ t: "config", config: this.config });
        break;
      }
      case "ready": {
        slot.ready = message.ready;
        this.hooks.send(this.other(player), {
          t: "peer",
          connected: this.slots[this.other(player)].connected,
          ready: slot.ready,
        });
        this.maybeStart();
        break;
      }
      case "input": {
        // すでに消費した分より古いものだけ捨てる。
        // ゆらぎで前後して届いた入力は順番に並べ直して受け入れる
        // （捨てるとサーバーの入力が枯れて、クライアントの予測とズレる）
        const add = (seq: number, wire: { m: number; a: number }, st: number) => {
          if (seq <= slot.seq) return;
          if (slot.queue.some((q) => q.seq === seq)) return;
          slot.queue.push({ seq, input: decodeInput(wire), st });
        };
        // 落ちたパケットの穴を、相乗りしてきた履歴で埋める
        message.hist?.forEach((wire, i) => add(message.seq - (i + 1), wire, message.st - (i + 1)));
        add(message.seq, message.in, message.st);
        slot.received = Math.max(slot.received, message.seq);
        slot.queue.sort((a, b) => a.seq - b.seq);
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
    if (!this.slots[0].connected || !this.slots[1].connected) return;
    if (!this.slots[0].ready || !this.slots[1].ready) return;
    this.start();
  }

  start(seed = this.seed ?? Math.floor(Math.random() * 0xffffffff)) {
    this.started = true;
    this.tick = 0;
    // 開幕サーブは交互（揃えると上下の勝率が偏ることを実測で確認している）
    const firstServe: Side = seed % 2 === 0 ? 0 : 1;
    this.engine = this.newEngine(seed, firstServe);
    // 開始前に届いていた入力は捨てる。持ち越すとその分だけサーバーが遅れ、
    // クライアントは常に先を予測し続けることになる
    for (const id of [0, 1] as Side[]) {
      const slot = this.slots[id];
      slot.queue = [];
      slot.primed = false;
      slot.seq = 0;
      slot.input = emptyInput();
    }
    this.broadcast({ t: "start", seed, config: this.config, tick: this.tick, firstServe });
    this.sendSnapshot();
  }

  private broadcast(message: ServerMessage) {
    for (const id of [0, 1] as Side[]) {
      if (this.slots[id].connected) this.hooks.send(id, message);
    }
  }

  // ---------------------------------------------------------------- 更新

  update(dt: number) {
    this.elapsed += dt;
    if (this.finished) {
      this.resendFinish(dt);
      return;
    }
    if (!this.started) return;

    // 相手が落ちている間は試合を止めて待つ
    if (!this.slots[0].connected || !this.slots[1].connected) {
      const lost = ([0, 1] as Side[]).find((id) => !this.slots[id].connected);
      if (lost === undefined) return;
      const lostAt = this.slots[lost].lostAt ?? this.elapsed;
      if (this.elapsed - lostAt > DISCONNECT_FORFEIT) this.finish(this.other(lost));
      return;
    }

    this.accumulator += dt;
    let steps = 0;
    while (this.accumulator >= DT && steps < 8) {
      this.engine.step([this.consumeInput(0), this.consumeInput(1)]);
      this.accumulator -= DT;
      this.tick += 1;
      steps += 1;
      if (this.engine.phase === "gameOver" && !this.finished) {
        this.finish(this.engine.winner);
      }
      // 協力はステージをクリアしたら自動で次へ進める（片方が押さないと進まない形にしない）
      if (this.engine.phase === "stageClear") {
        this.engine.nextStage();
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
   *
   * 1ティックにつき必ず1つだけ消費する。「溜まったぶんを飛ばして追いつく」処理を入れると、
   * 飛ばした入力のぶんだけクライアントの予測とズレる。
   */
  private consumeInput(player: Side): PlayerInput {
    const slot = this.slots[player];
    // 到着のゆらぎを吸収するため、少し溜まってから消費を始める
    if (!slot.primed) {
      if (slot.queue.length >= INPUT_BUFFER) slot.primed = true;
      else {
        slot.starved += 1;
        return this.repeat(slot);
      }
    }
    const next = slot.queue.shift();
    if (next) {
      slot.input = next.input;
      slot.seq = next.seq;
      // ラグ補償：押した時点のサーバーティックとの差を、技の判定に渡す
      const age = Math.max(0, Math.min(MAX_LAG_COMPENSATION, this.tick - next.st));
      slot.input.pressAge = age;
      if (slot.input.fire) this.lagSamples.push(age);
    } else {
      slot.starved += 1;
      slot.primed = false;
      return this.repeat(slot);
    }
    return slot.input;
  }

  /**
   * 入力が間に合わなかったときは直前の入力を繰り返す。
   * ただし fire は繰り返さない——押しっぱなし扱いになると技が二重に出る。
   */
  private repeat(slot: Slot): PlayerInput {
    slot.input.fire = false;
    slot.input.pressAge = 0;
    return slot.input;
  }

  starvation(player: Side): number {
    return this.slots[player].starved;
  }

  private sendSnapshot() {
    const snap = captureSnapshot(this.engine, this.tick, [this.slots[0].seq, this.slots[1].seq]);
    this.broadcast({ t: "snap", s: snap });
  }

  private finish(winner: Side | null) {
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
}
