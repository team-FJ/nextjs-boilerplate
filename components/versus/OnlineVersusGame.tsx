"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { FIXED_DT, MAX_FRAME_SKIP } from "@/lib/game/constants";
import { loadSettings } from "@/lib/game/storage";
import type { Settings } from "@/lib/game/types";
import { V_H, V_W } from "@/lib/versus/constants";
import { VersusInput } from "@/lib/versus/input";
import { buildRenderable, toFieldInput } from "@/lib/versus/net/viewAdapter";
import { VersusSession, type SessionRole } from "@/lib/versus/net/session";
import type { TransportKind, TransportState } from "@/lib/versus/net/transport";
import { VersusRenderer } from "@/lib/versus/render";
import type { PlayerId, VersusConfig, VersusHudSnapshot } from "@/lib/versus/types";

import { TouchPad } from "./TouchPad";
import { VersusHud } from "./VersusHud";

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function randomRoomCode(): string {
  let code = "";
  for (let i = 0; i < 6; i++) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return code;
}

const configuredServer = process.env.NEXT_PUBLIC_VERSUS_SERVER;

/** 入力マネージャは可変オブジェクトなので、state ではなくモジュールスコープで一度だけ作る */
let inputSingleton: VersusInput | null = null;
function getInput(): VersusInput {
  if (!inputSingleton) {
    inputSingleton = new VersusInput();
    inputSingleton.setLocalMode(false);
  }
  return inputSingleton;
}

const btn =
  "rounded-md border border-white/20 bg-white/5 px-4 py-2 text-sm font-semibold transition-colors hover:border-cyan-300/70 hover:bg-cyan-400/15 active:scale-[0.98]";
const btnPrimary =
  "rounded-md border border-cyan-300/60 bg-cyan-400/20 px-4 py-2 text-sm font-bold text-cyan-100 transition-colors hover:bg-cyan-400/35 active:scale-[0.98]";

const STATE_LABEL: Record<TransportState, string> = {
  connecting: "接続中…",
  open: "接続済み",
  closed: "切断",
  error: "接続エラー",
};

const KIND_LABEL: Record<TransportKind, string> = {
  p2p: "直接つなぐ",
  websocket: "サーバー経由",
  tab: "同じ端末の別タブ",
};

