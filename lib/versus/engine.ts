import type { GameAudio } from "../game/audio";
import { clamp, createRng, type Rng } from "../game/rng";
import type { Settings } from "../game/types";
import {
  BASE_ENERGY,
  BASE_REGEN,
  BASE_SPEED,
  BOMB_SPEC,
  COUNTDOWN_TIME,
  ENEMY_DENSITY,
  ENERGY_CAP,
  FIGHTER_H,
  FIGHTER_HIT_H,
  FIGHTER_HIT_W,
  FIGHTER_W,
  MAX_BOMBS,
  MAX_HP,
  MAX_POWER,
  MAX_SHIELD,
  MAX_SPEED_LEVEL,
  OVERDRIVE_AT,
  OVERDRIVE_DMG,
  PLAYER_COLORS,
  RAPID_DURATION,
  RAPID_MULTIPLIER,
  RAPID_REGEN_BONUS,
  ROUND_END_TIME,
  ROUND_TIME,
  SLOW_DURATION,
  SLOW_FACTOR,
  SPEED_STEP,
  V_H,
  V_W,
  VERSUS_ITEMS,
  VERSUS_WEAPONS,
  WEAPON_DURATION,
} from "./constants";
import { getCourse, wallsFor, zonesFor } from "./courses";
import { BAND_ENEMIES, pickEnemyType } from "./enemies";
import type {
  BandEnemy,
  Fighter,
  FighterInput,
  PlayerId,
  VersusBullet,
  VersusConfig,
  VersusHudSnapshot,
  VersusItem,
  VersusItemKind,
  VersusParticle,
  VersusCourse,
  VersusPhase,
  VersusWall,
  VersusWeapon,
  CourseZones,
} from "./types";

export interface VersusCallbacks {
  onPhaseChange?: (phase: VersusPhase) => void;
  onRoundEnd?: (winner: PlayerId | 0) => void;
  onMatchEnd?: (winner: PlayerId | 0) => void;
}

const ITEM_KEYS = Object.keys(VERSUS_ITEMS) as VersusItemKind[];

export class VersusEngine {
  settings: Settings;
  audio: GameAudio;
  config: VersusConfig;
  callbacks: VersusCallbacks = {};

  phase: VersusPhase = "menu";
  fighters: [Fighter, Fighter];
  bullets: VersusBullet[] = [];
  enemies: BandEnemy[] = [];
  items: VersusItem[] = [];
  particles: VersusParticle[] = [];

  /** 現在のコースと、そこから決まる陣地・中立ゾーンの座標 */
  course: VersusCourse = getCourse(undefined);
  zones: CourseZones = zonesFor(getCourse(undefined));
  /** 弾を止める壁。コースごとに配置が決まる */
  walls: VersusWall[] = [];

  round = 1;
  roundTime = ROUND_TIME;
  countdown = COUNTDOWN_TIME;
  roundEndTimer = 0;
  lastRoundWinner: PlayerId | 0 | null = null;
  matchWinner: PlayerId | 0 | null = null;
  banner: string | null = null;

  shake = 0;
  flash = 0;
  flashColor = "#ffffff";
  fps = 60;

  /** 試合のシード。同じシードと同じ入力列なら同じ試合が再現される */
  seed = 1;
  private rng: Rng = createRng(1);
  /** 0-1 の乱数（this を固定するためアロー関数で持つ） */
  private rnd = () => this.rng.next();
  private rand = (min: number, max: number) => min + this.rng.next() * (max - min);

  private idCounter = 1;
  private spawnTimer = 2;
  private elapsed = 0;
  private fpsAccum = 0;
  private fpsFrames = 0;

  constructor(settings: Settings, audio: GameAudio, config: VersusConfig) {
    this.settings = settings;
    this.audio = audio;
    this.config = config;
    this.applyCourse();
    this.fighters = [this.createFighter(1), this.createFighter(2)];
  }

  /** 設定されたコースから、陣地の座標と壁を組み直す */
  private applyCourse() {
    this.course = getCourse(this.config.course);
    this.zones = zonesFor(this.course);
    this.resetWalls();
  }

