/**
 * 画面の設定値。localStorage に残して、次に開いたときも同じ条件で使えるようにする。
 */

import type { CostOptions } from "./astar";
import type { ProfileId } from "./profiles";

export interface RouteSettings {
  profileId: ProfileId;

  // --- ハザードマップによる判定（主）---
  hazardEnabled: boolean;
  /** 使うハザードマップ（lib/route/hazard.ts の id）。 */
  hazardDatasetIds: string[];
  /** 想定浸水深がこれを超える道は通らない[m]。0 なら区域に一切入らない。 */
  hazardMaxDepth: number;
  hazardAvoidUnknownDepth: boolean;
  hazardAllowUnmapped: boolean;
  hazardAvoidZones: boolean;
  hazardBias: number;
  /** 判定する画素の半径。1 にすると周囲も見て安全側に倒す。 */
  hazardSampleRadius: number;

  // --- 標高による判定（従）---
  /** ハザードマップに加えて、標高でも足切りするか。 */
  elevationEnabled: boolean;
  /** これ未満の標高の道は通らない[m]。 */
  minElevation: number;
  safetyMargin: number;
  highGroundBias: number;
  climbPenaltyPerM: number;
  allowUnknownElevation: boolean;
  highPrecisionDem: boolean;

  // --- 共通 ---
  avoidUnderground: boolean;
  avoidSteps: boolean;

  // --- 表示 ---
  baseLayerId: string;
  overlayIds: string[];
  overlayOpacity: number;
  showShortest: boolean;
}

export const DEFAULT_SETTINGS: RouteSettings = {
  profileId: "foot",

  hazardEnabled: true,
  hazardDatasetIds: ["flood_l2", "tsunami"],
  hazardMaxDepth: 0,
  hazardAvoidUnknownDepth: true,
  hazardAllowUnmapped: true,
  hazardAvoidZones: true,
  hazardBias: 2,
  hazardSampleRadius: 1,

  elevationEnabled: false,
  minElevation: 10,
  safetyMargin: 5,
  highGroundBias: 2,
  climbPenaltyPerM: 4,
  allowUnknownElevation: true,
  highPrecisionDem: false,

  avoidUnderground: true,
  avoidSteps: false,

  baseLayerId: "pale",
  overlayIds: ["flood_l2"],
  overlayOpacity: 0.55,
  showShortest: true,
};

/**
 * 想定する災害ごとの目安。
 * ハザードマップは「想定浸水深」を持っているので、まずそれで足切りし、
 * 未整備の区域が残る場合に備えて標高の条件を足すかどうかを切り替える。
 */
export interface Preset {
  id: string;
  label: string;
  description: string;
  patch: Partial<RouteSettings>;
}

export const PRESETS: Preset[] = [
  {
    id: "tsunami",
    label: "津波",
    description:
      "津波浸水想定区域に入らない。区域図が無い場所に備えて標高 10m 以上も条件にする。",
    patch: {
      hazardEnabled: true,
      hazardDatasetIds: ["tsunami"],
      hazardMaxDepth: 0,
      overlayIds: ["tsunami"],
      elevationEnabled: true,
      minElevation: 10,
      safetyMargin: 5,
    },
  },
  {
    id: "flood",
    label: "洪水（想定最大規模）",
    description: "河川氾濫の浸水想定区域に入らない。",
    patch: {
      hazardEnabled: true,
      hazardDatasetIds: ["flood_l2"],
      hazardMaxDepth: 0,
      overlayIds: ["flood_l2"],
      elevationEnabled: false,
    },
  },
  {
    id: "flood_shallow",
    label: "洪水（浅い浸水は許容）",
    description:
      "浸水想定 0.5m 未満なら通る。区域を完全に避けると経路が無い場合に。",
    patch: {
      hazardEnabled: true,
      hazardDatasetIds: ["flood_l2"],
      hazardMaxDepth: 0.5,
      overlayIds: ["flood_l2"],
      elevationEnabled: false,
    },
  },
  {
    id: "all",
    label: "まとめて避ける",
    description: "洪水・津波・高潮・内水・土砂災害の警戒区域をすべて避ける。",
    patch: {
      hazardEnabled: true,
      hazardDatasetIds: [
        "flood_l2",
        "tsunami",
        "hightide",
        "naisui",
        "dosekiryu",
        "kyukeisha",
      ],
      hazardMaxDepth: 0,
      overlayIds: ["flood_l2", "tsunami"],
      elevationEnabled: false,
    },
  },
  {
    id: "elevation",
    label: "標高だけで判断",
    description:
      "ハザードマップを使わず、標高だけで足切りする。区域図が無い地域向け。",
    patch: {
      hazardEnabled: false,
      overlayIds: [],
      elevationEnabled: true,
      minElevation: 10,
      safetyMargin: 5,
    },
  },
];

export function toCostOptions(s: RouteSettings): CostOptions {
  return {
    // 標高の条件を切ってあるときは、どんな低地でも通れるようにしておく。
    minElevation: s.elevationEnabled ? s.minElevation : Number.NEGATIVE_INFINITY,
    safetyMargin: s.elevationEnabled ? s.safetyMargin : 0,
    highGroundBias: s.elevationEnabled ? s.highGroundBias : 0,
    climbPenaltyPerM: s.climbPenaltyPerM,
    avoidUnderground: s.avoidUnderground,
    avoidSteps: s.avoidSteps,
    allowUnknownElevation: s.elevationEnabled ? s.allowUnknownElevation : true,

    hazardEnabled: s.hazardEnabled && s.hazardDatasetIds.length > 0,
    hazardMaxDepth: s.hazardMaxDepth,
    hazardAvoidUnknownDepth: s.hazardAvoidUnknownDepth,
    hazardAllowUnmapped: s.hazardAllowUnmapped,
    hazardAvoidZones: s.hazardAvoidZones,
    hazardBias: s.hazardBias,
  };
}

/** どの条件も付けていない状態か（何も避けずに探すことになる）。 */
export function hasNoConstraint(s: RouteSettings): boolean {
  return !(s.hazardEnabled && s.hazardDatasetIds.length > 0) && !s.elevationEnabled;
}

const KEY = "disaster-route-settings-v2";

export function loadSettings(): RouteSettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<RouteSettings>;
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(s: RouteSettings) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // プライベートモードなどで保存できなくても、動作には影響しない。
  }
}
