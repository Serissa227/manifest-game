// 航海图预览（npx vite-node scripts/art-preview.ts map）：
// 整张海图（四季）、按第五批写实地理选取的局部放大（zoom-*：巨人之门、北境峡湾、萨菲拉三角洲、马纳瓦群岛、新大陆各段、瑶华……）、
// 各文化港口周边的人文景观（town-*）、每处地标在海图上的样子（landmarks-on-chart）、植被图层示意（biomes-data），
// 各种标记（含殖民点与发现物），以及把海图、迷雾与标记叠在一起的“示意海图”。控制台打印海图的生成耗时。
// 数据里有 §10.3 的图层（relief.txt、biomes.txt、rivers.toml、landmarks.toml）时一并读入，没有时按回退推导；
// 另用临时的合成世界（map/synth.ts，只用于预览）检验写实地理下的画法：synth-* 与 synth-zoom-*，以及地标图标总览。
import { ARCH_STYLES } from "./buildings";
import {
  BIOME,
  CHART_CELL,
  biomeGrid,
  DISCOVERY_KINDS,
  PLAYER_FLAG,
  drawCaravanMarker,
  drawChart,
  drawChevron,
  drawCityMarker,
  drawCompassRose,
  drawDestPin,
  drawDiscoveryMarker,
  drawFlagshipRing,
  drawFog,
  drawPortMarker,
  drawRouteDot,
  drawSelectFrame,
  drawSiteMarker,
  drawWake,
  drawWindArrow,
  markerStyle,
  type ChartInput,
  type ChartPlace,
  type SiteMark,
} from "./map";
import { paintChart } from "./map/terrain";
import { synthWorld } from "./map/synth";
import { LANDMARK_CATEGORIES, LANDMARK_KINDS, drawLandmarkIcon } from "./map/landmarks";
import type { ChartLandmark, ChartRiver, LandmarkCategory } from "./map/types";
import { Px, sheet, type Preview, type PreviewContext } from "./px";
import { drawShip } from "./ships";

// 势力数据没有写颜色时的后备旗色（按 factions.toml 的顺序）
const FALLBACK_COLORS = ["#c0392b", "#2e86c1", "#d4ac0d", "#27ae60", "#8e44ad", "#d35400", "#16a085", "#7f8c8d"];

interface Loc extends ChartPlace {
  key: string;
}

interface Disc {
  key: string;
  x: number;
  y: number;
  kind: string;
}

/** 读可选的数据文件（缺失时为空串）。 */
function readOptional(ctx: PreviewContext, path: string): string {
  try {
    return ctx.readText(path);
  } catch {
    return "";
  }
}

/** 从 toml 文本里粗读 [[表]] 的 key / pos / faction / terrain（只用于预览）。table 为 null 时读全部表。 */
function readLocs(text: string, kind: ChartPlace["kind"], table: string | null): Loc[] {
  const out: Loc[] = [];
  for (const block of text.split(/\n\[\[/).slice(1)) {
    if (table && !block.startsWith(`${table}]]`)) continue;
    const key = /\nkey\s*=\s*"([^"]+)"/.exec(block)?.[1];
    const pos = /\npos\s*=\s*\[\s*(\d+)\s*,\s*(\d+)\s*\]/.exec(block);
    const faction = /\nfaction\s*=\s*"([^"]+)"/.exec(block)?.[1] ?? "";
    const terrain = /\nterrain\s*=\s*"([^"]+)"/.exec(block)?.[1] ?? null;
    if (key && pos && (faction || kind === "site")) out.push({ key, x: Number(pos[1]), y: Number(pos[2]), kind, faction, terrain });
  }
  return out;
}

/** 读字符网格图层（去掉 // 注释行）；文件缺失时为 undefined。 */
function readGrid(ctx: PreviewContext, path: string): string[] | undefined {
  const text = readOptional(ctx, path);
  if (!text) return undefined;
  return text.split(/\r?\n/).filter((l) => l.length > 0 && !l.startsWith("//"));
}

