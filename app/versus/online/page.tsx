import type { Metadata } from "next";

import OnlineMount from "@/components/versus/OnlineMount";

export const metadata: Metadata = {
  title: "オンライン対戦 — INVADER ASSAULT",
  description: "2台の端末で対戦する通信対戦モード。部屋コードかリンクを共有するだけで始められます。",
};

export default function OnlineVersusPage() {
  return <OnlineMount />;
}
