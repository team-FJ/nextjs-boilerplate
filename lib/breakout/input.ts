import { isTypingTarget } from "../shared/keyboard";
import type { PlayerInput } from "./types";
import { emptyInput } from "./types";

type Key = "left" | "right" | "up" | "down" | "fire";

/** 1台で2人が遊ぶときのキー割り当て。P1 は WASD、P2 は矢印キー */
const P1_KEYS: Record<string, Key> = {
  KeyA: "left",
  KeyD: "right",
  KeyW: "up",
  KeyS: "down",
  Space: "fire",
  KeyZ: "fire",
};

const P2_KEYS: Record<string, Key> = {
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "up",
  ArrowDown: "down",
  Enter: "fire",
  ShiftRight: "fire",
  NumpadEnter: "fire",
};

/** 1人で遊ぶときは両方のキーを受け付ける */
const SINGLE_KEYS: Record<string, Key> = { ...P1_KEYS, ...P2_KEYS };

/**
 * 入力管理。
 *
 * 注意：
 * - 文字入力欄へ向けられたキーは横取りしない（部屋コードが打てなくなる）
 * - ショットは押した瞬間だけを見るので、ここでは押下状態を持つだけにする
 * - **返す PlayerInput は毎フレーム同じオブジェクト**。巻き戻しの履歴に積むときは必ず複製すること
 */
export class BreakoutInput {
  readonly players: PlayerInput[];
  private keyState: Array<Record<Key, boolean>>;
  private virtual: Array<Partial<Record<Key, boolean>>>;
  private analog: Array<{ x: number; y: number } | null>;
  private maps: Array<Record<string, Key>>;
  private detachers: Array<() => void> = [];

  constructor(playerCount: number, split: boolean) {
    this.players = Array.from({ length: playerCount }, () => emptyInput());
    this.keyState = Array.from({ length: playerCount }, () => ({
      left: false,
      right: false,
      up: false,
      down: false,
      fire: false,
    }));
    this.virtual = Array.from({ length: playerCount }, () => ({}));
    this.analog = Array.from({ length: playerCount }, () => null);
    this.maps = split ? [P1_KEYS, P2_KEYS] : [SINGLE_KEYS, P2_KEYS];
  }

  attach(onPause?: () => void) {
    const onKey = (e: KeyboardEvent, down: boolean) => {
      // 文字入力欄に向けられたキーはゲーム操作として横取りしない
      if (isTypingTarget(e.target)) return;
      let handled = false;
      for (let i = 0; i < this.keyState.length; i++) {
        const key = this.maps[i]?.[e.code];
        if (key) {
          this.keyState[i][key] = down;
          handled = true;
        }
      }
      if (handled) e.preventDefault();
      if (down && (e.code === "Escape" || e.code === "KeyP")) {
        e.preventDefault();
        onPause?.();
      }
    };
    const down = (e: KeyboardEvent) => onKey(e, true);
    const up = (e: KeyboardEvent) => onKey(e, false);
    const blur = () => this.releaseAll();

    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    this.detachers = [
      () => window.removeEventListener("keydown", down),
      () => window.removeEventListener("keyup", up),
      () => window.removeEventListener("blur", blur),
    ];
  }

  detach() {
    this.detachers.forEach((off) => off());
    this.detachers = [];
  }

  releaseAll() {
    for (const s of this.keyState) {
      s.left = s.right = s.up = s.down = s.fire = false;
    }
    this.virtual = this.virtual.map(() => ({}));
    this.analog = this.analog.map(() => null);
  }

  /** タッチパッドなどから直接叩く */
  setVirtual(player: number, key: Key, value: boolean) {
    const v = this.virtual[player];
    if (v) v[key] = value;
  }

  /**
   * スティックの生ベクトルを渡す。技の打ち出し角 θ を連続値で取るために使う。
   * 移動は 8 方向に量子化した setVirtual 側を使うので、こちらは技の判定専用。
   */
  setAnalog(player: number, vec: { x: number; y: number } | null) {
    this.analog[player] = vec;
  }

  /** 今フレームの入力を組み立てて返す（同じオブジェクトを再利用する点に注意） */
  read(): PlayerInput[] {
    for (let i = 0; i < this.players.length; i++) {
      const out = this.players[i];
      const keys = this.keyState[i];
      const virtual = this.virtual[i] ?? {};
      out.left = keys.left || virtual.left === true;
      out.right = keys.right || virtual.right === true;
      out.up = keys.up || virtual.up === true;
      out.down = keys.down || virtual.down === true;
      out.fire = keys.fire || virtual.fire === true;
      out.analog = this.analog[i];
    }
    return this.players;
  }
}
