import type { Settings } from "../../game/types";
import { FIGHTER_H, FIGHTER_W, PLAYER_COLORS, V_H, V_W, VERSUS_WEAPONS } from "../constants";
import { BAND_ENEMIES } from "../enemies";
import type { RenderableVersus } from "../render";
import type {
  BandEnemy,
  BandEnemyId,
  Fighter,
  FighterInput,
  PlayerId,
  VersusBullet,
  VersusHudSnapshot,
  VersusItem,
  VersusItemKind,
} from "../types";
import { bulletKindName } from "./protocol";
import type { ClientView, ViewFighter } from "./client";

/**
 * サーバーのスナップショットから描画用の状態を組み立てる。
 *
 * 重要なのは座標の反転。P2 の画面をそのまま描くと「自分が上・逆さま」で戦うことになるため、
 * 上下（と左右）を反転して、どちらのプレイヤーからも「自分が下」に見えるようにする。
 * フィールドが上下対称（上陣 46-268 / 中立 268-452 / 下陣 452-674、全体 720）なので、
 * y → V_H - y の変換で陣地がちょうど入れ替わる。
 */
/**
 * 手元の入力（画面基準）を、サーバーが扱う座標系（フィールド基準）へ直す。
 *
 * P2 の画面は 180 度回して描いている。回した画面で「上」を押すというのは、
 * フィールドの座標では「下」へ動きたいという意味になる。ここで戻しておかないと、
 * P2 だけ上下左右がすべて逆に動く。描画の反転と対になる処理なので、同じ場所に置いてある。
 */
export function toFieldInput(input: FighterInput, you: PlayerId): FighterInput {
  if (you !== 2) return input;
  return {
    ...input,
    left: input.right,
    right: input.left,
    up: input.down,
    down: input.up,
  };
}

export function buildRenderable(
  view: ClientView,
  you: PlayerId,
  settings: Settings,
): { renderable: RenderableVersus; hud: VersusHudSnapshot } {
  const flip = you === 2;
  const fx = (x: number) => (flip ? V_W - x : x);
  const fy = (y: number) => (flip ? V_H - y : y);

  const toFighter = (v: ViewFighter): Fighter => {
    const bottom = flip ? v.id === 2 : v.id === 1;
    const palette = v.id === 1 ? PLAYER_COLORS.p1 : PLAYER_COLORS.p2;
    return {
      id: v.id,
      name: v.id === you ? "YOU" : "OPPONENT",
      color: palette.color,
      accent: palette.accent,
      zoneTop: 0,
      zoneBottom: 0,
      dir: bottom ? -1 : 1,
      x: fx(v.x),
      y: fy(v.y),
      w: FIGHTER_W,
      h: FIGHTER_H,
      hp: v.hp,
      maxHp: 10,
      shield: v.sh,
      maxShield: 2,
      energy: v.en,
      maxEnergy: v.men,
      regen: 0,
      power: v.pw,
      weapon: v.wp,
      weaponTimer: v.wt,
      rapidTimer: v.rp ? 1 : 0,
      slowTimer: v.sl ? 1 : 0,
      speedLevel: v.sp,
      bombs: v.bm,
      fireCooldown: 0,
      invincible: v.iv ? 0.2 : 0,
      hitFlash: 0,
      wins: v.wn,
      shots: 0,
      hits: 0,
      kills: v.kl,
      pickups: v.pk,
      alive: v.al === 1,
    };
  };

  const fighters: [Fighter, Fighter] = [toFighter(view.fighters[0]), toFighter(view.fighters[1])];

  const bullets: VersusBullet[] = view.bullets.map((b) => {
    const kind = bulletKindName(b.k) as VersusBullet["kind"];
    const spec = kind === "enemy" || kind === "bomb" ? null : VERSUS_WEAPONS[kind];
    return {
      id: b.i,
      x: fx(b.x),
      y: fy(b.y),
      vx: 0,
      vy: 0,
      w: kind === "bomb" ? 22 : (spec?.w ?? 7),
      h: kind === "bomb" ? 22 : (spec?.h ?? 7),
      dmg: 1,
      owner: b.o,
      kind,
      pierce: 0,
      homing: 0,
      life: 1,
      color: kind === "bomb" ? "#ff8ad6" : (spec?.color ?? "#ff6b6b"),
    };
  });

  const enemies: BandEnemy[] = view.enemies.map((e) => {
    const def = BAND_ENEMIES[e.t as BandEnemyId] ?? BAND_ENEMIES.drifter;
    return {
      id: e.i,
      type: e.t as BandEnemyId,
      x: fx(e.x),
      y: fy(e.y),
      vx: 0,
      baseY: fy(e.y),
      w: def.w,
      h: def.h,
      hp: e.hp,
      maxHp: e.mh,
      t: e.i * 0.7,
      fireCooldown: 0,
      hitFlash: 0,
      lastHitBy: null,
    };
  });

  const items: VersusItem[] = view.items.map((i) => ({
    id: i.i,
    kind: i.k as VersusItemKind,
    owner: i.o,
    x: fx(i.x),
    y: fy(i.y),
    vx: 0,
    vy: 0,
    life: 9,
  }));

  const renderable: RenderableVersus = {
    settings,
    shake: 0,
    flash: 0,
    flashColor: "#ffffff",
    phase: view.phase,
    round: view.round,
    roundTime: view.timeLeft,
    countdown: view.countdown,
    banner: view.banner,
    lastRoundWinner: view.lastRoundWinner,
    overdrive: view.overdrive,
    fighters,
    bullets,
    enemies,
    items,
    particles: [],
  };

  // HUD は「自分が下」に合わせて並べ替える
  const me = fighters[you - 1];
  const foe = fighters[you === 1 ? 1 : 0];
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

  const hud: VersusHudSnapshot = {
    phase: view.phase,
    round: view.round,
    roundsToWin: 2,
    timeLeft: view.timeLeft,
    countdown: view.countdown,
    fighters: [toHud(me), toHud(foe)],
    enemiesInBand: enemies.length,
    lastRoundWinner: view.lastRoundWinner,
    matchWinner: view.matchWinner,
    banner: view.banner,
    overdrive: view.overdrive,
    fps: 60,
  };

  return { renderable, hud };
}
