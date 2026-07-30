import {
  H,
  ITEMS,
  PLAY_BOTTOM,
  PLAY_TOP,
  V_BAND,
  V_DEAD_BOTTOM,
  V_DEAD_TOP,
  V_ZONE_BOTTOM,
  V_ZONE_TOP,
  W,
} from "./constants";
import type { Laser } from "./engine";
import type { Ball, Block, ItemDrop, Mode, Paddle } from "./types";

/**
 * 描画に必要な形。エンジンそのものではなく構造で受け取る。
 * 通信対戦では、スナップショットから組み立てた見た目用の状態をそのまま渡せる。
 */
export interface RenderState {
  mode: Mode;
  time: number;
  blocks: Block[];
  balls: Ball[];
  paddles: Paddle[];
  items: ItemDrop[];
  lasers: Laser[];
}

const BLOCK_COLORS: Record<Block["kind"], [string, string]> = {
  normal: ["#3fb6ff", "#1d6ea8"],
  tough: ["#b6a0ff", "#5b45a8"],
  solid: ["#6b7280", "#3b4048"],
  explosive: ["#ff8a5c", "#a8442a"],
  moving: ["#7affc4", "#2e8c66"],
};

const SIDE_COLOR = ["#5ad2ff", "#ff7ab8"];

export interface RenderOptions {
  /** 参加側の画面は 180 度回して描く。**入力も同じだけ回すこと**（lib/breakout/net 参照） */
  flip: boolean;
  scanline: boolean;
  /** 妨害「ブラインド」で相手コートを隠す側 */
  blindSide?: 0 | 1 | null;
}

export function render(
  ctx: CanvasRenderingContext2D,
  engine: RenderState,
  opts: RenderOptions,
) {
  ctx.save();
  ctx.clearRect(0, 0, W, H);
  drawBackground(ctx, engine);

  if (opts.flip) {
    ctx.translate(W / 2, H / 2);
    ctx.rotate(Math.PI);
    ctx.translate(-W / 2, -H / 2);
  }

  drawBlocks(ctx, engine);
  drawItems(ctx, engine);
  drawLasers(ctx, engine);
  drawPaddles(ctx, engine);
  drawBalls(ctx, engine);
  if (opts.blindSide !== null && opts.blindSide !== undefined) drawBlind(ctx, opts.blindSide);
  ctx.restore();

  if (opts.scanline) drawScanline(ctx);
}

