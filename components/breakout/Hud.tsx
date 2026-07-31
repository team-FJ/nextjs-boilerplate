"use client";

import { CHAIN_MULS, GAUGE_MAX } from "@/lib/breakout/constants";
import type { Mode } from "@/lib/breakout/types";

export interface HudState {
  mode: Mode;
  stage: number;
  lives: number;
  score: number;
  chain: number;
  timeLeft: number;
  overdrive: boolean;
  points: [number, number];
  gauges: number[];
  gaugeMaxes: number[];
  stun: boolean[];
}

function Gauge({ value, max, label, stunned }: { value: number; max: number; label: string; stunned: boolean }) {
  const ratio = Math.max(0, Math.min(1, value / (max || GAUGE_MAX)));
  return (
    <div className="flex items-center gap-1">
      <span className="font-mono text-[10px] text-white/50">{label}</span>
      <div className="h-2 w-16 overflow-hidden rounded-sm bg-white/10">
        <div
          className={`h-full transition-[width] duration-100 ${stunned ? "bg-rose-400" : "bg-amber-300"}`}
          style={{ width: `${ratio * 100}%` }}
        />
      </div>
    </div>
  );
}

export function Hud({ state }: { state: HudState }) {
  const versus = state.mode === "versus";
  return (
    // 親からの継承だけに頼らず、文字を持つこの行にも直接指定する
    // （iOS で選択ハンドルが出ると遊べなくなる）
    <div className="flex w-full max-w-md touch-none select-none items-center justify-between gap-2 px-1 py-1 font-mono text-xs text-white/80">
      {versus ? (
        <>
          <span className="text-cyan-300">YOU {state.points[0]}</span>
          <Gauge value={state.gauges[0]} max={state.gaugeMaxes[0]} label="技" stunned={state.stun[0]} />
          <span className={state.overdrive ? "font-bold text-amber-300" : ""}>
            {state.overdrive ? "OD " : ""}
            {Math.ceil(state.timeLeft)}
          </span>
          <Gauge value={state.gauges[1]} max={state.gaugeMaxes[1]} label="技" stunned={state.stun[1]} />
          <span className="text-pink-300">{state.points[1]} 相手</span>
        </>
      ) : (
        <>
          <span>STAGE {state.stage}</span>
          <span>{"♥".repeat(Math.max(0, state.lives))}</span>
          <span>{state.score.toLocaleString()}</span>
          {state.chain > 0 && (
            <span className="text-emerald-300">×{CHAIN_MULS[state.chain].toFixed(1)}</span>
          )}
          {state.gauges.map((g, i) => (
            <Gauge
              key={i}
              value={g}
              max={state.gaugeMaxes[i]}
              label={state.gauges.length > 1 ? `P${i + 1}` : "技"}
              stunned={state.stun[i]}
            />
          ))}
        </>
      )}
    </div>
  );
}
