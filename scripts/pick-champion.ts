/**
 * 学習した島（並列に走らせた別々の集団）の中から、いちばん強い個体を選ぶ。
 *
 * 各島は自分のリーグの中でのスコアしか持っていない。到達したリーグが違えば
 * その数字は比べられないので、ここで総当たりの対戦をして決める。
 * 手書き CPU に対する勝率も出して、実際に強くなっているかを確かめる。
 *
 * 使い方:
 *   npx esbuild scripts/pick-champion.ts --bundle --platform=node --format=esm \
 *     --outfile=.pick.mjs --alias:@=. && node .pick.mjs .islands/isle*.json
 */
import { readFileSync, writeFileSync } from "node:fs";

import { SilentAudio } from "../lib/game/audio";
import { DEFAULT_SETTINGS } from "../lib/game/constants";
import { VersusAi } from "../lib/versus/ai";
import { COURSE_IDS } from "../lib/versus/courses";
import { VersusEngine } from "../lib/versus/engine";
import { NeuralAi } from "../lib/versus/neural";
import type { CourseId, CpuLevel, FighterInput, PlayerId, VersusConfig } from "../lib/versus/types";

const FILES = process.argv.slice(2);
const OUT = "lib/versus/neuralWeights.ts";

interface Contender {
  name: string;
  make: (id: PlayerId, seed: number) => { update: (e: VersusEngine, dt: number) => FighterInput };
  weights?: number[];
}

const handwritten = (level: CpuLevel): Contender => ({
  name: level,
  make: (id, seed) => new VersusAi(id, level, seed),
});

const learned = (name: string, w: number[]): Contender => ({
  name,
  weights: w,
  make: (id) => {
    const ai = new NeuralAi(id, w);
    return { update: (e: VersusEngine) => ai.update(e) };
  },
});

/** 1試合。1 = A の勝ち / -1 = B の勝ち / 0 = 引き分け */
function playMatch(a: Contender, b: Contender, seed: number, course: CourseId): number {
  const config: VersusConfig = {
    mode: "cpu",
    cpuLevel: "normal",
    roundsToWin: 1,
    enemyDensity: "normal",
    course,
  };
  const engine = new VersusEngine({ ...DEFAULT_SETTINGS }, new SilentAudio(), config);
  const p1 = a.make(1, seed + 11);
  const p2 = b.make(2, seed + 22);
  engine.startMatch(config, seed);
  const dt = 1 / 60;
  let frames = 0;
  while (engine.matchWinner === null && frames < 60 * 140) {
    engine.update(dt, [p1.update(engine, dt), p2.update(engine, dt)]);
    if (engine.phase === "roundEnd") {
      const pend = engine.pendingBoost;
      if (pend) engine.pickBoost(pend.player, pend.options[0]);
      if (engine.roundEndTimer <= 0 && !engine.waitingForBoost) engine.nextRound();
    }
    frames += 1;
  }
  return engine.matchWinner === 1 ? 1 : engine.matchWinner === 2 ? -1 : 0;
}

/** A の勝率（上下を入れ替えて有利不利を打ち消す） */
function winRate(a: Contender, b: Contender, matches: number, seedBase = 5000): number {
  let win = 0;
  for (let m = 0; m < matches; m++) {
    const course = COURSE_IDS[m % COURSE_IDS.length];
    const seed = seedBase + m * 6367;
    const r = m % 2 === 0 ? playMatch(a, b, seed, course) : -playMatch(b, a, seed, course);
    if (r > 0) win += 1;
    else if (r === 0) win += 0.5;
  }
  return win / matches;
}

function main() {
  if (FILES.length === 0) throw new Error("島のファイルを指定してください");
  const islands = FILES.map((f, i) => {
    const data = JSON.parse(readFileSync(f, "utf8")) as { w: number[]; score: number; tier: number };
    return { contender: learned(`島${i + 1}`, data.w), tier: data.tier, score: data.score };
  });

  console.log("=== 島どうしの総当たり ===");
  const wins = islands.map(() => 0);
  for (let i = 0; i < islands.length; i++) {
    for (let j = i + 1; j < islands.length; j++) {
      const r = winRate(islands[i].contender, islands[j].contender, 24, 9000 + i * 100 + j);
      wins[i] += r;
      wins[j] += 1 - r;
      console.log(`  ${islands[i].contender.name} vs ${islands[j].contender.name}: ${(r * 100).toFixed(0)}%`);
    }
  }
  const order = islands.map((isl, i) => ({ isl, i, w: wins[i] })).sort((a, b) => b.w - a.w);
  const champ = order[0].isl;
  console.log(
    `\n勝ち残り: ${champ.contender.name}（到達リーグ ${champ.tier} / 学習時スコア ${champ.score.toFixed(2)}）`,
  );

  console.log("\n=== 手書き CPU との対戦（各60試合） ===");
  const levels: CpuLevel[] = ["rookie", "normal", "veteran", "ace"];
  for (const lv of levels) {
    const r = winRate(champ.contender, handwritten(lv), 60, 12345);
    console.log(`  vs ${lv.padEnd(8)} 勝率 ${(r * 100).toFixed(1)}%`);
  }

  const w = champ.contender.weights ?? [];
  writeFileSync(
    OUT,
    `// 自動生成。scripts/train-cpu.ts が自己対戦の進化戦略で求めた重み。\n` +
      `// scripts/pick-champion.ts が複数の学習結果を対戦させて選んだもの。\n` +
      `// 手で編集しないでください。再学習すると丸ごと差し替わります。\n` +
      `export const NEURAL_WEIGHTS: number[] = ${JSON.stringify(w)};\n`,
  );
  console.log(`\n${OUT} に保存（${w.length} 個）`);
}

main();
