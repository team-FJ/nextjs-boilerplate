import type { Metadata } from "next";
import DiagnosePanel from "@/components/route/DiagnosePanel";

export const metadata: Metadata = {
  title: "データ取得の診断 — 避難ルート検索",
  description:
    "避難ルート検索が使う外部データ（OpenStreetMap・国土地理院の標高タイル・ハザードマップ）に、この端末から実際につながるかを確かめます。",
};

export default function RouteCheckPage() {
  return <DiagnosePanel />;
}
