// 把像素缓冲贴到浏览器画布上。测试环境（jsdom）没有 2D 画布：所有函数都静默跳过。
import { Px } from "./px";

let support: boolean | null = null;

/** 当前环境能否使用 2D 画布。 */
export function canDraw(): boolean {
  if (support === null) {
    try {
      support = typeof document !== "undefined" && !!document.createElement("canvas").getContext("2d");
    } catch {
      support = false;
    }
  }
  return support;
}

/** 每张画布上一次用的 ImageData：按帧重画的画布（港口街景、航行小画面）尺寸不变时接着用，不必每帧分配两份整图大小的缓冲。 */
const frames = new WeakMap<HTMLCanvasElement, ImageData>();

/** 把图画到画布上（画布的像素尺寸会被设成图的尺寸）；成功返回 true。 */
export function paint(canvas: HTMLCanvasElement, px: Px): boolean {
  if (!canDraw()) return false;
  const ctx = canvas.getContext("2d");
  if (!ctx) return false;
  if (canvas.width !== px.w) canvas.width = px.w;
  if (canvas.height !== px.h) canvas.height = px.h;
  let img = frames.get(canvas);
  if (!img || img.width !== px.w || img.height !== px.h) {
    img = ctx.createImageData(px.w, px.h);
    frames.set(canvas, img);
  }
  // 每个像素都写一遍（透明的写 0），上一帧不会留下残影
  px.writeRGBA(img.data);
  ctx.putImageData(img, 0, 0);
  return true;
}

/** 生成一个画好的离屏画布（给 PixiJS 纹理、CSS 背景等使用）。 */
export function toCanvas(px: Px): HTMLCanvasElement | null {
  if (!canDraw()) return null;
  const c = document.createElement("canvas");
  return paint(c, px) ? c : null;
}

const urls = new Map<string, string>();

/** 转成 data: URL（带缓存；用于 CSS border-image、背景图等）。不支持画布时返回 null。 */
export function toDataURL(px: Px, key?: string): string | null {
  if (key) {
    const hit = urls.get(key);
    if (hit) return hit;
  }
  const c = toCanvas(px);
  if (!c) return null;
  const url = c.toDataURL("image/png");
  if (key) urls.set(key, url);
  return url;
}

const cache = new Map<string, Px>();
const CACHE_LIMIT = 800;
const MiB = 1024 * 1024;
/**
 * 单张达到这么多字节的图算大对象（整张海图、迷雾的云团毯、大幅场景……），与小图分开记账（性能商议 2026-10-07 第 5 条）：
 * 以前只按条目数（800）淘汰，一张 1080 × 396 的海图每格 4 像素就有 26 MiB，几张整图就能把内存撑到几百 MB。
 */
export const MEMO_LARGE_BYTES = 2 * MiB;
/** 缺省的上限：大对象合计 64 MiB；小图合计 96 MiB（另有 800 条的条目数上限，与以前相同）。 */
export const MEMO_BUDGET = { large: 64 * MiB, small: 96 * MiB } as const;
const budget = { large: MEMO_BUDGET.large, small: MEMO_BUDGET.small };
const large = new Map<string, Px>();
let smallBytes = 0;
let largeBytes = 0;

const bytesOf = (px: Px) => px.data.byteLength;

/** 从最久没用的开始淘汰，直到合计不超过上限（至少留下刚放进去的 keep）。 */
function evict(map: Map<string, Px>, over: () => boolean, keep: string, onDrop: (px: Px) => void) {
  for (const [k, v] of map) {
    if (!over() || map.size <= 1) break;
    if (k === keep) continue;
    map.delete(k);
    onDrop(v);
  }
}

/**
 * 记忆化：同一个 key 只生成一次图（程序化美术较费时）。按字节记账：小图超过 800 条或合计超过上限、
 * 大对象（单张 ≥ MEMO_LARGE_BYTES）合计超过上限时，从最久没用的开始淘汰。
 */
export function memo(key: string, make: () => Px): Px {
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const big = large.get(key);
  if (big) {
    large.delete(key);
    large.set(key, big);
    return big;
  }
  const px = make();
  const bytes = bytesOf(px);
  if (bytes >= MEMO_LARGE_BYTES) {
    large.set(key, px);
    largeBytes += bytes;
    evict(large, () => largeBytes > budget.large, key, (v) => (largeBytes -= bytesOf(v)));
  } else {
    cache.set(key, px);
    smallBytes += bytes;
    evict(cache, () => cache.size > CACHE_LIMIT || smallBytes > budget.small, key, (v) => (smallBytes -= bytesOf(v)));
  }
  return px;
}

/** 记忆化缓存的账：条目数与字节（小图、大对象分开）。 */
export function memoStats(): { entries: number; smallBytes: number; largeEntries: number; largeBytes: number } {
  return { entries: cache.size, smallBytes, largeEntries: large.size, largeBytes };
}

/** key 满足条件的条目合计的字节（内存账本只记某张地图的海图与云团毯时用）。 */
export function memoBytes(pred: (key: string) => boolean): number {
  let n = 0;
  for (const map of [cache, large]) for (const [k, v] of map) if (pred(k)) n += bytesOf(v);
  return n;
}

/** 丢掉 key 满足条件的条目（离开世界、换季时释放不再用的整图）；返回丢掉的字节数。 */
export function forgetMemo(pred: (key: string) => boolean): number {
  let freed = 0;
  for (const [map, sub] of [
    [cache, (b: number) => (smallBytes -= b)],
    [large, (b: number) => (largeBytes -= b)],
  ] as const) {
    for (const [k, v] of [...map]) {
      if (!pred(k)) continue;
      map.delete(k);
      sub(bytesOf(v));
      freed += bytesOf(v);
    }
  }
  return freed;
}

/** 调整上限（测试用）；不给的项恢复缺省。 */
export function setMemoBudget(b: { large?: number; small?: number } = {}): void {
  budget.large = b.large ?? MEMO_BUDGET.large;
  budget.small = b.small ?? MEMO_BUDGET.small;
}
