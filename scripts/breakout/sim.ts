/**
 * SPIN RALLY のヘッドレス検証。
 *
 * ブラウザも実機も使わずに、バランスと物理を数値で確かめる。
 *   npm run breakout-sim
 *
 * 測るもの
 *  1. 対戦：CPU 同士のラウンドで上下の有利不利・平均試合時間・技の使用内訳
 *  2. 技  ：難易度ごとの成立率（ジャストミートの窓が効いているか）
 *  3. カーブ：真横に打ったときの曲がり幅が仕様（約90px）どおりか
 *  4. 安全 ：ボールが場外へ抜けない（すり抜けが起きていない）
 */

import { CPU_LEVELS, CpuPlayer, type CpuLevel } from "../../lib/breakout/ai";
import {
  BALL_MIN_SPEED,
  BALL_START_SPEED,
  H,
  SOLO_PADDLE_Y,
  V_ZONE_BOTTOM,
  V_ZONE_TOP,
  W,
} from "../../lib/breakout/constants";
import { BreakoutEngine, DT } from "../../lib/breakout/engine";
import { createRng } from "../../lib/game/rng";
import { emptyInput, type Difficulty, type PlayerInput } from "../../lib/breakout/types";

const line = (s = "") => console.log(s);

function h1(title: string) {
  line();
  line(`=== ${title} ===`);
}

// ---------------------------------------------------------------- 1. 対戦バランス

function versusRounds(rounds: number, level: CpuLevel) {
  const rng = createRng(20260730);
  let winsBottom = 0;
  let winsTop = 0;
  let draws = 0;
  let totalTime = 0;
  const points = [0, 0];
  const timeUps = { count: 0 };
  // 「なぜ点が入らないのか」を切り分けるための内訳
  let zoneEntries = 0;
  let bandLeftTotal = 0;
  let bandStartTotal = 0;
  let outOfBounds = 0;
  const skills = { smash: 0, drill: 0, curve: 0, lob: 0, fail: 0 };
  let items = 0;
  let itemMisattributed = 0;

  for (let r = 0; r < rounds; r++) {
    const engine = new BreakoutEngine({
      mode: "versus",
      difficulty: "normal",
      seed: 1000 + r,
      // 開幕サーブは交互に。どちらから始めるかで勝率が動くため、揃えると偏る
      firstServe: (r % 2) as 0 | 1,
    });
    const cpus = [
      new CpuPlayer(0, level, rng.next),
      new CpuPlayer(1, level, rng.next),
    ];
    let frames = 0;
    let inZone = false;
    bandStartTotal += engine.blocks.length;
    while (engine.phase !== "gameOver" && frames < 60 * 150) {
      const inputs = cpus.map((c) => c.think(engine));
      engine.step(inputs);
      for (const e of engine.drainEvents()) {
        if (e.type === "skill") skills[e.kind]++;
        if (e.type === "item") items++;
      }
      for (const b of engine.balls) {
        if (b.x < -20 || b.x > W + 20 || b.y < -60 || b.y > H + 60) outOfBounds++;
      }
      // ボールが「どちらかの陣地まで入り込んだ」回数＝得点機会の数
      const ball = engine.balls[0];
      const nowInZone = !!ball && (ball.y > V_ZONE_BOTTOM.top || ball.y < V_ZONE_TOP.bottom);
      if (nowInZone && !inZone) zoneEntries++;
      inZone = nowInZone;
      // アイテムは必ず持ち主の陣地側へ落ちる
      for (const it of engine.items) {
        const goingDown = it.vy > 0;
        if ((it.owner === 0) !== goingDown) itemMisattributed++;
      }
      frames++;
    }
    totalTime += frames * DT;
    points[0] += engine.paddles[0].points;
    points[1] += engine.paddles[1].points;
    if (engine.timeLeft <= 0) timeUps.count++;
    bandLeftTotal += engine.blocks.filter((b) => b.alive).length;
    if (engine.winner === 0) winsBottom++;
    else if (engine.winner === 1) winsTop++;
    else draws++;
  }

  h1(`対戦バランス（CPU Lv${level} 同士 / ${rounds}ラウンド）`);
  line(`勝敗（下-上）      : ${winsBottom}-${winsTop}${draws ? ` （引き分け ${draws}）` : ""}`);
  line(`平均ラウンド時間   : ${(totalTime / rounds).toFixed(1)} 秒（時間切れ ${timeUps.count} / ${rounds}）`);
  line(`総得点（下-上）    : ${points[0]}-${points[1]}`);
  line(`得点機会（陣地侵入）: ${zoneEntries} 回 → 得点 ${points[0] + points[1]} 回（決定率 ${((points[0] + points[1]) / Math.max(1, zoneEntries) * 100).toFixed(1)}%）`);
  line(`中立ブロック残り    : ${(bandLeftTotal / rounds).toFixed(1)} / ${(bandStartTotal / rounds).toFixed(1)}`);
  line(`技の内訳           : スマッシュ ${skills.smash} / ドリル ${skills.drill} / カーブ ${skills.curve} / ボレー ${skills.lob} / 空振り ${skills.fail}`);
  line(`技の成立率         : ${((1 - skills.fail / Math.max(1, skills.smash + skills.drill + skills.curve + skills.lob + skills.fail)) * 100).toFixed(1)} %`);
  line(`アイテム取得       : ${items} 件（帰属ミス ${itemMisattributed} 件）`);
  line(`場外へ抜けた回数   : ${outOfBounds}`);
  return { winsBottom, winsTop, outOfBounds, itemMisattributed };
}