function drawBackground(ctx: CanvasRenderingContext2D, engine: RenderState) {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "#070b18");
  g.addColorStop(1, "#0d1226");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  ctx.strokeStyle = "rgba(255,255,255,0.05)";
  ctx.lineWidth = 1;
  for (let y = 0; y < H; y += 40) {
    ctx.beginPath();
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(W, y + 0.5);
    ctx.stroke();
  }

  if (engine.mode === "versus") {
    // 自陣・中立ゾーンの帯
    ctx.fillStyle = "rgba(90,210,255,0.05)";
    ctx.fillRect(0, V_ZONE_BOTTOM.top, W, V_ZONE_BOTTOM.bottom - V_ZONE_BOTTOM.top);
    ctx.fillStyle = "rgba(255,122,184,0.05)";
    ctx.fillRect(0, V_ZONE_TOP.top, W, V_ZONE_TOP.bottom - V_ZONE_TOP.top);
    ctx.fillStyle = "rgba(255,255,255,0.03)";
    ctx.fillRect(0, V_BAND.top, W, V_BAND.bottom - V_BAND.top);
    // デッドライン
    for (const [y, color] of [
      [V_DEAD_BOTTOM, SIDE_COLOR[0]],
      [V_DEAD_TOP, SIDE_COLOR[1]],
    ] as const) {
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.5;
      ctx.setLineDash([8, 6]);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }
  } else {
    ctx.strokeStyle = "rgba(255,255,255,0.15)";
    ctx.beginPath();
    ctx.moveTo(0, PLAY_TOP);
    ctx.lineTo(W, PLAY_TOP);
    ctx.stroke();
    ctx.strokeStyle = "rgba(255,90,120,0.35)";
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.moveTo(0, PLAY_BOTTOM);
    ctx.lineTo(W, PLAY_BOTTOM);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

function drawBlocks(ctx: CanvasRenderingContext2D, engine: RenderState) {
  for (const b of engine.blocks) {
    if (!b.alive) continue;
    const [light, dark] = BLOCK_COLORS[b.kind];
    // 硬質は残り耐久で明るさを落とす
    const wear = b.kind === "tough" ? 0.55 + 0.15 * b.hp : 1;
    ctx.globalAlpha = wear;
    ctx.fillStyle = dark;
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.fillStyle = light;
    ctx.fillRect(b.x + 1, b.y + 1, b.w - 2, b.h - 4);
    ctx.fillStyle = "rgba(255,255,255,0.25)";
    ctx.fillRect(b.x + 1, b.y + 1, b.w - 2, 2);
    ctx.globalAlpha = 1;
    if (b.kind === "solid") {
      ctx.strokeStyle = "rgba(255,255,255,0.35)";
      ctx.beginPath();
      ctx.moveTo(b.x + 4, b.y + b.h - 4);
      ctx.lineTo(b.x + b.w - 4, b.y + 4);
      ctx.stroke();
    }
    if (b.kind === "explosive") {
      ctx.fillStyle = "#fff";
      ctx.font = "bold 12px monospace";
      ctx.textAlign = "center";
      ctx.fillText("*", b.x + b.w / 2, b.y + b.h / 2 + 4);
    }
  }
}

function drawPaddles(ctx: CanvasRenderingContext2D, engine: RenderState) {
  for (const p of engine.paddles) {
    const color = SIDE_COLOR[engine.mode === "coop" ? p.index : p.side];
    const x = p.x - p.w / 2;
    const y = p.y - p.h / 2;
    ctx.fillStyle = p.stun > 0 ? "#ff5470" : color;
    ctx.fillRect(x, y, p.w, p.h);
    ctx.fillStyle = "rgba(255,255,255,0.4)";
    ctx.fillRect(x, y, p.w, 3);

    // 技ゲージ（パドルのすぐ内側）
    const ratio = Math.max(0, Math.min(1, p.gauge / p.gaugeMax));
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect(x, y + p.h + 2, p.w, 3);
    ctx.fillStyle = ratio >= 0.28 ? "#ffe86b" : "#8a7a2a";
    ctx.fillRect(x, y + p.h + 2, p.w * ratio, 3);

    drawSkillFlash(ctx, p);
  }
}

/** 直前に出した技を、パドルの上に短く表示する */
function drawSkillFlash(ctx: CanvasRenderingContext2D, p: Paddle) {
  if (!p.lastSkill) return;
  const label =
    p.lastSkill.kind === "smash"
      ? "SMASH"
      : p.lastSkill.kind === "curve"
        ? "CURVE"
        : p.lastSkill.kind === "lob"
          ? "VOLLEY"
          : "MISS";
  ctx.fillStyle = p.lastSkill.kind === "fail" ? "#ff5470" : "#ffffff";
  ctx.font = "bold 11px monospace";
  ctx.textAlign = "center";
  ctx.fillText(label, p.x, p.y + (p.side === 0 ? -18 : 26));
}

function drawBalls(ctx: CanvasRenderingContext2D, engine: RenderState) {
  for (const b of engine.balls) {
    // ロブ中とカーブ中は見た目で必ず区別する（飛び越えているのかが分からないと理不尽になる）
    if (b.lob > 0) {
      ctx.strokeStyle = "#ffb057";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r + 5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 0.35;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r + 9, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    if (b.spinT > 0) {
      // 回転方向が分かる残像（次にどちらへ曲がるかが読めることが読み合いの前提）
      const t = engine.time * 12 * Math.sign(b.spin);
      ctx.fillStyle = "rgba(122,255,196,0.85)";
      for (let i = 0; i < 3; i++) {
        const a = t + (i * Math.PI * 2) / 3;
        ctx.beginPath();
        ctx.arc(b.x + Math.cos(a) * (b.r + 4), b.y + Math.sin(a) * (b.r + 4), 1.8, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    if (b.pierce > 0) {
      ctx.fillStyle = "rgba(255,232,107,0.35)";
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r + 6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawItems(ctx: CanvasRenderingContext2D, engine: RenderState) {
  for (const it of engine.items) {
    const spec = ITEMS[it.kind];
    const size = 20;
    ctx.fillStyle = "rgba(8,12,24,0.9)";
    ctx.fillRect(it.x - size / 2, it.y - size / 2, size, size);
    // トラップは赤枠で必ず判別できるようにする
    ctx.strokeStyle = spec.group === "trap" ? "#ff5470" : SIDE_COLOR[it.owner];
    ctx.lineWidth = spec.group === "trap" ? 3 : 2;
    ctx.strokeRect(it.x - size / 2, it.y - size / 2, size, size);
    ctx.fillStyle = spec.color;
    ctx.font = "bold 12px monospace";
    ctx.textAlign = "center";
    ctx.fillText(spec.icon, it.x, it.y + 4);
  }
}

function drawLasers(ctx: CanvasRenderingContext2D, engine: RenderState) {
  ctx.fillStyle = "#5ad2ff";
  for (const l of engine.lasers) ctx.fillRect(l.x - 1.5, l.y - 8, 3, 16);
}

function drawBlind(ctx: CanvasRenderingContext2D, side: 0 | 1) {
  const zone = side === 0 ? V_ZONE_BOTTOM : V_ZONE_TOP;
  ctx.fillStyle = "rgba(10,14,28,0.92)";
  ctx.fillRect(0, zone.top - 20, W, zone.bottom - zone.top + 40);
}

function drawScanline(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = "rgba(0,0,0,0.16)";
  for (let y = 0; y < H; y += 3) ctx.fillRect(0, y, W, 1);
}
