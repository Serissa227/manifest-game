// 航海图美术的约束：扩展后的大地图（400×170 格、70 个以上地点）在时限内生成且结果确定；
// 生物群系按文化风格、纬度与新大陆决定；增量迷雾与整张重画一致；殖民点与发现物标记的尺寸与确定性。
import { describe, expect, it } from "vitest";
import {
  BIOME,
  CHART_CELL,
  DISCOVERY_KINDS,
  FogPainter,
  NEW_WORLD_X,
  PLAYER_FLAG,
  biomeGrid,
  chartInput,
  drawChart,
  drawDiscoveryMarker,
  drawFog,
  drawPortMarker,
  drawSiteMarker,
  siteMarkKey,
  type ChartInput,
  type ChartPlace,
} from "./map";
import { paintChart } from "./map/terrain";
import type { Px } from "./px";

function same(a: Px, b: Px): boolean {
  if (a.w !== b.w || a.h !== b.h) return false;
  for (let i = 0; i < a.data.length; i++) if (a.data[i] !== b.data[i]) return false;
  return true;
}

/** 简单的确定性伪随机（测试数据用）。 */
function lcg(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const FACTIONS = ["cuilan", "shuangling", "jinsui", "chisha", "bichao", "yaohua"];
const TERRAINS = ["forest", "plains", "hills", "jungle", "tundra", "desert", "swamp", "island"];

/**
 * 400×170 的测试世界：左上 240×120 是一块环抱内海的大陆，东边是新大陆，南边是一串群岛；
 * 72 个地点（港口、城市与殖民点）。
 */
function bigWorld(): ChartInput {
  const W = 400;
  const H = 170;
  const rows: string[] = [];
  for (let y = 0; y < H; y++) {
    let r = "";
    for (let x = 0; x < W; x++) {
      const oldWorld = x < 240 && y < 120 && !(Math.hypot((x - 120) / 90, (y - 60) / 40) < 1);
      const newWorld = x > 262 && x < 396 && y > 4 && y < 166 && Math.sin(x / 9) + Math.cos(y / 7) > -0.8;
      const isles = y > 128 && y < 166 && x > 120 && x < 250 && Math.sin(x / 5) * Math.cos(y / 4) > 0.45;
      const land = oldWorld || newWorld || isles;
      const shelf = !land && (x % 17 === 0 || y % 13 === 0);
      r += land ? "#" : shelf ? "-" : "~";
    }
    rows.push(r);
  }
  const rnd = lcg(7);
  const places: ChartPlace[] = [];
  let guard = 0;
  while (places.length < 72 && guard++ < 100000) {
    const x = Math.floor(rnd() * W);
    const y = Math.floor(rnd() * H);
    if (rows[y][x] !== "#") continue;
    const k = places.length;
    if (x >= 262 && k % 3 !== 0) places.push({ x, y, kind: "site", faction: "", terrain: TERRAINS[k % TERRAINS.length] });
    else places.push({ x, y, kind: k % 5 === 0 ? "city" : "port", faction: FACTIONS[k % FACTIONS.length] });
  }
  return { width: W, height: H, rows, places };
}

describe("扩展后的大海图", () => {
  const input = bigWorld();

  it("400×170 格、70 个以上地点的海图在时限内生成，耗时不随地点数增长，同一输入结果完全相同", () => {
    expect(input.places?.length).toBeGreaterThanOrEqual(70);
    // 同样的地点每个重复 8 份：画面完全相同，但地点数是 8 倍（逐像素遍历全部地点的写法会慢一倍以上）
    const crowded: ChartInput = { ...input, places: input.places?.flatMap((p) => Array.from({ length: 8 }, () => ({ ...p }))) };
    paintChart(input, 1); // 预热（首次编译）
    let best = Infinity;
    let bestCrowded = Infinity;
    let a: Px | null = null;
    let c: Px | null = null;
    // 交替测量，两者处在相同的机器负载下
    for (let k = 0; k < 3; k++) {
      let t = performance.now();
      a = paintChart(input, 1);
      best = Math.min(best, performance.now() - t);
      t = performance.now();
      c = paintChart(crowded, 1);
      bestCrowded = Math.min(bestCrowded, performance.now() - t);
    }
    // 目标 < 300 ms（本机空闲时约 170 ms）；整套测试并行时机器很忙，绝对上限只防止数量级的退化
    expect(best).toBeLessThan(2000);
    expect(bestCrowded).toBeLessThan(best * 1.4 + 50);
    expect(same(a!, c!)).toBe(true);
    expect(a!.w).toBe(400 * CHART_CELL);
    expect(a!.h).toBe(170 * CHART_CELL);
    expect(a!.data.every((v) => (v & 0xff) === 0xff)).toBe(true);
    const b = paintChart({ ...input, rows: [...input.rows], places: input.places?.map((p) => ({ ...p })) }, 1);
    expect(same(a!, b)).toBe(true);
  }, 60000);

  it("生物群系：文化风格决定旧世界的地貌，新大陆是原始的密林、草原、雨林与沼泽", () => {
    // 一整块陆地，每种风格一个港口相隔很远；新大陆没有港口
    const W = 400;
    const H = 170;
    const rows = Array.from({ length: H }, () => "#".repeat(W));
    const at = (grid: Uint8Array, x: number, y: number) => grid[y * W + x];
    const styles: [string, number, number, number][] = [
      ["cuilan", 30, 60, BIOME.MEDIT],
      ["shuangling", 110, 28, BIOME.BOREAL],
      ["jinsui", 190, 60, BIOME.FARM],
      ["chisha", 110, 95, BIOME.ARID],
      ["bichao", 60, 100, BIOME.TROPIC],
      ["yaohua", 180, 150, BIOME.EAST],
    ];
    const places: ChartPlace[] = styles.map(([faction, x, y]) => ({ x, y, kind: "port", faction }));
    const grid = biomeGrid({ width: W, height: H, rows, places });
    for (const [faction, x, y, biome] of styles) expect(at(grid, x, y), faction).toBe(biome);
    // 最北是冰原
    expect(at(grid, 110, 2)).toBe(BIOME.COLD);
    // 新大陆（远离港口）：只有原始地貌
    const wild = new Set<number>([BIOME.WILDWOOD, BIOME.PRAIRIE, BIOME.JUNGLE, BIOME.SWAMP, BIOME.COLD]);
    const seen = new Set<number>();
    for (let y = 0; y < H; y += 3) for (let x = NEW_WORLD_X + 40; x < W; x += 3) seen.add(at(grid, x, y));
    for (const b of seen) expect(wild.has(b), `新大陆出现了 ${b}`).toBe(true);
    expect(seen.has(BIOME.WILDWOOD) && seen.has(BIOME.PRAIRIE)).toBe(true);
    // 殖民点按自己的地形决定附近的地貌
    const swamp = biomeGrid({ width: W, height: H, rows, places: [...places, { x: 330, y: 80, kind: "site", faction: "", terrain: "swamp" }] });
    expect(at(swamp, 330, 80)).toBe(BIOME.SWAMP);
    // 风格字段优先于势力 key（例如新势力用已有风格）
    const styled = biomeGrid({ width: W, height: H, rows, places: [{ x: 60, y: 60, kind: "port", faction: "newcomer", style: "nordic" }] });
    expect(at(styled, 60, 60)).toBe(BIOME.BOREAL);
  });

  it("旧世界的海图四季不同，新大陆也随季节变化", () => {
    const small: ChartInput = { ...input, places: input.places?.slice(0, 20) };
    const summer = drawChart(small, { season: 1 });
    const winter = drawChart(small, { season: 3 });
    expect(same(summer, winter)).toBe(false);
    const crop = (p: Px) => p.crop(300 * CHART_CELL, 20 * CHART_CELL, 60 * CHART_CELL, 40 * CHART_CELL);
    expect(same(crop(summer), crop(winter))).toBe(false);
  }, 20000);
});

describe("增量迷雾", () => {
  const W = 120;
  const H = 60;
  const grid = () => Array.from({ length: H }, () => new Array<string>(W).fill("0"));
  const rowsOf = (g: string[][]) => g.map((r) => r.join(""));
  const reveal = (g: string[][], cx: number, cy: number, r: number) => {
    for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) if (x >= 0 && y >= 0 && x < W && y < H && (x - cx) ** 2 + (y - cy) ** 2 <= r * r) g[y][x] = "1";
  };

  it("逐步揭开时只重画变化处附近，结果与整张重画完全相同", () => {
    const g = grid();
    const painter = new FogPainter(W, H);
    const first = painter.update(rowsOf(g));
    expect(first).toEqual({ x: 0, y: 0, w: W * CHART_CELL, h: H * CHART_CELL });
    expect(painter.update(rowsOf(g))).toBeNull();
    const rnd = lcg(3);
    for (let step = 0; step < 12; step++) {
      const cx = Math.floor(rnd() * W);
      const cy = Math.floor(rnd() * H);
      reveal(g, cx, cy, 3 + Math.floor(rnd() * 4));
      const rect = painter.update(rowsOf(g));
      expect(rect).not.toBeNull();
      // 一小块揭开只影响附近：远小于整张图
      expect(rect!.w * rect!.h).toBeLessThan(W * H * CHART_CELL * CHART_CELL);
      expect(same(painter.px, drawFog(rowsOf(g), W, H)), `第 ${step} 步`).toBe(true);
    }
    // 整张换掉（读档）也一致
    const other = grid();
    reveal(other, 10, 10, 8);
    painter.update(rowsOf(other));
    expect(same(painter.px, drawFog(rowsOf(other), W, H))).toBe(true);
  });

  it("扩展后的地图：迷雾位图与海图同尺寸，未探索的新大陆被盖住", () => {
    const rows = Array.from({ length: 170 }, (_, y) => (y < 120 ? "1".repeat(240) + "0".repeat(160) : "0".repeat(400)));
    const fog = drawFog(rows, 400, 170);
    expect([fog.w, fog.h]).toEqual([1600, 680]);
    expect(fog.get(100 * CHART_CELL, 60 * CHART_CELL) & 0xff).toBe(0);
    expect(fog.get(320 * CHART_CELL, 60 * CHART_CELL) & 0xff).toBe(0xff);
    expect(fog.get(100 * CHART_CELL, 150 * CHART_CELL) & 0xff).toBe(0xff);
  });
});

