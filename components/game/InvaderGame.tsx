"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { AudioEngine } from "@/lib/game/audio";
import { FIXED_DT, MAX_FRAME_SKIP, VIEW_H, VIEW_W } from "@/lib/game/constants";
import { GameEngine } from "@/lib/game/engine";
import { InputManager } from "@/lib/game/input";
import { Renderer } from "@/lib/game/render";
import { STAGE_COUNT } from "@/lib/game/stages";
import { loadProgress, loadSettings, saveSettings } from "@/lib/game/storage";
import type { HudSnapshot, Phase, Progress, Settings } from "@/lib/game/types";

import { Hud } from "./Hud";
import {
  AllClearScreen,
  GameOverScreen,
  HowTo,
  OptionsMenu,
  PauseMenu,
  StageClearScreen,
  StageSelect,
  TitleScreen,
} from "./Menus";
import { TouchControls } from "./TouchControls";

type MenuKind = "none" | "stageSelect" | "options" | "howto";

interface GameCore {
  audio: AudioEngine;
  engine: GameEngine;
  input: InputManager;
  renderer: Renderer;
}

/**
 * ゲームコア一式（クライアント専用。ssr:false で読み込まれる）。
 * 可変オブジェクトなので React の state ではなくモジュールスコープで一度だけ生成する。
 */
let coreSingleton: GameCore | null = null;

function getCore(): GameCore {
  if (!coreSingleton) {
    const settings = loadSettings();
    const progress = loadProgress();
    const audio = new AudioEngine();
    audio.setVolumes(settings.sfxVolume, settings.bgmVolume);
    coreSingleton = {
      audio,
      engine: new GameEngine(settings, progress, audio),
      input: new InputManager(),
      renderer: new Renderer(),
    };
  }
  return coreSingleton;
}

