/**
 * 2台の端末をつなぐ経路。中身はメッセージを届けるだけで、
 * ゲームのルールには一切関与しない。
 *
 * - p2p   … WebRTC の直結（PeerJS の無料シグナリングを使用）。サーバー不要
 * - websocket … 自前のゲームサーバー経由（安定。置き場所が必要）
 * - tab   … 同じブラウザの別タブ（動作確認用）
 */

export type TransportKind = "p2p" | "websocket" | "tab";
export type TransportState = "connecting" | "open" | "closed" | "error";

export interface TransportHooks {
  onMessage: (message: unknown) => void;
  onState?: (state: TransportState, detail?: string) => void;
}

export interface Transport {
  readonly kind: TransportKind;
  send(message: unknown): void;
  close(): void;
}

/**
 * 同じブラウザの別タブ同士をつなぐ経路。
 * 実機2台を用意しなくても、ホスト役とゲスト役の流れを確認できる。
 */
export class TabTransport implements Transport {
  readonly kind = "tab" as const;
  private channel: BroadcastChannel;
  private me: "host" | "guest";

  /** prefix は作品ごとに変える。同じ名前だと別ゲームの部屋と混線する */
  constructor(
    room: string,
    role: "host" | "guest",
    hooks: TransportHooks,
    prefix = "invader-versus",
  ) {
    this.me = role;
    this.channel = new BroadcastChannel(`${prefix}-${room}`);
    this.channel.onmessage = (event: MessageEvent) => {
      const data = event.data as { from: string; payload: unknown } | null;
      // 自分が送ったものは無視する
      if (!data || data.from === this.me) return;
      hooks.onMessage(data.payload);
    };
    // BroadcastChannel は相手の有無を知る術がないので、開通扱いにする
    hooks.onState?.("open");
  }

  send(message: unknown) {
    this.channel.postMessage({ from: this.me, payload: message });
  }

  close() {
    this.channel.close();
  }
}

/**
 * WebRTC による直結。シグナリング（接続の顔合わせ）だけ PeerJS の
 * 無料サーバーを借り、つながった後のやり取りは端末同士で直接行う。
 */
export class PeerTransport implements Transport {
  readonly kind = "p2p" as const;
  private peer: { destroy: () => void } | null = null;
  private connection: { send: (data: unknown) => void; close: () => void } | null = null;
  private queue: unknown[] = [];
  private closed = false;

  /** prefix は作品ごとに変える。PeerJS の ID は世界中で共有されるため、衝突すると繋がらない */
  constructor(
    room: string,
    role: "host" | "guest",
    hooks: TransportHooks,
    prefix = "invader-assault",
  ) {
    hooks.onState?.("connecting");
    void this.setup(room, role, hooks, prefix);
  }

  private async setup(
    room: string,
    role: "host" | "guest",
    hooks: TransportHooks,
    prefix: string,
  ) {
    try {
      const { default: Peer } = await import("peerjs");
      if (this.closed) return;

      // 部屋コードから相手の ID を決められるようにしておく
      const hostId = `${prefix}-${room.toLowerCase()}`;
      const peer = role === "host" ? new Peer(hostId) : new Peer();
      this.peer = peer;

      const attach = (conn: {
        on: (event: string, handler: (arg?: unknown) => void) => void;
        send: (data: unknown) => void;
        close: () => void;
      }) => {
        this.connection = conn;
        conn.on("open", () => {
          hooks.onState?.("open");
          const queued = this.queue;
          this.queue = [];
          for (const message of queued) conn.send(message);
        });
        conn.on("data", (data) => hooks.onMessage(data));
        conn.on("close", () => {
          this.connection = null;
          if (!this.closed) hooks.onState?.("closed", "相手との接続が切れました");
        });
        conn.on("error", () => hooks.onState?.("error", "接続エラーが発生しました"));
      };

      peer.on("error", (error: { type?: string }) => {
        const type = error?.type;
        if (type === "peer-unavailable") {
          hooks.onState?.("error", "その部屋が見つかりません。コードを確認してください");
        } else if (type === "unavailable-id") {
          hooks.onState?.("error", "この部屋コードは使用中です。作り直してください");
        } else if (type === "network" || type === "server-error" || type === "socket-error") {
          hooks.onState?.("error", "接続サービスに繋がりません。時間を置いて試してください");
        } else {
          hooks.onState?.("error", "接続に失敗しました");
        }
      });

      if (role === "host") {
        peer.on("connection", (conn) => attach(conn as never));
      } else {
        peer.on("open", () => {
          if (this.closed) return;
          attach(peer.connect(hostId, { serialization: "json" }) as never);
        });
      }
    } catch {
      hooks.onState?.("error", "接続の準備に失敗しました");
    }
  }

  send(message: unknown) {
    if (this.connection) this.connection.send(message);
    // つながる前の制御メッセージは溜めておく（入力は毎フレーム送り直されるので捨ててよい）
    else if (this.queue.length < 16) this.queue.push(message);
  }

  close() {
    this.closed = true;
    this.connection?.close();
    this.peer?.destroy();
    this.connection = null;
    this.peer = null;
  }
}
