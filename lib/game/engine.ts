import { AudioEngine } from "./audio";
import {
  COMBO_TIMEOUT,
  DIFFICULTY,
  FIELD_BOTTOM,
  FIELD_TOP,
  ITEM_LABEL,
  MAX_BOMBS,
  MAX_OPTIONS,
  MAX_POWER,
  MAX_SPEED_LEVEL,
  PLAYER_BASE_SPEED,
  PLAYER_MAX_HP,
  PLAYER_MAX_SHIELD,
  PLAYER_SPEED_STEP,
  POWERUP_DURATION,
  CARRY_POLICY,
  RESPAWN_INVINCIBLE,
  START_BOMBS,
  TRAIL_LENGTH,
  VIEW_H,
  VIEW_W,
} from "./constants";
import { BOSS_DEFS, ENEMY_DEFS, type BossAttack } from "./enemies";
import { entryStart, generateSlots } from "./formations";
import type { InputState } from "./input";
import { clamp, pick, rand, randInt } from "./rng";
import {
  applyRunLoadout,
  emptyRun,
  offerUpgrades,
  recomputeRun,
  takeUpgrade,
  THREAT_SCALE,
  wantedPods,
} from "./roguelite";
import { getStage, STAGE_COUNT } from "./stages";
import { resetProgress, saveProgress } from "./storage";
import type {
  Boss,
  Bullet,
  Enemy,
  EnemyTypeId,
  HudSnapshot,
  Item,
  ItemKind,
  Particle,
  Phase,
  PlayerState,
  Progress,
  RogueRun,
  RogueUpgradeId,
  Settings,
  StageDef,
  StageResult,
  TimedPowerupKind,
  WeaponKind,
} from "./types";

interface WeaponSpec {
  interval: number;
  dmg: number;
  speed: number;
  pierce: number;
  homing: number;
  w: number;
  h: number;
  color: string;
  sfx: "shot" | "laser" | "missile" | "wave" | "rail";
}

const WEAPONS: Record<WeaponKind, WeaponSpec> = {
  vulcan: { interval: 0.13, dmg: 1, speed: 640, pierce: 0, homing: 0, w: 4, h: 12, color: "#ffe86b", sfx: "shot" },
  spread: { interval: 0.21, dmg: 0.9, speed: 520, pierce: 0, homing: 0, w: 5, h: 9, color: "#7dff9b", sfx: "shot" },
  laser: { interval: 0.085, dmg: 0.62, speed: 950, pierce: 1, homing: 0, w: 3, h: 22, color: "#6fe8ff", sfx: "laser" },
  missile: { interval: 0.3, dmg: 2.2, speed: 400, pierce: 0, homing: 3.4, w: 6, h: 12, color: "#ff9d5c", sfx: "missile" },
  wave: { interval: 0.36, dmg: 1.5, speed: 320, pierce: 99, homing: 0, w: 34, h: 14, color: "#c58dff", sfx: "wave" },
  rail: { interval: 0.46, dmg: 4.6, speed: 1150, pierce: 99, homing: 0, w: 8, h: 30, color: "#ff6fa5", sfx: "rail" },
};

const ITEM_POOL: { kind: ItemKind; weight: number }[] = [
  { kind: "power", weight: 22 },
  { kind: "option", weight: 8 },
  { kind: "shield", weight: 9 },
  { kind: "speed", weight: 7 },
  { kind: "rapid", weight: 7 },
  { kind: "bomb", weight: 6 },
  { kind: "score2x", weight: 6 },
  { kind: "slow", weight: 5 },
  { kind: "magnet", weight: 5 },
  { kind: "freeze", weight: 4 },
  { kind: "pierce", weight: 5 },
  { kind: "heal", weight: 6 },
  { kind: "spread", weight: 5 },
  { kind: "laser", weight: 5 },
  { kind: "missile", weight: 4 },
  { kind: "wave", weight: 3 },
  { kind: "rail", weight: 2 },
  { kind: "life", weight: 1 },
];

export interface Hazard {
  kind: "meteor" | "debris" | "beam" | "beamWarn";
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  hp: number;
  t: number;
  life: number;
  angle: number;
  spin: number;
}

interface Star {
  x: number;
  y: number;
  z: number;
  size: number;
}

export interface EngineCallbacks {
  onPhaseChange?: (phase: Phase) => void;
  onProgress?: (progress: Progress) => void;
}

const EXTEND_SCORE = 100000;

export class GameEngine {
  settings: Settings;
  progress: Progress;
  audio: AudioEngine;
  callbacks: EngineCallbacks = {};

  phase: Phase = "title";
  stageIndex = 1;
  stage: StageDef = getStage(1);
  waveIndex = 0;

  player: PlayerState = createPlayer();
  /** ローグライトの状態。active でなければ通常のキャンペーン */
  run: RogueRun = emptyRun();
  enemies: Enemy[] = [];
  bullets: Bullet[] = [];
  items: Item[] = [];
  particles: Particle[] = [];
  hazards: Hazard[] = [];
  boss: Boss | null = null;
  stars: Star[] = [];

  score = 0;
  displayScore = 0;
  totalRunScore = 0;
  combo = 0;
  maxCombo = 0;
  comboTimer = 0;
  nextExtend = EXTEND_SCORE;

  powerups: Record<TimedPowerupKind, number> = {
    rapid: 0,
    score2x: 0,
    slow: 0,
    magnet: 0,
    freeze: 0,
    pierce: 0,
    invincible: 0,
  };

  shake = 0;
  flash = 0;
  flashColor = "#ffffff";
  bombFlash = 0;
  briefingTimer = 0;
  clearTimer = 0;
  warningTimer = 0;
  stageTimeMs = 0;
  stageResult: StageResult | null = null;
  fps = 60;

  /** 前フレームのボム入力。押しっぱなしで在庫が一気に消えるのを防ぐ */
  private bombHeld = false;
  private idCounter = 1;
  private formOffsetX = 0;
  private formDir = 1;
  private formDrop = 0;
  private formSpeed = 26;
  private waveSpawned = false;
  private waveDoneTimer = 0;
  private hazardTimer = 0;
  private shotsFired = 0;
  private shotsHit = 0;
  private tookDamage = false;
  private fpsAccum = 0;
  private fpsFrames = 0;

  constructor(settings: Settings, progress: Progress, audio: AudioEngine) {
    this.settings = settings;
    this.progress = progress;
    this.audio = audio;
    this.initStars();
  }

  private initStars() {
    this.stars = [];
    for (let i = 0; i < 110; i++) {
      this.stars.push({
        x: Math.random() * VIEW_W,
        y: Math.random() * VIEW_H,
        z: rand(0.25, 1),
        size: rand(0.6, 2.1),
      });
    }
  }

  /**
   * 難易度の係数。ローグライトでは、積んだ強化に応じて敵も強くする。
   * 強化を積むほど楽になる、という状態にしないための中心的な仕掛け。
   */
  private get diff() {
    const base = DIFFICULTY[this.settings.difficulty];
    if (!this.run.active) return base;
    const t = this.run.threat;
    return {
      ...base,
      enemyHp: base.enemyHp * (1 + t * THREAT_SCALE.hp),
      enemyFire: base.enemyFire * (1 + t * THREAT_SCALE.fire),
      bulletSpeed: base.bulletSpeed * (1 + t * THREAT_SCALE.bulletSpeed) * this.run.enemyBulletMul,
      enemySpeed: base.enemySpeed * (1 + t * THREAT_SCALE.moveSpeed),
      scoreMul: base.scoreMul * (1 + t * THREAT_SCALE.score) * this.run.scoreMul,
    };
  }

  private setPhase(phase: Phase) {
    if (this.phase === phase) return;
    this.phase = phase;
    this.callbacks.onPhaseChange?.(phase);
  }

  // ---------------------------------------------------------------- ライフサイクル

  /** 新規プレイ開始（ステージ選択から） */
  startRun(stageIndex: number) {
    this.player = createPlayer();
    this.player.lives = this.diff.startLives;
    this.score = 0;
    this.displayScore = 0;
    this.totalRunScore = 0;
    this.maxCombo = 0;
    this.nextExtend = EXTEND_SCORE;
    this.progress.playCount += 1;
    this.persist();
    this.loadStage(stageIndex);
  }

