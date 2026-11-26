// 像素缓冲：全部像素美术都画在这里。纯 TypeScript，不依赖 DOM，
// 既可在浏览器里贴到画布上，也可在 Node 中导出 PNG 预览（见 scripts/art-preview.ts）。
//
// 坐标以像素为单位，原点在左上角；所有绘制函数都会裁剪越界部分。
// 颜色写成 "#rgb" / "#rrggbb" / "#rrggbbaa"，null 表示透明。半透明颜色会与底色混合。

/** 打包的颜色：0xRRGGBBAA；0 表示完全透明。 */
export type Rgba = number;
export type Color = string | Rgba | null;

const parsed = new Map<string, Rgba>();

/** 把颜色字符串解析为 0xRRGGBBAA。 */
export function rgba(c: Color): Rgba {
  if (c === null) return 0;
  if (typeof c === "number") return c >>> 0;
  const hit = parsed.get(c);
  if (hit !== undefined) return hit;
  let hex = c.startsWith("#") ? c.slice(1) : c;
  if (hex.length === 3 || hex.length === 4) {
    hex = [...hex].map((ch) => ch + ch).join("");
  }
  if (hex.length === 6) hex += "ff";
  if (hex.length !== 8 || !/^[0-9a-fA-F]{8}$/.test(hex)) {
    throw new Error(`无效颜色：${c}`);
  }
  const v = Number.parseInt(hex, 16) >>> 0;
  parsed.set(c, v);
  return v;
}

/** 0xRRGGBBAA → "#rrggbbaa"。 */
export function hex(v: Rgba): string {
  return `#${(v >>> 0).toString(16).padStart(8, "0")}`;
}

/** 把 src 按其不透明度叠加到 dst 上。 */
function blend(dst: Rgba, src: Rgba): Rgba {
  const sa = src & 0xff;
  if (sa === 0xff) return src;
  if (sa === 0) return dst;
  const da = dst & 0xff;
  if (da === 0) return src;
  const a = sa / 255;
  const outA = sa + da * (1 - a);
  const ch = (shift: number) => {
    const s = (src >>> shift) & 0xff;
    const d = (dst >>> shift) & 0xff;
    return Math.round((s * sa + d * da * (1 - a)) / outA) & 0xff;
  };
  return ((ch(24) << 24) | (ch(16) << 16) | (ch(8) << 8) | Math.round(outA)) >>> 0;
}

/** 按颜色明度（0–255）排序时使用。 */
export function luma(v: Rgba): number {
  return 0.299 * ((v >>> 24) & 0xff) + 0.587 * ((v >>> 16) & 0xff) + 0.114 * ((v >>> 8) & 0xff);
}

export type Pt = readonly [number, number];

/** 抖动图案的密度：1 为 25%，2 为 50%（棋盘格），3 为 75%。 */
export type DitherLevel = 1 | 2 | 3;

function ditherHit(x: number, y: number, level: DitherLevel): boolean {
  switch (level) {
    case 1:
      return x % 2 === 0 && y % 2 === 0;
    case 2:
      return (x + y) % 2 === 0;
    case 3:
      return !(x % 2 === 1 && y % 2 === 1);
  }
}

