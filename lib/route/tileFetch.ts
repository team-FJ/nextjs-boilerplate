/**
 * ラスタタイルを RGBA バイト列として読む共通処理。
 *
 * 標高タイル（PNG に標高を埋め込んだもの）と
 * ハザードマップタイル（凡例の色で浸水深を表したもの）で同じ経路を使う。
 * 取得方法を差し替えられるようにしてあるので、Node 上のテストでは合成タイルを流し込める。
 */

export const TILE_SIZE = 256;

/** タイル 1 枚を RGBA（幅 x 高さ x 4）で返す。データが無ければ null。 */
export type RgbaLoader = (url: string) => Promise<Uint8ClampedArray | null>;

/** ブラウザ用。CORS が効いた画像を canvas 経由で画素として読み出す。 */
export function createBrowserRgbaLoader(signal?: AbortSignal): RgbaLoader {
  return async (url) => {
    const res = await fetch(url, { signal, mode: "cors" });
    // 海域・整備範囲外は 404 が返る。エラーではなく「データなし」として扱う。
    if (!res.ok) return null;
    const blob = await res.blob();
    const bitmap = await createImageBitmap(blob);
    try {
      const canvas =
        typeof OffscreenCanvas !== "undefined"
          ? new OffscreenCanvas(bitmap.width, bitmap.height)
          : Object.assign(document.createElement("canvas"), {
              width: bitmap.width,
              height: bitmap.height,
            });
      const ctx = (canvas as HTMLCanvasElement).getContext("2d", {
        willReadFrequently: true,
      });
      if (!ctx) return null;
      ctx.drawImage(bitmap as CanvasImageSource, 0, 0);
      return ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
    } finally {
      bitmap.close();
    }
  };
}

/** 同時実行数を抑えて配列を処理する（配信サーバーに負荷をかけないため）。 */
export async function runPool<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor];
      cursor += 1;
      await fn(item);
    }
  });
  await Promise.all(workers);
}