  private resetWalls() {
    this.walls = wallsFor(this.course).map((w, index) => ({
      ...w,
      index,
      maxHp: w.hp,
      hitFlash: 0,
    }));
  }

  // ---------------------------------------------------------------- 生成

  private createFighter(id: PlayerId): Fighter {
    const bottom = id === 1;
    const zone = bottom ? this.zones.bottom : this.zones.top;
    const palette = bottom ? PLAYER_COLORS.p1 : PLAYER_COLORS.p2;
    return {
      id,
      name: bottom ? "PLAYER 1" : this.config.mode === "cpu" ? "CPU" : "PLAYER 2",
      color: palette.color,
      accent: palette.accent,
      zoneTop: zone.top,
      zoneBottom: zone.bottom,
      dir: bottom ? -1 : 1,
      x: V_W / 2,
      y: bottom ? zone.bottom - 40 : zone.top + 40,
      w: FIGHTER_W,
      h: FIGHTER_H,
      hp: MAX_HP,
      maxHp: MAX_HP,
      shield: 0,
      maxShield: MAX_SHIELD,
      energy: BASE_ENERGY,
      maxEnergy: BASE_ENERGY,
      regen: BASE_REGEN,
      power: 1,
      weapon: "single",
      weaponTimer: 0,
      rapidTimer: 0,
      slowTimer: 0,
      speedLevel: 0,
      bombs: 0,
      fireCooldown: 0,
      invincible: 0,
      hitFlash: 0,
      wins: 0,
      shots: 0,
      hits: 0,
      kills: 0,
      pickups: 0,
      alive: true,
    };
  }

  private setPhase(phase: VersusPhase) {
    if (this.phase === phase) return;
    this.phase = phase;
    this.callbacks.onPhaseChange?.(phase);
  }

  setCallbacks(callbacks: VersusCallbacks) {
    this.callbacks = callbacks;
  }

  applySettings(settings: Settings) {
    this.settings = settings;
    this.audio.setVolumes(settings.sfxVolume, settings.bgmVolume);
  }

  // ---------------------------------------------------------------- 進行

  startMatch(config: VersusConfig, seed = Math.floor(Math.random() * 0xffffffff)) {
    this.config = config;
    this.seed = seed >>> 0;
    this.applyCourse();
    this.fighters = [this.createFighter(1), this.createFighter(2)];
    this.round = 1;
    this.matchWinner = null;
    this.lastRoundWinner = null;
    this.startRound();
  }

  startRound() {
    // ラウンドごとに決まった種から乱数を作り直す（同じシードなら同じ展開になる）
    this.rng = createRng((this.seed + this.round * 7919) >>> 0);
    // 強化状態はラウンドごとにリセットして毎回フラットな撃ち合いから始める
    for (const f of this.fighters) {
      const wins = f.wins;
      const fresh = this.createFighter(f.id);
      fresh.wins = wins;
      Object.assign(f, fresh);
    }
    this.bullets = [];
    this.enemies = [];
    this.items = [];
    this.particles = [];
    this.resetWalls();
    this.roundTime = ROUND_TIME;
    this.countdown = COUNTDOWN_TIME;
    this.spawnTimer = 2.2;
    this.elapsed = 0;
    this.banner = null;
    this.setPhase("countdown");
    this.audio.startBgm(this.round * 5 + 11, 140);
  }

  nextRound() {
    if (this.matchWinner !== null) return;
    this.round += 1;
    this.startRound();
  }

  pause() {
    if (this.phase !== "fighting" && this.phase !== "countdown") return;
    this.setPhase("paused");
    this.audio.stopBgm();
    this.audio.play("cancel");
  }

  resume() {
    if (this.phase !== "paused") return;
    this.setPhase("fighting");
    this.audio.startBgm(this.round * 5 + 11, 140);
  }

  quitToMenu() {
    this.audio.stopBgm();
    this.setPhase("menu");
    this.bullets = [];
    this.enemies = [];
    this.items = [];
  }

