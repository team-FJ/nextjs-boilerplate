import { DEFAULT_SETTINGS } from "./constants";
import type { Progress, Settings } from "./types";

const SETTINGS_KEY = "spinrally.settings.v1";
const PROGRESS_KEY = "spinrally.progress.v1";

export const DEFAULT_PROGRESS: Progress = {
  unlockedStage: 1,
  clearedStages: [],
  highScores: {},
  bestChain: 0,
  playCount: 0,
};

function read<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return { ...fallback };
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return { ...fallback };
    return { ...fallback, ...(JSON.parse(raw) as Partial<T>) };
  } catch {
    return { ...fallback };
  }
}

function write(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ストレージが使えない環境では黙って無視する */
  }
}

export const loadSettings = () => read<Settings>(SETTINGS_KEY, DEFAULT_SETTINGS);
export const saveSettings = (s: Settings) => write(SETTINGS_KEY, s);
export const loadProgress = () => read<Progress>(PROGRESS_KEY, DEFAULT_PROGRESS);
export const saveProgress = (p: Progress) => write(PROGRESS_KEY, p);

export function recordStageClear(stage: number, score: number, chain: number): Progress {
  const p = loadProgress();
  const next: Progress = {
    ...p,
    unlockedStage: Math.max(p.unlockedStage, stage + 1),
    clearedStages: p.clearedStages.includes(stage) ? p.clearedStages : [...p.clearedStages, stage],
    highScores: { ...p.highScores, [stage]: Math.max(p.highScores[stage] ?? 0, score) },
    bestChain: Math.max(p.bestChain, chain),
  };
  saveProgress(next);
  return next;
}

export function recordPlay(): Progress {
  const p = loadProgress();
  const next = { ...p, playCount: p.playCount + 1 };
  saveProgress(next);
  return next;
}