export class Px {
  readonly data: Uint32Array;

  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    if (!Number.isInteger(w) || !Number.isInteger(h) || w <= 0 || h <= 0) {
      throw new Error(`无效尺寸：${w}×${h}`);
    }
    this.data = new Uint32Array(w * h);
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }

  get(x: number, y: number): Rgba {
    return this.inBounds(x, y) ? this.data[y * this.w + x] : 0;
  }

  isOpaque(x: number, y: number): boolean {
    return (this.get(x, y) & 0xff) !== 0;
  }

  /** 画一个像素；半透明颜色与底色混合，null 把像素擦成透明。 */
  set(x: number, y: number, c: Color): this {
    x = Math.floor(x);
    y = Math.floor(y);
    if (!this.inBounds(x, y)) return this;
    const i = y * this.w + x;
    if (c === null) {
      this.data[i] = 0;
      return this;
    }
    this.data[i] = blend(this.data[i], rgba(c));
    return this;
  }

  /** 直接覆盖（不混合）。 */
  put(x: number, y: number, c: Color): this {
    x = Math.floor(x);
    y = Math.floor(y);
    if (this.inBounds(x, y)) this.data[y * this.w + x] = rgba(c);
    return this;
  }

  fill(c: Color): this {
    return this.rect(0, 0, this.w, this.h, c);
  }

  clear(): this {
    this.data.fill(0);
    return this;
  }

  /** 实心矩形。 */
  rect(x: number, y: number, w: number, h: number, c: Color): this {
    const x0 = Math.max(0, Math.floor(x));
    const y0 = Math.max(0, Math.floor(y));
    const x1 = Math.min(this.w, Math.floor(x + w));
    const y1 = Math.min(this.h, Math.floor(y + h));
    for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) this.set(xx, yy, c);
    return this;
  }

  /** 空心矩形（1 像素边）。 */
  stroke(x: number, y: number, w: number, h: number, c: Color): this {
    this.hline(x, x + w - 1, y, c);
    this.hline(x, x + w - 1, y + h - 1, c);
    this.vline(x, y + 1, y + h - 2, c);
    this.vline(x + w - 1, y + 1, y + h - 2, c);
    return this;
  }

  hline(x0: number, x1: number, y: number, c: Color): this {
    const [a, b] = x0 <= x1 ? [x0, x1] : [x1, x0];
    for (let x = a; x <= b; x++) this.set(x, y, c);
    return this;
  }

  vline(x: number, y0: number, y1: number, c: Color): this {
    const [a, b] = y0 <= y1 ? [y0, y1] : [y1, y0];
    for (let y = a; y <= b; y++) this.set(x, y, c);
    return this;
  }

  /** Bresenham 直线（含两端）。 */
  line(x0: number, y0: number, x1: number, y1: number, c: Color): this {
    x0 = Math.round(x0);
    y0 = Math.round(y0);
    x1 = Math.round(x1);
    y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.set(x0, y0, c);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x0 += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y0 += sy;
      }
    }
    return this;
  }

  /** 实心椭圆（以像素中心判定）。 */
  ellipse(cx: number, cy: number, rx: number, ry: number, c: Color): this {
    if (rx <= 0 || ry <= 0) return this.set(cx, cy, c);
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const nx = (x - cx) / (rx + 0.5);
        const ny = (y - cy) / (ry + 0.5);
        if (nx * nx + ny * ny <= 1) this.set(x, y, c);
      }
    }
    return this;
  }

  /** 椭圆边框。 */
  ring(cx: number, cy: number, rx: number, ry: number, c: Color): this {
    const inside = (x: number, y: number) => {
      const nx = (x - cx) / (rx + 0.5);
      const ny = (y - cy) / (ry + 0.5);
      return nx * nx + ny * ny <= 1;
    };
    for (let y = Math.floor(cy - ry) - 1; y <= Math.ceil(cy + ry) + 1; y++) {
      for (let x = Math.floor(cx - rx) - 1; x <= Math.ceil(cx + rx) + 1; x++) {
        if (inside(x, y) && (!inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1))) {
          this.set(x, y, c);
        }
      }
    }
    return this;
  }

  circle(cx: number, cy: number, r: number, c: Color): this {
    return this.ellipse(cx, cy, r, r, c);
  }

  /** 实心多边形（扫描线，奇偶规则，以像素中心判定）。 */
  poly(pts: readonly Pt[], c: Color): this {
    if (pts.length < 3) return this;
    const ys = pts.map((p) => p[1]);
    const yMin = Math.max(0, Math.floor(Math.min(...ys)));
    const yMax = Math.min(this.h - 1, Math.ceil(Math.max(...ys)));
    for (let y = yMin; y <= yMax; y++) {
      const cy = y + 0.5;
      const xs: number[] = [];
      for (let i = 0; i < pts.length; i++) {
        const [ax, ay] = pts[i];
        const [bx, by] = pts[(i + 1) % pts.length];
        if ((ay <= cy && by > cy) || (by <= cy && ay > cy)) {
          xs.push(ax + ((cy - ay) / (by - ay)) * (bx - ax));
        }
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const xa = Math.ceil(xs[k] - 0.5);
        const xb = Math.floor(xs[k + 1] - 0.5);
        for (let x = xa; x <= xb; x++) this.set(x, y, c);
      }
    }
    return this;
  }

  /** 抖动填充：只在图案命中的像素上画（按绝对坐标对齐，拼接处不会错位）。 */
  dither(x: number, y: number, w: number, h: number, c: Color, level: DitherLevel = 2): this {
    for (let yy = Math.floor(y); yy < y + h; yy++) {
      for (let xx = Math.floor(x); xx < x + w; xx++) {
        if (ditherHit(xx, yy, level)) this.set(xx, yy, c);
      }
    }
    return this;
  }

  /**
   * 分段渐变：colors 按顺序平分区域，相邻两段交界处用 50% 抖动过渡。
   * dir 为 "v"（自上而下）或 "h"（自左而右）。
   */
  gradient(x: number, y: number, w: number, h: number, colors: readonly string[], dir: "v" | "h" = "v"): this {
    const n = colors.length;
    if (n === 0) return this;
    const len = dir === "v" ? h : w;
    const band = len / n;
    const blendRows = Math.max(1, Math.floor(band / 4));
    for (let i = 0; i < len; i++) {
      const k = Math.min(n - 1, Math.floor(i / band));
      const into = i - k * band;
      let c = colors[k];
      let next: string | null = null;
      if (k + 1 < n && band - into <= blendRows) next = colors[k + 1];
      for (let j = 0; j < (dir === "v" ? w : h); j++) {
        const px = dir === "v" ? x + j : x + i;
        const py = dir === "v" ? y + i : y + j;
        if (next && (px + py) % 2 === 0) c = next;
        else c = colors[k];
        this.set(px, py, c);
      }
    }
    return this;
  }

  /**
   * 按字符网格画图：rows 每行一个字符串，key 把字符映射为颜色；
   * 不在 key 中的字符（习惯用 "."）视为透明。
   */
  stamp(rows: readonly string[], key: Readonly<Record<string, Color>>, x = 0, y = 0, flipX = false): this {
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      for (let i = 0; i < row.length; i++) {
        const ch = row[i];
        if (!(ch in key)) continue;
        const col = key[ch];
        if (col === null) continue;
        const xx = flipX ? x + row.length - 1 - i : x + i;
        this.set(xx, y + r, col);
      }
    }
    return this;
  }

  /** 用字符网格平铺一块区域（图案按绝对坐标对齐）。 */
  pattern(x: number, y: number, w: number, h: number, rows: readonly string[], key: Readonly<Record<string, Color>>): this {
    const ph = rows.length;
    const pw = rows[0]?.length ?? 0;
    if (!ph || !pw) return this;
    for (let yy = Math.floor(y); yy < y + h; yy++) {
      for (let xx = Math.floor(x); xx < x + w; xx++) {
        const ch = rows[((yy % ph) + ph) % ph][((xx % pw) + pw) % pw];
        if (ch in key && key[ch] !== null) this.set(xx, yy, key[ch]);
      }
    }
    return this;
  }

  /**
   * 把另一张图贴到 (x, y)。透明像素不覆盖底图。
   * alpha（0–1）整体减淡；tint 把所有不透明像素换成同一种颜色（用于剪影、高亮、投影）。
   */
  blit(src: Px, x: number, y: number, opts: { flipX?: boolean; flipY?: boolean; alpha?: number; tint?: string } = {}): this {
    const { flipX = false, flipY = false, alpha = 1, tint } = opts;
    const tintV = tint ? rgba(tint) : 0;
    x = Math.round(x);
    y = Math.round(y);
    for (let sy = 0; sy < src.h; sy++) {
      const dy = y + (flipY ? src.h - 1 - sy : sy);
      if (dy < 0 || dy >= this.h) continue;
      for (let sx = 0; sx < src.w; sx++) {
        const dx = x + (flipX ? src.w - 1 - sx : sx);
        if (dx < 0 || dx >= this.w) continue;
        let v = src.data[sy * src.w + sx];
        const a = v & 0xff;
        if (a === 0) continue;
        if (tint) v = ((tintV & 0xffffff00) | Math.round(((tintV & 0xff) * a) / 255)) >>> 0;
        if (alpha < 1) v = ((v & 0xffffff00) | Math.round((v & 0xff) * alpha)) >>> 0;
        const i = dy * this.w + dx;
        this.data[i] = blend(this.data[i], v);
      }
    }
    return this;
  }

  clone(): Px {
    const p = new Px(this.w, this.h);
    p.data.set(this.data);
    return p;
  }

  flipX(): Px {
    return new Px(this.w, this.h).blit(this, 0, 0, { flipX: true });
  }

  crop(x: number, y: number, w: number, h: number): Px {
    const p = new Px(w, h);
    for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) p.data[yy * w + xx] = this.get(x + xx, y + yy);
    return p;
  }

  /** 最近邻整数放大。 */
  scaled(k: number): Px {
    k = Math.max(1, Math.floor(k));
    const p = new Px(this.w * k, this.h * k);
    for (let y = 0; y < p.h; y++) {
      for (let x = 0; x < p.w; x++) p.data[y * p.w + x] = this.data[Math.floor(y / k) * this.w + Math.floor(x / k)];
    }
    return p;
  }

  /** 加 1 像素描边：返回四周各扩 1 像素的新图。diagonal 为 true 时对角也描。 */
  outlined(c: Color, diagonal = false): Px {
    const p = new Px(this.w + 2, this.h + 2);
    const col = rgba(c);
    for (let y = -1; y <= this.h; y++) {
      for (let x = -1; x <= this.w; x++) {
        if (this.isOpaque(x, y)) continue;
        let near = this.isOpaque(x - 1, y) || this.isOpaque(x + 1, y) || this.isOpaque(x, y - 1) || this.isOpaque(x, y + 1);
        if (!near && diagonal) {
          near =
            this.isOpaque(x - 1, y - 1) || this.isOpaque(x + 1, y - 1) || this.isOpaque(x - 1, y + 1) || this.isOpaque(x + 1, y + 1);
        }
        if (near) p.data[(y + 1) * p.w + (x + 1)] = col;
      }
    }
    return p.blit(this, 1, 1);
  }

  /** 按颜色映射替换（换色：同一张图做出不同势力、季节的版本）。 */
  recolor(map: Readonly<Record<string, string | null>>): Px {
    const table = new Map<Rgba, Rgba>();
    for (const [from, to] of Object.entries(map)) table.set(rgba(from), rgba(to));
    const p = this.clone();
    for (let i = 0; i < p.data.length; i++) {
      const hit = table.get(p.data[i]);
      if (hit !== undefined) p.data[i] = hit;
    }
    return p;
  }

  /** 不透明像素的包围盒；全透明时返回 null。 */
  bounds(): { x: number; y: number; w: number; h: number } | null {
    let x0 = this.w;
    let y0 = this.h;
    let x1 = -1;
    let y1 = -1;
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (this.data[y * this.w + x] & 0xff) {
          if (x < x0) x0 = x;
          if (y < y0) y0 = y;
          if (x > x1) x1 = x;
          if (y > y1) y1 = y;
        }
      }
    }
    return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }

  /** 裁掉四周的透明边。 */
  trimmed(): Px {
    const b = this.bounds();
    return b ? this.crop(b.x, b.y, b.w, b.h) : new Px(1, 1);
  }

  /** 使用过的不同颜色数（检查调色是否克制）。 */
  colorCount(): number {
    const s = new Set<number>();
    for (const v of this.data) if (v & 0xff) s.add(v);
    return s.size;
  }

  /** 转成画布 ImageData 需要的 RGBA 字节。 */
  toRGBA(): Uint8ClampedArray {
    const out = new Uint8ClampedArray(this.w * this.h * 4);
    this.writeRGBA(out);
    return out;
  }

  /**
   * 把 RGBA 字节写进现成的缓冲（长度至少 w × h × 4；画布反复重画时用，不必每帧另分配一份，见 art/render.ts 的 paint）。
   * 缓冲按 4 字节对齐时一个像素写一次 32 位（小端机器上换一下字节序），否则逐字节写；结果与 toRGBA 完全相同。
   */
  writeRGBA(out: Uint8ClampedArray): void {
    const n = this.data.length;
    if (out.length < n * 4) throw new Error("RGBA 缓冲太小");
    if (out.byteOffset % 4 === 0) {
      const words = new Uint32Array(out.buffer, out.byteOffset, n);
      if (LITTLE_ENDIAN) {
        for (let i = 0; i < n; i++) {
          const v = this.data[i];
          words[i] = ((v & 0xff) << 24) | ((v & 0xff00) << 8) | ((v >>> 8) & 0xff00) | (v >>> 24);
        }
      } else {
        for (let i = 0; i < n; i++) words[i] = this.data[i];
      }
      return;
    }
    for (let i = 0; i < n; i++) {
      const v = this.data[i];
      out[i * 4] = (v >>> 24) & 0xff;
      out[i * 4 + 1] = (v >>> 16) & 0xff;
      out[i * 4 + 2] = (v >>> 8) & 0xff;
      out[i * 4 + 3] = v & 0xff;
    }
  }
}

