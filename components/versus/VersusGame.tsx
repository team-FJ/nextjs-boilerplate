"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { AudioEngine } from "@/lib/game/audio";
import { FIXED_DT, MAX_FRAME_SKIP } from "@/lib/game/constants";
import { loadSettings } from "@/lib/game/storage";
import type { Settings } from "@/lib/game/types";
import { VersusAi } from "@/lib/versus/ai";
import { V_H, V_W } from "@/lib/versus/constants";
import { VersusEngine } from "@/lib/versus/engine";
import { VersusInput } from "@/lib/versus/input";
import { VersusRenderer } from "@/lib/versus/render";
import { EMPTY_INPUT, type VersusConfig, type VersusHudSnapshot, type VersusPhase } from "@/lib/versus/types";

import { VersusHud } from "./VersusHud";
import { RoundBreak, VersusHowTo, VersusMenu, VersusPause, VersusResult } from "./VersusMenus";
import { VersusTouchControls } from "./VersusTouchControls";

const DEFAULT_CONFIG: VersusConfig = {
  mode: "cpu",
  cpuLevel: "normal",
  roundsToWin: 2,
  enemyDensity: "normal",
};

interface VersusCore {
  audio: AudioEngine;
  engine: VersusEngine;
  input: VersusInput;
  renderer: VersusRenderer;
  ai: VersusAi;
}

/** 可変オブジェクト一式。React の state ではなくモジュールスコープで一度だけ生成する */
let coreSingleton: VersusCore | null = null;

function getCore(): VersusCore {
  if (!coreSingleton) {
    const settings = loadSettings();
    const audio = new AudioEngine();
    audio.setVolumes(settings.sfxVolume, settings.bgmVolume);
    coreSingleton = {
      audio,
      engine: new VersusEngine(settings, audio, DEFAULT_CONFIG),
      input: new VersusInput(),
      renderer: new VersusRenderer(),
      ai: new VersusAi(2, DEFAULT_CONFIG.cpuLevel),
    };
  }
  return coreSingleton;
}

export default function VersusGame() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const { audio, engine, input, renderer, ai } = getCore();

  const [settings] = useState<Settings>(loadSettings);
  const [config, setConfig] = useState<VersusConfig>(DEFAULT_CONFIG);
  const [phase, setPhase] = useState<VersusPhase>("menu");
  const [hud, setHud] = useState<VersusHudSnapshot | null>(null);
  const [showHowTo, setShowHowTo] = useState(false);

  useEffect(() => {
    engine.setCallbacks({ onPhaseChange: (p) => setPhase(p) });

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = V_W * dpr;
    canvas.height = V_H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    input.attach({
      onPause: () => {
        if (engine.phase === "fighting" || engine.phase === "countdown") engine.pause();
        else if (engine.phase === "paused") engine.resume();
      },
    });

    let raf = 0;
    let last = performance.now();
    let acc = 0;
    let hudAcc = 0;

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const elapsed = Math.min(0.25, (now - last) / 1000);
      last = now;
      acc += elapsed;

      let steps = 0;
      while (acc >= FIXED_DT && steps < MAX_FRAME_SKIP) {
        // CPU 戦なら P2 の入力を AI が生成する
        const p2 =
          engine.config.mode === "cpu" ? ai.update(engine, FIXED_DT) : input.get(2);
        engine.update(FIXED_DT, [input.get(1), p2 ?? EMPTY_INPUT]);
        acc -= FIXED_DT;
        steps += 1;
      }
      if (steps >= MAX_FRAME_SKIP) acc = 0;

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
  }, [audio, engine, input, renderer, ai]);

  const patchConfig = useCallback((patch: Partial<VersusConfig>) => {
    setConfig((prev) => ({ ...prev, ...patch }));
  }, []);

  const startMatch = useCallback(() => {
    audio.init();
    audio.play("confirm");
    ai.setLevel(config.cpuLevel);
    input.setLocalMode(config.mode === "local");
    engine.applySettings(loadSettings());
    engine.startMatch(config);
  }, [ai, audio, config, engine, input]);

  const handleNextRound = useCallback(() => {
    audio.play("confirm");
    engine.nextRound();
  }, [audio, engine]);

  const handleQuit = useCallback(() => {
    audio.play("cancel");
    engine.quitToMenu();
  }, [audio, engine]);

  const inMatch = phase !== "menu";
  const touchPlayers = config.mode === "local" ? ([1, 2] as const) : ([1] as const);

  return (
    <div className="flex min-h-dvh w-full flex-col items-center justify-center bg-[#05060c] py-4">
      <div
        className="relative w-full max-w-[480px] overflow-hidden rounded-lg border border-white/10 shadow-[0_0_60px_rgba(255,110,160,0.12)]"
        style={{ aspectRatio: `${V_W} / ${V_H}`, maxHeight: "calc(100dvh - 2rem)" }}
      >
        <canvas ref={canvasRef} className="block h-full w-full touch-none bg-black" />

        {hud && inMatch && phase !== "matchEnd" && <VersusHud hud={hud} />}
        {hud && settings.showFps && (
          <div className="pointer-events-none absolute left-1 top-1/2 font-mono text-[9px] text-white/40">
            {hud.fps} FPS
          </div>
        )}

        {phase === "fighting" && (
          <button
            className="absolute right-2 top-1/2 z-10 hidden -translate-y-1/2 rounded border border-white/20 bg-black/40 px-2 py-1 font-mono text-[10px] text-white/60 hover:bg-black/70 sm:block"
            onClick={() => engine.pause()}
          >
            ⏸
          </button>
        )}

        {showHowTo ? (
          <VersusHowTo mode={config.mode} onBack={() => setShowHowTo(false)} />
        ) : phase === "menu" ? (
          <VersusMenu
            config={config}
            onChange={patchConfig}
            onStart={startMatch}
            onHowTo={() => setShowHowTo(true)}
          />
        ) : phase === "paused" ? (
          <VersusPause
            onResume={() => engine.resume()}
            onRestart={startMatch}
            onQuit={handleQuit}
          />
        ) : phase === "roundEnd" && hud ? (
          <RoundBreak hud={hud} onNext={handleNextRound} />
        ) : phase === "matchEnd" && hud ? (
          <VersusResult hud={hud} onRematch={startMatch} onQuit={handleQuit} />
        ) : null}
      </div>

      <VersusTouchControls input={input} players={[...touchPlayers]} />

      <p className="mt-2 px-4 text-center font-mono text-[10px] text-white/35">
        P1: ← → ↑ ↓{config.mode === "cpu" && " / WASD"} ・ SPACE ショット ・ 右SHIFT ボム
        {config.mode === "local" && " ｜ P2: WASD ・ F ショット ・ G ボム"} ｜ ESC ポーズ
      </p>
    </div>
  );
}
