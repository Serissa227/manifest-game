// 图标工具：16×16 画布、字符网格、带明暗的基本形（球、叶、多边形）与统一的 1 像素描边。
// 统一风格：内容画在中间 14×14 内，最后由 outline() 在外围补一圈深色描边；光源在左上。
import { P, ink } from "../palette";
import { Px, rgba, type Pt } from "../px";

export type Ramp = readonly string[];

/** 常用色阶（由暗到亮）。 */
export const R = {
  gold: P.gold,
  wood: P.wood,
  stone: P.stone,
  iron: P.iron,
  red: P.red,
  teal: P.teal,
  leaf: P.leaf,
  sky: P.sky,
  sea: P.sea,
  snow: P.snow,
  sand: P.sand,
  brick: P.brick,
  straw: P.straw,
  blossom: P.blossom,
  autumn: P.autumn,
  skin: P.skin,
  lamp: P.lamp,
  jade: P.jade,
  slate: P.slate,
  plaster: P.plaster,
  parch: [P.parchmentDeep, P.parchmentDark, P.parchment, P.paper, P.white],
  navy: P.cloth.navy,
  blue: P.cloth.blue,
  purple: P.cloth.purple,
  crimson: P.cloth.crimson,
  green: P.cloth.green,
  ochre: P.cloth.ochre,
  cream: P.cloth.cream,
  brown: P.cloth.brown,
  hairBrown: P.hair.brown,
  hairDark: P.hair.dark,
} as const satisfies Record<string, Ramp>;

export interface Ramps {
  /** '1'–'5' */
  a?: Ramp;
  /** 'a'–'e' */
  b?: Ramp;
  /** 'p'–'t' */
  c?: Ramp;
  /** 'A'–'E' */
  d?: Ramp;
}

const SETS: readonly [keyof Ramps, string][] = [
  ["a", "12345"],
  ["b", "abcde"],
  ["c", "pqrst"],
  ["d", "ABCDE"],
];

/** 新建 16×16 透明画布。 */
export function canvas(): Px {
  return new Px(16, 16);
}

/**
 * 按字符网格画图：'1'–'5' / 'a'–'e' / 'p'–'t' / 'A'–'E' 分别取四条色阶由暗到亮的各阶
 * （色阶不足 5 阶时取最亮一阶），'w' 为白，'x' 为深色描边色，'.' 透明。
 * 不给 ox / oy 时在 16×16 中居中。各行长度必须一致。
 */
export function grid(p: Px, rows: readonly string[], r: Ramps, ox?: number, oy?: number): Px {
  const w = rows[0]?.length ?? 0;
  if (rows.some((row) => row.length !== w)) throw new Error(`图标网格各行长度不一致：${rows.join("|")}`);
  const key: Record<string, string> = { w: P.white, x: ink.deep, y: ink.brown, z: ink.blue };
  for (const [name, chars] of SETS) {
    const ramp = r[name];
    if (!ramp) continue;
    for (let i = 0; i < chars.length; i++) key[chars[i]] = ramp[Math.min(i, ramp.length - 1)];
  }
  for (const row of rows) for (const ch of row) if (ch !== "." && !(ch in key)) throw new Error(`图标网格中的字符 ${ch} 没有对应颜色`);
  const x0 = ox ?? Math.floor((16 - w) / 2);
  const y0 = oy ?? Math.floor((16 - rows.length) / 2);
  return p.stamp(rows, key, x0, y0);
}

/** 按色阶取第 i 阶（越界时取两端）。 */
export function tone(r: Ramp, i: number): string {
  return r[Math.max(0, Math.min(r.length - 1, i))];
}

/** 受光：像素相对中心的方向与左上光线的点积，返回 -1（背光）…1（受光）。 */
function lightAt(dx: number, dy: number, r: number): number {
  return -(dx * 0.62 + dy * 0.78) / Math.max(0.5, r);
}

/** 按受光值取色：最亮一阶留给高光，其余三阶依次向暗。 */
function shadeIdx(r: Ramp, l: number): string {
  const n = r.length;
  const top = n - 1;
  if (l > 0.55) return tone(r, top);
  if (l > 0.0) return tone(r, top - 1);
  if (l > -0.5) return tone(r, top - 2);
  return tone(r, top - 3);
}

