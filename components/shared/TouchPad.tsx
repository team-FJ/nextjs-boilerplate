"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type PadAction = "left" | "right" | "up" | "down" | "fire" | "special";

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
 * スマホ向けの操作パッド。1人用と対戦モードで共通。
 *
 * 左側は「押した場所が原点になる」バーチャルスティック。小さなボタンを狙う必要がなく、
 * 親指を置いた場所から引っ張るだけで動かせる。入力は 8 方向に量子化しているため、
 * 十字キーを前提にしたゲーム側の入力モデルをそのまま使える。
 *
 * 右側はショットとボム。ショットボタンの外周は残量ゲージで、
 * gauge を渡さなければ描かない（1人用には撃つための残量という概念がないため）。
 *
 * どの操作をゲームのどのキーに結びつけるかは呼び出し側の責任にしてある。
 * 1人用と対戦とで入力の持ち方が違うため、ここでは押した／離したを伝えるだけにする。
 */
export function TouchPad({
  onAction,
  gauge,
  bombs = 0,
  onFullscreen,
}: {
  onAction: (action: PadAction, pressed: boolean) => void;
  /** ショットボタン外周に出す残量（0-1）。省略すると描かない */
  gauge?: number;
  bombs?: number;
  onFullscreen?: () => void;
}) {
  const [stick, setStick] = useState<StickState | null>(null);
  const [firing, setFiring] = useState(false);
  const stickRef = useRef<StickState | null>(null);

  const clearDirections = useCallback(() => {
    onAction("left", false);
    onAction("right", false);
    onAction("up", false);
    onAction("down", false);
  }, [onAction]);

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
      onAction("left", ax < 0);
      onAction("right", ax > 0);
      onAction("up", ay < 0);
      onAction("down", ay > 0);
    },
    [clearDirections, onAction],
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
      onAction(action, true);
      if (action === "fire") setFiring(true);
    },
    onPointerUp: (e: React.PointerEvent) => {
      e.preventDefault();
      onAction(action, false);
      if (action === "fire") setFiring(false);
    },
    onPointerLeave: () => {
      onAction(action, false);
      if (action === "fire") setFiring(false);
    },
    onPointerCancel: () => {
      onAction(action, false);
      if (action === "fire") setFiring(false);
    },
  });

  // iOS Safari は要素の全画面化に対応していないので、その場合はボタンを出さない
  const fullscreenSupported =
    typeof document !== "undefined" && document.fullscreenEnabled === true;

  const knobX = stick ? Math.max(-MAX_RADIUS, Math.min(MAX_RADIUS, stick.x - stick.originX)) : 0;
  const knobY = stick ? Math.max(-MAX_RADIUS, Math.min(MAX_RADIUS, stick.y - stick.originY)) : 0;
  const gaugeAngle = gauge === undefined ? null : Math.max(0, Math.min(1, gauge)) * 360;

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
          style={
            gaugeAngle === null
              ? undefined
              : {
                  // 外周が残量
                  backgroundImage: `conic-gradient(rgba(255,232,107,0.85) ${gaugeAngle}deg, rgba(255,255,255,0.06) ${gaugeAngle}deg)`,
                  backgroundOrigin: "border-box",
                  backgroundClip: "border-box",
                }
          }
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
            BOMB {bombs > 0 ? "★".repeat(Math.min(5, bombs)) : "-"}
          </button>
          {onFullscreen && fullscreenSupported && (
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
