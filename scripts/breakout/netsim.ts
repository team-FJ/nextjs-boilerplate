/**
 * SPIN RALLY 通信対戦のヘッドレス検証。
 *
 *   npm run breakout-netsim
 *
 * 仮想ネットワーク（遅延・ゆらぎ・ロスを注入）に権威サーバーと2クライアントを繋いで、
 * 実機も回線も使わずにネットコードを数値で測る。
 *
 * 測るもの
 *  1. 参加側の入力の向き — **上を押したらスマッシュが出るか**（画面反転と入力反転の対）
 *  2. 技の成立率 — 遅延ごと。ラグ補償が効いていなければ参加側だけ落ちる
 *  3. 巻き戻し量・帯域・古いスナップショットの破棄
 *  4. 勝敗がサーバーと両クライアントで一致するか
 */

import { CpuPlayer } from "../../lib/breakout/ai";
import { DT, type BreakoutEngine } from "../../lib/breakout/engine";
import { BreakoutClient } from "../../lib/breakout/net/client";
import { BreakoutRoom } from "../../lib/breakout/net/room";
import type { ClientMessage, ServerMessage } from "../../lib/breakout/net/protocol";
import { rotateInput } from "../../lib/breakout/net/protocol";
import { createRng } from "../../lib/game/rng";
import { emptyInput, type PlayerInput, type Side } from "../../lib/breakout/types";

const line = (s = "") => console.log(s);
const h1 = (t: string) => {
  line();
  line(`=== ${t} ===`);
};

interface NetProfile {
  label: string;
  /** 片道遅延（ms） */
  latency: number;
  jitter: number;
  loss: number;
}

const PROFILES: NetProfile[] = [
  { label: "理想（往復0ms）", latency: 0, jitter: 0, loss: 0 },
  { label: "同一Wi-Fi（往復20ms）", latency: 10, jitter: 3, loss: 0 },
  { label: "モバイル（往復60ms・ロス1%）", latency: 30, jitter: 8, loss: 0.01 },
  { label: "悪条件（往復120ms・ロス3%）", latency: 60, jitter: 18, loss: 0.03 },
  { label: "最悪（往復200ms・ロス10%）", latency: 100, jitter: 30, loss: 0.1 },
];

/** 仮想の回線。時刻つきのキューで遅延・ゆらぎ・ロスを再現する */
class Link {
  private queue: { at: number; payload: unknown; to: "server" | "client" }[] = [];
  bytesUp = 0;
  bytesDown = 0;

  constructor(
    private profile: NetProfile,
    private rng: () => number,
  ) {}

  send(to: "server" | "client", payload: unknown, now: number) {
    const size = JSON.stringify(payload).length;
    if (to === "server") this.bytesUp += size;
    else this.bytesDown += size;
    if (this.rng() < this.profile.loss) return;
    const delay = this.profile.latency + (this.rng() * 2 - 1) * this.profile.jitter;
    this.queue.push({ at: now + Math.max(0, delay), payload, to });
  }

  /** 届く時刻の順に取り出す（＝ゆらぎで順序が入れ替わることがある） */
  drain(now: number) {
    const due = this.queue.filter((m) => m.at <= now);
    this.queue = this.queue.filter((m) => m.at > now);
    return due;
  }
}

/** 権威サーバーと2クライアントを仮想回線で繋いだ一式 */
function makeMatch(profile: NetProfile, seed: number) {
  const rng = createRng(seed);
  const link = new Link(profile, rng.next);
  const state = { now: 0 };
  const clock = () => state.now;

  // 進行役（side 0）は自分の端末の中でサーバーを動かすので遅延ゼロ。
  // 参加者（side 1）だけが片道の遅延を負う。
  const room = new BreakoutRoom(
    "SIM",
    {
      send: (player: Side, message: ServerMessage) => {
        if (player === 0) host.receive(message);
        else link.send("client", message, state.now);
      },
    },
    { seed, difficulty: "normal" },
  );
  const host = new BreakoutClient({ send: (m: ClientMessage) => room.receive(0, m), now: clock });
  const guest = new BreakoutClient({
    send: (m: ClientMessage) => link.send("server", m, state.now),
    now: clock,
  });

  room.connect();
  room.connect();
  host.join("SIM");
  guest.join("SIM");

  let readySent = false;
  const pump = () => {
    state.now += DT * 1000;
    for (const m of link.drain(state.now)) {
      if (m.to === "server") room.receive(1, m.payload as ClientMessage);
      else guest.receive(m.payload as ServerMessage);
    }
    if (!readySent && host.phase === "lobby" && guest.phase === "lobby") {
      readySent = true;
      host.setReady(true);
      guest.setReady(true);
    }
  };

  return { room, host, guest, link, rng, pump, state };
}

