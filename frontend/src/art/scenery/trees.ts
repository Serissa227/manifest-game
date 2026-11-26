// 树木：温带阔叶树（春花、夏绿、秋黄、冬枯挂雪）、寒带松树（冬季积雪）、
// 干旱地区的椰枣 / 橄榄 / 仙人掌、热带的椰子树与芭蕉。每种至少 3 个造型变体。
// 返回的图底边就是地面线（树根处带 1–2 像素的投影），左右与上方已裁掉透明边。
import { P, ink, overlay } from "../palette";
import { Px, rgba, type Rgba } from "../px";
import { rng, type Rng } from "../rng";
import type { Climate } from "./types";
import { h2, mix, outlineInPlace, seasonOf } from "./util";

/** 各气候的树种；variant % 种数 选树种，floor(variant / 种数) 选造型。 */
export const TREE_KINDS: Record<Climate, readonly string[]> = {
  temperate: ["broadleaf"],
  cold: ["pine"],
  arid: ["date", "olive", "cactus"],
  tropical: ["coconut", "banana"],
};

/** variant 对应的树种。 */
export function treeKind(climate: Climate, variant: number): string {
  const kinds = TREE_KINDS[climate] ?? TREE_KINDS.temperate;
  return kinds[(Math.abs(Math.floor(variant)) || 0) % kinds.length];
}

const CW = 56;
const CH = 64;
/** 画布中的树根位置 */
const BX = 28;
const BY = CH - 3;

/** 五阶色：描边、暗、中、亮、高光。 */
type Tone5 = readonly [Rgba, Rgba, Rgba, Rgba, Rgba];
const T5 = (a: string | Rgba, b: string | Rgba, c: string | Rgba, d: string | Rgba, e: string | Rgba): Tone5 =>
  [rgba(a), rgba(b), rgba(c), rgba(d), rgba(e)] as const;

const LEAF = T5(P.leaf[0], P.leaf[1], P.leaf[2], P.leaf[3], P.leaf[4]);
const LEAF_SPRING = T5(P.leaf[0], P.leaf[2], P.leaf[3], P.leaf[4], mix(P.leaf[4], P.white, 0.3));
const BLOSSOM = T5(mix(P.blossom[0], ink.deep, 0.35), P.blossom[0], P.blossom[1], P.blossom[2], P.blossom[3]);
const AUTUMN = T5(mix(P.autumn[0], ink.brown, 0.4), P.autumn[0], P.autumn[1], P.autumn[2], P.autumn[3]);
const GOLDEN = T5(mix(P.autumn[0], ink.brown, 0.4), P.autumn[1], P.gold[2], P.gold[3], P.gold[4]);
const BARK = T5(ink.brown, P.wood[0], P.wood[1], P.wood[2], P.wood[3]);
const SNOW = T5(P.snow[0], P.snow[0], P.snow[1], P.snow[2], P.snow[3]);

// ---------------------------------------------------------------- 通用绘制

/** 粗线（逐点画圆盘），颜色按与左侧的相对位置取亮 / 中 / 暗三阶。 */
function limb(p: Px, x0: number, y0: number, x1: number, y1: number, w0: number, w1: number, t: Tone5): void {
  const len = Math.max(1, Math.hypot(x1 - x0, y1 - y0));
  const steps = Math.ceil(len * 2);
  for (let i = 0; i <= steps; i++) {
    const k = i / steps;
    const cx = x0 + (x1 - x0) * k;
    const cy = y0 + (y1 - y0) * k;
    const r = (w0 + (w1 - w0) * k) / 2;
    for (let y = Math.floor(cy - r); y <= cy + r; y++) {
      for (let x = Math.floor(cx - r); x <= cx + r; x++) {
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        if (dx * dx + dy * dy > r * r + 0.25) continue;
        const side = dx / Math.max(0.5, r);
        p.put(x, y, side < -0.35 ? t[3] : side > 0.3 ? t[1] : t[2]);
      }
    }
  }
}

interface Blob {
  x: number;
  y: number;
  rx: number;
  ry: number;
}

/**
 * 叶团树冠：先用暗色铺满各团的并集，再按网格撒“叶簇”（4 像素宽的小团，左上一角提亮），
 * 叶簇的明暗由整体受光（左上亮）与所在叶团的局部受光共同决定，下层叶簇压住上层，形成体积。
 * alt 为可选的第二套色（如春花中夹杂的绿叶、秋叶中的金黄），按比例混在叶簇里。
 */
