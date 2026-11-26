// 写实地理的海图画法（EXPANSION.md §10.4）：植被绘制的确定性、河流、平滑的海岸、人文景观与道路的位置、
// 地标图标、缺图层时的回退。
import { describe, expect, it } from "vitest";
import { CHART_CELL, chartInput, drawFog, drawLandmarkIcon, LANDMARK_CATEGORIES, LANDMARK_KINDS, landmarkIconKey, type ChartInput } from "./map";
import { arable } from "./map/culture";
import { coastPixels, geoLayers, SEA_VEG, VEG, VEG_CODES } from "./map/geo";
import { rasterStroke, riverStroke } from "./map/rivers";
import { synthWorld } from "./map/synth";
import { paintChartLayers } from "./map/terrain";
import { P } from "./palette";
import { rgba, type Px } from "./px";

const C = CHART_CELL;

function same(a: Px, b: Px): boolean {
  if (a.w !== b.w || a.h !== b.h) return false;
  for (let i = 0; i < a.data.length; i++) if (a.data[i] !== b.data[i]) return false;
  return true;
}

/** 手写的小世界：四周是海，中间一块陆地；relief / biomes 按给定函数填。 */
function island(W: number, H: number, bio: (x: number, y: number) => string, rel: (x: number, y: number) => number = () => 2): ChartInput {
  const rows: string[] = [];
  const relief: string[] = [];
  const biomes: string[] = [];
  for (let y = 0; y < H; y++) {
    let a = "";
    let b = "";
    let c = "";
    for (let x = 0; x < W; x++) {
      const land = x >= 6 && y >= 6 && x < W - 6 && y < H - 6;
      a += land ? "#" : x < 3 || y < 3 || x >= W - 3 || y >= H - 3 ? "~" : "-";
      b += land ? String(Math.max(0, Math.min(9, rel(x, y)))) : ".";
      c += land ? bio(x, y) : ".";
    }
    rows.push(a);
    relief.push(b);
    biomes.push(c);
  }
  return { width: W, height: H, rows, relief, biomes };
}

const synth = synthWorld(7);

describe("植被与高程图层", () => {
  it("植被按图层绘制且结果确定：沙漠是沙色，针叶林长着针叶树；同样的输入逐像素相同", () => {
    const input = island(80, 40, (x) => (x < 40 ? "D" : "B"), (x, y) => (x + y) % 3);
    const a = paintChartLayers(input, 1);
    const b = paintChartLayers({ ...input, rows: [...input.rows], relief: [...(input.relief ?? [])], biomes: [...(input.biomes ?? [])] }, 1);
    expect(same(a.px, b.px)).toBe(true);
    const colorsIn = (x0: number, x1: number) => {
      const s = new Set<number>();
      for (let y = 12 * C; y < 28 * C; y++) for (let x = x0 * C; x < x1 * C; x++) s.add(a.px.data[y * a.px.w + x]);
      return s;
    };
    const desert = colorsIn(10, 34);
    const boreal = colorsIn(46, 70);
    const sand = rgba(P.sand[4]);
    expect(desert.has(sand)).toBe(true);
    expect(boreal.has(sand)).toBe(false);
    // 针叶树的描边色（最深的叶色）只在针叶林里
    const fir = rgba(P.leaf[0]);
    expect(boreal.has(fir)).toBe(true);
    expect(desert.has(fir)).toBe(false);
    // 换一种植被，画面随之改变
    const c = paintChartLayers(island(80, 40, () => "J"), 1);
    expect(same(a.px, c.px)).toBe(false);
  });

  it("高程成脉：高处画出山峰，积雪随季节变化（冬季比夏季多）", () => {
    const input = island(80, 40, () => "G", (x, y) => Math.round(9 - Math.abs(y - 20) * 0.9 - Math.abs(x - 40) * 0.05));
    const white = rgba(P.snow[3]);
    const count = (px: Px) => {
      let n = 0;
      for (const v of px.data) if (v === white) n++;
      return n;
    };
    const summer = paintChartLayers(input, 1).px;
    const winter = paintChartLayers(input, 3).px;
    expect(count(winter)).toBeGreaterThan(count(summer));
    // 山的描边（石色最深一阶）出现在高处的山脊附近，而不在低处
    const line = rgba(P.stone[0]);
    let ridge = 0;
    let low = 0;
    for (let y = 0; y < summer.h; y++)
      for (let x = 0; x < summer.w; x++) {
        if (summer.data[y * summer.w + x] !== line) continue;
        if (Math.abs(y / C - 20) < 6) ridge++;
        else if (Math.abs(y / C - 20) > 12) low++;
      }
    expect(ridge).toBeGreaterThan(20);
    expect(low).toBe(0);
  });
});

