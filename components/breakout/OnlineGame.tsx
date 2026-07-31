"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { AudioEngine, type GameAudio } from "@/lib/breakout/audio";
import { H, W } from "@/lib/breakout/constants";
import { DT } from "@/lib/breakout/engine";
import { BreakoutInput } from "@/lib/breakout/input";
import {
  createGuestSession,
  createHostSession,
  makeRoomCode,
  normalizeRoomCode,
  type NetSession,
} from "@/lib/breakout/net/session";
import { render } from "@/lib/breakout/render";
import { loadSettings } from "@/lib/breakout/storage";
import type { Settings } from "@/lib/breakout/types";
import type { TransportKind, TransportState } from "@/lib/versus/net/transport";

import { BreakoutPad, type PadKey } from "./BreakoutPad";

type Mode = "versus" | "coop";
type Step = "menu" | "connecting" | "lobby" | "playing";

/** 可変オブジェクトはモジュールスコープの単一インスタンスとして持つ（React Compiler 対策） */
const runtime: {
  session: NetSession | null;
  input: BreakoutInput | null;
  audio: GameAudio | null;
  canvas: HTMLCanvasElement | null;
} = { session: null, input: null, audio: null, canvas: null };

interface Status {
  step: Step;
  transport: TransportState;
  detail: string;
  peer: boolean;
  peerReady: boolean;
  ready: boolean;
  error: string | null;
  points: [number, number];
  gauge: number;
  lives: number;
  timeLeft: number;
  overdrive: boolean;
  rtt: number;
  winner: number | null;
  over: boolean;
  /** サーバーが決めた実際のモード（参加側は選べない） */
  actualMode: Mode;
}

const initialStatus: Status = {
  step: "menu",
  transport: "connecting",
  detail: "",
  peer: false,
  peerReady: false,
  ready: false,
  error: null,
  points: [0, 0],
  gauge: 1,
  lives: 3,
  timeLeft: 0,
  overdrive: false,
  rtt: 0,
  winner: null,
  over: false,
  actualMode: "versus",
};

