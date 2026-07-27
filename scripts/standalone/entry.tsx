import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import InvaderGame from "@/components/game/InvaderGame";
import VersusGame from "@/components/versus/VersusGame";

type Mode = "campaign" | "versus";

function Standalone() {
  const [mode, setMode] = useState<Mode>(
    typeof location !== "undefined" && location.hash === "#versus" ? "versus" : "campaign",
  );

  // 単体HTML版ではページ遷移できないので、モード間リンクを内部切り替えに変換する
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const anchor = (e.target as HTMLElement | null)?.closest?.("a[href]");
      if (!anchor) return;
      const href = anchor.getAttribute("href");
      if (href !== "/" && href !== "/versus") return;
      e.preventDefault();
      e.stopPropagation();
      setMode(href === "/versus" ? "versus" : "campaign");
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  return mode === "versus" ? <VersusGame /> : <InvaderGame />;
}

// 単体HTML版は viewport メタタグが無いとスマホで 980px 幅として描画されてしまうため、
// 起動時に自分で入れる（既にあれば上書きしない）
function ensureViewportMeta() {
  const existing = document.querySelector('meta[name="viewport"]');
  if (existing) return;
  const meta = document.createElement("meta");
  meta.name = "viewport";
  meta.content = "width=device-width, initial-scale=1, viewport-fit=cover";
  document.head.appendChild(meta);
}
ensureViewportMeta();

const el = document.getElementById("game-root");
if (el) createRoot(el).render(<Standalone />);
