/**
 * SPIN RALLY を 1ファイルの HTML にまとめる。
 *
 *   npm run spin-rally-standalone   →  dist/spin-rally.html
 *
 * ファイルを開くだけで遊べる。**通信対戦もそのまま入っている**——
 * 進行役の端末のブラウザが権威サーバーを兼ねる作りなので、置き場所が要らない。
 * （INVADER の単体版はサーバー経由の通信を前提にしていたため導線ごと隠している）
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const dist = join(root, "dist");
mkdirSync(dist, { recursive: true });

const run = (command, args) =>
  execFileSync(command, args, { cwd: root, stdio: ["ignore", "pipe", "inherit"] });

console.log("JS をバンドルしています…");
run("npx", [
  "esbuild",
  join(here, "spin-rally-entry.tsx"),
  "--bundle",
  "--format=iife",
  "--minify",
  "--target=es2020",
  '--define:process.env.NODE_ENV="production"',
  `--alias:@=${root}`,
  `--alias:next/link=${join(here, "stub-link.tsx")}`,
  `--outfile=${join(dist, "spin-rally-bundle.js")}`,
  "--log-level=warning",
]);

console.log("CSS を生成しています…");
run("npx", [
  "@tailwindcss/cli",
  "-i",
  join(here, "tailwind.css"),
  "-o",
  join(dist, "spin-rally-style.css"),
  "--minify",
]);

const js = readFileSync(join(dist, "spin-rally-bundle.js"), "utf8");
const css = readFileSync(join(dist, "spin-rally-style.css"), "utf8");
if (js.toLowerCase().includes("</script")) {
  throw new Error("バンドルに </script> が含まれています（インライン化できません）");
}

const head = `<title>SPIN RALLY</title>
<style>
${css}
html, body { background: #05060c; margin: 0; overscroll-behavior: none; -webkit-text-size-adjust: 100%; }
#game-root { min-height: 100dvh; }
</style>`;

const html = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
${head}
</head>
<body>
<div id="game-root"></div>
<script>
${js}
</script>
</body>
</html>
`;

const out = join(dist, "spin-rally.html");
writeFileSync(out, html);
console.log(`完成: ${out} (${(html.length / 1024).toFixed(0)} KB)`);
