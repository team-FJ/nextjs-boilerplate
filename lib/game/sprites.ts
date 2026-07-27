/** ドット絵文字列 → キャンバス変換ユーティリティ（キャンペーン／対戦の両モードで共有） */

const spriteCache = new Map<string, HTMLCanvasElement>();

/**
 * ドット絵文字列から色付きの小さなキャンバスを生成してキャッシュする。
 * X = メインカラー / O = アクセント / # = 影 / . = 透明
 */
export function getSprite(
  key: string,
  rows: string[],
  main: string,
  accent: string,
): HTMLCanvasElement {
  const cacheKey = `${key}|${main}|${accent}`;
  const cached = spriteCache.get(cacheKey);
  if (cached) return cached;
  const w = Math.max(...rows.map((r) => r.length));
  const h = rows.length;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  if (ctx) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < rows[y].length; x++) {
        const ch = rows[y][x];
        if (ch === ".") continue;
        ctx.fillStyle = ch === "X" ? main : ch === "O" ? accent : shade(main, -0.45);
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }
  spriteCache.set(cacheKey, c);
  return c;
}

/** 16進カラーを明るく（amount > 0）／暗く（amount < 0）する */
export function shade(hex: string, amount: number): string {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return hex;
  const adjust = (v: number) =>
    Math.max(0, Math.min(255, Math.round(amount >= 0 ? v + (255 - v) * amount : v * (1 + amount))));
  const r = adjust(parseInt(m[1], 16));
  const g = adjust(parseInt(m[2], 16));
  const b = adjust(parseInt(m[3], 16));
  return `rgb(${r},${g},${b})`;
}

export function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}