function leafyCrown(p: Px, blobs: readonly Blob[], t: Tone5, seed: number, alts: readonly (readonly [Tone5, number])[] = []): void {
  if (!blobs.length) return;
  const inBlob = (x: number, y: number): Blob | null => {
    let hit: Blob | null = null;
    for (const b of blobs) {
      const nx = (x - b.x) / (b.rx + 0.5);
      const ny = (y - b.y) / (b.ry + 0.5);
      if (nx * nx + ny * ny <= 1) hit = b;
    }
    return hit;
  };
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const b of blobs) {
    x0 = Math.min(x0, b.x - b.rx);
    x1 = Math.max(x1, b.x + b.rx);
    y0 = Math.min(y0, b.y - b.ry);
    y1 = Math.max(y1, b.y + b.ry);
  }
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const R = Math.max(4, (x1 - x0) / 2, (y1 - y0) / 2);
  // 1) 暗色底
  for (let y = Math.floor(y0); y <= y1 + 1; y++) for (let x = Math.floor(x0); x <= x1 + 1; x++) if (inBlob(x + 0.5, y + 0.5)) p.put(x, y, t[1]);
  // 2) 叶簇
  const G = 3;
  for (let gy = Math.floor(y0 / G) - 1; gy * G <= y1 + G; gy++) {
    for (let gx = Math.floor(x0 / G) - 1; gx * G <= x1 + G; gx++) {
      const jx = gx * G + Math.floor(h2(seed, gx, gy) * 3) - 1 + (gy % 2) * 1.5;
      const jy = gy * G + Math.floor(h2(seed + 1, gx, gy) * 2);
      const b = inBlob(jx + 0.5, jy + 0.5);
      if (!b) continue;
      const gl = -(((jx - cx) / R) * 0.65 + ((jy - cy) / R) * 0.8);
      const ll = -(((jx - b.x) / (b.rx + 1)) * 0.6 + ((jy - b.y) / (b.ry + 1)) * 0.8);
      const light = gl * 0.55 + ll * 0.55 + (h2(seed + 2, gx, gy) - 0.5) * 0.3;
      let tone = t;
      const pick = h2(seed + 3, gx, gy);
      let acc = 0;
      for (const [alt, frac] of alts) {
        acc += frac;
        if (pick < acc) {
          tone = alt;
          break;
        }
      }
      if (light < -0.55) continue; // 最暗处留出底色的空隙
      const [base, top] = light > 0.5 ? [tone[3], tone[4]] : light > -0.05 ? [tone[2], tone[3]] : [tone[1], tone[2]];
      const x = Math.round(jx);
      const y = Math.round(jy);
      p.put(x, y - 1, top).put(x + 1, y - 1, base);
      p.put(x - 1, y, top).put(x, y, base).put(x + 1, y, base).put(x + 2, y, base);
      p.put(x, y + 1, base).put(x + 1, y + 1, base);
    }
  }
}

/** 树根处的投影（在描边之后画）。 */
function groundShadow(p: Px, cx: number, halfW: number): void {
  for (let x = Math.floor(cx - halfW); x <= cx + halfW; x++) {
    const edge = Math.abs(x + 0.5 - cx) > halfW - 1.5;
    if (!p.isOpaque(x, BY + 1)) p.set(x, BY + 1, edge ? overlay.shadowLight : overlay.shadow);
    if (!edge && Math.abs(x + 0.5 - cx) < halfW - 3 && !p.isOpaque(x, BY + 2)) p.set(x, BY + 2, overlay.shadowLight);
  }
}

/** 把画布裁成紧贴内容的图，底边保持在投影下沿。 */
function finish(p: Px): Px {
  const b = p.bounds();
  if (!b) return new Px(1, 1);
  return p.crop(b.x, b.y, b.w, CH - b.y);
}

/** 主干：上窄下宽，根部略微外张。 */
function trunk(p: Px, x: number, topY: number, w: number, t: Tone5, lean = 0): void {
  limb(p, x + lean, topY, x, BY, Math.max(2, w - 1), w, t);
  p.put(x - Math.ceil(w / 2) - 1, BY, t[2]).put(x + Math.ceil(w / 2), BY, t[1]);
}

// ---------------------------------------------------------------- 温带阔叶树