describe("缺图层时的回退", () => {
  it("没有 relief / biomes 时由海陆图推导：高程 0–9、植被代码合法，最北冰原、最南热带", () => {
    const W = 120;
    const H = 170;
    const rows = Array.from({ length: H }, (_, y) => (y < 2 || y >= H - 2 ? "~".repeat(W) : "~~" + "#".repeat(W - 4) + "~~"));
    const geo = geoLayers({ width: W, height: H, rows });
    expect(geo.fromData).toEqual({ relief: false, biomes: false });
    for (let i = 0; i < W * H; i++) {
      if (geo.terr[i] === 2) {
        expect(geo.relief[i]).toBeLessThanOrEqual(9);
        expect(geo.veg[i]).toBeLessThan(VEG_CODES.length);
      } else expect(geo.veg[i]).toBe(SEA_VEG);
    }
    const at = (x: number, y: number) => geo.veg[y * W + x];
    expect([VEG.ICE, VEG.TUNDRA, VEG.ALPINE]).toContain(at(60, 3));
    expect([VEG.JUNGLE, VEG.SAVANNA, VEG.WETLAND, VEG.ALPINE]).toContain(at(60, 160));
    // 海岸格的高程不超过 2
    for (let y = 3; y < H - 3; y++) expect(geo.relief[y * W + 2]).toBeLessThanOrEqual(2);
  });

  it("图层尺寸不对时整张回退；只有个别格与海陆图不一致时只回退那几格", () => {
    const input = island(40, 30, () => "F");
    const bad = geoLayers({ ...input, relief: input.relief?.slice(0, 10), biomes: ["FF"] });
    expect(bad.fromData).toEqual({ relief: false, biomes: false });
    const biomes = [...(input.biomes ?? [])];
    biomes[15] = biomes[15].slice(0, 20) + "." + biomes[15].slice(21);
    const geo = geoLayers({ ...input, biomes });
    expect(geo.fromData.biomes).toBe(true);
    expect(geo.veg[15 * 40 + 19]).toBe(VEG.FOREST);
    expect(geo.veg[15 * 40 + 20]).not.toBe(SEA_VEG);
  });

  it("静态数据里的高程、植被、河流与地标进入海图输入；旧后端没有这些字段时照常", () => {
    const base = {
      map: { width: 4, height: 3, rows: ["~~-#", "~--#", "~~~#"] },
      locations: [],
      factions: [],
      roads: [],
    };
    expect(chartInput(base).relief).toBeUndefined();
    const full = chartInput({
      ...base,
      map: { ...base.map, relief: ["...3", "...4", "...5"], biomes: ["...B", "...B", "...A"] },
      rivers: [{ key: "r", name: "河", path: [[3, 0], [3, 1]], width: 2 }],
      landmarks: [{ key: "k", name: "坑", category: "natural", kind: "crater", x: 3, y: 2, w: 1, h: 1, lore: "", discovery: null }],
    });
    expect(full.relief).toEqual(["...3", "...4", "...5"]);
    expect(full.biomes?.[2]).toBe("...A");
    expect(full.rivers).toEqual([{ key: "r", path: [[3, 0], [3, 1]], width: 2 }]);
    expect(full.landmarks?.[0]).toMatchObject({ key: "k", category: "natural", kind: "crater", x: 3, y: 2 });
  });
});

