"use client";

import { ITEM_LABEL, MAX_POWER, WEAPON_LABEL } from "@/lib/game/constants";
import { STAGE_COUNT } from "@/lib/game/stages";
import type { HudSnapshot } from "@/lib/game/types";

function Bar({ value, max, color }: { value: number; max: number; color: string }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/15">
      <div
        className="h-full rounded-full transition-[width] duration-150"
        style={{ width: `${Math.max(0, Math.min(1, value / max)) * 100}%`, background: color }}
      />
    </div>
  );
}

export function Hud({ hud, highScore }: { hud: HudSnapshot; highScore: number }) {
  const showCombo = hud.combo >= 3;
  return (
    <div className="pointer-events-none absolute inset-0 select-none font-mono text-[10px] text-white">
      {/* 上部ステータス */}
      <div className="flex items-start justify-between px-3 pt-2">
        <div>
          <div className="text-white/50">SCORE</div>
          <div className="text-base font-bold leading-none tabular-nums text-amber-300 drop-shadow">
            {hud.displayScore.toLocaleString()}
          </div>
          <div className="mt-0.5 text-white/40 tabular-nums">
            HI {Math.max(highScore, hud.score).toLocaleString()}
          </div>
        </div>

        <div className="text-center">
          <div className="text-white/50">
            STAGE {hud.stage}/{STAGE_COUNT}
          </div>
          <div className="text-[11px] font-bold text-cyan-300">{hud.stageName}</div>
          <div className="text-white/40">
            WAVE {Math.min(hud.waveIndex + 1, hud.waveCount)}/{hud.waveCount}
            {hud.hazard !== "none" && <span className="ml-1 text-rose-300">⚠</span>}
          </div>
        </div>

        <div className="text-right">
          <div className="text-white/50">REST</div>
          <div className="text-base font-bold leading-none text-emerald-300">
            {"♥".repeat(Math.max(0, Math.min(6, hud.lives)))}
            {hud.lives > 6 && `×${hud.lives}`}
          </div>
          <div className="mt-0.5 text-white/40">BOMB {"★".repeat(hud.bombs) || "-"}</div>
        </div>
      </div>

      {/* ボスHP */}
      {hud.bossName && (
        <div className="mx-6 mt-2">
          <div className="mb-0.5 flex justify-between text-[10px] text-rose-300">
            <span>{hud.bossName}</span>
            <span className="tabular-nums">{Math.ceil((hud.bossHp / hud.bossMaxHp) * 100)}%</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-sm border border-rose-400/40 bg-black/50">
            <div
              className="h-full bg-gradient-to-r from-rose-500 to-amber-400 transition-[width] duration-100"
              style={{ width: `${(hud.bossHp / hud.bossMaxHp) * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* コンボ */}
      {showCombo && (
        <div className="absolute left-1/2 top-24 -translate-x-1/2 text-center">
          <div className="text-2xl font-black tabular-nums text-amber-300 drop-shadow-[0_0_8px_rgba(255,200,60,0.7)]">
            {hud.combo}
            <span className="text-sm"> COMBO</span>
          </div>
        </div>
      )}

      {/* 効果中のパワーアップ */}
      <div className="absolute right-2 top-24 flex w-24 flex-col gap-1">
        {hud.powerups.map((p) => {
          const label = ITEM_LABEL[p.kind];
          return (
            <div key={p.kind} className="rounded bg-black/50 px-1.5 py-1">
              <div className="flex items-center justify-between" style={{ color: label.color }}>
                <span className="truncate">{label.name}</span>
                <span className="tabular-nums">{p.remaining.toFixed(1)}</span>
              </div>
              <div className="mt-0.5">
                <Bar value={p.remaining} max={p.duration} color={label.color} />
              </div>
            </div>
          );
        })}
      </div>

      {/* 下部：機体ステータス */}
      <div className="absolute bottom-0 left-0 right-0 flex items-end justify-between gap-2 bg-gradient-to-t from-black/70 to-transparent px-3 pb-1.5 pt-4">
        <div className="w-28">
          <div className="flex justify-between text-white/50">
            <span>{WEAPON_LABEL[hud.weapon]}</span>
            <span className="text-amber-300">Lv{hud.power}</span>
          </div>
          <div className="mt-0.5 flex gap-0.5">
            {Array.from({ length: MAX_POWER }, (_, i) => (
              <div
                key={i}
                className={`h-1.5 flex-1 rounded-sm ${i < hud.power ? "bg-amber-300" : "bg-white/15"}`}
              />
            ))}
          </div>
        </div>

        <div className="flex-1">
          <div className="flex justify-between text-white/50">
            <span>HULL</span>
            <span>SHIELD</span>
          </div>
          <div className="mt-0.5 flex gap-2">
            <div className="flex-1">
              <Bar value={hud.hp} max={hud.maxHp} color="#8dff5a" />
            </div>
            <div className="flex-1">
              <Bar value={hud.shield} max={hud.maxShield} color="#7ec8ff" />
            </div>
          </div>
        </div>

        <div className="w-20 text-right text-white/50">
          <div>
            サポート機 <span className="text-amber-200">{hud.optionCount}</span>
          </div>
          <div>
            残敵 <span className="text-white/80 tabular-nums">{hud.enemiesLeft}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
