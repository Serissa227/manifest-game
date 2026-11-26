// 第九批“寰宇·十六世纪”的六种文化城镇风格（日本、明、奥斯曼、斯瓦希里、马来、玛雅）共用的接口与工具
// （FRAMEWORK §15.1 / 第九批 F12）。
// 每种文化一个文件（japanese.ts、ming.ts……），把构件套件、地标、城门、城墙、远景与街道小物件放在一起，
// 由 cultures.ts 汇总；landmarks / town / skyline / props 遇到这六种风格时转交给这里登记的画法。
// 七种经典风格的画法不经过这里，画面逐像素不变。
import type { Px } from "../px";
import { type Canvas, type DrawOpts, type Ramp, h01 } from "./kit";
import type { Kit } from "./style";

/** 远景配色：屋顶、墙、点缀的三阶色（暗、中、亮）。 */
export interface Far {
  roof: Ramp;
  wall: Ramp;
  accent: Ramp;
}

/** 远景一排的绘制上下文（skyline.ts 与各文化共用）。 */
export interface FarCtx {
  p: Px;
  /** 远景宽度（元素按它取模绘制） */
  W: number;
  /** 这一排的地面线 */
  base: number;
  f: Far;
  o: DrawOpts;
  /** 灯光位置（雾罩之后再点亮） */
  lights: [number, number][];
  /** 屋顶像素区域（积雪） */
  roofs: [number, number, number, number][];
}

/** 街道小物件里随文化变化的部分。 */
export interface CultureProps {
  /** 默认旗色（暗、中、亮） */
  flag: Ramp;
  /** 货摊的两种布色 */
  stall: readonly [Ramp, Ramp];
  /** 街灯：画在 32×44 的画布上，底边是地面线 */
  lamp(c: Canvas): void;
  /** 水井（或这个文化的取水处） */
  well(c: Canvas): void;
  /** 长凳 */
  bench(p: Px): void;
  /** 手推车（或这个文化的搬运工具），variant 改变装的货 */
  cart(p: Px, v: number): void;
}

/** 一种文化城镇风格的全部画法。 */
export interface CultureArt {
  /** 设施与民居用的构件套件 */
  kit: Kit;
  /** 地标（画布 96×150，底边是地面线） */
  landmark(c: Canvas): void;
  /** 城门（画布 112×100，底边是地面线，门洞在底边正中） */
  gate(c: Canvas): void;
  /** 城墙墙体：宽 W、墙顶 top，必须按 W 取模绘制（首尾相接） */
  wallBody(c: Canvas, W: number, top: number): void;
  /** 墙台：左边 x、墙顶 top（调用方负责取模） */
  wallTower(c: Canvas, x: number, top: number): void;
  /** 远景配色 */
  far: Far;
  /** 远景里的一栋房子：左边 x、墙宽 w、墙高 h */
  farHouse(k: FarCtx, x: number, w: number, h: number, seed: number): void;
  /** 远景里的塔或大建筑：左边 x；返回占用的宽度 */
  farTower(k: FarCtx, x: number, seed: number): number;
  /** 远景最前面的一道墙（顶在 top、高 8，宽 k.W，按宽度取模绘制） */
  farWall(k: FarCtx, top: number): void;
  props: CultureProps;
}

// ───────────────────────── 取模绘制的工具（城墙与远景共用） ─────────────────────────

/** 取模绘制：把 fn 在 dx = 0、-W、+W 三处各画一遍（Px 会裁掉越界部分）。 */
export function wrap(W: number, fn: (dx: number) => void): void {
  fn(0);
  fn(-W);
  fn(W);
}

/** 均匀分布的 n 个位置（i*W/n 取整），用于垛口、墙台。 */
export function spots(W: number, period: number): number[] {
  const n = Math.max(1, Math.round(W / period));
  return Array.from({ length: n }, (_, i) => Math.round((i * W) / n));
}

/** 墙体材质（石、砖、土坯、珊瑚石……），每一行石块的长度都凑齐到 W，保证首尾相接。 */
export function wrapCourses(p: Px, W: number, y: number, h: number, ramp: Ramp, course: number, min: number, max: number, seed: number, light = 2): void {
  let row = 0;
  for (let cy = y; cy < y + h; cy += course, row++) {
    const ch = Math.min(course, y + h - cy);
    // 本行的石块长度：累加到 W，最后一块补齐
    const lens: number[] = [];
    let sum = 0;
    let k = 0;
    while (sum < W) {
      let len = min + Math.floor(h01(k, row, seed) * (max - min + 1));
      if (W - sum - len < min && W - sum - len !== 0) len = W - sum;
      lens.push(len);
      sum += len;
      k++;
    }
    const off = Math.floor(h01(row, 7, seed) * min);
    let x = off;
    lens.forEach((len, i) => {
      const r = h01(i, row, seed + 1);
      const face = r < 0.22 ? ramp[light + 1] : r > 0.86 ? ramp[light - 1] : ramp[light];
      const hi = r < 0.22 ? ramp[Math.min(ramp.length - 1, light + 2)] : ramp[light + 1];
      for (let j = 0; j < len; j++) {
        const xx = (x + j) % W;
        for (let yy = cy; yy < cy + ch; yy++) {
          let col = face;
          if (yy === cy && ch > 2) col = hi;
          if (j === 0 && ch > 2 && yy < cy + ch - 1) col = hi;
          if (yy === cy + ch - 1 || j === len - 1) col = ramp[light - 1];
          p.put(xx, yy, col);
        }
      }
      x += len;
    });
  }
}

/** 远景墙面上的一格格小窗（夜里点亮其中一部分）。 */
export function farWindows(k: FarCtx, x: number, y: number, w: number, h: number, seed: number): void {
  for (let yy = y + 2; yy < y + h - 2; yy += 5) {
    for (let xx = x + 2; xx < x + w - 2; xx += 4) {
      if (h01(xx, yy, seed) < 0.55) {
        k.p.set(xx, yy, k.f.wall[0]);
        k.lights.push([xx, yy]);
      }
    }
  }
}

/** 按宽度取模画一条水平线（远景的墙顶、屋脊线）。 */
export function wrapHline(p: Px, W: number, y: number, col: string): void {
  for (let x = 0; x < W; x++) p.put(x, y, col);
}