describe("平滑的海岸", () => {
  const geo = geoLayers(synth.input);
  const coast = coastPixels(geo);
  const { PW, PH, land } = coast;
  const blocky = new Uint8Array(PW * PH);
  for (let py = 0; py < PH; py++) for (let px = 0; px < PW; px++) blocky[py * PW + px] = geo.terr[Math.floor(py / C) * geo.W + Math.floor(px / C)] === 2 ? 1 : 0;

  /** 直角拐点：边界在这里转 90°，且两条边都至少直直地延伸 3 像素。 */
  function rightAngles(m: Uint8Array): number {
    const L = (x: number, y: number) => (x >= 0 && y >= 0 && x < PW && y < PH ? m[y * PW + x] : 0);
    let n = 0;
    for (let y = 4; y < PH - 4; y++) {
      for (let x = 4; x < PW - 4; x++) {
        // 以像素角点 (x, y) 为中心的 2×2 窗口：左上 a、右上 b、左下 c、右下 d
        const a = L(x - 1, y - 1);
        const b = L(x, y - 1);
        const c = L(x - 1, y);
        const d = L(x, y);
        const s = a + b + c + d;
        if (s !== 1 && s !== 3) continue;
        // 找出与众不同的那一格，两条边分别沿水平与竖直方向离开角点
        const odd = s === 1 ? 1 : 0;
        const dx = a === odd || c === odd ? -1 : 1;
        const dy = a === odd || b === odd ? -1 : 1;
        const ox = dx < 0 ? x - 1 : x;
        const oy = dy < 0 ? y - 1 : y;
        let straight = true;
        for (let k = 1; k <= 3 && straight; k++) {
          // 水平边：奇异格所在行向外延伸，另一行保持相反
          straight = L(ox + dx * k, oy) === odd && L(ox + dx * k, oy - dy) === 1 - odd;
          straight &&= L(ox, oy + dy * k) === odd && L(ox - dx, oy + dy * k) === 1 - odd;
        }
        if (straight) n++;
      }
    }
    return n;
  }

  it("海岸不沿格线：与逐格方块相比，直角拐点显著减少，沿格线的边界只占少数", () => {
    const smooth = rightAngles(land);
    const square = rightAngles(blocky);
    expect(square).toBeGreaterThan(500);
    expect(smooth).toBeLessThan(square * 0.3);
    // 水平相邻的海陆交界落在格线上的比例（逐格方块为 100%）
    let onGrid = 0;
    let total = 0;
    for (let y = 0; y < PH; y++)
      for (let x = 1; x < PW; x++) {
        if (land[y * PW + x] === land[y * PW + x - 1]) continue;
        total++;
        if (x % C === 0) onGrid++;
      }
    expect(total).toBeGreaterThan(1000);
    expect(onGrid / total).toBeLessThan(0.5);
  });

  it("与航行用的海陆图一致：每个陆格中心是陆地、每个海格中心是海", () => {
    for (let y = 0; y < geo.H; y++)
      for (let x = 0; x < geo.W; x++) {
        const isLand = geo.terr[y * geo.W + x] === 2 ? 1 : 0;
        for (const [ox, oy] of [
          [1, 1],
          [2, 1],
          [1, 2],
          [2, 2],
        ])
          if (land[(y * C + oy) * PW + x * C + ox] !== isLand) throw new Error(`格 (${x}, ${y}) 的中心与海陆图不一致`);
      }
  });
});

describe("河流", () => {
  it("每条河的水线都在陆地上，入海口连着海，由细到宽", () => {
    const geo = geoLayers(synth.input);
    const coast = coastPixels(geo);
    const { PW, PH, land } = coast;
    const rivers = synth.input.rivers ?? [];
    expect(rivers.length).toBeGreaterThan(5);
    for (const r of rivers) {
      const stroke = riverStroke(r, geo, C);
      expect(stroke).not.toBeNull();
      const mask = new Uint8Array(PW * PH);
      const { water } = rasterStroke(stroke!, coast, mask);
      expect(water.length).toBeGreaterThan(r.path.length);
      for (const i of water) expect(land[i]).toBe(1);
      const touchesSea = water.some((i) => {
        const x = i % PW;
        return [i - 1, i + 1, i - PW, i + PW].some((j) => j >= 0 && j < PW * PH && Math.abs((j % PW) - x) <= 1 && land[j] === 0);
      });
      expect(touchesSea, `${r.key} 的入海口没有连到海`).toBe(true);
      // 源头细、入海处宽
      const main = stroke!.main;
      expect(main[0].r).toBeLessThan(main[main.length - 1].r);
    }
  });

  it("画在海图上：河水像素全在陆地上；宽河在低洼的入海口分出汊流（三角洲）", () => {
    const layers = paintChartLayers(synth.input, 1);
    let n = 0;
    for (let i = 0; i < layers.river.length; i++) {
      if (!layers.river[i]) continue;
      n++;
      expect(layers.coast.land[i]).toBe(1);
    }
    expect(n).toBeGreaterThan(500);
    // 手写一条宽河流进湿地的入海口：出现汊流
    const input = island(60, 40, (x) => (x > 44 ? "W" : "G"), (x) => (x > 44 ? 0 : 3));
    const path: [number, number][] = [];
    for (let x = 10; x <= 53; x++) path.push([x, 20]);
    const geo = geoLayers(input);
    const stroke = riverStroke({ path, width: 3 }, geo, C);
    expect(stroke?.delta).toBe(true);
    expect(stroke?.branches.length).toBeGreaterThanOrEqual(1);
  });
});