describe("殖民点与发现物标记", () => {
  const port = drawPortMarker("mediterranean", "#b03a2e");

  it("殖民点标记与港口标记同尺寸（码头与海滩对齐在锚地格），三种状态各不相同", () => {
    const wild = drawSiteMarker({});
    const claimed = drawSiteMarker({ claim: "#3b5b92" });
    const colony = drawSiteMarker({ colony: { flag: PLAYER_FLAG, size: 1 } });
    for (const p of [wild, claimed, colony]) expect([p.w, p.h]).toEqual([port.w, port.h]);
    expect(same(wild, claimed)).toBe(false);
    expect(same(wild, colony)).toBe(false);
    expect(same(claimed, colony)).toBe(false);
    // 势力旗色与殖民地规模都体现在图上
    expect(same(claimed, drawSiteMarker({ claim: "#7d3c98" }))).toBe(false);
    const sizes = [0, 1, 2].map((size) => drawSiteMarker({ colony: { flag: PLAYER_FLAG, size } }));
    expect(same(sizes[0], sizes[1]) || same(sizes[1], sizes[2])).toBe(false);
    // 殖民地优先于势力占领
    expect(same(drawSiteMarker({ claim: "#3b5b92", colony: { flag: PLAYER_FLAG, size: 1 } }), colony)).toBe(true);
  });

  it("未探明的殖民点是同尺寸的草图；同样的参数得到同样的图", () => {
    const known = drawSiteMarker({ claim: "#3b5b92" });
    const sketch = drawSiteMarker({ claim: "#3b5b92" }, { unknown: true });
    expect([sketch.w, sketch.h]).toEqual([known.w, known.h]);
    expect(known.colorCount()).toBeGreaterThan(sketch.colorCount());
    expect(same(drawSiteMarker({ colony: { flag: PLAYER_FLAG, size: 2 } }), drawSiteMarker({ colony: { flag: PLAYER_FLAG, size: 2 } }))).toBe(true);
    expect(siteMarkKey({ colony: { flag: PLAYER_FLAG, size: 9 } })).toBe(siteMarkKey({ colony: { flag: PLAYER_FLAG, size: 2 } }));
    expect(siteMarkKey({}, true)).not.toBe(siteMarkKey({}, false));
  });

  it("各种发现物图标同尺寸、各不相同，未知种类也能画", () => {
    const icons = DISCOVERY_KINDS.map((k) => drawDiscoveryMarker(k));
    for (const p of icons) {
      expect([p.w, p.h]).toEqual([17, 17]);
      expect(p.bounds()).not.toBeNull();
    }
    for (let i = 0; i < icons.length; i++) for (let j = i + 1; j < icons.length; j++) expect(same(icons[i], icons[j])).toBe(false);
    expect([drawDiscoveryMarker("mystery").w, drawDiscoveryMarker("mystery").h]).toEqual([17, 17]);
  });
});

describe("海图输入", () => {
  it("静态数据里的殖民点、地形与势力风格进入海图输入；旧数据照常", () => {
    const input = chartInput({
      map: { width: 4, height: 3, rows: ["~~-#", "~--#", "~~~#"] },
      locations: [
        { id: 0, key: "a", name: "甲", kind: "port", x: 1, y: 1, faction: 0, shipyard: false },
        { id: 1, key: "b", name: "乙", kind: "site" as "port", x: 2, y: 2, faction: 0, shipyard: false, terrain: "swamp" } as never,
      ],
      factions: [{ id: 0, key: "cuilan", name: "埃斯佩兰", license_price: 0, marque_price: 0, color: "#b03a2e", style: "mediterranean" } as never],
      roads: [],
    });
    expect(input.places?.map((p) => [p.kind, p.faction, p.style, p.terrain])).toEqual([
      ["port", "cuilan", "mediterranean", null],
      ["site", "cuilan", "mediterranean", "swamp"],
    ]);
  });
});
