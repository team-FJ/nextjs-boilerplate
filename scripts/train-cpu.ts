/**
 * 対戦 CPU を自己対戦で学習させる（開発用。ゲーム本体には含まれない）。
 *
 * 方式は進化戦略（誤差逆伝播なし）。
 *   1. 重みの集団を作る
 *   2. 各個体を「リーグ」と戦わせて勝率を測る
 *   3. 成績上位を親にして、少し揺らした子を作る
 *   4. 2〜3 を繰り返す
 *
 * リーグには手書きCPU（4段階）と、これまでの世代のチャンピオンを入れる。
 * 自分の複製とだけ戦わせると、その相手にだけ強い偏った個体ができるため。
 *
 * 使い方:
 *   npx esbuild scripts/train-cpu.ts --bundle --platform=node --format=esm \
 *     --outfile=.train.mjs --alias:@=. && node .train.mjs [世代数] [集団サイズ]
 */
import { writeFileSync } from "node:fs";

import { SilentAudio } from "../lib/game/audio";
import { DEFAULT_SETTINGS } from "../lib/game/constants";
import { createRng } from "../lib/game/rng";
import { VersusAi } from "../lib/versus/ai";
import { COURSE_IDS } from "../lib/versus/courses";
import { VersusEngine } from "../lib/versus/engine";
import { NeuralAi, WEIGHT_COUNT } from "../lib/versus/neural";
import type { CourseId, CpuLevel, FighterInput, PlayerId, VersusConfig } from "../lib/versus/types";

const GENERATIONS = Number(process.argv[2] ?? 40);
const POP = Number(process.argv[3] ?? 40);
const SEED = Number(process.argv[4] ?? 20260802);
/** 島ごとの成果を書き出す先。指定がなければ本番の重みを直接書く */
const OUT = process.argv[5] ?? "lib/versus/neuralWeights.ts";
const ELITES = Math.max(2, Math.round(POP * 0.2));
/** 1個体あたりの評価試合数 */
const MATCHES_PER_EVAL = 16;

