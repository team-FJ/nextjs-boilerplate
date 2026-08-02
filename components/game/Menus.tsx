"use client";

import Link from "next/link";

import { DIFFICULTY, ITEM_LABEL, THEMES } from "@/lib/game/constants";
import { STAGES } from "@/lib/game/stages";
import type { Difficulty, Progress, Settings, StageResult } from "@/lib/game/types";

const panel =
  "absolute inset-0 z-20 flex flex-col overflow-y-auto bg-black/85 backdrop-blur-sm text-white";

const btn =
  "rounded-md border border-white/20 bg-white/5 px-4 py-2 text-sm font-semibold transition-colors hover:border-cyan-300/70 hover:bg-cyan-400/15 active:scale-[0.98]";

const btnPrimary =
  "rounded-md border border-cyan-300/60 bg-cyan-400/20 px-4 py-2 text-sm font-bold text-cyan-100 transition-colors hover:bg-cyan-400/35 active:scale-[0.98]";

export function TitleScreen({
  progress,
  onStart,
  onStageSelect,
  onOptions,
  onHowTo,
}: {
  progress: Progress;
  onStart: () => void;
  onStageSelect: () => void;
  onOptions: () => void;
  onHowTo: () => void;
}) {
  return (
    <div className={`${panel} items-center justify-center gap-6 px-6 text-center`}>
      <div>
        <div className="font-mono text-xs tracking-[0.5em] text-cyan-300/80">SPACE SHOOTER</div>
        <div className="inline-block">
          <h1 className="mt-2 bg-gradient-to-b from-white to-cyan-300 bg-clip-text text-5xl font-black tracking-tight text-transparent">
            INVADER
            <br />
            ASSAULT
          </h1>
          {/* 制作者名。タイトルの右下に署名のように置く */}
          <div className="-mt-0.5 text-right font-mono text-[11px] tracking-[0.2em] text-cyan-200/70">
            fujiki games
          </div>
        </div>
        <div className="mt-2 font-mono text-[11px] text-white/50">
          全{STAGES.length}ステージ / 18種のアイテム / 6体のボス
        </div>
      </div>

      <div className="flex w-56 flex-col gap-2">
        <button className={btnPrimary} onClick={onStart}>
          ▶ ゲーム開始
        </button>
        <button className={btn} onClick={onStageSelect}>
          ステージセレクト
        </button>
        <button className={btn} onClick={onOptions}>
          オプション設定
        </button>
        <button className={btn} onClick={onHowTo}>
          遊び方 / アイテム一覧
        </button>
        <Link
          href="/versus"
          className="rounded-md border border-rose-300/50 bg-rose-400/15 px-4 py-2 text-center text-sm font-bold text-rose-100 transition-colors hover:bg-rose-400/30 active:scale-[0.98]"
        >
          ⚔ 対戦モード
        </Link>
      </div>

      <div className="font-mono text-[10px] text-white/40">
        <div>BEST SCORE {progress.bestTotalScore.toLocaleString()}</div>
        <div>
          CLEARED {progress.clearedStages.length}/{STAGES.length} ・ MAX COMBO {progress.bestCombo}
        </div>
      </div>
    </div>
  );
}

