// 沙漠风格（desert）：土坯与砂岩、平顶女儿墙（阶梯垛口、外露梁头、彩瓷腰带）、青绿琉璃圆顶、尖拱门窗、彩色遮阳棚。
import type { Facility } from "../../store/game";
import { P } from "../palette";
import { drawEmblem } from "./emblems";
import { type Canvas, adobe, ashlar, h01, planks } from "./kit";
import { wallLamp } from "./parts";
import { type DoorKind, type Kit, type RoofKind, type WallKind, type WinKind, eaveShadow, pickTone } from "./style";

const SA = P.sand;
const TE = P.teal;
const R = P.red;
const W = P.wood;

/** 阶梯垛口：底在 y，中心 cx，三级。 */
export function merlon(c: Canvas, cx: number, y: number, big = false): number {
  const p = c.p;
  const n = big ? 3 : 2;
  for (let i = 0; i < n; i++) {
    const hw = n - i + (big ? 1 : 0);
    p.hline(cx - hw, cx + hw, y - 1 - i * 2, SA[3]);
    p.hline(cx - hw, cx + hw, y - 2 - i * 2, SA[4]);
    p.set(cx + hw, y - 1 - i * 2, SA[2]);
  }
  return y - n * 2;
}

/** 青绿琉璃圆顶：中心 cx，鼓座底在 y，半径 r；返回最高点。 */
export function dome(c: Canvas, cx: number, y: number, r: number, ramp = TE): number {
  const p = c.p;
  // 鼓座：一圈小拱窗
  const dy = y - 4;
  p.rect(cx - r, dy, r * 2 + 1, 4, SA[3]);
  p.hline(cx - r, cx + r, dy, SA[4]);
  p.hline(cx - r, cx + r, y - 1, SA[1]);
  for (let xx = cx - r + 2; xx <= cx + r - 2; xx += 3) p.vline(xx, dy + 1, dy + 2, SA[1]);
  // 穹顶：略尖的半球，左上高光、右侧暗
  const hgt = r + 2;
  for (let yy = 0; yy <= hgt; yy++) {
    const t = yy / hgt;
    const half = Math.round(r * Math.sqrt(Math.max(0, 1 - t * t)) * (1 - t * 0.15));
    const row = dy - 1 - yy;
    for (let xx = cx - half; xx <= cx + half; xx++) {
      const u = (xx - cx) / Math.max(1, r);
      let col: string = ramp[2];
      if (u < -0.35 && t < 0.75) col = ramp[3];
      if (u < -0.1 && u > -0.55 && t > 0.3 && t < 0.7) col = ramp[4];
      if (u > 0.45) col = ramp[1];
      if (xx === cx + half) col = ramp[0];
      p.set(xx, row, col);
    }
  }
  // 竖向瓦棱
  for (const k of [-0.5, 0, 0.5]) {
    const xx = cx + Math.round(k * r);
    for (let yy = dy - 2; yy > dy - 1 - Math.round(hgt * 0.8); yy--) if (p.get(xx, yy)) p.set(xx, yy, ramp[1]);
  }
  const top = dy - 1 - hgt;
  // 金顶饰
  p.vline(cx, top - 4, top, P.gold[2]);
  p.set(cx, top - 2, P.gold[3]).set(cx - 1, top - 2, P.gold[2]).set(cx + 1, top - 2, P.gold[1]);
  p.set(cx, top - 5, P.gold[4]);
  c.markRoof(cx - r, top, r * 2 + 1, hgt + 1, ramp, 0);
  return top - 5;
}