  loadStage(stageIndex: number) {
    this.stageIndex = clamp(stageIndex, 1, STAGE_COUNT);
    this.stage = getStage(this.stageIndex);
    this.waveIndex = 0;
    this.enemies = [];
    this.bullets = [];
    this.items = [];
    this.particles = [];
    this.hazards = [];
    this.boss = null;
    this.combo = 0;
    this.comboTimer = 0;
    this.stageTimeMs = 0;
    this.shotsFired = 0;
    this.shotsHit = 0;
    this.tookDamage = false;
    this.waveSpawned = false;
    this.waveDoneTimer = 0;
    this.formOffsetX = 0;
    this.formDrop = 0;
    this.formDir = 1;
    this.stageResult = null;
    this.bossDefeated = false;
    this.hazardTimer = 0.8;
    this.briefingTimer = 2.6;
    if (this.run.active) {
      // 強化で決まった構成に戻す。前のステージで拾ったアイテムはここで消える
      this.run.depth = Math.max(this.run.depth, this.stageIndex);
      applyRunLoadout(this.player, this.run, PLAYER_MAX_HP, PLAYER_MAX_SHIELD);
      this.syncPods();
    }
    this.resetPlayerPosition();
    this.setPhase("briefing");
    this.audio.startBgm(this.stageIndex * 7 + 3, this.stage.boss ? 128 : 152);
  }

  /** ポッドの数を強化に合わせる（足りなければ生やす） */
  private syncPods() {
    const p = this.player;
    const want = wantedPods(this.run);
    while (p.options.length < want) {
      p.options.push({ x: p.x, y: p.y + 30, angle: 0, fireCooldown: 0 });
    }
    if (p.options.length > want) p.options.length = want;
  }

  private resetPlayerPosition() {
    this.player.x = VIEW_W / 2;
    this.player.y = FIELD_BOTTOM - 60;
    this.player.trail = [];
  }

  pause() {
    if (this.phase !== "playing" && this.phase !== "briefing") return;
    this.setPhase("paused");
    this.audio.stopBgm();
    this.audio.play("cancel");
  }

  resume() {
    if (this.phase !== "paused") return;
    this.setPhase("playing");
    this.audio.startBgm(this.stageIndex * 7 + 3, this.stage.boss ? 128 : 152);
  }

  togglePause() {
    if (this.phase === "playing" || this.phase === "briefing") this.pause();
    else if (this.phase === "paused") this.resume();
  }

  quitToTitle() {
    this.audio.stopBgm();
    this.setPhase("title");
    this.enemies = [];
    this.bullets = [];
    this.items = [];
    this.boss = null;
  }

  nextStage() {
    // ローグライトでは強化を選び終えるまで次のステージへ進まない
    if (this.run.active && this.run.offer.length > 0) return;
    if (this.stageIndex >= STAGE_COUNT) {
      this.setPhase("allClear");
      return;
    }
    if (!this.run.active) this.applyCarryOver();
    this.loadStage(this.stageIndex + 1);
  }

  /** ローグライトを開始する。必ず1面から、残機なしで進む */
  startRogueRun() {
    this.player = createPlayer();
    this.run = emptyRun();
    this.run.active = true;
    recomputeRun(this.run);
    this.player.lives = 0; // ミス即終了
    this.score = 0;
    this.displayScore = 0;
    this.totalRunScore = 0;
    this.maxCombo = 0;
    this.nextExtend = Infinity; // 残機は増えない
    this.progress.playCount += 1;
    this.persist();
    this.loadStage(1);
  }

  /** クリア後に提示中の強化を取る */
  pickUpgrade(id: RogueUpgradeId): boolean {
    if (!this.run.active) return false;
    if (!this.run.offer.includes(id)) return false;
    if (!takeUpgrade(this.run, id)) return false;
    this.audio.play("powerup");
    return true;
  }

  get awaitingUpgrade(): boolean {
    return this.run.active && this.run.offer.length > 0;
  }

  /**
   * 次のステージへ持ち越す強化を、難易度ごとの方針で削る。
   * 全部持ち越すと中盤で強さが頭打ちになり、進むほど楽になってしまう。
   */
  private applyCarryOver() {
    const policy = CARRY_POLICY[this.settings.difficulty];
    const p = this.player;
    if (!policy.weapon) p.weapon = "vulcan";
    if (policy.powerDecay > 0) p.power = Math.max(1, p.power - policy.powerDecay);
    if (policy.optionDecay > 0) p.options = p.options.slice(0, Math.max(0, p.options.length - policy.optionDecay));
    if (!policy.keepSpeed) p.speedLevel = 1;
    if (!policy.keepShield) p.shield = 0;
    if (policy.bombs === "one") p.bombs = Math.min(p.bombs, 1);
    else if (policy.bombs === "zero") p.bombs = 0;
    if (policy.healOnStage) p.hp = p.maxHp;
  }

  retryStage() {
    this.player = createPlayer();
    this.player.lives = this.diff.startLives;
    this.score = this.totalRunScore;
    this.loadStage(this.stageIndex);
  }

  /** UI 側のイベント購読を差し替える */
  setCallbacks(callbacks: EngineCallbacks) {
    this.callbacks = callbacks;
  }

  /** 設定変更を反映する（UI から呼ばれる） */
  applySettings(settings: Settings) {
    this.settings = settings;
    this.audio.setVolumes(settings.sfxVolume, settings.bgmVolume);
  }

  /** セーブデータを初期化して新しい進行状況を返す */
  resetProgressData(): Progress {
    this.progress = resetProgress();
    return this.progress;
  }

  private persist() {
    saveProgress(this.progress);
    this.callbacks.onProgress?.(this.progress);
  }

  // ---------------------------------------------------------------- メインループ

  update(dt: number, input: InputState) {
    this.fpsAccum += dt;
    this.fpsFrames += 1;
    if (this.fpsAccum >= 0.4) {
      this.fps = Math.round(this.fpsFrames / this.fpsAccum);
      this.fpsAccum = 0;
      this.fpsFrames = 0;
    }

    this.updateStars(dt);
    this.displayScore += (this.score - this.displayScore) * Math.min(1, dt * 8);
    this.shake = Math.max(0, this.shake - dt * 26);
    this.flash = Math.max(0, this.flash - dt * 3.2);
    this.bombFlash = Math.max(0, this.bombFlash - dt * 1.6);

    switch (this.phase) {
      case "briefing":
        this.updateParticles(dt);
        this.briefingTimer -= dt;
        if (this.briefingTimer <= 0 || input.fire) {
          this.setPhase("playing");
        }
        break;
      case "playing":
        this.updatePlaying(dt, input);
        break;
      case "stageClear":
        this.updateParticles(dt);
        this.updateBullets(dt, 1);
        this.clearTimer += dt;
        break;
      case "gameOver":
        this.updateParticles(dt);
        this.clearTimer += dt;
        break;
      default:
        this.updateParticles(dt);
        break;
    }
  }

  private updatePlaying(dt: number, input: InputState) {
    this.stageTimeMs += dt * 1000;
    const enemyScale = this.powerups.slow > 0 ? 0.5 : 1;

    for (const key of Object.keys(this.powerups) as TimedPowerupKind[]) {
      if (this.powerups[key] > 0) this.powerups[key] = Math.max(0, this.powerups[key] - dt);
    }
    if (this.comboTimer > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) this.combo = 0;
    }

    this.updatePlayer(dt, input);
    this.updateWaves(dt);
    this.updateEnemies(dt * enemyScale, dt);
    this.updateBoss(dt * enemyScale, dt);
    this.updateBullets(dt, enemyScale);
    this.updateItems(dt);
    this.updateHazards(dt);
    this.updateParticles(dt);
    this.collide();
    this.checkStageProgress(dt);

