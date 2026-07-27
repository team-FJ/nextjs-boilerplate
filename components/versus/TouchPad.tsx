"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { VersusInput } from "@/lib/versus/input";
import type { PlayerId } from "@/lib/versus/types";

interface StickState {
  pointerId: number;
  originX: number;
  originY: number;
  x: number;
  y: number;
}

const DEAD_ZONE = 10;
const MAX_RADIUS = 46;

/**
 * スマホ向けの操作パッド。
 *
 * 左側は「押した場所が原点になる」バーチャルスティック。小さなボタンを狙う必要がなく、
 * 親指を置いた場所から引っ張るだけで動かせる。入力は 8 方向に量子化して
 * 既存の入力モデル（6ビットのマスク）に載せているため、通信対戦の予測処理はそのまま使える。
 *
 * 右側はショットとボム。ショットボタンの外周がエネルギー残量を示すので、
 * 「あと何発撃てるか」を画面下だけ見て把握できる。
 */
export function TouchPad({
  input,
  player = 1,
  energyRatio = 1,
  bombs = 0,
  onFullscreen,
}: {
  input: VersusInput;
  player?: PlayerId;
  energyRatio?: number;
  bombs?: number;
  onFullscreen?: () => void;
}) {
  const [stick, setStick] = useState<StickState | null>(null);
  const [firing, setFiring] = useState(false);
  const stickRef = useRef<StickState | null>(null);

  const clearDirections = useCallback(() => {
    input.setVirtual(player, "left", false);
    input.setVirtual(player, "right", false);
    input.setVirtual(player, "up", false);
    input.setVirtual(player, "down", false);
  }, [input, player]);

  const applyStick = useCallback(
    (dx: number, dy: number) => {
      const distance = Math.hypot(dx, dy);
      if (distance < DEAD_ZONE) {
        clearDirections();
        return;
      }
      // 8方向に量子化する（真上・真横も出しやすいように境界を広めに取る）
      const angle = Math.atan2(dy, dx);
      const octant = Math.round(angle / (Math.PI / 4));
      const table: Record<number, [number, number]> = {
        [-4]: [-1, 0],
        [-3]: [-1, -1],
        [-2]: [0, -1],
        [-1]: [1, -1],
        [0]: [1, 0],
        [1]: [1, 1],
        [2]: [0, 1],
        [3]: [-1, 1],
        [4]: [-1, 0],
      };
      const [ax, ay] = table[octant] ?? [0, 0];
      input.setVirtual(player, "left", ax < 0);
      input.setVirtual(player, "right", ax > 0);
      input.setVirtual(player, "up", ay < 0);
      input.setVirtual(player, "down", ay > 0);
    },
    [clearDirections, input, player],
  );

  // 指が画面外へ出ても取り残されないようにする
  useEffect(() => {
    const end = (e: PointerEvent) => {
      if (stickRef.current?.pointerId === e.pointerId) {
        stickRef.current = null;
        setStick(null);
        clearDirections();
      }
    };
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    return () => {
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };
  }, [clearDirections]);

  const onStickDown = (e: React.PointerEvent) => {
    e.preventDefault();
    const next: StickState = {
      pointerId: e.pointerId,
      originX: e.clientX,
      originY: e.clientY,
      x: e.clientX,
      y: e.clientY,
    };
    stickRef.current = next;
    setStick(next);
  };

  const onStickMove = (e: React.PointerEvent) => {
    const current = stickRef.current;
    if (!current || current.pointerId !== e.pointerId) return;
    e.preventDefault();
    const next = { ...current, x: e.clientX, y: e.clientY };
    stickRef.current = next;
    setStick(next);
    applyStick(e.clientX - current.originX, e.clientY - current.originY);
  };

  const button = (action: "fire" | "special") => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault();
      input.setVirtual(player, action, true);
      if (action === "fire") setFiring(true);
    },
    onPointerUp: (e: React.PointerEvent) => {
      e.preventDefault();
      input.setVirtual(player, action, false);
      if (action === "fire") setFiring(false);
    },
    onPointerLeave: () => {
      input.setVirtual(player, action, false);
      if (action === "fire") setFiring(false);
    },
    onPointerCancel: () => {
      input.setVirtual(player, action, false);
      if (action === "fire") setFiring(false);
    },
  });

  const knobX = stick ? Math.max(-MAX_RADIUS, Math.min(MAX_RADIUS, stick.x - stick.originX)) : 0;
  const knobY = stick ? Math.max(-MAX_RADIUS, Math.min(MAX_RADIUS, stick.y - stick.originY)) : 0;
  const energyAngle = Math.max(0, Math.min(1, energyRatio)) * 360;

  return (
    <div className="relative mt-2 flex h-40 w-full max-w-md touch-none select-none items-stretch">
      {/* 左半分：どこを押してもスティックになる */}
      <div
        className="relative flex-1 rounded-l-xl border border-white/10 bg-white/[0.03]"
        onPointerDown={onStickDown}
        onPointerMove={onStickMove}
      >
        {!stick && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center font-mono text-[10px] text-white/25">
            ここを押してドラッグ
          </div>
        )}
        {stick && (
          <div
            className="pointer-events-none fixed z-30"
            style={{ left: stick.originX, top: stick.originY, transform: "translate(-50%, -50%)" }}
          >
            <div className="h-24 w-24 rounded-full border-2 border-white/25 bg-white/5" />
            <div
              className="absolute left-1/2 top-1/2 h-10 w-10 rounded-full border-2 border-cyan-300/70 bg-cyan-400/30"
              style={{ transform: `translate(calc(-50% + ${knobX}px), calc(-50% + ${knobY}px))` }}
            />
          </div>
        )}
      </div>

      {/* 右側：ショットとボム */}
      <div className="flex w-40 flex-col items-center justify-center gap-2 rounded-r-xl border border-l-0 border-white/10 bg-white/[0.03] p-2">
        <button
          {...button("fire")}
          aria-label="ショット"
          className={`relative flex h-20 w-20 items-center justify-center rounded-full border-2 font-mono text-xs font-bold transition-transform ${
            firing ? "scale-95 border-cyan-200 bg-cyan-400/40 text-white" : "border-cyan-300/60 bg-cyan-400/15 text-cyan-100"
          }`}
          style={{
            // 外周がエネルギー残量
            backgroundImage: `conic-gradient(rgba(255,232,107,0.85) ${energyAngle}deg, rgba(255,255,255,0.06) ${energyAngle}deg)`,
            backgroundOrigin: "border-box",
            backgroundClip: "border-box",
          }}
        >
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-[#0a0f1c]/85">SHOT</span>
        </button>

        <div className="flex w-full items-center gap-2">
          <button
            {...button("special")}
            aria-label="ボム"
            disabled={bombs <= 0}
            className={`flex h-11 flex-1 items-center justify-center rounded-lg border font-mono text-[11px] font-bold ${
              bombs > 0
                ? "border-pink-300/60 bg-pink-400/20 text-pink-100 active:bg-pink-400/40"
                : "border-white/10 bg-white/[0.02] text-white/25"
            }`}
          >
            BOMB {bombs > 0 ? "★".repeat(bombs) : "-"}
          </button>
          {onFullscreen && (
            <button
              onClick={onFullscreen}
              aria-label="全画面"
              className="flex h-11 w-11 items-center justify-center rounded-lg border border-white/20 bg-white/5 text-sm text-white/70"
            >
              ⛶
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
