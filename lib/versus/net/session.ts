import type { FighterInput, VersusConfig } from "../types";
import { NetClient } from "./client";
import { HostSession } from "./host";
import type { ClientMessage, ServerMessage } from "./protocol";
import { VersusSocket } from "./socket";
import {
  PeerTransport,
  TabTransport,
  type Transport,
  type TransportKind,
  type TransportState,
} from "./transport";

export type SessionRole = "host" | "guest";

export interface SessionOptions {
  role: SessionRole;
  room: string;
  kind: TransportKind;
  /** websocket 方式のときの接続先 */
  serverUrl?: string;
  config?: Partial<VersusConfig>;
  onServerMessage: (message: ServerMessage) => void;
  onState: (state: TransportState, detail?: string) => void;
}

/**
 * 通信対戦の1回ぶんの接続。
 *
 * ホスト方式（p2p / tab）では、この端末の中でサーバー（HostSession）も動かす。
 * サーバー方式（websocket）では、両者ともただのクライアントになる。
 * UI からはどちらも同じ形で扱えるようにしてある。
 */
export class VersusSession {
  readonly role: SessionRole;
  readonly kind: TransportKind;
  readonly room: string;
  readonly client: NetClient;
  readonly host: HostSession | null = null;

  private transport: Transport | null = null;
  private socket: VersusSocket | null = null;
  private closed = false;

  constructor(options: SessionOptions) {
    this.role = options.role;
    this.kind = options.kind;
    this.room = options.room;
    const now = () => performance.now();

    // 受け取ったサーバーメッセージをクライアントと UI へ流す
    const handleServer = (message: ServerMessage) => {
      this.client.handle(message, now());
      options.onServerMessage(message);
    };

    if (options.kind === "websocket") {
      // 従来どおり、外部のゲームサーバーに両者がつなぐ
      this.client = new NetClient({ send: (message) => this.socket?.send(message) });
      this.socket = new VersusSocket({
        url: options.serverUrl ?? "",
        room: options.room,
        onState: (state, detail) => {
          const mapped: TransportState =
            state === "open" ? "open" : state === "error" ? "error" : state === "closed" ? "closed" : "connecting";
          options.onState(mapped, detail);
        },
        onMessage: handleServer,
      });
      return;
    }

    // ここから先はホスト方式（この端末、または相手の端末がサーバーを兼ねる）
    const makeTransport = (hooks: {
      onMessage: (message: unknown) => void;
      onState: (state: TransportState, detail?: string) => void;
    }): Transport =>
      options.kind === "tab"
        ? new TabTransport(options.room, options.role, hooks)
        : new PeerTransport(options.room, options.role, hooks);

    if (options.role === "host") {
      this.client = new NetClient({ send: (message) => this.host?.receiveFromLocal(message) });
      this.host = new HostSession(options.room, {
        sendToGuest: (message) => this.transport?.send(message),
        sendToLocal: handleServer,
        config: options.config,
      });
      this.transport = makeTransport({
        onMessage: (message) => this.host?.receiveFromGuest(message as ClientMessage),
        onState: (state, detail) => {
          if (state === "closed" || state === "error") this.host?.disconnectGuest();
          options.onState(state, detail);
        },
      });
    } else {
      this.client = new NetClient({ send: (message) => this.transport?.send(message) });
      this.transport = makeTransport({
        onMessage: (message) => handleServer(message as ServerMessage),
        onState: options.onState,
      });
    }
  }

  /** 毎フレーム呼ぶ。ホストならサーバー側の時間も進める */
  update(dt: number, input: FighterInput, now: number) {
    if (this.closed) return;
    this.client.update(dt, input, now);
    this.host?.update(dt);
  }

  join(name?: string) {
    this.client.join(this.room, name);
  }

  setReady(ready: boolean) {
    this.client.setReady(ready);
  }

  setConfig(config: Partial<VersusConfig>) {
    this.client.setConfig(config);
  }

  close() {
    this.closed = true;
    this.client.leave();
    this.transport?.close();
    this.socket?.close();
    this.transport = null;
    this.socket = null;
  }
}