export default function OnlineGame() {
  const [mode, setMode] = useState<Mode>("versus");
  const [kind, setKind] = useState<TransportKind>("p2p");
  const [code, setCode] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [status, setStatus] = useState<Status>(initialStatus);
  const [settings] = useState<Settings>(() => loadSettings());

  const stop = useCallback(() => {
    runtime.session?.close();
    runtime.session = null;
    runtime.input?.detach();
    runtime.input = null;
    setStatus(initialStatus);
    setCode("");
  }, []);

  useEffect(() => () => stop(), [stop]);

  const begin = useCallback(
    (role: "host" | "guest", room: string) => {
      stop();
      const audio = runtime.audio ?? new AudioEngine();
      runtime.audio = audio;
      audio.init();
      audio.setVolumes(settings.sfx, settings.bgm);

      const options = {
        room,
        role,
        kind,
        mode,
        difficulty: settings.difficulty,
        gravity: settings.gravity,
        onState: (state: TransportState, detail?: string) =>
          setStatus((s) => ({ ...s, transport: state, detail: detail ?? "" })),
      } as const;
      const session = role === "host" ? createHostSession(options) : createGuestSession(options);
      runtime.session = session;
      // 通信対戦は必ず2人ぶんの入力枠を作る（自分は 1 枠しか使わない）
      const input = new BreakoutInput(1, false);
      input.attach();
      runtime.input = input;
      setCode(room);
      setStatus((s) => ({ ...s, step: "connecting", error: null }));
    },
    [kind, mode, settings, stop],
  );

  // ---- ループ ------------------------------------------------------------
  useEffect(() => {
    if (status.step === "menu") return;
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    let hudTimer = 0;

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const delta = Math.min(0.25, (now - last) / 1000);
      last = now;
      const session = runtime.session;
      const input = runtime.input;
      if (!session || !input) return;

      acc += delta;
      while (acc >= DT) {
        session.update(DT);
        session.client.update(input.read()[0]);
        acc -= DT;
      }

      const canvas = runtime.canvas;
      const ctx = canvas?.getContext("2d");
      if (ctx) {
        const view = session.client.view();
        render(ctx, view, {
          flip: view.flip,
          scanline: settings.scanline,
          blindSide: session.client.hud().blind ? (view.flip ? 0 : 1) : null,
        });
      }

      hudTimer += delta;
      if (hudTimer > 0.1) {
        hudTimer = 0;
        const c = session.client;
        const hud = c.hud();
        setStatus((s) => ({
          ...s,
          step: c.phase === "playing" || c.phase === "over" ? "playing" : "lobby",
          peer: c.peerConnected,
          peerReady: c.peerReady,
          ready: c.ready,
          error: c.error,
          points: hud.points,
          gauge: hud.gauges[0] / (hud.gaugeMaxes[0] || 100),
          lives: hud.lives,
          timeLeft: hud.timeLeft,
          overdrive: hud.overdrive,
          rtt: c.stats.rtt,
          winner: c.winner,
          over: c.phase === "over",
          actualMode: c.config.mode,
        }));
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [status.step, settings]);

  const toggleReady = useCallback(() => {
    const client = runtime.session?.client;
    if (!client) return;
    client.setReady(!client.ready);
    setStatus((s) => ({ ...s, ready: !s.ready }));
  }, []);

  const padKey = useCallback((key: PadKey, pressed: boolean) => {
    runtime.input?.setVirtual(0, key, pressed);
  }, []);
  const padVector = useCallback((vec: { x: number; y: number } | null) => {
    runtime.input?.setAnalog(0, vec);
  }, []);

  // ---- 画面 --------------------------------------------------------------

  if (status.step === "menu") {
    return (
      <main className="flex min-h-dvh w-full flex-col items-center justify-center gap-5 bg-[#05060c] p-6 text-white select-none [-webkit-touch-callout:none] [-webkit-tap-highlight-color:transparent]">
        <header className="text-center">
          <p className="font-mono text-[10px] tracking-[0.4em] text-white/40">fujiki games</p>
          <h1 className="font-mono text-2xl font-bold tracking-[0.2em] text-cyan-300">
            SPIN RALLY 通信
          </h1>
          <p className="mt-1 font-mono text-[11px] text-white/50">
            進行役の端末がゲームサーバーを兼ねるので、サーバーは要りません
          </p>
        </header>

        <section className="flex w-full max-w-xs flex-col gap-3">
          <Choice
            label="あそびかた"
            value={mode}
            onChange={setMode}
            options={[
              ["versus", "対戦（上下）"],
              ["coop", "協力（2人）"],
            ]}
          />
          <Choice
            label="つなぎかた"
            value={kind}
            onChange={setKind}
            options={[
              ["p2p", "直接つなぐ"],
              ["tab", "同じ端末の別タブ"],
            ]}
          />
          <p className="font-mono text-[10px] leading-relaxed text-white/40">
            「直接つなぐ」は2台のスマホ向け。「別タブ」は動作確認用で、同じブラウザの
            2つのタブで遊べます。
          </p>

          <button
            onClick={() => begin("host", makeRoomCode())}
            className="rounded-lg border border-cyan-300/50 bg-cyan-400/15 px-4 py-3 font-mono text-sm text-cyan-100 active:bg-cyan-400/30"
          >
            部屋を作る（進行役）
          </button>

          <div className="flex gap-2">
            <input
              value={joinCode}
              onChange={(e) => setJoinCode(normalizeRoomCode(e.target.value))}
              placeholder="部屋コード"
              inputMode="text"
              autoCapitalize="characters"
              className="flex-1 select-text [-webkit-user-select:text] rounded-lg border border-white/15 bg-white/5 px-3 py-3 text-center font-mono text-sm tracking-[0.3em] text-white placeholder:tracking-normal placeholder:text-white/30"
            />
            <button
              disabled={joinCode.length < 4}
              onClick={() => begin("guest", joinCode)}
              className="rounded-lg border border-white/15 bg-white/5 px-4 py-3 font-mono text-sm text-white/70 disabled:opacity-30 active:bg-white/10"
            >
              参加
            </button>
          </div>
          <Link
            href="/breakout"
            className="rounded-lg border border-white/15 bg-white/[0.03] px-4 py-3 text-center font-mono text-sm text-white/60"
          >
            もどる
          </Link>
        </section>
      </main>
    );
  }

  const transportLabel: Record<TransportState, string> = {
    connecting: "接続中…",
    open: "接続済み",
    closed: "切断されました",
    error: "接続エラー",
  };

  return (
    <main className="flex min-h-dvh w-full flex-col items-center gap-1 bg-[#05060c] p-2 text-white select-none [-webkit-touch-callout:none] [-webkit-tap-highlight-color:transparent]">
      <div className="flex w-full max-w-md items-center justify-between px-1 font-mono text-[11px] text-white/70">
        <span>
          部屋 <b className="tracking-[0.2em] text-cyan-300">{code}</b>
        </span>
        {status.step === "playing" ? (
          status.actualMode === "versus" ? (
            <>
              <span className="text-cyan-300">{status.points[0]}</span>
              <span className={status.overdrive ? "font-bold text-amber-300" : ""}>
                {status.overdrive ? "OD " : ""}
                {Math.ceil(status.timeLeft)}
              </span>
              <span className="text-pink-300">{status.points[1]}</span>
            </>
          ) : (
            <span>{"♥".repeat(Math.max(0, status.lives))}</span>
          )
        ) : (
          <span className="text-white/50">{transportLabel[status.transport]}</span>
        )}
        <span className="text-white/40">{status.rtt > 0 ? `${status.rtt.toFixed(0)}ms` : ""}</span>
      </div>

      <div className="relative w-full max-w-md" style={{ aspectRatio: `${W} / ${H}` }}>
        <canvas
          ref={(el) => {
            runtime.canvas = el;
          }}
          width={W}
          height={H}
          className="h-full w-full touch-none rounded-lg border border-white/10"
        />
        {status.step !== "playing" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-lg bg-black/80 p-6 text-center">
            <p className="font-mono text-xs text-white/60">{transportLabel[status.transport]}</p>
            {status.detail && <p className="font-mono text-[11px] text-rose-300">{status.detail}</p>}
            {status.error && <p className="font-mono text-[11px] text-rose-300">{status.error}</p>}
            <p data-room-code className="font-mono text-lg tracking-[0.4em] text-cyan-300">
              {code}
            </p>
            <p className="font-mono text-[11px] text-white/50">
              相手にこのコードを伝えて参加してもらいます
            </p>
            <p className="font-mono text-[11px] text-white/50">
              相手：{status.peer ? (status.peerReady ? "準備完了" : "接続中") : "まだ来ていません"}
            </p>
            <button
              onClick={toggleReady}
              disabled={!status.peer}
              className={`rounded-lg border px-6 py-3 font-mono text-sm ${
                status.ready
                  ? "border-emerald-300/60 bg-emerald-400/20 text-emerald-100"
                  : "border-cyan-300/50 bg-cyan-400/15 text-cyan-100"
              } disabled:opacity-30`}
            >
              {status.ready ? "準備完了（解除）" : "準備完了"}
            </button>
            <button onClick={stop} className="font-mono text-[11px] text-white/40 underline">
              やめる
            </button>
          </div>
        )}
        {status.over && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-lg bg-black/80">
            <h2 className="font-mono text-xl font-bold tracking-[0.2em] text-cyan-300">
              {status.actualMode === "coop"
                ? "GAME OVER"
                : status.winner === null
                  ? "DRAW"
                  : status.winner === (runtime.session?.client.you ?? 0)
                    ? "YOU WIN"
                    : "YOU LOSE"}
            </h2>
            <button
              onClick={stop}
              className="rounded-lg border border-white/15 bg-white/5 px-6 py-3 font-mono text-sm text-white/70"
            >
              もどる
            </button>
          </div>
        )}
      </div>

      <BreakoutPad onKey={padKey} onVector={padVector} gauge={status.gauge} />
    </main>
  );
}

function Choice<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: [T, string][];
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="font-mono text-[11px] text-white/50">{label}</span>
      <div className="grid grid-cols-2 gap-2">
        {options.map(([v, text]) => (
          <button
            key={v}
            onClick={() => onChange(v)}
            className={`rounded-md border py-2 font-mono text-xs ${
              value === v
                ? "border-cyan-300 bg-cyan-400/25 text-white"
                : "border-white/15 bg-white/5 text-white/60"
            }`}
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}