export function StageSelect({
  progress,
  onPick,
  onBack,
}: {
  progress: Progress;
  onPick: (stage: number) => void;
  onBack: () => void;
}) {
  return (
    <div className={`${panel} gap-3 p-4`}>
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold">ステージセレクト</h2>
        <button className={btn} onClick={onBack}>
          戻る
        </button>
      </div>
      <p className="font-mono text-[10px] text-white/50">
        クリアしたステージの次まで解放されます（現在 {progress.unlockedStage} まで）
      </p>
      <div className="grid grid-cols-3 gap-2 pb-4">
        {STAGES.map((s) => {
          const locked = s.index > progress.unlockedStage;
          const cleared = progress.clearedStages.includes(s.index);
          const theme = THEMES[s.theme];
          return (
            <button
              key={s.index}
              disabled={locked}
              onClick={() => onPick(s.index)}
              className={`relative rounded-md border p-2 text-left transition-transform ${
                locked
                  ? "cursor-not-allowed border-white/10 bg-white/[0.02] text-white/25"
                  : "border-white/20 bg-white/5 hover:scale-[1.03] hover:border-cyan-300/70"
              }`}
              style={!locked ? { boxShadow: `inset 0 -18px 24px -20px ${theme.accent}` } : undefined}
            >
              <div className="flex items-center justify-between font-mono text-[10px] text-white/50">
                <span>ST.{String(s.index).padStart(2, "0")}</span>
                {s.boss && <span className="text-rose-300">BOSS</span>}
              </div>
              <div className="truncate text-[11px] font-bold">{locked ? "？？？" : s.name}</div>
              <div className="font-mono text-[9px] text-white/40">
                {locked ? "LOCKED" : (progress.highScores[s.index] ?? 0).toLocaleString()}
              </div>
              {cleared && <span className="absolute right-1 top-1 text-[10px] text-emerald-300">✔</span>}
            </button>
          );
        })}
      </div>
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
      <div className="flex shrink-0 items-center gap-1">{children}</div>
    </div>
  );
}

