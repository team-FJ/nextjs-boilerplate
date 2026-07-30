import type { Metadata } from "next";

import OnlineMount from "@/components/breakout/OnlineMount";

export const metadata: Metadata = {
  title: "BLOCK RALLY 通信対戦",
  description: "部屋コードで2台をつないで遊ぶ。進行役の端末がゲームサーバーを兼ねる。",
};

export default function BreakoutOnlinePage() {
  return <OnlineMount />;
}
