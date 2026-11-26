// 荒野与殖民地街景用的景物：按地形变化的远景林带与山丘、空地与沙滩、近处的树丛、灌木、岩石、
// 古代阿尔坎帝国的残垣、搁浅的小艇、芦苇与枯树。只在殖民地 / 殖民点街景里用到，所以放在 scene/。
// 画法遵守 docs/ART.md：共享调色板、光源在左上、描边用最暗一阶、只用确定性随机，远景用雾色做空气透视。
import { h01 } from "../art/buildings/kit";
import { P, ink, overlay } from "../art/palette";
import { Px } from "../art/px";
import { memo } from "../art/render";
import { rng } from "../art/rng";
import { drawTree, type Climate } from "../art/scenery";

/** 殖民点的地形（data/world/overseas.toml 的 terrain 字段）。 */
export type Terrain = "forest" | "plains" | "hills" | "jungle" | "tundra" | "desert" | "swamp" | "island";
export const TERRAINS: readonly Terrain[] = ["forest", "plains", "hills", "jungle", "tundra", "desert", "swamp", "island"];

/** 是否为合法的地形名。 */
export function isTerrain(t: unknown): t is Terrain {
  return typeof t === "string" && (TERRAINS as readonly string[]).includes(t);
}

/** 地形 → 气候（决定远山、树种）。 */
export function terrainClimate(t: Terrain): Climate {
  switch (t) {
    case "jungle":
    case "island":
      return "tropical";
    case "tundra":
      return "cold";
    case "desert":
      return "arid";
    default:
      return "temperate";
  }
}

/** 季节 0–3。 */
function seasonOf(s: number): number {
  return ((Math.floor(s) % 4) + 4) % 4;
}

/** 地面色阶（暗、中、亮、高光），随地形与季节变化。 */
export function groundRamp(t: Terrain, season: number, snow: boolean): readonly string[] {
  const s = seasonOf(season);
  if (snow) return [P.snow[0], P.snow[1], P.snow[2], P.snow[3]];
  switch (t) {
    case "desert":
      return [P.sand[1], P.sand[2], P.sand[3], P.sand[4]];
    case "tundra":
      return [P.stone[1], P.leaf[1], P.stone[2], P.stone[3]];
    case "swamp":
      return [P.leaf[0], P.wood[1], P.leaf[1], P.leaf[2]];
    case "island":
    case "jungle":
      return [P.leaf[0], P.leaf[1], P.leaf[2], P.leaf[3]];
    case "plains":
      return s === 1 ? [P.leaf[1], P.straw[1], P.straw[2], P.gold[3]] : s === 2 ? [P.autumn[0], P.straw[1], P.straw[2], P.autumn[3]] : s === 3 ? [P.wood[1], P.straw[0], P.straw[1], P.straw[2]] : [P.leaf[1], P.leaf[2], P.leaf[3], P.leaf[4]];
    default:
      return s === 2 ? [P.autumn[0], P.leaf[1], P.straw[1], P.autumn[2]] : s === 3 ? [P.leaf[0], P.leaf[1], P.straw[1], P.straw[2]] : [P.leaf[0], P.leaf[1], P.leaf[2], P.leaf[3]];
  }
}

/** 远景林冠的色阶（暗、中、亮）。 */
function crownRamp(t: Terrain, season: number, snow: boolean): readonly string[] {
  const s = seasonOf(season);
  if (t === "desert") return [P.sand[1], P.sand[2], P.sand[3]];
  if (t === "tundra" || snow) return [P.leaf[0], P.slate[1], P.leaf[1]];
  if (t === "jungle" || t === "island") return [P.leaf[0], P.leaf[1], P.leaf[2]];
  if (t === "swamp") return [P.leaf[0], P.wood[1], P.leaf[1]];
  if (s === 2) return [P.autumn[0], P.autumn[1], P.autumn[2]];
  if (s === 3) return [P.wood[0], P.wood[1], P.stone[1]];
  if (s === 0) return [P.leaf[1], P.leaf[2], P.leaf[3]];
  return [P.leaf[0], P.leaf[1], P.leaf[2]];
}

// ───────────────────────── 远景 ─────────────────────────

/**
 * 陆地一侧的远景带（宽 w、高 h，底部对齐）：按地形画林冠、丘陵、沙丘、雪山或湿地雾林。
 * 只画在 x < landEnd 的地方，右端逐渐降到岸边；整体罩一层雾色。
 */
