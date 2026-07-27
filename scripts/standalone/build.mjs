/**
 * 1ファイルの HTML にまとめた配布用ビルド。
 *
 * サーバーを用意できない環境（スマホしか無い、社内に置き場所が無い等）でも
 * ファイルを開くだけで遊べるようにするためのもの。通信対戦はサーバーが要るので
 * 単体版では導線ごと隠し、1人用と1台対戦だけを収録する。
 *
 *   npm run standalone   →  dist/invader-assault.html
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
  join(here, "entry.tsx"),
  "--bundle",
  "--format=iife",
  "--minify",
  "--target=es2020",
  '--define:process.env.NODE_ENV="production"',
  // 通信対戦はサーバーが必要なので、単体版では導線を出さない
  '--define:process.env.NEXT_PUBLIC_ONLINE_VERSUS="off"',
  "--define:process.env.NEXT_PUBLIC_VERSUS_SERVER=undefined",
  `--alias:@=${root}`,
  `--alias:next/link=${join(here, "stub-link.tsx")}`,
  `--outfile=${join(dist, "bundle.js")}`,
  "--log-level=warning",
]);

console.log("CSS を生成しています…");
run("npx", [
  "@tailwindcss/cli",
  "-i",
  join(here, "tailwind.css"),
  "-o",
  join(dist, "style.css"),
  "--minify",
]);

const js = readFileSync(join(dist, "bundle.js"), "utf8");
const css = readFileSync(join(dist, "style.css"), "utf8");
if (js.toLowerCase().includes("</script")) {
  throw new Error("バンドルに </script> が含まれています（インライン化できません）");
}

const html = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>INVADER ASSAULT</title>
<style>
${css}
html, body { background: #05060c; margin: 0; overscroll-behavior: none; -webkit-text-size-adjust: 100%; }
#game-root { min-height: 100dvh; }
</style>
</head>
<body>
<div id="game-root"></div>
<script>
${js}
</script>
</body>
</html>
`;

const out = join(dist, "invader-assault.html");
writeFileSync(out, html);
console.log(`完成: ${out} (${(html.length / 1024).toFixed(0)} KB)`);

// Artifact など、head/body を用意してくれる配信先へ渡す用の断片。
// viewport メタタグは実行時に entry.tsx が挿入するので、ここでは中身だけを書き出す。
const fragment = `<title>INVADER ASSAULT</title>
<style>
${css}
html, body { background: #05060c; margin: 0; overscroll-behavior: none; -webkit-text-size-adjust: 100%; }
#game-root { min-height: 100dvh; }
</style>
<div id="game-root"></div>
<script>
${js}
</script>
`;
const fragmentOut = join(dist, "invader-assault.fragment.html");
writeFileSync(fragmentOut, fragment);
console.log(`完成: ${fragmentOut} (${(fragment.length / 1024).toFixed(0)} KB)`);
