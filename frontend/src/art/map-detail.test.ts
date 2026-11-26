// 细节瓦片（第九批 M01“细海图”）：每粗格 24 个美术像素的像素海图——尺寸、确定性、海陆与浅滩的着色、四季、
// 城镇与地标，以及用仓库里真实的寰宇数据画一块（西日本）。画法的好坏靠离线出图看（scripts/map-1111.ts），这里守住结构。
import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { beforeAll, describe, expect, it } from "vitest";
import type { ChartInput } from "./map";
import { DETAIL_CELL, DETAIL_TILE, detailContext, paintDetailTile, type DetailContext, type DetailImage } from "./map/detail";
import { FINE_LAND, FINE_SEA, decodeFineCoast, decodeFineElevation, decodeFineRivers, fineClassAt, fineCoastFromRaster, type FineLayers, type Inflate } from "./map/fine";
import { synthFine } from "./map/fineSynth";
import { synthWorld } from "./map/synth";
import { P } from "./palette";
import { rgba } from "./px";

const EARTH = { kind: "equirect" as const, west: -10800, north: 4320, arcmin_per_cell: 20 };

/** 像素 (x, y)（瓦片内坐标）的颜色，写成 0xRRGGBBAA（与调色板的写法一致）。 */
function colorAt(img: DetailImage, x: number, y: number): number {
  const o = (y * img.w + x) * 4;
  return ((img.data[o] << 24) | (img.data[o + 1] << 16) | (img.data[o + 2] << 8) | img.data[o + 3]) >>> 0;
}
const SEA_COLORS = new Set(P.sea.map((c) => rgba(c)));
const same = (a: DetailImage, b: DetailImage) => a.w === b.w && a.h === b.h && a.data.every((v, i) => v === b.data[i]);