export function farTerrain(w: number, h: number, t: Terrain, season: number, snow: boolean, landEnd: number, seed: string): Px {
  return memo(`wild-far|${w}|${h}|${t}|${seasonOf(season)}|${snow}|${landEnd}|${seed}`, () => {
    const p = new Px(Math.max(1, w), Math.max(1, h));
    const r = rng(`far-${seed}`);
    const cr = crownRamp(t, season, snow);
    const taper = (x: number) => (x >= landEnd ? 0 : Math.min(1, (landEnd - x) / 60));
    /** 按轮廓逐列填色：top(x) 为该列上沿。 */
    const column = (x: number, top: number, col: (y: number) => string) => {
      for (let y = Math.max(0, Math.round(top)); y < h; y++) p.set(x, y, col(y));
    };
    const back = new Px(p.w, p.h);
    // 后排：雪山、高丘或台地
    if (t === "tundra" || t === "hills" || t === "desert" || t === "island") {
      const peaks = t === "island" ? 1 : 3;
      for (let k = 0; k < peaks; k++) {
        const cx = t === "island" ? landEnd * 0.35 : (landEnd * (k + 0.5)) / peaks + r.int(-20, 20);
        const hw = t === "island" ? landEnd * 0.4 : r.int(50, 90);
        const ph = t === "tundra" ? h * 0.7 : t === "hills" ? h * 0.72 : t === "island" ? h * 0.9 : h * 0.55;
        for (let x = Math.floor(cx - hw); x <= cx + hw; x++) {
          if (x < 0 || x >= w) continue;
          const u = Math.abs(x - cx) / hw;
          const mesa = t === "desert" ? Math.min(1, (1 - u) * 2.2) : t === "hills" ? Math.cos((u * Math.PI) / 2) : Math.pow(1 - u, 1.25);
          // 山脊的锯齿：两级起伏叠加
          const jag = t === "tundra" || t === "island" ? (h01(x >> 1, k, 3) - 0.5) * 3 + Math.sin(x / 7 + k) * 3 * (1 - u) : (h01(x >> 2, k, 3) - 0.5) * 3;
          const top = h - ph * mesa * taper(x) + jag;
          const left = x < cx;
          for (let y = Math.max(0, Math.round(top)); y < h; y++) {
            let col: string;
            if (t === "tundra") col = y < top + 7 + (h01(x, k, 5) < 0.3 ? 2 : 0) ? (left ? P.snow[3] : P.snow[1]) : left ? P.slate[2] : P.slate[1];
            else if (t === "desert") col = (y >> 2) % 3 === 0 ? P.sand[1] : left ? P.sand[3] : P.sand[2];
            else if (t === "island") col = y < top + 3 ? P.stone[1] : left ? P.leaf[2] : P.leaf[1];
            else col = y < top + 2 ? (snow ? P.snow[2] : cr[2]) : h01(x >> 3, y >> 3, 7) < 0.25 ? P.stone[2] : left ? cr[1] : cr[0];
            back.set(x, y, col);
          }
        }
      }
      back.dither(0, 0, w, h, overlay.fog, 2);
      p.blit(back, 0, 0);
    }
    // 前排：林冠、草丘或沙丘
    if (t === "desert") {
      for (let x = 0; x < w; x++) {
        const top = h - (10 + Math.sin(x / 23) * 5 + Math.sin(x / 9 + 1) * 2) * taper(x);
        column(x, top, (y) => (y < top + 2 ? P.sand[4] : (x + y) % 9 === 0 ? P.sand[2] : P.sand[3]));
      }
    } else if (t === "plains") {
      for (let x = 0; x < w; x++) {
        const top = h - (8 + Math.sin(x / 31) * 4 + Math.sin(x / 13) * 1.5) * taper(x);
        column(x, top, (y) => (y < top + 1 ? cr[2] : cr[1]));
      }
      // 远处零星的树团
      for (let x = r.int(10, 40); x < landEnd - 20; x += r.int(40, 90)) {
        const cy = h - 10 - r.int(0, 3);
        p.circle(x, cy, 4, cr[0]).circle(x - 2, cy - 1, 2, cr[1]);
        p.vline(x, cy + 3, h - 6, P.wood[1]);
      }
    } else {
      // 林冠：一排排重叠的树冠（圆团或松树三角），后排浅、前排深
      const rows = t === "tundra" ? 1 : 2;
      for (let row = 0; row < rows; row++) {
        const base = h - 2 - row * 0;
        const tall = t === "jungle" ? 30 : t === "swamp" ? 14 : t === "tundra" ? 16 : 22;
        let x = -4 + row * 5;
        while (x < landEnd + 10) {
          const tp = taper(x);
          if (tp <= 0) break;
          const pine = t === "tundra" || (t === "forest" && h01(x, row, 11) < 0.35);
          const hh = Math.round((tall - row * 5 + r.int(-4, 6)) * tp);
          if (hh > 2) {
            if (pine) {
              for (let i = 0; i < hh; i++) {
                const hw = Math.floor(i * 0.3 + (i % 4) * 0.4);
                const y = base - hh + i;
                p.hline(x - hw, x + hw, y, row ? cr[0] : cr[1]);
                if (snow && i % 4 === 0) p.hline(x - hw, x, y, P.snow[3]);
              }
              x += r.int(5, 8);
            } else {
              const rad = Math.max(3, Math.round(hh * (t === "jungle" ? 0.35 : 0.4)));
              const cy = base - hh + rad;
              p.circle(x, cy, rad, row ? cr[0] : cr[1]);
              p.circle(x - 1, cy - 1, Math.max(1, rad - 2), row ? cr[1] : cr[2]);
              p.rect(x - rad, cy, rad * 2 + 1, base - cy + 1, row ? cr[0] : cr[1]);
              if (snow) p.hline(x - rad + 2, x + 1, cy - rad, P.snow[3]);
              if (t === "swamp" && h01(x, row, 13) < 0.4) {
                // 湿地的枯树：细枝伸出林冠
                p.vline(x + 2, cy - rad - 6, cy - rad, P.wood[1]);
                p.set(x + 3, cy - rad - 4, P.wood[1]).set(x + 1, cy - rad - 3, P.wood[1]);
              }
              x += Math.max(4, rad + r.int(0, 3));
            }
          } else x += 6;
        }
      }
    }
    // 空气透视
    p.dither(0, 0, w, h, overlay.fog, t === "swamp" || t === "jungle" ? 3 : 1);
    if (t === "swamp" || t === "jungle") {
      // 贴地的雾带
      for (let y = h - 8; y < h; y++) p.dither(0, y, w, 1, "#e4ecf6aa", y > h - 4 ? 2 : 1);
    }
    return p;
  });
}