/** クライアントが見ている状態から CPU に考えさせるための仮の姿 */
function viewAsEngine(client: BreakoutClient, frame: number): BreakoutEngine {
  const view = client.view();
  return {
    paddles: view.paddles,
    balls: view.balls,
    blocks: view.blocks,
    tick: frame,
  } as unknown as BreakoutEngine;
}

/**
 * 「自分の画面だけを見て、当たる2フレーム前にきっかり上＋ショットを押す」機械のプレイヤー。
 *
 * CPU 任せでは技の試行数が安定せず測定にならないので、成立率はこれで測る。
 * 見ているのはクライアントの表示だけなので、外挿とラグ補償が効いていなければ成立率が落ちる。
 */
function scriptedInput(
  client: BreakoutClient,
  index: 0 | 1,
  armed: { ready: boolean },
): PlayerInput {
  const input = emptyInput();
  const view = client.view();
  // paddles はサーバーと同じ並び（添字）で入っている
  const me = view.paddles[index];
  if (!me) return input;
  const side: Side = me.side;
  const ball = view.balls.find((b) => (side === 0 ? b.vy > 0 : b.vy < 0));
  if (!ball) {
    // ボールが自分から離れている間に構え直す（1ラリーに1回だけ押す）
    armed.ready = true;
    return input;
  }

  // 追いかける
  const dx = ball.x - me.x;
  input.left = dx < -3;
  input.right = dx > 3;

  const face = me.y + (side === 0 ? -(me.h / 2 + ball.r) : me.h / 2 + ball.r);
  const frames = ((face - ball.y) / (ball.vy || 1)) * 60;
  if (armed.ready && Math.round(frames) === 2) {
    armed.ready = false;
    input.left = input.right = false;
    input.up = true;
    input.fire = true;
  }
  return input;
}

interface SkillResult {
  ok: [number, number];
  fail: [number, number];
  lagAvg: number;
}

/** 技の成立率をラグ込みで測る */
function skillUnderLatency(profile: NetProfile, seconds: number, seed: number): SkillResult {
  const m = makeMatch(profile, seed);
  const ok: [number, number] = [0, 0];
  const fail: [number, number] = [0, 0];
  const armedHost = { ready: true };
  const armedGuest = { ready: true };

  const frames = Math.round(seconds / DT);
  for (let f = 0; f < frames; f++) {
    m.pump();
    const hostInput = scriptedInput(m.host, 0, armedHost);
    const guestField = scriptedInput(m.guest, 1, armedGuest);
    m.host.update(hostInput);
    // 参加側は画面座標で渡す（クライアントの中でフィールド座標へ回す）
    m.guest.update(rotateInput(guestField));
    m.room.update(DT);
    for (const e of m.room.engine.drainEvents()) {
      if (e.type === "skill") {
        if (e.kind === "fail") fail[e.side]++;
        else ok[e.side]++;
      }
      if (e.type === "score" || e.type === "miss") {
        armedHost.ready = true;
        armedGuest.ready = true;
      }
    }
    if (m.room.finished) break;
  }
  const lagAvg =
    m.room.lagSamples.length > 0
      ? m.room.lagSamples.reduce((a, b) => a + b, 0) / m.room.lagSamples.length
      : 0;
  return { ok, fail, lagAvg };
}

interface RunResult {
  profile: NetProfile;
  rollbackAvg: number;
  rollbackMax: number;
  stale: number;
  unackedAvg: number;
  bytesUp: number;
  bytesDown: number;
  seconds: number;
  agreed: boolean;
  finished: boolean;
}

/** CPU 同士で1試合まわして、巻き戻し・帯域・勝敗の一致を測る */
function fullMatch(profile: NetProfile, seed: number): RunResult {
  const m = makeMatch(profile, seed);
  const cpus = [new CpuPlayer(0, 3, m.rng.next), new CpuPlayer(1, 3, m.rng.next)];
  const frames = Math.round(150 / DT);
  for (let f = 0; f < frames; f++) {
    m.pump();
    m.host.update(cpus[0].think(viewAsEngine(m.host, f)));
    m.guest.update(rotateInput(cpus[1].think(viewAsEngine(m.guest, f))));
    m.room.update(DT);
    m.room.engine.drainEvents();
    if (m.room.finished && m.host.phase === "over" && m.guest.phase === "over") break;
  }
  return {
    profile,
    rollbackAvg: m.guest.stats.snapshots > 0 ? m.guest.stats.rollback / m.guest.stats.snapshots : 0,
    rollbackMax: m.guest.stats.rollbackMax,
    stale: m.guest.stats.stale,
    unackedAvg:
      m.guest.stats.snapshots > 0 ? m.guest.stats.unackedTotal / m.guest.stats.snapshots : 0,
    bytesUp: m.link.bytesUp,
    bytesDown: m.link.bytesDown,
    seconds: m.state.now / 1000,
    agreed:
      m.room.finished &&
      m.host.winner === m.room.engine.winner &&
      m.guest.winner === m.room.engine.winner,
    finished: m.room.finished,
  };
}

