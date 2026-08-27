/**
 * 静的書き出し（out/）を、GitHub Pages と同じ形で手元に配る簡易サーバー。
 *
 *   npm run build:static
 *   npm run serve:static
 *   → http://127.0.0.1:4321/nextjs-boilerplate/route/
 *
 * Pages はリポジトリ名のサブディレクトリで配信されるため、
 * basePath を付けた状態で開かないと「手元では動くのに公開したら壊れる」を見逃す。
 */

import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  args.set(process.argv[i].replace(/^--/, ""), process.argv[i + 1]);
}

const dir = resolve(args.get("dir") ?? "out");
const base = (args.get("base") ?? process.env.PAGES_BASE_PATH ?? "").replace(/\/$/, "");
const port = Number(args.get("port") ?? process.env.PORT ?? 4321);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

/** URL のパス → 実ファイル。ディレクトリなら index.html を返す。 */
function resolveFile(urlPath) {
  let p = decodeURIComponent(urlPath.split("?")[0]);
  if (base && p.startsWith(base)) p = p.slice(base.length);
  if (p === "") p = "/";
  // 上位ディレクトリへ抜ける指定は受け付けない。
  const safe = normalize(p).replace(/^(\.\.[/\\])+/, "");
  const full = join(dir, safe);
  if (existsSync(full) && statSync(full).isDirectory()) {
    const index = join(full, "index.html");
    return existsSync(index) ? index : null;
  }
  if (existsSync(full) && statSync(full).isFile()) return full;
  // trailingSlash: true の書き出しなので、/route でも /route/index.html を返す。
  const asDir = join(full, "index.html");
  if (existsSync(asDir)) return asDir;
  const asHtml = `${full}.html`;
  return existsSync(asHtml) ? asHtml : null;
}

const server = createServer((req, res) => {
  if (base && !req.url.startsWith(base)) {
    // Pages と同じく、basePath の外は存在しない。
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end(`このサーバーは ${base}/ 以下だけを配信します`);
    return;
  }
  const file = resolveFile(req.url);
  if (!file) {
    const notFound = join(dir, "404.html");
    if (existsSync(notFound)) {
      res.writeHead(404, { "content-type": TYPES[".html"] });
      createReadStream(notFound).pipe(res);
      return;
    }
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("not found");
    return;
  }
  res.writeHead(200, {
    "content-type": TYPES[extname(file)] ?? "application/octet-stream",
    "cache-control": "no-store",
  });
  createReadStream(file).pipe(res);
});

server.listen(port, "127.0.0.1", () => {
  console.log(`静的書き出しを配信中: http://127.0.0.1:${port}${base}/`);
  console.log(`  避難ルート検索: http://127.0.0.1:${port}${base}/route/`);
});
