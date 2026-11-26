// 细海图（第九批 M01）的离线出图：不开浏览器，用仓库里真实的寰宇数据把几处海域画成 PNG，方便核对。
// 用法（在 frontend 目录下）：
//   npx vite-node scripts/map-1111.ts                 # 全部地区、夏冬两季：细节档、远档、新旧对照
//   npx vite-node scripts/map-1111.ts west-japan      # 只画名字里带 west-japan 的地区
//   npx vite-node scripts/map-1111.ts --quick norway  # 只画细节档（不画整张远档与旧画法，快）
//   npx vite-node scripts/map-1111.ts --bench         # 只量一块细节瓦片的耗时
// 输出到仓库根的 local-release/map-1111/（不入库）。
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";
import { DETAIL_CELL, DETAIL_TILE, detailContext, paintDetailTile, type DetailContext } from "../src/art/map/detail";
import { decodeFineCoast, decodeFineElevation, decodeFineRivers, type FineLayers, type Inflate } from "../src/art/map/fine";
import { paintChart } from "../src/art/map/terrain";
import { CHART_CELL, type ChartInput } from "../src/art/map/types";
import { Px } from "../src/art/px";
import { encodePng } from "./png";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..", "..");
const mapDir = join(repo, "data", "maps", "earth");
const outDir = join(repo, "local-release", "map-1111");

const args = process.argv.slice(2);
const quick = args.includes("--quick");
const bench = args.includes("--bench");
const filters = args.filter((a) => !a.startsWith("-"));

/** 图层文件的行（去掉注释行与空行）。 */
function layerRows(name: string): string[] {
  return readFileSync(join(mapDir, name), "utf8")
    .split(/\r?\n/)
    .filter((l) => l.length > 0 && !l.startsWith("//"));
}

const inflate: Inflate = async (data) => new Uint8Array(inflateSync(data));

async function loadFine(): Promise<FineLayers> {
  const read = (name: string) => new Uint8Array(readFileSync(join(mapDir, "fine", name)));
  const coast = await decodeFineCoast(read("coast.bin"), inflate);
  const elevation = await decodeFineElevation(read("elevation.bin"), inflate);
  const rivers = await decodeFineRivers(read("rivers.bin"), inflate);
  return { hash: "offline", ...coast, ...elevation, rivers };
}

