// 第九批的海图通用化（FRAMEWORK §5）：经典世界没有投影时输出逐像素不变；有投影时纬度、气候与“新大陆”按真实经纬；
// 东西相连的地图左右补边画完再裁掉（接缝两侧连续），画框只画上下两边。
import { describe, expect, it } from "vitest";
import { classicLatOf, drawFog, FogPainter, isNewWorld, latitudeAt, longitudeAt, NEW_WORLD_X, padWrapInput, VEG, type ChartInput } from "./map";
import { geoLayers } from "./map/geo";
import { paintChart } from "./map/terrain";
import { uniquePlaces } from "./map/culture";
import type { Px } from "./px";

/** 寰宇图的投影：1080 × 396、每格 20 角分、西缘 180°W、上缘 72°N。 */
const EARTH = { kind: "equirect" as const, west: -10800, north: 4320, arcmin_per_cell: 20 };

function same(a: Px, b: Px): boolean {
  if (a.w !== b.w || a.h !== b.h) return false;
  for (let i = 0; i < a.data.length; i++) if (a.data[i] !== b.data[i]) return false;
  return true;
}

/** 一块椭圆大陆的小地图。 */
function island(W: number, H: number): ChartInput {
  const rows: string[] = [];
  for (let y = 0; y < H; y++) {
    let r = "";
    for (let x = 0; x < W; x++) r += Math.hypot((x - W / 2) / (W * 0.3), (y - H / 2) / (H * 0.3)) < 1 ? "#" : y % 7 === 0 ? "-" : "~";
    rows.push(r);
  }
  return { width: W, height: H, rows, places: [{ x: Math.floor(W / 2), y: Math.floor(H / 2), kind: "port", faction: "cuilan" }] };
}

describe("经纬换算", () => {
  it("行列 → 纬度与经度（角分 → 度；经度归到 [-180, 180)）", () => {
    expect(latitudeAt(EARTH, 0)).toBe(72);
    expect(latitudeAt(EARTH, 216)).toBe(0);
    expect(latitudeAt(EARTH, 396)).toBe(-60);
    expect(longitudeAt(EARTH, 0)).toBe(-180);
    expect(longitudeAt(EARTH, 540)).toBe(0);
    expect(longitudeAt(EARTH, 1080)).toBe(-180);
    expect(longitudeAt(EARTH, 512.5)).toBeCloseTo(-9.1667);
  });

  it("真实纬度 → 经典的气候刻度：两极小、赤道大，南北对称、单调", () => {
    expect(classicLatOf(80)).toBeLessThan(7);
    expect(classicLatOf(69)).toBeGreaterThan(7);
    expect(classicLatOf(69)).toBeLessThan(16);
    expect(classicLatOf(0)).toBe(170);
    expect(classicLatOf(-35)).toBe(classicLatOf(35));
    for (let a = 0; a < 90; a += 3) expect(classicLatOf(a)).toBeGreaterThanOrEqual(classicLatOf(a + 3));
  });

  it("新大陆：没有投影按列（NEW_WORLD_X），有投影按经度（美洲）", () => {
    const classic = { projection: null };
    expect(isNewWorld(classic, NEW_WORLD_X - 1)).toBe(false);
    expect(isNewWorld(classic, NEW_WORLD_X)).toBe(true);
    expect(isNewWorld({ projection: null, newWorldX: 10 }, 12)).toBe(true);
    const earth = { projection: EARTH };
    // 里斯本（9°W）不是，墨西哥城（99°W）与里约（43°W）是，北京（116°E）不是
    expect(isNewWorld(earth, Math.floor((180 - 9) * 3))).toBe(false);
    expect(isNewWorld(earth, Math.floor((180 - 99) * 3))).toBe(true);
    expect(isNewWorld(earth, Math.floor((180 - 43) * 3))).toBe(true);
    expect(isNewWorld(earth, Math.floor((180 + 116) * 3))).toBe(false);
    // 地点的殖民风格随之而定
    const places = [
      { x: Math.floor((180 - 99) * 3), y: 100, kind: "port" as const, faction: "lowland" },
      { x: Math.floor((180 + 116) * 3), y: 100, kind: "port" as const, faction: "lowland" },
    ];
    const u = uniquePlaces(places, { projection: EARTH });
    expect(u[0].style).toBe("frontier");
    expect(u[1].style).not.toBe("frontier");
  });
});

describe("经典世界不变", () => {
  it("没有投影、不环绕时与以前逐像素相同（显式写 null / false 也一样）", () => {
    const input = island(60, 36);
    const a = paintChart(input, 1);
    const b = paintChart({ ...input, projection: null, wrapX: false }, 1);
    expect(same(a, b)).toBe(true);
    // 回退植被也一样
    expect(Array.from(geoLayers({ ...input, projection: null }).veg)).toEqual(Array.from(geoLayers(input).veg));
  });
});