const rng = createRng(SEED);
const rnd = () => rng.next();
/** 標準正規乱数（Box-Muller） */
function gauss(): number {
  const u = Math.max(1e-9, rnd());
  const v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

type Genome = number[];

function randomGenome(): Genome {
  // 入力32・中間24なので、分散が爆発しないよう小さめに初期化する
  return Array.from({ length: WEIGHT_COUNT }, () => gauss() * 0.5);
}

function mutate(parent: Genome, sigma: number): Genome {
  return parent.map((w) => w + gauss() * sigma);
}

interface Opponent {
  name: string;
  make: (id: PlayerId, seed: number) => { update: (e: VersusEngine, dt: number) => FighterInput };
}

const handwritten = (level: CpuLevel): Opponent => ({
  name: level,
  make: (id, seed) => new VersusAi(id, level, seed),
});

const neural = (name: string, w: Genome): Opponent => ({
  name,
  make: (id) => {
    const ai = new NeuralAi(id, w);
    return { update: (e: VersusEngine) => ai.update(e) };
  },
});

/**
 * 1試合。戻り値は「A から見た成績」。
 * 勝敗だけだと差が付きにくいので、耐久の残り差も混ぜて細かい勾配を作る。
 */
function playMatch(a: Opponent, b: Opponent, seed: number, course: CourseId): number {
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
  const [f1, f2] = engine.fighters;
  const hpDiff = (f1.hp - f2.hp) / 10;
  const win = engine.matchWinner === 1 ? 1 : engine.matchWinner === 2 ? -1 : 0;
  // 勝敗を主、耐久差を従にする
  return win + hpDiff * 0.3;
}

/** 上下どちらの陣地でも戦わせて、位置による有利不利を打ち消す */
function evaluate(g: Genome, league: Opponent[], seedBase: number): number {
  const me = neural("cand", g);
  let total = 0;
  let n = 0;
  for (let m = 0; m < MATCHES_PER_EVAL; m++) {
    const opp = league[m % league.length];
    const course = COURSE_IDS[(m * 5) % COURSE_IDS.length];
    const seed = seedBase + m * 7919;
    if (m % 2 === 0) total += playMatch(me, opp, seed, course);
    else total += -playMatch(opp, me, seed, course);
    n += 1;
  }
  return total / n;
}

function main() {
  console.log(`重みの数: ${WEIGHT_COUNT} / 集団 ${POP} / 世代 ${GENERATIONS} / 1個体 ${MATCHES_PER_EVAL} 試合`);
  // いきなり最強と戦わせると全敗のまま差が付かず、学習が進まない。
  // 勝てるようになったら相手を上げる（カリキュラム）。
  const TIERS: CpuLevel[][] = [
    ["rookie", "rookie", "normal"],
    ["rookie", "normal", "normal"],
    ["normal", "normal", "veteran"],
    ["normal", "veteran", "veteran"],
    ["veteran", "veteran", "ace"],
    ["veteran", "ace", "ace"],
  ];
  let tier = 0;
  const baseLeague = () => TIERS[tier].map(handwritten);
  let league = baseLeague();
  let population: Genome[] = Array.from({ length: POP }, randomGenome);
  let best: { g: Genome; score: number } | null = null;
  const t0 = Date.now();

  for (let gen = 0; gen < GENERATIONS; gen++) {
    // 世代が進むほど探索幅を狭めて、荒い探索から細かい調整へ移す
    const sigma = 0.32 * Math.pow(0.955, gen);
    const seedBase = 100000 + gen * 31337;
    const scored = population
      .map((g) => ({ g, score: evaluate(g, league, seedBase) }))
      .sort((x, y) => y.score - x.score);

    const champ = scored[0];
    if (!best || champ.score > best.score) best = { g: [...champ.g], score: champ.score };

    const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
    const mean = scored.reduce((s, x) => s + x.score, 0) / scored.length;
    console.log(
      `世代 ${String(gen + 1).padStart(3)}  最高 ${champ.score.toFixed(3)}  平均 ${mean.toFixed(3)}  σ=${sigma.toFixed(3)}  ${elapsed}秒`,
    );

    // 今の相手に安定して勝てるようになったら、一段上のリーグへ上げる
    if (champ.score > 0.6 && tier < TIERS.length - 1) {
      tier += 1;
      console.log(`  → リーグを上げる（${TIERS[tier].join("/")}）`);
      best = null; // 相手が変わったのでスコアは比較できない
      league = baseLeague();
    } else if ((gen + 1) % 5 === 0) {
      // 過去の自分とも戦わせて、特定の相手にだけ強い個体になるのを防ぐ
      league = [...baseLeague(), neural(`gen${gen + 1}`, [...champ.g])];
    }

    const elites = scored.slice(0, ELITES).map((x) => x.g);
    const next: Genome[] = elites.map((g) => [...g]);
    while (next.length < POP) {
      const parent = elites[Math.floor(rnd() * elites.length) % elites.length];
      next.push(mutate(parent, sigma));
    }
    population = next;
  }

  const champion = best ?? { g: population[0], score: 0 };
  const rounded = champion.g.map((w) => Number(w.toFixed(4)));
  if (OUT.endsWith(".json")) {
    writeFileSync(OUT, JSON.stringify({ seed: SEED, tier, score: champion.score, w: rounded }));
  } else {
    writeFileSync(
      OUT,
      `// 自動生成。scripts/train-cpu.ts が自己対戦の進化戦略で求めた重み。\n` +
        `// 手で編集しないでください。再学習すると丸ごと差し替わります。\n` +
        `export const NEURAL_WEIGHTS: number[] = ${JSON.stringify(rounded)};\n`,
    );
  }
  console.log(`\n到達リーグ ${TIERS[tier].join("/")} / スコア ${champion.score.toFixed(3)} → ${OUT}`);
}

main();