function broadleafBlobs(shape: number, r: Rng, topY: number): Blob[] {
  const j = () => r.range(-1.2, 1.2);
  const B = (x: number, y: number, rx: number, ry: number): Blob => ({ x: BX + x + j(), y: topY + y + j(), rx, ry });
  switch (shape) {
    case 0: // 圆冠
      return [B(0, -4, 9, 7), B(-8, 2, 7, 6), B(8, 1, 7, 6), B(0, 4, 11, 7), B(-4, 9, 7, 4), B(5, 9, 7, 4)];
    case 1: // 高挑的卵形冠
      return [B(0, -14, 5, 6), B(-1, -6, 7, 7), B(1, 3, 8, 7), B(-3, 10, 6, 5), B(4, 11, 6, 4)];
    case 2: // 横展的伞形冠
      return [B(-11, 2, 8, 5), B(11, 1, 8, 5), B(0, -3, 10, 6), B(-4, 5, 9, 4), B(6, 5, 9, 4), B(-17, 6, 4, 3), B(17, 5, 4, 3)];
    default: // 小树
      return [B(0, -2, 7, 5), B(-4, 3, 5, 4), B(4, 3, 5, 4)];
  }
}

/** 冬季的枯枝：主干在分叉处散出几根主枝，每根主枝再分出细枝；枝头朝上的一面积雪。 */
function bareBranches(p: Px, shape: number, r: Rng): void {
  const trunkH = [13, 12, 11, 8][shape];
  const fork = BY - trunkH;
  trunk(p, BX, fork, shape === 3 ? 3 : 4, BARK);
  const mains = [
    [2.45, 1.95, 1.3, 0.72],
    [1.98, 1.72, 1.42, 1.15],
    [2.8, 2.25, 0.95, 0.35],
    [2.25, 1.57, 0.9],
  ][shape];
  const mainLen = [11, 14, 13, 8][shape];
  const grow = (x: number, y: number, ang: number, len: number, w: number, d: number) => {
    const x1 = x + Math.cos(ang) * len;
    const y1 = y - Math.sin(ang) * len;
    limb(p, x, y, x1, y1, w, Math.max(1, w - 1), BARK);
    if (d <= 0) return;
    // 一根顺势延伸，一根从中段斜出
    grow(x1, y1, ang + r.range(-0.3, 0.3), len * r.range(0.55, 0.7), Math.max(1, w - 1), d - 1);
    const side = ang < Math.PI / 2 ? -1 : 1;
    grow(x + (x1 - x) * 0.55, y + (y1 - y) * 0.55, ang + side * r.range(0.45, 0.75), len * r.range(0.45, 0.6), 1, d - 1);
  };
  for (const m of mains) grow(BX + r.range(-0.8, 0.8), fork + 1, m + r.range(-0.12, 0.12), mainLen * r.range(0.85, 1.1), 2, 2);
}

function snowOnTop(p: Px, seed: number): void {
  const src = p.clone();
  for (let y = 1; y < p.h; y++) {
    for (let x = 1; x < p.w - 1; x++) {
      if (!src.isOpaque(x, y) || src.isOpaque(x, y - 1)) continue;
      const flat = src.isOpaque(x - 1, y) || src.isOpaque(x + 1, y);
      if (flat && h2(seed, x, y) < 0.8 && y < BY - 2) {
        p.put(x, y - 1, SNOW[4]);
        if (h2(seed + 1, x, y) < 0.4 && !src.isOpaque(x, y - 2)) p.put(x, y - 2, SNOW[3]);
      }
    }
  }
}

function broadleaf(season: number, shape: number, seed: number): Px {
  const p = new Px(CW, CH);
  const r = rng(`broadleaf:${seed}`);
  if (season === 3) {
    bareBranches(p, shape, r);
    snowOnTop(p, seed);
    outlineInPlace(p, rgba(ink.brown));
    groundShadow(p, BX, 7);
    // 树根旁的一小堆积雪
    for (let x = BX - 6; x <= BX + 6; x++) if (!p.isOpaque(x, BY)) p.put(x, BY, Math.abs(x - BX) > 4 ? SNOW[2] : SNOW[3]);
    return finish(p);
  }
  const trunkH = [14, 12, 14, 9][shape];
  const crownY = BY - trunkH - [12, 13, 7, 7][shape];
  trunk(p, BX, crownY + 4, shape === 3 ? 3 : 4, BARK);
  if (shape === 2) {
    limb(p, BX, BY - trunkH + 2, BX - 9, crownY + 4, 3, 2, BARK);
    limb(p, BX, BY - trunkH + 2, BX + 9, crownY + 3, 3, 2, BARK);
  }
  const blobs = broadleafBlobs(shape, r, crownY);
  if (season === 0) leafyCrown(p, blobs, BLOSSOM, seed * 7 + 1, [[LEAF_SPRING, 0.28]]);
  else if (season === 1) leafyCrown(p, blobs, LEAF, seed * 7 + 1);
  else
    leafyCrown(p, blobs, AUTUMN, seed * 7 + 1, [
      [GOLDEN, 0.35],
      [LEAF, 0.08],
    ]);
  const outline = season === 0 ? BLOSSOM[0] : season === 2 ? AUTUMN[0] : LEAF[0];
  outlineInPlace(p, outline);
  groundShadow(p, BX, shape === 2 ? 12 : 8);
  // 秋季：树下的落叶
  if (season === 2) {
    for (let i = 0; i < 5; i++) {
      const x = BX - 9 + Math.floor(h2(seed + 50, i) * 19);
      if (Math.abs(x - BX) > 2) p.put(x, BY + 1, i % 2 ? P.autumn[2] : P.gold[3]);
    }
  }
  return finish(p);
}

