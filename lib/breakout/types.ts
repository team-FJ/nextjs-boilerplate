/**
 * SPIN RALLY の型定義。
 *
 * 描画とReactから独立させ、Node上でヘッドレスに動かせる状態を保つこと。
 * ここに DOM / React の型を持ち込まない。
 */

export type Mode = "solo" | "coop" | "versus";
export type Difficulty = "easy" | "normal" | "hard" | "expert";

/** 0 = 下側プレイヤー（1人・協力では唯一の陣地）、1 = 上側プレイヤー */
export type Side = 0 | 1;

export interface PlayerInput {
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
  fire: boolean;
  /**
   * スティックの生ベクトル（画面座標・上が負）。
   * 技の打ち出し角 θ を連続値で取るために使う。null ならキー入力の8方向から求める。
   */
  analog: { x: number; y: number } | null;
  /**
   * この入力が「何ティック前に押されたか」。通信対戦のラグ補償で使う。
   * ローカルでは常に 0（＝いま押した）。
   */
  pressAge?: number;
}

export function emptyInput(): PlayerInput {
  return { left: false, right: false, up: false, down: false, fire: false, analog: null };
}

/** 巻き戻しの再計算で「いま押している向き」を使ってしまわないよう、保持する瞬間に複製する */
export function cloneInput(input: PlayerInput): PlayerInput {
  return {
    left: input.left,
    right: input.right,
    up: input.up,
    down: input.down,
    fire: input.fire,
    analog: input.analog ? { x: input.analog.x, y: input.analog.y } : null,
    pressAge: input.pressAge,
  };
}

export type BlockKind = "normal" | "tough" | "solid" | "explosive" | "moving";

export interface Block {
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
  kind: BlockKind;
  hp: number;
  alive: boolean;
  /** 移動ブロック用 */
  baseX: number;
  phase: number;
  /** 対戦の中立ブロックか（true なら壊した側にアイテムが落ちる） */
  neutral: boolean;
}

/** A群：強化 / B群：妨害 / C群：盤面・スコア / D群：トラップ */
export type ItemKind =
  | "wide"
  | "magnet"
  | "multi"
  | "laser"
  | "powerspin"
  | "heavysmash"
  | "longlob"
  | "gaugeboost"
  | "refill"
  | "slow"
  | "floor"
  | "oneup"
  | "shrink"
  | "jam"
  | "reverse"
  | "blind"
  | "ice"
  | "wall"
  | "bomb"
  | "drill"
  | "score2"
  | "chainkeep"
  | "shuffle"
  | "narrow"
  | "accel"
  | "gaugedown";

export type ItemGroup = "buff" | "hinder" | "field" | "trap";

export interface ItemDrop {
  id: number;
  kind: ItemKind;
  x: number;
  y: number;
  vy: number;
  /** 拾える持ち主。対戦では色で示し、持ち主以外は拾えない */
  owner: Side;
}

export interface Ball {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  /** −1.0〜+1.0。進行方向に垂直な加速度を生む */
  spin: number;
  /** スピンの残り時間（秒）。0 で直進に戻る */
  spinT: number;
  /** ロブ状態の残り時間（秒）。>0 の間はブロックをすり抜ける */
  lob: number;
  /** ロブ中の重力の向き（+1 = 下へ落ちる） */
  lobG: number;
  /** 貫通の残りフレーム */
  pierce: number;
  /** 最後に打ったプレイヤー。対戦の得点帰属に使う */
  owner: Side;
  /** マグネットで吸着中のパドル番号（paddles の添字）。null なら自由 */
  stuck: number | null;
  stuckOffset: number;
  /** 直前に掛かった技。協力モードの連携チェイン判定に使う */
  lastSkill: SkillKind | null;
  lastSkillBy: number;
}

export interface Paddle {
  /** paddles の添字。協力モードでは2枚とも side 0 なので、区別はこちらで行う */
  index: number;
  side: Side;
  x: number;
  y: number;
  w: number;
  h: number;
  vx: number;
  vy: number;
  gauge: number;
  gaugeMax: number;
  /** 技の失敗による硬直の残り秒 */
  stun: number;
  /** 技の入力待ち（ボール接触前に押された分）。angle が null なら方向なし＝スマッシュ */
  pending: { angle: SkillAngle | null; tick: number } | null;
  /** 直近でボールに触れたティックと相手ボール。後入力の受付に使う */
  hitTick: number;
  hitBall: number;
  timers: Partial<Record<ItemKind, number>>;
  magnet: number;
  drill: number;
  floor: number;
  wall: number;
  laserCd: number;
  prevFire: boolean;
  score: number;
  points: number;
  /** 直前に成立した技（演出用） */
  lastSkill: { kind: SkillKind; t: number } | null;
}

/** 技の打ち出し角。sin は相手側へどれだけ倒したか、cos は横へどれだけ倒したか */
export interface SkillAngle {
  sin: number;
  cos: number;
  sign: number;
}

/** smash は方向なし（ショットのみ）、drill は上＋ショット */
export type SkillKind = "smash" | "drill" | "curve" | "lob" | "fail";

export type GameEvent =
  | { type: "blockHit"; x: number; y: number }
  | { type: "blockBreak"; x: number; y: number; kind: BlockKind }
  | { type: "paddleHit"; x: number; y: number }
  | { type: "skill"; kind: SkillKind; side: Side; x: number; y: number }
  | { type: "item"; kind: ItemKind; side: Side }
  | { type: "miss"; side: Side }
  | { type: "score"; side: Side }
  | { type: "wall"; x: number; y: number }
  | { type: "laser" }
  | { type: "stageClear" }
  | { type: "gameOver" }
  | { type: "chain"; count: number };

export type Phase = "ready" | "playing" | "stageClear" | "gameOver" | "roundEnd";

export interface Settings {
  difficulty: Difficulty;
  /** 1人・協力でボールに軽い重力を掛ける（対戦は上下対称が崩れるので掛けない） */
  gravity: boolean;
  bgm: number;
  sfx: number;
  scanline: boolean;
}

export interface Progress {
  unlockedStage: number;
  clearedStages: number[];
  highScores: Record<number, number>;
  bestChain: number;
  playCount: number;
}