// ───────────────────────── 地面 ─────────────────────────

export interface ClearingOpts {
  /** 画布顶端在街景中的 y（地面从这里开始） */
  top: number;
  /** 岸线：第 y 行（街景坐标）陆地的右边界（不含） */
  shore: (y: number) => number;
  /** 陆地最下一行（街景坐标，含）；再往下是海 */
  bottom: number;
  /** 殖民地的土路：[上沿, 下沿)（街景坐标），null 表示没有路 */
  path: readonly [number, number] | null;
  /** 前滩沙地的上沿（街景坐标） */
  beachTop: number;
}

/**
 * 空地与沙滩（宽 w，高 SCENE_H - top）：陆地按地形着色（草地、沙地、苔原、泥沼），近岸一带沙滩与湿沙，
 * 殖民地有一条夯土路。海的部分留透明。
 */
export function clearing(w: number, sceneH: number, t: Terrain, season: number, snow: boolean, seed: string, o: ClearingOpts): Px {
  const h = sceneH - o.top;
  const p = new Px(Math.max(1, w), Math.max(1, h));
  const gr = groundRamp(t, season, snow);
  const sand: readonly string[] = t === "tundra" ? [P.stone[1], P.stone[2], P.stone[3], P.stone[4]] : t === "swamp" ? [P.wood[1], P.sand[1], P.sand[2], P.sand[3]] : [P.sand[2], P.sand[3], P.sand[4], P.straw[3]];
  const r = rng(`clear-${seed}`);
  for (let yy = 0; yy < h; yy++) {
    const y = o.top + yy;
    if (y > o.bottom) break;
    const sx = o.shore(y);
    // 近岸沙滩的宽度：越往前越宽
    const beachW = t === "swamp" ? 3 : 6 + Math.round((y - o.top) * 0.18);
    for (let x = 0; x < Math.min(w, sx); x++) {
      const toShore = sx - 1 - x;
      const inBeach = toShore < beachW || y >= o.beachTop;
      let col: string;
      if (inBeach) {
        const n = h01(x >> 1, y >> 1, 21);
        col = n < 0.2 ? sand[1] : n > 0.9 ? sand[3] : sand[2];
        if (toShore < 2 || y >= o.bottom - 1) col = sand[0];
        // 沙滩与草地的交界：抖动过渡
        if (!snow && toShore >= beachW - 2 && y < o.beachTop && (x + y) % 2 === 0) col = gr[1];
        if (!snow && y >= o.beachTop && y < o.beachTop + 2 && toShore >= beachW && (x + y) % 2 === 0) col = gr[1];
      } else {
        const n = h01(x >> 2, y >> 1, 23);
        col = n < 0.25 ? gr[0] : n > 0.8 ? gr[2] : gr[1];
        if (yy < 2) col = gr[1];
      }
      p.put(x, yy, col);
    }
  }
  // 草丛、野花、卵石
  if (!snow) {
    for (let i = 0; i < w / 5; i++) {
      const x = r.int(0, w - 1);
      const y = r.int(o.top + 4, o.beachTop - 2);
      const yy = y - o.top;
      if (x >= o.shore(y) - 8) continue;
      if (o.path && y >= o.path[0] - 1 && y < o.path[1] + 1) continue;
      if (t === "desert") p.set(x, yy, P.sand[1]).set(x + 1, yy, P.sand[2]);
      else {
        p.set(x, yy, gr[3]).set(x, yy - 1, gr[2]).set(x + 1, yy, gr[2]);
        if ((t === "plains" || t === "forest") && seasonOf(season) < 2 && r.chance(0.3)) p.set(x + 1, yy - 1, r.pick([P.blossom[2], P.gold[3], P.white]));
      }
    }
  }
  for (let i = 0; i < w / 18; i++) {
    const x = r.int(0, w - 3);
    const y = r.int(o.beachTop, o.bottom - 2);
    if (x >= o.shore(y) - 3) continue;
    p.set(x, y - o.top, P.stone[3]).set(x + 1, y - o.top, P.stone[2]);
    if (t === "island" && r.chance(0.5)) p.set(x + 2, y - o.top, P.blossom[2]);
  }
  // 土路：车辙与零星的石子
  if (o.path) {
    const [a, b] = o.path;
    const dirt: readonly string[] = snow ? [P.snow[0], P.snow[1], P.snow[2]] : t === "desert" ? [P.sand[1], P.sand[2], P.sand[3]] : [P.wood[1], P.wood[2], P.sand[2]];
    for (let y = a; y < b; y++) {
      const end = o.shore(y) - 10;
      for (let x = 0; x < end; x++) {
        const n = h01(x >> 1, y, 29);
        let col = n < 0.2 ? dirt[0] : n > 0.85 ? dirt[2] : dirt[1];
        if (y === a || y === b - 1) col = (x + y) % 2 ? dirt[0] : gr[1];
        if (y === a + 3 || y === b - 4) col = dirt[0];
        p.put(x, y - o.top, col);
      }
      // 路的尽头渐入沙滩
      for (let x = end; x < end + 6; x++) if ((x + y) % 2 === 0) p.put(x, y - o.top, dirt[1]);
    }
  }
  return p;
}