// ---------------------------------------------------------------- 寒带松树

const PINE = T5(mix(P.leaf[0], ink.blue, 0.3), mix(P.leaf[1], P.teal[0], 0.25), mix(P.leaf[1], P.teal[1], 0.3), mix(P.leaf[2], P.teal[2], 0.3), mix(P.leaf[3], P.teal[3], 0.3));

function pine(season: number, shape: number, seed: number): Px {
  const p = new Px(CW, CH);
  const [tiers, height, maxHalf] = [
    [6, 42, 8],
    [5, 34, 11],
    [4, 27, 13],
  ][shape];
  const tone = season === 1 ? T5(PINE[0], PINE[1], PINE[2], PINE[3], mix(PINE[4], P.leaf[4], 0.3)) : PINE;
  const trunkH = 5;
  trunk(p, BX, BY - trunkH - 2, 3, BARK);
  const top = BY - trunkH - height;
  const winter = season === 3;
  for (let k = 0; k < tiers; k++) {
    // 每层：从上一层中部开始，向下张开成锯齿下缘
    const ty = top + (k * height) / (tiers + 0.6);
    const th = height / (tiers - 0.2) + 2;
    const half = 2.5 + (maxHalf - 2.5) * ((k + 1) / tiers);
    for (let y = Math.floor(ty); y <= ty + th; y++) {
      const t = (y - ty) / th;
      const hw = half * Math.pow(t, 0.8) + 0.5;
      for (let x = Math.floor(BX - hw); x <= BX + hw; x++) {
        const dx = x + 0.5 - BX;
        if (Math.abs(dx) > hw) continue;
        // 下缘的锯齿：每隔两像素下垂一格
        if (t > 0.86 && (x & 1) === 1 && h2(seed + k, x) < 0.7) continue;
        const side = dx / hw;
        let c = side < -0.45 ? tone[3] : side < 0.1 ? tone[2] : tone[1];
        if (t > 0.78) c = side < -0.3 ? tone[2] : tone[1];
        if (side < -0.2 && t < 0.3 && t > 0.05) c = tone[4];
        if (winter && t < 0.34 + (side < 0 ? 0.12 : 0) && side < 0.55) c = side < -0.1 ? SNOW[4] : SNOW[3];
        p.put(x, y, c);
      }
    }
  }
  if (winter) {
    // 树冠顶上的雪帽
    p.put(BX, top - 1, SNOW[4]).put(BX - 1, top, SNOW[4]).put(BX, top, SNOW[4]);
  }
  outlineInPlace(p, tone[0]);
  groundShadow(p, BX, maxHalf - 2);
  if (winter) for (let x = BX - maxHalf; x <= BX + maxHalf; x++) if (!p.isOpaque(x, BY)) p.put(x, BY, Math.abs(x - BX) > maxHalf - 3 ? SNOW[2] : SNOW[3]);
  return finish(p);
}

// ---------------------------------------------------------------- 棕榈类的叶片

/** 沿曲线画一片带状叶子：宽度随 t 变化，上侧亮下侧暗，中脉一线。 */
function ribbon(
  p: Px,
  path: (t: number) => readonly [number, number],
  width: (t: number) => number,
  paint: (side: number, k: number, t: number, x: number, y: number) => Rgba | 0,
  n = 40,
): void {
  const pts = Array.from({ length: n + 1 }, (_, i) => path(i / n));
  const maxW = Math.max(...pts.map((_, i) => width(i / n))) + 1;
  const xs = pts.map((q) => q[0]);
  const ys = pts.map((q) => q[1]);
  for (let y = Math.floor(Math.min(...ys) - maxW); y <= Math.max(...ys) + maxW; y++) {
    for (let x = Math.floor(Math.min(...xs) - maxW); x <= Math.max(...xs) + maxW; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      let bi = 0;
      let bd = Infinity;
      for (let i = 0; i <= n; i++) {
        const d = (px - pts[i][0]) ** 2 + (py - pts[i][1]) ** 2;
        if (d < bd) {
          bd = d;
          bi = i;
        }
      }
      const t = bi / n;
      const wd = width(t);
      const d = Math.sqrt(bd);
      if (d > wd || wd <= 0) continue;
      const a = pts[Math.max(0, bi - 1)];
      const b = pts[Math.min(n, bi + 1)];
      const cross = (b[0] - a[0]) * (py - pts[bi][1]) - (b[1] - a[1]) * (px - pts[bi][0]);
      const c = paint(Math.sign(cross), d / wd, t, x, y);
      if (c) p.put(x, y, c);
    }
  }
}

