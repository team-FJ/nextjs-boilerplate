/**
 * 通信対戦のゲームサーバー（常駐 Node 版）。
 *
 * GameRoom はトランスポート非依存に書いてあるので、このファイルは
 * 「WebSocket と GameRoom を繋ぐだけ」の薄いアダプタになっている。
 * Cloudflare Durable Objects や Deno Deploy に移すときも、差し替えるのはここだけ。
 *
 *   npm run versus-server
 */

import { createServer } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";

import { GameRoom } from "../lib/versus/net/room";
import type { ClientMessage, ServerMessage } from "../lib/versus/net/protocol";
import type { PlayerId } from "../lib/versus/types";

const PORT = Number(process.env.PORT ?? 8787);
const TICK_MS = 1000 / 60;
/** 誰もいない部屋を片付けるまでの猶予 */
const EMPTY_ROOM_TTL_MS = 60_000;

interface RoomEntry {
  room: GameRoom;
  sockets: Map<PlayerId, WebSocket>;
  emptySince: number | null;
}

const rooms = new Map<string, RoomEntry>();

function getRoom(code: string): RoomEntry {
  const existing = rooms.get(code);
  if (existing) return existing;

  const entry: RoomEntry = { room: null as unknown as GameRoom, sockets: new Map(), emptySince: null };
  entry.room = new GameRoom(code, {
    send: (player, message: ServerMessage) => {
      const socket = entry.sockets.get(player);
      if (socket && socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
    },
    onEmpty: () => {
      entry.emptySince = Date.now();
    },
  });
  rooms.set(code, entry);
  console.log(`[room] ${code} を作成（現在 ${rooms.size} 部屋）`);
  return entry;
}

const http = createServer((req, res) => {
  // 死活監視用
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, rooms: rooms.size }));
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ server: http });

wss.on("connection", (socket, request) => {
  const url = new URL(request.url ?? "/", "http://localhost");
  const code = (url.searchParams.get("room") ?? "").toUpperCase().slice(0, 8) || "LOBBY";
  const entry = getRoom(code);
  const player = entry.room.connect();

  if (!player) {
    const message: ServerMessage = { t: "error", code: "full", message: "この部屋は満員です" };
    socket.send(JSON.stringify(message));
    socket.close();
    return;
  }

  entry.emptySince = null;
  entry.sockets.set(player, socket);
  console.log(`[room] ${code} に P${player} が参加`);

  socket.on("message", (data) => {
    try {
      entry.room.receive(player, JSON.parse(String(data)) as ClientMessage);
    } catch {
      // 壊れたメッセージは無視する
    }
  });

  socket.on("close", () => {
    entry.sockets.delete(player);
    entry.room.disconnect(player);
    console.log(`[room] ${code} から P${player} が退出`);
  });

  socket.on("error", () => socket.close());
});

let last = Date.now();
setInterval(() => {
  const now = Date.now();
  const dt = Math.min(0.25, (now - last) / 1000);
  last = now;

  for (const [code, entry] of rooms) {
    entry.room.update(dt);
    if (entry.sockets.size === 0) {
      entry.emptySince ??= now;
      if (now - entry.emptySince > EMPTY_ROOM_TTL_MS) {
        rooms.delete(code);
        console.log(`[room] ${code} を破棄（現在 ${rooms.size} 部屋）`);
      }
    }
  }
}, TICK_MS);

http.listen(PORT, () => {
  console.log(`対戦サーバーを起動しました: ws://localhost:${PORT}`);
  console.log(`同じ Wi-Fi の端末からは ws://<このPCのIP>:${PORT} で接続できます`);
});
