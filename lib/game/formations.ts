import { VIEW_W } from "./constants";
import type { FormationName } from "./types";

export interface Slot {
  sx: number;
  sy: number;
  row: number;
  col: number;
}

const SIDE_MARGIN = 46;
const ROW_H = 42;

/** 編隊形状ごとにスロット座標（編隊中心を原点とした相対座標）を生成する */
export function generateSlots(
  formation: FormationName,
  rows: number,
  cols: number,
  rnd: () => number,
): Slot[] {
  const usable = VIEW_W - SIDE_MARGIN * 2;
  const cell = usable / Math.max(1, cols - 1);
  const cx = (cols - 1) / 2;
  const cy = (rows - 1) / 2;
  const slots: Slot[] = [];

  const push = (row: number, col: number, dx = 0, dy = 0) => {
    slots.push({ sx: (col - cx) * cell + dx, sy: row * ROW_H + dy, row, col });
  };

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const dc = Math.abs(col - cx);
      const dr = Math.abs(row - cy);
      switch (formation) {
        case "grid":
          push(row, col);
          break;
        case "vshape":
          push(row, col, 0, dc * 11);
          break;
        case "diamond":
          if (dc + dr * 1.15 <= Math.max(cx, cy) + 0.4) push(row, col);
          break;
        case "arc":
          push(row, col, 0, Math.sin((col / Math.max(1, cols - 1)) * Math.PI) * -26);
          break;
        case "columns":
          if (col % 2 === 0) push(row, col);
          break;
        case "checker":
          if ((row + col) % 2 === 0) push(row, col);
          break;
        case "wedge":
          if (col >= row && col <= cols - 1 - row) push(row, col);
          break;
        case "ring":
          if (row === 0 || row === rows - 1 || col === 0 || col === cols - 1) push(row, col);
          break;
        case "cross":
          if (Math.abs(col - cx) < 1.2 || Math.abs(row - cy) < 1.2) push(row, col);
          break;
        case "scatter":
          if (rnd() < 0.72) push(row, col, (rnd() - 0.5) * cell * 0.7, (rnd() - 0.5) * 22);
          break;
      }
    }
  }

  // 生成結果が空になる形状の保険
  if (slots.length === 0) {
    for (let col = 0; col < cols; col++) push(0, col);
  }
  return slots;
}

/** 出現演出用の初期位置を返す */
export function entryStart(
  entry: "top" | "sides" | "swirl" | "drop",
  slot: Slot,
  index: number,
): { x: number; y: number } {
  switch (entry) {
    case "sides":
      return { x: index % 2 === 0 ? -60 : VIEW_W + 60, y: 60 + (index % 7) * 26 };
    case "swirl":
      return { x: VIEW_W / 2 + Math.cos(index * 0.7) * 40, y: -80 - index * 6 };
    case "drop":
      return { x: VIEW_W / 2 + slot.sx, y: -60 - slot.row * 30 };
    case "top":
    default:
      return { x: VIEW_W / 2 + slot.sx * 0.4, y: -50 - index * 8 };
  }
}
