import type { NextConfig } from "next";

/**
 * STATIC_EXPORT=1 のときは、サーバー無しで動く静的ファイル一式を書き出す
 * （GitHub Pages などへの配置用）。通常のビルドでは何も変わらない。
 *
 * PAGES_BASE_PATH には、サブディレクトリ配信のときのパスを入れる
 * 例）https://team-fj.github.io/nextjs-boilerplate/ → /nextjs-boilerplate
 */
const staticExport = process.env.STATIC_EXPORT === "1";
const basePath = process.env.PAGES_BASE_PATH || "";

const nextConfig: NextConfig = staticExport
  ? {
      output: "export",
      basePath: basePath || undefined,
      assetPrefix: basePath || undefined,
      trailingSlash: true,
      images: { unoptimized: true },
    }
  : {};

export default nextConfig;
