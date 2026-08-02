// ゲーム全体で共有する型定義

export type Difficulty = "easy" | "normal" | "hard" | "insane";

export type WeaponKind = "vulcan" | "spread" | "laser" | "missile" | "wave" | "rail";

export type ItemKind =
  | "power"
  | "spread"
  | "laser"
  | "missile"
  | "wave"
  | "rail"
  | "option"
  | "shield"
  | "speed"
  | "rapid"
  | "bomb"
  | "life"
  | "score2x"
  | "slow"
  | "magnet"
  | "freeze"
  | "pierce"
  | "heal";

export type TimedPowerupKind =
  | "rapid"
  | "score2x"
  | "slow"
  | "magnet"
  | "freeze"
  | "pierce"
  | "invincible";

export type EnemyTypeId =
  | "scout"
  | "glider"
  | "hulk"
  | "gunner"
  | "bomber"
  | "elite"
  | "tank"
  | "ghost"
  | "kamikaze"
  | "splitter"
  | "healer"
  | "turret"
  | "mine";

export type BossId =
  | "carrier"
  | "hydra"
  | "sentinel"
  | "devourer"
  | "twinFang"
  | "overmind";

export type FormationName =
  | "grid"
  | "vshape"
  | "diamond"
  | "arc"
  | "columns"
  | "checker"
  | "wedge"
  | "ring"
  | "cross"
  | "scatter";

export type EntryStyle = "top" | "sides" | "swirl" | "drop";

export type HazardKind = "none" | "meteor" | "nebula" | "laserGrid" | "solarWind" | "debris";

export interface WaveDef {
  formation: FormationName;
  rows: number;
  cols: number;
  /** 行ごとの敵種別（行数より短い場合は循環して使用） */
  types: EnemyTypeId[];
  /** 編隊の横移動速度倍率 */
  speed: number;
  /** 射撃頻度倍率 */
  fireRate: number;
  /** 突撃（ダイブ）頻度倍率 */
  diveRate: number;
  entry: EntryStyle;
}

export interface StageDef {
  index: number;
  name: string;
  theme: ThemeName;
  waves: WaveDef[];
  boss?: BossId;
  hazard: HazardKind;
  /** アイテムドロップ率（0-1） */
  itemChance: number;
  hint: string;
}

export type ThemeName =
  | "space"
  | "nebula"
  | "ice"
  | "magma"
  | "toxic"
  | "void"
  | "sunrise"
  | "cyber";

/** ステージ間で強化をどれだけ持ち越すか */
export interface CarryPolicy {
  /** 武装（バルカン以外）を持ち越すか */
  weapon: boolean;
  /** パワーレベルを何段階戻すか */
  powerDecay: number;
  /** オプションポッドを何基外すか */
  optionDecay: number;
  keepSpeed: boolean;
  keepShield: boolean;
  /** keep=そのまま / one=1発に補充 / zero=なし */
  bombs: "keep" | "one" | "zero";
  /** ステージ開始時に耐久を全回復するか */
  healOnStage: boolean;
}

export interface Settings {
  difficulty: Difficulty;
  autoFire: boolean;
  screenShake: boolean;
  particles: "low" | "normal" | "high";
  crt: boolean;
  starfield: boolean;
  sfxVolume: number;
  bgmVolume: number;
  showFps: boolean;
  control: "keyboard" | "mouse";
  colorBlind: boolean;
  optionFormation: "trail" | "side" | "rotate";
}

export interface Progress {
  unlockedStage: number;
  clearedStages: number[];
  highScores: Record<number, number>;
  bestTotalScore: number;
  bestCombo: number;
  playCount: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
  kind: "spark" | "smoke" | "ring" | "text";
  text?: string;
  drag: number;
}

export interface Bullet {
  x: number;
  y: number;
  vx: number;
  vy: number;
  w: number;
  h: number;
  dmg: number;
  from: "player" | "enemy";
  kind: WeaponKind | "enemyShot" | "enemyBomb" | "enemyLaser";
  life: number;
  pierce: number;
  homing: number;
  color: string;
  angle: number;
  hitIds?: Set<number>;
}

export interface EnemyStateFlags {
  frozen: number;
  slowed: number;
  hitFlash: number;
  shieldedBy: number | null;
}

export interface Enemy {
  id: number;
  type: EnemyTypeId;
  x: number;
  y: number;
  w: number;
  h: number;
  hp: number;
  maxHp: number;
  score: number;
  slotX: number;
  slotY: number;
  mode: "entry" | "formation" | "dive" | "return" | "free";
  t: number;
  entryDelay: number;
  entryPath: { x: number; y: number }[];
  vx: number;
  vy: number;
  fireCooldown: number;
  diveCooldown: number;
  flags: EnemyStateFlags;
  color: string;
  accent: string;
  generation: number;
}

export interface BossPart {
  id: number;
  name: string;
  offsetX: number;
  offsetY: number;
  r: number;
  hp: number;
  maxHp: number;
  destroyed: boolean;
  fireCooldown: number;
}

export interface Boss {
  id: BossId;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  hp: number;
  maxHp: number;
  phase: number;
  phaseCount: number;
  t: number;
  vx: number;
  vy: number;
  parts: BossPart[];
  attackTimer: number;
  attackIndex: number;
  hitFlash: number;
  entering: boolean;
  dying: number;
  color: string;
  accent: string;
}

export interface Item {
  id: number;
  kind: ItemKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  magnet: boolean;
}

export interface OptionPod {
  x: number;
  y: number;
  angle: number;
  fireCooldown: number;
}

export interface PlayerState {
  x: number;
  y: number;
  w: number;
  h: number;
  lives: number;
  hp: number;
  maxHp: number;
  weapon: WeaponKind;
  power: number;
  speedLevel: number;
  shield: number;
  maxShield: number;
  bombs: number;
  options: OptionPod[];
  fireCooldown: number;
  invincible: number;
  respawning: number;
  dead: boolean;
  trail: { x: number; y: number }[];
}

export type Phase =
  | "title"
  | "stageSelect"
  | "options"
  | "howto"
  | "briefing"
  | "playing"
  | "paused"
  | "stageClear"
  | "gameOver"
  | "allClear";

export interface HudSnapshot {
  phase: Phase;
  score: number;
  displayScore: number;
  stage: number;
  stageName: string;
  lives: number;
  hp: number;
  maxHp: number;
  shield: number;
  maxShield: number;
  weapon: WeaponKind;
  power: number;
  bombs: number;
  optionCount: number;
  combo: number;
  maxCombo: number;
  enemiesLeft: number;
  waveIndex: number;
  waveCount: number;
  bossName: string | null;
  bossHp: number;
  bossMaxHp: number;
  powerups: { kind: TimedPowerupKind; remaining: number; duration: number }[];
  fps: number;
  stageResult: StageResult | null;
  hint: string;
  hazard: HazardKind;
}

export interface StageResult {
  stage: number;
  stageName: string;
  score: number;
  timeMs: number;
  maxCombo: number;
  shotsFired: number;
  shotsHit: number;
  noMiss: boolean;
  bonus: number;
  isNewRecord: boolean;
}
