// 大地图的时限（FRAMEWORK §5.4）：按地图尺寸参数化——经典的 400 × 170 与合成的 1080 × 396（东西相连、等距圆柱投影）。
// 每种尺寸：整图（每格 4 像素）、世界图（大地图 2×2 缩小成每格 2 像素）、世界图的迷雾、航行视图的瓦片（64 × 64 格、每格 12 像素、
// 盖好迷雾）、迷雾位图的全量解码；再把整张图的瓦片都过一遍 LRU，内存不超过上限（桌面 200 MB、手机 120 MB）。
// 时限按格数等比放大；整套测试并行时机器很忙，上限只防止数量级的退化（各项在本机空闲时的耗时写在旁边）。
import { beforeAll, describe, expect, it } from "vitest";
import { synthWorld } from "../art/map/synth";
import { paintChart } from "../art/map/terrain";
import type { ChartInput } from "../art/map";
import { ChartWorkState } from "./chartWork";
import { FogBits } from "./fogBits";
import { imageBytes, LruCache, MEMORY_BUDGET, NAV_CELL_PX, NAV_TILE, tileCounts, tileKey, worldScaleOf } from "./tiles";

const EARTH = { kind: "equirect" as const, west: -10800, north: 4320, arcmin_per_cell: 20 };
const CLASSIC_CELLS = 400 * 170;

interface Case {
  W: number;
  H: number;
  wrap: boolean;
  projection: typeof EARTH | null;
}
const CASES: Case[] = [
  { W: 400, H: 170, wrap: false, projection: null },
  { W: 1080, H: 396, wrap: true, projection: EARTH },
];

/** 一半海域揭开的迷雾（按列条带，边缘参差）。 */
function halfFog(W: number, H: number): string[] {
  const rows: string[] = [];
  for (let y = 0; y < H; y++) {
    let r = "";
    for (let x = 0; x < W; x++) r += x < W / 2 + Math.sin(y / 5) * 20 ? "1" : "0";
    rows.push(r);
  }
  return rows;
}

function timed<T>(f: () => T): [T, number] {
  const t = performance.now();
  const v = f();
  return [v, performance.now() - t];
}

// 预热：先画一张小图（首次编译），之后的计时才是稳定的耗时
beforeAll(() => {
  paintChart({ ...synthWorld(3, 120, 60).input, wrapX: true, projection: EARTH }, 1);
}, 60000);

describe.each(CASES)("大地图：$W × $H", ({ W, H, wrap, projection }) => {
  const k = (W * H) / CLASSIC_CELLS;
  const input: ChartInput = { ...synthWorld(7, W, H).input, wrapX: wrap, projection };
  const scale = worldScaleOf(W, H);
  const state = new ChartWorkState(input, scale);

  it("整图、世界图与世界图的迷雾在时限内生成，尺寸按每格像素", () => {
    // 本机空闲时：整图 400 × 170 约 0.3 秒（首次含编译约 1.2 秒）、1080 × 396 约 3.3 秒（含环绕的左右补边）；
    // 世界图的 2×2 缩小约 0.1 秒；迷雾第一次整张约 2 秒（之后的增量约 30 毫秒）
    const [base, tBase] = timed(() => state.base(1));
    expect([base.w, base.h]).toEqual([W * 4, H * 4]);
    expect(tBase).toBeLessThan(5000 * k);
    const [world, tWorld] = timed(() => state.chart(1));
    expect([world.w, world.h]).toEqual([(W * 4) / scale, (H * 4) / scale]);
    expect(tWorld).toBeLessThan(scale === 1 ? 3000 * k : 1500);
    // 迷雾画家（第一次整张）
    const [fog, tFog] = timed(() => state.fogUpdate(halfFog(W, H)));
    expect(fog).not.toBeNull();
    expect([fog!.w, fog!.h]).toEqual([(W * 4) / scale, (H * 4) / scale]);
    expect(tFog).toBeLessThan(5000 * k);
  }, 120000);

  it("航行视图的瓦片：64 × 64 格、每格 12 像素、盖好迷雾，单块在时限内", () => {
    state.base(1);
    state.fogUpdate(halfFog(W, H));
    const { nx, ny } = tileCounts(W, H);
    const picks: [number, number][] = [
      [0, 0],
      [nx - 1, 0],
      [Math.floor(nx / 2), Math.floor(ny / 2)],
      [nx - 1, ny - 1],
    ];
    let worst = 0;
    for (const [tx, ty] of picks) {
      const [img, ms] = timed(() => state.tile(1, tx, ty));
      worst = Math.max(worst, ms);
      expect(img.w).toBe(Math.min(NAV_TILE, W - tx * NAV_TILE) * NAV_CELL_PX);
      expect(img.h).toBe(Math.min(NAV_TILE, H - ty * NAV_TILE) * NAV_CELL_PX);
    }
    // 本机空闲时每块约 5 毫秒
    expect(worst).toBeLessThan(400);
  }, 120000);

  it("迷雾位图：全量解码与转成文本在时限内", () => {
    const bits = new FogBits(W, H);
    for (let y = 0; y < H; y += 2) bits.applyRuns([[y, 0, Math.floor(W / 3)]]);
    const b64 = bits.toBase64();
    const [rows, ms] = timed(() => FogBits.fromBase64(b64, W, H).toRows());
    expect(rows).toHaveLength(H);
    expect(rows[0].length).toBe(W);
    // 本机空闲时 1080 × 396 约 17 毫秒
    expect(ms).toBeLessThan(400 * k);
  });

  it("把整张图的瓦片都过一遍：LRU 的内存不超过上限（桌面 200 MB、手机 120 MB）", () => {
    state.base(1);
    const { nx, ny } = tileCounts(W, H);
    for (const budget of [MEMORY_BUDGET.mobile, MEMORY_BUDGET.desktop]) {
      const lru = new LruCache<{ w: number; h: number }>(budget, imageBytes);
      let peak = 0;
      for (let ty = 0; ty < ny; ty++) {
        for (let tx = 0; tx < nx; tx++) {
          // 只记尺寸（真的生成在上一项已经测过），按航行视图一块一块地放进去
          const w = Math.min(NAV_TILE, W - tx * NAV_TILE) * NAV_CELL_PX;
          const h = Math.min(NAV_TILE, H - ty * NAV_TILE) * NAV_CELL_PX;
          lru.set(tileKey(1, tx, ty), { w, h });
          peak = Math.max(peak, lru.bytes);
        }
      }
      expect(peak).toBeLessThanOrEqual(budget);
      // 大地图的全部瓦片放不下，淘汰掉了一部分；小地图全部放得下
      const all = nx * ny;
      if (all * NAV_TILE * NAV_TILE * NAV_CELL_PX * NAV_CELL_PX * 4 > budget) expect(lru.size).toBeLessThan(all);
      else expect(lru.size).toBe(all);
    }
  });
});