/** 羽状棕榈叶：沿弧线下垂，下缘一排小叶片（锯齿）。 */
function frond(p: Px, sx: number, sy: number, ang: number, len: number, droop: number, t: Tone5, thick: number): void {
  // droop：叶尖下垂的像素数（越靠水平的叶子垂得越多）
  const sag = droop * (0.45 + Math.abs(Math.cos(ang)) * 0.8);
  const dir = Math.cos(ang) >= 0 ? 1 : -1;
  ribbon(
    p,
    (k) => [sx + Math.cos(ang) * len * k, sy - Math.sin(ang) * len * k + sag * k * k],
    (k) => (k < 0.08 ? 0.8 : thick * Math.sin(Math.PI * Math.min(1, k * 1.1)) + 0.4),
    (side, kk, k, x) => {
      const under = side * dir > 0;
      // 下侧：隔列留缝，形成一排小叶片
      if (under && kk > 0.45 && (x & 1) === 0 && k > 0.2) return 0;
      if (kk < 0.3) return k < 0.5 ? t[4] : t[3];
      return under ? t[1] : k < 0.6 ? t[3] : t[2];
    },
    30,
  );
}

const PALM = T5(mix(P.leaf[0], ink.deep, 0.2), P.leaf[1], P.leaf[2], P.leaf[3], P.leaf[4]);
const DATE_LEAF = T5(mix(P.leaf[0], ink.deep, 0.2), mix(P.leaf[1], P.stone[1], 0.25), mix(P.leaf[2], P.stone[2], 0.3), mix(P.leaf[3], P.stone[3], 0.3), mix(P.leaf[4], P.stone[4], 0.35));
const PALM_BARK = T5(ink.brown, P.wood[1], P.wood[2], P.wood[3], P.sand[4]);

/** 椰枣：笔直粗糙的树干（菱形叶鞘纹）、灰绿色的硬挺羽叶、橙褐色的果串。 */
function datePalm(season: number, shape: number, seed: number): Px {
  const p = new Px(CW, CH);
  const r = rng(`date:${seed}`);
  const H = [36, 28, 32][shape];
  const lean = [0, 3, -4][shape];
  const topX = BX + lean;
  const topY = BY - H;
  for (let y = topY; y <= BY; y++) {
    const k = (BY - y) / H;
    const x = Math.round(BX + lean * k * k);
    const rowPat = (y - topY) % 3;
    for (let i = -2; i <= 1; i++) {
      let c = i === -2 ? PALM_BARK[3] : i === 1 ? PALM_BARK[1] : PALM_BARK[2];
      if (rowPat === 0 && (i === -1 || i === 0)) c = PALM_BARK[1];
      if (rowPat === 1 && i === -2) c = PALM_BARK[4];
      p.put(x + i, y, c);
    }
  }
  const leaf = season === 3 ? T5(DATE_LEAF[0], DATE_LEAF[1], DATE_LEAF[2], mix(DATE_LEAF[3], P.straw[2], 0.25), DATE_LEAF[4]) : DATE_LEAF;
  const angles = [2.9, 2.45, 1.95, 1.45, 1.0, 0.55, 0.15, 3.4, -0.25];
  for (const a of angles) frond(p, topX, topY, a + r.range(-0.08, 0.08), r.range(13, 17), r.range(5, 7), leaf, 1.6);
  // 果串（夏秋）
  if (season === 1 || season === 2) {
    for (const [dx, dy] of [
      [-3, 2],
      [-2, 3],
      [-3, 4],
      [2, 2],
      [3, 3],
      [2, 4],
    ] as const) {
      p.put(topX + dx, topY + dy, P.autumn[1]).put(topX + dx + 1, topY + dy, P.autumn[2]);
    }
  }
  // 顶芽
  p.put(topX, topY - 2, leaf[3]).put(topX, topY - 1, leaf[2]);
  outlineInPlace(p, leaf[0]);
  groundShadow(p, BX, 6);
  return finish(p);
}

