// 建筑绘制的公共工具：画布、坐标哈希、材质纹理、屋顶轮廓、描边、积雪与季节装饰。
// 所有函数都是确定性的（只用坐标哈希，不用 Math.random），同样的参数永远画出同样的图。
import type { TownStyle } from "../buildings";
import { P, ink } from "../palette";
import { Px, luma, rgba, type Pt, type Rgba } from "../px";

/** 一条由暗到亮的色阶。 */
export type Ramp = readonly string[];

/** 坐标哈希：返回 [0,1)。纹理细节（砖色、木节、草束）靠它保持确定性。 */
export function h01(x: number, y: number, s = 0): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  h = Math.imul(h, 2246822519);
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
}

/** 绘制选项（由 BuildingOpts 规范化而来）。 */
export interface DrawOpts {
  /** 季节 0 春 1 夏 2 秋 3 冬 */
  season: number;
  snow: boolean;
  lit: boolean;
}

/** 需要积雪替换的屋顶区域：区域内属于 ramp 的像素换成雪色，底部 keep 行保留原色（檐口）。 */
interface RoofMark {
  x: number;
  y: number;
  w: number;
  h: number;
  ramp: Ramp;
  keep: number;
}

/** 水平的承雪面（窗台、招牌顶、屋檐）：[x0, x1, y]。 */
type Ledge = readonly [number, number, number];

/** 一张建筑画布：底边就是地面线（gy），绘制时顺带登记积雪区域与檐口。 */
export class Canvas {
  readonly p: Px;
  readonly roofs: RoofMark[] = [];
  readonly ledges: Ledge[] = [];
  readonly eaves: Ledge[] = [];
  /** 配色变体（民居用来换门窗、墙面的颜色）；风格套件按需读取。 */
  tone = 0;

  constructor(
    w: number,
    h: number,
    readonly style: TownStyle,
    readonly o: DrawOpts,
    readonly seed: number,
  ) {
    this.p = new Px(w, h);
  }

  /** 地面线：第一行“地下”的 y；最底下一行像素是 gy - 1。 */
  get gy(): number {
    return this.p.h;
  }

  get w(): number {
    return this.p.w;
  }

  /** 登记屋顶区域，冬季积雪时整片换成雪色。 */
  markRoof(x: number, y: number, w: number, h: number, ramp: Ramp, keep = 1): void {
    this.roofs.push({ x, y, w, h, ramp, keep });
  }

  /** 登记承雪的水平面（窗台等）。 */
  ledge(x0: number, x1: number, y: number): void {
    this.ledges.push([x0, x1, y]);
  }

  /** 登记檐口（冬季挂冰凌）。 */
  eave(x0: number, x1: number, y: number): void {
    this.eaves.push([x0, x1, y]);
  }

  /** 本张画布内的确定性随机数（0–1）。 */
  rand(k: number): number {
    return h01(k, this.seed, 977);
  }
}

// ───────────────────────── 基础绘制 ─────────────────────────

/** 只在已有不透明像素上叠色（阴影、光晕不会染到透明处）。 */
export function tintOpaque(p: Px, x: number, y: number, w: number, h: number, col: string, dither = 0): void {
  for (let yy = Math.max(0, y); yy < Math.min(p.h, y + h); yy++) {
    for (let xx = Math.max(0, x); xx < Math.min(p.w, x + w); xx++) {
      if (!p.isOpaque(xx, yy)) continue;
      if (dither === 2 && (xx + yy) % 2 !== 0) continue;
      if (dither === 1 && !(xx % 2 === 0 && yy % 2 === 0)) continue;
      p.set(xx, yy, col);
    }
  }
}

/** 把区域内属于 from 色阶的像素整体换到 to 色阶的对应阶（同下标，越界取末阶）。 */
export function shiftRamp(p: Px, x: number, y: number, w: number, h: number, from: Ramp, to: Ramp): void {
  const map = new Map<Rgba, Rgba>();
  from.forEach((c, i) => map.set(rgba(c), rgba(to[Math.min(i, to.length - 1)])));
  for (let yy = Math.max(0, y); yy < Math.min(p.h, y + h); yy++) {
    for (let xx = Math.max(0, x); xx < Math.min(p.w, x + w); xx++) {
      const v = map.get(p.get(xx, yy));
      if (v !== undefined) p.put(xx, yy, v);
    }
  }
}

