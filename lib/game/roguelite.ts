import type { PlayerState, RogueRun, RogueUpgradeId } from "./types";

/**
 * ローグライトモードの強化。
 *
 * 「強化を積むとゲームが簡単になる」問題への答えを、この3つで組んでいる。
 *
 *   1. 敵も一緒に強くなる。強化にはそれぞれ threat（脅威度）があり、
 *      積んだ合計に応じて敵の耐久・射撃間隔・弾速が上がる。
 *      強くなった実感は残しつつ、難易度は寝かせない。
 *   2. 代償つきの強化を混ぜる。強さが一本調子で伸びないようにする。
 *   3. 同じ強化には上限がある。一点特化で壊れないようにする。
 *
 * さらに、ステージ開始時には「強化で決まった構成」に戻る。
 * ステージ中に拾ったアイテムはそのステージ限りなので、
 * アイテム由来の強さが後半へ雪だるま式に持ち越されることがない。
 */

export interface RogueUpgradeDef {
  id: RogueUpgradeId;
  label: string;
  desc: string;
  /** 代償のある強化かどうか（UI で色を変える） */
  tradeoff?: string;
  /** 敵がどれだけ強くなるか。強い強化ほど大きい */
  threat: number;
  /** 1回のランで取れる上限 */
  max: number;
}

export const ROGUE_UPGRADES: Record<RogueUpgradeId, RogueUpgradeDef> = {
  power: { id: "power", label: "増幅器", desc: "火力 +1", threat: 1, max: 4 },
  pod: { id: "pod", label: "随伴ポッド", desc: "ポッド +1 基", threat: 1.2, max: 4 },
  speed: { id: "speed", label: "推進器", desc: "移動速度 +1", threat: 0.4, max: 3 },
  vitality: { id: "vitality", label: "装甲板", desc: "最大耐久 +2", threat: 0.5, max: 4 },
  barrier: { id: "barrier", label: "遮蔽装置", desc: "シールドを1枚張って始まる", threat: 0.6, max: 2 },
  ordnance: { id: "ordnance", label: "弾薬庫", desc: "ボムを1発多く持って始まる", threat: 0.4, max: 3 },
  rapid: { id: "rapid", label: "冷却装置", desc: "発射間隔 -12%", threat: 0.9, max: 3 },
  fortune: { id: "fortune", label: "探知機", desc: "アイテム出現率 +35%", threat: 0.5, max: 3 },

  overdrive: {
    id: "overdrive",
    label: "過負荷炉",
    desc: "弾のダメージ +35%",
    tradeoff: "最大耐久 -2",
    threat: 1.2,
    max: 2,
  },
  hairtrigger: {
    id: "hairtrigger",
    label: "軽量機関",
    desc: "発射間隔 -25%",
    tradeoff: "弾のダメージ -15%",
    threat: 0.8,
    max: 2,
  },
  glasscannon: {
    id: "glasscannon",
    label: "硝子の砲身",
    desc: "火力 +2",
    tradeoff: "シールドを一切張れなくなる",
    threat: 1.6,
    max: 1,
  },
  scavenger: {
    id: "scavenger",
    label: "強欲な走査",
    desc: "アイテム出現率 +80%",
    tradeoff: "敵の弾速 +8%",
    threat: 0.7,
    max: 2,
  },
  piercer: {
    id: "piercer",
    label: "徹甲弾",
    desc: "弾が敵を1体多く貫通する",
    tradeoff: "発射間隔 +12%",
    threat: 1,
    max: 2,
  },
  gambler: {
    id: "gambler",
    label: "賭博師",
    desc: "スコア倍率 +50%",
    tradeoff: "最大耐久 -1",
    threat: 0.3,
    max: 2,
  },
  reactor: {
    id: "reactor",
    label: "増設炉",
    desc: "ポッド +2 基",
    tradeoff: "移動速度 -1",
    threat: 1.8,
    max: 1,
  },
  bulwark: {
    id: "bulwark",
    label: "重装甲",
    desc: "最大耐久 +4",
    tradeoff: "発射間隔 +10%",
    threat: 0.4,
    max: 2,
  },
};

export const ROGUE_UPGRADE_IDS = Object.keys(ROGUE_UPGRADES) as RogueUpgradeId[];