/** 锚地表里的地点（港口与城市）：只取格坐标——画田畴与民居用，势力不管（按缺省的建筑风格）。 */
function earthPlaces(): NonNullable<ChartInput["places"]> {
  const text = readFileSync(join(mapDir, "anchors.toml"), "utf8");
  const out: NonNullable<ChartInput["places"]>[number][] = [];
  for (const block of text.split(/\n(?=\[\[)/)) {
    const kind = block.startsWith("[[ports]]") ? "port" : block.startsWith("[[cities]]") ? "city" : null;
    const pos = /\npos = \[(\d+), (\d+)\]/.exec(block);
    if (kind && pos) out.push({ x: Number(pos[1]), y: Number(pos[2]), kind, faction: "" });
  }
  return out;
}

/** 地标（landmarks.toml）。 */
function earthLandmarks(): NonNullable<ChartInput["landmarks"]> {
  const text = readFileSync(join(mapDir, "landmarks.toml"), "utf8");
  const out: NonNullable<ChartInput["landmarks"]>[number][] = [];
  for (const block of text.split(/\n(?=\[\[)/)) {
    const get = (k: string) => new RegExp(`\\n${k} = "([^"]*)"`).exec(block)?.[1];
    const pos = /\npos = \[(\d+), (\d+)\]/.exec(block);
    const [key, kind, category] = [get("key"), get("kind"), get("category")];
    if (key && kind && pos) out.push({ key, kind, category: (category ?? "natural") as "natural" | "civic", x: Number(pos[1]), y: Number(pos[2]) });
  }
  return out;
}

/** 寰宇的海图输入（与应用里由 map_resource 整理出的相同：浅海 '-'、深海 '~'、奥术地貌按草地）。 */
function earthInput(fine: FineLayers | null): ChartInput {
  const rows = layerRows("map.txt").map((r) => r.replace(/~/g, "-").replace(/\./g, "~"));
  const input: ChartInput = {
    width: rows[0].length,
    height: rows.length,
    rows,
    relief: layerRows("relief.txt"),
    biomes: layerRows("biomes.txt").map((r) => r.replace(/X/g, "G")),
    projection: { kind: "equirect", west: -10800, north: 4320, arcmin_per_cell: 20 },
    wrapX: true,
    places: earthPlaces(),
    landmarks: earthLandmarks(),
  };
  if (fine) input.fine = fine;
  return input;
}

/** 要画的地区：西、南、东、北（度）。 */
const REGIONS: { name: string; title: string; box: [number, number, number, number] }[] = [
  { name: "west-japan", title: "西日本（下田—长崎—釜山）", box: [127.5, 30.5, 139.5, 36.5] },
  { name: "gibraltar", title: "直布罗陀与地中海西部", box: [-10, 33, 6, 42] },
  { name: "bosporus", title: "东地中海与黑海口", box: [22, 34, 34, 43] },
  { name: "caribbean", title: "加勒比（古巴—伊斯帕尼奥拉）", box: [-86, 16, -66, 24] },
  { name: "malacca-java", title: "马六甲海峡与爪哇", box: [95, -9, 116, 7] },
  { name: "baltic-denmark", title: "波罗的海与丹麦海峡", box: [4, 53, 24, 61] },
  { name: "norway", title: "挪威海岸", box: [3, 58, 20, 71] },
  { name: "redsea-gulf", title: "红海与波斯湾", box: [32, 11, 58, 31] },
];
const SEASONS: [number, string][] = [
  [1, "summer"],
  [3, "winter"],
];

/** 经纬范围 → 粗格范围（含左上、不含右下）。 */
function cellsOf([west, south, east, north]: [number, number, number, number]): { x0: number; y0: number; x1: number; y1: number } {
  return { x0: Math.floor((west + 180) * 3), y0: Math.floor((72 - north) * 3), x1: Math.ceil((east + 180) * 3), y1: Math.ceil((72 - south) * 3) };
}

function save(name: string, w: number, h: number, rgba: Uint8Array | Uint8ClampedArray) {
  const path = join(outDir, name);
  writeFileSync(path, encodePng(w, h, rgba));
  console.log(`${name}  ${w}×${h}`);
}

/** 细节档：把盖住这片粗格的瓦片画出来、拼好、裁出。返回 RGBA。 */
function detailRegion(ctx: DetailContext, season: number, r: { x0: number; y0: number; x1: number; y1: number }, times: number[]) {
  const S = DETAIL_CELL;
  const w = (r.x1 - r.x0) * S;
  const h = (r.y1 - r.y0) * S;
  const out = new Uint8ClampedArray(w * h * 4);
  for (let ty = Math.floor(r.y0 / DETAIL_TILE); ty * DETAIL_TILE < r.y1; ty++) {
    for (let tx = Math.floor(r.x0 / DETAIL_TILE); tx * DETAIL_TILE < r.x1; tx++) {
      const t0 = performance.now();
      const img = paintDetailTile(ctx, season, tx, ty);
      times.push(performance.now() - t0);
      for (let y = 0; y < img.h; y++) {
        const oy = img.y + y - r.y0 * S;
        if (oy < 0 || oy >= h) continue;
        const sx0 = Math.max(0, r.x0 * S - img.x);
        const sx1 = Math.min(img.w, r.x1 * S - img.x);
        if (sx1 <= sx0) continue;
        out.set(img.data.subarray((y * img.w + sx0) * 4, (y * img.w + sx1) * 4), (oy * w + img.x + sx0 - r.x0 * S) * 4);
      }
    }
  }
  return { w, h, data: out };
}

/** 从整张海图（每格 4 像素）裁出一片粗格，最近邻放大 k 倍。 */
function chartRegion(chart: Px, r: { x0: number; y0: number; x1: number; y1: number }, k: number) {
  const C = CHART_CELL;
  const w = (r.x1 - r.x0) * C * k;
  const h = (r.y1 - r.y0) * C * k;
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const sy = r.y0 * C + Math.floor(y / k);
    for (let x = 0; x < w; x++) {
      const v = chart.data[sy * chart.w + r.x0 * C + Math.floor(x / k)];
      const o = (y * w + x) * 4;
      out[o] = v >>> 24;
      out[o + 1] = (v >>> 16) & 0xff;
      out[o + 2] = (v >>> 8) & 0xff;
      out[o + 3] = v & 0xff;
    }
  }
  return { w, h, data: out };
}

/** 左右并排（中间留 8 像素的深色缝）。 */
function sideBySide(a: { w: number; h: number; data: Uint8ClampedArray }, b: { w: number; h: number; data: Uint8ClampedArray }) {
  const gap = 8;
  const w = a.w + gap + b.w;
  const h = Math.max(a.h, b.h);
  const out = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    out[i * 4] = 26;
    out[i * 4 + 1] = 20;
    out[i * 4 + 2] = 35;
    out[i * 4 + 3] = 255;
  }
  for (let y = 0; y < a.h; y++) out.set(a.data.subarray(y * a.w * 4, (y + 1) * a.w * 4), y * w * 4);
  for (let y = 0; y < b.h; y++) out.set(b.data.subarray(y * b.w * 4, (y + 1) * b.w * 4), (y * w + a.w + gap) * 4);
  return { w, h, data: out };
}

mkdirSync(outDir, { recursive: true });
const fine = await loadFine();
const input = earthInput(fine);
const ctx = detailContext(input);
if (!ctx) throw new Error("细图层与航行网格对不上");

if (bench) {
  // 一块细节瓦片的耗时：纯海、纯陆、海岸各取几块（先各画一遍热身）
  const cases: [string, number, number][] = [
    ["太平洋（纯海）", 2, 5],
    ["西伯利亚（纯陆）", 25, 1],
    ["西日本（海岸）", 29, 3],
    ["爱琴海（海岸）", 19, 3],
    ["阿尔卑斯（山地）", 17, 2],
    ["亚马孙（雨林与河）", 11, 7],
  ];
  for (const [name, tx, ty] of cases) {
    for (let i = 0; i < 4; i++) paintDetailTile(ctx, i, tx, ty);
    const t: number[] = [];
    for (let i = 0; i < 12; i++) {
      const t0 = performance.now();
      paintDetailTile(ctx, i % 4, tx, ty);
      t.push(performance.now() - t0);
    }
    t.sort((a, b) => a - b);
    console.log(`${name}  瓦片 (${tx},${ty})  最快 ${t[0].toFixed(1)} ms  中位 ${t[6].toFixed(1)} ms  最慢 ${t[11].toFixed(1)} ms`);
  }
  process.exit(0);
}

const picked = REGIONS.filter((r) => filters.length === 0 || filters.some((f) => r.name.includes(f)));
for (const [season, sname] of SEASONS) {
  let far: Px | null = null;
  let old: Px | null = null;
  if (!quick) {
    let t0 = performance.now();
    far = paintChart(input, season);
    console.log(`远档整图（真实海岸）${sname}：${(performance.now() - t0).toFixed(0)} ms`);
    t0 = performance.now();
    old = paintChart(earthInput(null), season);
    console.log(`旧画法整图 ${sname}：${(performance.now() - t0).toFixed(0)} ms`);
  }
  for (const region of picked) {
    const cells = cellsOf(region.box);
    const times: number[] = [];
    const detail = detailRegion(ctx, season, cells, times);
    save(`detail-${region.name}-${sname}.png`, detail.w, detail.h, detail.data);
    console.log(`  ${region.title}：${times.length} 块瓦片，平均 ${(times.reduce((a, b) => a + b, 0) / times.length).toFixed(1)} ms，最慢 ${Math.max(...times).toFixed(1)} ms`);
    if (far && old) {
      // 远档：每格 4 个美术像素，按缺省远档的 3 倍放大（一格 12 屏幕像素）
      const farImg = chartRegion(far, cells, 3);
      save(`far-${region.name}-${sname}.png`, farImg.w, farImg.h, farImg.data);
      // 新旧对照：左边是旧画法（每格 4 像素放大 6 倍，与右边同样大小），右边是细节档
      const oldImg = chartRegion(old, cells, 6);
      const cmp = sideBySide(oldImg, detail);
      save(`compare-${region.name}-${sname}.png`, cmp.w, cmp.h, cmp.data);
    }
  }
}