// ---------------------------------------------------------------- 2. 技の成立率

/** 接触の N フレーム前にきっかり押す「機械のような」プレイヤーで判定窓を測る */
function skillWindow(difficulty: Difficulty, pressAt: number) {
  const engine = new BreakoutEngine({ mode: "solo", difficulty, seed: 7 });
  const paddle = engine.paddles[0];
  let success = 0;
  let fail = 0;
  let pressed = false;

  for (let f = 0; f < 60 * 60; f++) {
    const input: PlayerInput = emptyInput();
    const ball = engine.balls[0];
    if (ball) {
      // 常に真下で受ける
      const dx = ball.x - paddle.x;
      input.left = dx < -4;
      input.right = dx > 4;
      const frames = ball.vy > 0 ? ((paddle.y - paddle.h / 2 - ball.r - ball.y) / ball.vy) * 60 : 999;
      // エンジン側は整数フレームで判定するので、丸めた値で押す位置を決める
      if (Math.round(frames) === pressAt && !pressed) {
        input.up = true;
        input.left = input.right = false;
        input.fire = true;
        pressed = true;
      }
      if (frames > pressAt + 2) pressed = false;
    }
    engine.step([input]);
    for (const e of engine.drainEvents()) {
      if (e.type === "skill") {
        if (e.kind === "fail") fail++;
        else success++;
      }
    }
    if (engine.phase === "gameOver" || engine.phase === "stageClear") break;
  }
  return { success, fail };
}

function skillReport() {
  h1("技の判定窓（接触の何フレーム前に押したか → 成立 / 空振り）");
  const diffs: Difficulty[] = ["easy", "normal", "hard", "expert"];
  line("押した位置  " + diffs.map((d) => d.padEnd(10)).join(""));
  for (const pressAt of [2, 4, 6, 10, 14]) {
    const cells = diffs.map((d) => {
      const r = skillWindow(d, pressAt);
      return `${r.success}/${r.fail}`.padEnd(10);
    });
    line(`${String(pressAt).padStart(2)}F前       ` + cells.join(""));
  }
  line("（左が成立・右が空振り。やさしいは溜め方式なので常に成立する）");
}

// ---------------------------------------------------------------- 3. カーブの曲がり幅

