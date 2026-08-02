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

/** 全45ステージ。5の倍数はボス戦 */
export const STAGES: StageDef[] = [
  stage(
    "初接触",
    "space",
    [
      { formation: "grid", rows: 2, cols: 6, types: ["scout"], speed: 0.7, fireRate: 0.6 },
      { formation: "grid", rows: 3, cols: 7, types: ["scout", "glider"], speed: 0.8, fireRate: 0.7 },
    ],
    { itemChance: 0.24, hint: "Pアイテムで武装を強化しよう" },
  ),
  stage("包囲網", "space", [
    { formation: "vshape", rows: 3, cols: 7, types: ["glider", "scout"], speed: 0.9 },
    { formation: "grid", rows: 3, cols: 8, types: ["glider", "hulk"], speed: 0.95 },
  ], { hint: "Oアイテムのオプションは分身のように追従する" }),
  stage("突撃隊", "nebula", [
    { formation: "wedge", rows: 3, cols: 7, types: ["kamikaze", "scout"], diveRate: 1.4 },
    { formation: "grid", rows: 3, cols: 8, types: ["glider", "gunner"], speed: 1 },
  ], { hazard: "meteor", hint: "カミカゼは編隊を離れて突っ込んでくる" }),
  stage("砲列", "nebula", [
    { formation: "columns", rows: 4, cols: 7, types: ["gunner", "glider", "scout"], fireRate: 1.15 },
    { formation: "checker", rows: 4, cols: 8, types: ["gunner", "hulk"], fireRate: 1.2 },
  ], { hint: "ガンナーは自機を狙って撃つ" }),
  stage("母艦強襲", "space", [
    { formation: "grid", rows: 2, cols: 8, types: ["glider", "scout"], speed: 1 },
  ], { boss: "carrier", itemChance: 0.3, hint: "ボスの砲台を先に潰すと弾幕が薄くなる" }),

  stage("氷晶回廊", "ice", [
    { formation: "diamond", rows: 4, cols: 8, types: ["scout", "glider", "ghost"], speed: 1.05 },
    { formation: "grid", rows: 4, cols: 8, types: ["ghost", "gunner"], speed: 1.05, fireRate: 1.1 },
  ], { hazard: "debris", hint: "ゴーストは一瞬透明化して弾をすり抜ける" }),
  stage("爆撃圏", "ice", [
    { formation: "arc", rows: 3, cols: 8, types: ["bomber", "glider"], fireRate: 1.1 },
    { formation: "grid", rows: 4, cols: 8, types: ["bomber", "gunner", "scout"], fireRate: 1.15 },
  ], { hint: "ボマーの爆弾は着弾時に破片が散る" }),
  stage("分裂体", "toxic", [
    { formation: "ring", rows: 3, cols: 8, types: ["splitter"], speed: 1.05 },
    { formation: "grid", rows: 4, cols: 8, types: ["splitter", "glider", "gunner"] },
  ], { hazard: "nebula", hint: "スプリッタは倒すと小型機に分裂する" }),
  stage("要塞前線", "toxic", [
    { formation: "checker", rows: 4, cols: 8, types: ["turret", "glider"], fireRate: 1.2 },
    { formation: "grid", rows: 4, cols: 8, types: ["turret", "tank", "gunner"], speed: 0.9 },
  ], { hint: "タレットは高速レーザーを撃つ。遮蔽を意識して" }),
  stage("多頭艦襲来", "toxic", [
    { formation: "grid", rows: 3, cols: 8, types: ["gunner", "splitter"], speed: 1.05 },
  ], { boss: "hydra", itemChance: 0.3, hint: "3つの頭を個別に破壊できる" }),

  stage("溶融帯", "magma", [
    { formation: "vshape", rows: 4, cols: 8, types: ["elite", "glider"], speed: 1.1, diveRate: 1.2 },
    { formation: "grid", rows: 4, cols: 9, types: ["elite", "gunner", "bomber"], fireRate: 1.15 },
  ], { hazard: "meteor", hint: "エリートは拡散弾を撒きながら突撃する" }),
  stage("鉄壁陣", "magma", [
    { formation: "grid", rows: 4, cols: 8, types: ["tank", "healer", "gunner"], speed: 0.85 },
    { formation: "wedge", rows: 4, cols: 8, types: ["tank", "turret"], speed: 0.9, fireRate: 1.2 },
  ], { hint: "ヒーラーが仲間を回復する。先に潰せ" }),
  stage("機雷原", "void", [
    { formation: "scatter", rows: 4, cols: 9, types: ["mine", "scout"], speed: 1.15 },
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

  // ---- ここから追加ステージ（31〜45）。強化の伸びに合わせて手数と密度を上げる ----
  stage("残響領域", "nebula", [
    { formation: "ring", rows: 4, cols: 10, types: ["ghost", "splitter", "gunner"], speed: 1.2 },
    { formation: "checker", rows: 5, cols: 10, types: ["ghost", "elite", "turret"], fireRate: 1.4 },
  ], { hazard: "nebula", hint: "視界が悪い。弾筋を覚えて動け" }),
  stage("鉄壁小隊", "cyber", [
    { formation: "wedge", rows: 4, cols: 10, types: ["tank", "turret"], speed: 0.95, fireRate: 1.35 },
    { formation: "grid", rows: 5, cols: 10, types: ["tank", "healer", "elite"], speed: 1 },
  ], { hint: "ヒーラーを先に落とさないと硬さが戻る" }),
  stage("流星雨", "magma", [
    { formation: "scatter", rows: 5, cols: 10, types: ["kamikaze", "mine"], speed: 1.4, diveRate: 1.9 },
    { formation: "arc", rows: 4, cols: 10, types: ["bomber", "kamikaze", "elite"], diveRate: 1.7 },
  ], { hazard: "meteor", itemChance: 0.2, hint: "突撃と落石が同時に来る。下がりすぎるな" }),
  stage("凍てつく罠", "ice", [
    { formation: "cross", rows: 5, cols: 10, types: ["mine", "turret", "ghost"], speed: 1.15 },
    { formation: "diamond", rows: 5, cols: 10, types: ["tank", "gunner", "splitter"], fireRate: 1.4 },
  ], { hazard: "debris", hint: "機雷を先に処理して退路を作れ" }),
  stage("再来する母艦", "space", [
    { formation: "grid", rows: 3, cols: 10, types: ["elite", "gunner"], speed: 1.25 },
  ], { boss: "carrier", itemChance: 0.36, hint: "初戦より砲門が増えている" }),

  stage("汚染前線", "toxic", [
    { formation: "columns", rows: 5, cols: 10, types: ["splitter", "bomber", "gunner"], fireRate: 1.4 },
    { formation: "ring", rows: 5, cols: 10, types: ["splitter", "healer", "elite"], speed: 1.25 },
  ], { hazard: "nebula", hint: "分裂前に一掃できる武装が有利" }),
  stage("軌道要塞", "cyber", [
    { formation: "checker", rows: 5, cols: 10, types: ["turret", "tank", "elite"], fireRate: 1.45 },
    { formation: "grid", rows: 5, cols: 10, types: ["turret", "gunner", "bomber"], fireRate: 1.5 },
  ], { hazard: "laserGrid", hint: "砲台の斉射に合わせて左右へ抜ける" }),
  stage("極光の壁", "ice", [
    { formation: "arc", rows: 5, cols: 10, types: ["ghost", "elite", "tank"], speed: 1.3 },
    { formation: "vshape", rows: 5, cols: 10, types: ["ghost", "kamikaze", "turret"], diveRate: 1.7 },
  ], { hazard: "solarWind", hint: "押し流される方向を計算に入れて避ける" }),
  stage("熱核炉心", "magma", [
    { formation: "diamond", rows: 5, cols: 10, types: ["bomber", "tank", "elite"], fireRate: 1.5 },
    { formation: "scatter", rows: 5, cols: 10, types: ["mine", "kamikaze", "splitter"], speed: 1.4 },
  ], { hazard: "meteor", hint: "爆風の範囲は見た目より広い" }),
  stage("双牙・再戦", "cyber", [
    { formation: "wedge", rows: 3, cols: 10, types: ["elite", "turret", "tank"], speed: 1.3 },
  ], { boss: "twinFang", itemChance: 0.36, hint: "片方を残すと反撃が激化する" }),

  stage("虚無の淵", "void", [
    { formation: "ring", rows: 5, cols: 10, types: ["ghost", "elite", "mine"], speed: 1.35 },
    { formation: "cross", rows: 5, cols: 10, types: ["ghost", "splitter", "turret"], fireRate: 1.5 },
  ], { hazard: "nebula", hint: "透過する敵は撃てる瞬間が限られる" }),
  stage("殲滅包囲", "sunrise", [
    { formation: "ring", rows: 5, cols: 10, types: ["elite", "gunner", "bomber"], fireRate: 1.5 },
    { formation: "grid", rows: 5, cols: 10, types: ["tank", "elite", "healer", "turret"], speed: 1.2 },
  ], { hazard: "solarWind", hint: "囲まれる前に一角を崩せ" }),
  stage("超高速戦", "cyber", [
    { formation: "wedge", rows: 5, cols: 10, types: ["kamikaze", "elite"], speed: 1.5, diveRate: 2 },
    { formation: "scatter", rows: 5, cols: 10, types: ["kamikaze", "splitter", "gunner"], speed: 1.45 },
  ], { hint: "スピードを上げていないと振り切られる" }),
  stage("最終防衛線", "space", [
    { formation: "grid", rows: 5, cols: 10, types: ["tank", "turret", "elite", "healer"], fireRate: 1.5 },
    { formation: "diamond", rows: 5, cols: 10, types: ["bomber", "ghost", "splitter"], speed: 1.35 },
    { formation: "arc", rows: 4, cols: 10, types: ["kamikaze", "mine", "elite"], diveRate: 1.9 },
  ], { hazard: "laserGrid", itemChance: 0.24, hint: "ここを抜ければ最後の敵だ" }),
  stage("超越体・完全", "void", [
    { formation: "grid", rows: 3, cols: 10, types: ["elite", "tank", "turret", "ghost"], speed: 1.35 },
  ], { boss: "overmind", itemChance: 0.42, hint: "全段階が強化されている。総力戦" }),
];

export const STAGE_COUNT = STAGES.length;

export const getStage = (index: number): StageDef =>
  STAGES[Math.max(0, Math.min(STAGES.length - 1, index - 1))];