/** 带体积的球 / 椭球：左上亮、右下暗，可选一点白色高光。 */
export function ball(p: Px, cx: number, cy: number, rx: number, ry: number, ramp: Ramp, spec = false): Px {
  for (let y = Math.floor(cy - ry); y <= cy + ry; y++) {
    for (let x = Math.floor(cx - rx); x <= cx + rx; x++) {
      const dx = (x + 0.5 - cx) / rx;
      const dy = (y + 0.5 - cy) / ry;
      if (dx * dx + dy * dy > 1.02) continue;
      p.put(x, y, shadeIdx(ramp, lightAt(dx, dy, 1) * 1.1));
    }
  }
  if (spec && rx >= 2) p.put(Math.floor(cx - rx * 0.45), Math.floor(cy - ry * 0.45), P.white);
  return p;
}

/**
 * 叶片（两端尖的梭形）：从 (x0,y0) 到 (x1,y1)，最宽处 w/2；中脉一侧亮一侧暗。
 * vein 为真时画出中脉。
 */
export function leaf(p: Px, x0: number, y0: number, x1: number, y1: number, w: number, ramp: Ramp, vein = true): Px {
  const len = Math.hypot(x1 - x0, y1 - y0);
  const ux = (x1 - x0) / len;
  const uy = (y1 - y0) / len;
  const minX = Math.floor(Math.min(x0, x1) - w);
  const maxX = Math.ceil(Math.max(x0, x1) + w);
  const minY = Math.floor(Math.min(y0, y1) - w);
  const maxY = Math.ceil(Math.max(y0, y1) + w);
  // 法线朝向左上的那一侧受光
  const nx = -uy;
  const ny = ux;
  const litSide = nx * -0.62 + ny * -0.78 > 0 ? 1 : -1;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const px = x + 0.5 - x0;
      const py = y + 0.5 - y0;
      const t = (px * ux + py * uy) / len;
      if (t < 0 || t > 1) continue;
      const d = px * nx + py * ny;
      const half = (w / 2) * Math.sin(Math.PI * t) ** 0.8;
      if (Math.abs(d) > half + 0.15) continue;
      const n = ramp.length;
      let c = Math.sign(d) === litSide ? tone(ramp, n - 2) : tone(ramp, n - 3);
      if (Math.abs(d) > half - 0.8 && Math.sign(d) !== litSide) c = tone(ramp, n - 4);
      if (vein && Math.abs(d) < 0.5 && t > 0.08 && t < 0.9) c = tone(ramp, n - 1);
      p.put(x, y, c);
    }
  }
  return p;
}

/** 实心多边形，按像素相对多边形中心的方位着色（左上亮）。 */
export function shape(p: Px, pts: readonly Pt[], ramp: Ramp): Px {
  const tmp = new Px(16, 16).poly(pts, "#ffffff");
  const xs = pts.map((q) => q[0]);
  const ys = pts.map((q) => q[1]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const r = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) / 2;
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      if (!tmp.isOpaque(x, y)) continue;
      p.put(x, y, shadeIdx(ramp, lightAt(x + 0.5 - cx, y + 0.5 - cy, r)));
    }
  }
  return p;
}

/** 粗线（逐点画方块），width 为 1 或 2。 */
export function stroke(p: Px, x0: number, y0: number, x1: number, y1: number, c: string, width = 1): Px {
  p.line(x0, y0, x1, y1, c);
  if (width >= 2) p.line(x0 + 1, y0, x1 + 1, y1, c);
  return p;
}

/** 在透明像素上补一圈描边（4 邻接），不改变画布尺寸。 */
export function outline(p: Px, c: string = ink.deep): Px {
  const src = p.data.slice();
  const col = rgba(c);
  const W = p.w;
  const H = p.h;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (src[y * W + x] & 0xff) continue;
      const hit =
        (x > 0 && src[y * W + x - 1] & 0xff) ||
        (x < W - 1 && src[y * W + x + 1] & 0xff) ||
        (y > 0 && src[(y - 1) * W + x] & 0xff) ||
        (y < H - 1 && src[(y + 1) * W + x] & 0xff);
      if (hit) p.data[y * W + x] = col;
    }
  }
  return p;
}

export { ink, P };