/** 粗读 rivers.toml（只用于预览）。 */
function readRivers(text: string): ChartRiver[] {
  const out: ChartRiver[] = [];
  for (const block of text.split(/\n\[\[/).slice(1)) {
    if (!block.startsWith("rivers]]")) continue;
    const width = Number(/\nwidth\s*=\s*(\d+)/.exec(block)?.[1] ?? 1);
    const at = block.indexOf("path");
    if (at < 0) continue;
    const rest = block.slice(at).split(/\n[a-z_]+\s*=/)[0];
    const path = [...rest.matchAll(/\[\s*(\d+)\s*,\s*(\d+)\s*\]/g)].map((m) => [Number(m[1]), Number(m[2])] as const);
    out.push({ key: /\nkey\s*=\s*"([^"]+)"/.exec(block)?.[1], path, width });
  }
  return out;
}

/** 粗读 landmarks.toml（只用于预览）。 */
function readLandmarks(text: string): ChartLandmark[] {
  const out: ChartLandmark[] = [];
  for (const block of text.split(/\n\[\[/).slice(1)) {
    const key = /\nkey\s*=\s*"([^"]+)"/.exec(block)?.[1];
    const pos = /\npos\s*=\s*\[\s*(\d+)\s*,\s*(\d+)\s*\]/.exec(block);
    if (!key || !pos) continue;
    const size = /\nsize\s*=\s*\[\s*(\d+)\s*,\s*(\d+)\s*\]/.exec(block);
    out.push({
      key,
      category: (/\ncategory\s*=\s*"([^"]+)"/.exec(block)?.[1] ?? "natural") as LandmarkCategory,
      kind: /\nkind\s*=\s*"([^"]+)"/.exec(block)?.[1] ?? "",
      x: Number(pos[1]),
      y: Number(pos[2]),
      w: size ? Number(size[1]) : 1,
      h: size ? Number(size[2]) : 1,
    });
  }
  return out;
}

function readWorld(ctx: PreviewContext): { input: ChartInput; locs: Loc[]; discs: Disc[]; colors: Record<string, string>; factions: string[] } {
  // 地图文件：'.' 深海 '~' 浅海 '#' 陆地 → 转成 StaticView 的编码：'~' 深海 '-' 浅海 '#' 陆地
  const rows = ctx
    .readText("data/world/map.txt")
    .split(/\r?\n/)
    .filter((l) => l.length > 0 && !l.startsWith("//"))
    .map((l) => [...l].map((ch) => (ch === "#" ? "#" : ch === "~" ? "-" : "~")).join(""));
  const overseas = readOptional(ctx, "data/world/overseas.toml");
  const locs = [
    ...readLocs(ctx.readText("data/world/ports.toml"), "port", null),
    ...readLocs(ctx.readText("data/world/cities.toml"), "city", null),
    ...readLocs(overseas, "port", "ports"),
    ...readLocs(overseas, "site", "sites"),
  ];
  const byKey = new Map(locs.map((l) => [l.key, l]));
  const roads = [];
  for (const block of ctx.readText("data/world/roads.toml").split(/\n\[\[/).slice(1)) {
    const a = byKey.get(/\nfrom\s*=\s*"([^"]+)"/.exec(block)?.[1] ?? "");
    const b = byKey.get(/\nto\s*=\s*"([^"]+)"/.exec(block)?.[1] ?? "");
    if (a && b) roads.push({ from: [a.x, a.y] as const, to: [b.x, b.y] as const });
  }
  const discs: Disc[] = [];
  for (const block of readOptional(ctx, "data/world/discoveries.toml").split(/\n\[\[/).slice(1)) {
    const key = /\nkey\s*=\s*"([^"]+)"/.exec(block)?.[1];
    const pos = /\npos\s*=\s*\[\s*(\d+)\s*,\s*(\d+)\s*\]/.exec(block);
    const kind = /\nkind\s*=\s*"([^"]+)"/.exec(block)?.[1] ?? "";
    if (key && pos) discs.push({ key, x: Number(pos[1]), y: Number(pos[2]), kind });
  }
  const colors: Record<string, string> = {};
  const factions: string[] = [];
  ctx
    .readText("data/factions.toml")
    .split(/\n\[\[/)
    .slice(1)
    .forEach((block, i) => {
      const key = /\nkey\s*=\s*"([^"]+)"/.exec(block)?.[1];
      if (!key) return;
      factions.push(key);
      colors[key] = /\ncolor\s*=\s*"(#[0-9a-fA-F]{6})"/.exec(block)?.[1] ?? FALLBACK_COLORS[i % FALLBACK_COLORS.length];
    });
  const input: ChartInput = { width: rows[0]?.length ?? 1, height: rows.length, rows, places: locs, roads };
  const relief = readGrid(ctx, "data/world/relief.txt");
  const biomes = readGrid(ctx, "data/world/biomes.txt");
  if (relief) input.relief = relief;
  if (biomes) input.biomes = biomes;
  const rivers = readOptional(ctx, "data/world/rivers.toml");
  if (rivers) input.rivers = readRivers(rivers);
  const landmarks = readOptional(ctx, "data/world/landmarks.toml");
  if (landmarks) input.landmarks = readLandmarks(landmarks);
  return { input, locs, discs, colors, factions };
}

