import type { Metadata } from "next";
import RouteMount from "@/components/route/RouteMount";

export const metadata: Metadata = {
  title: "避難ルート検索 — 浸水想定を通らない災害時の経路",
  description:
    "ハザードマップの想定浸水深を読み取り、浸水する想定の道を通らずに出発地から目的地までの経路を探します。道路データは OpenStreetMap、浸水想定はハザードマップポータルサイト、標高は国土地理院の標高タイルを使い、ブラウザだけで計算します。",
};

export default function RoutePage() {
  return <RouteMount />;
}
