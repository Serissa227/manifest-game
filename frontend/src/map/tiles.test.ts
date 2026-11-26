// 大地图的两种画面（FRAMEWORK §5.4）：按字节计量的 LRU 缓存、视野里的瓦片（跨缝、最后一块不满、裁剪）、
// 瓦片的最近邻放大与迷雾、世界图的 2×2 缩小、内存上限。
import { describe, expect, it } from "vitest";
import { Px } from "../art/px";
import type { RgbaImage } from "./chartWork";
import {
  downsample,
  isBigMap,
  LruCache,
  MEMORY_BUDGET,
  memoryBudget,
  NAV_CELL_PX,
  NAV_TILE,
  parseTileKey,
  tileCounts,
  tileImage,
  tileKey,
  visibleTiles,
  worldScaleOf,
} from "./tiles";

/** 每格 basePx 像素的“海图”：格 (x, y) 的颜色编码在 R、G 里（便于检查取样）。 */
function fakeChart(W: number, H: number, basePx = 4): RgbaImage {
  const w = W * basePx;
  const h = H * basePx;
  const data = new Uint8ClampedArray(new ArrayBuffer(w * h * 4));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      data[i] = Math.floor(x / basePx) % 256;
      data[i + 1] = Math.floor(y / basePx) % 256;
      data[i + 2] = (x % basePx) * 16 + (y % basePx);
      data[i + 3] = 255;
    }
  }
  return { x: 0, y: 0, w, h, data };
}
const px = (img: RgbaImage, x: number, y: number) => Array.from(img.data.slice((y * img.w + x) * 4, (y * img.w + x) * 4 + 4));

describe("LRU 缓存（按字节）", () => {
  it("超过上限时从最久没用的开始淘汰；get 让项变新；替换与删除调用 onEvict", () => {
    const evicted: string[] = [];
    const lru = new LruCache<number>(100, (v) => v, (k) => evicted.push(k));
    lru.set("a", 40);
    lru.set("b", 40);
    expect(lru.bytes).toBe(80);
    lru.get("a"); // a 变新
    lru.set("c", 40); // 超了：淘汰最久没用的 b
    expect(lru.keys()).toEqual(["a", "c"]);
    expect(evicted).toEqual(["b"]);
    expect(lru.bytes).toBe(80);
    lru.set("a", 10); // 替换
    expect(lru.bytes).toBe(50);
    expect(evicted).toEqual(["b", "a"]);
    expect(lru.peek("c")).toBe(40);
    // 单项超过上限也留下（至少留刚放进去的）
    lru.set("huge", 500);
    expect(lru.keys()).toEqual(["huge"]);
    expect(lru.bytes).toBe(500);
    expect(lru.dropWhere((k) => k === "huge")).toBe(1);
    expect(lru.size).toBe(0);
    expect(lru.bytes).toBe(0);
  });

  it("瓦片的键往返；内存上限：桌面 200 MB、手机 120 MB", () => {
    expect(parseTileKey(tileKey(3, 16, 6))).toEqual({ season: 3, tx: 16, ty: 6 });
    expect(parseTileKey("x")).toBeNull();
    expect(MEMORY_BUDGET.desktop).toBe(200 * 1024 * 1024);
    expect(MEMORY_BUDGET.mobile).toBe(120 * 1024 * 1024);
    expect(memoryBudget(false)).toBe(MEMORY_BUDGET.desktop);
    expect(memoryBudget(true)).toBe(MEMORY_BUDGET.mobile);
  });

  it("大地图的判定：经典世界 400 × 170 不受影响，1080 × 396 的世界图每格 2 像素", () => {
    expect(isBigMap(400, 170)).toBe(false);
    expect(worldScaleOf(400, 170)).toBe(1);
    expect(isBigMap(1080, 396)).toBe(true);
    expect(worldScaleOf(1080, 396)).toBe(2);
  });
});

describe("视野里的瓦片", () => {
  it("1080 格宽：17 块，最后一块只有 56 格", () => {
    expect(tileCounts(1080, 396)).toEqual({ nx: 17, ny: 7 });
  });

  it("视野跨过东西接缝时，两侧各取各的瓦片（横向展开，最后一块不满也能接上），由近到远", () => {
    // 中心在 (5, 100)，视野 600 × 300 像素、每格 12 像素：左右各 25 格
    const slots = visibleTiles(5, 100, 600, 300, NAV_CELL_PX, 1080, 396, true);
    const xs = slots.map((s) => `${s.tx}@${s.x}`).sort();
    // 西侧是第 16 块（1024–1079，展开后在 −56 处），东侧是第 0 块
    expect(xs).toContain("16@-56");
    expect(xs).toContain("0@0");
    expect(slots.every((s) => s.tx >= 0 && s.tx < 17)).toBe(true);
    // 纵向：100 ± 12.5 格都在第 1 块
    expect(new Set(slots.map((s) => s.ty))).toEqual(new Set([1]));
    // 最近的排在前面
    expect(slots[0]).toMatchObject({ tx: 0, ty: 1 });
  });

  it("不环绕时裁到图内；图外为空", () => {
    const slots = visibleTiles(2, 100, 600, 300, NAV_CELL_PX, 400, 170, false);
    expect(slots.map((s) => s.tx)).toEqual([0]);
    expect(visibleTiles(-500, 100, 600, 300, NAV_CELL_PX, 400, 170, false)).toEqual([]);
    expect(visibleTiles(10, -500, 600, 300, NAV_CELL_PX, 400, 170, false)).toEqual([]);
  });
});

