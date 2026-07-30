import type { SfxName } from "../game/audio";
import type { GameEvent } from "./types";

export { AudioEngine, SilentAudio, type GameAudio } from "../game/audio";

/**
 * ゲームイベントを効果音へ対応づける。
 *
 * エンジンは音を鳴らさずイベントを積むだけなので、鳴らすかどうかはここから先の都合。
 * サーバー側やテストでは SilentAudio を差し込めば、同じエンジンをそのまま動かせる。
 */
export function sfxFor(e: GameEvent): { name: SfxName; pitch?: number; throttle?: number } | null {
  switch (e.type) {
    case "blockHit":
      return { name: "hit", pitch: 1.1, throttle: 20 };
    case "blockBreak":
      return { name: "explode", pitch: e.kind === "tough" ? 0.8 : 1.2, throttle: 20 };
    case "paddleHit":
      return { name: "shot", pitch: 0.9, throttle: 20 };
    case "wall":
      return { name: "hit", pitch: 0.75, throttle: 40 };
    case "skill":
      switch (e.kind) {
        case "smash":
          return { name: "rail", pitch: 1.1 };
        case "curve":
          return { name: "wave", pitch: 1.3 };
        case "lob":
          return { name: "missile", pitch: 0.9 };
        case "fail":
          return { name: "cancel", pitch: 0.8 };
      }
      return null;
    case "item":
      return { name: "powerup" };
    case "laser":
      return { name: "laser", throttle: 60 };
    case "chain":
      return { name: "extend", pitch: 1 + e.count * 0.08 };
    case "score":
      return { name: "confirm" };
    case "miss":
      return { name: "damage" };
    case "stageClear":
      return { name: "stageClear" };
    case "gameOver":
      return { name: "gameOver" };
  }
}