// ---------------------------------------------------------------- 1. 入力の向き

/**
 * 参加側が「上」を押したらスマッシュが出るか。
 *
 * 教訓：試合が成立することを確認しても、操作が正しいことの確認にはならない。
 * 参加側の上下左右が逆でも試合は最後まで進み、勝敗は両者で一致してしまう。
 */
function directionCheck(): boolean {
  h1("入力の向き（画面の反転と入力の反転が対になっているか）");

  const cases: { label: string; press: Partial<PlayerInput>; expect: string }[] = [
    { label: "ショットのみ", press: {}, expect: "smash" },
    { label: "上＋ショット", press: { up: true }, expect: "drill" },
    { label: "下＋ショット", press: { down: true }, expect: "lob" },
    { label: "右＋ショット", press: { right: true }, expect: "curve" },
    { label: "左＋ショット", press: { left: true }, expect: "curve" },
  ];

  let ok = 0;
  for (const side of [0, 1] as Side[]) {
    for (const c of cases) {
      let now = 0;
      const room = new BreakoutRoom("DIR", { send: () => {} }, { seed: 5, difficulty: "easy" });
      room.connect();
      room.connect();
      const client = new BreakoutClient({ send: (m) => room.receive(side, m), now: () => now });
      // 自分は side 側だと思い込ませる
      client.receive({
        t: "joined",
        you: side,
        room: "DIR",
        config: { difficulty: "easy", mode: "versus" },
        peer: true,
      });
      client.receive({
        t: "start",
        seed: 5,
        config: { difficulty: "easy", mode: "versus" },
        tick: 0,
        firstServe: side,
      });
      room.start(5);

      // ボールを自分のパドルのすぐ手前に置いて、必ず当たる形にする
      const paddle = room.engine.paddles[side];
      const ball = room.engine.balls[0];
      room.engine.phase = "playing";
      ball.x = paddle.x;
      ball.y = paddle.y + (side === 0 ? -60 : 60);
      ball.vx = 0;
      ball.vy = side === 0 ? 300 : -300;

      let got = "";
      for (let f = 0; f < 40 && !got; f++) {
        now += DT * 1000;
        // 押すのは最初の1フレームだけ。押しっぱなしにするとパドルが逃げて当たらない
        const input: PlayerInput =
          f === 0 ? { ...emptyInput(), ...c.press, fire: true } : emptyInput();
        client.update(input);
        room.update(DT);
        for (const e of room.engine.drainEvents()) {
          if (e.type === "skill" && e.side === side) got = e.kind;
        }
      }
      const pass = got === c.expect;
      if (pass) ok++;
      line(
        `${pass ? "OK  " : "NG  "} ${side === 0 ? "進行役" : "参加側"} ${c.label.padEnd(12)} → ${got || "（技が出なかった）"}（期待 ${c.expect}）`,
      );
    }
  }
  return ok === cases.length * 2;
}

// ---------------------------------------------------------------- 協力モード

/** 協力モードが通信でも成立するか（反転しない・ライフ共有・ブロックが一致する） */
function coopCheck(): boolean {
  h1("協力モード（通信2台）");
  const profile = PROFILES[2];
  const rng = createRng(99);
  const link = new Link(profile, rng.next);
  const state = { now: 0 };
  const clock = () => state.now;

  const room = new BreakoutRoom(
    "COOP",
    {
      send: (player: Side, message: ServerMessage) => {
        if (player === 0) host.receive(message);
        else link.send("client", message, state.now);
      },
    },
    { seed: 99, difficulty: "normal", mode: "coop" },
  );
  const host = new BreakoutClient({ send: (m: ClientMessage) => room.receive(0, m), now: clock });
  const guest = new BreakoutClient({
    send: (m: ClientMessage) => link.send("server", m, state.now),
    now: clock,
  });
  room.connect();
  room.connect();
  host.join("COOP");
  guest.join("COOP");

  let readySent = false;
  const armed = [{ ready: true }, { ready: true }];
  let chainSeen = 0;
  for (let f = 0; f < Math.round(60 / DT); f++) {
    state.now += DT * 1000;
    for (const m of link.drain(state.now)) {
      if (m.to === "server") room.receive(1, m.payload as ClientMessage);
      else guest.receive(m.payload as ServerMessage);
    }
    if (!readySent && host.phase === "lobby" && guest.phase === "lobby") {
      readySent = true;
      host.setReady(true);
      guest.setReady(true);
    }
    host.update(scriptedInput(host, 0, armed[0]));
    guest.update(scriptedInput(guest, 1, armed[1]));
    room.update(DT);
    for (const e of room.engine.drainEvents()) if (e.type === "chain") chainSeen++;
    if (room.finished) break;
  }

  const aliveServer = room.engine.blocks.filter((b) => b.alive).length;
  const aliveGuest = guest.view().blocks.filter((b) => b.alive).length;
  const checks: [string, boolean, string][] = [
    ["どちらの画面も反転しない", !host.view().flip && !guest.view().flip, ""],
    ["2枚とも下側にいる", host.view().paddles.every((p) => p.side === 0 && p.y > 500), ""],
    ["ライフが残っている", room.engine.lives > 0, `残 ${room.engine.lives}`],
    ["ブロックを崩している", room.engine.blocks.some((b) => !b.alive), `残 ${aliveServer}`],
    ["参加側のブロックがサーバーと一致", aliveGuest === aliveServer, `${aliveGuest} / ${aliveServer}`],
    ["スコアが入っている", room.engine.totalScore() > 0, `${room.engine.totalScore()}`],
  ];
  let ok = true;
  for (const [label, pass, detail] of checks) {
    if (!pass) ok = false;
    line(`${pass ? "OK  " : "NG  "} ${label}${detail ? `  — ${detail}` : ""}`);
  }
  line(`（連携チェイン成立 ${chainSeen} 回。機械のプレイヤーは常に上＋ショットなので 0 でよい）`);
  return ok;
}

