import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import BreakoutGame from "@/components/breakout/BreakoutGame";
import OnlineGame from "@/components/breakout/OnlineGame";

type Screen = "game" | "online";

/**
 * SPIN RALLY の単体HTML版。
 *
 * INVADER の単体版と違い、**通信対戦もそのまま入れられる**。
 * 進行役の端末のブラウザが権威サーバーを兼ねる作りなので、置き場所（サーバー）が要らない。
 */
function Standalone() {
  const [screen, setScreen] = useState<Screen>(
    typeof location !== "undefined" && location.hash === "#online" ? "online" : "game",
  );

  // 単体HTML版はページ遷移できないので、ページ間リンクを内部の切り替えに変換する
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const anchor = (e.target as HTMLElement | null)?.closest?.("a[href]");
      if (!anchor) return;
      const href = anchor.getAttribute("href");
      if (href !== "/breakout" && href !== "/breakout/online") return;
      e.preventDefault();
      e.stopPropagation();
      setScreen(href === "/breakout/online" ? "online" : "game");
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  return screen === "online" ? <OnlineGame /> : <BreakoutGame />;
}

// 単体HTML版は viewport メタタグが無いとスマホで 980px 幅として描画されてしまうため、
// 起動時に自分で入れる（既にあれば上書きしない）
function ensureViewportMeta() {
  if (document.querySelector('meta[name="viewport"]')) return;
  const meta = document.createElement("meta");
  meta.name = "viewport";
  meta.content = "width=device-width, initial-scale=1, viewport-fit=cover";
  document.head.appendChild(meta);
}
ensureViewportMeta();

const el = document.getElementById("game-root");
if (el) {
  // 起動できたので、読み込み中の案内文を消す
  document.getElementById("boot-message")?.remove();
  createRoot(el).render(<Standalone />);
}
