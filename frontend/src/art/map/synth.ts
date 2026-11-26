// 临时的世界合成器——只用于美术预览与测试，不进数据、不被游戏界面引用。
// 按 EXPANSION.md §10.3 的图层约定造一张 400×170 的“像样”的世界（被侵蚀的海岸、山脉、河流、气候带、地标与地点），
// 用来在真实地理数据（由 cargo xtask worldgen 生成）到位之前检验海图的画法。确定性：同一种子同一张图。
import { chamfer, fbm, hash2 } from "./noise";
import { SEA_VEG, VEG, VEG_CODES } from "./geo";
import type { ChartInput, ChartLandmark, ChartPlace, ChartRiver, ChartRoad } from "./types";

type Pt = readonly [number, number];

/** 椭圆形的控制形状：中心、半径、权重（负权重为海）。 */
interface Blob {
  x: number;
  y: number;
  rx: number;
  ry: number;
  w: number;
}

/** 折线到点的距离（格）。 */
function segDist(pts: readonly Pt[], x: number, y: number): number {
  let best = Infinity;
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[i + 1];
    const dx = bx - ax;
    const dy = by - ay;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
    best = Math.min(best, Math.hypot(x - ax - dx * t, y - ay - dy * t));
  }
  return best;
}

export interface SynthWorld {
  input: ChartInput;
  /** 地点的名字键（预览用） */
  keys: string[];
}

