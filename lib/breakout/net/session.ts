import {
  PeerTransport,
  TabTransport,
  type Transport,
  type TransportKind,
  type TransportState,
} from "../../versus/net/transport";
import type { Difficulty } from "../types";
import { BreakoutClient } from "./client";
import { BreakoutRoom } from "./room";
import type { ClientMessage, ServerMessage } from "./protocol";

/** 部屋の名前空間。INVADER と混線しないよう作品ごとに変える */
const TAB_PREFIX = "spinrally-versus";
const PEER_PREFIX = "spinrally-net";

export interface NetSession {
  client: BreakoutClient;
  role: "host" | "guest";
  state: TransportState;
  /** 毎フレーム呼ぶ。進行役なら権威サーバーもここで進む */
  update(dt: number): void;
  close(): void;
}

export interface SessionOptions {
  room: string;
  role: "host" | "guest";
  kind: TransportKind;
  difficulty: Difficulty;
  /** 対戦か協力か。決めるのは進行役だけで、参加側はサーバーの設定に従う */
  mode?: "versus" | "coop";
  /** 1人・協力の軽い重力 */
  gravity?: boolean;
  onState?: (state: TransportState, detail?: string) => void;
  now?: () => number;
}

function makeTransport(
  kind: TransportKind,
  room: string,
  role: "host" | "guest",
  hooks: { onMessage: (m: unknown) => void; onState?: (s: TransportState, d?: string) => void },
): Transport {
  if (kind === "tab") return new TabTransport(room, role, hooks, TAB_PREFIX);
  // WebSocket 経由は静的配信では使えないので、いまは P2P と別タブだけ
  return new PeerTransport(room, role, hooks, PEER_PREFIX);
}

/**
 * 進行役（ホスト）の側。**自分の端末のブラウザの中で権威サーバーを動かす**ので、
 * サーバーを一切用意せずに2台対戦が成立する。進行役は遅延ゼロ、参加側だけが片道の遅延を負う。
 */
export function createHostSession(options: SessionOptions): NetSession {
  /**
   * トランスポートは構築の途中で同期的に onState を呼ぶことがある（別タブ方式）。
   * その時点ではまだ session が定義されていないので、状態は別の入れ物に持つ。
   */
  const holder: { state: TransportState } = { state: "connecting" };
  let guestSeated = false;

  const client = new BreakoutClient({
    send: (message) => room.receive(0, message),
    now: options.now,
  });

  const transport = makeTransport(options.kind, options.room, "host", {
    onMessage: (raw) => {
      const message = raw as ClientMessage;
      if (!guestSeated) {
        // 参加者は最初のメッセージが届いた時点で席に着かせる
        guestSeated = room.connect() !== null;
      }
      room.receive(1, message);
    },
    onState: (s, detail) => {
      holder.state = s;
      options.onState?.(s, detail);
    },
  });

  const room = new BreakoutRoom(
    options.room,
    {
      send: (player, message: ServerMessage) => {
        if (player === 0) client.receive(message);
        else transport.send(message);
      },
    },
    { difficulty: options.difficulty, mode: options.mode ?? "versus", gravity: options.gravity },
  );
  room.connect(); // 進行役が下側（side 0）に座る
  client.join(options.room);

  return {
    client,
    role: "host",
    get state() {
      return holder.state;
    },
    update: (dt) => room.update(dt),
    close: () => transport.close(),
  };
}

/** 参加者（ゲスト）の側。入力を送り、返ってくるスナップショットに従う */
export function createGuestSession(options: SessionOptions): NetSession {
  const holder: { state: TransportState } = { state: "connecting" };
  const client = new BreakoutClient({
    send: (message: ClientMessage) => transport.send(message),
    now: options.now,
  });

  const transport = makeTransport(options.kind, options.room, "guest", {
    onMessage: (raw) => client.receive(raw as ServerMessage),
    onState: (s, detail) => {
      holder.state = s;
      options.onState?.(s, detail);
    },
  });

  // 入室は transport を組み立てたあとに送る。
  // onState の中から送ると、まだ transport が代入されていない瞬間に呼ばれて落ちる
  // （別タブ方式は構築中に同期で onState("open") を呼ぶ）。
  // 繋がる前の送信は transport 側で溜められ、届かなければクライアントが再送する。
  client.join(options.room);

  return {
    client,
    role: "guest",
    get state() {
      return holder.state;
    },
    update: () => {},
    close: () => transport.close(),
  };
}

/** 部屋コード。紛らわしい文字（0/O、1/I）は外す */
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function makeRoomCode(): string {
  let out = "";
  for (let i = 0; i < 6; i++) {
    out += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return out;
}

export function normalizeRoomCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
}