/** 画一段由字符网格定义的小图。key 中的颜色为 null 或缺失的字符都视为透明。 */
export function glyph(p: Px, rows: readonly string[], key: Readonly<Record<string, string>>, x: number, y: number, flip = false): void {
  p.stamp(rows, key, x, y, flip);
}

// ───────────────────────── 材质纹理 ─────────────────────────

/** 灰泥白墙：大面平涂，墙脚一行溅泥，零星成团的旧痕。 */
export function plaster(p: Px, x: number, y: number, w: number, h: number, ramp: Ramp = P.plaster, seed = 0): void {
  p.rect(x, y, w, h, ramp[3]);
  // 墙脚污渍：底部一行实色 + 一行抖动过渡
  p.hline(x, x + w - 1, y + h - 1, ramp[2]);
  p.dither(x, y + h - 2, w, 1, ramp[2], 2);
  // 少量成团的旧痕（2×1 或 1×2）
  const n = Math.floor((w * h) / 160);
  for (let i = 0; i < n; i++) {
    const sx = x + 1 + Math.floor(h01(i, seed, 11) * Math.max(1, w - 3));
    const sy = y + 2 + Math.floor(h01(i, seed, 12) * Math.max(1, h - 5));
    if (h01(i, seed, 13) < 0.5) p.hline(sx, sx + 1, sy, ramp[2]);
    else p.vline(sx, sy, sy + 1, ramp[2]);
  }
}

/** 方整石砌（错缝）：每块石头左上受光、右下暗缝。 */
export function ashlar(
  p: Px,
  x: number,
  y: number,
  w: number,
  h: number,
  ramp: Ramp = P.stone,
  opts: { course?: number; min?: number; max?: number; seed?: number; light?: number } = {},
): void {
  const { course = 4, min = 5, max = 9, seed = 0, light = 2 } = opts;
  const x1 = x + w;
  let row = 0;
  for (let cy = y; cy < y + h; cy += course, row++) {
    const ch = Math.min(course, y + h - cy);
    let cx = x - Math.floor(h01(row, seed, 3) * min);
    let k = 0;
    while (cx < x1) {
      const len = min + Math.floor(h01(k, row + seed * 31, 5) * (max - min + 1));
      const r = h01(k, row + seed * 31, 7);
      const face = r < 0.22 ? ramp[light + 1] : r > 0.86 ? ramp[light - 1] : ramp[light];
      const hi = r < 0.22 ? ramp[Math.min(ramp.length - 1, light + 2)] : ramp[light + 1];
      const a = Math.max(x, cx);
      const b = Math.min(x1, cx + len) - 1;
      if (b >= a) {
        p.rect(a, cy, b - a + 1, ch, face);
        // 顶边受光
        if (ch > 2) p.hline(a, Math.min(b - 1, b), cy, hi);
        // 左边受光
        if (cx >= x && ch > 2) p.vline(cx, cy, cy + ch - 2, hi);
        // 底缝与右缝
        p.hline(a, b, cy + ch - 1, ramp[light - 1]);
        if (cx + len - 1 <= b) p.vline(cx + len - 1, cy, cy + ch - 1, ramp[light - 1]);
      }
      cx += len;
      k++;
    }
  }
}

/** 红砖墙（顺砌错缝）：砖面 2 行、灰缝 1 行，偶有深浅不同的砖。 */
export function bricks(p: Px, x: number, y: number, w: number, h: number, ramp: Ramp = P.brick, seed = 0): void {
  p.rect(x, y, w, h, ramp[1]);
  let row = 0;
  for (let cy = y; cy < y + h; cy += 3, row++) {
    const off = row % 2 ? 3 : 0;
    for (let bx = x - off, k = 0; bx < x + w; bx += 6, k++) {
      const r = h01(k, row, seed + 17);
      const face = r < 0.18 ? ramp[3] : r > 0.9 ? ramp[1] : ramp[2];
      const a = Math.max(x, bx);
      const b = Math.min(x + w - 1, bx + 4);
      if (b < a) continue;
      p.rect(a, cy, b - a + 1, Math.min(2, y + h - cy), face);
      if (face === ramp[2] && r < 0.45) p.hline(a, Math.min(b, a + 1), cy, ramp[3]);
    }
  }
}

