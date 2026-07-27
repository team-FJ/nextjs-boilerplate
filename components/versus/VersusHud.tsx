"use client";

import { MAX_POWER, MAX_SHIELD, VERSUS_WEAPONS } from "@/lib/versus/constants";
import type { FighterHud, VersusHudSnapshot } from "@/lib/versus/types";

function Pips({ value, max, color }: { value: number; max: number; color: string }) {
  return (
    <span className="inline-flex gap-0.5 align-middle">
      {Array.from({ length: max }, (_, i) => (
        <span
          key={i}
          className="h-1.5 w-1.5 rounded-full"
          style={{ background: i < value ? color : "rgba(255,255,255,0.18)" }}
        />
      ))}
    </span>
  );
}

function FighterPanel({
  f,
  roundsToWin,
  align,
}: {
  f: FighterHud;
  roundsToWin: number;
  align: "top" | "bottom";
}) {
  const hpRatio = Math.max(0, f.hp / f.maxHp);
  const energyRatio = Math.max(0, f.energy / f.maxEnergy);
  const low = hpRatio <= 0.3;
  return (
    <div className={`flex flex-col gap-1 px-2 ${align === "top" ? "pt-1.5" : "pb-1.5"}`}>
      <div className="flex items-center justify-between font-mono text-[10px]">
        <span className="font-bold" style={{ color: f.color }}>
          {f.name}
        </span>
        <span className="flex items-center gap-1.5 text-white/50">
          {f.rapid && <span className="text-amber-300">RAPID</span>}
          {f.slowed && <span className="text-sky-300">SLOW</span>}
          {f.weaponTimer > 0 && (
            <span style={{ color: VERSUS_WEAPONS[f.weapon].color }}>
              {VERSUS_WEAPONS[f.weapon].label}
            </span>
          )}
          <span className="flex gap-0.5">
            {Array.from({ length: roundsToWin }, (_, i) => (
              <span
                key={i}
                className="h-2 w-2 rounded-sm"
                style={{ background: i < f.wins ? f.color : "rgba(255,255,255,0.16)" }}
              />
            ))}
          </span>
        </span>
      </div>

      {/* 耐久 */}
      <div className="h-2.5 w-full overflow-hidden rounded-sm border border-white/15 bg-black/60">
        <div
          className={`h-full transition-[width] duration-100 ${low ? "animate-pulse" : ""}`}
          style={{
            width: `${hpRatio * 100}%`,
            background: low ? "#ff5d5d" : `linear-gradient(90deg, ${f.color}, #ffffff88)`,
          }}
        />
      </div>

      {/* エネルギー（連射の上限） */}
      <div className="flex items-center gap-1.5">
        <span className="font-mono text-[8px] text-white/40">EN</span>
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/12">
          <div
            className="h-full rounded-full"
            style={{
              width: `${energyRatio * 100}%`,
              background: energyRatio < 0.25 ? "#ff8a5c" : "#ffe86b",
            }}
          />
        </div>
        <span className="font-mono text-[8px] text-white/40">PWR</span>
        <Pips value={f.power} max={MAX_POWER} color="#ffcf3d" />
        <span className="font-mono text-[8px] text-white/40">BR</span>
        <Pips value={f.shield} max={MAX_SHIELD} color="#7ec8ff" />
        <span className="font-mono text-[8px] text-white/40">
          ★{f.bombs} ・ {f.kills}kill
        </span>
      </div>
    </div>
  );
}

export function VersusHud({ hud }: { hud: VersusHudSnapshot }) {
  const [p1, p2] = hud.fighters;
  return (
    <div className="pointer-events-none absolute inset-0 select-none text-white">
      <div className="absolute inset-x-0 top-0 bg-gradient-to-b from-black/75 to-transparent pb-3">
        <FighterPanel f={p2} roundsToWin={hud.roundsToWin} align="top" />
      </div>
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent pt-3">
        <FighterPanel f={p1} roundsToWin={hud.roundsToWin} align="bottom" />
      </div>
    </div>
  );
}