// ───────────────────────── 近景物件 ─────────────────────────

/** 地形上的一棵树（按地形挑树种；丛林、湿地用自己画的树）。底边是地面线。 */
export function wildTree(t: Terrain, season: number, variant: number): Px {
  const s = seasonOf(season);
  const v = Math.abs(Math.floor(variant)) || 0;
  return memo(`wild-tree|${t}|${s}|${v}`, () => {
    switch (t) {
      case "jungle":
        return v % 3 === 2 ? drawTree("tropical", s, v >> 2).trimmed() : jungleTree(v);
      case "swamp":
        return v % 2 ? mangrove(v) : deadTree(v);
      case "forest":
        return (v % 3 === 1 ? drawTree("cold", s, v >> 1) : drawTree("temperate", s, v >> 1)).trimmed();
      case "hills":
        return (v % 4 === 3 ? drawTree("cold", s, v >> 1) : drawTree("temperate", s, v >> 1)).trimmed();
      default:
        return drawTree(terrainClimate(t), s, v).trimmed();
    }
  });
}

/** 丛林的大树：板状根、高高的树干、层层叠叠的宽树冠，垂着藤蔓。 */
function jungleTree(v: number): Px {
  const p = new Px(48, 64);
  const r = rng(`jungle-${v}`);
  const bx = 24;
  const g = 63;
  const top = 18 + r.int(0, 8);
  // 板状根
  p.poly(
    [
      [bx - 7, g + 1],
      [bx - 1, g - 10],
      [bx + 2, g - 10],
      [bx + 8, g + 1],
    ],
    P.wood[1],
  );
  p.line(bx - 6, g, bx - 1, g - 8, P.wood[2]);
  // 树干
  p.rect(bx - 1, top, 3, g - top, P.wood[1]);
  p.vline(bx - 1, top, g - 1, P.wood[2]);
  for (let y = top + 3; y < g - 8; y += 6) p.set(bx, y, P.wood[0]);
  // 树冠：几团叠在一起，暗底亮顶
  const blobs: [number, number, number][] = [
    [bx - 11, top + 2, 8],
    [bx + 10, top + 3, 8],
    [bx, top - 4, 10],
    [bx - 5, top - 9, 6],
    [bx + 6, top - 8, 6],
  ];
  for (const [cx, cy, rr] of blobs) p.ellipse(cx, cy, rr, Math.round(rr * 0.7), P.leaf[0]);
  for (const [cx, cy, rr] of blobs) p.ellipse(cx - 1, cy - 1, rr - 2, Math.round(rr * 0.7) - 2, P.leaf[1]);
  for (const [cx, cy, rr] of blobs) {
    p.ellipse(cx - 3, cy - 2, Math.max(1, rr - 5), Math.max(1, Math.round(rr * 0.35)), P.leaf[2]);
    p.set(cx - 4, cy - 3, P.leaf[3]).set(cx - 2, cy - 3, P.leaf[3]);
  }
  // 藤蔓
  for (const [x, len] of [
    [bx - 14, 14],
    [bx + 13, 18],
    [bx - 6, 10],
  ] as const) {
    for (let k = 0; k < len; k++) p.set(x + (k % 5 === 4 ? 1 : 0), top + 6 + k, k % 3 ? P.leaf[1] : P.leaf[2]);
  }
  return p.outlined(P.leaf[0]).trimmed();
}

