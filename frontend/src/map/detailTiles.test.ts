// 细节瓦片的后台绘制与调度（第九批 M01“细海图”）：地形与迷雾各一张——迷雾瓦片的画法、ChartWorkState 的两种瓦片、
// 调度（同一块在路上时不重复要、没有 Worker 时主线程后备）、共用后台线程的“有没有细节瓦片”，以及细图层的加载与缓存。
import { waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChartInput } from "../art/map";
import { synthFine } from "../art/map/fineSynth";
import { synthWorld } from "../art/map/synth";
import { P } from "../art/palette";
import { rgba } from "../art/px";
import { navApi } from "../ipc/api";
import { acquireChartHub } from "./chartHub";
import { createChartJobs } from "./chartJobs";
import { ChartWorkState, type RgbaImage } from "./chartWork";
import { cachedFineLayers, clearFineLayers, loadFineLayers } from "./fineLayers";
import { FogBits } from "./fogBits";
import { DETAIL_BUDGET, DETAIL_CELL_PX, DETAIL_TILE_CELLS, fogTileImage, tileImage } from "./tiles";

const W = 48;
const H = 40;
const base: ChartInput = { ...synthWorld(9, W, H).input, wrapX: true };
const withFine: ChartInput = { ...base, fine: synthFine(base) };

const alphaAt = (img: RgbaImage, x: number, y: number) => img.data[(y * img.w + x) * 4 + 3];
const colorAt = (img: RgbaImage, x: number, y: number) => {
  const o = (y * img.w + x) * 4;
  return ((img.data[o] << 24) | (img.data[o + 1] << 16) | (img.data[o + 2] << 8) | img.data[o + 3]) >>> 0;
};

/** 左半边（x < half）揭开的探索状态。 */
function revealedLeft(half: number): Uint8Array {
  const rev = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < half; x++) rev[y * W + x] = 1;
  return rev;
}

describe("迷雾瓦片", () => {
  it("常量：32 × 32 格一块、每格 24 像素；桌面的细节瓦片缓存约 512 MB", () => {
    expect([DETAIL_TILE_CELLS, DETAIL_CELL_PX]).toEqual([32, 24]);
    expect(DETAIL_BUDGET).toBe(512 * 1024 * 1024);
  });

  it("还没有迷雾（全部当作揭开）、或这一块连同四周两格都揭开了：不必贴图", () => {
    expect(fogTileImage(null, W, H, false, 0, 0)).toBeNull();
    expect(fogTileImage(new Uint8Array(W * H).fill(1), W, H, true, 0, 0)).toBeNull();
    // 不环绕：第 0 块盖 x 0–31，揭开到 x < 34 就没有迷雾；只揭开到 x < 33 时边上那一格的雾够得着
    expect(fogTileImage(revealedLeft(34), W, H, false, 0, 0)).toBeNull();
    expect(fogTileImage(revealedLeft(33), W, H, false, 0, 0)).not.toBeNull();
    // 图外的块
    expect(fogTileImage(revealedLeft(10), W, H, false, 5, 0)).toBeNull();
  });

  it("已揭开处透明、未探明处是不透明的羊皮纸，交界在格的边上抖动过渡；与旧瓦片盖的迷雾同一种画法", () => {
    const rev = revealedLeft(16);
    const img = fogTileImage(rev, W, H, false, 0, 0)!;
    expect([img.x, img.y, img.w, img.h]).toEqual([0, 0, 32 * 24, 32 * 24]);
    // 揭开的深处透明，未探明的深处是羊皮纸
    expect(alphaAt(img, 8 * 24, 10 * 24)).toBe(0);
    expect(alphaAt(img, 24 * 24, 10 * 24)).toBe(255);
    const parchment = [rgba(P.parchment), rgba(P.parchmentDark)];
    expect(parchment).toContain(colorAt(img, 24 * 24, 10 * 24));
    // 只有两种不透明度；交界一带（第 15–17 列的格）两种都有
    let clear = 0;
    let solid = 0;
    for (let x = 14 * 24; x < 18 * 24; x++) {
      const a = alphaAt(img, x, 12 * 24 + 5);
      expect([0, 255]).toContain(a);
      if (a === 0) clear++;
      else solid++;
    }
    expect(clear).toBeGreaterThan(10);
    expect(solid).toBeGreaterThan(10);
    // 与 tileImage 盖在海图上的迷雾逐像素同一处：在全透明的底图上盖一遍比较
    const blank = { x: 0, y: 0, w: W, h: H, data: new Uint8ClampedArray(new ArrayBuffer(W * H * 4)) };
    const baked = tileImage(blank, 1, rev, W, H, false, 0, 0, 32, 24);
    expect([baked.w, baked.h]).toEqual([img.w, img.h]);
    expect(baked.data.every((v, i) => v === img.data[i])).toBe(true);
    // 最后一块按实际的格数（横向 48 格：第 1 块 16 格宽、8 格高）
    const edge = fogTileImage(rev, W, H, false, 1, 1)!;
    expect([edge.x, edge.y, edge.w, edge.h]).toEqual([32 * 24, 32 * 24, 16 * 24, 8 * 24]);
  });
});

