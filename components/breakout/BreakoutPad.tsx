"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type PadKey = "left" | "right" | "up" | "down" | "fire";

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
 * SPIN RALLY の操作パッド。押した場所が原点になるバーチャルスティック。
 *
 * INVADER の共通パッドとの違いは **生の角度も一緒に返す**こと。
 * 移動は 8 方向に量子化したままでよいが、技の打ち出し角 θ は連続値で欲しいため。
 * （キーボードは 8 方向しか出せないので、調整はあくまで 8 方向の 5 点を基準にする）
 */
export function BreakoutPad({
  onKey,
  onVector,
  gauge,
  compact = false,
  onFullscreen,
}: {
  onKey: (key: PadKey, pressed: boolean) => void;
  onVector: (vec: { x: number; y: number } | null) => void;
  /** ショットボタン外周に出す技ゲージ（0-1） */
  gauge?: number;
  compact?: boolean;
  onFullscreen?: () => void;
}) {
  const [stick, setStick] = useState<StickState | null>(null);
  const [firing, setFiring] = useState(false);
  const stickRef = useRef<StickState | null>(null);

  const clearDirections = useCallback(() => {
    onKey("left", false);
    onKey("right", false);
    onKey("up", false);
    onKey("down", false);
    onVector(null);
  }, [onKey, onVector]);

  const applyStick = useCallback(
    (dx: number, dy: number) => {
      const distance = Math.hypot(dx, dy);
      if (distance < DEAD_ZONE) {
        clearDirections();
        return;
      }
      // 技の判定用には量子化前のベクトルをそのまま渡す
      onVector({ x: dx / distance, y: dy / distance });

      // 移動は 8 方向に量子化する（真上・真横も出しやすいように境界を広めに取る）
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
      onKey("left", ax < 0);
      onKey("right", ax > 0);
      onKey("up", ay < 0);
      onKey("down", ay > 0);
    },
    [clearDirections, onKey, onVector],
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

  const fireButton = {
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault();
      onKey("fire", true);
      setFiring(true);
    },
    onPointerUp: (e: React.PointerEvent) => {
      e.preventDefault();
      onKey("fire", false);
      setFiring(false);
    },
    onPointerLeave: () => {
      onKey("fire", false);
      setFiring(false);
    },
    onPointerCancel: () => {
      onKey("fire", false);
      setFiring(false);
    },
  };

  // iOS Safari は要素の全画面化に対応していないので、その場合はボタンを出さない
  const fullscreenSupported =
    typeof document !== "undefined" && document.fullscreenEnabled === true;

  const knobX = stick ? Math.max(-MAX_RADIUS, Math.min(MAX_RADIUS, stick.x - stick.originX)) : 0;
  const knobY = stick ? Math.max(-MAX_RADIUS, Math.min(MAX_RADIUS, stick.y - stick.originY)) : 0;
  const gaugeAngle = gauge === undefined ? null : Math.max(0, Math.min(1, gauge)) * 360;

  return (
    <div
      className={`relative flex w-full max-w-md touch-none select-none items-stretch ${
        compact ? "h-28" : "h-40"
      }`}
    >
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

      <div className="flex w-32 flex-col items-center justify-center gap-2 rounded-r-xl border border-l-0 border-white/10 bg-white/[0.03] p-2">
        <button
          {...fireButton}
          aria-label="ショット"
          className={`relative flex items-center justify-center rounded-full border-2 font-mono text-xs font-bold transition-transform ${
            compact ? "h-16 w-16" : "h-20 w-20"
          } ${
            firing
              ? "scale-95 border-cyan-200 bg-cyan-400/40 text-white"
              : "border-cyan-300/60 bg-cyan-400/15 text-cyan-100"
          }`}
          style={
            gaugeAngle === null
              ? undefined
              : {
                  backgroundImage: `conic-gradient(rgba(255,232,107,0.85) ${gaugeAngle}deg, rgba(255,255,255,0.06) ${gaugeAngle}deg)`,
                  backgroundOrigin: "border-box",
                  backgroundClip: "border-box",
                }
          }
        >
          <span
            className={`flex items-center justify-center rounded-full bg-[#0a0f1c]/85 ${
              compact ? "h-12 w-12" : "h-16 w-16"
            }`}
          >
            SHOT
          </span>
        </button>
        {onFullscreen && fullscreenSupported && (
          <button
            onClick={onFullscreen}
            aria-label="全画面"
            className="flex h-8 w-full items-center justify-center rounded-lg border border-white/20 bg-white/5 text-sm text-white/70"
          >
            ⛶
          </button>
        )}
      </div>
    </div>
  );
}
