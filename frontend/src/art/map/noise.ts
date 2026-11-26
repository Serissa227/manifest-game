// 海图用的数值工具：整数哈希、值噪声、分形噪声（含预先算好格点的快速版本）、有序抖动、倒角距离场与双线性采样。
// 全部是确定性的纯函数：同样的输入永远得到同样的海图。

/** 整数哈希 → [0, 1)。 */
export function hash2(x: number, y: number, seed: number): number {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x2545f491);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** 平滑的值噪声 → [0, 1)。 */
export function vnoise(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash2(x0, y0, seed);
  const b = hash2(x0 + 1, y0, seed);
  const c = hash2(x0, y0 + 1, seed);
  const d = hash2(x0 + 1, y0 + 1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

/** 分形噪声（3 个八度）。 */
export function fbm(x: number, y: number, seed: number): number {
  return (vnoise(x, y, seed) * 4 + vnoise(x * 2.03, y * 2.03, seed + 17) * 2 + vnoise(x * 4.1, y * 4.1, seed + 43)) / 7;
}

/** 预先算好格点哈希的值噪声：结果与 vnoise 完全相同（坐标越出预算范围时回退到 vnoise）。 */
class Lattice {
  private readonly v: Float64Array;

  constructor(
    private readonly w: number,
    private readonly h: number,
    private readonly seed: number,
  ) {
    this.v = new Float64Array(w * h);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.v[j * w + i] = hash2(i, j, seed);
  }

  at(x: number, y: number): number {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    if (x0 < 0 || y0 < 0 || x0 + 1 >= this.w || y0 + 1 >= this.h) return vnoise(x, y, this.seed);
    const fx = x - x0;
    const fy = y - y0;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const i = y0 * this.w + x0;
    const a = this.v[i];
    const b = this.v[i + 1];
    const c = this.v[i + this.w];
    const d = this.v[i + this.w + 1];
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  }
}

/** 噪声场：像素坐标 → [0, 1)。 */
export type Field = (x: number, y: number) => number;

/**
 * 覆盖 pw×ph 像素范围的分形噪声，等于 fbm(x / scale, y / scale, seed)，但格点哈希预先算好，逐像素调用时快得多。
 * 适合整张图逐像素取值的噪声；只在少数点取值的噪声直接用 fbm。
 */
export function fbmField(pw: number, ph: number, scale: number, seed: number): Field {
  const make = (f: number, s: number) => new Lattice(Math.ceil((pw / scale) * f) + 3, Math.ceil((ph / scale) * f) + 3, s);
  const l1 = make(1, seed);
  const l2 = make(2.03, seed + 17);
  const l3 = make(4.1, seed + 43);
  return (x, y) => {
    const u = x / scale;
    const v = y / scale;
    return (l1.at(u, v) * 4 + l2.at(u * 2.03, v * 2.03) * 2 + l3.at(u * 4.1, v * 4.1)) / 7;
  };
}

/**
 * 只覆盖格点 [i0, i0 + w) × [j0, j0 + h) 的值噪声，格点的哈希用到时才算、算过就记下（0 表示还没算：哈希恰好为 0 时
 * 只是多算一次，值不变）。结果与 vnoise 完全相同（越出范围时回退到 vnoise）。
 */
class LazyLattice {
  constructor(
    private readonly w: number,
    private readonly h: number,
    private readonly seed: number,
    private readonly i0: number,
    private readonly j0: number,
    /** 格点的值（长 w·h、全为 0 的缓冲） */
    private readonly v: Float64Array,
  ) {}

  private get(i: number, lx: number, ly: number): number {
    const c = this.v[i];
    return c !== 0 ? c : (this.v[i] = hash2(this.i0 + lx, this.j0 + ly, this.seed));
  }

  at(x: number, y: number): number {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const lx = x0 - this.i0;
    const ly = y0 - this.j0;
    if (lx < 0 || ly < 0 || lx + 1 >= this.w || ly + 1 >= this.h) return vnoise(x, y, this.seed);
    const fx = x - x0;
    const fy = y - y0;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const i = ly * this.w + lx;
    const a = this.get(i, lx, ly);
    const b = this.get(i + 1, lx + 1, ly);
    const c = this.get(i + this.w, lx, ly + 1);
    const d = this.get(i + this.w + 1, lx + 1, ly + 1);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  }
}

/** fbmWindow 的格点缓冲：三个八度各一段，不够长时加长，每次取用时清零。重复使用，免得每次重画都分配。 */
export class FbmScratch {
  private bufs = [new Float64Array(0), new Float64Array(0), new Float64Array(0)];

  /** 第 k 个八度的一段长 n、全为 0 的缓冲（同一份缓冲上一次取出的随之作废）。 */
  take(k: number, n: number): Float64Array {
    if (this.bufs[k].length < n) this.bufs[k] = new Float64Array(Math.max(n, this.bufs[k].length * 2));
    const b = this.bufs[k].subarray(0, n);
    b.fill(0);
    return b;
  }
}

/**
 * fbmField 的局部版本：只覆盖像素窗口 [x0, x0 + w) × [y0, y0 + h) 的格点（三个八度，用到时才算），
 * 取值与 fbmField(…)(x, y)（也就是 fbm(x / scale, y / scale, seed)）逐位相同；窗口外的点回退到逐点计算，结果也相同。
 * 迷雾边缘的噪声按要重画的矩形现算（性能商议 2026-10-07 第 5 条的后续）：不再为整张大地图存一份约 23 MiB 的格点表；
 * 只有迷雾边缘的像素取噪声，窗口里其余的格点不算。给了 scratch 时格点放在它的缓冲里（下一次用同一份 scratch 时这个噪声场作废）。
 */
export function fbmWindow(x0: number, y0: number, w: number, h: number, scale: number, seed: number, scratch?: FbmScratch): Field {
  const make = (f: number, s: number, k: number) => {
    // 多留一格余量（浮点的乘法可能让边上的坐标差一点点）
    const i0 = Math.floor((x0 / scale) * f) - 1;
    const j0 = Math.floor((y0 / scale) * f) - 1;
    const lw = Math.max(1, Math.ceil(((x0 + w) / scale) * f) + 2 - i0);
    const lh = Math.max(1, Math.ceil(((y0 + h) / scale) * f) + 2 - j0);
    return new LazyLattice(lw, lh, s, i0, j0, scratch ? scratch.take(k, lw * lh) : new Float64Array(lw * lh));
  };
  const l1 = make(1, seed, 0);
  const l2 = make(2.03, seed + 17, 1);
  const l3 = make(4.1, seed + 43, 2);
  return (x, y) => {
    const u = x / scale;
    const v = y / scale;
    return (l1.at(u, v) * 4 + l2.at(u * 2.03, v * 2.03) * 2 + l3.at(u * 4.1, v * 4.1)) / 7;
  };
}

/** 周期为 L 个格点的值噪声（tile 为周期的像素数，坐标为像素）。 */
function periodicNoise(x: number, y: number, tile: number, L: number, seed: number): number {
  const u = (x / tile) * L;
  const v = (y / tile) * L;
  const x0 = Math.floor(u);
  const y0 = Math.floor(v);
  const fx = u - x0;
  const fy = v - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const xa = ((x0 % L) + L) % L;
  const ya = ((y0 % L) + L) % L;
  const xb = (xa + 1) % L;
  const yb = (ya + 1) % L;
  const a = hash2(xa, ya, seed);
  const b = hash2(xb, ya, seed);
  const c = hash2(xa, yb, seed);
  const d = hash2(xb, yb, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

const tiles = new Map<string, Float32Array>();

/**
 * 可平铺的分形噪声表（边长 size 像素，size 为 2 的幂）：与 fbm 同样的三个八度，但在 size 处首尾相接，
 * 预先算成一张表，逐像素取值只是一次查表。适合整张图逐像素的纹理噪声（每 size 像素重复一次，混在其他图层里看不出来）。
 * 同样的参数只算一次。坐标取整后按 size 取模。
 */
export function tileField(size: number, scale: number, seed: number): Field {
  const table = tileTable(size, scale, seed);
  const m = size - 1;
  return (x, y) => table[((y | 0) & m) * size + ((x | 0) & m)];
}

/**
 * tileField 背后的那张表本身（行优先，边长 size）：逐像素的热循环里直接按 `table[((y & (size − 1)) * size) + (x & (size − 1))]`
 * 取值，省掉一次函数调用（细节瓦片每块六十万像素、每像素取七八种噪声）。同样的参数与 tileField 共用一张表。
 */
export function tileTable(size: number, scale: number, seed: number): Float32Array {
  const key = `${size}:${scale}:${seed}`;
  let t = tiles.get(key);
  if (!t) {
    t = new Float32Array(size * size);
    const L = Math.max(1, Math.round(size / scale));
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++)
        t[y * size + x] = (periodicNoise(x, y, size, L, seed) * 4 + periodicNoise(x, y, size, L * 2, seed + 17) * 2 + periodicNoise(x, y, size, L * 4, seed + 43)) / 7;
    tiles.set(key, t);
  }
  return t;
}

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/** 4×4 有序抖动阈值 → (0, 1)。 */
export function bayer(x: number, y: number): number {
  return (BAYER4[(y & 3) * 4 + (x & 3)] + 0.5) / 16;
}

/**
 * 按有序抖动取的像素偏移表（−r..r），下标为 (y & 3) * 4 + (x & 3)。
 * x、y 两个方向用互为转置（再错开两行）的抖动矩阵，彼此不相关。
 */
export function jitterTable(r: number): { x: Int8Array; y: Int8Array } {
  const jx = new Int8Array(16);
  const jy = new Int8Array(16);
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      const a = (BAYER4[y * 4 + x] + 0.5) / 16;
      const b = (BAYER4[x * 4 + ((y + 2) & 3)] + 0.5) / 16;
      jx[y * 4 + x] = Math.round((a - 0.5) * 2 * r);
      jy[y * 4 + x] = Math.round((b - 0.5) * 2 * r);
    }
  }
  return { x: jx, y: jy };
}

export const INF = 1e6;

/** 8 邻域倒角距离场（单位：格）。 */
export function chamfer(w: number, h: number, isSource: (i: number) => boolean): Float32Array {
  const d = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) d[i] = isSource(i) ? 0 : INF;
  const E = Math.SQRT2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let v = d[i];
      if (x > 0) v = Math.min(v, d[i - 1] + 1);
      if (y > 0) {
        v = Math.min(v, d[i - w] + 1);
        if (x > 0) v = Math.min(v, d[i - w - 1] + E);
        if (x < w - 1) v = Math.min(v, d[i - w + 1] + E);
      }
      d[i] = v;
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      let v = d[i];
      if (x < w - 1) v = Math.min(v, d[i + 1] + 1);
      if (y < h - 1) {
        v = Math.min(v, d[i + w] + 1);
        if (x < w - 1) v = Math.min(v, d[i + w + 1] + E);
        if (x > 0) v = Math.min(v, d[i + w - 1] + E);
      }
      d[i] = v;
    }
  }
  return d;
}