/** 原木横墙：每根原木 3 行（亮、中、暗），偶有接缝与木节。 */
export function logs(p: Px, x: number, y: number, w: number, h: number, ramp: Ramp = P.wood, seed = 0): void {
  let row = 0;
  const yEnd = y + h - 1;
  const hl = (yy: number, col: string) => {
    if (yy <= yEnd) p.hline(x, x + w - 1, yy, col);
  };
  for (let ly = y; ly < y + h; ly += 3, row++) {
    hl(ly, ramp[3]);
    hl(ly + 1, ramp[2]);
    hl(ly + 2, ramp[1]);
    // 顶边偶尔断开一段，免得太整齐
    for (let i = 0; i < w; i += 5) if (h01(i, row, seed + 3) < 0.35) p.hline(x + i, Math.min(x + w - 1, x + i + 1), ly, ramp[2]);
    // 木节
    const kx = x + 2 + Math.floor(h01(row, seed, 5) * Math.max(1, w - 5));
    if (h01(row, seed, 6) < 0.6 && ly + 1 <= yEnd) p.set(kx, ly + 1, ramp[1]);
    // 接缝
    if (w > 18 && ly + 1 <= yEnd && h01(row, seed, 8) < 0.5) {
      const jx = x + 6 + Math.floor(h01(row, seed, 9) * (w - 12));
      p.vline(jx, ly, ly + 1, ramp[1]);
    }
  }
}

/** 原木墙角露出的圆木端头（竖排），x 为端头左边。 */
export function logEnds(p: Px, x: number, y: number, h: number, ramp: Ramp = P.wood): void {
  for (let ly = y; ly + 2 < y + h + 1; ly += 3) {
    p.rect(x, ly, 3, 3, ramp[2]);
    p.set(x, ly, ramp[1]);
    p.set(x + 2, ly, ramp[1]);
    p.set(x + 1, ly, ramp[3]);
    p.set(x, ly + 1, ramp[3]);
    p.set(x + 1, ly + 1, ramp[4]);
    p.set(x, ly + 2, ramp[1]);
    p.set(x + 2, ly + 2, ramp[0]);
    p.set(x + 1, ly + 2, ramp[1]);
  }
}

/** 竖向木板：板宽 4，左侧受光、右侧接缝，偶有钉眼。 */
export function planks(p: Px, x: number, y: number, w: number, h: number, ramp: Ramp = P.wood, seed = 0, pitch = 4): void {
  p.rect(x, y, w, h, ramp[2]);
  for (let i = 0; i < w; i++) {
    const ph = (i + seed) % pitch;
    if (ph === 0) p.vline(x + i, y, y + h - 1, ramp[1]);
    else if (ph === 1) p.vline(x + i, y, y + h - 1, ramp[3]);
  }
  for (let i = 0; i < w; i += pitch) {
    if (h01(i, seed, 21) < 0.5) p.set(x + i + 2, y + 1, ramp[1]);
  }
}

/** 横向木板（护墙板）：每板 3 行。 */
export function siding(p: Px, x: number, y: number, w: number, h: number, ramp: Ramp = P.wood): void {
  for (let yy = 0; yy < h; yy++) {
    const ph = yy % 3;
    p.hline(x, x + w - 1, y + yy, ph === 0 ? ramp[3] : ph === 1 ? ramp[2] : ramp[1]);
  }
}

/** 土坯墙：沙色平涂，成团的深浅斑与几道细裂（全部裁在区域内）。 */
export function adobe(p: Px, x: number, y: number, w: number, h: number, ramp: Ramp = P.sand, seed = 0): void {
  p.rect(x, y, w, h, ramp[3]);
  const put = (xx: number, yy: number, col: string) => {
    if (xx >= x && xx < x + w && yy >= y && yy < y + h) p.set(xx, yy, col);
  };
  const n = Math.max(1, Math.floor((w * h) / 90));
  for (let i = 0; i < n; i++) {
    const sx = x + 1 + Math.floor(h01(i, seed, 31) * Math.max(1, w - 5));
    const sy = y + 1 + Math.floor(h01(i, seed, 32) * Math.max(1, h - 3));
    const r = h01(i, seed, 33);
    if (r < 0.45) {
      for (let k = 0; k < 3; k++) {
        put(sx + k, sy, ramp[2]);
        put(sx + k, sy + 1, ramp[2]);
      }
      put(sx + 3, sy + 1, ramp[2]);
    } else if (r < 0.75) {
      for (let k = 0; k < 3; k++) put(sx + k, sy, ramp[4]);
      put(sx + 1, sy + 1, ramp[4]);
    } else {
      put(sx, sy, ramp[1]);
      put(sx, sy + 1, ramp[1]);
      put(sx + 1, sy + 2, ramp[1]);
    }
  }
}