describe("后台线程的状态：细节瓦片与迷雾瓦片", () => {
  it("没有细图层的地图没有细节瓦片；有细图层时一块 768 × 768、不盖迷雾", () => {
    expect(new ChartWorkState(base, 1).detailTile(1, 0, 0)).toBeNull();
    const state = new ChartWorkState(withFine, 1);
    const img = state.detailTile(1, 0, 0)!;
    expect([img.w, img.h]).toEqual([768, 768]);
    // 迷雾另一张：还没有迷雾时没有；同步了位图以后未探明的块才有
    expect(state.fogTile(0, 0)).toBeNull();
    const bits = new FogBits(W, H);
    for (let y = 0; y < H; y++) for (let x = 0; x < 16; x++) bits.reveal(x, y);
    state.fogSync(bits.bits);
    const fog = state.fogTile(0, 0)!;
    expect(alphaAt(fog, 4 * 24, 4 * 24)).toBe(0);
    expect(alphaAt(fog, 28 * 24, 4 * 24)).toBe(255);
    // 迷雾变了，地形的那一张不变（不必重画）
    const again = state.detailTile(1, 0, 0)!;
    expect(again.data.every((v, i) => v === img.data[i])).toBe(true);
    state.release();
  }, 60000);

  it("调度：细节瓦片与迷雾瓦片各自回调；同一块在路上时不重复要；销毁后不再回调", async () => {
    const detail = vi.fn();
    const fogTile = vi.fn();
    const jobs = createChartJobs(withFine, { chart: () => {}, fog: () => {}, detail, fogTile }, { worker: false });
    jobs.detail(1, 0, 0);
    jobs.detail(1, 0, 0);
    jobs.detail(5, 0, 0); // 季节取模：与 1 是同一块
    jobs.fogTile(1, 0);
    jobs.fogTile(1, 0);
    await waitFor(() => expect(detail).toHaveBeenCalledTimes(1), { timeout: 20000 });
    await waitFor(() => expect(fogTile).toHaveBeenCalledTimes(1), { timeout: 20000 });
    const [season, tx, ty, img] = detail.mock.calls[0] as [number, number, number, RgbaImage];
    expect([season, tx, ty, img.w, img.h]).toEqual([1, 0, 0, 768, 768]);
    // 还没有迷雾：这一块没有迷雾图
    expect(fogTile.mock.calls[0]).toEqual([1, 0, null]);
    // 回调过了就可以再要
    jobs.detail(1, 0, 0);
    await waitFor(() => expect(detail).toHaveBeenCalledTimes(2), { timeout: 20000 });
    jobs.detail(2, 1, 1);
    jobs.destroy();
    await new Promise((r) => setTimeout(r, 50));
    expect(detail).toHaveBeenCalledTimes(2);
  }, 60000);

  it("共用的计算中心知道这张图有没有细节瓦片；没有细图层的地图要细节瓦片得到 null", async () => {
    const plain = acquireChartHub("m01-test-plain", base, { worker: false });
    const fine = acquireChartHub("m01-test-fine", withFine, { worker: false });
    expect(plain.detail).toBe(false);
    expect(fine.detail).toBe(true);
    const got = vi.fn();
    const off = plain.subscribe({ detail: got });
    plain.jobs.detail(1, 0, 0);
    await waitFor(() => expect(got).toHaveBeenCalledWith(1, 0, 0, null), { timeout: 20000 });
    off();
    plain.release();
    fine.release();
  }, 60000);
});

describe("细图层的加载", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    clearFineLayers();
  });

  it("没有细图层的地图（后端给空的一份）得到 null；同一张图只取一次、结果缓存", async () => {
    const spy = vi.spyOn(navApi, "mapFine").mockResolvedValue({ key: "classic", hash: "", cells: 0, coast: null, elevation: null, rivers: null });
    expect(cachedFineLayers("classic", "h")).toBeUndefined();
    const [a, b] = await Promise.all([loadFineLayers("classic", "h"), loadFineLayers("classic", "h")]);
    expect([a, b]).toEqual([null, null]);
    expect(cachedFineLayers("classic", "h")).toBeNull();
    await loadFineLayers("classic", "h");
    expect(spy).toHaveBeenCalledTimes(1);
    // 换了地图资源（hash 不同）就重新取
    await loadFineLayers("classic", "h2");
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("取不到、解不开都按没有处理（海图照原来的画法），不抛错", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(navApi, "mapFine").mockRejectedValueOnce(new Error("offline"));
    expect(await loadFineLayers("earth", "a")).toBeNull();
    vi.spyOn(navApi, "mapFine").mockResolvedValueOnce({ key: "earth", hash: "x", cells: 24, coast: "AAAA", elevation: "AAAA", rivers: "AAAA" });
    expect(await loadFineLayers("earth", "b")).toBeNull();
    expect(warn).toHaveBeenCalledTimes(2);
  });
});