/** 以格中心为采样点，对格字段做双线性插值（参数为像素坐标，cell 为每格像素数）。 */
export function sampler(field: ArrayLike<number>, w: number, h: number, cell: number): Field {
  return (px, py) => {
    const u = (px + 0.5) / cell - 0.5;
    const v = (py + 0.5) / cell - 0.5;
    const x0 = Math.floor(u);
    const y0 = Math.floor(v);
    const fx = u - x0;
    const fy = v - y0;
    const xa = x0 < 0 ? 0 : x0 >= w ? w - 1 : x0;
    const xb = x0 + 1 < 0 ? 0 : x0 + 1 >= w ? w - 1 : x0 + 1;
    const ya = y0 < 0 ? 0 : y0 >= h ? h - 1 : y0;
    const yb = y0 + 1 < 0 ? 0 : y0 + 1 >= h ? h - 1 : y0 + 1;
    const top = field[ya * w + xa] + (field[ya * w + xb] - field[ya * w + xa]) * fx;
    const bot = field[yb * w + xa] + (field[yb * w + xb] - field[yb * w + xa]) * fx;
    return top + (bot - top) * fy;
  };
}

/**
 * 按行的双线性采样：每列的两个格下标与权重预先算好，row 一次填满一整行像素的值（与 sampler 结果相同）。
 * 整张图逐像素采样时比 sampler 快得多。
 */
