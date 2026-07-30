"use client";

import dynamic from "next/dynamic";

// Canvas / WebRTC / WebAudio に依存するためクライアント専用で読み込む
const OnlineGame = dynamic(() => import("./OnlineGame"), {
  ssr: false,
  loading: () => (
    <div className="flex min-h-dvh w-full items-center justify-center bg-[#05060c] font-mono text-xs tracking-widest text-cyan-300/70">
      LOADING...
    </div>
  ),
});

export default function OnlineMount() {
  return <OnlineGame />;
}