describe("人文景观与道路", () => {
  const layers = paintChartLayers(synth.input, 1);
  const { geo, coast, culture, road, river } = layers;
  const places = synth.input.places ?? [];
  const nearPlace = (px: number, py: number, r: number) => places.some((p) => Math.hypot(p.x - px / C, p.y - py / C) <= r);
  const arableNear = (px: number, py: number) => {
    const cx = Math.floor(px / C);
    const cy = Math.floor(py / C);
    for (let dy = -3; dy <= 3; dy++)
      for (let dx = -3; dx <= 3; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= geo.W || y >= geo.H) continue;
        const i = y * geo.W + x;
        if (geo.terr[i] === 2 && arable(geo.veg[i])) return true;
      }
    return false;
  };

  it("田地只在地点附近、只在能开垦的陆地上；房屋与建筑也只在陆地上、地点附近", () => {
    let fields = 0;
    let buildings = 0;
    for (let i = 0; i < culture.length; i++) {
      if (!culture[i]) continue;
      const px = i % coast.PW;
      const py = (i - px) / coast.PW;
      if (culture[i] === 1) {
        fields++;
        expect(coast.land[i]).toBe(1);
        // 影响半径最多 9 格，边界的噪声扭曲约 1 格
        expect(nearPlace(px, py, 11), `田地 (${px}, ${py}) 离地点太远`).toBe(true);
        expect(arableNear(px, py), `田地 (${px}, ${py}) 附近没有能开垦的陆地`).toBe(true);
      } else {
        buildings++;
        // 矿场可远到影响半径外 10 格，建筑本身约 3 格
        expect(nearPlace(px, py, 23), `建筑 (${px}, ${py}) 离地点太远`).toBe(true);
      }
    }
    expect(fields).toBeGreaterThan(2000);
    expect(buildings).toBeGreaterThan(200);
    // 冰原与高山上没有田
    for (let y = 0; y < geo.H; y++)
      for (let x = 0; x < geo.W; x++) {
        const v = geo.veg[y * geo.W + x];
        if (v !== VEG.ICE && v !== VEG.ALPINE) continue;
        let clean = true;
        // 只看四周 3 格都不能开垦的格的中心
        if (arableNear(x * C + 2, y * C + 2)) continue;
        for (let k = 0; k < C * C; k++) if (culture[(y * C + Math.floor(k / C)) * coast.PW + x * C + (k % C)] === 1) clean = false;
        expect(clean).toBe(true);
      }
  });

  it("道路不穿海：路面与桥都在陆地上，桥只架在河上", () => {
    let paved = 0;
    let bridge = 0;
    for (let i = 0; i < road.length; i++) {
      if (!road[i]) continue;
      expect(coast.land[i]).toBe(1);
      if (road[i] === 1) {
        paved++;
        expect(river[i]).toBe(0);
      } else bridge++;
    }
    expect(paved).toBeGreaterThan(200);
    // 手写：一条河横穿两座城之间，路要过桥；两座城隔着海峡时不画路
    const input = island(60, 40, () => "G");
    const rows = [...input.rows];
    input.rivers = [{ path: Array.from({ length: 28 }, (_, k) => [30, 6 + k] as [number, number]), width: 2 }];
    input.places = [
      { x: 12, y: 20, kind: "city", faction: "cuilan" },
      { x: 48, y: 20, kind: "city", faction: "cuilan" },
    ];
    input.roads = [{ from: [12, 20], to: [48, 20] }];
    const withBridge = paintChartLayers({ ...input, rows }, 1);
    let b = 0;
    for (let i = 0; i < withBridge.road.length; i++) if (withBridge.road[i] === 2) b++;
    expect(b + bridge).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(0);
    const strait = rows.map((r) => r.slice(0, 29) + "~~" + r.slice(31));
    const cut = paintChartLayers({ ...input, rows: strait, rivers: [], relief: undefined, biomes: undefined }, 1);
    for (let i = 0; i < cut.road.length; i++) if (cut.road[i]) throw new Error("隔着海峡的两座城之间画了路");
  });

  it("同样的地点重复多份时，人文景观完全相同（地点去重）", () => {
    const doubled: ChartInput = { ...synth.input, places: (synth.input.places ?? []).flatMap((p) => [p, { ...p }]) };
    const again = paintChartLayers(doubled, 1);
    expect(same(again.px, layers.px)).toBe(true);
  });
});