    if (this.score >= this.nextExtend) {
      this.nextExtend += EXTEND_SCORE;
      this.player.lives += 1;
      this.audio.play("extend");
      this.floatText(this.player.x, this.player.y - 30, "1UP!", "#8dff5a");
    }
  }

  // ---------------------------------------------------------------- 自機

  private updatePlayer(dt: number, input: InputState) {
    const p = this.player;
    if (p.respawning > 0) {
      p.respawning -= dt;
      if (p.respawning <= 0) {
        p.dead = false;
        p.hp = p.maxHp;
        p.invincible = RESPAWN_INVINCIBLE;
        this.resetPlayerPosition();
      }
      return;
    }
    if (p.invincible > 0) p.invincible -= dt;

    const speed = PLAYER_BASE_SPEED + p.speedLevel * PLAYER_SPEED_STEP;
    let dx = 0;
    let dy = 0;
    if (input.left) dx -= 1;
    if (input.right) dx += 1;
    if (input.up) dy -= 1;
    if (input.down) dy += 1;

    if (this.settings.control === "mouse" && input.pointer) {
      const tx = input.pointer.x;
      const ty = input.pointer.y;
      p.x += clamp(tx - p.x, -speed * dt * 2.2, speed * dt * 2.2);
      p.y += clamp(ty - p.y, -speed * dt * 2.2, speed * dt * 2.2);
    } else if (dx !== 0 || dy !== 0) {
      const len = Math.hypot(dx, dy) || 1;
      p.x += (dx / len) * speed * dt;
      p.y += (dy / len) * speed * dt;
    }

    // 恒星風ハザードで押し流される
    if (this.stage.hazard === "solarWind") {
      p.x += Math.sin(this.stageTimeMs / 900) * 42 * dt;
    }

    p.x = clamp(p.x, 16, VIEW_W - 16);
    p.y = clamp(p.y, FIELD_TOP + 20, FIELD_BOTTOM - 8);

    p.trail.unshift({ x: p.x, y: p.y });
    if (p.trail.length > TRAIL_LENGTH) p.trail.length = TRAIL_LENGTH;

    // オプションポッドの追従
    this.updateOptions(dt);

    // 射撃
    p.fireCooldown -= dt;
    const wantFire = input.fire || this.settings.autoFire;
    if (wantFire && p.fireCooldown <= 0) {
      this.firePlayerWeapon();
      const spec = WEAPONS[p.weapon];
      p.fireCooldown = spec.interval * (this.powerups.rapid > 0 ? 0.55 : 1) * this.run.fireIntervalMul;
    }

    // 押した瞬間だけ反応させる（押しっぱなしでは連発しない）
    if (input.bomb && !this.bombHeld && p.bombs > 0 && p.invincible < RESPAWN_INVINCIBLE - 0.3) {
      this.useBomb();
    }
    this.bombHeld = input.bomb;
  }

  private updateOptions(dt: number) {
    const p = this.player;
    p.options.forEach((pod, i) => {
      const mode = this.settings.optionFormation;
      if (mode === "trail") {
        const idx = Math.min(p.trail.length - 1, (i + 1) * 14);
        const t = p.trail[idx] ?? { x: p.x, y: p.y + 24 };
        pod.x += (t.x - pod.x) * Math.min(1, dt * 14);
        pod.y += (t.y - pod.y) * Math.min(1, dt * 14);
      } else if (mode === "side") {
        const side = i % 2 === 0 ? -1 : 1;
        const rank = Math.floor(i / 2);
        const tx = p.x + side * (26 + rank * 20);
        const ty = p.y + rank * 16;
        pod.x += (tx - pod.x) * Math.min(1, dt * 12);
        pod.y += (ty - pod.y) * Math.min(1, dt * 12);
      } else {
        pod.angle += dt * 2.2;
        const a = pod.angle + (i / p.options.length) * Math.PI * 2;
        const tx = p.x + Math.cos(a) * 40;
        const ty = p.y + Math.sin(a) * 40;
        pod.x += (tx - pod.x) * Math.min(1, dt * 16);
        pod.y += (ty - pod.y) * Math.min(1, dt * 16);
      }
      pod.fireCooldown -= dt;
    });
  }

  /** 武装・パワーレベルに応じた弾の並びを返す */
  private shotPattern(weapon: WeaponKind, power: number): { ox: number; angle: number }[] {
    const lv = clamp(power, 1, MAX_POWER);
    switch (weapon) {
      case "vulcan": {
        const offsets: number[][] = [[0], [-7, 7], [-9, 0, 9], [-13, -5, 5, 13], [-16, -8, 0, 8, 16]];
        return offsets[lv - 1].map((ox) => ({ ox, angle: ox * 0.004 }));
      }
      case "spread": {
        const ways = 2 + lv;
        const spread = (0.34 + lv * 0.035) * 2;
        return Array.from({ length: ways }, (_, i) => ({
          ox: 0,
          angle: -spread / 2 + (spread / (ways - 1)) * i,
        }));
      }
      case "laser": {
        const beams = Math.ceil(lv / 2) + (lv >= 5 ? 1 : 0);
        return Array.from({ length: beams }, (_, i) => ({
          ox: (i - (beams - 1) / 2) * 11,
          angle: 0,
        }));
      }
      case "missile": {
        return Array.from({ length: Math.min(4, 1 + Math.floor(lv / 1.6)) }, (_, i) => ({
          ox: (i % 2 === 0 ? -1 : 1) * (10 + Math.floor(i / 2) * 8),
          angle: (i % 2 === 0 ? -1 : 1) * 0.4,
        }));
      }
      case "wave":
        return [{ ox: 0, angle: 0 }];
      case "rail":
        return lv >= 4 ? [{ ox: -10, angle: 0 }, { ox: 10, angle: 0 }] : [{ ox: 0, angle: 0 }];
    }
  }

  private firePlayerWeapon() {
    const p = this.player;
    if (p.dead) return;
    const spec = WEAPONS[p.weapon];
    const pattern = this.shotPattern(p.weapon, p.power);
    const dmgScale = (1 + (p.power - 1) * 0.22) * this.run.damageMul;

    for (const s of pattern) {
      this.spawnPlayerBullet(p.x + s.ox, p.y - 16, s.angle, spec, dmgScale, p.weapon, p.power);
    }
    this.shotsFired += pattern.length;

    // オプションポッドも同時発射（威力は 60%）
    for (const pod of p.options) {
      if (pod.fireCooldown > 0) continue;
      pod.fireCooldown = spec.interval * (this.powerups.rapid > 0 ? 0.55 : 1) * this.run.fireIntervalMul;
      const podPattern = p.weapon === "spread" ? pattern.filter((_, i) => i % 2 === 0) : [pattern[0]];
      for (const s of podPattern) {
        this.spawnPlayerBullet(pod.x + s.ox * 0.5, pod.y - 10, s.angle, spec, dmgScale * 0.6, p.weapon, p.power);
      }
    }
    this.audio.play(spec.sfx, 1, 40);
  }

  private spawnPlayerBullet(
    x: number,
    y: number,
    angle: number,
    spec: WeaponSpec,
    dmgScale: number,
    weapon: WeaponKind,
    power: number,
  ) {
    const pierce =
      (this.powerups.pierce > 0 ? Math.max(3, spec.pierce) : spec.pierce) + this.run.pierceBonus;
    this.bullets.push({
      x,
      y,
      vx: Math.sin(angle) * spec.speed,
      vy: -Math.cos(angle) * spec.speed,
      w: weapon === "wave" ? spec.w + power * 6 : spec.w,
      h: spec.h,
      dmg: spec.dmg * dmgScale,
      from: "player",
      kind: weapon,
      life: 3,
      pierce,
      homing: spec.homing,
      color: spec.color,
      angle,
      hitIds: pierce > 0 ? new Set<number>() : undefined,
    });
  }

  private useBomb() {
    const p = this.player;
    p.bombs -= 1;
    this.bombFlash = 1;
    this.shake = 22;
    this.audio.play("bomb");
    // 敵弾を全消去してスコアに変換
    let cleared = 0;
    this.bullets = this.bullets.filter((b) => {
      if (b.from === "enemy") {
        cleared++;
        this.spawnParticles(b.x, b.y, 2, "#ffe86b", "spark");
        return false;
      }
      return true;
    });
    this.addScore(cleared * 20, p.x, p.y);
    // 全敵に大ダメージ
    for (const e of [...this.enemies]) {
      this.damageEnemy(e, 14 + this.player.power * 3, true);
    }
    if (this.boss) this.damageBoss(this.boss, 60, null);
    for (const h of this.hazards) if (h.kind !== "beam") h.hp = 0;
    p.invincible = Math.max(p.invincible, 1.4);
  }

  private hitPlayer(damage = 1) {
    const p = this.player;
    if (p.dead || p.invincible > 0 || p.respawning > 0) return;
    this.tookDamage = true;
    if (p.shield > 0) {
      p.shield -= 1;
      p.invincible = 0.7;
      this.audio.play("hit", 0.7);
      this.spawnParticles(p.x, p.y, 10, "#7ec8ff", "ring");
      this.shake = 8;
      return;
    }
    p.hp -= damage;
    this.audio.play("damage");
    this.shake = 16;
    this.flash = 0.5;
    this.flashColor = "#ff4d6d";
    this.spawnParticles(p.x, p.y, 14, "#ff7a3c", "spark");
    if (p.hp <= 0) this.loseLife();
    else p.invincible = 1.2;
  }

  private loseLife() {
    const p = this.player;
    p.lives -= 1;
    p.dead = true;
    p.respawning = 1.6;
    p.shield = 0;
    p.power = Math.max(1, p.power - 1);
    if (p.options.length > 0) p.options.pop();
    this.combo = 0;
    this.audio.play("bigExplode");
    this.spawnParticles(p.x, p.y, 40, "#ffb45c", "spark");
    this.spawnParticles(p.x, p.y, 8, "#ffffff", "ring");
    this.shake = 26;
    if (p.lives < 0) this.gameOver();
  }

  /** ローグライトの記録を保存する */
  private recordRun() {
    if (!this.run.active) return;
    const best = this.progress.bestDepth ?? 0;
    if (this.run.depth > best) this.progress.bestDepth = this.run.depth;
    const bestScore = this.progress.bestRogueScore ?? 0;
    if (this.score > bestScore) this.progress.bestRogueScore = this.score;
    this.persist();
  }

  private gameOver() {
    this.audio.stopBgm();
    this.audio.play("gameOver");
    this.clearTimer = 0;
    this.progress.bestTotalScore = Math.max(this.progress.bestTotalScore, this.score);
    this.progress.bestCombo = Math.max(this.progress.bestCombo, this.maxCombo);
    this.persist();
    this.recordRun();
    this.setPhase("gameOver");
  }

  // ---------------------------------------------------------------- 敵編隊

  private updateWaves(dt: number) {
    if (!this.waveSpawned) {
      const wave = this.stage.waves[this.waveIndex];
      if (wave) {
        this.spawnWave(this.waveIndex);
        this.waveSpawned = true;
      }
    }
    void dt;
  }

  private spawnWave(index: number) {
    const wave = this.stage.waves[index];
    if (!wave) return;
    const slots = generateSlots(wave.formation, wave.rows, wave.cols, Math.random);
    const diff = this.diff;
    this.formOffsetX = 0;
    this.formDrop = 0;
    this.formDir = 1;
    this.formSpeed = 24 * wave.speed * diff.enemySpeed * (1 + this.stageIndex * 0.02);

    slots.forEach((slot, i) => {
      const typeId = wave.types[slot.row % wave.types.length] ?? wave.types[0];
      const def = ENEMY_DEFS[typeId];
      const start = entryStart(wave.entry, slot, i);
      const hp = Math.max(1, Math.round(def.hp * diff.enemyHp * (1 + this.stageIndex * 0.05)));
      this.enemies.push({
        id: this.idCounter++,
        type: typeId,
        x: start.x,
        y: start.y,
        w: def.w,
        h: def.h,
        hp,
        maxHp: hp,
        score: def.score,
        slotX: slot.sx,
        slotY: slot.sy,
        mode: "entry",
        t: Math.random() * 10,
        entryDelay: i * 0.045,
        entryPath: [],
        vx: 0,
        vy: 0,
        fireCooldown:
          def.fireInterval > 0
            ? rand(1, 3) + def.fireInterval / (wave.fireRate * diff.enemyFire)
            : Infinity,
        diveCooldown: rand(3, 9) / Math.max(0.15, def.diveRate * wave.diveRate),
        flags: { frozen: 0, slowed: 0, hitFlash: 0, shieldedBy: null },
        color: def.color,
        accent: def.accent,
        generation: 0,
      });
    });
  }

  private formationOriginY() {
    return FIELD_TOP + 34 + this.formDrop;
  }

  private updateEnemies(edt: number, dt: number) {
    const frozen = this.powerups.freeze > 0;
    const wave = this.stage.waves[this.waveIndex];
    const fireRateMul = (wave?.fireRate ?? 1) * this.diff.enemyFire;
    const alive = this.enemies.filter((e) => e.mode !== "entry").length;
    const speedBoost = 1 + Math.max(0, (26 - alive) / 26) * 1.6;

    // 編隊全体の左右移動
    if (!frozen && this.enemies.some((e) => e.mode === "formation")) {
      this.formOffsetX += this.formDir * this.formSpeed * speedBoost * edt;
      let minX = Infinity;
      let maxX = -Infinity;
      for (const e of this.enemies) {
        if (e.mode !== "formation") continue;
        minX = Math.min(minX, VIEW_W / 2 + e.slotX + this.formOffsetX - e.w / 2);
        maxX = Math.max(maxX, VIEW_W / 2 + e.slotX + this.formOffsetX + e.w / 2);
      }
      if (minX < 14 && this.formDir < 0) {
        this.formDir = 1;
        this.formDrop += 11;
      } else if (maxX > VIEW_W - 14 && this.formDir > 0) {
        this.formDir = -1;
        this.formDrop += 11;
      }
    }

    for (const e of this.enemies) {
      e.t += edt;
      if (e.flags.hitFlash > 0) e.flags.hitFlash -= dt;
      if (frozen) continue;

      const def = ENEMY_DEFS[e.type];
      switch (e.mode) {
        case "entry": {
          e.entryDelay -= edt;
          if (e.entryDelay > 0) break;
          const tx = VIEW_W / 2 + e.slotX + this.formOffsetX;
          const ty = this.formationOriginY() + e.slotY;
          e.x += (tx - e.x) * Math.min(1, edt * 3.4);
          e.y += (ty - e.y) * Math.min(1, edt * 3.4);
          if (Math.hypot(tx - e.x, ty - e.y) < 6) e.mode = "formation";
          break;
        }
        case "formation": {
          e.x = VIEW_W / 2 + e.slotX + this.formOffsetX;
          e.y = this.formationOriginY() + e.slotY + Math.sin(e.t * 2 + e.slotX * 0.05) * 3;
          if (def.diveRate > 0) {
            e.diveCooldown -= edt;
            if (e.diveCooldown <= 0) {
              e.mode = "dive";
              e.t = 0;
              e.vx = (this.player.x - e.x) * 0.55;
              e.vy = 90 + rand(20, 70);
            }
          }
          break;
        }
        case "dive": {
          const chase = def.suicide ? 1.9 : 0.7;
          e.vx += (this.player.x - e.x) * chase * edt;
          e.vx = clamp(e.vx, -220, 220);
          e.vy = Math.min(e.vy + 150 * edt, def.suicide ? 380 : 260);
          e.x += (e.vx + Math.sin(e.t * 6) * 40) * edt;
          e.y += e.vy * edt;
          if (e.y > FIELD_BOTTOM + 30) {
            if (def.suicide) {
              this.killEnemy(e, false);
            } else {
              e.y = -30;
              e.mode = "return";
            }
          }
          break;
        }
        case "return": {
          const tx = VIEW_W / 2 + e.slotX + this.formOffsetX;
          const ty = this.formationOriginY() + e.slotY;
          e.x += (tx - e.x) * Math.min(1, edt * 2.6);
          e.y += (ty - e.y) * Math.min(1, edt * 2.6);
          if (Math.hypot(tx - e.x, ty - e.y) < 8) {
            e.mode = "formation";
            e.diveCooldown = rand(4, 11) / Math.max(0.15, def.diveRate);
          }
          break;
        }
        case "free": {
          e.x += e.vx * edt;
          e.y += e.vy * edt;
          if (e.y > FIELD_BOTTOM + 40 || e.x < -50 || e.x > VIEW_W + 50) e.hp = 0;
          break;
        }
      }

      // 回復役の処理
      if (def.heals) {
        e.fireCooldown -= edt;
        if (e.fireCooldown <= 0) {
          e.fireCooldown = 2.4;
          for (const other of this.enemies) {
            if (other === e || other.hp >= other.maxHp) continue;
            if (Math.hypot(other.x - e.x, other.y - e.y) < 90) {
              other.hp = Math.min(other.maxHp, other.hp + 1);
              this.spawnParticles(other.x, other.y, 3, "#ffe86b", "ring");
            }
          }
        }
      } else if (def.fireInterval > 0 && e.mode !== "entry") {
        e.fireCooldown -= edt;
        if (e.fireCooldown <= 0) {
          e.fireCooldown = (def.fireInterval / Math.max(0.2, fireRateMul)) * rand(0.7, 1.5);
          this.enemyShoot(e, def.shot);
        }
      }
    }

    this.enemies = this.enemies.filter((e) => {
      if (e.hp > 0) return true;
      return false;
    });
  }

  private enemyShoot(e: Enemy, shot: string) {
    const speed = 170 * this.diff.bulletSpeed;
    const base = { from: "enemy" as const, life: 6, pierce: 0, homing: 0, angle: 0 };
    const push = (vx: number, vy: number, kind: Bullet["kind"], w = 6, h = 10, dmg = 1, color = "#ff6b6b") => {
      this.bullets.push({ ...base, x: e.x, y: e.y + e.h / 2, vx, vy, w, h, dmg, kind, color });
    };
    switch (shot) {
      case "single":
        push(0, speed, "enemyShot");
        break;
      case "double":
        push(-40, speed, "enemyShot");
        push(40, speed, "enemyShot");
        break;
      case "aimed": {
        const a = Math.atan2(this.player.y - e.y, this.player.x - e.x);
        push(Math.cos(a) * speed * 1.25, Math.sin(a) * speed * 1.25, "enemyShot", 6, 12, 1, "#ffd166");
        break;
      }
      case "bomb":
        push(rand(-30, 30), speed * 0.8, "enemyBomb", 12, 12, 1, "#c58dff");
        break;
      case "spray": {
        for (let i = -2; i <= 2; i++) {
          const a = Math.PI / 2 + i * 0.26;
          push(Math.cos(a) * speed, Math.sin(a) * speed, "enemyShot", 5, 9, 1, "#ffb45c");
        }
        break;
      }
      case "laser": {
        const a = Math.atan2(this.player.y - e.y, this.player.x - e.x);
        push(Math.cos(a) * speed * 2.3, Math.sin(a) * speed * 2.3, "enemyLaser", 4, 22, 1, "#ff5d8f");
        break;
      }
    }
    this.audio.play("shot", 0.6, 90);
  }

  private damageEnemy(e: Enemy, dmg: number, silent = false) {
    e.hp -= dmg;
    e.flags.hitFlash = 0.08;
    if (!silent) this.audio.play("hit", rand(0.9, 1.1), 30);
    if (e.hp <= 0) this.killEnemy(e, true);
  }

  private killEnemy(e: Enemy, scored: boolean) {
    e.hp = 0;
    const def = ENEMY_DEFS[e.type];
    this.spawnParticles(e.x, e.y, def.w > 30 ? 20 : 12, def.color, "spark");
    this.audio.play("explode", rand(0.85, 1.2), 25);
    if (scored) {
      this.combo += 1;
      this.comboTimer = COMBO_TIMEOUT;
      this.maxCombo = Math.max(this.maxCombo, this.combo);
      const mult = (1 + Math.floor(this.combo / 8) * 0.1) * (this.powerups.score2x > 0 ? 2 : 1);
      this.addScore(Math.round(e.score * mult * this.diff.scoreMul), e.x, e.y);
      this.maybeDropItem(e.x, e.y);
    }
    if (def.splits && e.generation < 1) {
      for (let i = 0; i < 2; i++) {
        const childDef = ENEMY_DEFS[def.splits];
        this.enemies.push({
          id: this.idCounter++,
          type: def.splits,
          x: e.x + (i === 0 ? -14 : 14),
          y: e.y,
          w: childDef.w * 0.8,
          h: childDef.h * 0.8,
          hp: Math.max(1, Math.round(childDef.hp * this.diff.enemyHp)),
          maxHp: Math.max(1, Math.round(childDef.hp * this.diff.enemyHp)),
          score: Math.round(childDef.score * 0.6),
          slotX: e.slotX + (i === 0 ? -18 : 18),
          slotY: e.slotY,
          mode: "free",
          t: 0,
          entryDelay: 0,
          entryPath: [],
          vx: i === 0 ? -70 : 70,
          vy: 80,
          fireCooldown: rand(1, 2),
          diveCooldown: 999,
          flags: { frozen: 0, slowed: 0, hitFlash: 0, shieldedBy: null },
          color: childDef.color,
          accent: childDef.accent,
          generation: e.generation + 1,
        });
      }
    }
  }

  private maybeDropItem(x: number, y: number) {
    const chance = this.stage.itemChance * this.diff.itemChance * this.run.itemChanceMul;
    if (Math.random() > chance) return;
    const total = ITEM_POOL.reduce((s, i) => s + i.weight, 0);
    let roll = Math.random() * total;
    let kind: ItemKind = "power";
    for (const entry of ITEM_POOL) {
      roll -= entry.weight;
      if (roll <= 0) {
        kind = entry.kind;
        break;
      }
    }
    this.items.push({
      id: this.idCounter++,
      kind,
      x,
      y,
      vx: rand(-20, 20),
      vy: 62,
      life: 12,
      magnet: false,
    });
  }

  // ---------------------------------------------------------------- ボス

  private spawnBoss() {
    const bossId = this.stage.boss;
    if (!bossId) return;
    const def = BOSS_DEFS[bossId];
    const hp = Math.round(def.hp * this.diff.enemyHp);
    this.boss = {
      id: bossId,
      name: def.name,
      x: VIEW_W / 2,
      y: -def.h,
      w: def.w,
      h: def.h,
      hp,
      maxHp: hp,
      phase: 0,
      phaseCount: def.phases,
      t: 0,
      vx: 52 * this.diff.enemySpeed,
      vy: 0,
      parts: def.parts.map((p, i) => ({
        id: this.idCounter++ + i,
        name: p.name,
        offsetX: p.ox,
        offsetY: p.oy,
        r: p.r,
        hp: Math.round(p.hp * this.diff.enemyHp),
        maxHp: Math.round(p.hp * this.diff.enemyHp),
        destroyed: false,
        fireCooldown: rand(1, 3),
      })),
      attackTimer: 2,
      attackIndex: 0,
      hitFlash: 0,
      entering: true,
      dying: 0,
      color: def.color,
      accent: def.accent,
    };
    this.audio.play("warning");
  }

  private updateBoss(edt: number, dt: number) {
    const b = this.boss;
    if (!b) return;
    b.t += edt;
    if (b.hitFlash > 0) b.hitFlash -= dt;

    if (b.dying > 0) {
      b.dying -= dt;
      b.y += 12 * dt;
      if (Math.random() < 0.5) {
        this.spawnParticles(
          b.x + rand(-b.w / 2, b.w / 2),
          b.y + rand(-b.h / 2, b.h / 2),
          4,
          pick(["#ffd93d", "#ff7a3c", "#ffffff"]),
          "spark",
        );
      }
      this.shake = Math.max(this.shake, 10);
      if (b.dying <= 0) {
        this.audio.play("bigExplode");
        this.spawnParticles(b.x, b.y, 70, "#ffe86b", "spark");
        this.spawnParticles(b.x, b.y, 12, "#ffffff", "ring");
        this.addScore(BOSS_DEFS[b.id].score * this.diff.scoreMul, b.x, b.y);
        this.shake = 34;
        this.flash = 0.9;
        this.flashColor = "#ffffff";
        this.boss = null;
      }
      return;
    }

    if (b.entering) {
      b.y += 70 * dt;
      if (b.y >= FIELD_TOP + b.h / 2 + 20) {
        b.y = FIELD_TOP + b.h / 2 + 20;
        b.entering = false;
      }
      return;
    }

    const ratio = b.hp / b.maxHp;
    const nextPhase = Math.min(b.phaseCount - 1, Math.floor((1 - ratio) * b.phaseCount));
    if (nextPhase !== b.phase) {
      b.phase = nextPhase;
      this.audio.play("warning");
      this.flash = 0.5;
      this.flashColor = b.accent;
      this.spawnParticles(b.x, b.y, 30, b.accent, "ring");
    }

    // 移動：フェーズが進むほど激しく
    const aggro = 1 + b.phase * 0.35;
    b.x += b.vx * aggro * edt;
    if (b.x < b.w / 2 + 10) {
      b.x = b.w / 2 + 10;
      b.vx = Math.abs(b.vx);
    }
    if (b.x > VIEW_W - b.w / 2 - 10) {
      b.x = VIEW_W - b.w / 2 - 10;
      b.vx = -Math.abs(b.vx);
    }
    b.y = FIELD_TOP + b.h / 2 + 20 + Math.sin(b.t * 0.9) * 16;

    b.attackTimer -= edt;
    if (b.attackTimer <= 0) {
      const patterns = BOSS_DEFS[b.id].patterns[b.phase] ?? BOSS_DEFS[b.id].patterns[0];
      const attack = patterns[b.attackIndex % patterns.length];
      b.attackIndex++;
      this.bossAttack(b, attack);
      b.attackTimer = (1.9 - b.phase * 0.18) / this.diff.enemyFire;
    }
  }

  private bossAttack(b: Boss, attack: BossAttack) {
    const speed = 165 * this.diff.bulletSpeed;
    const shoot = (x: number, y: number, angle: number, spd: number, color: string, w = 8, h = 8) => {
      this.bullets.push({
        x,
        y,
        vx: Math.cos(angle) * spd,
        vy: Math.sin(angle) * spd,
        w,
        h,
        dmg: 1,
        from: "enemy",
        kind: "enemyShot",
        life: 8,
        pierce: 0,
        homing: 0,
        color,
        angle,
      });
    };
    const toPlayer = Math.atan2(this.player.y - b.y, this.player.x - b.x);

    switch (attack) {
      case "fan": {
        const n = 7 + b.phase * 2;
        for (let i = 0; i < n; i++) {
          const a = Math.PI / 2 + (i - (n - 1) / 2) * 0.19;
          shoot(b.x, b.y + 20, a, speed, b.accent);
        }
        break;
      }
      case "aimedBurst": {
        for (let i = 0; i < 3; i++) {
          const a = toPlayer + rand(-0.12, 0.12);
          shoot(b.x + rand(-30, 30), b.y + 16, a, speed * 1.3, "#ffd166", 6, 12);
        }
        break;
      }
      case "spiral": {
        const arms = 3 + b.phase;
        for (let i = 0; i < arms; i++) {
          const a = b.t * 2.4 + (i / arms) * Math.PI * 2;
          shoot(b.x, b.y, a, speed * 0.85, b.color);
        }
        break;
      }
      case "wall": {
        const gap = randInt(1, 8);
        for (let i = 0; i < 10; i++) {
          if (i === gap || i === gap + 1) continue;
          shoot(28 + i * 48, b.y, Math.PI / 2, speed * 0.75, "#ff8ad6", 10, 10);
        }
        break;
      }
      case "laserSweep": {
        for (let i = 0; i < 14; i++) {
          const a = Math.PI / 2 + Math.sin(b.t * 1.4) * 0.8 + i * 0.03;
          shoot(b.x, b.y + 10, a, speed * 1.8, "#ff5d8f", 4, 20);
        }
        break;
      }
      case "ring": {
        const n = 16 + b.phase * 4;
        for (let i = 0; i < n; i++) {
          shoot(b.x, b.y, (i / n) * Math.PI * 2, speed * 0.8, b.accent);
        }
        break;
      }
      case "cross": {
        for (let i = 0; i < 4; i++) {
          const base = b.t * 1.2 + (i / 4) * Math.PI * 2;
          for (let j = 0; j < 5; j++) {
            shoot(b.x, b.y, base + j * 0.06 - 0.12, speed, "#6fe8ff");
          }
        }
        break;
      }
      case "rain": {
        for (let i = 0; i < 6; i++) {
          this.bullets.push({
            x: rand(20, VIEW_W - 20),
            y: FIELD_TOP,
            vx: rand(-20, 20),
            vy: speed * rand(0.6, 1.0),
            w: 8,
            h: 8,
            dmg: 1,
            from: "enemy",
            kind: "enemyBomb",
            life: 8,
            pierce: 0,
            homing: 0,
            color: "#c58dff",
            angle: 0,
          });
        }
        break;
      }
      case "homingOrbs": {
        for (let i = 0; i < 3; i++) {
          this.bullets.push({
            x: b.x + (i - 1) * 40,
            y: b.y + 20,
            vx: 0,
            vy: speed * 0.5,
            w: 12,
            h: 12,
            dmg: 1,
            from: "enemy",
            kind: "enemyShot",
            life: 10,
            pierce: 0,
            homing: 1.6,
            color: "#8dff5a",
            angle: 0,
          });
        }
        break;
      }
      case "minions": {
        const types: EnemyTypeId[] = ["scout", "glider", "kamikaze", "gunner"];
        for (let i = 0; i < 3; i++) {
          const t = pick(types);
          const def = ENEMY_DEFS[t];
          const hp = Math.max(1, Math.round(def.hp * this.diff.enemyHp));
          this.enemies.push({
            id: this.idCounter++,
            type: t,
            x: b.x + rand(-60, 60),
            y: b.y + 20,
            w: def.w,
            h: def.h,
            hp,
            maxHp: hp,
            score: def.score,
            slotX: 0,
            slotY: 0,
            mode: "free",
            t: 0,
            entryDelay: 0,
            entryPath: [],
            vx: rand(-50, 50),
            vy: rand(60, 110),
            fireCooldown: rand(1, 2.4),
            diveCooldown: 999,
            flags: { frozen: 0, slowed: 0, hitFlash: 0, shieldedBy: null },
            color: def.color,
            accent: def.accent,
            generation: 1,
          });
        }
        break;
      }
    }
    this.audio.play("shot", 0.5, 60);
  }

  private damageBoss(b: Boss, dmg: number, partIndex: number | null) {
    if (b.dying > 0 || b.entering) return;
    if (partIndex !== null) {
      const part = b.parts[partIndex];
      if (part && !part.destroyed) {
        part.hp -= dmg;
        this.audio.play("hit", 1.2, 30);
        if (part.hp <= 0) {
          part.destroyed = true;
          this.audio.play("explode");
          this.spawnParticles(b.x + part.offsetX, b.y + part.offsetY, 26, b.accent, "spark");
          this.addScore(1200 * this.diff.scoreMul, b.x + part.offsetX, b.y + part.offsetY);
          this.shake = 14;
        }
        return;
      }
    }
    const alivePartCount = b.parts.filter((p) => !p.destroyed).length;
    const reduction = alivePartCount > 0 ? 0.45 : 1;
    b.hp -= dmg * reduction;
    b.hitFlash = 0.07;
    this.audio.play("hit", 0.9, 30);
    if (b.hp <= 0) {
      b.hp = 0;
      b.dying = 1.8;
      this.audio.play("bigExplode");
    }
  }

  // ---------------------------------------------------------------- 弾・アイテム・演出

  private updateBullets(dt: number, enemyScale: number) {
    const out: Bullet[] = [];
    for (const b of this.bullets) {
      const scale = b.from === "enemy" ? enemyScale : 1;
      b.life -= dt;
      if (b.homing > 0) {
        const target = b.from === "player" ? this.nearestEnemy(b.x, b.y) : this.player;
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
          b.angle = na + Math.PI / 2;
        }
      }
      b.x += b.vx * dt * scale;
      b.y += b.vy * dt * scale;

      if (b.from === "player" && b.kind === "missile" && Math.random() < 0.5) {
        this.spawnParticles(b.x, b.y + 6, 1, "#ff9d5c", "smoke");
      }
      if (b.life > 0 && b.y > -40 && b.y < VIEW_H + 40 && b.x > -40 && b.x < VIEW_W + 40) {
        out.push(b);
      }
    }
    this.bullets = out;
  }

  private nearestEnemy(x: number, y: number): { x: number; y: number } | null {
    let best: { x: number; y: number } | null = null;
    let bestD = Infinity;
    for (const e of this.enemies) {
      const d = Math.hypot(e.x - x, e.y - y);
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    if (this.boss && !this.boss.entering && this.boss.dying <= 0) {
      const d = Math.hypot(this.boss.x - x, this.boss.y - y);
      if (d < bestD) best = this.boss;
    }
    return best;
  }

  private updateItems(dt: number) {
    const p = this.player;
    const magnet = this.powerups.magnet > 0;
    const out: Item[] = [];
    for (const item of this.items) {
      item.life -= dt;
      const dist = Math.hypot(p.x - item.x, p.y - item.y);
      if (magnet || dist < 60) {
        const a = Math.atan2(p.y - item.y, p.x - item.x);
        const pull = magnet ? 320 : 120;
        item.x += Math.cos(a) * pull * dt;
        item.y += Math.sin(a) * pull * dt;
      } else {
        item.x += item.vx * dt;
        item.y += item.vy * dt;
        if (item.x < 12 || item.x > VIEW_W - 12) item.vx *= -1;
      }
      if (dist < 20 && !p.dead) {
        this.collectItem(item);
        continue;
      }
      if (item.life > 0 && item.y < VIEW_H + 20) out.push(item);
    }
    this.items = out;
  }

  private collectItem(item: Item) {
    const p = this.player;
    const label = ITEM_LABEL[item.kind];
    this.audio.play(item.kind === "power" || item.kind === "option" ? "powerup" : "item");
    this.spawnParticles(item.x, item.y, 8, label.color, "ring");
    this.floatText(item.x, item.y - 10, label.name, label.color);
    this.addScore(150, item.x, item.y);

    switch (item.kind) {
      case "power":
        if (p.power < MAX_POWER) p.power += 1;
        else this.addScore(1000, item.x, item.y);
        break;
      case "option":
        if (p.options.length < MAX_OPTIONS) {
          p.options.push({ x: p.x, y: p.y + 30, angle: 0, fireCooldown: 0 });
        } else this.addScore(1500, item.x, item.y);
        break;
      case "shield":
        p.shield = p.maxShield;
        break;
      case "speed":
        p.speedLevel = Math.min(MAX_SPEED_LEVEL, p.speedLevel + 1);
        break;
      case "bomb":
        p.bombs = Math.min(MAX_BOMBS, p.bombs + 1);
        break;
      case "life":
        p.lives += 1;
        break;
      case "heal":
        p.hp = Math.min(p.maxHp, p.hp + 1);
        break;
      case "spread":
      case "laser":
      case "missile":
      case "wave":
      case "rail":
        if (p.weapon === item.kind) p.power = Math.min(MAX_POWER, p.power + 1);
        p.weapon = item.kind;
        break;
      case "rapid":
      case "score2x":
      case "slow":
      case "magnet":
      case "freeze":
      case "pierce":
        this.powerups[item.kind] = POWERUP_DURATION[item.kind];
        break;
    }
  }

  private updateHazards(dt: number) {
    const hazard = this.stage.hazard;
    if (hazard !== "none") {
      this.hazardTimer -= dt;
      if (this.hazardTimer <= 0) {
        switch (hazard) {
          case "meteor":
            this.hazardTimer = rand(1.1, 2.4);
            this.hazards.push({
              kind: "meteor",
              x: rand(30, VIEW_W - 30),
              y: -30,
              vx: rand(-30, 30),
              vy: rand(120, 190),
              r: rand(12, 22),
              hp: 6,
              t: 0,
              life: 12,
              angle: 0,
              spin: rand(-2, 2),
            });
            break;
          case "debris":
            this.hazardTimer = rand(0.8, 1.8);
            this.hazards.push({
              kind: "debris",
              x: Math.random() < 0.5 ? -20 : VIEW_W + 20,
              y: rand(FIELD_TOP, FIELD_BOTTOM - 120),
              vx: rand(40, 90) * (Math.random() < 0.5 ? 1 : -1),
              vy: rand(10, 40),
              r: rand(8, 14),
              hp: 3,
              t: 0,
              life: 14,
              angle: 0,
              spin: rand(-3, 3),
            });
            break;
          case "laserGrid":
            this.hazardTimer = rand(3.4, 5.2);
            this.hazards.push({
              kind: "beamWarn",
              x: 0,
              y: rand(FIELD_TOP + 90, FIELD_BOTTOM - 60),
              vx: 0,
              vy: 0,
              r: 0,
              hp: 1,
              t: 0,
              life: 1.1,
              angle: 0,
              spin: 0,
            });
            this.audio.play("warning", 1.4);
            break;
          case "solarWind":
          case "nebula":
            this.hazardTimer = 999;
            break;
        }
      }
    }

    const out: Hazard[] = [];
    for (const h of this.hazards) {
      h.t += dt;
      h.life -= dt;
      h.angle += h.spin * dt;
      if (h.kind === "meteor" || h.kind === "debris") {
        h.x += h.vx * dt;
        h.y += h.vy * dt;
        if (Math.hypot(h.x - this.player.x, h.y - this.player.y) < h.r + 8) {
          this.hitPlayer(1);
          h.hp = 0;
        }
      } else if (h.kind === "beamWarn" && h.life <= 0) {
        out.push({ ...h, kind: "beam", life: 0.9, t: 0 });
        this.audio.play("laser");
        continue;
      } else if (h.kind === "beam") {
        if (h.t > 0.25 && Math.abs(this.player.y - h.y) < 12) this.hitPlayer(1);
      }
      if (h.hp > 0 && h.life > 0 && h.y < VIEW_H + 40) out.push(h);
      else if (h.hp <= 0) this.spawnParticles(h.x, h.y, 10, "#a8a29e", "spark");
    }
    this.hazards = out;
  }

  private updateStars(dt: number) {
    for (const s of this.stars) {
      s.y += (18 + s.z * 90) * dt;
      if (s.y > VIEW_H) {
        s.y = -4;
        s.x = Math.random() * VIEW_W;
      }
    }
  }

  private updateParticles(dt: number) {
    const out: Particle[] = [];
    for (const p of this.particles) {
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 1 - p.drag * dt;
      p.vy *= 1 - p.drag * dt;
      if (p.kind === "smoke") p.vy -= 20 * dt;
      if (p.life > 0) out.push(p);
    }
    this.particles = out;
  }

  spawnParticles(x: number, y: number, count: number, color: string, kind: Particle["kind"]) {
    const scale = this.settings.particles === "low" ? 0.4 : this.settings.particles === "high" ? 1.6 : 1;
    const n = Math.max(1, Math.round(count * scale));
    if (this.particles.length > 900) return;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = kind === "ring" ? rand(40, 110) : rand(40, 220);
      const life = kind === "smoke" ? rand(0.4, 0.9) : rand(0.25, 0.7);
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life,
        maxLife: life,
        size: kind === "smoke" ? rand(2, 5) : rand(1.4, 3.4),
        color,
        kind,
        drag: kind === "ring" ? 3 : 1.6,
      });
    }
  }

  private floatText(x: number, y: number, text: string, color: string) {
    this.particles.push({
      x,
      y,
      vx: 0,
      vy: -34,
      life: 1.1,
      maxLife: 1.1,
      size: 11,
      color,
      kind: "text",
      text,
      drag: 1.2,
    });
  }

  private addScore(amount: number, x?: number, y?: number) {
    const value = Math.round(amount);
    this.score += value;
    if (x !== undefined && y !== undefined && value >= 500) {
      this.floatText(x, y, `+${value}`, "#ffe86b");
    }
  }

  // ---------------------------------------------------------------- 当たり判定

  private collide() {
    const p = this.player;

    // 自機弾 → 敵
    for (const b of this.bullets) {
      if (b.from !== "player") continue;
      for (const e of this.enemies) {
        if (e.hp <= 0) continue;
        if (b.hitIds?.has(e.id)) continue;
        if (Math.abs(b.x - e.x) > (b.w + e.w) / 2 || Math.abs(b.y - e.y) > (b.h + e.h) / 2) continue;
        this.shotsHit += 1;
        this.damageEnemy(e, b.dmg);
        this.spawnParticles(b.x, b.y, 3, b.color, "spark");
        if (b.pierce > 0) {
          b.hitIds?.add(e.id);
          if (b.hitIds && b.pierce < 90 && b.hitIds.size >= b.pierce + 1) b.life = 0;
        } else {
          b.life = 0;
          break;
        }
      }
      if (b.life <= 0) continue;

      // ハザードにも当たる
      for (const h of this.hazards) {
        if (h.kind === "beam" || h.kind === "beamWarn") continue;
        if (Math.hypot(b.x - h.x, b.y - h.y) > h.r) continue;
        h.hp -= b.dmg;
        this.spawnParticles(b.x, b.y, 3, "#d6d3d1", "spark");
        if (h.hp <= 0) this.addScore(60, h.x, h.y);
        if (b.pierce <= 0) b.life = 0;
        break;
      }

      // ボス
      const boss = this.boss;
      if (boss && !boss.entering && boss.dying <= 0 && b.life > 0) {
        let hitPart: number | null = null;
        for (let i = 0; i < boss.parts.length; i++) {
          const part = boss.parts[i];
          if (part.destroyed) continue;
          if (Math.hypot(b.x - (boss.x + part.offsetX), b.y - (boss.y + part.offsetY)) < part.r) {
            hitPart = i;
            break;
          }
        }
        const inBody =
          Math.abs(b.x - boss.x) < boss.w / 2 && Math.abs(b.y - boss.y) < boss.h / 2;
        if (hitPart !== null || inBody) {
          this.shotsHit += 1;
          this.damageBoss(boss, b.dmg, hitPart);
          this.spawnParticles(b.x, b.y, 3, b.color, "spark");
          if (b.pierce > 0 && b.hitIds) {
            const key = hitPart !== null ? boss.parts[hitPart].id : -1;
            if (!b.hitIds.has(key)) b.hitIds.add(key);
          } else {
            b.life = 0;
          }
        }
      }
    }

    // 敵弾 → 自機（判定は小さめで理不尽さを回避）
    if (!p.dead && p.invincible <= 0 && p.respawning <= 0) {
      for (const b of this.bullets) {
        if (b.from !== "enemy") continue;
        if (Math.abs(b.x - p.x) > (b.w + 10) / 2 || Math.abs(b.y - p.y) > (b.h + 10) / 2) continue;
        b.life = 0;
        this.hitPlayer(1);
        break;
      }
    }

    // 敵の体当たり
    if (!p.dead && p.invincible <= 0 && p.respawning <= 0) {
      for (const e of this.enemies) {
        if (Math.abs(e.x - p.x) > (e.w + 12) / 2 || Math.abs(e.y - p.y) > (e.h + 12) / 2) continue;
        const def = ENEMY_DEFS[e.type];
        this.hitPlayer(def.suicide ? 2 : 1);
        this.killEnemy(e, true);
        break;
      }
      const boss = this.boss;
      if (boss && !boss.entering && boss.dying <= 0) {
        if (Math.abs(boss.x - p.x) < boss.w / 2 && Math.abs(boss.y - p.y) < boss.h / 2) {
          this.hitPlayer(1);
        }
      }
    }

    // 編隊がプレイヤーラインまで降下したら被弾
    for (const e of this.enemies) {
      if (e.mode === "formation" && e.y > FIELD_BOTTOM - 40) {
        this.hitPlayer(1);
        this.formDrop = Math.max(0, this.formDrop - 120);
        this.shake = 20;
        break;
      }
    }
  }

  // ---------------------------------------------------------------- 進行管理

  private checkStageProgress(dt: number) {
    if (this.phase !== "playing") return;
    const cleared = this.enemies.length === 0;

    if (this.boss) {
      this.warningTimer = Math.max(0, this.warningTimer - dt);
      return;
    }

    if (!cleared) return;

    this.waveDoneTimer += dt;
    if (this.waveDoneTimer < 0.8) return;
    this.waveDoneTimer = 0;

    if (this.waveIndex < this.stage.waves.length - 1) {
      this.waveIndex += 1;
      this.waveSpawned = false;
      this.floatText(VIEW_W / 2, VIEW_H / 2, `WAVE ${this.waveIndex + 1}`, "#6fe8ff");
      return;
    }

    if (this.stage.boss && !this.bossDefeated) {
      this.bossDefeated = true;
      this.warningTimer = 2;
      this.spawnBoss();
      return;
    }

    this.completeStage();
  }

  private bossDefeated = false;

  private completeStage() {
    const accuracy = this.shotsFired > 0 ? this.shotsHit / this.shotsFired : 0;
    const lifeBonus = this.player.lives * 1500;
    const noMissBonus = this.tookDamage ? 0 : 8000;
    const accBonus = Math.round(accuracy * 4000);
    const comboBonus = this.maxCombo * 60;
    const bonus = Math.round((lifeBonus + noMissBonus + accBonus + comboBonus) * this.diff.scoreMul);
    this.score += bonus;

    const prevBest = this.progress.highScores[this.stageIndex] ?? 0;
    const stageScore = this.score - this.totalRunScore;
    const isNewRecord = stageScore > prevBest;
    if (isNewRecord) this.progress.highScores[this.stageIndex] = stageScore;
    if (!this.progress.clearedStages.includes(this.stageIndex)) {
      this.progress.clearedStages.push(this.stageIndex);
    }
    this.progress.unlockedStage = Math.max(this.progress.unlockedStage, Math.min(STAGE_COUNT, this.stageIndex + 1));
    this.progress.bestTotalScore = Math.max(this.progress.bestTotalScore, this.score);
    this.progress.bestCombo = Math.max(this.progress.bestCombo, this.maxCombo);
    this.persist();

    this.stageResult = {
      stage: this.stageIndex,
      stageName: this.stage.name,
      score: stageScore,
      timeMs: this.stageTimeMs,
      maxCombo: this.maxCombo,
      shotsFired: this.shotsFired,
      shotsHit: this.shotsHit,
      noMiss: !this.tookDamage,
      bonus,
      isNewRecord,
    };
    this.totalRunScore = this.score;
    this.bossDefeated = false;
    this.clearTimer = 0;
    this.audio.stopBgm();
    this.audio.play("stageClear");
    if (this.run.active) {
      this.run.depth = Math.max(this.run.depth, this.stageIndex);
      this.recordRun();
      // 次のステージへ進む前に強化を1つ選ばせる
      if (this.stageIndex < STAGE_COUNT) {
        this.run.offer = offerUpgrades(this.run, 3, Math.random);
      }
    }
    this.setPhase(this.stageIndex >= STAGE_COUNT ? "allClear" : "stageClear");
  }

  // ---------------------------------------------------------------- HUD

  getHud(): HudSnapshot {
    const p = this.player;
    return {
      phase: this.phase,
      score: this.score,
      displayScore: Math.round(this.displayScore),
      stage: this.stageIndex,
      stageName: this.stage.name,
      lives: p.lives,
      hp: p.hp,
      maxHp: p.maxHp,
      shield: p.shield,
      maxShield: p.maxShield,
      weapon: p.weapon,
      power: p.power,
      bombs: p.bombs,
      optionCount: p.options.length,
      combo: this.combo,
      maxCombo: this.maxCombo,
      enemiesLeft: this.enemies.length,
      waveIndex: this.waveIndex,
      waveCount: this.stage.waves.length,
      bossName: this.boss ? this.boss.name : null,
      bossHp: this.boss ? this.boss.hp : 0,
      bossMaxHp: this.boss ? this.boss.maxHp : 1,
      powerups: (Object.keys(this.powerups) as TimedPowerupKind[])
        .filter((k) => this.powerups[k] > 0 && k !== "invincible")
        .map((k) => ({ kind: k, remaining: this.powerups[k], duration: POWERUP_DURATION[k] ?? 10 })),
      fps: this.fps,
      stageResult: this.stageResult,
      hint: this.stage.hint,
      hazard: this.stage.hazard,
    };
  }
}

function createPlayer(): PlayerState {
  return {
    x: VIEW_W / 2,
    y: FIELD_BOTTOM - 60,
    w: 26,
    h: 24,
    lives: 3,
    hp: PLAYER_MAX_HP,
    maxHp: PLAYER_MAX_HP,
    weapon: "vulcan",
    power: 1,
    speedLevel: 1,
    shield: 0,
    maxShield: PLAYER_MAX_SHIELD,
    bombs: START_BOMBS,
    options: [],
    fireCooldown: 0,
    invincible: RESPAWN_INVINCIBLE,
    respawning: 0,
    dead: false,
    trail: [],
  };
}