function curveWidth(): { early: number; total: number } {
  h1("カーブの曲がり幅（真横＋ショット）");
  const engine = new BreakoutEngine({ mode: "solo", difficulty: "easy", seed: 3 });
  // ブロックはどけるが、1個も無いと即ステージクリアになるので届かない位置にダミーを残す
  engine.blocks = [
    { ...engine.blocks[0], x: 0, y: -400, baseX: 0, kind: "normal", hp: 1, alive: true },
  ];
  engine.phase = "playing";
  const paddle = engine.paddles[0];
  const ball = engine.balls[0];
  ball.x = W / 2;
  ball.y = SOLO_PADDLE_Y - 40;
  ball.vx = 0;
  ball.vy = BALL_START_SPEED;
  paddle.x = W / 2;

  // 真横＋ショット（やさしい＝溜め方式なので、接触した瞬間に必ず成立する）
  const press: PlayerInput = emptyInput();
  press.right = true;
  press.fire = true;
  engine.step([press]);

  // 技が成立した瞬間の状態を捕まえる
  let curved = false;
  let x0 = 0;
  let y0 = 0;
  let vx0 = 0;
  let vy0 = 0;
  let elapsed = 0;
  let maxDrift = 0;
  let speedDrift = 0;
  const hold: PlayerInput = emptyInput();
  hold.right = true;

  // 打った直後にどれだけ曲がって見えるかが体感を決めるので、時間ごとに測る
  const marks = [0.25, 0.5, 0.75, 1.0];
  const atMark: number[] = [];
  let bounced = false;
  for (let f = 0; f < 240; f++) {
    engine.step([hold]);
    for (const e of engine.drainEvents()) {
      if (e.type === "wall" && curved) bounced = true;
      if (e.type === "skill" && e.kind === "curve" && !curved) {
        curved = true;
        x0 = ball.x;
        y0 = ball.y;
        vx0 = ball.vx;
        vy0 = ball.vy;
      }
    }
    if (!curved) continue;
    if (bounced) break;
    elapsed += DT;
    // 曲がらなかった場合（初速のまま直進）との差
    const straightX = x0 + vx0 * elapsed;
    const drift = Math.abs(ball.x - straightX);
    maxDrift = Math.max(maxDrift, drift);
    while (atMark.length < marks.length && elapsed >= marks[atMark.length]) atMark.push(drift);
    speedDrift = Math.max(speedDrift, Math.abs(Math.hypot(ball.vx, ball.vy) - Math.hypot(vx0, vy0)));
    if (ball.y < 120 || ball.y > SOLO_PADDLE_Y) break;
  }

  if (!curved) {
    line("カーブが成立しなかった");
    return { early: -1, total: -1 };
  }
  line(`打ち出し速度       : ${Math.hypot(vx0, vy0).toFixed(0)} px/s（打つ前 ${BALL_START_SPEED}）`);
  line(`打ち出し位置       : (${x0.toFixed(0)}, ${y0.toFixed(0)})`);
  line(
    `時間ごとのズレ     : ${marks
      .map((m, i) => `${m}s=${(atMark[i] ?? maxDrift).toFixed(0)}px`)
      .join(" / ")}`,
  );
  line(`直進との最大差     : ${maxDrift.toFixed(1)} px（壁で跳ね返るまで）`);
  line("（体感を決めるのは 0.5秒時点のズレ。ここが小さいと「曲がらない」と感じる）");
  line(`速度のブレ         : ${speedDrift.toFixed(2)} px/s（カーブは向きだけ変える＝0に近いこと）`);
  return { early: atMark[1] ?? maxDrift, total: maxDrift };
}

// ---------------------------------------------------------------- 3.5 ボレーの射程

/**
 * ボレーがどこまで飛ぶか。
 *
 * 「すぐ戻ってきて使い道がない」という指摘を数値で確かめる。
 * 1人モードではパドル（y=660）からブロックの底（y≒336）まで 324px あり、
 * ロブが切れる前にそこを越えられなければ「ブロックを飛び越える技」として成立しない。
 */
function lobRange() {
  h1("ボレーの射程（真下＋ショット）");
  const engine = new BreakoutEngine({ mode: "solo", difficulty: "easy", seed: 3 });
  // ブロックは届かない位置へ逃がす（当たると跳ね返って射程が測れない）
  engine.blocks = engine.blocks.map((b) => ({ ...b, y: -400, baseX: b.x }));
  engine.phase = "playing";
  const paddle = engine.paddles[0];
  const ball = engine.balls[0];
  ball.x = W / 2;
  ball.y = SOLO_PADDLE_Y - 40;
  ball.vx = 0;
  ball.vy = BALL_START_SPEED;
  paddle.x = W / 2;

  const press: PlayerInput = emptyInput();
  press.down = true;
  press.fire = true;
  engine.step([press]);

  let lobbed = false;
  let y0 = 0;
  let peak = SOLO_PADDLE_Y;
  let endY = SOLO_PADDLE_Y;
  let lobFrames = 0;
  for (let f = 0; f < 400; f++) {
    engine.step([emptyInput()]);
    for (const e of engine.drainEvents()) {
      if (e.type === "skill" && e.kind === "lob" && !lobbed) {
        lobbed = true;
        y0 = ball.y;
      }
    }
    if (!lobbed) continue;
    if (ball.lob > 0) {
      lobFrames++;
      endY = ball.y;
      peak = Math.min(peak, ball.y);
    } else {
      break;
    }
  }

  if (!lobbed) {
    line("ボレーが成立しなかった");
    return -1;
  }
  const rise = y0 - peak;
  line(`打ち出し位置       : y=${y0.toFixed(0)}`);
  line(`ロブが続いた時間   : ${(lobFrames / 60).toFixed(2)} 秒`);
  line(`最高到達点         : y=${peak.toFixed(0)}（${rise.toFixed(0)}px 上昇）`);
  line(`ロブが切れた位置   : y=${endY.toFixed(0)}`);
  line(`ブロックの底(336)  : ${peak < 336 ? "越えられる" : "届かない"}`);
  return rise;
}

// ---------------------------------------------------------------- 4. 1人モード通し

