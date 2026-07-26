import { FIELD_BOTTOM, FIELD_TOP, ITEM_LABEL, THEMES, VIEW_H, VIEW_W } from "./constants";
import { BOSS_DEFS, ENEMY_DEFS, PLAYER_SPRITE } from "./enemies";
import type { GameEngine } from "./engine";
import type { Boss, Enemy } from "./types";

const spriteCache = new Map<string, HTMLCanvasElement>();

/** ドット絵文字列から色付きの小さなキャンバスを生成してキャッシュする */
function getSprite(key: string, rows: string[], main: string, accent: string): HTMLCanvasElement {
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

function shade(hex: string, amount: number): string {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return hex;
  const adjust = (v: number) =>
    Math.max(0, Math.min(255, Math.round(amount >= 0 ? v + (255 - v) * amount : v * (1 + amount))));
  const r = adjust(parseInt(m[1], 16));
  const g = adjust(parseInt(m[2], 16));
  const b = adjust(parseInt(m[3], 16));
  return `rgb(${r},${g},${b})`;
}

export class Renderer {
  private time = 0;

  draw(ctx: CanvasRenderingContext2D, engine: GameEngine, dt: number) {
    this.time += dt;
    const theme = THEMES[engine.stage.theme];
    const settings = engine.settings;

    ctx.save();
    ctx.clearRect(0, 0, VIEW_W, VIEW_H);

    // 画面揺れ
    if (settings.screenShake && engine.shake > 0) {
      const s = engine.shake;
      ctx.translate((Math.random() - 0.5) * s, (Math.random() - 0.5) * s);
    }

    this.drawBackground(ctx, engine, theme);
    this.drawHazards(ctx, engine);
    this.drawItems(ctx, engine);
    this.drawEnemies(ctx, engine);
    if (engine.boss) this.drawBoss(ctx, engine.boss);
    this.drawPlayer(ctx, engine);
    this.drawBullets(ctx, engine);
    this.drawParticles(ctx, engine);
    ctx.restore();

    this.drawOverlays(ctx, engine, theme.accent);
  }

  private drawBackground(
    ctx: CanvasRenderingContext2D,
    engine: GameEngine,
    theme: (typeof THEMES)[keyof typeof THEMES],
  ) {
    const g = ctx.createLinearGradient(0, 0, 0, VIEW_H);
    g.addColorStop(0, theme.bgTop);
    g.addColorStop(1, theme.bgBottom);
    ctx.fillStyle = g;
    ctx.fillRect(-20, -20, VIEW_W + 40, VIEW_H + 40);

    // 星雲
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < 3; i++) {
      const nx = VIEW_W * (0.2 + i * 0.3) + Math.sin(this.time * 0.1 + i) * 30;
      const ny = ((this.time * 12 + i * 300) % (VIEW_H + 400)) - 200;
      const rg = ctx.createRadialGradient(nx, ny, 0, nx, ny, 190);
      rg.addColorStop(0, theme.nebula);
      rg.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = rg;
      ctx.fillRect(nx - 190, ny - 190, 380, 380);
    }
    ctx.restore();

    if (engine.settings.starfield) {
      for (const s of engine.stars) {
        ctx.globalAlpha = 0.25 + s.z * 0.7;
        ctx.fillStyle = theme.star;
        ctx.fillRect(s.x, s.y, s.size, s.size * (1 + s.z));
      }
      ctx.globalAlpha = 1;
    }

    // グリッド（電脳テーマなどの雰囲気付け）
    ctx.strokeStyle = theme.grid;
    ctx.lineWidth = 1;
    const offset = (this.time * 30) % 48;
    ctx.beginPath();
    for (let y = -48 + offset; y < VIEW_H; y += 48) {
      ctx.moveTo(0, y);
      ctx.lineTo(VIEW_W, y);
    }
    for (let x = 0; x < VIEW_W; x += 48) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, VIEW_H);
    }
    ctx.stroke();

    // フィールド境界
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.beginPath();
    ctx.moveTo(0, FIELD_TOP);
    ctx.lineTo(VIEW_W, FIELD_TOP);
    ctx.moveTo(0, FIELD_BOTTOM);
    ctx.lineTo(VIEW_W, FIELD_BOTTOM);
    ctx.stroke();

    if (engine.stage.hazard === "nebula") {
      ctx.fillStyle = "rgba(4,2,10,0.55)";
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    }
    if (engine.stage.hazard === "solarWind") {
      ctx.strokeStyle = "rgba(255,190,120,0.16)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i < 12; i++) {
        const y = ((this.time * 300 + i * 90) % (VIEW_H + 120)) - 60;
        ctx.moveTo(0, y);
        ctx.lineTo(VIEW_W, y + 26);
      }
      ctx.stroke();
    }
  }

  private drawHazards(ctx: CanvasRenderingContext2D, engine: GameEngine) {
    for (const h of engine.hazards) {
      if (h.kind === "beamWarn") {
        const blink = Math.sin(h.t * 26) > 0;
        ctx.fillStyle = blink ? "rgba(255,90,120,0.35)" : "rgba(255,90,120,0.12)";
        ctx.fillRect(0, h.y - 3, VIEW_W, 6);
      } else if (h.kind === "beam") {
        const a = Math.min(1, h.t * 8) * Math.min(1, h.life * 3);
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        ctx.fillStyle = `rgba(255,90,140,${0.85 * a})`;
        ctx.fillRect(0, h.y - 9, VIEW_W, 18);
        ctx.fillStyle = `rgba(255,255,255,${0.9 * a})`;
        ctx.fillRect(0, h.y - 3, VIEW_W, 6);
        ctx.restore();
      } else {
        ctx.save();
        ctx.translate(h.x, h.y);
        ctx.rotate(h.angle);
        ctx.fillStyle = h.kind === "meteor" ? "#7c6a5a" : "#5a6270";
        ctx.beginPath();
        for (let i = 0; i < 7; i++) {
          const a = (i / 7) * Math.PI * 2;
          const r = h.r * (0.75 + ((i * 37) % 10) / 30);
          ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
        }
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,0.18)";
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  private drawEnemies(ctx: CanvasRenderingContext2D, engine: GameEngine) {
    const frozen = engine.powerups.freeze > 0;
    for (const e of engine.enemies) {
      const def = ENEMY_DEFS[e.type];
      const flash = e.flags.hitFlash > 0;
      const color = flash ? "#ffffff" : frozen ? "#a8e7ff" : e.color;
      const sprite = getSprite(e.type, def.sprite, color, flash ? "#ffffff" : e.accent);
      ctx.save();
      if (e.type === "ghost") {
        ctx.globalAlpha = 0.45 + Math.sin(e.t * 3) * 0.35;
      }
      ctx.translate(e.x, e.y);
      if (e.mode === "dive") ctx.rotate(Math.sin(e.t * 8) * 0.12);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(sprite, -e.w / 2, -e.h / 2, e.w, e.h);
      ctx.restore();
      this.drawEnemyHp(ctx, e);
    }
  }

  private drawEnemyHp(ctx: CanvasRenderingContext2D, e: Enemy) {
    if (e.hp >= e.maxHp || e.maxHp <= 2) return;
    const w = e.w;
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect(e.x - w / 2, e.y - e.h / 2 - 6, w, 3);
    ctx.fillStyle = "#8dff5a";
    ctx.fillRect(e.x - w / 2, e.y - e.h / 2 - 6, w * (e.hp / e.maxHp), 3);
  }

  private drawBoss(ctx: CanvasRenderingContext2D, b: Boss) {
    const def = BOSS_DEFS[b.id];
    const main = b.hitFlash > 0 ? "#ffffff" : b.color;
    ctx.save();
    ctx.translate(b.x, b.y);

    // 本体
    ctx.fillStyle = main;
    ctx.strokeStyle = shade(main, -0.5);
    ctx.lineWidth = 3;
    switch (def.shape) {
      case "carrier": {
        roundRect(ctx, -b.w / 2, -b.h / 2, b.w, b.h * 0.7, 12);
        ctx.fill();
        ctx.fillStyle = shade(main, -0.35);
        roundRect(ctx, -b.w / 2 + 16, b.h * 0.1, b.w - 32, b.h * 0.4, 8);
        ctx.fill();
        break;
      }
      case "hydra": {
        ctx.beginPath();
        ctx.ellipse(0, 10, b.w / 2, b.h / 2.6, 0, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case "sentinel": {
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2 + b.t * 0.4;
          ctx.lineTo(Math.cos(a) * (b.w / 2), Math.sin(a) * (b.h / 2));
        }
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = shade(main, -0.4);
        ctx.beginPath();
        ctx.arc(0, 0, b.w / 4, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case "devourer": {
        ctx.beginPath();
        ctx.moveTo(-b.w / 2, -b.h / 4);
        ctx.quadraticCurveTo(0, -b.h / 1.6, b.w / 2, -b.h / 4);
        ctx.quadraticCurveTo(0, b.h / 1.4, -b.w / 2, -b.h / 4);
        ctx.closePath();
        ctx.fill();
        break;
      }
      case "twin": {
        roundRect(ctx, -b.w / 2, -b.h / 3, b.w, b.h * 0.66, 20);
        ctx.fill();
        break;
      }
      case "overmind": {
        ctx.beginPath();
        ctx.ellipse(0, 0, b.w / 2, b.h / 2, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        const rg = ctx.createRadialGradient(0, 0, 4, 0, 0, b.w / 2);
        rg.addColorStop(0, b.accent);
        rg.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = rg;
        ctx.beginPath();
        ctx.arc(0, 0, b.w / 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        break;
      }
    }

    // コア（明滅）
    ctx.fillStyle = b.accent;
    ctx.globalAlpha = 0.6 + Math.sin(b.t * 6) * 0.3;
    ctx.beginPath();
    ctx.arc(0, 0, 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    // パーツ
    for (const part of b.parts) {
      if (part.destroyed) {
        ctx.fillStyle = "rgba(40,40,50,0.7)";
        ctx.beginPath();
        ctx.arc(part.offsetX, part.offsetY, part.r * 0.6, 0, Math.PI * 2);
        ctx.fill();
        continue;
      }
      ctx.fillStyle = shade(b.accent, -0.15);
      ctx.beginPath();
      ctx.arc(part.offsetX, part.offsetY, part.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,0.4)";
      ctx.lineWidth = 2;
      ctx.stroke();
      // パーツHP
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(part.offsetX - part.r, part.offsetY - part.r - 8, part.r * 2, 4);
      ctx.fillStyle = "#ffd93d";
      ctx.fillRect(part.offsetX - part.r, part.offsetY - part.r - 8, part.r * 2 * (part.hp / part.maxHp), 4);
    }
    ctx.restore();
  }

  private drawPlayer(ctx: CanvasRenderingContext2D, engine: GameEngine) {
    const p = engine.player;
    if (p.dead) return;
    const blink = p.invincible > 0 && Math.floor(this.time * 20) % 2 === 0;

    // オプションポッド
    for (const pod of p.options) {
      ctx.save();
      ctx.translate(pod.x, pod.y);
      ctx.rotate(this.time * 3);
      ctx.fillStyle = "#ffe86b";
      ctx.beginPath();
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2;
        ctx.lineTo(Math.cos(a) * 9, Math.sin(a) * 9);
      }
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#4d3c00";
      ctx.beginPath();
      ctx.arc(0, 0, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    if (blink) return;

    // シールド
    if (p.shield > 0) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.strokeStyle = `rgba(126,200,255,${0.35 + p.shield * 0.15})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 24 + Math.sin(this.time * 6) * 1.5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // 噴射炎
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const flame = 8 + Math.random() * 6;
    const fg = ctx.createLinearGradient(0, p.y + 10, 0, p.y + 10 + flame);
    fg.addColorStop(0, "rgba(120,200,255,0.9)");
    fg.addColorStop(1, "rgba(120,200,255,0)");
    ctx.fillStyle = fg;
    ctx.fillRect(p.x - 4, p.y + 8, 8, flame);
    ctx.restore();

    const sprite = getSprite("player", PLAYER_SPRITE, "#e8f1ff", "#5aa9ff");
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(sprite, p.x - p.w / 2, p.y - p.h / 2, p.w, p.h);

    if (engine.powerups.invincible > 0 || p.invincible > 0) {
      ctx.strokeStyle = "rgba(255,255,255,0.25)";
      ctx.beginPath();
      ctx.arc(p.x, p.y, 20, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  private drawBullets(ctx: CanvasRenderingContext2D, engine: GameEngine) {
    const cb = engine.settings.colorBlind;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const bullet of engine.bullets) {
      // 色覚サポート時は自機弾／敵弾を高コントラストの2色に固定する
      const b = cb
        ? { ...bullet, color: bullet.from === "enemy" ? "#ffffff" : "#00e5ff" }
        : bullet;
      ctx.save();
      ctx.translate(b.x, b.y);
      if (b.kind === "wave") {
        ctx.strokeStyle = b.color;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.ellipse(0, 0, b.w / 2, b.h / 2, 0, Math.PI * 0.15, Math.PI * 0.85, true);
        ctx.stroke();
      } else if (b.kind === "rail") {
        const g = ctx.createLinearGradient(0, -b.h / 2, 0, b.h / 2);
        g.addColorStop(0, "rgba(255,255,255,0)");
        g.addColorStop(0.5, b.color);
        g.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = g;
        ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h);
      } else if (b.kind === "enemyBomb") {
        ctx.fillStyle = b.color;
        ctx.beginPath();
        ctx.arc(0, 0, b.w / 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,0.6)";
        ctx.lineWidth = 1;
        ctx.stroke();
      } else {
        if (b.kind === "missile" || b.kind === "enemyLaser") ctx.rotate(b.angle);
        ctx.fillStyle = b.color;
        ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h);
        ctx.fillStyle = "rgba(255,255,255,0.75)";
        ctx.fillRect(-b.w / 4, -b.h / 2, b.w / 2, b.h);
      }
      ctx.restore();
    }
    ctx.restore();
  }

  private drawItems(ctx: CanvasRenderingContext2D, engine: GameEngine) {
    for (const item of engine.items) {
      const label = ITEM_LABEL[item.kind];
      const blink = item.life < 3 && Math.floor(item.life * 8) % 2 === 0;
      if (blink) continue;
      const bob = Math.sin(this.time * 5 + item.id) * 2;
      ctx.save();
      ctx.translate(item.x, item.y + bob);
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      const rg = ctx.createRadialGradient(0, 0, 2, 0, 0, 18);
      rg.addColorStop(0, label.color);
      rg.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = rg;
      ctx.fillRect(-18, -18, 36, 36);
      ctx.restore();
      ctx.fillStyle = "rgba(10,12,20,0.9)";
      roundRect(ctx, -11, -11, 22, 22, 5);
      ctx.fill();
      ctx.strokeStyle = label.color;
      ctx.lineWidth = 2;
      roundRect(ctx, -11, -11, 22, 22, 5);
      ctx.stroke();
      ctx.fillStyle = label.color;
      ctx.font = "bold 11px ui-monospace, monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(label.short, 0, 1);
      ctx.restore();
    }
  }

  private drawParticles(ctx: CanvasRenderingContext2D, engine: GameEngine) {
    ctx.save();
    for (const p of engine.particles) {
      const a = Math.max(0, p.life / p.maxLife);
      if (p.kind === "text") {
        ctx.globalAlpha = a;
        ctx.fillStyle = p.color;
        ctx.font = `bold ${p.size}px ui-monospace, monospace`;
        ctx.textAlign = "center";
        ctx.fillText(p.text ?? "", p.x, p.y);
        continue;
      }
      ctx.globalAlpha = a * (p.kind === "smoke" ? 0.4 : 1);
      ctx.globalCompositeOperation = p.kind === "smoke" ? "source-over" : "lighter";
      ctx.fillStyle = p.color;
      if (p.kind === "ring") {
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(p.x, p.y, (1 - a) * 22 + 4, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      }
    }
    ctx.restore();
  }

  private drawOverlays(ctx: CanvasRenderingContext2D, engine: GameEngine, accent: string) {
    // ボム閃光
    if (engine.bombFlash > 0) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = `rgba(255,255,255,${engine.bombFlash * 0.55})`;
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
      ctx.strokeStyle = `rgba(255,220,120,${engine.bombFlash})`;
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(engine.player.x, engine.player.y, (1 - engine.bombFlash) * 520, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    // 被弾フラッシュ
    if (engine.flash > 0) {
      ctx.fillStyle = engine.flashColor;
      ctx.globalAlpha = Math.min(0.5, engine.flash * 0.5);
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
      ctx.globalAlpha = 1;
    }

    // ブリーフィング表示
    if (engine.phase === "briefing") {
      ctx.save();
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(0, VIEW_H / 2 - 90, VIEW_W, 180);
      ctx.textAlign = "center";
      ctx.fillStyle = accent;
      ctx.font = "bold 15px ui-monospace, monospace";
      ctx.fillText(`STAGE ${engine.stageIndex} / 30`, VIEW_W / 2, VIEW_H / 2 - 46);
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 30px system-ui, sans-serif";
      ctx.fillText(engine.stage.name, VIEW_W / 2, VIEW_H / 2 - 6);
      ctx.fillStyle = "rgba(255,255,255,0.7)";
      ctx.font = "12px system-ui, sans-serif";
      if (engine.stage.hint) ctx.fillText(engine.stage.hint, VIEW_W / 2, VIEW_H / 2 + 26);
      ctx.fillStyle = "rgba(255,255,255,0.45)";
      ctx.font = "11px ui-monospace, monospace";
      ctx.fillText("SPACE でスキップ", VIEW_W / 2, VIEW_H / 2 + 58);
      ctx.restore();
    }

    // ボス警告
    if (engine.boss && engine.boss.entering) {
      const blink = Math.floor(this.time * 6) % 2 === 0;
      ctx.save();
      ctx.textAlign = "center";
      ctx.fillStyle = blink ? "#ff5d8f" : "rgba(255,93,143,0.35)";
      ctx.font = "bold 34px ui-monospace, monospace";
      ctx.fillText("W A R N I N G", VIEW_W / 2, VIEW_H / 2);
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 14px system-ui, sans-serif";
      ctx.fillText(engine.boss.name, VIEW_W / 2, VIEW_H / 2 + 26);
      ctx.restore();
    }

    // CRT 風スキャンライン
    if (engine.settings.crt) {
      ctx.save();
      ctx.globalAlpha = 0.14;
      ctx.fillStyle = "#000";
      for (let y = 0; y < VIEW_H; y += 3) ctx.fillRect(0, y, VIEW_W, 1);
      ctx.restore();
      const vg = ctx.createRadialGradient(VIEW_W / 2, VIEW_H / 2, VIEW_H * 0.35, VIEW_W / 2, VIEW_H / 2, VIEW_H * 0.75);
      vg.addColorStop(0, "rgba(0,0,0,0)");
      vg.addColorStop(1, "rgba(0,0,0,0.55)");
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    }
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}