/** 竹篾墙：竖向竹片，每片 3 像素（亮、中、暗），竹节错落。 */
export function bamboo(p: Px, x: number, y: number, w: number, h: number, ramp: Ramp = P.straw, seed = 0): void {
  for (let i = 0; i < w; i++) {
    const ph = i % 3;
    p.vline(x + i, y, y + h - 1, ph === 0 ? ramp[3] : ph === 1 ? ramp[2] : ramp[1]);
  }
  for (let i = 0; i < w; i += 3) {
    const n0 = Math.floor(h01(i, seed, 41) * 6);
    for (let yy = y + n0; yy < y + h; yy += 7) p.hline(x + i, Math.min(x + w - 1, x + i + 1), yy, ramp[1]);
  }
}

/** 编织席墙：2×2 交错编纹。 */
export function woven(p: Px, x: number, y: number, w: number, h: number, ramp: Ramp = P.straw): void {
  p.pattern(x, y, w, h, ["aabc", "abbc", "bcaa", "cbba"], { a: ramp[3], b: ramp[2], c: ramp[1] });
}

/** 珊瑚石：浅粉石块，带成团的气孔。 */
export function coral(p: Px, x: number, y: number, w: number, h: number, seed = 0): void {
  const ramp = [P.blossom[0], P.blossom[1], P.blossom[2], P.blossom[3], P.white];
  ashlar(p, x, y, w, h, ramp, { course: 5, min: 6, max: 11, seed: seed + 5, light: 2 });
  const n = Math.floor((w * h) / 40);
  for (let i = 0; i < n; i++) {
    const sx = x + Math.floor(h01(i, seed, 51) * w);
    const sy = y + Math.floor(h01(i, seed, 52) * h);
    if (p.get(sx, sy) === rgba(P.blossom[2])) p.set(sx, sy, P.blossom[1]);
  }
}

/** 木构架墙：白灰填充，深色立柱、横梁与斜撑（低地上层）。 */
export function timber(p: Px, x: number, y: number, w: number, h: number, bay = 9, braces = true, seed = 0): void {
  plaster(p, x, y, w, h, P.plaster, seed);
  p.hline(x, x + w - 1, y, P.wood[1]);
  p.hline(x, x + w - 1, y + h - 1, P.wood[1]);
  const n = Math.max(1, Math.round(w / bay));
  const step = (w - 2) / n;
  for (let i = 0; i <= n; i++) {
    const px = x + Math.round(i * step);
    p.rect(px, y, 2, h, P.wood[1]);
    p.vline(px, y, y + h - 1, P.wood[2]);
  }
  if (braces) {
    for (let i = 0; i < n; i++) {
      if (h01(i, seed, 61) < 0.5) continue;
      const a = x + Math.round(i * step) + 2;
      const b = x + Math.round((i + 1) * step) - 1;
      if (i % 2) p.line(a, y + 1, b, y + h - 2, P.wood[1]);
      else p.line(a, y + h - 2, b, y + 1, P.wood[1]);
    }
  }
}

/** 按多边形蒙版填充：draw 在同尺寸的临时图上画材质，只把多边形内部的像素拷过来。 */
export function maskedFill(p: Px, poly: readonly Pt[], draw: (t: Px) => void): void {
  const mask = new Px(p.w, p.h).poly(poly, "#ffffff");
  const tex = new Px(p.w, p.h);
  draw(tex);
  const b = mask.bounds();
  if (!b) return;
  for (let y = b.y; y < b.y + b.h; y++) {
    for (let x = b.x; x < b.x + b.w; x++) {
      if (mask.isOpaque(x, y) && tex.isOpaque(x, y)) p.put(x, y, tex.get(x, y));
    }
  }
}

/**
 * 朝街的山墙屋顶：三角形墙面（wall 画材质）+ 沿两坡的屋面带（edge 为暗、中、亮三阶）。
 * 墙底在 y（墙面最下一行是 y），中心 cx，半宽 hw，墙面三角高 h；屋面带厚 thick、出挑 over。
 * 返回屋脊顶点的 y。
 */