/** 敵がどれだけ強くなるか。1 threat あたりの倍率 */
export const THREAT_SCALE = {
  hp: 0.06,
  fire: 0.05,
  bulletSpeed: 0.02,
  moveSpeed: 0.02,
  /** 手応えが上がるぶんスコアも伸びる */
  score: 0.1,
};

export function emptyRun(): RogueRun {
  return {
    active: false,
    depth: 1,
    threat: 0,
    taken: {},
    offer: [],
    fireIntervalMul: 1,
    damageMul: 1,
    itemChanceMul: 1,
    enemyBulletMul: 1,
    pierceBonus: 0,
    scoreMul: 1,
    powerBonus: 0,
    podBonus: 0,
    speedBonus: 0,
    hpBonus: 0,
    shieldBonus: 0,
    bombBonus: 0,
    noShield: false,
  };
}

/** 取得済みの強化から、まだ取れるものを count 個選ぶ */
export function offerUpgrades(run: RogueRun, count: number, rnd: () => number): RogueUpgradeId[] {
  const pool = ROGUE_UPGRADE_IDS.filter((id) => (run.taken[id] ?? 0) < ROGUE_UPGRADES[id].max);
  const picked: RogueUpgradeId[] = [];
  while (picked.length < count && pool.length > 0) {
    const i = Math.floor(rnd() * pool.length) % pool.length;
    picked.push(pool[i]);
    pool.splice(i, 1);
  }
  return picked;
}

/**
 * 取得済みの強化から補正値を組み直す。
 * 取るたびに足し込むのではなく毎回作り直すので、ずれが溜まらない。
 */
export function recomputeRun(run: RogueRun) {
  const n = (id: RogueUpgradeId) => run.taken[id] ?? 0;
  run.threat = ROGUE_UPGRADE_IDS.reduce((s, id) => s + n(id) * ROGUE_UPGRADES[id].threat, 0);

  run.powerBonus = n("power") + n("glasscannon") * 2;
  run.podBonus = n("pod") + n("reactor") * 2;
  run.speedBonus = n("speed") - n("reactor");
  run.hpBonus = n("vitality") * 2 + n("bulwark") * 4 - n("overdrive") * 2 - n("gambler");
  run.shieldBonus = n("barrier");
  run.bombBonus = n("ordnance");
  run.noShield = n("glasscannon") > 0;

  run.fireIntervalMul =
    Math.pow(0.88, n("rapid")) * Math.pow(0.75, n("hairtrigger")) * Math.pow(1.12, n("piercer")) * Math.pow(1.1, n("bulwark"));
  run.damageMul = Math.pow(1.35, n("overdrive")) * Math.pow(0.85, n("hairtrigger"));
  run.itemChanceMul = Math.pow(1.35, n("fortune")) * Math.pow(1.8, n("scavenger"));
  run.enemyBulletMul = Math.pow(1.08, n("scavenger"));
  run.pierceBonus = n("piercer");
  run.scoreMul = Math.pow(1.5, n("gambler"));
}

export function takeUpgrade(run: RogueRun, id: RogueUpgradeId): boolean {
  const def = ROGUE_UPGRADES[id];
  if (!def) return false;
  if ((run.taken[id] ?? 0) >= def.max) return false;
  run.taken[id] = (run.taken[id] ?? 0) + 1;
  run.offer = [];
  recomputeRun(run);
  return true;
}

/**
 * ステージ開始時の構成を自機へ反映する。
 * アイテムで得た強さはここで消えるので、恒久的な強さは強化だけになる。
 */
export function applyRunLoadout(p: PlayerState, run: RogueRun, baseMaxHp: number, maxShield: number) {
  p.weapon = "vulcan";
  p.power = Math.max(1, Math.min(5, 1 + run.powerBonus));
  p.speedLevel = Math.max(0, Math.min(4, 1 + run.speedBonus));
  p.maxHp = Math.max(2, baseMaxHp + run.hpBonus);
  p.hp = p.maxHp;
  p.maxShield = run.noShield ? 0 : maxShield;
  p.shield = run.noShield ? 0 : Math.min(p.maxShield, run.shieldBonus);
  p.bombs = 1 + run.bombBonus;
  p.options = p.options.slice(0, Math.max(0, Math.min(4, run.podBonus)));
}

/** ポッドの必要数（不足分は engine 側で生成する） */
export function wantedPods(run: RogueRun): number {
  return Math.max(0, Math.min(4, run.podBonus));
}
