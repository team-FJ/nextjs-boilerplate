import type { BoostId, Fighter } from "./types";

/**
 * ラウンドの敗者だけが選べる強化。
 *
 * 「強化を積むとゲームが簡単になる」問題を避けるため、次の3つで縛っている。
 *   1. 勝った側は何ももらえない。負けた側にしか積まれないので、差は自然に縮む方向にしか働かない
 *   2. 同じ強化は1試合に1回まで。重ねがけできないので上限が読める
 *   3. 1つあたりの効果は小さめ。3つ積んでやっと「少し楽になった」程度に収める
 *
 * 強化はラウンドをまたいで残る（ラウンド開始時のリセットの後に効かせ直す）。
 */

export interface BoostDef {
  id: BoostId;
  label: string;
  desc: string;
  /** ラウンド開始時、リセット後の自機に効かせる */
  apply: (f: Fighter) => void;
}

export const BOOSTS: Record<BoostId, BoostDef> = {
  armor: {
    id: "armor",
    label: "装甲",
    desc: "最大耐久 +2",
    apply: (f) => {
      f.maxHp += 2;
      f.hp = f.maxHp;
    },
  },
  regen: {
    id: "regen",
    label: "冷却",
    desc: "エネルギー回復が 20% 速くなる",
    apply: (f) => {
      f.regen *= 1.2;
    },
  },
  power: {
    id: "power",
    label: "増幅",
    desc: "弾の威力が 1 段階上がった状態で始まる",
    apply: (f) => {
      f.power += 1;
    },
  },
  swift: {
    id: "swift",
    label: "推進",
    desc: "移動速度が 1 段階上がる",
    apply: (f) => {
      f.speedLevel += 1;
    },
  },
  barrier: {
    id: "barrier",
    label: "障壁",
    desc: "シールドを 1 枚持って始まる",
    apply: (f) => {
      f.shield = Math.min(f.maxShield, f.shield + 1);
    },
  },
  payload: {
    id: "payload",
    label: "弾頭",
    desc: "ボムを 1 発持って始まる",
    apply: (f) => {
      f.bombs += 1;
    },
  },
  focus: {
    id: "focus",
    label: "照準",
    desc: "エネルギーの最大値 +25",
    apply: (f) => {
      f.maxEnergy += 25;
      f.energy = f.maxEnergy;
    },
  },
  guard: {
    id: "guard",
    label: "防護",
    desc: "受けるダメージが 15% 減る",
    apply: () => {
      /* ダメージ計算側で参照する。ここでは何もしない */
    },
  },
};

export const BOOST_IDS = Object.keys(BOOSTS) as BoostId[];

/** 防護の軽減率。damage 側から参照する */
export const GUARD_REDUCTION = 0.15;

/** まだ取っていない強化から count 個を選ぶ */
export function offerBoosts(taken: BoostId[], count: number, rnd: () => number): BoostId[] {
  const pool = BOOST_IDS.filter((id) => !taken.includes(id));
  const picked: BoostId[] = [];
  while (picked.length < count && pool.length > 0) {
    const i = Math.floor(rnd() * pool.length) % pool.length;
    picked.push(pool[i]);
    pool.splice(i, 1);
  }
  return picked;
}

/** ラウンド開始時、リセットされた自機に取得済みの強化を効かせ直す */
export function applyBoosts(f: Fighter) {
  for (const id of f.boosts) BOOSTS[id]?.apply(f);
}