export class RowSampler {
  private readonly xa: Int32Array;
  private readonly xb: Int32Array;
  private readonly fx: Float64Array;

  constructor(
    private readonly w: number,
    private readonly h: number,
    private readonly cell: number,
  ) {
    const pw = w * cell;
    this.xa = new Int32Array(pw);
    this.xb = new Int32Array(pw);
    this.fx = new Float64Array(pw);
    for (let px = 0; px < pw; px++) {
      const u = (px + 0.5) / cell - 0.5;
      const x0 = Math.floor(u);
      this.fx[px] = u - x0;
      this.xa[px] = x0 < 0 ? 0 : x0 >= w ? w - 1 : x0;
      this.xb[px] = x0 + 1 < 0 ? 0 : x0 + 1 >= w ? w - 1 : x0 + 1;
    }
  }

  /** 把字段在第 py 行像素上的插值写进 out（长度至少为 w·cell）。 */
  row(field: ArrayLike<number>, py: number, out: Float64Array): void {
    const { w, h, xa, xb, fx } = this;
    const v = (py + 0.5) / this.cell - 0.5;
    const y0 = Math.floor(v);
    const fy = v - y0;
    const ya = (y0 < 0 ? 0 : y0 >= h ? h - 1 : y0) * w;
    const yb = (y0 + 1 < 0 ? 0 : y0 + 1 >= h ? h - 1 : y0 + 1) * w;
    const n = xa.length;
    for (let px = 0; px < n; px++) {
      const a = field[ya + xa[px]];
      const c = field[yb + xa[px]];
      const top = a + (field[ya + xb[px]] - a) * fx[px];
      const bot = c + (field[yb + xb[px]] - c) * fx[px];
      out[px] = top + (bot - top) * fy;
    }
  }
}

/** 两种颜色按比例 t（0 = a，1 = b）混合，返回 "#rrggbb"。用于由调色板派生少量过渡色。 */
export function mix(a: string, b: string, t: number): string {
  const pa = parseHex(a);
  const pb = parseHex(b);
  const ch = (k: number) =>
    Math.max(0, Math.min(255, Math.round(pa[k] + (pb[k] - pa[k]) * t)))
      .toString(16)
      .padStart(2, "0");
  return `#${ch(0)}${ch(1)}${ch(2)}`;
}

function parseHex(c: string): [number, number, number] {
  let h = c.startsWith("#") ? c.slice(1) : c;
  if (h.length === 3 || h.length === 4) h = [...h].map((x) => x + x).join("");
  return [Number.parseInt(h.slice(0, 2), 16), Number.parseInt(h.slice(2, 4), 16), Number.parseInt(h.slice(4, 6), 16)];
}
