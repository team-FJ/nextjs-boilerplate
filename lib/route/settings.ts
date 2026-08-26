/**
 * 画面の設定値。localStorage に残して、次に開いたときも同じ条件で使えるようにする。
 */

import type { CostOptions } from "./astar";
import type { ProfileId } from "./profiles";

export interface RouteSettings {
  profileId: ProfileId;
  /** これ未満の標高の道は通らない[m]。 */
  minElevation: number;
  safetyMargin: number;
  highGroundBias: number;
  climbPenaltyPerM: number;
  avoidUnderground: boolean;
  avoidSteps: boolean;
  allowUnknownElevation: boolean;
  highPrecisionDem: boolean;
  baseLayerId: string;
  overlayIds: string[];
  overlayOpacity: number;
  showShortest: boolean;
}

export const DEFAULT_SETTINGS: RouteSettings = {
  profileId: "foot",
  minElevation: 10,
  safetyMargin: 5,
  highGroundBias: 2,
  climbPenaltyPerM: 4,
  avoidUnderground: true,
  avoidSteps: false,
  allowUnknownElevation: false,
  highPrecisionDem: false,
  baseLayerId: "pale",
  overlayIds: [],
  overlayOpacity: 0.55,
  showShortest: true,
};

/** 想定する災害ごとの目安。数字はあくまで出発点で、地域の想定に合わせて直して使う。 */
export interface Preset {
  id: string;
  label: string;
  description: string;
  minElevation: number;
  safetyMargin: number;
}

export const PRESETS: Preset[] = [
  {
    id: "tsunami20",
    label: "津波（20m）",
    description: "南海トラフ級の想定浸水深に備える場合の目安。",
    minElevation: 20,
    safetyMargin: 10,
  },
  {
    id: "tsunami10",
    label: "津波（10m）",
    description: "沿岸部の津波避難ビル相当の高さ。",
    minElevation: 10,
    safetyMargin: 5,
  },
  {
    id: "flood5",
    label: "洪水・高潮（5m）",
    description: "河川氾濫や内水氾濫で低地が水没する想定。",
    minElevation: 5,
    safetyMargin: 3,
  },
  {
    id: "flood2",
    label: "内水氾濫（2m）",
    description: "アンダーパスや窪地だけを避けたい場合。",
    minElevation: 2,
    safetyMargin: 2,
  },
];

export function toCostOptions(s: RouteSettings): CostOptions {
  return {
    minElevation: s.minElevation,
    safetyMargin: s.safetyMargin,
    highGroundBias: s.highGroundBias,
    climbPenaltyPerM: s.climbPenaltyPerM,
    avoidUnderground: s.avoidUnderground,
    avoidSteps: s.avoidSteps,
    allowUnknownElevation: s.allowUnknownElevation,
  };
}

const KEY = "disaster-route-settings-v1";

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
