"use client";

import dynamic from "next/dynamic";

// Leaflet は window に触るのでクライアント専用で読み込む。
const RouteApp = dynamic(() => import("./RouteApp"), {
  ssr: false,
  loading: () => (
    <div className="flex min-h-dvh w-full items-center justify-center text-sm text-slate-500">
      地図を読み込んでいます…
    </div>
  ),
});

export default function RouteMount() {
  return <RouteApp />;
}