/** 红树：拱起的支柱根上一两团矮树冠；variant 改变高矮、宽窄与树冠的团数。 */
function mangrove(v: number): Px {
  const p = new Px(44, 44);
  const r = rng(`mangrove-${v}`);
  const g = 43;
  const cx = 22;
  const rootH = 8 + r.int(0, 6);
  const trunk = 6 + r.int(0, 8);
  const spread = r.int(7, 11);
  for (let i = 0; i < 5; i++) {
    const dx = Math.round(-spread + (i * spread * 2) / 4);
    p.line(cx + Math.round(dx / 3), g - rootH, cx + dx, g, P.wood[1]);
    p.line(cx + Math.round(dx / 3) + 1, g - rootH, cx + dx + 1, g - 1, P.wood[2]);
  }
  const top = g - rootH - trunk;
  p.rect(cx - 1, top, 3, trunk + 1, P.wood[1]);
  p.vline(cx - 1, top, g - rootH, P.wood[2]);
  const blobs: [number, number, number][] = [[cx, top - 3, r.int(9, 13)]];
  if (r.chance(0.6)) blobs.push([cx + r.pick([-8, 8]), top + 1, r.int(5, 7)]);
  for (const [bx, by, rr] of blobs) p.ellipse(bx, by, rr, Math.round(rr * 0.55), P.leaf[0]);
  for (const [bx, by, rr] of blobs) p.ellipse(bx - 1, by - 1, rr - 2, Math.max(1, Math.round(rr * 0.55) - 2), P.leaf[1]);
  for (const [bx, by, rr] of blobs) {
    p.ellipse(bx - 3, by - 2, Math.max(1, rr - 6), 1, P.leaf[2]);
    p.set(bx - 4, by - 3, P.leaf[3]);
  }
  return p.outlined(ink.brown).trimmed();
}

