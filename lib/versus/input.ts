import { EMPTY_INPUT, type FighterInput, type PlayerId } from "./types";

type Action = keyof FighterInput;

/** P1（下側）：矢印キー + WASD、ショット SPACE/Z、ボム SHIFT */
const P1_KEYS: Record<string, Action> = {
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "up",
  ArrowDown: "down",
  KeyA: "left",
  KeyD: "right",
  KeyW: "up",
  KeyS: "down",
  Space: "fire",
  KeyZ: "fire",
  ShiftRight: "special",
  Slash: "special",
};

/** P1（対人戦時）：矢印キーのみ。WASD は P2 に譲る */
const P1_KEYS_LOCAL: Record<string, Action> = {
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "up",
  ArrowDown: "down",
  Space: "fire",
  Enter: "fire",
  ShiftRight: "special",
  Slash: "special",
};

/** P2（上側・対人戦）：WASD、ショット F、ボム G */
const P2_KEYS: Record<string, Action> = {
  KeyA: "left",
  KeyD: "right",
  KeyW: "up",
  KeyS: "down",
  KeyF: "fire",
  KeyQ: "fire",
  KeyG: "special",
  KeyE: "special",
};

export class VersusInput {
  private p1: FighterInput = { ...EMPTY_INPUT };
  private p2: FighterInput = { ...EMPTY_INPUT };
  private cleanup: Array<() => void> = [];
  private local = false;

  /** 対人戦かどうかでキー割り当てを切り替える */
  setLocalMode(local: boolean) {
    this.local = local;
    this.p1 = { ...EMPTY_INPUT };
    this.p2 = { ...EMPTY_INPUT };
  }

  attach(hooks: { onPause?: () => void } = {}) {
    const apply = (code: string, value: boolean) => {
      const map1 = this.local ? P1_KEYS_LOCAL : P1_KEYS;
      const a1 = map1[code];
      if (a1) {
        (this.p1[a1] as boolean) = value;
        return true;
      }
      if (this.local) {
        const a2 = P2_KEYS[code];
        if (a2) {
          (this.p2[a2] as boolean) = value;
          return true;
        }
      }
      return false;
    };

    const keyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (apply(e.code, true)) e.preventDefault();
      if (e.code === "Escape" || e.code === "KeyP") {
        e.preventDefault();
        hooks.onPause?.();
      }
    };
    const keyUp = (e: KeyboardEvent) => {
      if (apply(e.code, false)) e.preventDefault();
    };
    const blur = () => {
      this.p1 = { ...EMPTY_INPUT };
      this.p2 = { ...EMPTY_INPUT };
    };

    window.addEventListener("keydown", keyDown);
    window.addEventListener("keyup", keyUp);
    window.addEventListener("blur", blur);
    this.cleanup = [
      () => window.removeEventListener("keydown", keyDown),
      () => window.removeEventListener("keyup", keyUp),
      () => window.removeEventListener("blur", blur),
    ];
  }

  /** タッチ操作用 */
  setVirtual(player: PlayerId, action: Action, value: boolean) {
    const target = player === 1 ? this.p1 : this.p2;
    (target[action] as boolean) = value;
  }

  get(player: PlayerId): FighterInput {
    return player === 1 ? this.p1 : this.p2;
  }

  detach() {
    this.cleanup.forEach((off) => off());
    this.cleanup = [];
  }
}
