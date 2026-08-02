"use client";

import { BOOSTS } from "@/lib/versus/boosts";
import type { BoostId } from "@/lib/versus/types";

/**
 * ラウンドに負けた側だけに出る強化の選択。
 *
 * 勝った側には何も出ない（差を広げないため）。ここで待たせすぎないよう、
 * 残り時間が尽きたら自動で決まることを画面にも出しておく。
 */
export function BoostPick({
  options,
  timer,
  onPick,
  mine,
}: {
  options: BoostId[];
  timer: number;
  onPick: (id: BoostId) => void;
  /** 自分に選択権があるか。相手が選んでいる間は待ち画面になる */
  mine: boolean;
}) {
  return (
    <div className="rounded border border-amber-300/40 bg-amber-400/10 p-3">
      <div className="flex items-baseline justify-between">
        <div className="font-mono text-[10px] tracking-[0.3em] text-amber-200/90">COMEBACK</div>
        <div className="font-mono text-[10px] text-white/45">{Math.max(0, Math.ceil(timer))}s</div>
      </div>
      <div className="mt-1 text-[11px] leading-relaxed text-amber-100/90">
        {mine
          ? "このラウンドを落としたので、ひとつ強化を選べます"
          : "相手が強化を選んでいます…"}
      </div>
      <div className="mt-2 flex flex-col gap-1.5">
        {options.map((id) => {
          const b = BOOSTS[id];
          return (
            <button
              key={id}
              disabled={!mine}
              onClick={() => onPick(id)}
              className={`flex items-center justify-between gap-2 rounded border px-3 py-2 text-left transition-colors ${
                mine
                  ? "border-amber-300/50 bg-amber-400/15 hover:border-amber-200 hover:bg-amber-400/30 active:scale-[0.99]"
                  : "border-white/10 bg-white/[0.02] opacity-60"
              }`}
            >
              <span className="text-xs font-bold text-amber-100">{b.label}</span>
              <span className="font-mono text-[10px] text-white/60">{b.desc}</span>
            </button>
          );
        })}
      </div>
      <div className="mt-1.5 font-mono text-[9px] text-white/35">
        同じ強化は1試合に1回まで。勝った側には配られません
      </div>
    </div>
  );
}