/** 枯树：灰白扭曲的树干与几根光枝，枝上挂着苔藓。 */
function deadTree(v: number): Px {
  const p = new Px(36, 50);
  const r = rng(`dead-${v}`);
  const g = 49;
  const cx = 17;
  const hgt = 30 + r.int(0, 12);
  for (let k = 0; k < hgt; k++) {
    const x = cx + Math.round(Math.sin(k / 7) * 2);
    p.set(x, g - k, P.stone[2]).set(x + 1, g - k, P.stone[1]);
    if (k < 4) p.set(x - 1, g - k, P.stone[2]).set(x + 2, g - k, P.stone[1]);
  }
  for (let i = 0; i < 4; i++) {
    const y = g - 12 - i * 6 - r.int(0, 3);
    const dir = i % 2 ? 1 : -1;
    const len = r.int(5, 10);
    const x0 = cx + Math.round(Math.sin((g - y) / 7) * 2);
    p.line(x0, y, x0 + dir * len, y - Math.round(len * 0.6), P.stone[2]);
    p.vline(x0 + dir * (len - 2), y - Math.round(len * 0.6) + 2, y - Math.round(len * 0.6) + 5, P.leaf[1]);
  }
  return p.outlined(P.stone[0]).trimmed();
}

/** 灌木、蕨丛、仙人掌、芦苇或苔原的矮丛（按地形），底边是地面线。 */
export function bush(t: Terrain, season: number, variant: number): Px {
  const s = seasonOf(season);
  const v = Math.abs(Math.floor(variant)) || 0;
  return memo(`wild-bush|${t}|${s}|${v}`, () => {
    const p = new Px(20, 20);
    const g = 19;
    if (t === "desert") {
      // 矮仙人掌或枯灌木
      if (v % 2) {
        p.rect(8, g - 11, 3, 11, P.leaf[2]);
        p.vline(8, g - 11, g - 1, P.leaf[3]);
        p.rect(4, g - 8, 2, 4, P.leaf[2]).rect(4, g - 5, 5, 2, P.leaf[1]);
        p.rect(13, g - 9, 2, 5, P.leaf[1]).rect(10, g - 5, 5, 2, P.leaf[1]);
        if (s === 0) p.set(9, g - 12, P.blossom[1]);
      } else {
        for (let i = 0; i < 6; i++) p.line(9, g, 3 + i * 2, g - 5 - (i % 3), i % 2 ? P.sand[1] : P.wood[2]);
      }
      return p.outlined(ink.brown).trimmed();
    }
    if (t === "swamp") {
      // 芦苇：一丛细长的茎，顶上香蒲
      for (let i = 0; i < 7; i++) {
        const x = 4 + i * 2;
        const hh = 9 + ((i * 7 + v) % 5);
        p.vline(x, g - hh, g, s === 3 ? P.straw[1] : i % 2 ? P.leaf[1] : P.leaf[2]);
        if (i % 3 === 1) p.vline(x, g - hh - 2, g - hh, P.wood[1]);
      }
      return p.trimmed();
    }
    if (t === "tundra") {
      // 苔原的矮石与地衣
      p.ellipse(9, g - 2, 6, 3, P.stone[2]);
      p.ellipse(8, g - 3, 4, 2, P.stone[3]);
      p.set(6, g - 4, P.gold[2]).set(11, g - 3, P.autumn[2]).set(9, g - 1, P.leaf[1]);
      return p.outlined(P.stone[0]).trimmed();
    }
    if (t === "jungle" || t === "island") {
      // 蕨叶：几片弯弯的羽叶
      for (const [dx, dy] of [
        [-7, -4],
        [7, -4],
        [-4, -8],
        [4, -9],
        [0, -10],
      ] as const) {
        const ex = 10 + dx;
        const ey = g + dy;
        p.line(10, g, ex, ey, P.leaf[1]);
        p.line(10, g - 1, ex + (dx > 0 ? -1 : 1), ey, P.leaf[2]);
        p.set(ex, ey - 1, P.leaf[3]);
      }
      return p.outlined(P.leaf[0]).trimmed();
    }
    // 温带灌木：一团叶子，春开白花、夏秋结红果、冬天只剩枝条
    if (s === 3) {
      for (let i = 0; i < 5; i++) p.line(10, g, 5 + i * 2, g - 6 - (i % 2) * 2, P.wood[1]);
      return p.outlined(ink.brown).trimmed();
    }
    const leaf = s === 2 ? [P.autumn[0], P.autumn[1], P.autumn[2]] : [P.leaf[1], P.leaf[2], P.leaf[3]];
    p.ellipse(10, g - 4, 7, 4, leaf[0]);
    p.ellipse(9, g - 5, 5, 3, leaf[1]);
    p.ellipse(7, g - 6, 2, 1, leaf[2]);
    for (let i = 0; i < 4; i++) {
      const x = 5 + ((v + i * 3) % 10);
      const y = g - 3 - (i % 3);
      p.set(x, y, s === 0 ? P.white : P.red[2]);
    }
    return p.outlined(leaf[0] === P.autumn[0] ? P.autumn[0] : P.leaf[0]).trimmed();
  });
}