  // ---------------------------------------------------------------- 更新

  update(dt: number, inputs: [FighterInput, FighterInput]) {
    this.fpsAccum += dt;
    this.fpsFrames += 1;
    if (this.fpsAccum >= 0.4) {
      this.fps = Math.round(this.fpsFrames / this.fpsAccum);
      this.fpsAccum = 0;
      this.fpsFrames = 0;
    }
    this.shake = Math.max(0, this.shake - dt * 26);
    this.flash = Math.max(0, this.flash - dt * 3.2);

    switch (this.phase) {
      case "countdown": {
        this.countdown -= dt;
        this.updateParticles(dt);
        if (this.countdown <= 0) {
          this.setPhase("fighting");
          this.audio.play("confirm");
        }
        break;
      }
      case "fighting":
        this.updateFighting(dt, inputs);
        break;
      case "roundEnd": {
        this.roundEndTimer -= dt;
        this.updateBullets(dt);
        this.updateParticles(dt);
        break;
      }
      default:
        this.updateParticles(dt);
        break;
    }
  }

  private updateFighting(dt: number, inputs: [FighterInput, FighterInput]) {
    this.elapsed += dt;
    this.roundTime -= dt;

    this.updateFighter(this.fighters[0], inputs[0], dt);
    this.updateFighter(this.fighters[1], inputs[1], dt);
    for (const w of this.walls) if (w.hitFlash > 0) w.hitFlash -= dt;
    this.updateEnemies(dt);
    this.updateBullets(dt);
    this.updateItems(dt);
    this.updateParticles(dt);
    this.collide();

    if (this.roundTime <= 0) {
      this.endRound(this.judgeByPoints(), "TIME UP");
    }
  }

  /** 時間切れの判定：残り耐久 → 中立ゾーンの撃破数 → 取得アイテム数の順に比較する */
  private judgeByPoints(): PlayerId | 0 {
    const [a, b] = this.fighters;
    if (a.hp !== b.hp) return a.hp > b.hp ? 1 : 2;
    if (a.kills !== b.kills) return a.kills > b.kills ? 1 : 2;
    if (a.pickups !== b.pickups) return a.pickups > b.pickups ? 1 : 2;
    return 0;
  }

  /** 終盤の火力上昇フェーズかどうか */
  get overdrive(): boolean {
    return this.phase === "fighting" && this.roundTime <= OVERDRIVE_AT;
  }

  // ---------------------------------------------------------------- 自機

  private updateFighter(f: Fighter, input: FighterInput, dt: number) {
    if (f.hitFlash > 0) f.hitFlash -= dt;
    if (f.invincible > 0) f.invincible -= dt;
    if (f.slowTimer > 0) f.slowTimer -= dt;
    if (f.rapidTimer > 0) {
      f.rapidTimer -= dt;
      if (f.rapidTimer <= 0) f.regen = Math.max(BASE_REGEN, f.regen - RAPID_REGEN_BONUS);
    }
    if (f.weaponTimer > 0) {
      f.weaponTimer -= dt;
      if (f.weaponTimer <= 0) f.weapon = "single";
    }

    f.energy = Math.min(f.maxEnergy, f.energy + f.regen * dt);

    const slowMul = f.slowTimer > 0 ? SLOW_FACTOR : 1;
    const speed = (BASE_SPEED + f.speedLevel * SPEED_STEP) * slowMul;
    let dx = 0;
    let dy = 0;
    if (input.left) dx -= 1;
    if (input.right) dx += 1;
    if (input.up) dy -= 1;
    if (input.down) dy += 1;
    if (dx !== 0 || dy !== 0) {
      const len = Math.hypot(dx, dy) || 1;
      f.x += (dx / len) * speed * dt;
      f.y += (dy / len) * speed * dt;
    }
    f.x = clamp(f.x, 14, V_W - 14);
    f.y = clamp(f.y, f.zoneTop + 14, f.zoneBottom - 14);

    f.fireCooldown -= dt;
    if (input.special && f.bombs > 0 && f.fireCooldown <= 0) {
      this.fireBomb(f);
    } else if (input.fire && f.fireCooldown <= 0) {
      this.fireWeapon(f);
    }
  }

