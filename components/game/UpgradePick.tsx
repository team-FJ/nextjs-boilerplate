"use client";

import { ROGUE_UPGRADES } from "@/lib/game/roguelite";
import type { RogueRun, RogueUpgradeId } from "@/lib/game/types";

/**
 * ローグライトのステージクリア後に出る強化の選択。
 *
 * 強化を取るほど敵も強くなるので、いま自分がどれだけ敵を強くしているか
 * （脅威度）を一緒に出しておく。取れば楽になる一方通行ではないことが
 * 画面から伝わるようにしている。
 */
export function UpgradePick({
  run,
  onPick,
}: {
  run: RogueRun;
  onPick: (id: RogueUpgradeId) => void;
}) {
  return (
    <div className="w-full max-w-[330px] rounded border border-cyan-300/40 bg-cyan-400/10 p-3">
      <div className="flex items-baseline justify-between">
        <div className="font-mono text-[10px] tracking-[0.3em] text-cyan-200/90">UPGRADE</div>
        <div className="font-mono text-[10px] text-white/45">脅威度 {run.threat.toFixed(1)}</div>
      </div>
      <div className="mt-1 text-[11px] text-cyan-100/90">ひとつ選んで次の宙域へ</div>

      <div className="mt-2 flex flex-col gap-1.5">
        {run.offer.map((id) => {
          const u = ROGUE_UPGRADES[id];
          const owned = run.taken[id] ?? 0;
          return (
            <button
              key={id}
              onClick={() => onPick(id)}
              className={`rounded border px-3 py-2 text-left transition-colors active:scale-[0.99] ${
                u.tradeoff
                  ? "border-amber-300/50 bg-amber-400/10 hover:border-amber-200 hover:bg-amber-400/25"
                  : "border-cyan-300/50 bg-cyan-400/10 hover:border-cyan-200 hover:bg-cyan-400/25"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className={`text-xs font-bold ${u.tradeoff ? "text-amber-100" : "text-cyan-100"}`}>
                  {u.label}
                  {owned > 0 && <span className="ml-1 font-mono text-[9px] text-white/40">×{owned}</span>}
                </span>
                <span className="font-mono text-[9px] text-white/35">敵 +{u.threat.toFixed(1)}</span>
              </div>
              <div className="font-mono text-[10px] text-white/65">{u.desc}</div>
              {u.tradeoff && (
                <div className="font-mono text-[10px] text-rose-300/80">代償：{u.tradeoff}</div>
              )}
            </button>
          );
        })}
      </div>

      <div className="mt-1.5 font-mono text-[9px] leading-relaxed text-white/35">
        強化を取ると敵も強くなります。ステージ中に拾ったアイテムは次の面へは持ち越しません
      </div>
    </div>
  );
}
