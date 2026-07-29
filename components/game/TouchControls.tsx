"use client";

import { useCallback } from "react";

import { TouchPad, type PadAction } from "@/components/shared/TouchPad";
import type { InputManager } from "@/lib/game/input";

/**
 * 共通の操作パッドを1人用の入力に繋ぐ。
 *
 * 対戦モードと同じ「押した場所が原点になるスティック」方式。
 * ボムは対戦の special ボタンに割り当てる。
 * 1人用には撃つための残量という概念がないので、外周ゲージは出さない。
 */
export function TouchControls({ input, bombs = 0 }: { input: InputManager; bombs?: number }) {
  const onAction = useCallback(
    (action: PadAction, pressed: boolean) =>
      input.setVirtual(action === "special" ? "bomb" : action, pressed),
    [input],
  );

  return <TouchPad onAction={onAction} bombs={bombs} />;
}