/** 岸边的岩石（一大一小两块）：左上受光；群岛是黑色火山岩，沙漠是砂岩。 */
export function rock(t: Terrain, variant: number, snow: boolean): Px {
  const v = Math.abs(Math.floor(variant)) || 0;
  return memo(`wild-rock|${t}|${v % 4}|${snow}`, () => {
    const ramp: readonly string[] = t === "desert" ? [P.sand[0], P.sand[1], P.sand[2], P.sand[3]] : t === "island" ? [ink.deep, P.iron[1], P.iron[2], P.iron[3]] : [P.stone[0], P.stone[1], P.stone[2], P.stone[3]];
    const p = new Px(28, 18);
    const g = 17;
    const big = 7 + (v % 3);
    p.ellipse(10, g - big + 2, big, big - 1, ramp[1]);
    p.rect(3, g - 3, 15, 4, ramp[1]);
    p.ellipse(9, g - big + 1, big - 2, big - 3, ramp[2]);
    p.ellipse(7, g - big, 3, 2, ramp[3]);
    p.line(12, g - big + 1, 15, g - 2, ramp[0]);
    p.ellipse(21, g - 3, 4, 3, ramp[1]);
    p.ellipse(20, g - 4, 2, 1, ramp[2]);
    if (snow) {
      p.hline(6, 12, g - big * 2 + 3, P.snow[3]);
      p.hline(5, 14, g - big * 2 + 4, P.snow[2]);
    } else if (t !== "desert" && t !== "island") {
      p.set(15, g - 1, P.leaf[1]).set(16, g - 1, P.leaf[2]).set(4, g - 1, P.leaf[1]);
    }
    return p.outlined(ramp[0]).trimmed();
  });
}

/** 古代阿尔坎帝国的残垣：半截拱墙、几根断柱、倒地的柱段，爬着藤蔓。原创造型。 */
export function ruins(t: Terrain, season: number, variant: number): Px {
  const s = seasonOf(season);
  const v = Math.abs(Math.floor(variant)) || 0;
  return memo(`wild-ruins|${t}|${s}|${v % 2}`, () => {
    const M: readonly string[] = t === "desert" ? [P.sand[1], P.sand[2], P.sand[3], P.sand[4]] : [P.stone[1], P.stone[2], P.stone[3], P.stone[4]];
    const p = new Px(76, 48);
    const g = 47;
    // 残墙：错缝石块，一个半塌的拱门
    const wx = 4;
    const ww = 34;
    const wallTop = (x: number) => g - 30 + Math.round(Math.abs(Math.sin(x * 0.9)) * 3) + (x > wx + 24 ? (x - wx - 24) * 2 : 0);
    for (let x = wx; x < wx + ww; x++) {
      for (let y = wallTop(x); y < g; y++) {
        const row = Math.floor((g - y) / 4);
        const brick = Math.floor((x + (row % 2) * 3) / 6);
        const r = h01(brick, row, 3);
        let col: string = r < 0.2 ? M[1] : r > 0.85 ? M[3] : M[2];
        if ((g - y) % 4 === 0 || (x + (row % 2) * 3) % 6 === 0) col = M[1];
        p.set(x, y, col);
      }
    }
    // 拱门洞
    const ax = wx + 10;
    for (let y = g - 18; y < g; y++) {
      const k = y < g - 12 ? Math.round(6 - Math.sqrt(Math.max(0, 36 - (g - 12 - y) * (g - 12 - y)))) : 0;
      p.hline(ax + k, ax + 11 - k, y, ink.brown);
    }
    for (let i = 0; i < 12; i++) {
      const a = Math.PI * (i / 11);
      p.set(ax + 5.5 - Math.cos(a) * 7, g - 12 - Math.sin(a) * 7, M[3]);
    }
    // 断柱：带凹槽的柱身，一根完整带柱头，一根折断
    const column = (x: number, hh: number, cap: boolean) => {
      p.rect(x, g - hh, 5, hh, M[2]);
      p.vline(x, g - hh, g - 1, M[3]);
      p.vline(x + 2, g - hh, g - 1, M[1]);
      p.vline(x + 4, g - hh, g - 1, M[1]);
      p.rect(x - 1, g - 2, 7, 2, M[2]);
      if (cap) {
        p.rect(x - 2, g - hh - 3, 9, 3, M[3]);
        p.hline(x - 2, x + 6, g - hh - 3, M[3]);
        p.hline(x - 2, x + 6, g - hh - 1, M[1]);
      } else {
        p.set(x + 1, g - hh - 1, M[2]).set(x + 3, g - hh, M[2]);
      }
    };
    column(44, 36, true);
    column(56, 20 + (v % 2) * 6, false);
    // 倒地的柱段
    p.rect(62, g - 5, 12, 5, M[2]);
    p.hline(62, 73, g - 5, M[3]);
    p.hline(62, 73, g - 3, M[1]);
    p.ellipse(73, g - 3, 2, 2, M[3]);
    p.set(73, g - 3, M[1]);
    // 藤蔓与杂草
    if (t !== "desert") {
      const vine = s === 2 ? [P.autumn[1], P.autumn[2]] : s === 3 ? [P.wood[1], P.leaf[1]] : [P.leaf[1], P.leaf[2]];
      for (const [x, y0, len] of [
        [wx + 2, g - 28, 22],
        [wx + 27, g - 20, 14],
        [45, g - 36, 20],
      ] as const) {
        for (let k = 0; k < len; k++) {
          const xx = x + Math.round(Math.sin(k / 3) * 1.5);
          p.set(xx, y0 + k, k % 3 ? vine[0] : vine[1]);
          if (k % 4 === 0) p.set(xx + 1, y0 + k, vine[1]);
        }
      }
      for (let x = 0; x < 76; x += 3) if (h01(x, 1, 7) < 0.6) p.vline(x, g - 2, g, P.leaf[2]);
    }
    return p.outlined(M[0]).trimmed();
  });
}

