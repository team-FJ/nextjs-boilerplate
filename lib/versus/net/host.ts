import type { VersusConfig } from "../types";
import type { ClientMessage, ServerMessage } from "./protocol";
import { GameRoom } from "./room";

export interface HostOptions {
  /** ゲスト（相手の端末）へ送る */
  sendToGuest: (message: ServerMessage) => void;
  /** ホスト自身のクライアントへ渡す */
  sendToLocal: (message: ServerMessage) => void;
  config?: Partial<VersusConfig>;
  seed?: number;
}

/**
 * 片方の端末のブラウザの中でゲームサーバーを動かす仕組み。
 *
 * GameRoom は通信手段に依存しない作りなので、そのままここへ持ち込める。
 * ホスト自身の入力は経路を通さず直接渡すため、ホスト側は遅延ゼロで遊べる。
 * （その分ゲスト側は片道の遅延を負うが、予測と補間で体感は吸収される）
 */
export class HostSession {
  readonly room: GameRoom;
  /** ゲストが座っている枠。未接続なら null */
  private guestSlot: 1 | 2 | null = null;

  constructor(roomCode: string, options: HostOptions) {
    this.room = new GameRoom(
      roomCode,
      {
        send: (player, message) => {
          if (player === 1) options.sendToLocal(message);
          else options.sendToGuest(message);
        },
      },
      { seed: options.seed },
    );
    if (options.config) this.room.config = { ...this.room.config, ...options.config, mode: "local" };
    // ホストは常に 1 番の枠に座る
    this.room.connect();
  }

  get guestConnected(): boolean {
    return this.guestSlot !== null;
  }

  receiveFromLocal(message: ClientMessage) {
    this.room.receive(1, message);
  }

  receiveFromGuest(message: ClientMessage) {
    // 最初のメッセージが来た時点でゲストを着席させる
    if (this.guestSlot === null) {
      const slot = this.room.connect();
      if (slot === null) return;
      this.guestSlot = slot;
    }
    this.room.receive(this.guestSlot, message);
  }

  disconnectGuest() {
    if (this.guestSlot === null) return;
    this.room.disconnect(this.guestSlot);
    this.guestSlot = null;
  }

  update(dt: number) {
    this.room.update(dt);
  }
}
