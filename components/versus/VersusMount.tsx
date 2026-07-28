"use client";

import dynamic from "next/dynamic";

// Canvas / WebAudio に依存するためクライアント専用で読み込む
const VersusGame = dynamic(() => import("./VersusGame"), {
  ssr: false,
  loading: () => (
    <div className="flex min-h-dvh w-full items-center justify-center bg-[#05060c] font-mono text-xs tracking-widest text-rose-300/70">
      LOADING VERSUS BATTLE...
    </div>
  ),
});

export default function VersusMount() {
  return <VersusGame />;
}