describe("地标与奇观", () => {
  it("各种地标图标两两不同，认不出的 kind 按类别画通用图样", () => {
    const icons = [...LANDMARK_KINDS.map((k) => drawLandmarkIcon(k, "natural")), ...LANDMARK_CATEGORIES.map((c) => drawLandmarkIcon("什么也不是", c))];
    expect(icons.length).toBeGreaterThanOrEqual(30);
    for (const p of icons) expect(p.bounds()).not.toBeNull();
    for (let i = 0; i < icons.length; i++) for (let j = i + 1; j < icons.length; j++) expect(same(icons[i], icons[j]), `${i} 与 ${j} 相同`).toBe(false);
    // 关键词归类：更具体的词优先，同类别优先
    expect(landmarkIconKey("starfall_crater", "natural")).toBe("crater");
    expect(landmarkIconKey("crater_lagoon", "natural")).toBe("crater");
    expect(landmarkIconKey("star_tower", "civic")).toBe("observatory");
    expect(landmarkIconKey("arcan_colossus", "ancient")).toBe("colossus");
    expect(landmarkIconKey("ruined_tower", "ancient")).toBe("ruins");
    expect(landmarkIconKey("xyz", "arcane")).toBeNull();
    // 同一种图样在各处风格一致（按图样自己的类别描边）
    expect(same(drawLandmarkIcon("world_tree", "natural"), drawLandmarkIcon("world_tree", "arcane"))).toBe(true);
  });

  it("地标画进海图（在占地附近），未探明时被迷雾整块盖住", () => {
    const input = island(60, 40, () => "G");
    const plain = paintChartLayers(input, 1).px;
    const withMark = paintChartLayers({ ...input, landmarks: [{ key: "t", category: "arcane", kind: "world_tree", x: 30, y: 20 }] }, 1).px;
    let changed = 0;
    let far = 0;
    for (let y = 0; y < plain.h; y++)
      for (let x = 0; x < plain.w; x++) {
        if (plain.data[y * plain.w + x] === withMark.data[y * plain.w + x]) continue;
        changed++;
        if (Math.abs(x - 30 * C - 2) > 16 || Math.abs(y - 20 * C - 2) > 16) far++;
      }
    expect(changed).toBeGreaterThan(60);
    expect(far).toBe(0);
    // 迷雾：未探明的格子上是不透明的云团
    const fog = drawFog(Array.from({ length: 40 }, () => "0".repeat(60)), 60, 40);
    for (let y = 20 * C - 8; y < 20 * C + 8; y++) for (let x = 30 * C - 8; x < 30 * C + 8; x++) expect(fog.get(x, y) & 0xff).toBe(0xff);
  });

  it("线状的古迹（长城、古道、引水渠）沿占地的长边画成一条线，只画在陆地上", () => {
    const input = island(60, 40, () => "G");
    const plain = paintChartLayers(input, 1);
    for (const kind of ["great_wall", "ancient_road", "aqueduct"]) {
      const lined = paintChartLayers({ ...input, landmarks: [{ key: "w", category: "ancient", kind, x: 2, y: 20, w: 50, h: 1 }] }, 1);
      const cols = new Set<number>();
      for (let y = 18 * C; y < 23 * C; y++)
        for (let x = 0; x < plain.px.w; x++) {
          const i = y * plain.px.w + x;
          if (plain.px.data[i] === lined.px.data[i]) continue;
          if (!lined.coast.land[i]) throw new Error(`${kind} 画到了海上 (${x}, ${y})`);
          cols.add(x);
        }
      // 从陆地的西岸画到东岸
      expect(cols.size, kind).toBeGreaterThan(35 * C);
    }
  });
});