/** 橄榄：扭曲的双股树干、低矮宽阔的银绿色树冠。 */
function olive(season: number, shape: number, seed: number): Px {
  const p = new Px(CW, CH);
  const r = rng(`olive:${seed}`);
  const ton = T5(
    mix(P.leaf[0], ink.deep, 0.2),
    mix(P.leaf[1], P.stone[1], 0.35),
    mix(P.leaf[2], P.stone[2], 0.4),
    mix(P.leaf[3], P.stone[3], 0.45),
    mix(P.leaf[4], P.stone[4], 0.5),
  );
  const tone = season === 3 ? T5(ton[0], ton[1], ton[2], mix(ton[3], P.stone[3], 0.3), ton[4]) : ton;
  const bark = T5(ink.brown, mix(P.wood[0], P.stone[1], 0.3), mix(P.wood[1], P.stone[2], 0.3), mix(P.wood[2], P.stone[3], 0.3), P.stone[3]);
  const crownY = BY - [18, 15, 20][shape];
  // 两股扭在一起的树干
  limb(p, BX - 2, BY, BX + 1, BY - 6, 4, 3, bark);
  limb(p, BX + 1, BY - 6, BX - 2, crownY + 5, 3, 2, bark);
  limb(p, BX + 2, BY, BX + 3, BY - 8, 3, 2, bark);
  limb(p, BX + 3, BY - 8, BX + 5, crownY + 4, 2, 2, bark);
  const B = (x: number, y: number, rx: number, ry: number): Blob => ({ x: BX + x + r.range(-1, 1), y: crownY + y + r.range(-1, 1), rx, ry });
  const blobs = [
    [B(-7, 0, 8, 5), B(6, -1, 8, 5), B(0, -4, 8, 5), B(-2, 3, 9, 4), B(7, 3, 6, 3)],
    [B(-11, 1, 7, 4), B(10, 1, 7, 4), B(0, -2, 10, 5), B(-3, 3, 10, 3)],
    [B(-5, -6, 7, 5), B(4, -2, 7, 5), B(-3, 3, 8, 4), B(7, 5, 5, 3), B(-9, 4, 5, 3)],
  ][shape];
  leafyCrown(p, blobs, tone, seed * 5 + 3);
  // 秋季：零星的黑橄榄
  if (season === 2) for (let i = 0; i < 6; i++) p.put(BX - 10 + Math.floor(h2(seed + 80, i) * 20), crownY + Math.floor(h2(seed + 81, i) * 6), P.cloth.purple[0]);
  outlineInPlace(p, tone[0]);
  groundShadow(p, BX, 9);
  return finish(p);
}