/** 造一张合成世界（W×H 缺省 400×170）。 */
export function synthWorld(seed = 7, W = 400, H = 170): SynthWorld {
  const sx = W / 400;
  const sy = H / 170;
  const B = (x: number, y: number, rx: number, ry: number, w = 1): Blob => ({ x: x * sx, y: y * sy, rx: rx * sx, ry: ry * sy, w });
  const lands: Blob[] = [
    // 旧世界：环抱内海的大陆
    B(112, 58, 124, 72),
    B(40, 108, 50, 22),
    B(200, 40, 50, 42),
    // 新大陆：南北两块，中间有地峡
    B(322, 38, 44, 34),
    B(336, 92, 36, 36),
    B(352, 142, 32, 26),
    B(300, 70, 14, 12),
    // 瑶华群岛与内海群岛
    B(140, 146, 16, 9),
    B(172, 156, 12, 8),
    B(205, 142, 14, 9),
    B(118, 160, 9, 6),
    B(236, 158, 10, 7),
    B(190, 128, 6, 5),
    B(100, 62, 9, 6),
    B(140, 70, 7, 5),
    B(262, 128, 8, 6),
    B(385, 20, 10, 14),
  ];
  const seas: Blob[] = [
    // 内海维斯塔，向东南经巨人之门通外洋
    B(122, 64, 82, 29, 1.3),
    B(212, 92, 30, 9, 1.3),
    B(247, 103, 18, 5, 1.4),
    // 北方的深湾与峡湾海
    B(88, 12, 22, 9, 1.1),
    B(262, 30, 16, 40, 1.2),
    B(300, 118, 18, 10, 1.1),
    B(372, 64, 12, 8, 1.1),
    // 内海的海湾
    B(62, 58, 16, 9, 1.2),
    B(178, 50, 14, 11, 1.2),
    B(150, 92, 12, 7, 1.2),
  ];
  // 伸进内海的半岛与内海里的大岛（在海之后叠加）
  const peninsulas: Blob[] = [
    B(112, 84, 7, 17, 1),
    B(84, 44, 12, 5, 0.9),
    B(160, 66, 9, 5, 0.9),
    B(200, 80, 6, 12, 0.9),
  ];
  const terr = new Uint8Array(W * H);
  const pot = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      // 域扭曲：控制形状的边缘弯成湾与岬
      const wx = x + (fbm(x / 22, y / 22, seed + 1) - 0.5) * 26 * sx;
      const wy = y + (fbm(x / 22, y / 22, seed + 2) - 0.5) * 20 * sy;
      let p = -1;
      for (const b of lands) p = Math.max(p, (1 - Math.hypot((wx - b.x) / b.rx, (wy - b.y) / b.ry)) * b.w);
      let s = -1;
      for (const b of seas) s = Math.max(s, (1 - Math.hypot((wx - b.x) / b.rx, (wy - b.y) / b.ry)) * b.w);
      if (s > 0) p -= s * 1.6;
      for (const b of peninsulas) p = Math.max(p, (1 - Math.hypot((wx - b.x) / b.rx, (wy - b.y) / b.ry)) * b.w);
      // 分形细节：高纬的海岸更破碎（峡湾）
      const rag = y < 45 * sy ? 0.34 : 0.22;
      p += (fbm(x / 9, y / 9, seed + 3) - 0.5) * rag + (fbm(x / 3.5, y / 3.5, seed + 4) - 0.5) * 0.12;
      // 地图四边一圈是海（画框压在上面）
      if (x < 2 || y < 2 || x >= W - 2 || y >= H - 2) p = -1;
      pot[y * W + x] = p;
      terr[y * W + x] = p > 0 ? 2 : 0;
    }
  }
  const landDist = chamfer(W, H, (i) => terr[i] !== 2);
  const seaDist = chamfer(W, H, (i) => terr[i] === 2);
  for (let i = 0; i < W * H; i++) if (terr[i] !== 2 && seaDist[i] <= 1.5 + fbm((i % W) / 6, Math.floor(i / W) / 6, seed + 5) * 3.2) terr[i] = 1;

  // —— 高程：离岸距离 + 山脉带 + 岛弧火山 ——
  const P = (pts: [number, number][]): Pt[] => pts.map(([x, y]) => [x * sx, y * sy] as const);
  const belts: { pts: Pt[]; w: number; h: number }[] = [
    { pts: P([[18, 14], [12, 40], [16, 66], [30, 104]]), w: 4.5, h: 8 },
    { pts: P([[60, 24], [95, 18], [128, 22], [160, 17], [190, 30]]), w: 4, h: 7.5 },
    { pts: P([[70, 104], [115, 108], [160, 110]]), w: 3.5, h: 6 },
    { pts: P([[222, 20], [228, 50], [232, 78]]), w: 3.5, h: 6.5 },
    { pts: P([[292, 8], [297, 35], [300, 60], [310, 88], [318, 112], [338, 164]]), w: 4.5, h: 9 },
    { pts: P([[372, 40], [380, 120]]), w: 3, h: 4.5 },
  ];
  const volcanoes: Pt[] = P([[140, 146], [205, 142], [172, 156], [262, 128], [318, 60]]);
  const elev = new Float32Array(W * H);
  const relief = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (terr[i] !== 2) continue;
      let e = Math.min(landDist[i], 16) * 0.22;
      const ridged = 1 - Math.abs(fbm(x / 7, y / 7, seed + 11) - 0.5) * 2;
      for (const b of belts) {
        const d = segDist(b.pts, x, y) / (b.w * sx);
        if (d < 3) e += b.h * Math.exp(-d * d) * (0.5 + 0.5 * ridged);
      }
      for (const [vx, vy] of volcanoes) {
        const d = Math.hypot(x - vx, y - vy);
        if (d < 5) e += (5 - d) * 1.5;
      }
      e += (fbm(x / 5, y / 5, seed + 12) - 0.5) * 1.4 + (fbm(x / 13, y / 13, seed + 13) - 0.5) * 2.2;
      if (landDist[i] <= 1.5) e = Math.min(e, 1.5 + ridged);
      elev[i] = e;
      relief[i] = Math.max(0, Math.min(9, Math.round(e)));
    }
  }

  // —— 河流：填洼后按最陡下降汇流 ——
  const rivers = traceRivers(W, H, terr, elev, landDist, seed);

  // —— 植被：纬度 + 离海距离 + 西风的雨影 ——
  const veg = new Uint8Array(W * H).fill(SEA_VEG);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (terr[i] !== 2) continue;
      const lat = y / sy + (fbm(x / 18, y / 18, seed + 21) - 0.5) * 12;
      let shadow = 0;
      for (let k = 1; k <= 22; k++) {
        const j = i - k;
        if (x - k < 0) break;
        if (terr[j] !== 2) break;
        if (relief[j] >= 6) {
          shadow = 1;
          break;
        }
      }
      const wet = Math.max(0, 1 - (landDist[i] - 1) / 18) * 0.6 + fbm(x / 12, y / 12, seed + 22) * 0.5 - shadow * 0.35;
      const r = relief[i];
      let v: number;
      if (r >= 8) v = VEG.ALPINE;
      else if (lat < 8) v = VEG.ICE;
      else if (lat < 17) v = VEG.TUNDRA;
      else if (lat < 44) v = wet < 0.25 ? VEG.GRASS : VEG.BOREAL;
      else if (lat < 78) v = wet > 0.38 ? VEG.FOREST : VEG.GRASS;
      else if (lat < 104) v = x / sx < 250 ? (landDist[i] <= 8 ? VEG.MEDIT : VEG.STEPPE) : wet > 0.4 ? VEG.FOREST : VEG.GRASS;
      else if (lat < 126) v = x / sx < 250 ? (wet > 0.72 ? VEG.STEPPE : VEG.DESERT) : wet > 0.45 ? VEG.JUNGLE : VEG.SAVANNA;
      else v = wet > 0.42 ? VEG.JUNGLE : VEG.SAVANNA;
      if (r <= 1 && landDist[i] <= 2.5 && lat > 60 && fbm(x / 6, y / 6, seed + 23) > 0.6) v = VEG.WETLAND;
      veg[i] = v;
    }
  }
  for (const [vx, vy] of volcanoes) {
    for (let y = Math.round(vy - 2); y <= vy + 2; y++)
      for (let x = Math.round(vx - 2); x <= vx + 2; x++) if (x >= 0 && y >= 0 && x < W && y < H && terr[y * W + x] === 2) veg[y * W + x] = VEG.VOLCANIC;
  }
  // 河口三角洲的湿地
  for (const r of rivers) {
    if (r.width < 3) continue;
    const [mx, my] = r.path[r.path.length - 1];
    for (let y = my - 3; y <= my + 3; y++)
      for (let x = mx - 3; x <= mx + 3; x++) if (x >= 0 && y >= 0 && x < W && y < H && terr[y * W + x] === 2 && relief[y * W + x] <= 1) veg[y * W + x] = VEG.WETLAND;
  }

  // —— 地点 ——
  const places: ChartPlace[] = [];
  const keys: string[] = [];
  const region = (x: number, y: number): string => {
    const ux = x / sx;
    const uy = y / sy;
    if (ux >= 262) return "";
    if (uy >= 128) return "yaohua";
    if (uy < 38) return "shuangling";
    if (ux < 70) return "cuilan";
    if (ux > 180) return "jinsui";
    if (uy > 92) return "chisha";
    return Math.hypot(ux - 120, uy - 64) < 30 ? "bichao" : "cuilan";
  };
  const taken: Pt[] = [];
  const free = (x: number, y: number, d: number) => taken.every(([a, b]) => Math.hypot(a - x, b - y) >= d);
  for (let k = 0; k < 4000 && places.length < 46; k++) {
    const x = 3 + Math.floor(hash2(k, 1, seed) * (W - 6));
    const y = 3 + Math.floor(hash2(k, 2, seed) * (H - 6));
    const i = y * W + x;
    if (terr[i] === 2 || seaDist[i] > 1) continue;
    if (!free(x, y, 12 * sx)) continue;
    const f = region(x, y);
    taken.push([x, y]);
    keys.push(`p${places.length}`);
    places.push({ x, y, kind: f ? "port" : "site", faction: f, terrain: f ? null : siteTerrain(veg[nearestLand(W, H, terr, x, y)]) });
  }
  // 内陆城市：港口背后 6–10 格的陆地
  const ports = places.slice();
  for (let k = 0; k < ports.length; k++) {
    const p = ports[k];
    if (!p.faction || k % 3 !== 0) continue;
    for (let t = 0; t < 40; t++) {
      const a = hash2(k, t, seed + 31) * Math.PI * 2;
      const d = 6 + hash2(k, t, seed + 32) * 5;
      const x = Math.round(p.x + Math.cos(a) * d);
      const y = Math.round(p.y + Math.sin(a) * d);
      if (x < 2 || y < 2 || x >= W - 2 || y >= H - 2) continue;
      const i = y * W + x;
      if (terr[i] !== 2 || landDist[i] < 3 || relief[i] > 5 || !free(x, y, 7)) continue;
      taken.push([x, y]);
      keys.push(`c${places.length}`);
      places.push({ x, y, kind: "city", faction: p.faction });
      break;
    }
  }
  // 道路：城市连到最近的两个同势力地点
  const roads: ChartRoad[] = [];
  for (const c of places) {
    if (c.kind !== "city") continue;
    const near = places
      .filter((o) => o !== c && o.faction === c.faction && Math.hypot(o.x - c.x, o.y - c.y) < 34)
      .sort((a, b) => Math.hypot(a.x - c.x, a.y - c.y) - Math.hypot(b.x - c.x, b.y - c.y))
      .slice(0, 2);
    for (const o of near) roads.push({ from: [c.x, c.y], to: [o.x, o.y] });
  }

  // —— 地标 ——
  const landmarks = pickLandmarks(W, H, terr, relief, veg, seaDist, sx, sy);
  for (const l of landmarks) {
    if (l.category !== "arcane") continue;
    for (let y = l.y; y < l.y + (l.h ?? 1); y++)
      for (let x = l.x; x < l.x + (l.w ?? 1); x++) if (x >= 0 && y >= 0 && x < W && y < H && terr[y * W + x] === 2 && l.kind !== "floating_isles") veg[y * W + x] = VEG.ARCANE;
  }

  const rows: string[] = [];
  const rel: string[] = [];
  const bio: string[] = [];
  for (let y = 0; y < H; y++) {
    let a = "";
    let b = "";
    let c = "";
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      a += terr[i] === 2 ? "#" : terr[i] === 1 ? "-" : "~";
      b += terr[i] === 2 ? String(relief[i]) : ".";
      c += terr[i] === 2 ? VEG_CODES[veg[i]] : ".";
    }
    rows.push(a);
    rel.push(b);
    bio.push(c);
  }
  return { input: { width: W, height: H, rows, relief: rel, biomes: bio, rivers, landmarks, places, roads }, keys };
}