/** 平顶女儿墙。y 为墙顶；返回最高点。 */
function roof(c: Canvas, x: number, w: number, y: number, kind: RoofKind = "main"): number {
  const p = c.p;
  if (kind === "gable") {
    // 屋顶上退进一间小屋，另一侧搭着木凉棚
    const rw = Math.max(12, Math.round(w * 0.42));
    const rx = x + 3;
    const ry = y - 14;
    adobe(p, rx, ry, rw, 12, SA, c.seed + 31);
    p.vline(rx, ry, ry + 11, SA[4]);
    p.vline(rx + rw - 1, ry, ry + 11, SA[2]);
    const wx = rx + Math.floor(rw / 2) - 2;
    window(c, wx, ry + 2, "small");
    const top = roof(c, rx, rw, ry, "porch");
    // 凉棚：两根细柱、一排横木、搭一块条纹布
    const px0 = rx + rw + 3;
    const px1 = x + w - 4;
    if (px1 - px0 >= 6) {
      p.vline(px0, y - 10, y - 3, W[1]);
      p.vline(px1, y - 10, y - 3, W[1]);
      p.hline(px0 - 1, px1 + 1, y - 10, W[2]);
      const acc = pickTone(c, [TE, R, P.cloth.blue]);
      for (let i = px0; i <= px1; i++) p.set(i, y - 9, (i - px0) % 4 < 2 ? acc[2] : SA[4]);
    }
    return Math.min(top, roof(c, x, w, y, "main"));
  }
  if (kind === "porch") {
    // 门廊：一块出挑的平顶檐板（亮沙压顶、青绿与朱红的瓷砖带、下沿阴影），两端小垛口
    const x0 = x - 2;
    const x1 = x + w + 1;
    p.hline(x0, x1, y - 2, SA[4]);
    p.rect(x0, y - 1, x1 - x0 + 1, 3, SA[3]);
    for (let xx = x0 + 1; xx < x1; xx++) p.set(xx, y, (xx - x0) % 4 < 2 ? TE[2] : R[2]);
    p.hline(x0, x1, y + 2, SA[1]);
    p.vline(x1, y - 1, y + 1, SA[2]);
    merlon(c, x0 + 1, y - 2);
    merlon(c, x1 - 1, y - 2);
    c.markRoof(x0, y - 6, x1 - x0 + 1, 5, SA.slice(3), 0);
    eaveShadow(c, x, w, y + 3, 1);
    return y - 6;
  }
  const ph = 4;
  const top = y - ph;
  // 女儿墙墙体（墙体向上延伸）
  adobe(p, x, top, w, ph + 2, SA, c.seed + 91);
  // 压顶：一行亮沙 + 一行阴影
  p.hline(x - 1, x + w, top, SA[4]);
  p.hline(x - 1, x + w, top + 1, SA[2]);
  let peak = top;
  {
    // 彩瓷腰带：青绿与朱红的菱形
    for (let i = 0; i < w; i++) {
      const ph2 = i % 6;
      p.set(x + i, y, ph2 === 0 || ph2 === 3 ? SA[4] : ph2 < 3 ? TE[2] : R[2]);
      p.set(x + i, y + 1, ph2 === 1 ? TE[3] : ph2 === 4 ? R[3] : SA[1]);
    }
    // 外露梁头
    for (let i = x + 3; i < x + w - 2; i += 6) {
      p.rect(i, y + 3, 2, 2, W[2]);
      p.set(i, y + 3, W[3]);
      p.set(i + 1, y + 5, SA[2]);
    }
    // 垛口：两角与正中
    peak = Math.min(merlon(c, x + 2, top), merlon(c, x + w - 3, top));
    if (w >= 40) peak = Math.min(peak, merlon(c, x + Math.floor(w / 2), top, true));
  }
  c.markRoof(x - 1, peak, w + 2, top - peak + 1, SA.slice(3), 0);
  eaveShadow(c, x, w, y + 2, 0);
  if (kind === "grand" || kind === "tower") {
    const r = kind === "tower" ? Math.max(4, Math.floor(w / 2) - 1) : Math.min(11, Math.max(6, Math.round(w * 0.14)));
    peak = Math.min(peak, dome(c, x + Math.floor(w / 2), top, r));
  }
  return peak;
}

const winSizes: Record<WinKind, readonly [number, number]> = {
  std: [5, 9],
  tall: [5, 12],
  small: [3, 5],
  round: [7, 7],
  wide: [11, 9],
};

const doorSizes: Record<DoorKind, readonly [number, number]> = {
  std: [8, 13],
  double: [12, 14],
  grand: [14, 16],
  open: [16, 13],
  iron: [12, 14],
  barn: [18, 17],
};

/** 尖拱：宽 w 高 h 的区域里，顶部 k 行逐渐收窄。返回每行的左右缩进。 */
export function archInset(w: number, row: number): number {
  const k = Math.ceil(w / 2);
  if (row >= k) return 0;
  return Math.max(0, Math.round((k - row) * 0.9) - 1);
}

