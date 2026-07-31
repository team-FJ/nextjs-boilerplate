"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { CPU_LEVELS, CpuPlayer, type CpuLevel } from "@/lib/breakout/ai";
import { AudioEngine, sfxFor, type GameAudio } from "@/lib/breakout/audio";
import { DIFFICULTY, H, ITEMS, W } from "@/lib/breakout/constants";
import { BreakoutEngine, DT } from "@/lib/breakout/engine";
import { BreakoutInput } from "@/lib/breakout/input";
import { render } from "@/lib/breakout/render";
import { STAGE_COUNT, stageName } from "@/lib/breakout/stages";
import { loadProgress, loadSettings, recordPlay, recordStageClear, saveSettings } from "@/lib/breakout/storage";
import type { Difficulty, Mode, Progress, Settings } from "@/lib/breakout/types";

import { BreakoutPad, type PadKey } from "./BreakoutPad";
import { Hud, type HudState } from "./Hud";

type Screen = "title" | "solo" | "coop" | "versus" | "options" | "howto" | "game";

interface Session {
  mode: Mode;
  stage: number;
  cpu: CpuLevel | null;
  /** 1台で2人（キーボードを左右で分ける） */
  split: boolean;
  key: number;
}

/**
 * 可変オブジェクトはモジュールスコープの単一インスタンスとして持つ。
 * React Compiler の制約（レンダー中に ref を触らない等）を素直に回避できる。
 */
const runtime: {
  engine: BreakoutEngine | null;
  input: BreakoutInput | null;
  cpu: CpuPlayer | null;
  audio: GameAudio | null;
  /** ループの中から見る現在の状態。ref をエフェクトで書き換えると React Compiler に弾かれる */
  paused: boolean;
  finished: boolean;
} = { engine: null, input: null, cpu: null, audio: null, paused: false, finished: false };

const emptyHud: HudState = {
  mode: "solo",
  stage: 1,
  lives: 3,
  score: 0,
  chain: 0,
  timeLeft: 0,
  overdrive: false,
  points: [0, 0],
  gauges: [100],
  gaugeMaxes: [100],
  stun: [false],
};