export default function OnlineVersusGame() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const sessionRef = useRef<VersusSession | null>(null);
  const input = getInput();

  const [settings] = useState<Settings>(loadSettings);
  const [kind, setKind] = useState<TransportKind>(configuredServer ? "websocket" : "p2p");
  const [role, setRole] = useState<SessionRole | null>(null);
  const [room, setRoom] = useState("");
  const [inputCode, setInputCode] = useState(
    () => new URLSearchParams(window.location.search).get("room")?.toUpperCase() ?? "",
  );
  const [connection, setConnection] = useState<TransportState>("closed");
  const [you, setYou] = useState<PlayerId | null>(null);
  const [peer, setPeer] = useState(false);
  const [ready, setReady] = useState(false);
  const [started, setStarted] = useState(false);
  const [hud, setHud] = useState<VersusHudSnapshot | null>(null);
  const [winner, setWinner] = useState<PlayerId | 0 | null>(null);
  const [rtt, setRtt] = useState(0);
  const [config, setConfig] = useState<VersusConfig | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ---- 接続 ---------------------------------------------------------------
  const connect = useCallback(
    (nextRole: SessionRole, code: string) => {
      const normalized = code.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
      if (!normalized) return;
      setError(null);
      setWinner(null);
      setStarted(false);
      setReady(false);
      setPeer(false);
      setYou(null);
      setRoom(normalized);
      setRole(nextRole);

      const url = new URL(window.location.href);
      url.searchParams.set("room", normalized);
      window.history.replaceState(null, "", url.toString());

      sessionRef.current?.close();
      const session = new VersusSession({
        role: nextRole,
        room: normalized,
        kind,
        serverUrl: configuredServer,
        onState: (state, detail) => {
          setConnection(state);
          setError(detail ?? null);
        },
        onServerMessage: (message) => {
          if (message.t === "joined") {
            setYou(message.you);
            setPeer(message.peer);
            setConfig(message.config);
          }
          if (message.t === "peer") setPeer(message.connected);
          if (message.t === "config" || message.t === "start") setConfig(message.config);
          if (message.t === "start") setStarted(true);
          if (message.t === "over") setWinner(message.winner);
          if (message.t === "error") setError(message.message);
        },
      });
      sessionRef.current = session;
      session.join();
    },
    [kind],
  );

  // ---- 描画ループ ---------------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = V_W * dpr;
    canvas.height = V_H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    input.attach();
    const renderer = new VersusRenderer();
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    let hudAcc = 0;

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const elapsed = Math.min(0.25, (now - last) / 1000);
      last = now;
      acc += elapsed;

      const session = sessionRef.current;
      let steps = 0;
      // P2 は反転した画面で戦っているので、入力もフィールドの向きへ直してから渡す
      const you = session?.client.you ?? 1;
      const fieldInput = toFieldInput(input.get(1), you);
      while (acc >= FIXED_DT && steps < MAX_FRAME_SKIP) {
        session?.update(FIXED_DT, fieldInput, now);
        acc -= FIXED_DT;
        steps += 1;
      }
      if (steps >= MAX_FRAME_SKIP) acc = 0;

      const client = session?.client;
      const view = client?.getView(now) ?? null;
      if (view && client?.you) {
        const { renderable, hud: snapshot } = buildRenderable(view, client.you, settings);
        renderer.draw(ctx, renderable, elapsed);
        hudAcc += elapsed;
        if (hudAcc > 0.08) {
          hudAcc = 0;
          setHud(snapshot);
          setRtt(Math.round(client.rttMs));
        }
      } else {
        ctx.fillStyle = "#05060c";
        ctx.fillRect(0, 0, V_W, V_H);
      }
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      input.detach();
      sessionRef.current?.close();
    };
  }, [settings, input]);

  // 対戦中は画面が消えないようにする（スマホで必須）
  useEffect(() => {
    if (!started) return;
    type WakeLockSentinelLike = { release: () => Promise<void> };
    type NavigatorWithWakeLock = Navigator & {
      wakeLock?: { request: (type: "screen") => Promise<WakeLockSentinelLike> };
    };
    let sentinel: WakeLockSentinelLike | null = null;
    let cancelled = false;
    const request = async () => {
      try {
        const lock = (navigator as NavigatorWithWakeLock).wakeLock;
        if (!lock) return;
        const result = await lock.request("screen");
        if (cancelled) void result.release();
        else sentinel = result;
      } catch {
        // 未対応・拒否されても対戦は続行できる
      }
    };
    void request();
    const onVisible = () => {
      if (document.visibilityState === "visible") void request();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      void sentinel?.release();
    };
  }, [started]);

  const toggleFullscreen = useCallback(() => {
    const element = stageRef.current;
    if (!element) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void element.requestFullscreen?.().catch(() => undefined);
  }, []);

  const handleReady = useCallback(() => {
    setReady(true);
    sessionRef.current?.setReady(true);
  }, []);

  const shareUrl =
    typeof window !== "undefined" && room
      ? `${window.location.origin}${window.location.pathname}?room=${room}`
      : "";

  const copyLink = useCallback(() => {
    if (shareUrl) void navigator.clipboard?.writeText(shareUrl);
  }, [shareUrl]);

  const inLobby = !started || winner !== null;
  const isHost = role === "host";

  return (
    <div className="flex min-h-dvh w-full flex-col items-center justify-center bg-[#05060c] py-4">
      <div
        ref={stageRef}
        className="relative max-h-[calc(100dvh-13rem)] w-full max-w-[480px] overflow-hidden rounded-lg border border-white/10 shadow-[0_0_60px_rgba(90,169,255,0.15)] sm:max-h-[calc(100dvh-2rem)]"
        style={{ aspectRatio: `${V_W} / ${V_H}` }}
      >
        <canvas ref={canvasRef} className="block h-full w-full touch-none bg-black" />

        {hud && started && winner === null && <VersusHud hud={hud} />}

        {started && (
          <div className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 font-mono text-[9px] text-white/35">
            {connection === "open" ? `${rtt}ms` : STATE_LABEL[connection]}
          </div>
        )}

        {inLobby && (
          <div className="absolute inset-0 z-20 flex flex-col gap-3 overflow-y-auto bg-black/88 p-4 text-white backdrop-blur-sm">
            <div className="text-center">
              <div className="font-mono text-[10px] tracking-[0.4em] text-cyan-300/80">ONLINE</div>
              <h1 className="mt-1 bg-gradient-to-r from-sky-300 via-white to-rose-300 bg-clip-text text-2xl font-black text-transparent">
                2台で対戦
              </h1>
            </div>

            {winner !== null && hud && (
              <div className="rounded border border-white/20 bg-white/5 p-3 text-center">
                <div className="font-mono text-[10px] text-white/50">MATCH SET</div>
                <div
                  className="text-xl font-black"
                  style={{ color: winner === you ? "#8dff5a" : "#ff6b6b" }}
                >
                  {winner === 0 ? "引き分け" : winner === you ? "あなたの勝ち" : "あなたの負け"}
                </div>
                <div className="mt-1 font-mono text-[11px] text-white/60">
                  {hud.fighters[0].wins} - {hud.fighters[1].wins}
                </div>
              </div>
            )}

            {!room ? (
              <div className="flex flex-col gap-3">
                <p className="text-[11px] leading-relaxed text-white/70">
                  サーバーは要りません。片方が「部屋を作る」を押すと
                  <span className="font-bold text-cyan-200">その端末が対戦の進行役</span>
                  になります。リンクを相手に送って参加してもらってください。
                </p>

                <div className="rounded border border-white/15 bg-white/5 p-2">
                  <div className="mb-1 font-mono text-[10px] text-white/50">つなぎ方</div>
                  <div className="flex overflow-hidden rounded border border-white/20">
                    {(["p2p", "websocket", "tab"] as TransportKind[])
                      .filter((k) => k !== "websocket" || configuredServer)
                      .map((k) => (
                        <button
                          key={k}
                          onClick={() => setKind(k)}
                          className={`flex-1 px-2 py-1 text-[10px] font-semibold ${
                            kind === k ? "bg-cyan-400/30 text-cyan-100" : "bg-white/[0.03] text-white/60"
                          }`}
                        >
                          {KIND_LABEL[k]}
                        </button>
                      ))}
                  </div>
                  <div className="mt-1 font-mono text-[9px] leading-relaxed text-white/40">
                    {kind === "p2p" && "端末同士を直接つなぎます（顔合わせだけ無料の公開サービスを利用）"}
                    {kind === "websocket" && `ゲームサーバー経由：${configuredServer}`}
                    {kind === "tab" && "同じブラウザで2つのタブを開いて動作を確認する用です"}
                  </div>
                </div>

                <button className={btnPrimary} onClick={() => connect("host", randomRoomCode())}>
                  部屋を作る（この端末が進行役）
                </button>
                <div className="flex gap-2">
                  <input
                    value={inputCode}
                    onChange={(e) =>
                      setInputCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6))
                    }
                    placeholder="部屋コード"
                    maxLength={6}
                    // スマホのキーボードが勝手に補正・小文字化しないようにする
                    autoCapitalize="characters"
                    autoCorrect="off"
                    autoComplete="off"
                    spellCheck={false}
                    className="w-full rounded border border-white/20 bg-black/40 px-3 py-2 text-center font-mono text-lg tracking-[0.3em] text-white placeholder:text-white/30"
                  />
                  <button className={btn} onClick={() => connect("guest", inputCode)} disabled={!inputCode}>
                    参加
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                <div className="rounded border border-white/20 bg-white/5 p-3 text-center">
                  <div className="font-mono text-[10px] text-white/50">
                    部屋コード（{KIND_LABEL[kind]}・{isHost ? "進行役" : "参加者"}）
                  </div>
                  <div className="font-mono text-3xl font-black tracking-[0.3em] text-cyan-200">{room}</div>
                  <button className="mt-2 font-mono text-[10px] text-cyan-300 underline" onClick={copyLink}>
                    参加リンクをコピー
                  </button>
                  <div className="mt-1 break-all font-mono text-[9px] text-white/30">{shareUrl}</div>
                </div>

                <div className="grid grid-cols-2 gap-2 font-mono text-[10px]">
                  <div className="rounded border border-white/15 bg-white/5 p-2">
                    <div className="text-white/50">接続</div>
                    <div className={connection === "open" ? "text-emerald-300" : "text-amber-300"}>
                      {STATE_LABEL[connection]}
                      {you && ` / あなたは P${you}`}
                    </div>
                  </div>
                  <div className="rounded border border-white/15 bg-white/5 p-2">
                    <div className="text-white/50">相手</div>
                    <div className={peer ? "text-emerald-300" : "text-white/40"}>
                      {peer ? "接続済み" : "待機中…"}
                    </div>
                  </div>
                </div>

                {isHost && (
                  <div className="rounded border border-white/15 bg-white/5 p-2">
                    <div className="mb-1 font-mono text-[10px] text-white/50">設定（進行役だけが変更できます）</div>
                    <div className="flex items-center justify-between py-1">
                      <span className="text-[11px]">先取ラウンド</span>
                      <div className="flex overflow-hidden rounded border border-white/20">
                        {[1, 2, 3].map((n) => (
                          <button
                            key={n}
                            onClick={() => sessionRef.current?.setConfig({ roundsToWin: n })}
                            className={`px-2.5 py-1 text-[10px] font-semibold ${
                              config?.roundsToWin === n
                                ? "bg-cyan-400/30 text-cyan-100"
                                : "bg-white/[0.03] text-white/60"
                            }`}
                          >
                            {n}本
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="flex items-center justify-between py-1">
                      <span className="text-[11px]">中立ゾーンの敵</span>
                      <div className="flex overflow-hidden rounded border border-white/20">
                        {(["low", "normal", "high"] as const).map((d) => (
                          <button
                            key={d}
                            onClick={() => sessionRef.current?.setConfig({ enemyDensity: d })}
                            className={`px-2.5 py-1 text-[10px] font-semibold ${
                              config?.enemyDensity === d
                                ? "bg-cyan-400/30 text-cyan-100"
                                : "bg-white/[0.03] text-white/60"
                            }`}
                          >
                            {d === "low" ? "少なめ" : d === "normal" ? "ふつう" : "多め"}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {error && (
                  <div className="rounded border border-rose-400/40 bg-rose-500/10 p-2 text-[11px] text-rose-200">
                    {error}
                  </div>
                )}

                <button className={btnPrimary} onClick={handleReady} disabled={ready && winner === null}>
                  {winner !== null ? "もう一度たたかう" : ready ? "相手の準備を待っています…" : "準備完了"}
                </button>

                {isHost && (
                  <p className="font-mono text-[9px] leading-relaxed text-amber-200/70">
                    進行役の端末は、対戦中この画面を開いたままにしてください。
                    別のアプリに切り替えると試合が止まります。
                  </p>
                )}
              </div>
            )}

            <div className="mt-auto flex gap-2 pt-2">
              <Link href="/versus" className={`${btn} flex-1 text-center`}>
                1台で対戦へ
              </Link>
              <Link href="/" className={`${btn} flex-1 text-center`}>
                1人用へ
              </Link>
            </div>
          </div>
        )}
      </div>

      {started && (
        <TouchPad
          input={input}
          energyRatio={hud ? hud.fighters[0].energy / hud.fighters[0].maxEnergy : 1}
          bombs={hud?.fighters[0].bombs ?? 0}
          onFullscreen={toggleFullscreen}
        />
      )}

      <p className="mt-2 px-4 text-center font-mono text-[10px] text-white/35">
        移動 ← → ↑ ↓ / WASD ・ ショット SPACE ・ ボム 右SHIFT
      </p>
    </div>
  );
}