/** 仙人掌：带竖肋的柱状仙人掌（一臂 / 两臂），或一丛扁平的仙人掌掌片。春季开花。 */
function cactus(season: number, shape: number, seed: number): Px {
  const p = new Px(CW, CH);
  const tone = T5(mix(P.leaf[0], P.teal[0], 0.4), mix(P.leaf[1], P.teal[1], 0.35), mix(P.leaf[2], P.teal[1], 0.3), mix(P.leaf[3], P.teal[2], 0.3), mix(P.leaf[4], P.teal[3], 0.35));
  const col = (x0: number, y0: number, y1: number, wd: number) => {
    for (let y = y0; y <= y1; y++) {
      for (let i = 0; i < wd; i++) {
        const round = y - y0 < 2 && (i === 0 || i === wd - 1);
        if (round && y === y0) continue;
        const rel = i / (wd - 1);
        let c = rel < 0.25 ? tone[3] : rel > 0.75 ? tone[1] : tone[2];
        if (i % 2 === 1 && rel < 0.75) c = rel < 0.4 ? tone[4] : tone[3];
        p.put(x0 + i, y, c);
      }
    }
  };
  const flower = (x: number, y: number) => {
    if (season !== 0) return;
    p.put(x, y, P.blossom[2]).put(x + 1, y, P.blossom[1]).put(x, y - 1, P.blossom[3]).put(x + 1, y - 1, P.gold[3]);
  };
  if (shape < 2) {
    const H = shape === 0 ? 26 : 32;
    const top = BY - H;
    // 手臂：从主干侧面横出，拐个圆弯再向上；先画手臂，再画主干盖住接口
    const arm = (dir: number, y: number, up: number) => {
      const ax = dir < 0 ? BX - 9 : BX + 5;
      const x0 = dir < 0 ? ax + 2 : BX + 2;
      const x1 = dir < 0 ? BX - 2 : ax + 1;
      for (let x = x0; x <= x1; x++) {
        p.put(x, y, tone[3]).put(x, y + 1, tone[2]).put(x, y + 2, tone[2]).put(x, y + 3, tone[1]);
      }
      col(ax, y - up, y + 3, 4);
      // 拐角处补圆
      p.put(dir < 0 ? ax + 3 : ax, y + 3, tone[1]);
      flower(ax + 1, y - up);
    };
    arm(-1, top + 13, 7);
    if (shape === 1) arm(1, top + 9, 8);
    col(BX - 3, top, BY, 6);
    flower(BX - 1, top);
  } else {
    // 仙人掌掌片：一片叠一片的椭圆
    const pads: [number, number, number, number][] = [
      [0, -5, 5, 6],
      [-6, -12, 4, 5],
      [5, -13, 4, 5],
      [-1, -19, 4, 4],
    ];
    for (const [dx, dy, rx, ry] of pads) {
      const cx = BX + dx;
      const cy = BY + dy;
      for (let y = Math.floor(cy - ry); y <= cy + ry; y++) {
        for (let x = Math.floor(cx - rx); x <= cx + rx; x++) {
          const nx = (x + 0.5 - cx) / (rx + 0.5);
          const ny = (y + 0.5 - cy) / (ry + 0.5);
          if (nx * nx + ny * ny > 1) continue;
          const l = nx * 0.6 + ny * 0.8;
          p.put(x, y, l < -0.45 ? tone[4] : l < 0 ? tone[3] : l < 0.5 ? tone[2] : tone[1]);
        }
      }
      // 刺座
      p.put(cx - 2, cy - 1, P.straw[3]).put(cx + 1, cy + 1, P.straw[3]).put(cx - 1, cy + 3, P.straw[2]);
      if (season === 0 || season === 1) p.put(cx, cy - ry - 1, season === 0 ? P.gold[3] : P.red[2]).put(cx + 1, cy - ry - 1, season === 0 ? P.gold[2] : P.red[1]);
    }
  }
  // 刺：沿边缘的浅色小点
  const src = p.clone();
  for (let y = 0; y < CH; y++) for (let x = 0; x < CW; x++) if (src.isOpaque(x, y) && !src.isOpaque(x - 1, y) && h2(seed + 90, x, y) < 0.3) p.put(x - 1, y, P.straw[3]);
  outlineInPlace(p, tone[0]);
  groundShadow(p, BX, 6);
  return finish(p);
}

/** 椰子树：弯曲的环纹树干、长而下垂的羽叶、椰子。 */
function coconut(season: number, shape: number, seed: number): Px {
  const p = new Px(CW, CH);
  const r = rng(`coconut:${seed}`);
  const trees: [number, number, number][] =
    shape === 0
      ? [[BX - 3, 40, 11]]
      : shape === 1
        ? [[BX + 3, 33, -9]]
        : [
            [BX - 3, 30, -7],
            [BX + 2, 36, 8],
          ];
  const leaf = season === 3 ? T5(PALM[0], PALM[1], PALM[2], mix(PALM[3], P.straw[3], 0.2), PALM[4]) : PALM;
  for (const [bx, H, lean] of trees) {
    const topY = BY - H;
    let topX = bx;
    for (let y = BY; y >= topY; y--) {
      const k = (BY - y) / H;
      const x = Math.round(bx + lean * k * k);
      topX = x;
      const ring = (BY - y) % 3 === 0;
      const wd = k < 0.2 ? 4 : 3;
      for (let i = 0; i < wd; i++) {
        let c = i === 0 ? PALM_BARK[3] : i === wd - 1 ? PALM_BARK[1] : PALM_BARK[2];
        if (ring) c = i === 0 ? PALM_BARK[2] : PALM_BARK[1];
        p.put(x - 1 + i, y, c);
      }
    }
    const cx = topX + 0.5;
    const cy = topY;
    const angles = [3.05, 2.55, 2.05, 1.6, 1.1, 0.6, 0.1, 3.5, -0.4];
    for (const a of angles) frond(p, cx, cy, a + r.range(-0.1, 0.1), r.range(15, 19), r.range(8, 11), leaf, 2);
    // 椰子
    for (const [dx, dy] of [
      [-2, 2],
      [1, 2],
      [-1, 4],
    ] as const) {
      p.put(cx + dx, cy + dy, P.wood[1]).put(cx + dx + 1, cy + dy, P.wood[0]).put(cx + dx, cy + dy - 1, P.wood[2]).put(cx + dx + 1, cy + dy - 1, P.wood[1]);
    }
  }
  outlineInPlace(p, leaf[0]);
  groundShadow(p, BX, 7);
  return finish(p);
}