  /** 実際の発射間隔（ラピッド適用後） */
  fireInterval(f: Fighter): number {
    return VERSUS_WEAPONS[f.weapon].interval * (f.rapidTimer > 0 ? RAPID_MULTIPLIER : 1);
  }

  private fireWeapon(f: Fighter) {
    const spec = VERSUS_WEAPONS[f.weapon];
    if (f.energy < spec.cost) {
      this.audio.play("cancel", 1.6, 260);
      f.fireCooldown = 0.16;
      return;
    }
    f.energy -= spec.cost;
    f.fireCooldown = this.fireInterval(f);
    const pattern = spec.pattern(clamp(f.power, 1, MAX_POWER));
    for (const s of pattern) {
      const angle = s.angle;
      this.bullets.push({
        id: this.idCounter++,
        x: f.x + s.ox,
        y: f.y + f.dir * 14,
        vx: Math.sin(angle) * spec.speed,
        vy: f.dir * Math.cos(angle) * spec.speed,
        w: spec.w,
        h: spec.h,
        dmg: spec.dmg,
        owner: f.id,
        kind: f.weapon,
        pierce: spec.pierce,
        homing: spec.homing,
        life: 4,
        color: spec.color,
        hitIds: spec.pierce > 0 ? new Set<number>() : undefined,
      });
    }
    f.shots += pattern.length;
    this.audio.play(f.weapon === "laser" ? "laser" : f.weapon === "homing" ? "missile" : "shot", 1, 30);
  }

  private fireBomb(f: Fighter) {
    f.bombs -= 1;
    f.fireCooldown = 0.7;
    this.bullets.push({
      id: this.idCounter++,
      x: f.x,
      y: f.y + f.dir * 16,
      vx: 0,
      vy: f.dir * BOMB_SPEC.speed,
      w: BOMB_SPEC.w,
      h: BOMB_SPEC.h,
      dmg: BOMB_SPEC.dmg,
      owner: f.id,
      kind: "bomb",
      pierce: 99,
      homing: 0,
      life: 4,
      color: BOMB_SPEC.color,
      hitIds: new Set<number>(),
    });
    this.audio.play("bomb", 1.4);
    this.shake = 8;
  }

  private damageFighter(f: Fighter, dmg: number, from: PlayerId | 0) {
    if (!f.alive || f.invincible > 0) return;
    if (f.shield > 0) {
      f.shield -= 1;
      f.invincible = 0.35;
      f.hitFlash = 0.12;
      this.audio.play("hit", 0.7);
      this.spawnParticles(f.x, f.y, 8, "#7ec8ff", "ring");
      return;
    }
    f.hp -= this.overdrive ? dmg * OVERDRIVE_DMG : dmg;
    f.hitFlash = 0.14;
    // 無敵時間を短くして、拡散弾やパワーアップ分の手数がダメージに反映されるようにする
    f.invincible = 0.15;
    this.audio.play("damage", 1.1);
    this.spawnParticles(f.x, f.y, 10, f.color, "spark");
    this.shake = 10;
    if (from !== 0) {
      const attacker = this.fighters[from - 1];
      attacker.hits += 1;
    }
    if (f.hp <= 0) {
      f.hp = 0;
      f.alive = false;
      this.spawnParticles(f.x, f.y, 40, "#ffb45c", "spark");
      this.spawnParticles(f.x, f.y, 10, "#ffffff", "ring");
      this.audio.play("bigExplode");
      this.shake = 26;
      this.flash = 0.7;
      this.flashColor = f.color;
      const winner: PlayerId = f.id === 1 ? 2 : 1;
      this.endRound(winner, "K.O.");
    }
  }

