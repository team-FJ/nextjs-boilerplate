export interface InputState {
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
  fire: boolean;
  bomb: boolean;
  /** マウス／タッチ操作時の目標座標（論理座標）。null ならキーボード操作 */
  pointer: { x: number; y: number } | null;
  pointerActive: boolean;
}

const KEY_MAP: Record<string, keyof InputState> = {
  ArrowLeft: "left",
  KeyA: "left",
  ArrowRight: "right",
  KeyD: "right",
  ArrowUp: "up",
  KeyW: "up",
  ArrowDown: "down",
  KeyS: "down",
  Space: "fire",
  KeyZ: "fire",
  KeyJ: "fire",
  KeyX: "bomb",
  KeyK: "bomb",
  ShiftLeft: "bomb",
};

export class InputManager {
  readonly state: InputState = {
    left: false,
    right: false,
    up: false,
    down: false,
    fire: false,
    bomb: false,
    pointer: null,
    pointerActive: false,
  };

  private pressedThisFrame = new Set<string>();
  private listeners: Array<() => void> = [];

  attach(
    canvas: HTMLCanvasElement,
    toLogical: (cx: number, cy: number) => { x: number; y: number },
    hooks: { onPause?: () => void } = {},
  ) {
    const keyDown = (e: KeyboardEvent) => {
      const mapped = KEY_MAP[e.code];
      if (mapped) {
        e.preventDefault();
        (this.state[mapped] as boolean) = true;
        this.pressedThisFrame.add(e.code);
      }
      if (e.code === "Escape" || e.code === "KeyP") {
        e.preventDefault();
        hooks.onPause?.();
      }
    };
    const keyUp = (e: KeyboardEvent) => {
      const mapped = KEY_MAP[e.code];
      if (mapped) {
        e.preventDefault();
        (this.state[mapped] as boolean) = false;
      }
    };
    const blur = () => {
      this.state.left = this.state.right = this.state.up = this.state.down = false;
      this.state.fire = this.state.bomb = false;
      this.state.pointerActive = false;
    };

    const move = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      this.state.pointer = toLogical(e.clientX - rect.left, e.clientY - rect.top);
    };
    const down = (e: PointerEvent) => {
      canvas.setPointerCapture?.(e.pointerId);
      move(e);
      this.state.pointerActive = true;
      this.state.fire = true;
    };
    const up = (e: PointerEvent) => {
      canvas.releasePointerCapture?.(e.pointerId);
      this.state.pointerActive = false;
      this.state.fire = false;
    };

    window.addEventListener("keydown", keyDown);
    window.addEventListener("keyup", keyUp);
    window.addEventListener("blur", blur);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());

    this.listeners = [
      () => window.removeEventListener("keydown", keyDown),
      () => window.removeEventListener("keyup", keyUp),
      () => window.removeEventListener("blur", blur),
      () => canvas.removeEventListener("pointermove", move),
      () => canvas.removeEventListener("pointerdown", down),
      () => canvas.removeEventListener("pointerup", up),
      () => canvas.removeEventListener("pointercancel", up),
    ];
  }

  /** タッチ用の仮想ボタン等から直接叩く */
  setVirtual(key: "left" | "right" | "up" | "down" | "fire" | "bomb", value: boolean) {
    this.state[key] = value;
  }

  consumePressed(code: string) {
    if (this.pressedThisFrame.has(code)) {
      this.pressedThisFrame.delete(code);
      return true;
    }
    return false;
  }

  endFrame() {
    this.pressedThisFrame.clear();
  }

  detach() {
    this.listeners.forEach((off) => off());
    this.listeners = [];
  }
}