/** 尖拱窗：深色窗洞，木格屏；std 窗上加一块小遮阳棚。 */
function window(c: Canvas, x: number, y: number, kind: WinKind = "std"): void {
  const p = c.p;
  const [w, h] = winSizes[kind];
  const lit = c.o.lit;
  if (kind === "round") {
    // 星形玫瑰窗
    p.circle(x + 3, y + 3, 3, SA[1]);
    p.circle(x + 3, y + 3, 2, lit ? P.lamp[1] : W[0]);
    p.set(x + 3, y + 3, TE[3]);
    for (const [dx, dy] of [
      [0, -2],
      [0, 2],
      [-2, 0],
      [2, 0],
    ] as const) p.set(x + 3 + dx, y + 3 + dy, TE[2]);
    return;
  }
  const lanes = kind === "wide" ? 2 : 1;
  const lw = kind === "wide" ? 5 : w;
  for (let l = 0; l < lanes; l++) {
    const lx = x + l * (lw + 1);
    for (let row = -1; row <= h; row++) {
      const k = archInset(lw + 2, row + 1);
      p.hline(lx - 1 + k, lx + lw - k, y + row, SA[1]);
    }
    for (let row = 0; row < h; row++) {
      const k = archInset(lw, row);
      for (let xx = lx + k; xx < lx + lw - k; xx++) {
        const lattice = (xx + y + row) % 2 === 0 && row > 1;
        const base = lit ? (row > h / 2 ? P.lamp[2] : P.lamp[1]) : W[0];
        p.set(xx, y + row, lattice ? (lit ? W[1] : W[2]) : base);
      }
    }
    p.hline(lx - 1, lx + lw, y + h, SA[4]);
  }
  c.ledge(x - 1, x + w, y + h);
  if (kind === "std" && h01(x, y, c.seed + 7) < 0.6) {
    // 小遮阳棚：朱红或青绿
    const ramp = h01(x, y, 3) < 0.5 ? R : TE;
    for (let i = -1; i <= w; i++) {
      p.set(x + i, y - 3, ramp[1]);
      p.set(x + i, y - 2, (i + 1) % 2 ? ramp[3] : SA[4]);
    }
    p.set(x - 1, y - 1, ramp[1]).set(x + w, y - 1, ramp[1]);
  }
}

/** 尖拱门：青绿瓷砖门框，木门镶铜钉；open 为挂着朱红门帘的门洞。 */
function door(c: Canvas, cx: number, bottom: number, kind: DoorKind = "std"): void {
  const p = c.p;
  const [w, h] = doorSizes[kind];
  const x = cx - Math.floor(w / 2);
  const y = bottom - h;
  // 门框：外圈亮沙、内圈青绿
  for (let row = -3; row < h; row++) {
    const ko = archInset(w + 6, row + 3);
    p.hline(x - 3 + ko, x + w + 2 - ko, y + row, SA[4]);
  }
  const acc = pickTone(c, [TE, P.cloth.blue, R]);
  for (let row = -2; row < h; row++) {
    const ki = archInset(w + 4, row + 2);
    p.hline(x - 2 + ki, x + w + 1 - ki, y + row, acc[2]);
    p.set(x - 2 + ki, y + row, acc[3] ?? acc[2]);
  }
  for (let row = -1; row < h; row++) {
    const k = archInset(w + 2, row + 1);
    p.hline(x - 1 + k, x + w - k, y + row, W[0]);
  }
  if (kind === "open") {
    for (let row = 0; row < h; row++) {
      const k = archInset(w, row);
      for (let xx = x + k; xx < x + w - k; xx++) p.set(xx, y + row, c.o.lit ? P.lamp[1] : W[0]);
    }
    // 门帘挽在两边
    for (let row = 1; row < h - 3; row++) {
      const k = archInset(w, row);
      const drape = Math.max(1, 4 - Math.floor(row / 3));
      p.hline(x + k, x + k + drape, y + row, R[2]);
      p.hline(x + w - 1 - k - drape, x + w - 1 - k, y + row, R[1]);
    }
    return;
  }
  const leaf = kind === "iron" ? P.iron : W;
  for (let row = 0; row < h; row++) {
    const k = archInset(w, row);
    for (let xx = x + k; xx < x + w - k; xx++) {
      const ph = (xx - x) % 3;
      p.set(xx, y + row, ph === 0 ? leaf[1] : ph === 1 ? leaf[3] : leaf[2]);
    }
  }
  if (w >= 12) p.vline(cx, y + 1, bottom - 1, leaf[0]);
  for (let yy = y + 4; yy < bottom - 1; yy += 3) {
    for (let xx = x + 1; xx < x + w - 1; xx += 3) p.set(xx, yy, P.gold[3]);
  }
  if (kind === "barn") planks(p, x, y + Math.ceil(w / 2), w, h - Math.ceil(w / 2), W, 1, 3);
}