  private endRound(winner: PlayerId | 0, reason: string) {
    if (this.phase === "roundEnd" || this.phase === "matchEnd") return;
    this.lastRoundWinner = winner;
    this.banner = reason;
    if (winner !== 0) this.fighters[winner - 1].wins += 1;
    this.roundEndTimer = ROUND_END_TIME;
    this.audio.stopBgm();
    this.callbacks.onRoundEnd?.(winner);

    const needed = this.config.roundsToWin;
    const champion = this.fighters.find((f) => f.wins >= needed);
    if (champion) {
      this.matchWinner = champion.id;
      this.setPhase("matchEnd");
      this.audio.play("stageClear");
      this.callbacks.onMatchEnd?.(champion.id);
    } else {
      this.setPhase("roundEnd");
      this.audio.play("warning");
    }
  }

  // ---------------------------------------------------------------- 中立ゾーンの敵

  private updateEnemies(dt: number) {
    const density = ENEMY_DENSITY[this.config.enemyDensity];
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      const ramp = Math.max(0.45, 1 - this.elapsed * density.ramp);
      // コースごとの湧きやすさ。間隔を割るので、値が大きいほど多く出る
      this.spawnTimer = (this.rand(density.min, density.max) * ramp) / this.course.enemyRate;
      this.spawnEnemy();
    }