/** 搁浅的小艇：侧翻在沙滩上，船板缺了几块，断桅斜插。 */
export function wreck(): Px {
  return memo("wild-wreck", () => {
    const p = new Px(40, 20);
    const g = 19;
    for (let x = 2; x < 34; x++) {
      const t = (x - 2) / 31;
      const top = g - 9 + Math.round(Math.pow(t - 0.45, 2) * 16);
      for (let y = top; y < g - 1; y++) {
        const plank = Math.floor((y - top) / 2);
        let col: string = plank % 2 ? P.wood[1] : P.wood[2];
        if (y === top) col = P.wood[3];
        if (x > 14 && x < 19 && y > top + 2 && y < g - 3) col = ink.brown;
        p.set(x, y, col);
      }
    }
    p.hline(3, 32, g - 1, P.wood[0]);
    // 断桅
    p.line(20, g - 8, 30, g - 18, P.wood[2]);
    p.line(21, g - 8, 31, g - 18, P.wood[1]);
    // 一截破帆
    p.poly(
      [
        [28, g - 16],
        [36, g - 12],
        [30, g - 10],
      ],
      P.parchmentDark,
    );
    p.line(28, g - 16, 36, g - 12, P.parchment);
    return p.outlined(ink.brown).trimmed();
  });
}

/** 被冲上岸的浮木。 */
export function driftwood(variant: number): Px {
  return memo(`wild-drift|${variant % 2}`, () => {
    const p = new Px(20, 6);
    p.rect(1, 2, 16, 2, P.stone[3]);
    p.hline(1, 16, 2, P.stone[4]);
    p.line(12, 2, 16, 0, P.stone[2]);
    if (variant % 2) p.line(4, 2, 2, 0, P.stone[2]);
    return p.outlined(P.stone[1]).trimmed();
  });
}

/** 泥沼里的一汪积水：暗色水面带一道天光。 */
export function pool(w: number): Px {
  return memo(`wild-pool|${w}`, () => {
    const p = new Px(w, 5);
    p.ellipse(w / 2 - 0.5, 2, w / 2 - 0.5, 2, P.sea[1]);
    p.hline(Math.round(w * 0.2), Math.round(w * 0.55), 1, P.sea[3]);
    p.hline(Math.round(w * 0.3), Math.round(w * 0.7), 3, P.sea[0]);
    return p;
  });
}