describe("有投影：按真实纬度推断气候", () => {
  it("同一块陆地放在赤道是热带，放在高纬是冻原与针叶林", () => {
    const land = island(80, 40);
    // 赤道附近：第 20 行在 0°
    const tropic = geoLayers({ ...land, projection: { west: 0, north: 20 * 20, arcmin_per_cell: 20 } });
    // 北极圈附近：第 20 行在 68°N
    const arctic = geoLayers({ ...land, projection: { west: 0, north: 68 * 60 + 20 * 20, arcmin_per_cell: 20 } });
    const count = (veg: Uint8Array, kinds: number[]) => veg.reduce((n, v) => n + (kinds.includes(v) ? 1 : 0), 0);
    const hot = [VEG.JUNGLE, VEG.SAVANNA, VEG.WETLAND];
    const cold = [VEG.ICE, VEG.TUNDRA, VEG.BOREAL];
    expect(count(tropic.veg, hot)).toBeGreaterThan(count(tropic.veg, cold));
    expect(count(arctic.veg, cold)).toBeGreaterThan(count(arctic.veg, hot));
    expect(count(arctic.veg, hot)).toBe(0);
  });
});

describe("东西相连", () => {
  /** 一条横跨接缝的大陆（x < 12 或 x ≥ W − 12）与中间的一个岛。 */
  function seamWorld(W: number, H: number): ChartInput {
    const rows: string[] = [];
    for (let y = 0; y < H; y++) {
      let r = "";
      for (let x = 0; x < W; x++) {
        const land = ((x < 12 || x >= W - 12) && y > 6 && y < H - 6) || Math.hypot(x - W / 2, y - H / 2) < 5;
        r += land ? "#" : "~";
      }
      rows.push(r);
    }
    return { width: W, height: H, rows, places: [{ x: 2, y: Math.floor(H / 2), kind: "port", faction: "cuilan" }], wrapX: true };
  }

  it("补边：左右各补 m 列（取自对侧），地点在靠边时于对侧补一份，补边后的输入不再环绕", () => {
    const input = seamWorld(70, 30);
    const p = padWrapInput(input, 16);
    expect(p.width).toBe(70 + 32);
    expect(p.wrapX).toBe(false);
    expect(p.rows[15]).toBe(input.rows[15].slice(70 - 16) + input.rows[15] + input.rows[15].slice(0, 16));
    expect(p.places).toEqual([
      { x: 18, y: 15, kind: "port", faction: "cuilan" },
      { x: 2 + 16 + 70, y: 15, kind: "port", faction: "cuilan" },
    ]);
  });

  it("环绕地图：尺寸不变；画框只画上下两边（左右边缘是海图本身，不是木框）；接缝两侧的海陆一致", () => {
    const input = seamWorld(70, 30);
    const wrapped = paintChart(input, 1);
    const flat = paintChart({ ...input, wrapX: false }, 1);
    expect([wrapped.w, wrapped.h]).toEqual([flat.w, flat.h]);
    // 上边的木框两者都有（最外一圈是深色描边）
    expect(wrapped.get(wrapped.w >> 1, 0)).toBe(flat.get(flat.w >> 1, 0));
    // 不环绕的海图左边缘是画框（每一行最外一列都相同）；环绕的左边缘随海陆变化
    const col = (p: Px, x: number) => new Set(Array.from({ length: p.h - 20 }, (_, i) => p.get(x, i + 10)));
    expect(col(flat, 0).size).toBe(1);
    expect(col(wrapped, 0).size).toBeGreaterThan(1);
    // 接缝两侧：第 15 行最左与最右的像素都是陆地色（大陆横跨接缝），不再是画框
    const frameColor = flat.get(0, 60);
    expect(wrapped.get(0, 60)).not.toBe(frameColor);
    expect(wrapped.get(wrapped.w - 1, 60)).not.toBe(frameColor);
    // 确定性
    expect(same(wrapped, paintChart({ ...input, rows: [...input.rows] }, 1))).toBe(true);
  });
});

describe("环绕地图的迷雾", () => {
  const W = 60;
  const H = 20;
  // 只揭开最右边的三列
  const rows = Array.from({ length: H }, () => "0".repeat(W - 3) + "111");

  it("接缝对侧（第 0 列）的迷雾按环绕的距离过渡；不环绕时那里是整片云团", () => {
    const wrapped = drawFog(rows, W, H, true);
    const flat = drawFog(rows, W, H);
    const clearIn = (p: Px, x0: number, x1: number) => {
      let n = 0;
      for (let y = 8; y < H * 4 - 8; y++) for (let x = x0; x < x1; x++) if ((p.get(x, y) & 0xff) === 0) n++;
      return n;
    };
    // 第 0 列紧挨着揭开的第 59 列：环绕时边缘抖动露出一部分，不环绕时一点不露
    expect(clearIn(wrapped, 0, 4)).toBeGreaterThan(0);
    expect(clearIn(flat, 0, 4)).toBe(0);
    // 揭开处两者相同（都透明）
    expect(clearIn(wrapped, (W - 2) * 4, W * 4)).toBe(clearIn(flat, (W - 2) * 4, W * 4));
  });

  it("增量重画与整张重画相同（变化挨着接缝时整行重画）", () => {
    const p = new FogPainter(W, H, true);
    p.update(rows);
    const next = rows.map((r, y) => (y === 10 ? "1" + r.slice(1) : r));
    const rect = p.update(next);
    expect(rect).not.toBeNull();
    // 挨着接缝：整行（全宽）重画
    expect(rect!.x).toBe(0);
    expect(rect!.w).toBe(W * 4);
    const whole = drawFog(next, W, H, true);
    expect(same(p.px, whole)).toBe(true);
  });
});
