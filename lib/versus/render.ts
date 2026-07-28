import { getSprite, roundRect } from "../game/sprites";
import { BAND, BOTTOM_ZONE, TOP_ZONE, V_H, V_W, VERSUS_ITEMS, VERSUS_WEAPONS } from "./constants";
import { BAND_ENEMIES, VERSUS_FIGHTER_SPRITE } from "./enemies";
import type { Settings } from "../game/types";
import type {
  BandEnemy,
  Fighter,
  PlayerId,
  VersusBullet,
  VersusItem,
  VersusParticle,
  VersusPhase,
} from "./types";

/**
 * 描画に必要な状態。ローカル対戦では VersusEngine が、通信対戦では
 * サーバーのスナップショットから組み立てた状態がこれを満たす。
 */
export interface RenderableVersus {
  settings: Settings;
  shake: number;
  flash: number;
  flashColor: string;
  phase: VersusPhase;
  round: number;
  roundTime: number;
  countdown: number;
  banner: string | null;
  lastRoundWinner: PlayerId | 0 | null;
  overdrive: boolean;
  fighters: [Fighter, Fighter];
  bullets: VersusBullet[];
  enemies: BandEnemy[];
  items: VersusItem[];
  particles: VersusParticle[];
}

interface Star {
  x: number;
  y: number;
  z: number;
}

export class VersusRenderer {
  private time = 0;
  private stars: Star[] = [];

  constructor() {
    for (let i = 0; i < 70; i++) {
      this.stars.push({ x: Math.random() * V_W, y: Math.random() * V_H, z: 0.3 + Math.random() * 0.7 });
    }
  }

  draw(ctx: CanvasRenderingContext2D, engine: RenderableVersus, dt: number) {
    this.time += dt;
    ctx.save();
    ctx.clearRect(0, 0, V_W, V_H);
    if (engine.settings.screenShake && engine.shake > 0) {
      ctx.translate((Math.random() - 0.5) * engine.shake, (Math.random() - 0.5) * engine.shake);
    }

    this.drawField(ctx, engine, dt);
    this.drawItems(ctx, engine);
    this.drawEnemies(ctx, engine);
    this.drawFighter(ctx, engine.fighters[0]);
    this.drawFighter(ctx, engine.fighters[1]);
    this.drawBullets(ctx, engine);
    this.drawParticles(ctx, engine);
    ctx.restore();

    this.drawOverlay(ctx, engine);
  }

