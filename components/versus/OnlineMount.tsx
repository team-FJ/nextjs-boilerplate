"use client";

import dynamic from "next/dynamic";

const OnlineVersusGame = dynamic(() => import("./OnlineVersusGame"), {
  ssr: false,
  loading: () => (
    <div className="flex min-h-dvh w-full items-center justify-center bg-[#05060c] font-mono text-xs tracking-widest text-cyan-300/70">
      CONNECTING...
    </div>
  ),
});

export default function OnlineMount() {
  return <OnlineVersusGame />;
}