/** 这台机器是不是小端（几乎都是）：决定 writeRGBA 按 32 位写时要不要换字节序。 */
const LITTLE_ENDIAN = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;

/** 由字符网格直接生成一张图。 */
export function fromRows(rows: readonly string[], key: Readonly<Record<string, Color>>): Px {
  const w = Math.max(1, ...rows.map((r) => r.length));
  return new Px(w, Math.max(1, rows.length)).stamp(rows, key);
}

/** 拼成一张总览图（预览与图集用）：按 cols 列排布，底部对齐。 */
export function sheet(items: readonly Px[], opts: { cols?: number; gap?: number; bg?: string | null; pad?: number } = {}): Px {
  const { cols = Math.max(1, Math.ceil(Math.sqrt(items.length))), gap = 4, bg = null, pad = 4 } = opts;
  if (items.length === 0) return new Px(1, 1);
  const rows = Math.ceil(items.length / cols);
  const colW = Array.from({ length: cols }, (_, c) => Math.max(1, ...items.filter((_, i) => i % cols === c).map((p) => p.w)));
  const rowH = Array.from({ length: rows }, (_, r) => Math.max(1, ...items.slice(r * cols, r * cols + cols).map((p) => p.h)));
  const w = pad * 2 + colW.reduce((a, b) => a + b, 0) + gap * (cols - 1);
  const h = pad * 2 + rowH.reduce((a, b) => a + b, 0) + gap * (rows - 1);
  const out = new Px(w, h);
  if (bg) out.fill(bg);
  let y = pad;
  for (let r = 0; r < rows; r++) {
    let x = pad;
    for (let c = 0; c < cols; c++) {
      const it = items[r * cols + c];
      if (it) out.blit(it, x + Math.floor((colW[c] - it.w) / 2), y + rowH[r] - it.h);
      x += colW[c] + gap;
    }
    y += rowH[r] + gap;
  }
  return out;
}

/** 预览条目：src 下的 *.preview.ts 默认导出 (ctx) => Preview[]，由 scripts/art-preview.ts 写成 PNG。 */
export interface Preview {
  /** 文件名（不含扩展名） */
  name: string;
  px: Px;
  /** 放大倍数，默认 3 */
  scale?: number;
  /** 背景色，默认中性灰棋盘格 */
  bg?: string;
}

/** 预览脚本提供给 *.preview.ts 的上下文（只在 Node 中存在）。 */
export interface PreviewContext {
  /** 读取仓库内的文本文件，路径相对仓库根目录，例如 "data/world/map.txt" */
  readText: (repoPath: string) => string;
}
