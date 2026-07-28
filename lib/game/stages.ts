import type { EnemyTypeId, StageDef, WaveDef } from "./types";

type W = Partial<WaveDef> & { types: EnemyTypeId[] };

const wave = (w: W): WaveDef => ({
  formation: w.formation ?? "grid",
  rows: w.rows ?? 3,
  cols: w.cols ?? 7,
  types: w.types,
  speed: w.speed ?? 1,
  fireRate: w.fireRate ?? 1,
  diveRate: w.diveRate ?? 1,
  entry: w.entry ?? "top",
});

let autoIndex = 0;
const stage = (
  name: string,
  theme: StageDef["theme"],
  waves: W[],
  extra: Partial<Omit<StageDef, "index" | "name" | "theme" | "waves">> = {},
): StageDef => ({
  index: ++autoIndex,
  name,
  theme,
  waves: waves.map(wave),
  hazard: extra.hazard ?? "none",
  itemChance: extra.itemChance ?? 0.16,
  boss: extra.boss,
  hint: extra.hint ?? "",
});

/** 全30ステージ。5の倍数はボス戦 */
export const STAGES: StageDef[] = [
  stage(
    "初接触",
    "space",
    [
      { formation: "grid", rows: 2, cols: 6, types: ["squid"], speed: 0.7, fireRate: 0.6 },
      { formation: "grid", rows: 3, cols: 7, types: ["squid", "crab"], speed: 0.8, fireRate: 0.7 },
    ],
    { itemChance: 0.24, hint: "Pアイテムで武装を強化しよう" },
  ),
  stage("包囲網", "space", [
    { formation: "vshape", rows: 3, cols: 7, types: ["crab", "squid"], speed: 0.9 },
    { formation: "grid", rows: 3, cols: 8, types: ["crab", "octopus"], speed: 0.95 },
  ], { hint: "Oアイテムのオプションは分身のように追従する" }),
  stage("突撃隊", "nebula", [
    { formation: "wedge", rows: 3, cols: 7, types: ["kamikaze", "squid"], diveRate: 1.4 },
    { formation: "grid", rows: 3, cols: 8, types: ["crab", "gunner"], speed: 1 },
  ], { hazard: "meteor", hint: "カミカゼは編隊を離れて突っ込んでくる" }),
  stage("砲列", "nebula", [
    { formation: "columns", rows: 4, cols: 7, types: ["gunner", "crab", "squid"], fireRate: 1.15 },
    { formation: "checker", rows: 4, cols: 8, types: ["gunner", "octopus"], fireRate: 1.2 },
  ], { hint: "ガンナーは自機を狙って撃つ" }),
  stage("母艦強襲", "space", [
    { formation: "grid", rows: 2, cols: 8, types: ["crab", "squid"], speed: 1 },
  ], { boss: "carrier", itemChance: 0.3, hint: "ボスの砲台を先に潰すと弾幕が薄くなる" }),

  stage("氷晶回廊", "ice", [
    { formation: "diamond", rows: 4, cols: 8, types: ["squid", "crab", "ghost"], speed: 1.05 },
    { formation: "grid", rows: 4, cols: 8, types: ["ghost", "gunner"], speed: 1.05, fireRate: 1.1 },
  ], { hazard: "debris", hint: "ゴーストは一瞬透明化して弾をすり抜ける" }),
  stage("爆撃圏", "ice", [
    { formation: "arc", rows: 3, cols: 8, types: ["bomber", "crab"], fireRate: 1.1 },
    { formation: "grid", rows: 4, cols: 8, types: ["bomber", "gunner", "squid"], fireRate: 1.15 },
  ], { hint: "ボマーの爆弾は着弾時に破片が散る" }),
  stage("分裂体", "toxic", [
    { formation: "ring", rows: 3, cols: 8, types: ["splitter"], speed: 1.05 },
    { formation: "grid", rows: 4, cols: 8, types: ["splitter", "crab", "gunner"] },
  ], { hazard: "nebula", hint: "スプリッタは倒すと小型機に分裂する" }),
  stage("要塞前線", "toxic", [
    { formation: "checker", rows: 4, cols: 8, types: ["turret", "crab"], fireRate: 1.2 },
    { formation: "grid", rows: 4, cols: 8, types: ["turret", "tank", "gunner"], speed: 0.9 },
  ], { hint: "タレットは高速レーザーを撃つ。遮蔽を意識して" }),
  stage("多頭艦襲来", "toxic", [
    { formation: "grid", rows: 3, cols: 8, types: ["gunner", "splitter"], speed: 1.05 },
  ], { boss: "hydra", itemChance: 0.3, hint: "3つの頭を個別に破壊できる" }),

  stage("溶融帯", "magma", [
    { formation: "vshape", rows: 4, cols: 8, types: ["elite", "crab"], speed: 1.1, diveRate: 1.2 },
    { formation: "grid", rows: 4, cols: 9, types: ["elite", "gunner", "bomber"], fireRate: 1.15 },
  ], { hazard: "meteor", hint: "エリートは拡散弾を撒きながら突撃する" }),
  stage("鉄壁陣", "magma", [
    { formation: "grid", rows: 4, cols: 8, types: ["tank", "healer", "gunner"], speed: 0.85 },
    { formation: "wedge", rows: 4, cols: 8, types: ["tank", "turret"], speed: 0.9, fireRate: 1.2 },
  ], { hint: "ヒーラーが仲間を回復する。先に潰せ" }),
  stage("機雷原", "void", [
    { formation: "scatter", rows: 4, cols: 9, types: ["mine", "squid"], speed: 1.15 },
    { formation: "cross", rows: 4, cols: 9, types: ["mine", "kamikaze", "gunner"], diveRate: 1.3 },
  ], { hazard: "debris", hint: "機雷は接触ダメージ大。撃ち抜こう" }),
  stage("亡霊艦隊", "void", [
    { formation: "ring", rows: 4, cols: 9, types: ["ghost", "elite"], speed: 1.15 },
    { formation: "grid", rows: 4, cols: 9, types: ["ghost", "bomber", "gunner"], fireRate: 1.25 },
  ], { hint: "ピアース中は貫通するので編隊をまとめて狙える" }),
  stage("監視者", "void", [
    { formation: "arc", rows: 3, cols: 9, types: ["ghost", "elite"], speed: 1.1 },
  ], { boss: "sentinel", itemChance: 0.32, hint: "回転レーザーは軸をずらして避ける" }),

  stage("電脳網侵入", "cyber", [
    { formation: "columns", rows: 4, cols: 9, types: ["turret", "gunner", "elite"], fireRate: 1.25 },
    { formation: "checker", rows: 4, cols: 9, types: ["elite", "tank"], speed: 1.05 },
  ], { hazard: "laserGrid", hint: "レーザーグリッドの隙間を通れ" }),
  stage("高速迎撃", "cyber", [
    { formation: "wedge", rows: 4, cols: 9, types: ["kamikaze", "elite"], speed: 1.3, diveRate: 1.6 },
    { formation: "grid", rows: 4, cols: 9, types: ["kamikaze", "gunner", "splitter"], speed: 1.25 },
  ], { hint: "スピードアップを取って回避力を上げよう" }),
  stage("重装甲群", "sunrise", [
    { formation: "grid", rows: 4, cols: 8, types: ["tank", "tank", "healer"], speed: 0.9 },
    { formation: "diamond", rows: 4, cols: 9, types: ["tank", "turret", "elite"], fireRate: 1.2 },
  ], { hazard: "solarWind", hint: "レールガンは装甲貫通に強い" }),
  stage("恒星風", "sunrise", [
    { formation: "arc", rows: 4, cols: 9, types: ["bomber", "elite", "ghost"], fireRate: 1.3 },
    { formation: "ring", rows: 4, cols: 9, types: ["splitter", "elite", "turret"], speed: 1.15 },
  ], { hazard: "solarWind", hint: "恒星風で機体が押し流される" }),
  stage("捕食者", "magma", [
    { formation: "grid", rows: 3, cols: 9, types: ["elite", "bomber"], speed: 1.15 },
  ], { boss: "devourer", itemChance: 0.32, hint: "顎の突進はサイドに逃げて回避" }),

  stage("暗黒回廊", "void", [
    { formation: "scatter", rows: 5, cols: 9, types: ["ghost", "mine", "elite"], speed: 1.2 },
    { formation: "cross", rows: 5, cols: 9, types: ["ghost", "turret", "gunner"], fireRate: 1.35 },
  ], { hazard: "nebula", itemChance: 0.18, hint: "視界不良。弾の光を頼りに" }),
  stage("殲滅指令", "nebula", [
    { formation: "grid", rows: 5, cols: 9, types: ["elite", "tank", "healer", "gunner"], fireRate: 1.3 },
    { formation: "vshape", rows: 5, cols: 9, types: ["elite", "splitter", "bomber"], speed: 1.2 },
  ], { hint: "ボムは緊急回避にも使える" }),
  stage("双子星域", "ice", [
    { formation: "ring", rows: 5, cols: 9, types: ["turret", "elite", "ghost"], speed: 1.25, fireRate: 1.3 },
    { formation: "diamond", rows: 5, cols: 9, types: ["tank", "kamikaze", "elite"], diveRate: 1.5 },
  ], { hazard: "debris", hint: "フリーズで敵の動きを止められる" }),
  stage("最終防衛線", "cyber", [
    { formation: "checker", rows: 5, cols: 9, types: ["turret", "tank", "healer"], fireRate: 1.35 },
    { formation: "grid", rows: 5, cols: 9, types: ["elite", "bomber", "gunner", "splitter"], speed: 1.25 },
  ], { hazard: "laserGrid", hint: "オプション4基で火力を最大化" }),
  stage("双牙", "cyber", [
    { formation: "wedge", rows: 3, cols: 9, types: ["elite", "turret"], speed: 1.2 },
  ], { boss: "twinFang", itemChance: 0.34, hint: "牙は左右別々に動く。片方ずつ潰せ" }),

  stage("侵蝕領域", "toxic", [
    { formation: "scatter", rows: 5, cols: 10, types: ["splitter", "mine", "elite"], speed: 1.3 },
    { formation: "ring", rows: 5, cols: 10, types: ["splitter", "healer", "turret"], fireRate: 1.4 },
  ], { hazard: "nebula", hint: "分裂と回復の組み合わせは長期戦" }),
  stage("零下の墓標", "ice", [
    { formation: "cross", rows: 5, cols: 10, types: ["ghost", "tank", "elite"], speed: 1.3 },
    { formation: "grid", rows: 5, cols: 10, types: ["ghost", "turret", "bomber", "gunner"], fireRate: 1.45 },
  ], { hazard: "debris", hint: "スローで弾速を落として抜けろ" }),
  stage("業火", "magma", [
    { formation: "arc", rows: 5, cols: 10, types: ["bomber", "elite", "tank"], fireRate: 1.5 },
    { formation: "wedge", rows: 5, cols: 10, types: ["kamikaze", "elite", "turret"], diveRate: 1.8 },
  ], { hazard: "meteor", hint: "被弾したらシールドを拾い直そう" }),
  stage("終焉前夜", "sunrise", [
    { formation: "diamond", rows: 5, cols: 10, types: ["elite", "tank", "healer", "turret"], fireRate: 1.5 },
    { formation: "grid", rows: 5, cols: 10, types: ["elite", "ghost", "bomber", "splitter"], speed: 1.35 },
    { formation: "ring", rows: 4, cols: 10, types: ["kamikaze", "mine", "elite"], diveRate: 1.8 },
  ], { hazard: "solarWind", itemChance: 0.22, hint: "最終ステージ直前。装備を整えておけ" }),
  stage("超越体", "void", [
    { formation: "grid", rows: 3, cols: 10, types: ["elite", "tank", "turret"], speed: 1.3 },
  ], { boss: "overmind", itemChance: 0.4, hint: "5段階に変化する。諦めるな" }),
];

export const STAGE_COUNT = STAGES.length;

export const getStage = (index: number): StageDef =>
  STAGES[Math.max(0, Math.min(STAGES.length - 1, index - 1))];
