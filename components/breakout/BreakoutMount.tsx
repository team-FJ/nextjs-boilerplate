"use client";

import dynamic from "next/dynamic";

// Canvas / localStorage / WebAudio に依存するためクライアント専用で読み込む
const BreakoutGame = dynamic(() => import("./BreakoutGame"), {
  ssr: false,
  loading: () => (
    <div className="flex min-h-dvh w-full items-center justify-center bg-[#05060c] font-mono text-xs tracking-widest text-cyan-300/70">
      LOADING BLOCK RALLY...
    </div>
  ),
});

export default function BreakoutMount() {
  return <BreakoutGame />;
}