// ---------------------------------------------------------------- 実行

line("SPIN RALLY 通信対戦のヘッドレス検証");
line("サーバー権威＋クライアント予測＋巻き戻し補正 / ボールは補間せず外挿 / 技はラグ補償");

const directionOk = directionCheck();
const coopOk = coopCheck();

h1("技の成立率（当たる2フレーム前にきっかり押す機械のプレイヤー）");
line("回線                            進行役          参加側          ラグ補償");
const skills = PROFILES.map((p) => ({ profile: p, r: skillUnderLatency(p, 60, 4242) }));
for (const { profile, r } of skills) {
  const rate = (i: 0 | 1) => {
    const total = r.ok[i] + r.fail[i];
    return total === 0 ? "   -        " : `${((r.ok[i] / total) * 100).toFixed(0)}% (${total}回)`.padEnd(12);
  };
  line(`${profile.label.padEnd(30)} ${rate(0)}  ${rate(1)}  ${r.lagAvg.toFixed(1)}F`);
}

h1("巻き戻し・帯域・勝敗の一致（CPU 同士で1試合）");
line("回線                            巻き戻し平均  最大    未確定入力  下り/上り kbps  古い破棄  勝敗一致");
const runs = PROFILES.map((p) => fullMatch(p, 777));
for (const r of runs) {
  const kbps = (bytes: number) => ((bytes * 8) / Math.max(1, r.seconds) / 1000).toFixed(0);
  line(
    `${r.profile.label.padEnd(30)} ${r.rollbackAvg.toFixed(2).padStart(8)}px ${r.rollbackMax
      .toFixed(1)
      .padStart(6)}px  ${r.unackedAvg.toFixed(1).padStart(6)}本  ${kbps(r.bytesDown).padStart(5)} / ${kbps(
      r.bytesUp,
    ).padStart(4)}     ${String(r.stale).padStart(4)}     ${r.agreed ? "○" : r.finished ? "×" : "（時間切れ）"}`,
  );
}

h1("判定");
const problems: string[] = [];
if (!directionOk) problems.push("入力の向きが正しくない（画面の反転と入力の反転がずれている）");
if (!coopOk) problems.push("協力モードの通信対戦が成立していない");

const worst = skills[skills.length - 1].r;
const rateOf = (r: SkillResult, i: 0 | 1) => {
  const total = r.ok[i] + r.fail[i];
  return total === 0 ? 0 : r.ok[i] / total;
};
if (skills.some(({ r }) => r.ok[1] + r.fail[1] === 0)) {
  problems.push("参加側の技が一度も出ていない（入力が届いていない可能性）");
} else if (rateOf(worst, 1) < rateOf(worst, 0) - 0.25) {
  problems.push(
    `最悪条件で参加側の技の成立率が落ちすぎている（進行 ${(rateOf(worst, 0) * 100).toFixed(0)}% / 参加 ${(rateOf(worst, 1) * 100).toFixed(0)}%）`,
  );
}
if (runs.some((r) => r.rollbackAvg > 8)) problems.push("巻き戻しが大きい（自機予測がサーバーとずれている）");
if (runs.some((r) => r.finished && !r.agreed)) problems.push("勝敗がサーバーとクライアントで食い違った");

if (problems.length === 0) {
  line("問題なし");
} else {
  problems.forEach((p) => line(`- ${p}`));
  process.exitCode = 1;
}
