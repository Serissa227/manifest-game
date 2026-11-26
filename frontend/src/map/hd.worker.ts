// 高清海图瓦片的后台线程（H10c）：每个线程各持一份海图输入与画具，按主线程派来的请求一块一块地画，
// 画好的位图能转成 ImageBitmap 就转（主线程直接贴，不必再 putImageData），转不了就把 RGBA 字节转交回去。
// 由 hdTiles.ts 的线程池创建；出错时回复 error，线程池随即改在主线程空闲时画。
import type { ChartInput } from "../art/map";
import { hdContext, paintHdTile, type HdContext } from "../art/map/hd";
import type { HdWorkerRequest, HdWorkerResponse } from "./hdTiles";

const scope = self as unknown as {
  onmessage: ((e: MessageEvent<HdWorkerRequest>) => void) | null;
  postMessage: (message: HdWorkerResponse, transfer: Transferable[]) => void;
};

let ctx: HdContext | null = null;
let input: ChartInput | null = null;

/** RGBA → ImageBitmap（没有 OffscreenCanvas 时为 null）。 */
function bitmapOf(w: number, h: number, data: Uint8ClampedArray<ArrayBuffer>): ImageBitmap | null {
  if (typeof OffscreenCanvas === "undefined" || w === 0 || h === 0) return null;
  try {
    const c = new OffscreenCanvas(w, h);
    const g = c.getContext("2d");
    if (!g) return null;
    g.putImageData(new ImageData(data, w, h), 0, 0);
    return c.transferToImageBitmap();
  } catch {
    return null;
  }
}

scope.onmessage = (e) => {
  const m = e.data;
  try {
    if (m.kind === "init") {
      input = m.input;
      ctx = hdContext(m.input);
      // 预热：先画一块低清的（日本一带，有海有陆：建噪声表、让引擎把热循环编译好），真正的第一块不再多等几百毫秒
      if (ctx) paintHdTile(ctx, 1, Math.min(118, Math.floor(m.input.width / 8) - 1), Math.min(14, Math.floor(m.input.height / 8) - 1), 1);
      return;
    }
    if (!input) throw new Error("hd worker: missing input");
    if (!ctx) {
      scope.postMessage({ kind: "tile", key: m.key, img: null, bitmap: null, ms: 0 }, []);
      return;
    }
    const at = performance.now();
    const img = paintHdTile(ctx, m.season, m.tx, m.ty, m.k);
    const ms = performance.now() - at;
    const bitmap = bitmapOf(img.w, img.h, img.data);
    if (bitmap) scope.postMessage({ kind: "tile", key: m.key, img: { x: img.x, y: img.y, w: img.w, h: img.h, data: null }, bitmap, ms }, [bitmap]);
    else scope.postMessage({ kind: "tile", key: m.key, img, bitmap: null, ms }, [img.data.buffer]);
  } catch (err) {
    scope.postMessage({ kind: "error", key: m.kind === "tile" ? m.key : undefined, message: err instanceof Error ? err.message : String(err) }, []);
  }
};