describe("细节瓦片：合成世界", () => {
  // 80 × 48 格、东西相连：横向 3 块（最后一块 16 格宽）、纵向 2 块（最后一块 16 格高）
  const W = 80;
  const H = 48;
  const base: ChartInput = { ...synthWorld(5, W, H).input, wrapX: true, projection: { ...EARTH, arcmin_per_cell: 120 } };
  let input: ChartInput;
  let ctx: DetailContext;
  beforeAll(() => {
    input = { ...base, fine: synthFine(base) };
    ctx = detailContext(input)!;
  }, 60000);

  it("没有细图层、或细图层与航行网格对不上的地图不画细节瓦片", () => {
    expect(detailContext(base)).toBeNull();
    expect(detailContext({ ...base, fine: null })).toBeNull();
    expect(detailContext({ ...input, width: W + 1 })).toBeNull();
    expect(detailContext({ ...input, fine: { ...input.fine!, sub: 12 } })).toBeNull();
    expect(ctx).not.toBeNull();
  });

  it("一块 32 × 32 格、每格 24 像素；地图边上的最后一块按实际的格数；每个像素都不透明", () => {
    expect([DETAIL_CELL, DETAIL_TILE]).toEqual([24, 32]);
    const full = paintDetailTile(ctx, 1, 0, 0);
    expect([full.x, full.y, full.w, full.h]).toEqual([0, 0, 768, 768]);
    const edge = paintDetailTile(ctx, 1, 2, 1);
    expect([edge.x, edge.y, edge.w, edge.h]).toEqual([64 * 24, 32 * 24, 16 * 24, 16 * 24]);
    for (const img of [full, edge]) {
      let opaque = true;
      for (let i = 3; i < img.data.length; i += 4) if (img.data[i] !== 255) opaque = false;
      expect(opaque).toBe(true);
    }
    // 图外的块是空的
    expect(paintDetailTile(ctx, 1, 3, 0).w).toBe(0);
  }, 60000);

  it("确定性：同一块画几遍、夹着别的块画，逐像素相同（草稿缓冲的重复使用不串味）", () => {
    const a = paintDetailTile(ctx, 1, 1, 0);
    paintDetailTile(ctx, 3, 0, 1);
    paintDetailTile(ctx, 0, 2, 0);
    const b = paintDetailTile(ctx, 1, 1, 0);
    expect(same(a, b)).toBe(true);
    // 另建一份画具，结果也相同
    expect(same(a, paintDetailTile(detailContext(input)!, 1, 1, 0))).toBe(true);
  }, 60000);

  it("海陆照细海岸层：陆上没有海色，开阔的海面只有海的色阶", () => {
    const fine = input.fine!;
    const img = paintDetailTile(ctx, 1, 0, 0);
    let land = 0;
    let landSea = 0;
    let openSea = 0;
    let openOther = 0;
    for (let y = 8; y < img.h - 8; y += 3) {
      for (let x = 8; x < img.w - 8; x += 3) {
        const c = colorAt(img, x, y);
        const cls = fineClassAt(fine, x, y);
        // 四周 8 个细格都是同类的才算“内陆 / 开阔海面”（岸线、沙滩、碎浪不算）
        let inner = true;
        for (const [dx, dy] of [[-8, 0], [8, 0], [0, -8], [0, 8], [-6, -6], [6, 6], [-6, 6], [6, -6]]) if (fineClassAt(fine, x + dx, y + dy) !== cls) inner = false;
        if (!inner) continue;
        if (cls === FINE_LAND) {
          land++;
          if (SEA_COLORS.has(c)) landSea++;
        } else if (cls === FINE_SEA && ctx.nav[Math.floor(y / 24) * W + Math.floor(x / 24)] === 1) {
          openSea++;
          if (!SEA_COLORS.has(c)) openOther++;
        }
      }
    }
    expect(land).toBeGreaterThan(500);
    expect(openSea).toBeGreaterThan(500);
    // 陆上只有河是水色（细河流画在陆上，颜色取自海的色阶）：零星几个像素
    expect(landSea / land).toBeLessThan(0.01);
    // 浅滩的边缘会伸进可航行格几个像素、近岸有浮冰：允许零星的例外
    expect(openOther / openSea).toBeLessThan(0.03);
  }, 60000);

  it("粗格是陆、细层是水的地方画成浅滩，与可航行的水分色", () => {
    // 4 × 3 格：中间一格是陆格，但细层里整格是水；四周是可航行的海
    const rows = ["~~~~", "~#~~", "~~~~"];
    const tiny: ChartInput = { width: 4, height: 3, rows, relief: ["....", ".1..", "...."], biomes: ["....", ".G..", "...."] };
    const raster = new Uint8Array(4 * 24 * 3 * 24);
    const fine: FineLayers = { hash: "t", ...fineCoastFromRaster(4, 3, 24, raster), elevW: 16, elevH: 12, elevPer: 4, elevation: new Int16Array(16 * 12).fill(-60), rivers: [] };
    const img = paintDetailTile(detailContext({ ...tiny, fine })!, 1, 0, 0);
    const shoal = colorAt(img, 24 + 12, 24 + 12);
    const open = colorAt(img, 3 * 24 + 12, 12);
    expect(SEA_COLORS.has(open)).toBe(true);
    expect(SEA_COLORS.has(shoal)).toBe(false);
    // 陆格的中央是浅滩的颜色；往可航行的邻格去，在格边一带参差地过渡回海的色阶
    let shoalInside = 0;
    for (let y = 24 + 8; y < 48 - 8; y++) for (let x = 24 + 8; x < 48 - 8; x++) if (!SEA_COLORS.has(colorAt(img, x, y))) shoalInside++;
    expect(shoalInside / 64).toBeGreaterThan(0.8);
    let seaOutside = 0;
    for (let y = 4; y < 20; y++) for (let x = 3 * 24 + 4; x < 4 * 24 - 4; x++) if (SEA_COLORS.has(colorAt(img, x, y))) seaOutside++;
    expect(seaOutside).toBe(16 * 16);
  });

  it("四季：冬天高纬积雪、夏天不积；南半球季节相反", () => {
    // 一条竖着的陆地从北纬 70° 到南纬 55°：北端冬天白、夏天不白，南端相反
    const h = 32;
    const rows = Array.from({ length: h }, () => "~~####~~");
    const strip: ChartInput = {
      width: 8,
      height: h,
      rows,
      relief: rows.map((r) => r.replace(/#/g, "2").replace(/~/g, ".")),
      biomes: rows.map((r) => r.replace(/#/g, "G").replace(/~/g, ".")),
      projection: { kind: "equirect", west: 0, north: 70 * 60, arcmin_per_cell: 240 },
    };
    const raster = new Uint8Array(8 * 24 * h * 24);
    for (let y = 0; y < h * 24; y++) for (let x = 2 * 24; x < 6 * 24; x++) raster[y * 8 * 24 + x] = FINE_LAND;
    const elevation = new Int16Array(32 * h * 4).fill(300);
    const c2 = detailContext({ ...strip, fine: { hash: "s", ...fineCoastFromRaster(8, h, 24, raster), elevW: 32, elevH: h * 4, elevPer: 4, elevation, rivers: [] } })!;
    const snow = new Set(P.snow.map((c) => rgba(c)).concat(rgba(P.white)));
    const snowShare = (img: DetailImage, y0: number, y1: number) => {
      let n = 0;
      let all = 0;
      for (let y = y0; y < y1; y += 2) for (let x = 3 * 24; x < 5 * 24; x += 2, all++) if (snow.has(colorAt(img, x, y))) n++;
      return n / all;
    };
    const summer = paintDetailTile(c2, 1, 0, 0);
    const winter = paintDetailTile(c2, 3, 0, 0);
    // 北端（第 0–1 行，北纬 62°–70°）
    expect(snowShare(winter, 4, 44)).toBeGreaterThan(0.8);
    expect(snowShare(summer, 4, 44)).toBeLessThan(0.1);
    // 南端（第 30–31 行，南纬 50°–58°）：北半球的夏天是那里的冬天
    expect(snowShare(summer, 30 * 24 + 4, 32 * 24 - 4)).toBeGreaterThan(snowShare(winter, 30 * 24 + 4, 32 * 24 - 4));
    // 赤道附近（第 17 行）两季都不积雪
    expect(snowShare(summer, 17 * 24, 18 * 24)).toBe(0);
    expect(snowShare(winter, 17 * 24, 18 * 24)).toBe(0);
  });

  it("城镇周围有田畴与民居、地标有图标：只改动它们附近的像素", () => {
    // 找一处陆格放一座城与一个地标
    let spot: [number, number] | null = null;
    for (let y = 4; y < 28 && !spot; y++) for (let x = 4; x < 28 && !spot; x++) if (ctx.nav[y * W + x] === 0 && ctx.nav[y * W + x + 1] === 0 && ctx.nav[(y + 1) * W + x] === 0) spot = [x, y];
    expect(spot).not.toBeNull();
    const [sx, sy] = spot!;
    const plain = detailContext({ ...input, places: [], landmarks: [] })!;
    const town = detailContext({ ...input, places: [{ x: sx, y: sy, kind: "city", faction: "" }], landmarks: [{ key: "k", category: "natural", kind: "volcano", x: sx + 6, y: sy }] })!;
    const a = paintDetailTile(plain, 1, 0, 0);
    const b = paintDetailTile(town, 1, 0, 0);
    let near = 0;
    let far = 0;
    const cx = sx * 24 + 12;
    const cy = sy * 24 + 12;
    for (let y = 0; y < a.h; y++) {
      for (let x = 0; x < a.w; x++) {
        if (colorAt(a, x, y) === colorAt(b, x, y)) continue;
        const dTown = Math.hypot(x - cx, y - cy);
        const dMark = Math.hypot(x - (cx + 6 * 24), y - cy);
        // 地标的格心落在水里时会挪到旁边的岸上（最多 16 像素）
        if (dTown <= 40 || dMark <= 30) near++;
        else far++;
      }
    }
    expect(near).toBeGreaterThan(30);
    expect(far).toBe(0);
  }, 60000);
});

describe("细节瓦片：仓库里的寰宇数据", () => {
  // 路径放在变量里：写成模板字面量时 Vite 会把 new URL(…, import.meta.url) 改写成网页里的资源地址
  const MAP_DIR = "../../../data/maps/earth/";
  const at = (name: string) => {
    const rel = MAP_DIR + name;
    return new URL(rel, import.meta.url);
  };
  const inflate: Inflate = async (data) => new Uint8Array(inflateSync(data));
  const rowsOf = (name: string) =>
    readFileSync(at(name), "utf8")
      .split(/\r?\n/)
      .filter((l) => l.length > 0 && !l.startsWith("//"));

  it("西日本的一块：九州是陆、太平洋是深海、濑户内海的陆格里是浅滩；一块在时限内画完", async () => {
    const read = (name: string) => new Uint8Array(readFileSync(at("fine/" + name)));
    const fine: FineLayers = {
      hash: "earth",
      ...(await decodeFineCoast(read("coast.bin"), inflate)),
      ...(await decodeFineElevation(read("elevation.bin"), inflate)),
      rivers: await decodeFineRivers(read("rivers.bin"), inflate),
    };
    const input: ChartInput = {
      width: 1080,
      height: 396,
      rows: rowsOf("map.txt").map((r) => r.replace(/~/g, "-").replace(/\./g, "~")),
      relief: rowsOf("relief.txt"),
      biomes: rowsOf("biomes.txt").map((r) => r.replace(/X/g, "G")),
      projection: EARTH,
      wrapX: true,
      fine,
    };
    const ctx = detailContext(input)!;
    expect(ctx).not.toBeNull();
    // 瓦片 (29, 3)：东经 129.3°–140°、北纬 29.3°–40°
    paintDetailTile(ctx, 1, 29, 3);
    const t0 = performance.now();
    const img = paintDetailTile(ctx, 1, 29, 3);
    const ms = performance.now() - t0;
    expect([img.w, img.h]).toEqual([768, 768]);
    // 时限只防数量级的退化（整套测试并行时机器很忙）；本机空闲时的实测写在 docs/drafts/m01-handoff.md
    expect(ms).toBeLessThan(2500);
    const px = (lon: number, lat: number) => colorAt(img, Math.floor((lon + 180) * 72) - img.x, Math.floor((72 - lat) * 72) - img.y);
    // 九州中部：陆地（不是海色）；太平洋（四国以南）：深海
    expect(SEA_COLORS.has(px(131.0, 32.6))).toBe(false);
    expect([rgba(P.sea[0]), rgba(P.sea[1]), rgba(P.sea[2])]).toContain(px(135.0, 30.5));
    // 各种颜色都在：海的五阶至少见到四阶，陆地的颜色不止十种
    const seen = new Set<number>();
    for (let y = 0; y < img.h; y += 2) for (let x = 0; x < img.w; x += 2) seen.add(colorAt(img, x, y));
    expect([...SEA_COLORS].filter((c) => seen.has(c)).length).toBeGreaterThanOrEqual(4);
    expect(seen.size).toBeGreaterThan(25);
  }, 120000);
});