/** 芭蕉：粗短的假茎、几片宽大的叶子（中脉明显、边缘有撕裂），有时挂着一串蕉果和紫色花苞。 */
function banana(season: number, shape: number, seed: number): Px {
  const p = new Px(CW, CH);
  const r = rng(`banana:${seed}`);
  const stemH = [10, 14, 8][shape];
  const stem = T5(mix(P.leaf[0], P.wood[0], 0.4), mix(P.leaf[1], P.wood[1], 0.45), mix(P.leaf[2], P.wood[2], 0.45), mix(P.leaf[3], P.wood[3], 0.4), P.leaf[4]);
  const topY = BY - stemH;
  limb(p, BX, BY, BX, topY, 5, 4, stem);
  const leafT = season === 3 ? T5(P.leaf[0], P.leaf[1], P.leaf[2], mix(P.leaf[3], P.straw[2], 0.3), P.leaf[4]) : LEAF;
  // 叶子：[角度, 长度]；芭蕉叶长而宽、叶尖圆钝，向外拱出再下垂
  const leaves: [number, number][] = [
    [
      [2.75, 19],
      [2.15, 17],
      [1.62, 15],
      [1.05, 18],
      [0.4, 20],
    ],
    [
      [2.9, 21],
      [2.35, 19],
      [1.75, 16],
      [1.2, 17],
      [0.65, 19],
      [0.2, 20],
    ],
    [
      [2.6, 15],
      [1.9, 13],
      [1.2, 14],
      [0.5, 15],
    ],
  ][shape] as [number, number][];
  for (const [a0, len] of leaves) {
    const a = a0 + r.range(-0.1, 0.1);
    const droop = r.range(7, 10) * (0.35 + Math.abs(Math.cos(a)));
    const tears = r.int(0, 999);
    ribbon(
      p,
      (k) => [BX + Math.cos(a) * len * k, topY - Math.sin(a) * len * k + droop * k * k],
      (k) => (k < 0.1 ? 0.9 : k > 0.86 ? 3.3 * Math.sqrt(Math.max(0, (1 - k) / 0.14)) + 0.3 : Math.min(3.6, 0.9 + (k - 0.1) * 14)),
      (side, kk, k, x, y) => {
        if (kk < 0.22) return leafT[4];
        const lower = side * (Math.cos(a) >= 0 ? 1 : -1) > 0;
        // 叶缘的撕裂：外缘隔几列缺一格
        if (kk > 0.7 && h2(tears, x, y) < 0.22) return 0;
        if (kk > 0.8) return lower ? leafT[1] : leafT[2];
        return lower ? leafT[2] : k < 0.55 ? leafT[3] : leafT[2];
      },
      36,
    );
  }
  if (shape === 1 && season !== 3) {
    // 一串蕉果与下垂的紫色花苞
    const fx = BX + 4;
    const fy = topY + 2;
    for (let i = 0; i < 4; i++) {
      p.put(fx + i % 2, fy + i, P.gold[2]).put(fx + 1 + i % 2, fy + i, P.leaf[3]).put(fx + 2 + i % 2, fy + i, P.leaf[2]);
    }
    p.put(fx + 2, fy + 4, P.cloth.purple[1]).put(fx + 2, fy + 5, P.cloth.purple[1]).put(fx + 3, fy + 5, P.cloth.purple[0]).put(fx + 2, fy + 6, P.cloth.purple[0]);
  }
  outlineInPlace(p, leafT[0]);
  groundShadow(p, BX, 7);
  return finish(p);
}

/** 一棵树（或棕榈、仙人掌、松树，取决于气候）；variant 相同则图相同。 */
export function drawTree(climate: Climate, season: number, variant: number): Px {
  const s = seasonOf(season);
  const v = Math.abs(Math.floor(variant)) || 0;
  const kinds = TREE_KINDS[climate] ?? TREE_KINDS.temperate;
  const kind = kinds[v % kinds.length];
  const shapes = kind === "broadleaf" ? 4 : 3;
  const shape = Math.floor(v / kinds.length) % shapes;
  switch (kind) {
    case "pine":
      return pine(s, shape, v);
    case "date":
      return datePalm(s, shape, v);
    case "olive":
      return olive(s, shape, v);
    case "cactus":
      return cactus(s, shape, v);
    case "coconut":
      return coconut(s, shape, v);
    case "banana":
      return banana(s, shape, v);
    default:
      return broadleaf(s, shape, v);
  }
}