/** 从 (x(0), y0) 一路向南、直到下一格是海为止的河道（海岸图鉴用）。 */
function downTo(rows: readonly string[], x: (k: number) => number, y0: number): [number, number][] {
  const out: [number, number][] = [];
  for (let k = 0; y0 + k < rows.length - 1; k++) {
    const y = y0 + k;
    out.push([x(k), y]);
    if (rows[y + 1][x(k + 1)] !== "#") break;
  }
  return out;
}

/** 离 (x, y) 最近的海格（按格；找不到时原样返回）。示意海图里的船、航线端点放在海上。 */
function nearestSea(input: ChartInput, x: number, y: number): [number, number] {
  for (let r = 0; r < 12; r++)
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const xx = x + dx;
        const yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < input.width && yy < input.height && input.rows[yy][xx] !== "#") return [xx, yy];
      }
  return [x, y];
}

/** 迷雾示例：揭开几座港口周围与一条航线两侧，以及新大陆的一段海岸。 */
function sampleFog(input: ChartInput, locs: Loc[], route: readonly [number, number, number, number]): string[] {
  const W = input.width;
  const H = input.height;
  const g = Array.from({ length: H }, () => new Array<string>(W).fill("0"));
  const reveal = (cx: number, cy: number, r: number) => {
    for (let y = cy - r; y <= cy + r; y++)
      for (let x = cx - r; x <= cx + r; x++)
        if (x >= 0 && y >= 0 && x < W && y < H && (x - cx) ** 2 + (y - cy) ** 2 <= r * r) g[y][x] = "1";
  };
  for (const k of ["chenggang", "liuwan", "shimen", "dengta", "shanhu", "bichaogang", "lancheng", "wujiao", "novamar", "motu_hou", "crescent_shore", "goldvein_hills"]) {
    const l = locs.find((v) => v.key === k);
    if (l) reveal(l.x, l.y, 9);
  }
  const [ax, ay, bx, by] = route;
  for (let t = 0; t <= 20; t++) reveal(Math.round(ax + (bx - ax) * (t / 20)), Math.round(ay + (by - ay) * (t / 20)), 6);
  // 巨人之门出海、横穿晨星洋到诺瓦马尔
  for (let t = 0; t <= 30; t++) reveal(Math.round(230 + (338 - 230) * (t / 30)), 104, 7);
  return g.map((r) => r.join(""));
}

const cc = (v: number) => v * CHART_CELL + CHART_CELL / 2;

/** 示意用的殖民点状态：一部分被势力占领，几处已建殖民地（主角的与别家商会的）。 */
function demoMark(i: number, factions: string[], colors: Record<string, string>): SiteMark {
  if (i === 3) return { colony: { flag: PLAYER_FLAG, size: 2 } };
  if (i === 8) return { colony: { flag: PLAYER_FLAG, size: 0 } };
  if (i === 12) return { colony: { flag: PLAYER_FLAG, size: 1 } };
  if (i === 17) return { colony: { flag: "#8e44ad", size: 1 } };
  if (i % 4 === 1) return { claim: colors[factions[i % factions.length]] ?? "#c0392b" };
  return {};
}