    for (const e of this.enemies) {
      const def = BAND_ENEMIES[e.type];
      e.t += dt;
      if (e.hitFlash > 0) e.hitFlash -= dt;
      e.x += e.vx * dt;
      e.y = e.baseY + Math.sin(e.t * 1.6) * def.wave;

      if (def.fireInterval > 0) {
        e.fireCooldown -= dt;
        if (e.fireCooldown <= 0) {
          e.fireCooldown = def.fireInterval * this.rand(0.75, 1.35);
          this.enemyShoot(e);
        }
      }
    }
    this.enemies = this.enemies.filter((e) => e.hp > 0 && e.x > -60 && e.x < V_W + 60);
  }

  private spawnEnemy() {
    const type = pickEnemyType(this.elapsed, this.rnd);
    const def = BAND_ENEMIES[type];
    const fromLeft = this.rnd() < 0.5;
    const margin = 26;
    const y = this.rand(this.zones.band.top + margin, this.zones.band.bottom - margin);
    this.enemies.push({
      id: this.idCounter++,
      type,
      x: fromLeft ? -30 : V_W + 30,
      y,
      vx: (fromLeft ? 1 : -1) * def.speed * this.rand(0.85, 1.15),
      baseY: y,
      w: def.w,
      h: def.h,
      hp: def.hp,
      maxHp: def.hp,
      t: this.rnd() * 6,
      fireCooldown: this.rand(0.6, def.fireInterval || 2),
      hitFlash: 0,
      lastHitBy: null,
    });
  }

  private enemyShoot(e: BandEnemy) {
    const def = BAND_ENEMIES[e.type];
    const speed = def.attack === "bombBoth" ? 120 : 175;
    const push = (vx: number, vy: number, size: number, color: string) => {
      this.bullets.push({
        id: this.idCounter++,
        x: e.x,
        y: e.y + Math.sign(vy) * 12,
        vx,
        vy,
        w: size,
        h: size,
        dmg: 1,
        owner: 0,
        kind: "enemy",
        pierce: 0,
        homing: 0,
        life: 6,
        color,
        });
    };
    switch (def.attack) {
      case "both":
        push(0, speed, 7, "#ff6b6b");
        push(0, -speed, 7, "#ff6b6b");
        break;
      case "bombBoth":
        push(this.rand(-25, 25), speed, 12, "#c58dff");
        push(this.rand(-25, 25), -speed, 12, "#c58dff");
        break;
      case "nearest": {
        // 近い方のプレイヤーを狙う
        const target = this.fighters
          .map((f) => ({ f, d: Math.hypot(f.x - e.x, f.y - e.y) }))
          .sort((a, b) => a.d - b.d)[0].f;
        const a = Math.atan2(target.y - e.y, target.x - e.x);
        push(Math.cos(a) * speed * 1.2, Math.sin(a) * speed * 1.2, 6, "#ffd166");
        break;
      }
      default:
        break;
    }
    this.audio.play("shot", 0.55, 110);
  }

  private damageEnemy(e: BandEnemy, dmg: number, by: PlayerId) {
    e.hp -= dmg;
    e.hitFlash = 0.08;
    e.lastHitBy = by;
    this.audio.play("hit", 1.15, 30);
    if (e.hp <= 0) {
      const def = BAND_ENEMIES[e.type];
      this.spawnParticles(e.x, e.y, def.hp > 5 ? 22 : 12, def.color, "spark");
      this.audio.play("explode", this.rand(0.9, 1.2), 25);
      this.fighters[by - 1].kills += 1;
      this.dropItem(e, by);
    }
  }

  /** 撃破した側の陣地へアイテムを流す */
  private dropItem(e: BandEnemy, owner: PlayerId) {
    const def = BAND_ENEMIES[e.type];
    const kind = def.fixedDrop ?? this.rollItem(def.rareBias);
    const dir = owner === 1 ? 1 : -1;
    this.items.push({
      id: this.idCounter++,
      kind,
      owner,
      x: e.x,
      y: e.y,
      vx: this.rand(-18, 18),
      vy: dir * this.rand(130, 170),
      life: 9,
    });
    const label = VERSUS_ITEMS[kind];
    this.floatText(e.x, e.y, label.short, label.color);
  }

  private rollItem(rareBias: number): VersusItemKind {
    const weights = ITEM_KEYS.map((k) => {
      const item = VERSUS_ITEMS[k];
      return item.rare ? item.weight * (0.35 + rareBias) : item.weight;
    });
    const total = weights.reduce((s, w) => s + w, 0);
    let roll = this.rnd() * total;
    for (let i = 0; i < ITEM_KEYS.length; i++) {
      roll -= weights[i];
      if (roll <= 0) return ITEM_KEYS[i];
    }
    return "power";
  }

  // ---------------------------------------------------------------- 弾・アイテム

  private updateBullets(dt: number) {
    const out: VersusBullet[] = [];
    for (const b of this.bullets) {
      b.life -= dt;
      if (b.homing > 0 && b.owner !== 0) {
        const target = this.homingTarget(b);
        if (target) {
          const desired = Math.atan2(target.y - b.y, target.x - b.x);
          const cur = Math.atan2(b.vy, b.vx);
          let diff = desired - cur;
          while (diff > Math.PI) diff -= Math.PI * 2;
          while (diff < -Math.PI) diff += Math.PI * 2;
          const na = cur + clamp(diff, -b.homing * dt, b.homing * dt);
          const sp = Math.hypot(b.vx, b.vy);
          b.vx = Math.cos(na) * sp;
          b.vy = Math.sin(na) * sp;
        }
      }
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      // 壁は弾だけを止める。貫通は効かない（遮蔽としての意味を保つため）
      if (this.hitWall(b)) continue;
      if (b.life > 0 && b.y > -30 && b.y < V_H + 30 && b.x > -30 && b.x < V_W + 30) out.push(b);
    }
    this.bullets = out;
  }

  /** 弾が壁に当たったら壁を削って true を返す */
  private hitWall(b: VersusBullet): boolean {
    for (const w of this.walls) {
      if (w.hp <= 0) continue;
      if (Math.abs(b.x - w.x) > (w.w + b.w) / 2) continue;
      if (Math.abs(b.y - w.y) > (w.h + b.h) / 2) continue;
      w.hp -= b.dmg;
      w.hitFlash = 0.12;
      this.spawnParticles(b.x, b.y, 3, w.hp > 0 ? "#cfd8e6" : "#ffe86b", "spark");
      if (w.hp <= 0) {
        this.spawnParticles(w.x, w.y, 14, "#cfd8e6", "spark");
        this.audio.play("explode", 1.4, 80);
        this.shake = Math.max(this.shake, 7);
      } else {
        this.audio.play("hit", 1.5, 70);
      }
      return true;
    }
    return false;
  }

  /** 追尾先：中立ゾーンの敵を優先し、いなければ相手プレイヤー */
  private homingTarget(b: VersusBullet): { x: number; y: number } | null {
    let best: { x: number; y: number } | null = null;
    let bestD = Infinity;
    for (const e of this.enemies) {
      // 進行方向にいる敵のみ狙う
      if (Math.sign(e.y - b.y) !== Math.sign(b.vy) && Math.abs(e.y - b.y) > 20) continue;
      const d = Math.hypot(e.x - b.x, e.y - b.y);
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    if (best) return best;
    const foe = this.fighters[b.owner === 1 ? 1 : 0];
    return foe.alive ? foe : null;
  }

  private updateItems(dt: number) {
    const out: VersusItem[] = [];
    for (const item of this.items) {
      item.life -= dt;
      const owner = this.fighters[item.owner - 1];
      const inZone = item.y > owner.zoneTop && item.y < owner.zoneBottom;
      if (inZone) {
        // 自陣に入ったらゆっくり漂う
        item.vy *= 1 - Math.min(1, dt * 3.4);
        item.vx *= 1 - Math.min(1, dt * 2);
      }
      item.x += item.vx * dt;
      item.y += item.vy * dt;
      item.x = clamp(item.x, 14, V_W - 14);
      item.y = clamp(item.y, this.zones.top.top + 10, this.zones.bottom.bottom - 10);

      if (owner.alive && Math.hypot(owner.x - item.x, owner.y - item.y) < 22) {
        this.collectItem(owner, item.kind);
        continue;
      }
      if (item.life > 0) out.push(item);
      else this.spawnParticles(item.x, item.y, 5, "#888", "spark");
    }
    this.items = out;
  }

  private collectItem(f: Fighter, kind: VersusItemKind) {
    const label = VERSUS_ITEMS[kind];
    f.pickups += 1;
    this.audio.play(kind === "power" ? "powerup" : "item");
    this.spawnParticles(f.x, f.y, 8, label.color, "ring");
    this.floatText(f.x, f.y - 18, label.name, label.color);

    switch (kind) {
      case "power":
        f.power = Math.min(MAX_POWER, f.power + 1);
        break;
      case "rapid":
        // 重ねがけ不可。時間を上書きするだけで連射上限は伸ばさない
        if (f.rapidTimer <= 0) f.regen += RAPID_REGEN_BONUS;
        f.rapidTimer = RAPID_DURATION;
        break;
      case "spread":
      case "laser":
      case "homing":
        f.weapon = kind as VersusWeapon;
        f.weaponTimer = WEAPON_DURATION;
        break;
      case "shield":
        f.shield = Math.min(f.maxShield, f.shield + 1);
        break;
      case "heal":
        f.hp = Math.min(f.maxHp, f.hp + 2);
        break;
      case "speed":
        f.speedLevel = Math.min(MAX_SPEED_LEVEL, f.speedLevel + 1);
        break;
      case "energy":
        f.maxEnergy = Math.min(ENERGY_CAP, f.maxEnergy + 10);
        f.energy = f.maxEnergy;
        break;
      case "bomb":
        f.bombs = Math.min(MAX_BOMBS, f.bombs + 1);
        break;
      case "slow": {
        const foe = this.fighters[f.id === 1 ? 1 : 0];
        foe.slowTimer = SLOW_DURATION;
        this.floatText(foe.x, foe.y - 20, "SLOW!", "#a0c4ff");
        this.spawnParticles(foe.x, foe.y, 10, "#a0c4ff", "ring");
        break;
      }
    }
  }

  // ---------------------------------------------------------------- 当たり判定

  private collide() {
    for (const b of this.bullets) {
      if (b.life <= 0) continue;

      // プレイヤーの弾 → 中立ゾーンの敵
      if (b.owner !== 0) {
        for (const e of this.enemies) {
          if (e.hp <= 0) continue;
          if (b.hitIds?.has(e.id)) continue;
          if (Math.abs(b.x - e.x) > (b.w + e.w) / 2 || Math.abs(b.y - e.y) > (b.h + e.h) / 2) continue;
          this.damageEnemy(e, b.dmg, b.owner);
          this.spawnParticles(b.x, b.y, 3, b.color, "spark");
          if (b.pierce > 0) {
            b.hitIds?.add(e.id);
          } else {
            b.life = 0;
            break;
          }
        }
        if (b.life <= 0) continue;
      }

      // ボムは相手の弾を消しながら進む
      if (b.kind === "bomb") {
        for (const other of this.bullets) {
          if (other === b || other.life <= 0) continue;
          if (other.owner === b.owner) continue;
          if (Math.abs(other.x - b.x) > (other.w + b.w) / 2) continue;
          if (Math.abs(other.y - b.y) > (other.h + b.h) / 2) continue;
          other.life = 0;
          this.spawnParticles(other.x, other.y, 2, "#ffe86b", "spark");
        }
      }

      // 弾 → プレイヤー
      for (const f of this.fighters) {
        if (!f.alive) continue;
        if (b.owner === f.id) continue;
        if (Math.abs(b.x - f.x) > (b.w + FIGHTER_HIT_W) / 2) continue;
        if (Math.abs(b.y - f.y) > (b.h + FIGHTER_HIT_H) / 2) continue;
        this.damageFighter(f, b.dmg, b.owner);
        if (b.kind !== "bomb") b.life = 0;
        break;
      }
    }
    this.bullets = this.bullets.filter((b) => b.life > 0);
  }

  // ---------------------------------------------------------------- 演出

  spawnParticles(x: number, y: number, count: number, color: string, kind: "spark" | "ring") {
    const scale = this.settings.particles === "low" ? 0.4 : this.settings.particles === "high" ? 1.5 : 1;
    const n = Math.max(1, Math.round(count * scale));
    if (this.particles.length > 700) return;
    for (let i = 0; i < n; i++) {
      const a = this.rnd() * Math.PI * 2;
      const sp = kind === "ring" ? this.rand(40, 110) : this.rand(40, 210);
      const life = this.rand(0.25, 0.7);
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life,
        maxLife: life,
        size: this.rand(1.4, 3.2),
        color,
        kind,
      });
    }
  }

  private floatText(x: number, y: number, text: string, color: string) {
    this.particles.push({
      x,
      y,
      vx: 0,
      vy: -30,
      life: 1,
      maxLife: 1,
      size: 11,
      color,
      kind: "text",
      text,
    });
  }

  private updateParticles(dt: number) {
    const out: VersusParticle[] = [];
    for (const p of this.particles) {
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 1 - 1.6 * dt;
      p.vy *= 1 - 1.6 * dt;
      if (p.life > 0) out.push(p);
    }
    this.particles = out;
  }

  // ---------------------------------------------------------------- HUD

  getHud(): VersusHudSnapshot {
    const toHud = (f: Fighter) => ({
      id: f.id,
      name: f.name,
      color: f.color,
      hp: f.hp,
      maxHp: f.maxHp,
      shield: f.shield,
      energy: f.energy,
      maxEnergy: f.maxEnergy,
      power: f.power,
      weapon: f.weapon,
      weaponTimer: f.weaponTimer,
      rapid: f.rapidTimer > 0,
      slowed: f.slowTimer > 0,
      speedLevel: f.speedLevel,
      bombs: f.bombs,
      wins: f.wins,
      kills: f.kills,
      pickups: f.pickups,
    });
    return {
      phase: this.phase,
      round: this.round,
      roundsToWin: this.config.roundsToWin,
      timeLeft: Math.max(0, this.roundTime),
      countdown: this.countdown,
      fighters: [toHud(this.fighters[0]), toHud(this.fighters[1])],
      enemiesInBand: this.enemies.length,
      overdrive: this.overdrive,
      fps: this.fps,
      lastRoundWinner: this.lastRoundWinner,
      matchWinner: this.matchWinner,
      banner: this.banner,
    };
  }
}
