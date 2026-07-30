import {
  BLOCK_COLS,
  BLOCK_H,
  BLOCK_LEFT,
  BLOCK_TOP,
  BLOCK_W,
  V_BAND,
  W,
} from "./constants";
import { createRng } from "../game/rng";
import type { Block, BlockKind } from "./types";

export const STAGE_COUNT = 20;

/** 盤面の1マス。null は空き */
type Cell = BlockKind | null;

type PatternFn = (col: number, row: number, cols: number, rows: number) => Cell;

/**
 * ステージの型。
 *
 * 「技を使わないと崩しにくい形」を意図的に混ぜる：
 * - solid（不壊）で下段を塞ぐ → ボレーで飛び越えないと奥に届かない
 * - tough（硬質）を厚く並べる → スマッシュの貫通で削るのが早い
 * - 壁ぎわだけ残る形          → カーブで回り込ませる
 */
const PATTERNS: { name: string; rows: number; fn: PatternFn }[] = [
  { name: "フル", rows: 5, fn: () => "normal" },
  { name: "チェッカー", rows: 6, fn: (c, r) => ((c + r) % 2 === 0 ? "normal" : null) },
  {
    name: "ピラミッド",
    rows: 6,
    fn: (c, r, cols) => (Math.abs(c - (cols - 1) / 2) <= r / 1.2 ? "normal" : null),
  },
  {
    name: "ダイヤ",
    rows: 7,
    fn: (c, r, cols, rows) =>
      Math.abs(c - (cols - 1) / 2) + Math.abs(r - (rows - 1) / 2) <= 3.5 ? "normal" : null,
  },
  {
    name: "アーチ",
    rows: 6,
    fn: (c, r, cols) => {
      const d = Math.abs(c - (cols - 1) / 2);
      return r >= d - 1 && r <= d + 1 ? "normal" : null;
    },
  },
  { name: "コラム", rows: 7, fn: (c) => (c % 3 === 1 ? null : "normal") },
  {
    name: "ジグザグ",
    rows: 6,
    fn: (c, r) => ((c + (r % 2 === 0 ? 0 : 2)) % 4 < 3 ? "normal" : null),
  },
  {
    name: "トンネル",
    rows: 7,
    fn: (c, r, cols) => {
      const mid = (cols - 1) / 2;
      if (Math.abs(c - mid) < 1.2) return r < 2 ? "normal" : null;
      return "normal";
    },
  },
  {
    name: "リング",
    rows: 7,
    fn: (c, r, cols, rows) => {
      const dx = Math.abs(c - (cols - 1) / 2) / 2.6;
      const dy = Math.abs(r - (rows - 1) / 2) / 2.2;
      const d = Math.hypot(dx, dy);
      return d > 0.55 && d < 1.05 ? "normal" : null;
    },
  },
  {
    name: "ウェーブ",
    rows: 6,
    fn: (c, r, cols) => {
      const wave = 2 + Math.round(1.6 * Math.sin((c / cols) * Math.PI * 2));
      return r >= wave - 1 && r <= wave + 2 ? "normal" : null;
    },
  },
];

/** ステージごとの味付け。cell を差し替えて硬質・不壊・爆発・移動を混ぜる */
function decorate(stage: number, cell: Cell, col: number, row: number, rows: number): Cell {
  if (!cell) return null;
  const s = stage;
  // 3面ごとに硬質を混ぜる（スマッシュの貫通が効く相手）
  if (s >= 3 && row === 0) cell = "tough";
  if (s >= 8 && row <= 1 && col % 2 === 0) cell = "tough";
  // 5面から最下段に不壊の帯（ボレーで越えないと奥へ届かない）
  if (s >= 5 && row === rows - 1 && col % 3 !== 1) cell = "solid";
  // 7面から爆発ブロック
  if (s >= 7 && (col + row * 3 + s) % 11 === 0) cell = "explosive";
  // 11面から移動ブロック
  if (s >= 11 && row === Math.floor(rows / 2) && col % 4 === 0) cell = "moving";
  return cell;
}

export function stageName(stage: number): string {
  return PATTERNS[(stage - 1) % PATTERNS.length].name;
}

let nextBlockId = 1;
export function resetBlockIds() {
  nextBlockId = 1;
}

function makeBlock(col: number, row: number, kind: BlockKind, neutral: boolean): Block {
  const x = BLOCK_LEFT + col * BLOCK_W;
  const y = BLOCK_TOP + row * BLOCK_H;
  return {
    id: nextBlockId++,
    x,
    y,
    w: BLOCK_W,
    h: BLOCK_H,
    kind,
    hp: kind === "tough" ? 3 : kind === "solid" ? Infinity : 1,
    alive: true,
    baseX: x,
    phase: (col * 0.7 + row * 1.3) % (Math.PI * 2),
    neutral,
  };
}

/** 1人・協力モードのステージを組み立てる */
export function buildStage(stage: number): Block[] {
  const pattern = PATTERNS[(stage - 1) % PATTERNS.length];
  const rows = pattern.rows + Math.min(2, Math.floor((stage - 1) / PATTERNS.length));
  const blocks: Block[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < BLOCK_COLS; col++) {
      const cell = decorate(stage, pattern.fn(col, row, BLOCK_COLS, rows), col, row, rows);
      if (cell) blocks.push(makeBlock(col, row, cell, false));
    }
  }
  return blocks;
}

/**
 * 対戦モードの中立ブロック帯。
 *
 * 中央を塞ぐ壁であり、共通の獲物でもある。素直に打つと自陣側から削ることになるので、
 * ボレーで飛び越えるかスマッシュの貫通で穴を開けるかの選択が生まれる。
 */
export function buildBand(seed: number): Block[] {
  const rng = createRng(seed);
  const cols = BLOCK_COLS;
  const rowH = (V_BAND.bottom - V_BAND.top) / V_BAND.rows;
  const bw = W / cols;

  // 上下の有利不利が出ないよう、上半分だけ抽選して下半分は折り返す
  const half = Math.ceil(V_BAND.rows / 2);
  const layout: (BlockKind | null)[][] = [];
  for (let row = 0; row < half; row++) {
    const line: (BlockKind | null)[] = [];
    for (let col = 0; col < cols; col++) {
      line.push(rng.chance(0.18) ? null : rng.chance(0.22) ? "tough" : "normal");
    }
    layout.push(line);
  }

  const blocks: Block[] = [];
  for (let row = 0; row < V_BAND.rows; row++) {
    const src = layout[Math.min(row, V_BAND.rows - 1 - row)];
    for (let col = 0; col < cols; col++) {
      const kind = src[col];
      if (!kind) continue;
      const x = col * bw;
      blocks.push({
        id: nextBlockId++,
        kind,
        x,
        y: V_BAND.top + row * rowH,
        w: bw,
        h: rowH,
        hp: kind === "tough" ? 3 : 1,
        alive: true,
        baseX: x,
        phase: 0,
        neutral: true,
      });
    }
  }
  return blocks;
}
