import type { Metadata } from "next";

import BreakoutMount from "@/components/breakout/BreakoutMount";

export const metadata: Metadata = {
  title: "SPIN RALLY",
  description: "押すだけでスマッシュ・横でカーブ・下でボレー。1人／協力／対戦のブロック崩し。",
};

export default function BreakoutPage() {
  return <BreakoutMount />;
}