function nearestLand(W: number, H: number, terr: Uint8Array, x: number, y: number): number {
  for (let r = 1; r < 4; r++)
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        const xx = x + dx;
        const yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < W && yy < H && terr[yy * W + xx] === 2) return yy * W + xx;
      }
  return y * W + x;
}

function siteTerrain(v: number): string {
  switch (v) {
    case VEG.JUNGLE:
      return "jungle";
    case VEG.WETLAND:
      return "swamp";
    case VEG.TUNDRA:
    case VEG.ICE:
      return "tundra";
    case VEG.GRASS:
    case VEG.SAVANNA:
    case VEG.STEPPE:
      return "plains";
    case VEG.DESERT:
      return "desert";
    case VEG.ALPINE:
      return "hills";
    default:
      return "forest";
  }
}

/** 河流：优先队列填洼 + D8 最陡下降，汇流量大的支流汇成干流，取最长的若干条。 */
function traceRivers(W: number, H: number, terr: Uint8Array, elev: Float32Array, landDist: Float32Array, seed: number): ChartRiver[] {
  const N = W * H;
  // 填洼：从海岸向内“漫水”，得到每格的出流方向（流向先被处理的邻格）
  const filled = new Float32Array(N).fill(Infinity);
  const down = new Int32Array(N).fill(-1);
  const heap: number[] = [];
  const push = (i: number) => {
    heap.push(i);
    let k = heap.length - 1;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (filled[heap[p]] <= filled[heap[k]]) break;
      [heap[p], heap[k]] = [heap[k], heap[p]];
      k = p;
    }
  };
  const pop = (): number => {
    const top = heap[0];
    const last = heap.pop() as number;
    if (heap.length > 0) {
      heap[0] = last;
      let k = 0;
      for (;;) {
        const l = k * 2 + 1;
        const r = l + 1;
        let m = k;
        if (l < heap.length && filled[heap[l]] < filled[heap[m]]) m = l;
        if (r < heap.length && filled[heap[r]] < filled[heap[m]]) m = r;
        if (m === k) break;
        [heap[m], heap[k]] = [heap[k], heap[m]];
        k = m;
      }
    }
    return top;
  };
  for (let i = 0; i < N; i++) {
    if (terr[i] === 2 && landDist[i] <= 1) {
      filled[i] = elev[i];
      push(i);
    }
  }
  const order: number[] = [];
  const D8 = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ];
  while (heap.length > 0) {
    const i = pop();
    order.push(i);
    const x = i % W;
    const y = Math.floor(i / W);
    for (const [dx, dy] of D8) {
      const xx = x + dx;
      const yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
      const j = yy * W + xx;
      if (terr[j] !== 2 || filled[j] !== Infinity) continue;
      filled[j] = Math.max(elev[j], filled[i] + 0.01 + hash2(xx, yy, seed + 41) * 0.02);
      down[j] = i;
      push(j);
    }
  }
  // 汇流量：按处理顺序的倒序累加
  const acc = new Float32Array(N);
  for (let k = order.length - 1; k >= 0; k--) {
    const i = order[k];
    acc[i] += 1;
    if (down[i] >= 0) acc[down[i]] += acc[i];
  }
  // 从汇流量足够大的“源头”（上游没有更大的来水）出发，沿出流方向走到海岸
  const used = new Uint8Array(N);
  const out: ChartRiver[] = [];
  const heads = order.filter((i) => acc[i] >= 7 && acc[i] < 12 && elev[i] > 2.2).sort((a, b) => elev[b] - elev[a] || a - b);
  for (const h of heads) {
    if (used[h]) continue;
    const path: [number, number][] = [];
    let i = h;
    let merged = false;
    while (i >= 0) {
      if (used[i]) {
        merged = true;
        path.push([i % W, Math.floor(i / W)]);
        break;
      }
      path.push([i % W, Math.floor(i / W)]);
      i = down[i];
    }
    if (merged || path.length < 12) continue;
    for (const [x, y] of path) used[y * W + x] = 1;
    // 两侧也占住，河流彼此不挨着
    for (const [x, y] of path)
      for (const [dx, dy] of D8) {
        const xx = x + dx;
        const yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < W && yy < H) used[yy * W + xx] = 1;
      }
    const [mx, my] = path[path.length - 1];
    const a = acc[my * W + mx];
    out.push({ key: `r${out.length}`, path, width: a > 260 ? 3 : a > 90 ? 2 : 1 });
    if (out.length >= 22) break;
  }
  return out;
}

