"use client";

import { useCallback } from "react";

import { TouchPad as SharedTouchPad, type PadAction } from "@/components/shared/TouchPad";
import type { VersusInput } from "@/lib/versus/input";
import type { PlayerId } from "@/lib/versus/types";

/**
 * 共通の操作パッドを対戦モードの入力に繋ぐ。
 * ショットボタンの外周はエネルギー残量を示すので、
 * 「あと何発撃てるか」を画面下だけ見て把握できる。
 */
export function TouchPad({
  input,
  player = 1,
  energyRatio = 1,
  bombs = 0,
  onFullscreen,
}: {
  input: VersusInput;
  player?: PlayerId;
  energyRatio?: number;
  bombs?: number;
  onFullscreen?: () => void;
}) {
  const onAction = useCallback(
    (action: PadAction, pressed: boolean) => input.setVirtual(player, action, pressed),
    [input, player],
  );

  return (
    <SharedTouchPad
      onAction={onAction}
      gauge={energyRatio}
      bombs={bombs}
      onFullscreen={onFullscreen}
    />
  );
}