describe("瓦片与世界图", () => {
  const W = 130;
  const H = 70;
  const base = fakeChart(W, H);

  it("瓦片：64 × 64 格、每格 12 像素，最近邻放大（每个源像素放大 3 倍）", () => {
    const tile = tileImage(base, 4, null, W, H, false, 1, 0);
    expect([tile.x, tile.y, tile.w, tile.h]).toEqual([64 * 12, 0, 64 * 12, 64 * 12]);
    // 瓦片里第 (5, 7) 格的左上角像素 → 源图第 (69, 7) 格
    expect(px(tile, 5 * 12, 7 * 12).slice(0, 2)).toEqual([69, 7]);
    // 每个源像素放大成 3 × 3：格内第 3–5 个像素对应源格内第 1 个像素，第 9–11 行对应第 3 行
    expect(px(tile, 5 * 12 + 4, 7 * 12)[2]).toBe(16);
    expect(px(tile, 5 * 12 + 3, 7 * 12 + 11)[2]).toBe(16 + 3);
    expect(px(tile, 5 * 12 + 2, 7 * 12 + 8)[2]).toBe(0 + 2);
  });

  it("最后一块不满：按实际的格数", () => {
    const tile = tileImage(base, 4, null, W, H, false, 2, 1);
    expect([tile.w, tile.h]).toEqual([(W - 128) * 12, (H - 64) * 12]);
  });

  it("环绕地图：瓦片横向取模（源图读不出界）", () => {
    // 第 2 块覆盖 128–191，环绕时 130 以后回到 0
    const tile = tileImage(base, 4, null, W, H, true, 2, 0);
    expect(tile.w).toBe((W - 128) * 12);
    expect(px(tile, 0, 0).slice(0, 2)).toEqual([128, 0]);
    expect(px(tile, 12, 0).slice(0, 2)).toEqual([129, 0]);
  });

  it("迷雾：未探明的格盖上羊皮纸，已揭开的格保持原样，交界处有过渡", () => {
    const revealed = new Uint8Array(W * H);
    // 左半边（x < 32）揭开
    for (let y = 0; y < H; y++) for (let x = 0; x < 32; x++) revealed[y * W + x] = 1;
    const tile = tileImage(base, 4, revealed, W, H, false, 0, 0);
    const plain = tileImage(base, 4, null, W, H, false, 0, 0);
    // 远离交界的已揭开处与原图相同
    expect(px(tile, 5 * 12, 5 * 12)).toEqual(px(plain, 5 * 12, 5 * 12));
    // 远离交界的未探明处是羊皮纸色（不再是原图）
    const fogged = px(tile, 50 * 12 + 1, 30 * 12 + 1);
    expect(fogged).not.toEqual(px(plain, 50 * 12 + 1, 30 * 12 + 1));
    expect(fogged[3]).toBe(255);
    // 交界一带（第 31–32 格）有的像素盖上、有的没盖（抖动过渡）
    let covered = 0;
    let open = 0;
    for (let x = 31 * 12; x < 33 * 12; x++) {
      const same = px(tile, x, 30 * 12).join() === px(plain, x, 30 * 12).join();
      if (same) open++;
      else covered++;
    }
    expect(covered).toBeGreaterThan(0);
    expect(open).toBeGreaterThan(0);
  });

  it("世界图 2×2 取平均缩小；坐标与尺寸一起缩小，透明处不把颜色拉灰", () => {
    const img: RgbaImage = { x: 4, y: 2, w: 4, h: 2, data: new Uint8ClampedArray(new ArrayBuffer(4 * 2 * 4)) };
    // 左 2×2 全是 (100, 0, 0)；右 2×2 一半透明、一半 (0, 200, 0)
    for (let y = 0; y < 2; y++)
      for (let x = 0; x < 4; x++) {
        const i = (y * 4 + x) * 4;
        if (x < 2) img.data.set([100, 0, 0, 255], i);
        else if (y === 0) img.data.set([0, 200, 0, 255], i);
      }
    const d = downsample(img, 2);
    expect([d.x, d.y, d.w, d.h]).toEqual([2, 1, 2, 1]);
    expect(Array.from(d.data.slice(0, 4))).toEqual([100, 0, 0, 255]);
    expect(Array.from(d.data.slice(4, 8))).toEqual([0, 200, 0, 128]);
    expect(downsample(img, 1)).toBe(img);
  });

  it("整图给像素缓冲 Px（经典世界记忆化缓存里的海图，不另拷一份）与给 RGBA 字节切出的瓦片逐字节相同，含迷雾与环绕", () => {
    const px = new Px(W * 4, H * 4);
    for (let i = 0; i < px.data.length; i++) px.data[i] = (Math.imul(i, 2654435761) | 0xff) >>> 0;
    const bytes: RgbaImage = { x: 0, y: 0, w: px.w, h: px.h, data: new Uint8ClampedArray(px.toRGBA()) };
    const revealed = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) revealed[y * W + x] = (x * 7 + y * 3) % 11 < 6 ? 1 : 0;
    for (const [tx, ty, wrap] of [
      [0, 0, false],
      [1, 1, false],
      [2, 0, true],
    ] as const) {
      const a = tileImage(px, 4, revealed, W, H, wrap, tx, ty);
      const b = tileImage(bytes, 4, revealed, W, H, wrap, tx, ty);
      expect([a.x, a.y, a.w, a.h]).toEqual([b.x, b.y, b.w, b.h]);
      expect(a.data.every((v, i) => v === b.data[i])).toBe(true);
    }
  });

  it("瓦片的边长常量与契约一致：64 格、每格不少于 12 像素", () => {
    expect(NAV_TILE).toBe(64);
    expect(NAV_CELL_PX).toBeGreaterThanOrEqual(12);
  });
});