export default function preview(ctx: PreviewContext): Preview[] {
  const { input, locs, discs, colors, factions } = readWorld(ctx);
  const out: Preview[] = [];
  const t0 = Date.now();
  const summer = drawChart(input, { season: 1 });
  const cold = Date.now() - t0;
  // 预热之后再量几次，取最短的一次（不含首次编译）
  let warm = Infinity;
  for (let k = 0; k < 3; k++) {
    const t = Date.now();
    paintChart(input, 1);
    warm = Math.min(warm, Date.now() - t);
  }
  console.log(`  海图 ${input.width}×${input.height}、${input.places?.length ?? 0} 个地点：首次生成 ${cold} ms，预热后 ${warm} ms`);
  out.push({ name: "chart-summer", px: summer, scale: 1 });
  for (const [s, name] of [
    [0, "spring"],
    [2, "autumn"],
    [3, "winter"],
  ] as const) {
    out.push({ name: `chart-${name}`, px: drawChart(input, { season: s }), scale: 1 });
  }
  // 生物群系示意图：每格一种颜色（陆地），海为深蓝；黑点是港口与城市、白点是殖民点
  const BIOME_COLORS: Record<number, string> = {
    [BIOME.COLD]: "#ffffff",
    [BIOME.TEMPERATE]: "#6aad48",
    [BIOME.FARM]: "#f5d66b",
    [BIOME.ARID]: "#f0cf96",
    [BIOME.TROPIC]: "#4fd0c4",
    [BIOME.MEDIT]: "#b88a2a",
    [BIOME.BOREAL]: "#34405a",
    [BIOME.EAST]: "#e2789a",
    [BIOME.WILDWOOD]: "#24522d",
    [BIOME.PRAIRIE]: "#d2ad55",
    [BIOME.JUNGLE]: "#239a9a",
    [BIOME.SWAMP]: "#6b4026",
  };
  const grid = biomeGrid(input);
  const bm = new Px(input.width, input.height);
  for (let y = 0; y < input.height; y++)
    for (let x = 0; x < input.width; x++) bm.put(x, y, input.rows[y][x] === "#" ? BIOME_COLORS[grid[y * input.width + x]] : "#123a66");
  for (const l of locs) bm.put(l.x, l.y, l.kind === "site" ? "#ffffff" : "#000000");
  out.push({ name: "biomes", px: bm, scale: 3 });

  // 植被图层示意（数据的 biomes.txt，每格一种颜色；没有该图层时不输出）：黑点是港口与城市、白点是殖民点
  if (input.biomes) {
    const CODE_COLORS: Record<string, string> = {
      I: "#f4f8ff",
      T: "#9fb3a0",
      B: "#2f5d4a",
      F: "#3f8a3a",
      G: "#9cc45a",
      M: "#b8a24a",
      K: "#d6c07a",
      D: "#f0d49a",
      S: "#c9b25c",
      J: "#1f7a4a",
      W: "#4f8f7a",
      A: "#8e8e96",
      V: "#4a3a3a",
      X: "#b070d0",
    };
    const codes = input.biomes;
    const bd = new Px(input.width, input.height);
    for (let y = 0; y < input.height; y++)
      for (let x = 0; x < input.width; x++) bd.put(x, y, input.rows[y][x] === "#" ? (CODE_COLORS[codes[y]?.[x] ?? ""] ?? "#ff00ff") : "#123a66");
    for (const l of locs) bd.put(l.x, l.y, l.kind === "site" ? "#ffffff" : "#000000");
    out.push({ name: "biomes-data", px: bd, scale: 3 });
  }

  // 局部放大（坐标为格，按第五批的写实地理选取，见 docs/WORLD.md §4）：以 (cx, cy) 为中心裁 270×150 像素
  const C = CHART_CELL;
  const cropAt = (src: Px, cx: number, cy: number, w: number, h: number) =>
    src.crop(Math.max(0, Math.min(src.w - w, Math.round(cx * C - w / 2))), Math.max(0, Math.min(src.h - h, Math.round(cy * C - h / 2))), w, h);
  const crops: [string, number, number][] = [
    ["gate", 255, 104], // 巨人之门：南北巨像、海峡里的断链、门外的巨人礁与海渊大漩涡
    ["north-fjords", 128, 16], // 北境诺德海姆：峡湾、针叶林、法尔克维克与斯内维克、富鲁堡
    ["north-west", 72, 22], // 白鲸海、伊斯布伦火山半岛与温泉港、维特海姆
    ["safira-delta", 114, 103], // 萨菲拉三角洲（主河道与东西汊道）、卡迪拉、米兹拉
    ["safira-corridor", 88, 138], // 萨菲拉河穿过大沙漠的绿色走廊、月山
    ["manawa", 118, 66], // 马纳瓦群岛：陶拉尼、莫蒂亚、拉玛塔、阿卡科拉、阿希卡与火山岛弧
    ["arcanis", 151, 92], // 哈拉半岛外的破火山口与沉城、哈拉湾
    ["esperan", 36, 60], // 埃斯佩兰：王都塞雷尼萨、塞雷河、维拉马雷湾、王家航海学院
    ["esperan-south", 45, 96], // 塔兰萨、卡斯特里昂、布鲁玛角
    ["vanderland", 205, 55], // 范德兰：赫伦丹、瓦尔维克、梅尔蒙德、古尔登堡与河口湾
    ["kadir-east", 182, 108], // 萨赫兰泉城绿洲、哈拉湾、贾马尔高原
    ["morningstar", 280, 60], // 晨星洋：风暴冠岛、海鸟群岛、晨星岛、灰岸石柱
    ["newworld-frost", 330, 16], // 霜语海岸与霜峡湾、斯卡尔德港、极光峡湾
    ["newworld-dawn", 345, 36], // 晨光湾、奥斯特瓦尔德、星陨坑与浮空岛群
    ["newworld-silvermist", 340, 66], // 银雾湾、弗莱哈文、银雾河口与石像群
    ["newworld-west", 305, 94], // 西岸草原与金脉丘陵、新月滩、首航者登陆碑
    ["newworld-emerald", 352, 116], // 翡翠湾：诺瓦马尔、翡翠河三角洲、翡翠瀑布、世界树、沉钟塔
    ["newworld-south", 318, 150], // 日痕荒原、努拉巴德、赤礁海岸与阿尔瓦兰
    ["yaohua", 228, 148], // 瑶华本岛（琅京、琅江）与东岚岛（朝岚港）
    ["yaohua-west", 160, 144], // 云屿与卡迪尔南岸：翠台、沉湾、玻璃沙丘岬
    ["kadir-north-coast", 88, 110], // 卡迪尔北岸：沙之门湾、湾口的沙嘴、布鲁玛湾、北岸的地中海式窄带与半干旱草原
    ["kadir-west", 40, 128], // 卡迪尔西岭与支脉、石漠与沙海、西南角的半干旱草原
    ["watch-sea", 186, 12], // 守望海：弯折的冰川槽、口门的浅槛、科伦半岛的堰洲岛
    ["astria-east", 382, 70], // 阿斯特里亚大山脉与支脉、东麓高原的低丘与河谷
  ];
  for (const [name, x, y] of crops) out.push({ name: `zoom-${name}`, px: cropAt(summer, x, y, 270, 150), scale: 3 });
  // 冬季的北境与霜峡湾（积雪线、结冰的河）
  const winter = drawChart(input, { season: 3 });
  out.push({ name: "zoom-north-fjords-winter", px: cropAt(winter, 128, 16, 270, 150), scale: 3 });
  out.push({ name: "zoom-newworld-frost-winter", px: cropAt(winter, 330, 16, 270, 150), scale: 3 });
  // 各文化港口周边的人文景观（真实数据）：每种文化取一处代表地点，裁 140×90 像素
  const towns: [string, string][] = [
    ["cuilan", "lancheng"], // 埃斯佩兰：葡萄园、橄榄林、麦田、修道院
    ["cuilan-port", "chenggang"],
    ["shuangling", "songjin"], // 诺德海姆：牧场、木教堂、峡湾
    ["jinsui", "jinsuigang"], // 范德兰：圩田、风车、河口
    ["chisha", "yanmo"], // 卡迪尔：绿洲、椰林与灌渠、商队驿站
    ["chisha-river", "tuocheng"], // 萨菲拉河边的米兹拉
    ["bichao", "bichaogang"], // 马纳瓦：火山岛上的港口
    ["yaohua", "langjing"], // 瑶华：梯田、稻田、宝塔
    ["frontier", "vrijhaven"], // 新大陆的殖民港：木栅栏堡与开垦地
    ["frontier-south", "novamar"],
  ];
  for (const [name, key] of towns) {
    const l = locs.find((v) => v.key === key);
    if (l) out.push({ name: `town-${name}`, px: cropAt(summer, l.x + 0.5, l.y + 0.5, 140, 90), scale: 4 });
  }
  // 每处地标在海图上的样子（真实数据）
  const lms = input.landmarks ?? [];
  if (lms.length > 0) {
    const tiles = lms.map((l) => cropAt(summer, l.x + (l.w ?? 1) / 2, l.y + (l.h ?? 1) / 2, Math.max(64, (l.w ?? 1) * C + 24), 56));
    out.push({ name: "landmarks-on-chart", px: sheet(tiles, { cols: 6, gap: 4, bg: "#1a1423" }), scale: 3 });
  }

  // 标记总览：七种风格的港口与城市（已知 / 未知）、殖民点、发现物与各种动态标记
  const styles = ARCH_STYLES;
  const flags = ["#c0392b", "#8e44ad", "#2e86c1", "#d4ac0d", "#27ae60", "#e67e22", "#7f8c8d"];
  const marks: Px[] = [];
  styles.forEach((s, i) => marks.push(drawPortMarker(s, flags[i]), drawCityMarker(s, flags[i])));
  styles.forEach((s, i) => marks.push(drawPortMarker(s, flags[i], { unknown: true }), drawCityMarker(s, flags[i], { unknown: true })));
  const siteMarks: SiteMark[] = [
    {},
    { claim: "#b03a2e" },
    { claim: "#3b5b92" },
    { claim: "#7d3c98" },
    { colony: { flag: PLAYER_FLAG, size: 0 } },
    { colony: { flag: PLAYER_FLAG, size: 1 } },
    { colony: { flag: PLAYER_FLAG, size: 2 } },
    { colony: { flag: "#16a085", size: 1 } },
  ];
  for (const m of siteMarks) marks.push(drawSiteMarker(m));
  for (const m of siteMarks.slice(0, 6)) marks.push(drawSiteMarker(m, { unknown: true }));
  for (const k of DISCOVERY_KINDS) marks.push(drawDiscoveryMarker(k));
  marks.push(drawDiscoveryMarker("unknown"));
  for (let d = 0; d < 8; d++) marks.push(drawWindArrow(d, d + 2));
  for (let f = 0; f < 4; f++) marks.push(drawSelectFrame(f));
  for (let f = 0; f < 8; f += 2) marks.push(drawFlagshipRing(f), drawChevron(f));
  marks.push(drawCaravanMarker(0), drawCaravanMarker(1), drawDestPin(0), drawDestPin(3), drawRouteDot("route"), drawRouteDot("plan"));
  marks.push(drawWake(0), drawWake(2), drawCompassRose(14), drawCompassRose(22));
  out.push({ name: "markers", px: sheet(marks, { cols: styles.length * 2, gap: 6, bg: "#123a66" }), scale: 4 });
  // 殖民点与发现物放在地面上看
  const ground = summer.crop(1290, 380, 160, 60).clone();
  siteMarks.forEach((m, i) => ground.blit(drawSiteMarker(m), 4 + i * 19, 6));
  DISCOVERY_KINDS.forEach((k, i) => ground.blit(drawDiscoveryMarker(k), 6 + i * 22, 36));
  out.push({ name: "markers-on-ground", px: ground, scale: 4 });

  // 示意海图：海图 + 迷雾 + 道路之外的全部动态标记
  // 航线：维拉马雷 → 陶拉尼（端点吸附到最近的海格）
  const from = locs.find((l) => l.key === "chenggang") ?? locs[0];
  const to = locs.find((l) => l.key === "bichaogang") ?? locs[1] ?? from;
  const [ax, ay] = nearestSea(input, from.x, from.y);
  const [bx, by] = nearestSea(input, to.x, to.y);
  const along = (t: number): [number, number] => nearestSea(input, Math.round(ax + (bx - ax) * t), Math.round(ay + (by - ay) * t));
  const revealed = sampleFog(input, locs, [ax, ay, bx, by]);
  const fog = drawFog(revealed, input.width, input.height);
  const demo = summer.clone().blit(fog, 0, 0);
  const known = (x: number, y: number) => revealed[y]?.[x] === "1";
  let siteNo = 0;
  for (const l of locs) {
    const unknown = !known(l.x, l.y);
    let m: Px;
    if (l.kind === "site") m = drawSiteMarker(demoMark(siteNo++, factions, colors), { unknown });
    else {
      const style = markerStyle(l.faction);
      m = l.kind === "port" ? drawPortMarker(style, colors[l.faction] ?? "#ffffff", { unknown }) : drawCityMarker(style, colors[l.faction] ?? "#ffffff", { unknown });
    }
    demo.blit(m, cc(l.x) - Math.floor(m.w / 2), cc(l.y) - m.h + 5);
  }
  // 发现物：只画已揭开处的
  for (const d of discs) {
    if (!known(d.x, d.y)) continue;
    const m = drawDiscoveryMarker(d.kind);
    demo.blit(m, cc(d.x) - Math.floor(m.w / 2), cc(d.y) - Math.floor(m.h / 2));
  }
  for (let t = 0; t <= 40; t += 2) {
    const dot = drawRouteDot(t < 20 ? "route" : "plan");
    demo.blit(dot, Math.round(cc(ax) + (cc(bx) - cc(ax)) * (t / 40)) - 2, Math.round(cc(ay) + (cc(by) - cc(ay)) * (t / 40)) - 2);
  }
  const ship = drawShip(1, "square", { size: "small", flag: "#f5d66b" });
  const [shipX, shipY] = along(0.4);
  const sx = cc(shipX);
  const sy = cc(shipY);
  demo.blit(drawWake(1), sx - ship.w / 2 - 7, sy);
  demo.blit(drawFlagshipRing(0), sx - 14, sy - 5);
  demo.blit(ship, sx - Math.floor(ship.w / 2), sy - ship.h + 3);
  demo.blit(drawChevron(0), sx - 4, sy - ship.h - 8);
  const pirate = drawShip(0, "lateen", { size: "small", pirate: true });
  const [pirX, pirY] = nearestSea(input, shipX + 12, shipY - 5);
  demo.blit(pirate, cc(pirX) - 8, cc(pirY) - 12, { flipX: true });
  const other = drawShip(2, "square", { size: "small", flag: "#16a085" });
  const [ox, oy] = along(0.75);
  demo.blit(other, cc(ox) - 8, cc(oy) - 12);
  const capital = locs.find((l) => l.key === "lancheng");
  if (capital) demo.blit(drawCaravanMarker(0), cc(capital.x + 4) - 6, cc(capital.y) - 8);
  demo.blit(drawDestPin(0), cc(bx) - 5, cc(by) - 5);
  const bc = locs.find((l) => l.key === "chenggang");
  if (bc) demo.blit(drawSelectFrame(1), cc(bc.x) - 14, cc(bc.y) - 16);
  for (const [t, d, s] of [
    [0.2, 2, 5],
    [0.55, 1, 7],
    [0.9, 3, 4],
  ] as const) {
    const [rx, ry] = along(t);
    const [wx, wy] = nearestSea(input, rx, ry + 4);
    const a = drawWindArrow(d, s);
    demo.blit(a, cc(wx) - Math.floor(a.w / 2), cc(wy) - Math.floor(a.h / 2));
  }
  out.push({ name: "demo-full", px: demo, scale: 1 });
  out.push({ name: "demo-zoom", px: cropAt(demo, (ax + bx) / 2, (ay + by) / 2, 400, 180), scale: 3 });
  out.push({ name: "demo-newworld", px: cropAt(demo, 320, 100, 400, 180), scale: 3 });

  // —— 合成世界：写实地理下的画法 ——
  const synth = synthWorld(7);
  const ts = Date.now();
  const sSummer = drawChart(synth.input, { season: 1 });
  console.log(`  合成世界 ${synth.input.width}×${synth.input.height}、${synth.input.places?.length ?? 0} 个地点、${synth.input.rivers?.length ?? 0} 条河、${synth.input.landmarks?.length ?? 0} 处地标：${Date.now() - ts} ms`);
  out.push({ name: "synth-summer", px: sSummer, scale: 1 });
  for (const [s2, name] of [
    [0, "spring"],
    [2, "autumn"],
    [3, "winter"],
  ] as const) {
    out.push({ name: `synth-${name}`, px: drawChart(synth.input, { season: s2 }), scale: 1 });
  }
  const sCrops: [string, number, number][] = [
    ["north", 300, 20],
    ["west", 20, 150],
    ["inner-sea", 380, 200],
    ["south", 250, 380],
    ["gate", 880, 340],
    ["newworld-n", 1150, 40],
    ["newworld-mid", 1200, 300],
    ["newworld-s", 1250, 480],
    ["isles", 460, 480],
  ];
  for (const [name, x, y] of sCrops) out.push({ name: `synth-zoom-${name}`, px: sSummer.crop(x, y, 270, 150), scale: 3 });
  // 各文化的港口周边（人文景观）：每种势力取一座港口或城市，放大看
  const seenFaction = new Set<string>();
  for (const p of synth.input.places ?? []) {
    const f = p.faction || "site";
    if (seenFaction.has(f) || (p.kind === "port" && f !== "site" && (synth.input.places ?? []).some((q) => q.kind === "city" && q.faction === p.faction))) continue;
    seenFaction.add(f);
    const x = Math.max(0, Math.min(synth.input.width * CHART_CELL - 140, p.x * CHART_CELL - 70));
    const y = Math.max(0, Math.min(synth.input.height * CHART_CELL - 90, p.y * CHART_CELL - 45));
    out.push({ name: `synth-town-${f}`, px: sSummer.crop(x, y, 140, 90), scale: 4 });
  }
  // 地标在海图上的样子：每处裁一块
  const lmCrops = (synth.input.landmarks ?? []).map((l) => {
    const cx = Math.round((l.x + (l.w ?? 1) / 2) * CHART_CELL);
    const cy = Math.round((l.y + (l.h ?? 1) / 2) * CHART_CELL);
    const w = Math.max(64, (l.w ?? 1) * CHART_CELL + 24);
    return sSummer.crop(Math.max(0, cx - w / 2), Math.max(0, cy - 26), w, 48);
  });
  out.push({ name: "synth-landmarks", px: sheet(lmCrops, { cols: 4, gap: 4, bg: "#1a1423" }), scale: 3 });
  const sWinter = drawChart(synth.input, { season: 3 });
  out.push({ name: "synth-zoom-north-winter", px: sWinter.crop(300, 20, 270, 150), scale: 3 });
  // 海岸图鉴：五块陆地各是一种海岸（沙滩、悬崖、红树林与三角洲、冰架、火山黑沙），一条宽河带桥
  {
    const W = 120;
    const H = 34;
    const blocks: [number, number, string, number][] = [
      [3, 22, "D", 1],
      [26, 45, "A", 6],
      [48, 69, "W", 0],
      [72, 93, "I", 2],
      [96, 117, "V", 3],
    ];
    const rows: string[] = [];
    const rel: string[] = [];
    const bio: string[] = [];
    for (let y = 0; y < H; y++) {
      let a = "";
      let b = "";
      let c = "";
      for (let x = 0; x < W; x++) {
        const blk = blocks.find(([x0, x1]) => x >= x0 && x <= x1);
        const wob = Math.round(Math.sin(x * 0.7 + y * 0.3) * 1.5);
        const land = !!blk && y >= 5 + wob && y <= 28 - wob && x >= blk[0] + (y % 7 === 0 ? 1 : 0);
        a += land ? "#" : y < 2 || y > H - 3 ? "~" : "-";
        b += land && blk ? String(Math.min(9, blk[3] + (Math.abs(y - 16) < 5 ? 2 : 0))) : ".";
        c += land && blk ? blk[2] : ".";
      }
      rows.push(a);
      rel.push(b);
      bio.push(c);
    }
    const gallery: ChartInput = {
      width: W,
      height: H,
      rows,
      relief: rel,
      biomes: bio,
      rivers: [
        { key: "delta", path: downTo(rows, (k) => 52 + Math.round(Math.sin(k / 3) * 2), 7), width: 3 },
        { key: "wadi", path: downTo(rows, () => 12, 8), width: 2 },
      ],
      places: [
        { x: 5, y: 16, kind: "city", faction: "chisha" },
        { x: 20, y: 16, kind: "city", faction: "chisha" },
      ],
      roads: [{ from: [5, 16], to: [20, 16] }],
    };
    for (const [s2, name] of [
      [1, "summer"],
      [3, "winter"],
    ] as const) {
      out.push({ name: `coast-gallery-${name}`, px: drawChart(gallery, { season: s2 }), scale: 3 });
    }
    // 放大：红树林海岸与三角洲、悬崖与礁石、冰架
    const g1 = drawChart(gallery, { season: 1 });
    out.push({ name: "coast-zoom-delta", px: g1.crop(180, 70, 110, 66), scale: 6 });
    out.push({ name: "coast-zoom-cliff-ice", px: g1.crop(160, 0, 160, 50).clone(), scale: 5 });
    out.push({ name: "coast-zoom-ice-volcano", px: g1.crop(340, 60, 140, 76), scale: 5 });
  }
  // 地标图标：各已知图样与各类别的通用图样
  const icons: Px[] = [];
  for (const k of LANDMARK_KINDS) icons.push(drawLandmarkIcon(k, "natural"));
  for (const c of LANDMARK_CATEGORIES) icons.push(drawLandmarkIcon("__unknown__", c));
  out.push({ name: "landmark-icons", px: sheet(icons, { cols: 9, gap: 4, bg: "#8a8f6e" }), scale: 5 });
  return out;
}