export function gableFront(
  c: Canvas,
  cx: number,
  y: number,
  hw: number,
  h: number,
  wall: (t: Px) => void,
  edge: Ramp,
  opts: { thick?: number; over?: number; mark?: Ramp } = {},
): number {
  const p = c.p;
  const { thick = 3, over = 2, mark = edge } = opts;
  const slope = h / (hw + 0.5);
  maskedFill(
    p,
    [
      [cx - hw, y + 1],
      [cx + 0.5, y + 1 - h - 1],
      [cx + hw + 1, y + 1],
    ],
    wall,
  );
  const apex = Math.round(y - h - thick + 1);
  for (let x = cx - hw - over; x <= cx + hw + over; x++) {
    const d = Math.abs(x - cx - (x > cx ? 0 : 0));
    const top = Math.round(apex + d * slope);
    const right = x > cx;
    for (let k = 0; k < thick; k++) {
      const yy = top + k;
      if (yy > y + 1) break;
      let col = k === 0 ? edge[right ? 1 : 2] : k === thick - 1 ? edge[0] : edge[1];
      // 瓦头：每 3 列一个亮点
      if (k === thick - 1 && (x - cx) % 3 === 0) col = edge[right ? 1 : 2];
      p.set(x, yy, col);
    }
  }
  c.markRoof(cx - hw - over, apex, (hw + over) * 2 + 1, y - apex + 2, mark, 0);
  return apex;
}

// ───────────────────────── 屋顶轮廓 ─────────────────────────

/** 屋顶每一列的上下沿；返回 null 表示该列没有屋顶。 */
export type Profile = (x: number) => readonly [number, number] | null;

/** 纹理回调收到的像素信息。 */
export interface RoofPx {
  /** 列上沿与下沿 */
  top: number;
  bot: number;
  /** 距上沿、下沿的行数 */
  fromTop: number;
  fromBot: number;
  /** 本列是否为最左、最右列 */
  edgeL: boolean;
  edgeR: boolean;
  /** 横向位置 0..1 */
  u: number;
}

/** 按轮廓逐列填充屋顶，颜色由 tex 决定（返回 null 跳过）。 */
export function fillProfile(p: Px, x0: number, x1: number, prof: Profile, tex: (x: number, y: number, e: RoofPx) => string | null): void {
  for (let x = x0; x <= x1; x++) {
    const r = prof(x);
    if (!r) continue;
    const [top, bot] = r;
    const edgeL = !prof(x - 1) || (prof(x - 1)?.[0] ?? 0) > top + 1;
    const edgeR = !prof(x + 1) || (prof(x + 1)?.[0] ?? 0) > top + 1;
    for (let y = top; y <= bot; y++) {
      const c = tex(x, y, { top, bot, fromTop: y - top, fromBot: bot - y, edgeL, edgeR, u: (x - x0) / Math.max(1, x1 - x0) });
      if (c) p.set(x, y, c);
    }
  }
}

/** 四坡（庑殿）轮廓：下沿 yb 在 [x0,x1]，上沿 yt 在 [x0+inset, x1-inset]，两端斜坡；curve>1 为内凹曲线。 */
export function hipProfile(x0: number, x1: number, yt: number, yb: number, inset: number, curve = 1, minThick = 2): Profile {
  const h = yb - yt;
  return (x) => {
    if (x < x0 || x > x1) return null;
    const d = Math.min(x - x0, x1 - x);
    if (d >= inset) return [yt, yb];
    const t = inset <= 0 ? 1 : d / inset;
    const rise = minThick - 1 + Math.round((h - minThick + 1) * Math.pow(t, curve));
    return [yb - rise, yb];
  };
}

// ───────────────────────── 后期处理 ─────────────────────────

let outlineMap: Map<Rgba, Rgba> | null = null;