export default function InvaderGame() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const { audio, engine, input, renderer } = getCore();

  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [progress, setProgress] = useState<Progress>(loadProgress);
  const [phase, setPhase] = useState<Phase>("title");
  const [menu, setMenu] = useState<MenuKind>("none");
  const [hud, setHud] = useState<HudSnapshot | null>(null);

  // ---- 入力の接続とメインループ ---------------------------------------------
  useEffect(() => {
    engine.setCallbacks({
      onPhaseChange: (p) => setPhase(p),
      onProgress: (p) => setProgress({ ...p, clearedStages: [...p.clearedStages] }),
    });

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = VIEW_W * dpr;
    canvas.height = VIEW_H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    input.attach(
      canvas,
      (cx, cy) => {
        const rect = canvas.getBoundingClientRect();
        return { x: (cx / rect.width) * VIEW_W, y: (cy / rect.height) * VIEW_H };
      },
      {
        onPause: () => {
          if (engine.phase !== "title") engine.togglePause();
        },
      },
    );

    let raf = 0;
    let last = performance.now();
    let acc = 0;
    let hudAcc = 0;

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const elapsed = Math.min(0.25, (now - last) / 1000);
      last = now;
      acc += elapsed;

      // 固定タイムステップで更新（フレーム落ち時も挙動を安定させる）
      let steps = 0;
      while (acc >= FIXED_DT && steps < MAX_FRAME_SKIP) {
        engine.update(FIXED_DT, input.state);
        acc -= FIXED_DT;
        steps += 1;
      }
      if (steps >= MAX_FRAME_SKIP) acc = 0;
      input.endFrame();

      renderer.draw(ctx, engine, elapsed);

      hudAcc += elapsed;
      if (hudAcc > 0.08) {
        hudAcc = 0;
        setHud(engine.getHud());
      }
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      input.detach();
      audio.stopBgm();
      engine.setCallbacks({});
    };
  }, [audio, engine, input, renderer]);

  // ---- 設定変更 -------------------------------------------------------------
  const patchSettings = useCallback(
    (patch: Partial<Settings>) => {
      setSettings((prev) => {
        const next = { ...prev, ...patch };
        saveSettings(next);
        engine.applySettings(next);
        return next;
      });
    },
    [engine],
  );

  // ---- 操作ハンドラ ---------------------------------------------------------
  const startStage = useCallback(
    (stage: number) => {
      audio.init(); // ユーザー操作を契機に AudioContext を起動
      audio.play("confirm");
      setMenu("none");
      engine.startRun(stage);
    },
    [audio, engine],
  );

  const handleNext = useCallback(() => {
    audio.play("confirm");
    engine.nextStage();
  }, [audio, engine]);

  const handleRetry = useCallback(() => {
    audio.play("confirm");
    engine.retryStage();
  }, [audio, engine]);

  const handleQuit = useCallback(() => {
    audio.play("cancel");
    setMenu("none");
    engine.quitToTitle();
  }, [audio, engine]);

  const handleResetProgress = useCallback(() => {
    setProgress(engine.resetProgressData());
  }, [engine]);

  const overlayVisible =
    menu !== "none" ||
    phase === "title" ||
    phase === "paused" ||
    phase === "stageClear" ||
    phase === "gameOver" ||
    phase === "allClear";

  const highScore = Math.max(
    progress.bestTotalScore,
    ...Object.values(progress.highScores ?? {}).map(Number).concat([0]),
  );

  return (
    <div className="flex min-h-dvh w-full flex-col items-center justify-center bg-[#05060c] py-4">
      <div
        className="relative w-full max-w-[480px] overflow-hidden rounded-lg border border-white/10 shadow-[0_0_60px_rgba(60,120,255,0.15)]"
        style={{ aspectRatio: `${VIEW_W} / ${VIEW_H}`, maxHeight: "calc(100dvh - 2rem)" }}
      >
        <canvas ref={canvasRef} className="block h-full w-full touch-none bg-black" />

        {hud && phase !== "title" && !overlayVisible && <Hud hud={hud} highScore={highScore} />}
        {hud && settings.showFps && (
          <div className="pointer-events-none absolute bottom-1 left-1 font-mono text-[9px] text-white/40">
            {hud.fps} FPS
          </div>
        )}

        {phase === "playing" && (
          <button
            className="absolute right-2 top-1/2 z-10 hidden -translate-y-1/2 rounded border border-white/20 bg-black/40 px-2 py-1 font-mono text-[10px] text-white/60 hover:bg-black/70 sm:block"
            onClick={() => engine.pause()}
          >
            ⏸
          </button>
        )}

        {menu === "stageSelect" ? (
          <StageSelect progress={progress} onPick={startStage} onBack={() => setMenu("none")} />
        ) : menu === "options" ? (
          <OptionsMenu
            settings={settings}
            progress={progress}
            onChange={patchSettings}
            onResetProgress={handleResetProgress}
            onBack={() => setMenu("none")}
          />
        ) : menu === "howto" ? (
          <HowTo onBack={() => setMenu("none")} />
        ) : phase === "title" ? (
          <TitleScreen
            progress={progress}
            onStart={() => startStage(1)}
            onStageSelect={() => setMenu("stageSelect")}
            onOptions={() => setMenu("options")}
            onHowTo={() => setMenu("howto")}
          />
        ) : phase === "paused" ? (
          <PauseMenu
            onResume={() => engine.resume()}
            onRestart={handleRetry}
            onOptions={() => setMenu("options")}
            onQuit={handleQuit}
          />
        ) : phase === "stageClear" ? (
          <StageClearScreen
            result={hud?.stageResult ?? null}
            totalScore={hud?.score ?? 0}
            isLast={(hud?.stage ?? 1) >= STAGE_COUNT}
            onNext={handleNext}
            onQuit={handleQuit}
          />
        ) : phase === "gameOver" ? (
          <GameOverScreen
            score={hud?.score ?? 0}
            stage={hud?.stage ?? 1}
            onRetry={handleRetry}
            onQuit={handleQuit}
          />
        ) : phase === "allClear" ? (
          <AllClearScreen score={hud?.score ?? 0} onQuit={handleQuit} />
        ) : null}
      </div>

      <TouchControls input={input} />

      <p className="mt-3 px-4 text-center font-mono text-[10px] text-white/35">
        移動 ← → ↑ ↓ / WASD ・ ショット SPACE・Z ・ ボム X・SHIFT ・ ポーズ ESC・P
      </p>
    </div>
  );
}
