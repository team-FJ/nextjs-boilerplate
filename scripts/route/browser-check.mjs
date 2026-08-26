/**
 * 高台ルート検索の実ブラウザ検証。
 *
 *   npm run build && npm run route-browser
 *
 * オフラインの自己テスト（npm run route-selftest）は探索ロジックしか見ていない。
 * 実際には「標高 PNG を canvas で読む」「Overpass の応答を組み立てる」「React の配線」
 * のどれが壊れても地図には何も出ない。
 *
 * そこで外部サービス（Overpass / 国土地理院）を合成データで差し替え、
 * 画面に出た数字が本当に条件を満たしているかをブラウザ上で確かめる。
 */

import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { chromium } from "playwright";

// ------------------------------------------------------------ 合成の地形と街
// scripts/route/selftest.ts と同じ地形。中央の南寄りだけが低地（2m）。

const LAT0 = 35.0;
const LON0 = 139.0;
const ROWS = 21;
const COLS = 21;
const STEP_LAT = 0.0009;
const STEP_LON = 0.0011;
const LOW_LON_MIN = LON0 + STEP_LON * 8;
const LOW_LON_MAX = LON0 + STEP_LON * 12;
const LOW_LAT_MAX = LAT0 + STEP_LAT * 8;

const START = { lat: LAT0, lon: LON0 };
const GOAL = { lat: LAT0, lon: LON0 + STEP_LON * (COLS - 1) };

const terrain = (lat, lon) =>
  lon > LOW_LON_MIN && lon < LOW_LON_MAX && lat < LOW_LAT_MAX ? 2 : 25;

const tileXToLon = (x, z) => (x / 2 ** z) * 360 - 180;
const tileYToLat = (y, z) => {
  const n = Math.PI - 2 * Math.PI * (y / 2 ** z);
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
};

function gridWays(bbox) {
  const inside = (p) =>
    !bbox ||
    (p.lat >= bbox.south && p.lat <= bbox.north && p.lon >= bbox.west && p.lon <= bbox.east);
  const elements = [];
  let id = 1;
  const push = (geometry) => {
    // Overpass と同じく、範囲内の連続部分だけを返す。
    let run = [];
    const flush = () => {
      if (run.length >= 2) {
        elements.push({ type: "way", id: id++, tags: { highway: "residential" }, geometry: run });
      }
      run = [];
    };
    for (const p of geometry) {
      if (inside(p)) run.push(p);
      else flush();
    }
    flush();
  };
  for (let r = 0; r < ROWS; r += 1) {
    push(Array.from({ length: COLS }, (_, c) => ({
      lat: LAT0 + r * STEP_LAT,
      lon: LON0 + c * STEP_LON,
    })));
  }
  for (let c = 0; c < COLS; c += 1) {
    push(Array.from({ length: ROWS }, (_, r) => ({
      lat: LAT0 + r * STEP_LAT,
      lon: LON0 + c * STEP_LON,
    })));
  }
  return { version: 0.6, elements };
}

// ------------------------------------------------------------------ PNG 出力
// 標高タイルは PNG なので、依存を増やさずここで最小限のエンコーダを持つ。

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/**
 * 8bit の PNG を作る。channels が 3 なら RGB、4 なら RGBA。
 * ハザードマップのタイルは「区域外は透明」なのでアルファが要る。
 */
function encodePng(width, height, pixels, channels = 3) {
  const stride = width * channels;
  const raw = Buffer.alloc(height * (1 + stride));
  for (let y = 0; y < height; y += 1) {
    raw[y * (1 + stride)] = 0; // フィルタ None
    pixels.copy(raw, y * (1 + stride) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = channels === 4 ? 6 : 2; // color type: truecolor / truecolor+alpha
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const SIZE = 256;
function demTilePng(z, tx, ty) {
  const pixels = Buffer.alloc(SIZE * SIZE * 3);
  for (let iy = 0; iy < SIZE; iy += 1) {
    const lat = tileYToLat(ty + (iy + 0.5) / SIZE, z);
    for (let ix = 0; ix < SIZE; ix += 1) {
      const lon = tileXToLon(tx + (ix + 0.5) / SIZE, z);
      const v = Math.round(terrain(lat, lon) * 100);
      const p = (iy * SIZE + ix) * 3;
      pixels[p] = (v >> 16) & 0xff;
      pixels[p + 1] = (v >> 8) & 0xff;
      pixels[p + 2] = v & 0xff;
    }
  }
  return encodePng(SIZE, SIZE, pixels);
}

/** 低地の帯を「洪水浸水想定区域（3〜5m）」として塗ったタイル。区域外は透明。 */
const FLOOD_COLOR = [255, 183, 183];
function hazardTilePng(z, tx, ty) {
  const pixels = Buffer.alloc(SIZE * SIZE * 4);
  for (let iy = 0; iy < SIZE; iy += 1) {
    const lat = tileYToLat(ty + (iy + 0.5) / SIZE, z);
    for (let ix = 0; ix < SIZE; ix += 1) {
      const lon = tileXToLon(tx + (ix + 0.5) / SIZE, z);
      const p = (iy * SIZE + ix) * 4;
      if (terrain(lat, lon) < 10) {
        pixels[p] = FLOOD_COLOR[0];
        pixels[p + 1] = FLOOD_COLOR[1];
        pixels[p + 2] = FLOOD_COLOR[2];
        pixels[p + 3] = 255;
      }
    }
  }
  return encodePng(SIZE, SIZE, pixels, 4);
}

// -------------------------------------------------------------------- 実行部

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

/** 空いているポートを OS に選ばせる（前回の残骸と衝突しないように）。 */
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(String(port)));
    });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let PORT = process.env.PORT ?? "";