/** 颜色 → 描边色：取该材质色阶最暗一阶（太亮时改用 ink）。 */
function outlineOf(v: Rgba): Rgba {
  if (!outlineMap) {
    const m = new Map<Rgba, Rgba>();
    const reg = (ramp: Ramp, o: string) => ramp.forEach((c) => m.set(rgba(c), rgba(o)));
    reg(P.wood, P.wood[0]);
    reg(P.stone, P.stone[0]);
    reg(P.plaster, ink.brown);
    reg(P.sand, P.sand[0]);
    reg(P.brick, P.brick[0]);
    reg(P.jade, P.jade[0]);
    reg(P.slate, P.slate[0]);
    reg(P.gold, P.gold[0]);
    reg(P.red, P.red[0]);
    reg(P.teal, P.teal[0]);
    reg(P.straw, P.wood[0]);
    reg(P.leaf, P.leaf[0]);
    reg(P.autumn, P.autumn[0]);
    reg(P.blossom, P.red[0]);
    reg(P.snow, P.slate[1]);
    reg(P.iron, P.iron[0]);
    reg(P.lamp, P.wood[0]);
    reg([P.white, P.paper, P.parchment, P.parchmentDark, P.parchmentDeep], ink.brown);
    for (const r of Object.values(P.cloth)) reg(r, r[0]);
    outlineMap = m;
  }
  const hit = outlineMap.get(v);
  if (hit !== undefined) return hit;
  // 混出来的颜色（阴影、光晕）：找最接近的已登记颜色，沿用它的描边色
  let best = rgba(ink.deep);
  let bestD = Infinity;
  const r = (v >>> 24) & 0xff;
  const g = (v >>> 16) & 0xff;
  const b = (v >>> 8) & 0xff;
  for (const [k, o] of outlineMap) {
    const d = (((k >>> 24) & 0xff) - r) ** 2 + (((k >>> 16) & 0xff) - g) ** 2 + (((k >>> 8) & 0xff) - b) ** 2;
    if (d < bestD) {
      bestD = d;
      best = o;
    }
  }
  outlineMap.set(v, best);
  return best;
}

/** 外轮廓描边：透明像素若与不透明像素相邻，画上邻居材质的描边色（取最暗者）。wrapX 时左右边缘按取模相邻（无缝拼接的图用）。 */
export function outline(p: Px, wrapX = false): void {
  const src = p.clone();
  const W = p.w;
  for (let y = 0; y < p.h; y++) {
    for (let x = 0; x < p.w; x++) {
      if (src.isOpaque(x, y)) continue;
      let best = 0;
      let bestL = 999;
      for (const [dx, dy] of [
        [0, 1],
        [0, -1],
        [-1, 0],
        [1, 0],
      ] as const) {
        const v = src.get(wrapX ? (((x + dx) % W) + W) % W : x + dx, y + dy);
        if ((v & 0xff) !== 0xff) continue;
        const o = outlineOf(v);
        const l = luma(o);
        if (l < bestL) {
          bestL = l;
          best = o;
        }
      }
      if (best) p.put(x, y, best);
    }
  }
}

/** 积雪：屋顶区域换成雪色，暴露在上方的平面加雪帽，窗台积雪，檐下挂冰凌。 */
export function snowPass(c: Canvas, wrapX = false): void {
  const p = c.p;
  const S = P.snow;
  const W = p.w;
  const wx = (x: number) => (wrapX ? ((x % W) + W) % W : x);
  // 1. 屋顶区域换色
  for (const r of c.roofs) {
    const map = new Map<Rgba, string>();
    const n = r.ramp.length;
    r.ramp.forEach((col, i) => {
      // 最暗一阶保留为雪下的阴影线，其余按明度映射到雪色
      const k = n <= 1 ? 3 : Math.round((i / (n - 1)) * 3);
      map.set(rgba(col), k === 0 ? S[0] : S[k]);
    });
    for (let y = r.y; y < r.y + r.h - r.keep; y++) {
      for (let x = r.x; x < r.x + r.w; x++) {
        const hit = map.get(p.get(wx(x), y));
        if (hit) p.put(wx(x), y, hit);
      }
    }
  }
  // 2. 雪帽：不透明且上方透明、左右至少有一侧也是这样的像素（细杆与陡坡挂不住雪）
  const src = p.clone();
  for (let y = 1; y < p.h - 2; y++) {
    for (let x = 0; x < p.w; x++) {
      if (!src.isOpaque(x, y) || src.isOpaque(x, y - 1)) continue;
      const flatL = src.isOpaque(wx(x - 1), y) && !src.isOpaque(wx(x - 1), y - 1);
      const flatR = src.isOpaque(wx(x + 1), y) && !src.isOpaque(wx(x + 1), y - 1);
      if (!flatL && !flatR) continue;
      p.put(x, y, S[3]);
      if (flatL && flatR) {
        p.put(x, y - 1, S[3]);
        if (src.isOpaque(x, y + 1) && h01(x, y, 71) < 0.5) p.put(x, y + 1, S[2]);
      } else if (flatL || flatR) {
        if (src.isOpaque(x, y + 1)) p.put(x, y + 1, S[2]);
      }
    }
  }
  // 3. 窗台与招牌顶
  for (const [x0, x1, y] of c.ledges) {
    for (let x = x0; x <= x1; x++) {
      p.put(x, y, S[3]);
      if (x > x0 && x < x1) p.put(x, y - 1, S[3]);
    }
  }
  // 4. 冰凌
  for (const [x0, x1, y] of c.eaves) {
    for (let x = x0 + 1; x < x1; x++) {
      const r = h01(x, y, 83);
      if (r < 0.2) {
        p.put(x, y + 1, S[2]);
        p.put(x, y + 2, S[1]);
      } else if (r < 0.32) {
        p.put(x, y + 1, S[1]);
      }
    }
  }
}