/** 圆形瓷砖招牌：青绿底、沙色外圈、金色内圈。 */
function sign(c: Canvas, cx: number, y: number, fac: Facility): number {
  const p = c.p;
  const cy = y + 7;
  p.circle(cx, cy, 7, SA[4]);
  p.circle(cx, cy, 6, P.gold[2]);
  p.circle(cx, cy, 5, TE[0]);
  p.set(cx - 5, cy - 3, P.gold[3]).set(cx - 4, cy - 4, P.gold[3]).set(cx - 3, cy - 5, P.gold[3]);
  drawEmblem(p, fac, cx - 4, cy - 4, TE.slice(1));
  return 15;
}

export const desert: Kit = {
  style: "desert",
  flag: [R[1], R[2], R[3]],
  trim: W,
  plinthH: 2,
  awning: [R, [SA[2], SA[3], SA[4]]],
  wall(c, x, y, w, h, kind: WallKind = "main") {
    const p = c.p;
    if (kind === "stone") {
      ashlar(p, x, y, w, h, SA, { course: 4, min: 7, max: 12, seed: c.seed + y, light: 3 });
    } else if (kind === "plain") {
      // 刷白的土坯墙
      adobe(p, x, y, w, h, [P.plaster[0], P.plaster[1], P.plaster[2], P.plaster[3], P.white], c.seed + x + y);
      p.hline(x, x + w - 1, y + h - 1, SA[2]);
      p.dither(x, y + h - 2, w, 1, SA[2], 2);
      p.vline(x, y, y + h - 1, P.white);
      p.vline(x + w - 1, y, y + h - 1, P.plaster[1]);
      return;
    } else {
      adobe(p, x, y, w, h, SA, c.seed + x + y);
    }
    // 墙角圆润：左缘受光、右缘背光
    p.vline(x, y, y + h - 1, SA[4]);
    p.vline(x + w - 1, y, y + h - 1, SA[2]);
    p.vline(x + w - 2, y, y + h - 1, kind === "stone" ? SA[2] : SA[3]);
  },
  plinth(c, x, w, h) {
    const p = c.p;
    const g = c.gy;
    ashlar(p, x, g - h, w, h, SA, { course: Math.max(2, h), min: 8, max: 14, seed: c.seed + 13, light: 2 });
    p.hline(x, x + w - 1, g - h, SA[4]);
  },
  roof,
  band(c, x, w, y) {
    const p = c.p;
    p.hline(x, x + w - 1, y, SA[4]);
    p.hline(x, x + w - 1, y + 1, SA[1]);
  },
  post(c, x, y0, y1, kind = "post") {
    const p = c.p;
    const wd = kind === "column" ? 4 : 3;
    p.rect(x, y0, wd, y1 - y0 + 1, SA[3]);
    p.vline(x, y0, y1, SA[4]);
    p.vline(x + wd - 1, y0, y1, SA[1]);
    if (kind === "column") {
      p.rect(x - 1, y0, wd + 2, 2, TE[2]);
      p.hline(x - 1, x + wd, y0, TE[3]);
      p.rect(x - 1, y1 - 1, wd + 2, 2, SA[2]);
      p.vline(x + 2, y0 + 2, y1 - 2, SA[2]);
    }
    return wd;
  },
  winSize: (kind = "std") => winSizes[kind],
  window,
  doorSize: (kind = "std") => doorSizes[kind],
  door,
  sign,
  decor(c, x, w, y, bottom) {
    const p = c.p;
    // 墙角铜灯
    wallLamp(c, x + w - 1, y + 9, "brass", 1);
    // 陶盆绿植（冬季只剩陶盆与沙）
    for (const px of [x - 3, x + w - 2]) {
      const g = c.gy;
      p.rect(px, g - 4, 5, 4, SA[1]);
      p.hline(px, px + 4, g - 4, SA[2]);
      p.set(px, g - 3, SA[2]);
      if (c.o.season !== 3) {
        const leaf = c.o.season === 2 ? P.autumn : P.leaf;
        p.line(px + 2, g - 5, px - 1, g - 9, leaf[2]);
        p.line(px + 2, g - 5, px + 5, g - 9, leaf[1]);
        p.line(px + 2, g - 5, px + 2, g - 10, leaf[3]);
        p.set(px + 1, g - 7, leaf[3]);
      }
    }
    void bottom;
  },
};
