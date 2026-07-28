import type { Metadata } from "next";

import VersusMount from "@/components/versus/VersusMount";

export const metadata: Metadata = {
  title: "VERSUS BATTLE — INVADER ASSAULT",
  description:
    "上下に分かれた陣地で撃ち合う対戦モード。中立ゾーンの敵を倒すとアイテムが自陣に流れて強化される。",
};

export default function VersusPage() {
  return <VersusMount />;
}
