import type { Metadata } from "next";
import RouteMount from "@/components/route/RouteMount";

export const metadata: Metadata = {
  title: "高台ルート検索 — 低い道を通らない災害時の避難経路",
  description:
    "指定した標高より低い道を一切通らずに、出発地から目的地までの経路を探します。道路データは OpenStreetMap、標高は国土地理院の標高タイルを使い、ブラウザだけで計算します。",
};

export default function RoutePage() {
  return <RouteMount />;
}
