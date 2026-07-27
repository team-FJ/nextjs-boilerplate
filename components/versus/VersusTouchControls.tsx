"use client";

import type { VersusInput } from "@/lib/versus/input";
import type { FighterInput, PlayerId } from "@/lib/versus/types";

type Action = keyof FighterInput;

/** モバイル用の簡易パッド（対人戦では上下2セット表示する） */
export function VersusTouchControls({
  input,
  players,
}: {
  input: VersusInput;
  players: PlayerId[];
}) {
  const bind = (player: PlayerId, action: Action) => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault();
      input.setVirtual(player, action, true);
    },
    onPointerUp: (e: React.PointerEvent) => {
      e.preventDefault();
      input.setVirtual(player, action, false);
    },
    onPointerLeave: () => input.setVirtual(player, action, false),
    onPointerCancel: () => input.setVirtual(player, action, false),
  });

  const pad =
    "flex h-12 w-12 select-none items-center justify-center rounded-lg border border-white/25 bg-white/10 text-base font-bold text-white/80 active:bg-cyan-400/40";

  return (
    <div className="mt-2 flex w-full max-w-md flex-col gap-2 sm:hidden">
      {players.map((p) => (
        <div key={p} className="flex touch-none items-center justify-between px-3">
          <div className="grid grid-cols-3 grid-rows-3 gap-1">
            <span />
            <button className={pad} {...bind(p, "up")}>
              ▲
            </button>
            <span />
            <button className={pad} {...bind(p, "left")}>
              ◀
            </button>
            <span />
            <button className={pad} {...bind(p, "right")}>
              ▶
            </button>
            <span />
            <button className={pad} {...bind(p, "down")}>
              ▼
            </button>
            <span />
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-center font-mono text-[9px] text-white/40">P{p}</span>
            <button className={`${pad} h-14 w-14 border-cyan-300/50 bg-cyan-400/20 text-xs`} {...bind(p, "fire")}>
              SHOT
            </button>
            <button className={`${pad} h-10 w-14 border-pink-300/50 bg-pink-400/20 text-xs`} {...bind(p, "special")}>
              BOMB
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
