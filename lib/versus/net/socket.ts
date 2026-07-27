import type { ClientMessage, ServerMessage } from "./protocol";

export type ConnectionState = "connecting" | "open" | "reconnecting" | "closed" | "error";

export interface SocketOptions {
  url: string;
  room: string;
  onMessage: (message: ServerMessage) => void;
  onState?: (state: ConnectionState, detail?: string) => void;
}

/**
 * WebSocket 越しの接続。
 * 通信が切れても自動で繋ぎ直し、繋がるまでの送信は捨てずに保持する
 * （入力は毎フレーム送り直されるので、溜め込むのは制御メッセージだけでよい）。
 */
export class VersusSocket {
  private socket: WebSocket | null = null;
  private options: SocketOptions;
  private closedByUser = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryDelay = 500;
  private pendingControl: ClientMessage[] = [];

  state: ConnectionState = "connecting";

  constructor(options: SocketOptions) {
    this.options = options;
    this.connect();
  }

  private setState(state: ConnectionState, detail?: string) {
    this.state = state;
    this.options.onState?.(state, detail);
  }

  private connect() {
    if (this.closedByUser) return;
    try {
      const url = new URL(this.options.url);
      url.searchParams.set("room", this.options.room);
      const socket = new WebSocket(url.toString());
      this.socket = socket;
      this.setState(this.retryDelay > 500 ? "reconnecting" : "connecting");

      socket.onopen = () => {
        this.retryDelay = 500;
        this.setState("open");
        const queued = this.pendingControl;
        this.pendingControl = [];
        for (const message of queued) this.send(message);
      };
      socket.onmessage = (event) => {
        try {
          this.options.onMessage(JSON.parse(String(event.data)) as ServerMessage);
        } catch {
          // 壊れたメッセージは無視する
        }
      };
      socket.onclose = () => {
        this.socket = null;
        if (this.closedByUser) {
          this.setState("closed");
          return;
        }
        this.scheduleRetry();
      };
      socket.onerror = () => {
        this.setState("error", "接続に失敗しました");
      };
    } catch {
      this.scheduleRetry();
    }
  }

  private scheduleRetry() {
    if (this.closedByUser || this.retryTimer) return;
    this.setState("reconnecting");
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.retryDelay = Math.min(5000, this.retryDelay * 1.8);
      this.connect();
    }, this.retryDelay);
  }

  send(message: ClientMessage) {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(message));
      return;
    }
    // 入力は次のフレームで送り直されるので、溜めるのは制御メッセージだけ
    if (message.t !== "input" && message.t !== "ping") {
      this.pendingControl.push(message);
      if (this.pendingControl.length > 8) this.pendingControl.shift();
    }
  }

  close() {
    this.closedByUser = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.socket?.close();
    this.socket = null;
    this.setState("closed");
  }
}
