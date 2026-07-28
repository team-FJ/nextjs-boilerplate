"use client";

import type { InputManager } from "@/lib/game/input";

type Key = "left" | "right" | "up" | "down" | "fire" | "bomb";

export function TouchControls({ input }: { input: InputManager }) {
  const bind = (key: Key) => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault();
      input.setVirtual(key, true);
    },
    onPointerUp: (e: React.PointerEvent) => {
      e.preventDefault();
      input.setVirtual(key, false);
    },
    onPointerLeave: () => input.setVirtual(key, false),
    onPointerCancel: () => input.setVirtual(key, false),
  });

  const pad =
    "flex h-14 w-14 select-none items-center justify-center rounded-xl border border-white/25 bg-white/10 text-lg font-bold text-white/80 active:bg-cyan-400/40";

  return (
    <div className="mt-3 flex w-full max-w-md touch-none items-center justify-between px-4 sm:hidden">
      <div className="grid grid-cols-3 grid-rows-3 gap-1">
        <span />
        <button className={pad} {...bind("up")}>
          ▲
        </button>
        <span />
        <button className={pad} {...bind("left")}>
          ◀
        </button>
        <span />
        <button className={pad} {...bind("right")}>
          ▶
        </button>
        <span />
        <button className={pad} {...bind("down")}>
          ▼
        </button>
        <span />
      </div>
      <div className="flex flex-col gap-2">
        <button className={`${pad} h-16 w-16 border-cyan-300/50 bg-cyan-400/20`} {...bind("fire")}>
          SHOT
        </button>
        <button className={`${pad} h-14 w-16 border-amber-300/50 bg-amber-400/20 text-sm`} {...bind("bomb")}>
          BOMB
        </button>
      </div>
    </div>
  );
}
