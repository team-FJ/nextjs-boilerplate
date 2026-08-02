"use client";

import Link from "next/link";

import { CPU_PROFILES, VERSUS_ITEMS } from "@/lib/versus/constants";

import { CourseSelect } from "./CourseSelect";
import { BAND_ENEMIES } from "@/lib/versus/enemies";
import type { CpuLevel, VersusConfig, VersusHudSnapshot } from "@/lib/versus/types";

const panel =
  "absolute inset-0 z-20 flex flex-col overflow-y-auto bg-black/88 backdrop-blur-sm text-white";
const btn =
  "rounded-md border border-white/20 bg-white/5 px-4 py-2 text-sm font-semibold transition-colors hover:border-cyan-300/70 hover:bg-cyan-400/15 active:scale-[0.98]";
const btnPrimary =
  "rounded-md border border-cyan-300/60 bg-cyan-400/20 px-4 py-2 text-sm font-bold text-cyan-100 transition-colors hover:bg-cyan-400/35 active:scale-[0.98]";

function Choice<T extends string | number>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex overflow-hidden rounded border border-white/20">
      {options.map((o) => (
        <button
          key={String(o.value)}
          onClick={() => onChange(o.value)}
          className={`px-2.5 py-1 text-[10px] font-semibold transition-colors ${
            value === o.value
              ? "bg-cyan-400/30 text-cyan-100"
              : "bg-white/[0.03] text-white/60 hover:bg-white/10"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-white/10 py-2">
      <div>
        <div className="text-xs font-semibold">{label}</div>
        {hint && <div className="font-mono text-[9px] text-white/40">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

export function VersusMenu({
  config,
  onChange,
  onStart,
  onHowTo,
}: {
  config: VersusConfig;
  onChange: (patch: Partial<VersusConfig>) => void;
  onStart: () => void;
  onHowTo: () => void;
}) {
  return (
    <div className={`${panel} gap-3 p-4`}>
      <div className="text-center">
        <div className="font-mono text-[10px] tracking-[0.4em] text-rose-300/80">HEAD TO HEAD</div>
        <div className="inline-block">
          <h1 className="mt-1 bg-gradient-to-r from-sky-300 via-white to-rose-300 bg-clip-text text-3xl font-black text-transparent">
            VERSUS BATTLE
          </h1>
          {/* 制作者名。タイトルの右下に署名のように置く */}
          <div className="text-right font-mono text-[10px] tracking-[0.2em] text-rose-200/70">fujiki games</div>
        </div>
        <p className="mt-1 font-mono text-[10px] text-white/45">
          上下に分かれた陣地で撃ち合い、中立ゾーンの敵を倒して強化する
        </p>
      </div>

      <div>
        <Row label="対戦相手" hint={config.mode === "cpu" ? "CPUと対戦" : "同じキーボードで2人対戦"}>
          <Choice
            value={config.mode}
            options={[
              { value: "cpu", label: "VS CPU" },
              { value: "local", label: "2人対戦" },
            ]}
            onChange={(mode) => onChange({ mode })}
          />
        </Row>
        {config.mode === "cpu" && (
          <Row label="CPUの強さ" hint={CPU_PROFILES[config.cpuLevel].description}>
            <Choice<CpuLevel>
              value={config.cpuLevel}
              options={(Object.keys(CPU_PROFILES) as CpuLevel[]).map((k) => ({
                value: k,
                label: CPU_PROFILES[k].label,
              }))}
              onChange={(cpuLevel) => onChange({ cpuLevel })}
            />
          </Row>
        )}
        <Row label="先取ラウンド数" hint="このラウンド数を先に取った方が勝ち">
          <Choice
            value={config.roundsToWin}
            options={[
              { value: 1, label: "1本" },
              { value: 2, label: "2本" },
              { value: 3, label: "3本" },
            ]}
            onChange={(roundsToWin) => onChange({ roundsToWin })}
          />
        </Row>
        <Row label="コース" hint="陣地の広さと壁の配置が変わる">
          <span />
        </Row>
        <div className="pb-2">
          <CourseSelect value={config.course} onChange={(course) => onChange({ course })} />
        </div>
        <Row label="中立ゾーンの敵" hint="多いほどアイテムの奪い合いが激しくなる">
          <Choice
            value={config.enemyDensity}
            options={[
              { value: "low", label: "少なめ" },
              { value: "normal", label: "ふつう" },
              { value: "high", label: "多め" },
            ]}
            onChange={(enemyDensity) => onChange({ enemyDensity })}
          />
        </Row>
      </div>

      <div className="flex flex-col gap-2">
        <button className={btnPrimary} onClick={onStart}>
          ▶ 対戦開始
        </button>
        {process.env.NEXT_PUBLIC_ONLINE_VERSUS !== "off" && (
        <Link
          href="/versus/online"
          className="rounded-md border border-sky-300/50 bg-sky-400/15 px-4 py-2 text-center text-sm font-bold text-sky-100 transition-colors hover:bg-sky-400/30 active:scale-[0.98]"
        >
          📱 2台で対戦（オンライン）
        </Link>
        )}
        <button className={btn} onClick={onHowTo}>
          ルールと操作
        </button>
        <Link href="/" className={`${btn} text-center`}>
          1人用モードへ戻る
        </Link>
      </div>
    </div>
  );
}

export function VersusHowTo({ mode, onBack }: { mode: VersusConfig["mode"]; onBack: () => void }) {
  return (
    <div className={`${panel} gap-3 p-4`}>
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold">ルールと操作</h2>
        <button className={btn} onClick={onBack}>
          戻る
        </button>
      </div>

      <ol className="list-inside list-decimal space-y-1 text-[11px] leading-relaxed text-white/75">
        <li>画面は上下に分割され、自分は下、相手は上。互いの陣地からは出られない。</li>
        <li>中央の中立ゾーンを敵が横切る。敵の種類によって上下どちらにも撃ってくる。</li>
        <li>その敵を倒すと、倒した側の陣地へアイテムが流れてくる。触れて回収すると強化される。</li>
        <li>耐久を先に0にするか、時間切れ時に耐久が多い方がラウンド勝利。</li>
        <li>残り20秒で OVERDRIVE。互いの与ダメージが1.6倍になり決着が付きやすくなる。</li>
      </ol>

      <div className="rounded border border-amber-300/30 bg-amber-400/10 p-2 text-[11px] leading-relaxed text-amber-100/90">
        <span className="font-bold">連射はエネルギー制。</span>
        1発ごとにエネルギーを消費し、時間で回復する。押しっぱなしでは撃ち続けられないので、
        溜めた3連射をどこで使うかが読み合いになる。
      </div>

      <div className="font-mono text-[10px] tracking-widest text-cyan-300/70">CONTROLS</div>
      <div className="grid grid-cols-2 gap-2 font-mono text-[10px] text-white/70">
        <div className="rounded border border-sky-400/25 bg-sky-400/5 p-2">
          <div className="mb-1 font-bold text-sky-300">P1（下）</div>
          <div>移動：{mode === "local" ? "← → ↑ ↓" : "← → ↑ ↓ / WASD"}</div>
          <div>ショット：SPACE / Z</div>
          <div>ボム：右SHIFT</div>
        </div>
        <div className="rounded border border-rose-400/25 bg-rose-400/5 p-2">
          <div className="mb-1 font-bold text-rose-300">
            {mode === "local" ? "P2（上）" : "CPU（上）"}
          </div>
          {mode === "local" ? (
            <>
              <div>移動：W A S D</div>
              <div>ショット：F</div>
              <div>ボム：G</div>
            </>
          ) : (
            <div className="text-white/40">CPUが操作します</div>
          )}
        </div>
      </div>

      <div className="font-mono text-[10px] tracking-widest text-cyan-300/70">NEUTRAL ZONE</div>
      <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
        {Object.values(BAND_ENEMIES).map((e) => (
          <div key={e.id} className="rounded border border-white/10 bg-white/[0.03] p-1.5">
            <span className="text-[11px] font-semibold" style={{ color: e.color }}>
              {e.name}
            </span>
            <span className="ml-1 font-mono text-[9px] text-white/45">
              耐久{e.hp} ・{" "}
              {e.attack === "none"
                ? "攻撃しない"
                : e.attack === "nearest"
                  ? "近い方を狙撃"
                  : e.attack === "bombBoth"
                    ? "上下へ爆弾"
                    : "上下へ射撃"}
            </span>
          </div>
        ))}
      </div>

      <div className="font-mono text-[10px] tracking-widest text-cyan-300/70">ITEMS</div>
      <div className="grid grid-cols-1 gap-1 pb-6 sm:grid-cols-2">
        {Object.entries(VERSUS_ITEMS).map(([key, item]) => (
          <div
            key={key}
            className="flex items-center gap-2 rounded border border-white/10 bg-white/[0.03] p-1.5"
          >
            <span
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded border font-mono text-[10px] font-bold"
              style={{ color: item.color, borderColor: item.color }}
            >
              {item.short}
            </span>
            <span className="min-w-0">
              <span className="block text-[11px] font-semibold">{item.name}</span>
              <span className="block font-mono text-[9px] text-white/45">{item.desc}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function VersusPause({
  onResume,
  onRestart,
  onQuit,
}: {
  onResume: () => void;
  onRestart: () => void;
  onQuit: () => void;
}) {
  return (
    <div className={`${panel} items-center justify-center gap-4`}>
      <h2 className="text-3xl font-black tracking-widest">PAUSE</h2>
      <div className="flex w-52 flex-col gap-2">
        <button className={btnPrimary} onClick={onResume}>
          再開
        </button>
        <button className={btn} onClick={onRestart}>
          最初からやり直す
        </button>
        <button className={btn} onClick={onQuit}>
          対戦メニューへ
        </button>
      </div>
    </div>
  );
}

export function VersusResult({
  hud,
  onRematch,
  onQuit,
}: {
  hud: VersusHudSnapshot;
  onRematch: () => void;
  onQuit: () => void;
}) {
  const winner = hud.matchWinner;
  const champ = winner ? hud.fighters[winner - 1] : null;
  return (
    <div className={`${panel} items-center justify-center gap-5 px-8`}>
      <div className="text-center">
        <div className="font-mono text-[11px] tracking-[0.4em] text-white/50">MATCH SET</div>
        <h2 className="mt-1 text-4xl font-black" style={{ color: champ?.color ?? "#fff" }}>
          {champ ? `${champ.name} WIN` : "DRAW"}
        </h2>
      </div>

      <div className="w-full max-w-xs font-mono text-[11px]">
        <div className="grid grid-cols-3 gap-1 border-b border-white/20 pb-1 text-white/45">
          <span />
          <span className="text-right" style={{ color: hud.fighters[0].color }}>
            {hud.fighters[0].name}
          </span>
          <span className="text-right" style={{ color: hud.fighters[1].color }}>
            {hud.fighters[1].name}
          </span>
        </div>
        {(
          [
            ["ラウンド獲得", (i: 0 | 1) => hud.fighters[i].wins],
            ["中立ゾーン撃破", (i: 0 | 1) => hud.fighters[i].kills],
            ["アイテム回収", (i: 0 | 1) => hud.fighters[i].pickups],
            ["残り耐久", (i: 0 | 1) => hud.fighters[i].hp],
          ] as const
        ).map(([label, get]) => (
          <div key={label} className="grid grid-cols-3 gap-1 py-1">
            <span className="text-white/50">{label}</span>
            <span className="text-right">{get(0)}</span>
            <span className="text-right">{get(1)}</span>
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        <button className={btnPrimary} onClick={onRematch}>
          もう一度
        </button>
        <button className={btn} onClick={onQuit}>
          メニューへ
        </button>
      </div>
    </div>
  );
}

export function RoundBreak({
  hud,
  onNext,
  extra,
  disabled = false,
}: {
  hud: VersusHudSnapshot;
  onNext: () => void;
  /** ラウンド間に差し込む内容（逆転強化の選択など） */
  extra?: React.ReactNode;
  disabled?: boolean;
}) {
  const w = hud.lastRoundWinner;
  const winnerName = w ? hud.fighters[w - 1].name : null;
  const winnerColor = w ? hud.fighters[w - 1].color : "#ccc";
  return (
    <div className={`${panel} items-center justify-center gap-4 overflow-y-auto py-4`}>
      <div className="text-center">
        <div className="font-mono text-[11px] tracking-[0.4em] text-white/50">
          ROUND {hud.round} 終了
        </div>
        <h2
          className="mt-1 text-2xl font-black"
          style={{ color: winnerColor }}
        >
          {winnerName ? `${winnerName} がラウンド獲得` : "引き分け"}
        </h2>
        <div className="mt-2 font-mono text-sm">
          <span style={{ color: hud.fighters[0].color }}>{hud.fighters[0].wins}</span>
          <span className="mx-2 text-white/40">-</span>
          <span style={{ color: hud.fighters[1].color }}>{hud.fighters[1].wins}</span>
        </div>
      </div>
      {extra && <div className="w-full max-w-[320px] px-4">{extra}</div>}
      <button className={btnPrimary} onClick={onNext} disabled={disabled}>
        {disabled ? "強化を選んでください" : "次のラウンドへ ▶"}
      </button>
    </div>
  );
}