/** 地标：按地形挑位置（找不到合适的格就跳过）。 */
function pickLandmarks(W: number, H: number, terr: Uint8Array, relief: Uint8Array, veg: Uint8Array, seaDist: Float32Array, sx: number, sy: number): ChartLandmark[] {
  const out: ChartLandmark[] = [];
  const find = (x0: number, y0: number, r: number, ok: (i: number) => boolean): Pt | null => {
    const cx = Math.round(x0 * sx);
    const cy = Math.round(y0 * sy);
    for (let d = 0; d <= r; d++)
      for (let dy = -d; dy <= d; dy++)
        for (let dx = -d; dx <= d; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== d) continue;
          const x = cx + dx;
          const y = cy + dy;
          if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1) continue;
          if (ok(y * W + x)) return [x, y];
        }
    return null;
  };
  const land = (i: number) => terr[i] === 2;
  const coast = (i: number) => terr[i] === 2 && (terr[i - 1] !== 2 || terr[i + 1] !== 2 || terr[i - W] !== 2 || terr[i + W] !== 2);
  const deep = (i: number) => terr[i] !== 2 && seaDist[i] >= 3;
  const nearSea = (i: number) => terr[i] !== 2 && seaDist[i] >= 1.5 && seaDist[i] <= 3;
  const add = (key: string, category: ChartLandmark["category"], kind: string, p: Pt | null, w = 1, h = 1) => {
    if (p) out.push({ key, category, kind, x: p[0], y: p[1], w, h });
  };
  add("north_colossus", "ancient", "colossus", find(247, 98, 6, coast));
  add("south_colossus", "ancient", "colossus", find(250, 109, 6, coast));
  add("gate_chain", "ancient", "broken_chain", find(248, 103, 5, (i) => terr[i] !== 2));
  add("starfall_crater", "natural", "crater_lagoon", find(336, 30, 10, land), 3, 3);
  add("basalt_coast", "natural", "basalt_columns", find(60, 16, 12, coast), 2, 1);
  add("maelstrom", "natural", "maelstrom", find(280, 150, 14, deep));
  add("bone_reef", "natural", "bone_reef", find(268, 10, 10, nearSea), 2, 1);
  add("table_falls", "natural", "table_falls", find(345, 96, 12, (i) => land(i) && relief[i] >= 5));
  add("glow_atoll", "natural", "glow_atoll", find(226, 150, 10, deep), 2, 2);
  add("fire_mountain", "natural", "volcano", find(318, 60, 6, (i) => veg[i] === VEG.VOLCANIC));
  add("world_tree", "arcane", "world_tree", find(350, 130, 12, (i) => land(i) && relief[i] <= 4));
  add("sky_isles", "arcane", "floating_isles", find(150, 34, 12, land), 3, 2);
  add("crystal_forest", "arcane", "crystal_spires", find(210, 60, 12, land), 3, 2);
  add("arcan_wall", "ancient", "great_wall", find(150, 12, 10, land), 18, 1);
  add("arcan_road", "ancient", "ancient_road", find(40, 72, 10, land), 16, 1);
  add("aqueduct", "ancient", "aqueduct", find(55, 45, 10, land), 6, 1);
  add("old_ruins", "ancient", "ruins", find(100, 110, 10, land));
  add("sunken_city", "ancient", "sunken_city", find(150, 90, 10, deep), 2, 1);
  add("star_tower", "civic", "observatory", find(190, 20, 10, (i) => land(i) && relief[i] >= 3));
  add("great_cathedral", "civic", "cathedral", find(30, 50, 10, (i) => land(i) && relief[i] <= 3));
  add("sea_light", "civic", "lighthouse", find(95, 95, 10, coast));
  add("pagoda", "civic", "pagoda", find(172, 154, 8, land));
  return out;
}