/** 收尾：积雪 → 描边 → 裁掉透明边。 */
export function finish(c: Canvas): Px {
  if (c.o.snow) snowPass(c);
  outline(c.p);
  return c.p.trimmed();
}

// ───────────────────────── 季节装饰 ─────────────────────────

/** 窗下花箱：春开粉花、夏绿叶红花、秋结金果、冬只剩常青枝。宽 w，箱底在 y。 */
export function flowerBox(c: Canvas, x: number, y: number, w: number, box: Ramp = P.wood): void {
  const p = c.p;
  p.rect(x, y - 1, w, 2, box[2]);
  p.hline(x, x + w - 1, y - 1, box[3]);
  p.hline(x, x + w - 1, y, box[1]);
  const s = c.o.season;
  for (let i = 0; i < w; i++) {
    const r = h01(x + i, y, 91);
    if (s === 3) {
      if (r < 0.5) p.set(x + i, y - 2, P.leaf[1]);
      continue;
    }
    p.set(x + i, y - 2, r < 0.5 ? P.leaf[2] : P.leaf[1]);
    if (r < 0.55) p.set(x + i, y - 3, P.leaf[r < 0.3 ? 3 : 2]);
  }
  for (let i = 1; i < w - 1; i += 2) {
    const r = h01(x + i, y, 92);
    if (s === 3) {
      if (r < 0.3) p.set(x + i, y - 3, P.red[2]);
      continue;
    }
    const bloom = s === 0 ? (r < 0.5 ? P.blossom[2] : P.blossom[1]) : s === 1 ? (r < 0.5 ? P.red[3] : P.gold[3]) : r < 0.5 ? P.autumn[2] : P.gold[2];
    if (r < 0.75) p.set(x + i, y - 3 - (r < 0.3 ? 1 : 0), bloom);
  }
  c.ledge(x, x + w - 1, y - (s === 3 ? 2 : 3));
}

/** 秋季丰收挂饰（一束麦穗）或冬季常青花环、春季花串；夏季不画。中心 cx，顶端 y。 */
export function doorCharm(c: Canvas, cx: number, y: number): void {
  const p = c.p;
  const s = c.o.season;
  if (s === 2) {
    // 麦束：扎绳在中间，上散下拢
    p.set(cx - 1, y, P.gold[3]).set(cx + 1, y, P.gold[3]).set(cx, y, P.gold[2]);
    p.set(cx - 2, y + 1, P.gold[2]).set(cx, y + 1, P.gold[3]).set(cx + 2, y + 1, P.gold[1]);
    p.set(cx - 1, y + 1, P.gold[2]).set(cx + 1, y + 1, P.gold[2]);
    p.hline(cx - 1, cx + 1, y + 2, P.red[2]);
    p.vline(cx - 1, y + 3, y + 4, P.gold[2]).vline(cx, y + 3, y + 5, P.gold[1]).vline(cx + 1, y + 3, y + 4, P.gold[1]);
  } else if (s === 3) {
    p.ring(cx, y + 2, 2, 2, P.leaf[1]);
    p.set(cx - 1, y + 1, P.leaf[2]);
    p.set(cx, y + 4, P.red[2]).set(cx + 1, y + 4, P.red[3]);
  } else if (s === 0) {
    for (let i = -2; i <= 2; i++) {
      const yy = y + (Math.abs(i) === 2 ? 0 : 1);
      p.set(cx + i, yy, i % 2 ? P.blossom[1] : P.blossom[2]);
    }
    p.set(cx, y + 2, P.leaf[2]);
  }
}
