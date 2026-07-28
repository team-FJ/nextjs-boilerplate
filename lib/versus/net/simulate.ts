/**
 * 通信対戦のオフライン検証用ハーネス。
 *
 * サーバー(GameRoom) と 2 クライアント(NetClient) を仮想ネットワークで繋ぎ、
 * 遅延・ゆらぎ・パケットロスを注入した状態で試合を最後まで回して指標を返す。
 * ブラウザも実機も使わずにネットコードの良し悪しを測れるようにしてある。
 */

import { VersusAi } from "../ai";
import type { CpuLevel, PlayerId } from "../types";
import { NetClient } from "./client";
import { VirtualNetwork, type LinkConditions } from "./loopback";
import type { ClientMessage, ServerMessage } from "./protocol";
import { GameRoom } from "./room";

const FRAME_MS = 1000 / 60;

export interface SimulateOptions {
  conditions: LinkConditions;
  seed?: number;
  /** 打ち切りまでの秒数 */
  maxSeconds?: number;
  cpuLevel?: CpuLevel;
}

export interface SimulateResult {
  finished: boolean;
  winner: PlayerId | 0 | null;
  /** 両クライアントとサーバーで勝敗が一致したか */
  agree: boolean;
  seconds: number;
  rounds: number;
  /** スナップショット到着時の巻き戻し量（px）。小さいほど自機がガクつかない */
  correctionMean: number;
  correctionMax: number;
  /** 自機の表示がサーバーより先行している量（px）。遅延ぶんの当然の差 */
  aheadMean: number;
  /** 相手機の表示遅れ（px） */
  opponentLagMean: number;
  downstreamKbps: number;
  upstreamKbps: number;
  /** サーバーで入力が間に合わなかった回数 */
  starvation: [number, number];
  measuredRtt: [number, number];
}

export function simulateNetworkMatch(options: SimulateOptions): SimulateResult {
  const seed = options.seed ?? 42;
  const maxSeconds = options.maxSeconds ?? 300;
  const down = new VirtualNetwork({ ...options.conditions, seed });
  const up = new VirtualNetwork({ ...options.conditions, seed: seed + 1 });

  const clients = {} as Record<PlayerId, NetClient>;
  const room = new GameRoom(
    "SIM",
    { send: (player, message: ServerMessage) => down.send(message, () => clients[player].handle(message, down.now)) },
    { seed },
  );
  const makeClient = (id: PlayerId) =>
    new NetClient({ send: (message: ClientMessage) => up.send(message, () => room.receive(id, message)) });

  clients[1] = makeClient(1);
  clients[2] = makeClient(2);
  room.connect();
  room.connect();
  clients[1].join("SIM");
  clients[2].join("SIM");
  clients[1].setReady(true);
  clients[2].setReady(true);

  const level = options.cpuLevel ?? "normal";
  const ai: Record<PlayerId, VersusAi> = {
    1: new VersusAi(1, level, seed + 100),
    2: new VersusAi(2, level, seed + 200),
  };

  const corrections: number[] = [];
  const ahead: number[] = [];
  const opponentLag: number[] = [];
  const seen: Record<number, number> = { 1: 0, 2: 0 };
  let seconds = 0;
  let rounds = 1;

  for (let frame = 0; frame < 60 * maxSeconds; frame++) {
    const dt = FRAME_MS / 1000;
    seconds += dt;
    up.advance(FRAME_MS);
    down.advance(FRAME_MS);

    for (const id of [1, 2] as PlayerId[]) {
      clients[id].update(dt, ai[id].update(room.engine, dt), down.now);
    }
    room.update(dt);
    rounds = room.engine.round;

    for (const id of [1, 2] as PlayerId[]) {
      const client = clients[id];
      if (client.snapshotsApplied !== seen[id]) {
        seen[id] = client.snapshotsApplied;
        if (room.engine.phase === "fighting") corrections.push(client.lastCorrection);
      }
      const view = client.getView(down.now);
      if (!view || room.engine.phase !== "fighting") continue;
      const mine = view.fighters[id - 1];
      const truth = room.engine.fighters[id - 1];
      ahead.push(Math.hypot(mine.x - truth.x, mine.y - truth.y));
      const foe = view.fighters[id === 1 ? 1 : 0];
      const foeTruth = room.engine.fighters[id === 1 ? 1 : 0];
      opponentLag.push(Math.hypot(foe.x - foeTruth.x, foe.y - foeTruth.y));
    }

    if (room.finished) {
      // 決着の通知が両者へ届くまで流し切る
      for (let i = 0; i < 120; i++) {
        up.advance(FRAME_MS);
        down.advance(FRAME_MS);
      }
      break;
    }
  }

  const mean = (values: number[]) => (values.length ? values.reduce((s, v) => s + v, 0) / values.length : 0);

  return {
    finished: room.finished,
    winner: room.engine.matchWinner,
    agree:
      clients[1].matchWinner === clients[2].matchWinner &&
      clients[1].matchWinner === (room.engine.matchWinner ?? 0),
    seconds,
    rounds,
    correctionMean: mean(corrections),
    correctionMax: corrections.length ? Math.max(...corrections) : 0,
    aheadMean: mean(ahead),
    opponentLagMean: mean(opponentLag),
    downstreamKbps: (down.bytes / seconds / 1024) * 8,
    upstreamKbps: (up.bytes / seconds / 1024) * 8,
    starvation: [room.starvation(1), room.starvation(2)],
    measuredRtt: [Math.round(clients[1].rttMs), Math.round(clients[2].rttMs)],
  };
}