let BASE = "";

async function waitForServer(timeoutMs = 90000) {
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

let failures = 0;
function check(label, ok, detail = "") {
  if (!ok) failures += 1;
  console.log(`${ok ? "  ok" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
}

const CORS = { "access-control-allow-origin": "*" };

async function main() {
  PORT = PORT || (await freePort());
  BASE = `http://127.0.0.1:${PORT}`;

  // next start は子プロセスを持つので、プロセスグループごと終了させる。
  const server = spawn("npx", ["next", "start", "-p", PORT], {
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
    detached: true,
  });
  server.stdout.on("data", () => {});
  server.stderr.on("data", (d) => process.stderr.write(d));

  let browser;
  try {
    if (!(await waitForServer())) throw new Error("サーバーが起動しませんでした");

    browser = await chromium.launch({ executablePath: findChromium() });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => {
      // 背景地図などをわざと 404 にしているので、読み込み失敗そのものは無視する。
      const text = m.text();
      if (m.type() === "error" && !text.includes("Failed to load resource")) {
        errors.push(text);
      }
    });

    // --- 外部サービスの差し替え ---------------------------------------
    let demRequests = 0;
    let hazardRequests = 0;

    await page.route("**/api/interpreter", async (route) => {
      const body = route.request().postData() ?? "";
      const m = decodeURIComponent(body).match(
        /\(\s*(-?[\d.]+),(-?[\d.]+),(-?[\d.]+),(-?[\d.]+)\s*\)/,
      );
      const bbox = m
        ? { south: +m[1], west: +m[2], north: +m[3], east: +m[4] }
        : null;
      await route.fulfill({
        status: 200,
        headers: { ...CORS, "content-type": "application/json" },
        body: JSON.stringify(gridWays(bbox)),
      });
    });

    // 背景地図・ハザードは空の応答で十分（描画には要らない）。
    // Playwright は後から登録したものが優先されるので、
    // まとめて 404 にする指定を先に、標高タイルの差し替えを後に置く。
    await page.route("**/cyberjapandata.gsi.go.jp/xyz/**", (route) =>
      route.fulfill({ status: 404, headers: CORS, body: "" }),
    );
    await page.route("**/disaportaldata.gsi.go.jp/**", (route) =>
      route.fulfill({ status: 404, headers: CORS, body: "" }),
    );

    await page.route("**/01_flood_l2_shinsuishin_data/**", async (route) => {
      const m = route.request().url().match(/\/(\d+)\/(\d+)\/(\d+)\.png$/);
      if (!m) return route.fulfill({ status: 404, headers: CORS, body: "" });
      // ズーム 14 だけ用意する（別のズームを読みにきたら未整備扱いになる）。
      if (Number(m[1]) !== 14) {
        return route.fulfill({ status: 404, headers: CORS, body: "" });
      }
      hazardRequests += 1;
      await route.fulfill({
        status: 200,
        headers: { ...CORS, "content-type": "image/png" },
        body: hazardTilePng(+m[1], +m[2], +m[3]),
      });
    });

    await page.route("**/dem_png/**", async (route) => {
      const m = route.request().url().match(/\/(\d+)\/(\d+)\/(\d+)\.png$/);
      if (!m) return route.fulfill({ status: 404, headers: CORS, body: "" });
      demRequests += 1;
      await route.fulfill({
        status: 200,
        headers: { ...CORS, "content-type": "image/png" },
        body: demTilePng(+m[1], +m[2], +m[3]),
      });
    });

    await page.route("**/address-search/**", async (route) => {
      const q = new URL(route.request().url()).searchParams.get("q") ?? "";
      const p = q.includes("ゴール") ? GOAL : START;
      await route.fulfill({
        status: 200,
        headers: { ...CORS, "content-type": "application/json" },
        body: JSON.stringify([
          { geometry: { coordinates: [p.lon, p.lat] }, properties: { title: q } },
        ]),
      });
    });

    // --- 画面操作 ------------------------------------------------------
    await page.goto(`${BASE}/route`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".leaflet-container", { timeout: 30000 });
    check("地図が描画される", true);

    const setPoint = async (testId, query) => {
      const row = page.getByTestId(testId);
      const box = row.getByPlaceholder("住所・地名で探す");
      await box.fill(query);
      await box.press("Enter");
      await row.getByRole("button", { name: query }).click();
    };
    await setPoint("point-start", "スタート地点");
    await setPoint("point-goal", "ゴール地点");

    const startText = await page.getByTestId("point-start").innerText();
    const goalText = await page.getByTestId("point-goal").innerText();
    check("出発地の座標が反映される", startText.includes("35.00000"), startText.replace(/\n/g, " | "));
    check("目的地の座標が反映される", goalText.includes("139.02200"), goalText.replace(/\n/g, " | "));

    const readStat = async (label) =>
      (await page.locator(`[data-stat="${label}"] dd`).innerText()).trim();

    const search = async () => {
      await page.getByRole("button", { name: "ルートを探す" }).click();
      try {
        await page.waitForSelector("text=標高の断面と浸水想定", { timeout: 60000 });
      } catch (e) {
        console.log("--- 画面の内容 ---");
        console.log((await page.locator("aside").innerText()).slice(0, 2000));
        throw e;
      }
    };

    // --- 1回目: 既定のハザードマップ判定 --------------------------------
    await search();

    check("ハザードマップを読みに行っている", hazardRequests > 0, `${hazardRequests} 枚`);
    check("標高タイルも読みに行っている", demRequests > 0, `${demRequests} 枚`);

    const depth = await readStat("最大想定浸水深");
    check("浸水想定区域を通らない結果になる", depth === "浸水想定なし", depth);

    const distance = await readStat("距離");
    check(
      "区域を迂回したぶん直線より長い",
      distance.includes("km") && parseFloat(distance) > 2.2,
      `距離 ${distance}`,
    );

    const comparison = await page.locator("text=/最短ルートは浸水想定区域を/").count();
    check("最短ルートが区域を通ることを示す", comparison > 0);

    const polylines = await page.locator(".leaflet-overlay-pane path").count();
    check("経路が地図に描かれる", polylines >= 2, `${polylines} 本`);

    // --- 2回目: 標高だけで判断する目安に切り替える ----------------------
    await page.getByRole("button", { name: "標高だけで判断" }).click();
    const eleInput = page.locator('input[type="number"]');
    check("標高の入力欄が現れる", (await eleInput.count()) === 1);
    await eleInput.fill("10");
    await eleInput.blur();
    await search();

    const minEle = parseFloat(await readStat("最低標高"));
    check(
      "画面に出た最低標高が条件を満たす",
      minEle >= 10,
      `最低標高 ${minEle}m（指定 10m）`,
    );
    const threshold = await page.locator("text=通らない標高 10m").count();
    check("断面図にしきい値の線が出る", threshold > 0);

    // --- 3回目: 浅い浸水は許容して、断面図の帯が出ることを確かめる --------
    await page.getByRole("button", { name: "洪水（想定最大規模）" }).click();
    await page.getByTestId("depth-5").check();
    await search();

    const throughDepth = await readStat("最大想定浸水深");
    check("許容すれば区域内を通る", throughDepth === "5m 未満", throughDepth);
    const bands = await page.locator('svg rect[fill="#FFB7B7"]').count();
    check("断面図に想定浸水深の帯が出る", bands > 0, `${bands} 区間`);

    // 結果は設定欄の下に積まれるので、自動で見える位置まで送られるはず。
    await page.waitForTimeout(1000);
    const scrollTop = await page.locator("aside").evaluate((el) => el.scrollTop);
    check("結果が見える位置まで自動で送られる", scrollTop > 100, `scrollTop=${scrollTop}`);

    check("JavaScript エラーが出ていない", errors.length === 0, errors[0] ?? "");

    if (process.env.ROUTE_SHOT) {
      await page.screenshot({ path: process.env.ROUTE_SHOT, fullPage: false });
      console.log(`スクリーンショット: ${process.env.ROUTE_SHOT}`);
    }

    console.log(`\n${failures === 0 ? "すべて通過" : `${failures} 件が失敗`}`);
  } finally {
    await browser?.close();
    server.kill("SIGTERM");
  }
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
