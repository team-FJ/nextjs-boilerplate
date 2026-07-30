/**
 * BLOCK RALLY の実ブラウザ検証。
 *
 *   npm run build && npm run breakout-browser
 *
 * ヘッドレスのシミュレーションは「エンジンが正しいか」しか見ていない。
 * キーボード → 入力層 → エンジンの配線が逆になっていても、試合は最後まで成立してしまう。
 * ここではキャンバスの画素を読んで **押した向きに動くか** を実際に確かめる。
 */

import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

/**
 * この環境では Chromium が事前に入っている（PLAYWRIGHT_BROWSERS_PATH）。
 * playwright install は走らせず、置いてある実行ファイルを探して使う。
 */
function findChromium() {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers";
  if (!existsSync(root)) return undefined;
  for (const dir of readdirSync(root)) {
    if (!dir.startsWith("chromium")) continue;
    for (const name of ["chrome", "headless_shell"]) {
      const bin = join(root, dir, "chrome-linux", name);
      if (existsSync(bin)) return bin;
    }
  }
  return undefined;
}

const PORT = process.env.PORT ?? "3111";
const BASE = `http://127.0.0.1:${PORT}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForServer(timeoutMs = 60000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      const res = await fetch(BASE, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return true;
    } catch {
      /* まだ立ち上がっていない */
    }
    await sleep(500);
  }
  return false;
}

/**
 * キャンバスの画素からパドルの中心 x を測る（パドルは下端近くの横長の水色の帯）。
 *
 * evaluate には**文字列ではなく関数**を渡すこと。文字列は式として評価されるだけで、
 * 関数リテラルを渡しても呼ばれずに undefined が返ってくる。
 */
function measurePaddle() {
  const canvas = document.querySelector("canvas");
  if (!canvas) return null;
  const ctx = canvas.getContext("2d");
  const row = 660; // SOLO_PADDLE_Y
  const data = ctx.getImageData(0, row - 4, canvas.width, 9).data;
  let sum = 0;
  let count = 0;
  for (let y = 0; y < 9; y++) {
    for (let x = 0; x < canvas.width; x++) {
      const i = (y * canvas.width + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      // パドルは水色（#5ad2ff 系）
      if (b > 150 && g > 120 && r < 160) {
        sum += x;
        count++;
      }
    }
  }
  return count > 8 ? sum / count : null;
}

/** 技のラベル（SMASH / CURVE / VOLLEY）がパドルの上に出たかを白画素の数で見る */
function measureLabel() {
  const canvas = document.querySelector("canvas");
  if (!canvas) return 0;
  const ctx = canvas.getContext("2d");
  const data = ctx.getImageData(0, 660 - 34, canvas.width, 24).data;
  let white = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] > 230 && data[i + 1] > 230 && data[i + 2] > 230) white++;
  }
  return white;
}

const fmt = (v) => (typeof v === "number" ? v.toFixed(0) : "-");

// 全体の見張り。どこかで固まっても必ず結果を出して終わる
const watchdog = setTimeout(() => {
  console.log("NG   タイムアウト（180秒）");
  process.exit(1);
}, 180_000);

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? "OK  " : "NG  "} ${name}${detail ? `  — ${detail}` : ""}`);
}

const server = spawn("npx", ["next", "start", "-p", PORT], {
  stdio: "ignore",
  env: { ...process.env },
});

try {
  if (!(await waitForServer())) throw new Error("サーバーが起動しなかった");

  const browser = await chromium.launch({ executablePath: findChromium() });
  const page = await browser.newPage({ viewport: { width: 480, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });

  page.setDefaultTimeout(15_000);
  await page.goto(`${BASE}/breakout`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "1人で遊ぶ" }).click();
  await page.getByRole("button", { name: "1", exact: true }).click();
  await page.waitForSelector("canvas");
  await sleep(1200);

  const start = await page.evaluate(measurePaddle);
  check("キャンバスにパドルが描かれている", typeof start === "number", `x=${fmt(start)}`);

  // 左を押したら左へ動く
  await page.keyboard.down("ArrowLeft");
  await sleep(400);
  await page.keyboard.up("ArrowLeft");
  await sleep(120);
  const afterLeft = await page.evaluate(measurePaddle);
  check(
    "左キーで左へ動く",
    typeof start === "number" && typeof afterLeft === "number" && afterLeft < start - 30,
    `${fmt(start)} → ${fmt(afterLeft)}`,
  );

  // 右を押したら右へ動く
  await page.keyboard.down("ArrowRight");
  await sleep(600);
  await page.keyboard.up("ArrowRight");
  await sleep(120);
  const afterRight = await page.evaluate(measurePaddle);
  check(
    "右キーで右へ動く",
    typeof afterLeft === "number" && typeof afterRight === "number" && afterRight > afterLeft + 30,
    `${fmt(afterLeft)} → ${fmt(afterRight)}`,
  );

  // 上＋ショットで技が成立する（ラベルがパドルの上に出る）
  let labelSeen = 0;
  for (let i = 0; i < 120 && labelSeen === 0; i++) {
    await page.keyboard.down("ArrowUp");
    await page.keyboard.down("Space");
    await sleep(30);
    await page.keyboard.up("Space");
    await page.keyboard.up("ArrowUp");
    labelSeen = await page.evaluate(measureLabel);
    if (!(labelSeen > 20)) labelSeen = 0;
  }
  check("上＋ショットで技のラベルが出る", labelSeen > 0, `白画素 ${labelSeen}`);

  check("JavaScript エラーが出ていない", errors.length === 0, errors.slice(0, 2).join(" / "));

  await browser.close();
} catch (e) {
  check("実行", false, `${e}\n${e?.stack ?? ""}`);
} finally {
  server.kill("SIGTERM");
  clearTimeout(watchdog);
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} / ${results.length} 件が成功`);
if (failed.length > 0) process.exitCode = 1;
