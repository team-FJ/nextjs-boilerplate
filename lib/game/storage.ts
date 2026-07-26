import { DEFAULT_SETTINGS } from "./constants";
import type { Progress, Settings } from "./types";

const SETTINGS_KEY = "invader.settings.v1";
const PROGRESS_KEY = "invader.progress.v1";

export const DEFAULT_PROGRESS: Progress = {
  unlockedStage: 1,
  clearedStages: [],
  highScores: {},
  bestTotalScore: 0,
  bestCombo: 0,
  playCount: 0,
};

export function loadSettings(): Settings {
  if (typeof window === "undefined") return { ...DEFAULT_SETTINGS };
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: Settings) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* ストレージ不可の環境では黙って無視 */
  }
}

export function loadProgress(): Progress {
  if (typeof window === "undefined") return { ...DEFAULT_PROGRESS };
  try {
    const raw = window.localStorage.getItem(PROGRESS_KEY);
    if (!raw) return { ...DEFAULT_PROGRESS };
    const parsed = JSON.parse(raw) as Partial<Progress>;
    return {
      ...DEFAULT_PROGRESS,
      ...parsed,
      clearedStages: parsed.clearedStages ?? [],
      highScores: parsed.highScores ?? {},
    };
  } catch {
    return { ...DEFAULT_PROGRESS };
  }
}

export function saveProgress(progress: Progress) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress));
  } catch {
    /* noop */
  }
}

export function resetProgress(): Progress {
  const fresh = { ...DEFAULT_PROGRESS, clearedStages: [], highScores: {} };
  saveProgress(fresh);
  return fresh;
}