function Choice<T extends string>({
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
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`px-2 py-1 text-[10px] font-semibold transition-colors ${
            value === o.value ? "bg-cyan-400/30 text-cyan-100" : "bg-white/[0.03] text-white/60 hover:bg-white/10"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <Choice
      value={value ? "on" : "off"}
      options={[
        { value: "on", label: "ON" },
        { value: "off", label: "OFF" },
      ]}
      onChange={(v) => onChange(v === "on")}
    />
  );
}

function Slider({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1 w-24 cursor-pointer appearance-none rounded bg-white/20 accent-cyan-400"
      />
      <span className="w-8 text-right font-mono text-[10px] text-white/50">
        {Math.round(value * 100)}
      </span>
    </div>
  );
}

export function OptionsMenu({
  settings,
  progress,
  onChange,
  onResetProgress,
  onBack,
}: {
  settings: Settings;
  progress: Progress;
  onChange: (patch: Partial<Settings>) => void;
  onResetProgress: () => void;
  onBack: () => void;
}) {
  return (
    <div className={`${panel} gap-2 p-4`}>
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold">オプション設定</h2>
        <button className={btn} onClick={onBack}>
          戻る
        </button>
      </div>

      <div className="pb-6">
        <div className="mt-1 font-mono text-[10px] tracking-widest text-cyan-300/70">GAMEPLAY</div>
        <Row label="難易度" hint={DIFFICULTY[settings.difficulty].description}>
          <Choice<Difficulty>
            value={settings.difficulty}
            options={(Object.keys(DIFFICULTY) as Difficulty[]).map((d) => ({
              value: d,
              label: DIFFICULTY[d].label,
            }))}
            onChange={(difficulty) => onChange({ difficulty })}
          />
        </Row>
        <Row label="操作方法" hint="KEY：矢印/WASD と画面下のパッド ・ MOUSE：ポインタ追従（パッドは効きません）">
          <Choice
            value={settings.control}
            options={[
              { value: "keyboard", label: "KEY" },
              { value: "mouse", label: "MOUSE" },
            ]}
            onChange={(control) => onChange({ control })}
          />
        </Row>
        <Row label="オートファイア" hint="常時発射。OFF なら Z / SPACE で射撃">
          <Toggle value={settings.autoFire} onChange={(autoFire) => onChange({ autoFire })} />
        </Row>
        <Row label="オプション配置" hint="随伴ポッドの追従パターン">
          <Choice
            value={settings.optionFormation}
            options={[
              { value: "trail", label: "追従" },
              { value: "side", label: "左右" },
              { value: "rotate", label: "回転" },
            ]}
            onChange={(optionFormation) => onChange({ optionFormation })}
          />
        </Row>

        <div className="mt-4 font-mono text-[10px] tracking-widest text-cyan-300/70">VIDEO</div>
        <Row label="画面揺れ">
          <Toggle value={settings.screenShake} onChange={(screenShake) => onChange({ screenShake })} />
        </Row>
        <Row label="エフェクト量" hint="低スペック環境では LOW を推奨">
          <Choice
            value={settings.particles}
            options={[
              { value: "low", label: "LOW" },
              { value: "normal", label: "MID" },
              { value: "high", label: "HIGH" },
            ]}
            onChange={(particles) => onChange({ particles })}
          />
        </Row>
        <Row label="CRT スキャンライン">
          <Toggle value={settings.crt} onChange={(crt) => onChange({ crt })} />
        </Row>
        <Row label="スターフィールド">
          <Toggle value={settings.starfield} onChange={(starfield) => onChange({ starfield })} />
        </Row>
        <Row label="色覚サポート" hint="敵弾を高コントラスト配色に変更">
          <Toggle value={settings.colorBlind} onChange={(colorBlind) => onChange({ colorBlind })} />
        </Row>
        <Row label="FPS 表示">
          <Toggle value={settings.showFps} onChange={(showFps) => onChange({ showFps })} />
        </Row>

        <div className="mt-4 font-mono text-[10px] tracking-widest text-cyan-300/70">AUDIO</div>
        <Row label="効果音">
          <Slider value={settings.sfxVolume} onChange={(sfxVolume) => onChange({ sfxVolume })} />
        </Row>
        <Row label="BGM">
          <Slider value={settings.bgmVolume} onChange={(bgmVolume) => onChange({ bgmVolume })} />
        </Row>

        <div className="mt-4 font-mono text-[10px] tracking-widest text-rose-300/70">DATA</div>
        <Row
          label="進行状況をリセット"
          hint={`解放 ${progress.unlockedStage} / クリア ${progress.clearedStages.length} / プレイ ${progress.playCount} 回`}
        >
          <button
            className="rounded border border-rose-400/50 bg-rose-500/15 px-3 py-1 text-[10px] font-bold text-rose-200 hover:bg-rose-500/30"
            onClick={onResetProgress}
          >
            RESET
          </button>
        </Row>
      </div>
    </div>
  );
}

export function HowTo({ onBack }: { onBack: () => void }) {
  return (
    <div className={`${panel} gap-3 p-4`}>
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold">遊び方</h2>
        <button className={btn} onClick={onBack}>
          戻る
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 font-mono text-[10px] text-white/70">
        <div className="rounded border border-white/15 bg-white/5 p-2">移動：← → ↑ ↓ / WASD</div>
        <div className="rounded border border-white/15 bg-white/5 p-2">ショット：SPACE / Z</div>
        <div className="rounded border border-white/15 bg-white/5 p-2">ボム：X / SHIFT</div>
        <div className="rounded border border-white/15 bg-white/5 p-2">ポーズ：ESC / P</div>
      </div>

      <p className="text-[11px] leading-relaxed text-white/60">
        スマホは画面下のパッドで操作します。左側はどこを押しても、そこを中心にした
        スティックになるので、親指を置いた場所から引っ張るだけで動かせます（対戦モードと同じ操作方法です）。
      </p>

      <p className="text-[11px] leading-relaxed text-white/70">
        敵を全滅させるとウェーブが進み、最終ウェーブ後にボスが出現するステージもあります。
        コンボ（連続撃破）でスコア倍率が上がり、被弾なしクリアには大きなボーナスが入ります。
        オプション（随伴ポッド）は最大4基まで増え、本体と同じ武装を撃ちます。
      </p>

      <div className="font-mono text-[10px] tracking-widest text-cyan-300/70">ITEMS</div>
      <div className="grid grid-cols-1 gap-1 pb-6 sm:grid-cols-2">
        {Object.entries(ITEM_LABEL).map(([key, item]) => (
          <div key={key} className="flex items-center gap-2 rounded border border-white/10 bg-white/[0.03] p-1.5">
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

export function PauseMenu({
  onResume,
  onRestart,
  onOptions,
  onQuit,
}: {
  onResume: () => void;
  onRestart: () => void;
  onOptions: () => void;
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
          このステージを最初から
        </button>
        <button className={btn} onClick={onOptions}>
          オプション設定
        </button>
        <button className={btn} onClick={onQuit}>
          タイトルへ戻る
        </button>
      </div>
    </div>
  );
}

export function StageClearScreen({
  result,
  totalScore,
  isLast,
  onNext,
  onQuit,
}: {
  result: StageResult | null;
  totalScore: number;
  isLast: boolean;
  onNext: () => void;
  onQuit: () => void;
}) {
  const acc = result && result.shotsFired > 0 ? (result.shotsHit / result.shotsFired) * 100 : 0;
  return (
    <div className={`${panel} items-center justify-center gap-4 px-8`}>
      <div className="text-center">
        <div className="font-mono text-xs tracking-[0.4em] text-cyan-300">STAGE CLEAR</div>
        <h2 className="mt-1 text-3xl font-black">{result?.stageName}</h2>
        {result?.isNewRecord && (
          <div className="mt-1 font-mono text-[11px] text-amber-300">★ NEW RECORD ★</div>
        )}
      </div>

      <div className="w-full max-w-xs space-y-1 font-mono text-[11px]">
        <Line label="STAGE SCORE" value={(result?.score ?? 0).toLocaleString()} />
        <Line label="BONUS" value={`+${(result?.bonus ?? 0).toLocaleString()}`} accent />
        <Line label="TIME" value={`${((result?.timeMs ?? 0) / 1000).toFixed(1)}s`} />
        <Line label="MAX COMBO" value={String(result?.maxCombo ?? 0)} />
        <Line label="ACCURACY" value={`${acc.toFixed(1)}%`} />
        <Line label="NO MISS" value={result?.noMiss ? "YES (+8000)" : "NO"} accent={result?.noMiss} />
        <div className="mt-2 border-t border-white/20 pt-2">
          <Line label="TOTAL" value={totalScore.toLocaleString()} accent />
        </div>
      </div>

      <div className="flex gap-2">
        <button className={btnPrimary} onClick={onNext}>
          {isLast ? "エンディングへ" : "次のステージへ ▶"}
        </button>
        <button className={btn} onClick={onQuit}>
          タイトル
        </button>
      </div>
    </div>
  );
}

function Line({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex justify-between">
      <span className="text-white/50">{label}</span>
      <span className={accent ? "font-bold text-amber-300" : "text-white"}>{value}</span>
    </div>
  );
}

export function GameOverScreen({
  score,
  stage,
  onRetry,
  onQuit,
}: {
  score: number;
  stage: number;
  onRetry: () => void;
  onQuit: () => void;
}) {
  return (
    <div className={`${panel} items-center justify-center gap-5`}>
      <h2 className="text-4xl font-black tracking-widest text-rose-400">GAME OVER</h2>
      <div className="text-center font-mono text-xs text-white/60">
        <div>STAGE {stage} で撃墜</div>
        <div className="mt-1 text-lg font-bold text-amber-300">{score.toLocaleString()}</div>
      </div>
      <div className="flex gap-2">
        <button className={btnPrimary} onClick={onRetry}>
          コンティニュー
        </button>
        <button className={btn} onClick={onQuit}>
          タイトル
        </button>
      </div>
    </div>
  );
}

export function AllClearScreen({
  score,
  onQuit,
}: {
  score: number;
  onQuit: () => void;
}) {
  return (
    <div className={`${panel} items-center justify-center gap-5 px-8 text-center`}>
      <h2 className="bg-gradient-to-b from-amber-200 to-rose-400 bg-clip-text text-4xl font-black tracking-widest text-transparent">
        ALL CLEAR
      </h2>
      <p className="max-w-xs text-[12px] leading-relaxed text-white/70">
        全{STAGES.length}ステージを制圧した。オーバーマインドの残骸が静かに漂う中、
        あなたの機体は次の宙域へと進路を取る——
      </p>
      <div className="font-mono text-sm text-amber-300">FINAL SCORE {score.toLocaleString()}</div>
      <button className={btnPrimary} onClick={onQuit}>
        タイトルへ
      </button>
    </div>
  );
}