export default function BreakoutGame() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [screen, setScreen] = useState<Screen>("title");
  const [session, setSession] = useState<Session | null>(null);
  const [settings, setSettings] = useState<Settings>(() => loadSettings());
  const [progress, setProgress] = useState<Progress>(() => loadProgress());
  const [hud, setHud] = useState<HudState>(emptyHud);
  const [paused, setPaused] = useState(false);
  const [result, setResult] = useState<null | { kind: "clear" | "over" | "win" | "lose" | "draw"; score: number }>(null);

  const start = useCallback((mode: Mode, opts: { stage?: number; cpu?: CpuLevel | null; split?: boolean } = {}) => {
    runtime.finished = false;
    runtime.paused = false;
    setResult(null);
    setPaused(false);
    setSession({
      mode,
      stage: opts.stage ?? 1,
      cpu: opts.cpu ?? null,
      split: opts.split ?? false,
      key: Date.now(),
    });
    setScreen("game");
  }, []);

  const quit = useCallback(() => {
    runtime.finished = false;
    runtime.paused = false;
    setSession(null);
    setScreen("title");
    setResult(null);
    setPaused(false);
  }, []);

  const togglePause = useCallback(() => {
    runtime.paused = !runtime.paused;
    setPaused(runtime.paused);
  }, []);

  // ---- ゲームループ ------------------------------------------------------
  useEffect(() => {
    if (!session) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const playerCount = session.mode === "solo" ? 1 : 2;
    const engine = new BreakoutEngine({
      mode: session.mode,
      difficulty: settings.difficulty,
      stage: session.stage,
      seed: session.key,
      // 開幕サーブは交互（揃えると上下の勝率が偏ることを実測で確認している）
      firstServe: session.key % 2 === 0 ? 0 : 1,
    });
    const input = new BreakoutInput(playerCount, session.split || session.mode !== "solo");
    const audio = runtime.audio ?? new AudioEngine();
    runtime.engine = engine;
    runtime.input = input;
    runtime.audio = audio;
    runtime.cpu = session.cpu ? new CpuPlayer(1, session.cpu) : null;

    audio.init();
    audio.setVolumes(settings.sfx, settings.bgm);
    input.attach(togglePause);
    recordPlay();

    let raf = 0;
    let last = performance.now();
    let acc = 0;
    let hudTimer = 0;
    let stopped = false;

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const delta = Math.min(0.25, (now - last) / 1000);
      last = now;
      if (stopped) return;

      if (!runtime.paused && !runtime.finished) {
        acc += delta;
        // 固定タイムステップ。フレーム落ちしても挙動が変わらない
        while (acc >= DT) {
          const inputs = input.read();
          if (runtime.cpu) inputs[1] = runtime.cpu.think(engine);
          engine.step(inputs);
          acc -= DT;
        }
        for (const e of engine.drainEvents()) {
          const sfx = sfxFor(e);
          if (sfx) audio.play(sfx.name, sfx.pitch, sfx.throttle);
        }
      }

      render(ctx, engine, {
        flip: false,
        scanline: settings.scanline,
        blindSide:
          session.mode === "versus" && (engine.paddles[0].timers.blind ?? 0) > 0 ? 1 : null,
      });

      hudTimer += delta;
      if (hudTimer > 0.08) {
        hudTimer = 0;
        setHud({
          mode: engine.mode,
          stage: engine.stage,
          lives: engine.lives,
          score: engine.totalScore(),
          chain: engine.chain,
          timeLeft: engine.timeLeft,
          overdrive: engine.overdrive,
          points: [engine.paddles[0]?.points ?? 0, engine.paddles[1]?.points ?? 0],
          gauges: engine.paddles.map((p) => p.gauge),
          gaugeMaxes: engine.paddles.map((p) => p.gaugeMax),
          stun: engine.paddles.map((p) => p.stun > 0),
        });
      }

      if (engine.phase === "stageClear" && !runtime.finished) {
        runtime.finished = true;
        setProgress(recordStageClear(engine.stage, engine.totalScore(), engine.bestChain));
        setResult({ kind: "clear", score: engine.totalScore() });
      } else if (engine.phase === "gameOver" && !runtime.finished) {
        runtime.finished = true;
        if (engine.mode === "versus") {
          setResult({
            kind: engine.winner === null ? "draw" : engine.winner === 0 ? "win" : "lose",
            score: engine.totalScore(),
          });
        } else {
          setResult({ kind: "over", score: engine.totalScore() });
        }
      }
    };
    raf = requestAnimationFrame(loop);

    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      input.detach();
      audio.stopBgm();
      runtime.engine = null;
      runtime.input = null;
      runtime.cpu = null;
    };
  }, [session, settings, togglePause]);

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      saveSettings(next);
      runtime.audio?.setVolumes(next.sfx, next.bgm);
      return next;
    });
  }, []);

  const padKey = useCallback((player: number, key: PadKey, pressed: boolean) => {
    runtime.input?.setVirtual(player, key, pressed);
  }, []);
  const padVector = useCallback((player: number, vec: { x: number; y: number } | null) => {
    runtime.input?.setAnalog(player, vec);
  }, []);

  const nextStage = useCallback(() => {
    const engine = runtime.engine;
    if (!engine) return;
    engine.nextStage();
    runtime.finished = false;
    setResult(null);
  }, []);

  // ---- 画面 --------------------------------------------------------------

  if (screen === "game" && session) {
    return (
      <main className="flex min-h-dvh w-full flex-col items-center justify-start gap-1 bg-[#05060c] p-2 select-none [-webkit-touch-callout:none] [-webkit-tap-highlight-color:transparent]">
        <Hud state={hud} />
        <div className="relative w-full max-w-md" style={{ aspectRatio: `${W} / ${H}` }}>
          <canvas
            ref={canvasRef}
            width={W}
            height={H}
            className="h-full w-full touch-none rounded-lg border border-white/10"
          />
          {(paused || result) && (
            <Overlay
              result={result}
              paused={paused}
              mode={session.mode}
              stage={session.stage}
              onResume={togglePause}
              onRetry={() => start(session.mode, { stage: session.stage, cpu: session.cpu, split: session.split })}
              onNext={nextStage}
              onQuit={quit}
            />
          )}
        </div>
        <div className="flex w-full max-w-md flex-col items-center gap-1">
          <BreakoutPad
            onKey={(k, p) => padKey(0, k, p)}
            onVector={(v) => padVector(0, v)}
            gauge={(hud.gauges[0] ?? 0) / (hud.gaugeMaxes[0] || 100)}
            compact={session.mode !== "solo"}
            onFullscreen={() => canvasRef.current?.parentElement?.requestFullscreen?.()}
          />
          {session.mode !== "solo" && !session.cpu && (
            <BreakoutPad
              onKey={(k, p) => padKey(1, k, p)}
              onVector={(v) => padVector(1, v)}
              gauge={(hud.gauges[1] ?? 0) / (hud.gaugeMaxes[1] || 100)}
              compact
            />
          )}
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-dvh w-full flex-col items-center justify-center gap-6 bg-[#05060c] p-6 text-white select-none [-webkit-touch-callout:none] [-webkit-tap-highlight-color:transparent]">
      <header className="text-center">
        <p className="font-mono text-[10px] tracking-[0.4em] text-white/40">fujiki games</p>
        <h1 className="font-mono text-3xl font-bold tracking-[0.2em] text-cyan-300">SPIN RALLY</h1>
        <p className="mt-1 font-mono text-[11px] text-white/50">
          押すだけでスマッシュ・横でカーブ・下でボレー
        </p>
      </header>

      {screen === "title" && (
        <nav className="flex w-full max-w-xs flex-col gap-2">
          <Button onClick={() => setScreen("solo")}>1人で遊ぶ</Button>
          <Button onClick={() => setScreen("coop")}>協力（2人）</Button>
          <Button onClick={() => setScreen("versus")}>対戦</Button>
          <Button variant="ghost" onClick={() => setScreen("howto")}>
            遊びかた
          </Button>
          <Button variant="ghost" onClick={() => setScreen("options")}>
            設定
          </Button>
        </nav>
      )}

      {screen === "solo" && (
        <section className="flex w-full max-w-md flex-col gap-3">
          <h2 className="font-mono text-sm text-white/70">ステージを選ぶ</h2>
          <div className="grid grid-cols-5 gap-2">
            {Array.from({ length: STAGE_COUNT }, (_, i) => i + 1).map((n) => {
              const locked = n > progress.unlockedStage;
              return (
                <button
                  key={n}
                  disabled={locked}
                  onClick={() => start("solo", { stage: n })}
                  title={stageName(n)}
                  className={`rounded-md border py-2 font-mono text-xs ${
                    locked
                      ? "border-white/5 bg-white/[0.02] text-white/20"
                      : "border-cyan-300/40 bg-cyan-400/10 text-cyan-100 active:bg-cyan-400/30"
                  }`}
                >
                  {locked ? "🔒" : n}
                </button>
              );
            })}
          </div>
          <p className="font-mono text-[11px] text-white/40">
            ハイスコア {Object.values(progress.highScores).reduce((a, b) => Math.max(a, b), 0).toLocaleString()}
          </p>
          <Button variant="ghost" onClick={() => setScreen("title")}>
            もどる
          </Button>
        </section>
      )}

      {screen === "coop" && (
        <section className="flex w-full max-w-xs flex-col gap-2">
          <h2 className="font-mono text-sm text-white/70">協力モード</h2>
          <p className="font-mono text-[11px] leading-relaxed text-white/50">
            ライフは共有。片方が<b className="text-white/80">ボレーで打ち上げ</b>、
            もう片方が<b className="text-white/80">スマッシュで叩く</b>と連携チェインで倍率が伸びる。
          </p>
          <Button onClick={() => start("coop", { split: true })}>1台で2人（P1=WASD / P2=矢印）</Button>
          <LinkButton href="/breakout/online">通信で2台</LinkButton>
          <Button variant="ghost" onClick={() => setScreen("title")}>
            もどる
          </Button>
        </section>
      )}

      {screen === "versus" && (
        <section className="flex w-full max-w-xs flex-col gap-2">
          <h2 className="font-mono text-sm text-white/70">対戦モード</h2>
          <p className="font-mono text-[11px] leading-relaxed text-white/50">
            上下に分かれて打ち合う。中央のブロック帯は
            <b className="text-white/80">ボレーで飛び越える</b>か
            <b className="text-white/80">スマッシュで穴を開ける</b>。5点先取または90秒。
          </p>
          {(Object.keys(CPU_LEVELS) as unknown as CpuLevel[]).map((lv) => (
            <Button key={lv} onClick={() => start("versus", { cpu: Number(lv) as CpuLevel })}>
              CPU（{CPU_LEVELS[Number(lv) as CpuLevel].label}）
            </Button>
          ))}
          <Button onClick={() => start("versus", { split: true })}>1台で2人（P1=WASD / P2=矢印）</Button>
          <LinkButton href="/breakout/online">通信で2台</LinkButton>
          <Button variant="ghost" onClick={() => setScreen("title")}>
            もどる
          </Button>
        </section>
      )}

      {screen === "options" && (
        <section className="flex w-full max-w-xs flex-col gap-3">
          <h2 className="font-mono text-sm text-white/70">設定</h2>
          <div className="flex flex-col gap-1">
            <span className="font-mono text-[11px] text-white/50">難易度（技の判定）</span>
            <div className="grid grid-cols-2 gap-2">
              {(Object.keys(DIFFICULTY) as Difficulty[]).map((d) => (
                <button
                  key={d}
                  onClick={() => updateSettings({ difficulty: d })}
                  className={`rounded-md border py-2 font-mono text-xs ${
                    settings.difficulty === d
                      ? "border-cyan-300 bg-cyan-400/25 text-white"
                      : "border-white/15 bg-white/5 text-white/60"
                  }`}
                >
                  {DIFFICULTY[d].label}
                  <span className="ml-1 text-[10px] text-white/40">
                    {DIFFICULTY[d].window === null ? "溜め" : `±${DIFFICULTY[d].window}F`}
                  </span>
                </button>
              ))}
            </div>
          </div>
          <Slider label="効果音" value={settings.sfx} onChange={(v) => updateSettings({ sfx: v })} />
          <Slider label="BGM" value={settings.bgm} onChange={(v) => updateSettings({ bgm: v })} />
          <label className="flex items-center gap-2 font-mono text-xs text-white/60">
            <input
              type="checkbox"
              checked={settings.scanline}
              onChange={(e) => updateSettings({ scanline: e.target.checked })}
            />
            スキャンライン
          </label>
          <Button variant="ghost" onClick={() => setScreen("title")}>
            もどる
          </Button>
        </section>
      )}

      {screen === "howto" && (
        <section className="flex w-full max-w-md flex-col gap-3 font-mono text-[11px] leading-relaxed text-white/60">
          <h2 className="text-sm text-white/70">遊びかた</h2>
          <p>
            技は<b className="text-white/90">方向を入れるかどうか</b>で決まります。
            何も入れずに押せば速くなり、方向を入れると速さのかわりに効果が付きます。
          </p>
          <table className="w-full border-collapse text-left">
            <tbody>
              {[
                ["ショットのみ", "スマッシュ", "速度×1.55。速さだけの一撃"],
                ["真上 ＋ ショット", "ドリル", "ブロックを跳ね返らず突き抜ける"],
                ["斜め上 ＋ ショット", "ライズカーブ", "少し突き抜けて少し曲がる"],
                ["真横 ＋ ショット", "フラットカーブ", "最大に曲がる（約90px）"],
                ["斜め下 ＋ ショット", "ドロップカーブ", "曲げながら失速"],
                ["真下 ＋ ショット", "ボレー", "高く浮いてブロックを飛び越える"],
              ].map(([a, b, c]) => (
                <tr key={a} className="border-b border-white/5">
                  <td className="py-1 pr-2 text-white/80">{a}</td>
                  <td className="py-1 pr-2 text-cyan-300">{b}</td>
                  <td className="py-1 text-white/50">{c}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p>
            ボールが当たる瞬間に合わせて押します（ふつう以上は±数フレーム、外すと短い硬直）。
            やさしいは押しておけば必ず成立します。技はゲージを使い、時間で回復します。
            スマホでは、スティックから指を離してショットだけ押せばスマッシュになります。
          </p>
          <p className="text-white/50">
            アイテムは全{Object.keys(ITEMS).length}種。
            <span className="text-rose-300">赤枠は取ると不利になるトラップ</span>なので避けます。
          </p>
          <Button variant="ghost" onClick={() => setScreen("title")}>
            もどる
          </Button>
        </section>
      )}
    </main>
  );
}

function Button({
  children,
  onClick,
  variant = "primary",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: "primary" | "ghost" | "disabled";
}) {
  const cls =
    variant === "primary"
      ? "border-cyan-300/50 bg-cyan-400/15 text-cyan-100 active:bg-cyan-400/30"
      : variant === "ghost"
        ? "border-white/15 bg-white/[0.03] text-white/60 active:bg-white/10"
        : "border-white/5 bg-white/[0.02] text-white/25";
  return (
    <button
      onClick={variant === "disabled" ? undefined : onClick}
      disabled={variant === "disabled"}
      className={`rounded-lg border px-4 py-3 font-mono text-sm tracking-wide ${cls}`}
    >
      {children}
    </button>
  );
}

/** 別ページへ渡す。basePath は next/link が付けてくれるので絶対パスで書く */
function LinkButton({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="rounded-lg border border-cyan-300/50 bg-cyan-400/15 px-4 py-3 text-center font-mono text-sm tracking-wide text-cyan-100 active:bg-cyan-400/30"
    >
      {children}
    </Link>
  );
}

function Slider({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex items-center gap-2 font-mono text-xs text-white/60">
      <span className="w-12">{label}</span>
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1"
      />
    </label>
  );
}

function Overlay({
  result,
  paused,
  mode,
  stage,
  onResume,
  onRetry,
  onNext,
  onQuit,
}: {
  result: null | { kind: "clear" | "over" | "win" | "lose" | "draw"; score: number };
  paused: boolean;
  mode: Mode;
  stage: number;
  onResume: () => void;
  onRetry: () => void;
  onNext: () => void;
  onQuit: () => void;
}) {
  const title = result
    ? {
        clear: "STAGE CLEAR",
        over: "GAME OVER",
        win: "YOU WIN",
        lose: "YOU LOSE",
        draw: "DRAW",
      }[result.kind]
    : "PAUSE";
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-lg bg-black/75 p-6 text-white">
      <h2 className="font-mono text-xl font-bold tracking-[0.2em] text-cyan-300">{title}</h2>
      {result && <p className="font-mono text-sm text-white/70">SCORE {result.score.toLocaleString()}</p>}
      <div className="flex w-full max-w-[220px] flex-col gap-2">
        {result?.kind === "clear" && mode !== "versus" && stage < STAGE_COUNT && (
          <Button onClick={onNext}>次のステージへ</Button>
        )}
        {!result && <Button onClick={onResume}>つづける</Button>}
        <Button variant="ghost" onClick={onRetry}>
          やり直す
        </Button>
        <Button variant="ghost" onClick={onQuit}>
          タイトルへ
        </Button>
      </div>
      {paused && !result && (
        <p className="font-mono text-[10px] text-white/40">ESC / P でも再開できます</p>
      )}
    </div>
  );
}