function soloRun(difficulty: Difficulty, stages: number, gravity: boolean) {
  h1(`1人モード通し（${difficulty} / ${stages}面 / 軽い重力 ${gravity ? "あり" : "なし"}）`);
  const engine = new BreakoutEngine({ mode: "solo", difficulty, seed: 42, gravity });
  let cleared = 0;
  let frames = 0;
  let outOfBounds = 0;
  let stuckFrames = 0;
  let stageStart = 0;
  const perStage: string[] = [];
  const budget = 60 * 180; // 1ステージ 180秒まで

  while (cleared < stages && frames - stageStart < budget) {
    const input: PlayerInput = emptyInput();
    const paddle = engine.paddles[0];
    const ball = engine.balls[0];
    if (ball) {
      // 残っているブロックの方へ打ち返せるよう、当てる位置をずらして狙う。
      // 常にボールの真下で受けると反射角が固定され、最後の1個に永久に届かない
      const target = engine.blocks.filter((b) => b.alive && b.kind !== "solid")[0];
      const aim = target ? target.x + target.w / 2 : ball.x;
      const offset = Math.max(-1, Math.min(1, (aim - ball.x) / 150)) * (paddle.w / 2) * 0.85;
      const dx = ball.x - offset - paddle.x;
      input.left = dx < -3;
      input.right = dx > 3;
      if (ball.x < -20 || ball.x > W + 20 || ball.y > H + 60) outOfBounds++;
      // 重力を入れると頂点で vy≒0 を通るので、速さそのもので見る
      if (Math.hypot(ball.vx, ball.vy) < 80) stuckFrames++;
    }
    engine.step([input]);
    engine.drainEvents();
    if (engine.phase === "stageClear") {
      cleared++;
      perStage.push(`${((frames - stageStart) * DT).toFixed(0)}s`);
      stageStart = frames;
      engine.nextStage();
      engine.phase = "playing";
    }
    if (engine.phase === "gameOver") break;
    frames++;
  }
  line(`クリアしたステージ : ${cleared} / ${stages}`);
  line(`ステージ別の時間   : ${perStage.join(" ") || "-"}`);
  line(`残ライフ           : ${engine.lives}`);
  line(`スコア             : ${engine.totalScore()}`);
  line(`所要時間           : ${(frames * DT).toFixed(1)} 秒`);
  line(`場外へ抜けた回数   : ${outOfBounds}`);
  line(`ボールが止まった   : ${stuckFrames} フレーム`);
  return { cleared, outOfBounds, stuckFrames };
}

// ---------------------------------------------------------------- 実行

line("SPIN RALLY ヘッドレス検証");
line(`固定タイムステップ ${(1 / DT).toFixed(0)}Hz / 最低速度 ${BALL_MIN_SPEED}px/s`);
line(`CPU レベル: ${Object.entries(CPU_LEVELS).map(([k, v]) => `${k}=${v.label}`).join(" ")}`);

// 軽い重力は設定で切り替えられるので、両方測る
const soloFlat = soloRun("normal", 5, false);
const solo = soloRun("normal", 5, true);
const curve = curveWidth();
const lob = lobRange();
skillReport();
const versus = versusRounds(40, 3);

h1("判定");
const problems: string[] = [];
if (solo.outOfBounds > 0) problems.push("1人モードでボールが場外へ抜けた");
if (solo.stuckFrames > 0) problems.push("ボールが停止した");
if (solo.cleared < 5) problems.push("1人モードでステージをクリアできなかった（重力あり）");
if (soloFlat.cleared < 5) problems.push("1人モードでステージをクリアできなかった（重力なし）");
if (versus.outOfBounds > 0) problems.push("対戦でボールが場外へ抜けた");
if (versus.itemMisattributed > 0) problems.push("アイテムの帰属がずれた");
// 0.5秒で 35px 未満だと「曲がって見えない」。逆に大きすぎると軌道を支配してしまう
if (curve.early < 35) problems.push(`カーブが効き始めるのが遅い（0.5秒で ${curve.early.toFixed(0)}px）`);
if (curve.early > 130) problems.push(`カーブが強すぎる（0.5秒で ${curve.early.toFixed(0)}px）`);
// ボレーはブロックの底（324px 先）を越えられないと「飛び越える技」にならない
if (lob < 330) problems.push(`ボレーの射程が足りない（${lob.toFixed(0)}px 上昇）`);
const spread = Math.abs(versus.winsBottom - versus.winsTop);
if (spread > 14) problems.push(`上下の勝率が偏っている（差 ${spread}）`);

if (problems.length === 0) {
  line("問題なし");
} else {
  problems.forEach((p) => line(`- ${p}`));
  process.exitCode = 1;
}