  private drawField(ctx: CanvasRenderingContext2D, engine: RenderableVersus, dt: number) {
    // 上下で色味を変えて陣地を直感的に分ける
    const top = ctx.createLinearGradient(0, 0, 0, BAND.top);
    top.addColorStop(0, "#2a0a1a");
    top.addColorStop(1, "#12060f");
    ctx.fillStyle = top;
    ctx.fillRect(-20, -20, V_W + 40, BAND.top + 20);

    const bottom = ctx.createLinearGradient(0, BAND.bottom, 0, V_H);
    bottom.addColorStop(0, "#050e1c");
    bottom.addColorStop(1, "#08182f");
    ctx.fillStyle = bottom;
    ctx.fillRect(-20, BAND.bottom, V_W + 40, V_H - BAND.bottom + 20);

    // 中立ゾーン
    const band = ctx.createLinearGradient(0, BAND.top, 0, BAND.bottom);
    band.addColorStop(0, "#0d0d16");
    band.addColorStop(0.5, "#181828");
    band.addColorStop(1, "#0d0d16");
    ctx.fillStyle = band;
    ctx.fillRect(-20, BAND.top, V_W + 40, BAND.bottom - BAND.top);

    // 中立ゾーンを流れるスクロールライン
    ctx.save();
    ctx.globalAlpha = 0.25;
    ctx.strokeStyle = "#4a4a6a";
    ctx.lineWidth = 1;
    ctx.beginPath();
    const offset = (this.time * 60) % 40;
    for (let x = -40 + offset; x < V_W + 40; x += 40) {
      ctx.moveTo(x, BAND.top);
      ctx.lineTo(x - 24, BAND.bottom);
    }
    ctx.stroke();
    ctx.restore();

    for (const s of this.stars) {
      s.y += (10 + s.z * 30) * dt;
      if (s.y > V_H) {
        s.y = 0;
        s.x = Math.random() * V_W;
      }
      if (s.y > BAND.top && s.y < BAND.bottom) continue;
      ctx.globalAlpha = 0.2 + s.z * 0.5;
      ctx.fillStyle = "#cfe3ff";
      ctx.fillRect(s.x, s.y, 1.5, 1.5 + s.z);
    }
    ctx.globalAlpha = 1;

    // 境界線
    for (const [y, color] of [
      [BAND.top, "#ff6fa5"],
      [BAND.bottom, "#5aa9ff"],
    ] as const) {
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = 2;
      ctx.setLineDash([12, 8]);
      ctx.lineDashOffset = -this.time * 26;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(V_W, y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }

    // 中立ゾーンのラベル（陣地名は HUD 側に表示するのでここでは出さない）
    ctx.font = "bold 9px ui-monospace, monospace";
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = "#8b8ba7";
    ctx.textAlign = "center";
    ctx.fillText("N E U T R A L   Z O N E", V_W / 2, BAND.top + 14);
    ctx.globalAlpha = 1;
  }

  private drawEnemies(ctx: CanvasRenderingContext2D, engine: RenderableVersus) {
    for (const e of engine.enemies) {
      const def = BAND_ENEMIES[e.type];
      const color = e.hitFlash > 0 ? "#ffffff" : def.color;
      const sprite = getSprite(`v-${e.type}`, def.sprite, color, def.accent);
      ctx.save();
      ctx.translate(e.x, e.y);
      ctx.rotate(Math.sin(e.t * 2) * 0.08);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(sprite, -e.w / 2, -e.h / 2, e.w, e.h);
      ctx.restore();

      if (e.hp < e.maxHp) {
        ctx.fillStyle = "rgba(0,0,0,0.55)";
        ctx.fillRect(e.x - e.w / 2, e.y - e.h / 2 - 6, e.w, 3);
        ctx.fillStyle = "#8dff5a";
        ctx.fillRect(e.x - e.w / 2, e.y - e.h / 2 - 6, e.w * (e.hp / e.maxHp), 3);
      }
    }
  }

  private drawFighter(ctx: CanvasRenderingContext2D, f: Fighter) {
    if (!f.alive) return;
    const blink = f.invincible > 0 && Math.floor(this.time * 22) % 2 === 0;
    if (blink) return;

    ctx.save();
    ctx.translate(f.x, f.y);
    // 上側プレイヤーは上下反転して向かい合わせにする
    if (f.dir === 1) ctx.scale(1, -1);

    // 噴射炎
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const flame = 7 + Math.random() * 5;
    const g = ctx.createLinearGradient(0, 10, 0, 10 + flame);
    g.addColorStop(0, f.color);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(-4, 8, 8, flame);
    ctx.restore();

    const main = f.hitFlash > 0 ? "#ffffff" : f.accent;
    const sprite = getSprite(`fighter${f.id}`, VERSUS_FIGHTER_SPRITE, main, f.color);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(sprite, -f.w / 2, -f.h / 2, f.w, f.h);
    ctx.restore();

    // シールド
    if (f.shield > 0) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.strokeStyle = `rgba(126,200,255,${0.3 + f.shield * 0.22})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(f.x, f.y, 22 + Math.sin(this.time * 6) * 1.5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    // 鈍足
    if (f.slowTimer > 0) {
      ctx.strokeStyle = "rgba(160,196,255,0.7)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(f.x, f.y, 26, this.time * 2, this.time * 2 + Math.PI * 1.2);
      ctx.stroke();
    }
  }

  private drawBullets(ctx: CanvasRenderingContext2D, engine: RenderableVersus) {
    const cb = engine.settings.colorBlind;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const b of engine.bullets) {
      const color = cb
        ? b.owner === 0
          ? "#ffffff"
          : b.owner === 1
            ? "#00e5ff"
            : "#ff2d95"
        : b.color;
      ctx.save();
      ctx.translate(b.x, b.y);
      if (b.kind === "bomb") {
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.85;
        ctx.beginPath();
        ctx.arc(0, 0, b.w / 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(0, 0, b.w / 2 + Math.sin(this.time * 14) * 2, 0, Math.PI * 2);
        ctx.stroke();
      } else if (b.kind === "enemy") {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(0, 0, b.w / 2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillStyle = color;
        ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h);
        ctx.fillStyle = "rgba(255,255,255,0.8)";
        ctx.fillRect(-b.w / 4, -b.h / 2, b.w / 2, b.h);
      }
      ctx.restore();
    }
    ctx.restore();
  }

  private drawItems(ctx: CanvasRenderingContext2D, engine: RenderableVersus) {
    for (const item of engine.items) {
      const label = VERSUS_ITEMS[item.kind];
      if (item.life < 2.5 && Math.floor(item.life * 8) % 2 === 0) continue;
      const owner = engine.fighters[item.owner - 1];
      ctx.save();
      ctx.translate(item.x, item.y + Math.sin(this.time * 5 + item.id) * 2);

      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      const rg = ctx.createRadialGradient(0, 0, 2, 0, 0, 20);
      rg.addColorStop(0, label.color);
      rg.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = rg;
      ctx.fillRect(-20, -20, 40, 40);
      ctx.restore();

      ctx.fillStyle = "rgba(10,12,20,0.92)";
      roundRect(ctx, -11, -11, 22, 22, 5);
      ctx.fill();
      // 枠の色で「どちらのアイテムか」を示す
      ctx.strokeStyle = owner.color;
      ctx.lineWidth = 2;
      roundRect(ctx, -11, -11, 22, 22, 5);
      ctx.stroke();
      ctx.fillStyle = label.color;
      ctx.font = "bold 11px ui-monospace, monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(label.short, 0, 1);
      ctx.restore();

      // 流れていく方向の矢印
      if (Math.abs(item.vy) > 30) {
        ctx.fillStyle = owner.color;
        ctx.globalAlpha = 0.6;
        const dir = Math.sign(item.vy);
        ctx.beginPath();
        ctx.moveTo(item.x, item.y + dir * 22);
        ctx.lineTo(item.x - 5, item.y + dir * 15);
        ctx.lineTo(item.x + 5, item.y + dir * 15);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
  }

  private drawParticles(ctx: CanvasRenderingContext2D, engine: RenderableVersus) {
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
      ctx.globalAlpha = a;
      ctx.globalCompositeOperation = "lighter";
      if (p.kind === "ring") {
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(p.x, p.y, (1 - a) * 20 + 4, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      }
    }
    ctx.restore();
  }

  private drawOverlay(ctx: CanvasRenderingContext2D, engine: RenderableVersus) {
    if (engine.flash > 0) {
      ctx.fillStyle = engine.flashColor;
      ctx.globalAlpha = Math.min(0.45, engine.flash * 0.45);
      ctx.fillRect(0, 0, V_W, V_H);
      ctx.globalAlpha = 1;
    }

    ctx.textAlign = "center";
    if (engine.phase === "countdown") {
      const n = Math.ceil(engine.countdown - 0.2);
      const text = n <= 0 ? "GO!" : String(n);
      const scale = 1 + (1 - (engine.countdown % 1)) * 0.3;
      ctx.save();
      ctx.translate(V_W / 2, V_H / 2);
      ctx.scale(scale, scale);
      ctx.fillStyle = n <= 0 ? "#8dff5a" : "#ffffff";
      ctx.font = "bold 64px ui-monospace, monospace";
      ctx.fillText(text, 0, 20);
      ctx.restore();
      ctx.fillStyle = "rgba(255,255,255,0.6)";
      ctx.font = "bold 13px ui-monospace, monospace";
      ctx.fillText(`ROUND ${engine.round}`, V_W / 2, V_H / 2 - 70);
    }

    if (engine.phase === "roundEnd" || engine.phase === "matchEnd") {
      ctx.fillStyle = "rgba(0,0,0,0.5)";
      ctx.fillRect(0, V_H / 2 - 70, V_W, 140);
      const winner = engine.lastRoundWinner;
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 30px ui-monospace, monospace";
      ctx.fillText(engine.banner ?? "", V_W / 2, V_H / 2 - 14);
      ctx.font = "bold 16px system-ui, sans-serif";
      ctx.fillStyle = winner === 0 ? "#cccccc" : engine.fighters[(winner ?? 1) - 1].color;
      ctx.fillText(
        winner === 0 ? "引き分け" : `${engine.fighters[(winner ?? 1) - 1].name} がラウンド獲得`,
        V_W / 2,
        V_H / 2 + 18,
      );
    }

    // オーバードライブ（終盤の火力上昇フェーズ）
    if (engine.overdrive) {
      const pulse = 0.35 + Math.sin(this.time * 8) * 0.2;
      ctx.save();
      ctx.strokeStyle = `rgba(255,120,60,${pulse})`;
      ctx.lineWidth = 6;
      ctx.strokeRect(3, 3, V_W - 6, V_H - 6);
      ctx.fillStyle = `rgba(255,150,80,${0.5 + pulse * 0.5})`;
      ctx.font = "bold 12px ui-monospace, monospace";
      ctx.textAlign = "center";
      ctx.fillText("OVERDRIVE  ダメージ 1.6倍", V_W / 2, BAND.top + 30);
      ctx.restore();
    }

    // 残り時間・ラウンド表示（中立ゾーン中央）
    if (engine.phase === "fighting" || engine.phase === "countdown") {
      const t = Math.ceil(Math.max(0, engine.roundTime));
      ctx.fillStyle = t <= 10 ? "#ff6b6b" : "rgba(255,255,255,0.85)";
      ctx.font = "bold 22px ui-monospace, monospace";
      ctx.fillText(String(t), V_W / 2, (BAND.top + BAND.bottom) / 2 + 8);
      ctx.font = "bold 9px ui-monospace, monospace";
      ctx.fillStyle = "rgba(255,255,255,0.4)";
      ctx.fillText(`ROUND ${engine.round}`, V_W / 2, (BAND.top + BAND.bottom) / 2 + 24);
    }

    // 武装の残り時間バッジ
    for (const f of engine.fighters) {
      if (f.weaponTimer <= 0) continue;
      const y = f.id === 1 ? BOTTOM_ZONE.bottom - 18 : TOP_ZONE.top + 22;
      ctx.fillStyle = f.color;
      ctx.font = "bold 9px ui-monospace, monospace";
      ctx.textAlign = "right";
      ctx.fillText(`${VERSUS_WEAPONS[f.weapon].label} ${f.weaponTimer.toFixed(1)}`, V_W - 8, y);
      ctx.textAlign = "center";
    }

    if (engine.settings.crt) {
      ctx.save();
      ctx.globalAlpha = 0.12;
      ctx.fillStyle = "#000";
      for (let y = 0; y < V_H; y += 3) ctx.fillRect(0, y, V_W, 1);
      ctx.restore();
      const vg = ctx.createRadialGradient(V_W / 2, V_H / 2, V_H * 0.36, V_W / 2, V_H / 2, V_H * 0.72);
      vg.addColorStop(0, "rgba(0,0,0,0)");
      vg.addColorStop(1, "rgba(0,0,0,0.5)");
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, V_W, V_H);
    }
  }
}
