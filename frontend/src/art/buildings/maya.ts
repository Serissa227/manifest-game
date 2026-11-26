// 玛雅风格（maya）：后古典期尤卡坦的城镇（玛雅潘、图卢姆、科苏梅尔）。
// 石灰岩台基上的建筑抹着白灰，墙脚刷一道赭红；石屋的平顶压着三段式的束带线脚（中间一排线轴纹），
// 上层是阶梯回纹与菱格的石雕饰带，门洞上是叠涩拱（尖三角的假拱），窗是 T 字形的小窗；
// 民居是白泥墙、又高又圆的棕榈茅草顶（椭圆屋）；正式建筑顶上立着镂空的屋顶冠饰（crestería），色彩用赭红与绿松石；
// 地标是带中央大台阶、顶上小庙与冠饰的阶梯金字塔；城门是叠涩拱的门楼（拉布纳式）；城墙是干砌的石墙，墙台上是茅草哨棚；
// 街上有石柱上的火盆、石井口与大陶罐、刷红边的石凳与背篓架（玛雅人没有车）；远景里是茅草椭圆屋、金字塔与白色的石砌堤道。
import type { Facility } from "../../store/game";
import { P, ink, overlay } from "../palette";
import type { Px } from "../px";
import { drawEmblem } from "./emblems";
import { type Canvas, type Ramp, ashlar, fillProfile, h01, plaster, tintOpaque } from "./kit";
import { opening } from "./parts";
import { type DoorKind, type Kit, type RoofKind, type WallKind, type WinKind, eaveShadow } from "./style";
import { type CultureArt, type FarCtx, farWindows, spots, wrap, wrapCourses } from "./townArt";

/** 石灰岩（灰白） */
const ST: Ramp = [P.stone[1], P.stone[2], P.plaster[2], P.plaster[3], P.white];
/** 白灰 */
const LS: Ramp = [P.plaster[0], P.plaster[1], P.plaster[2], P.plaster[3], P.white];
/** 赭红（赤铁矿颜料） */
const MR: Ramp = [P.brick[0], P.brick[1], P.brick[2], P.brick[3]];
/** 绿松石（玛雅蓝） */
const TQ: Ramp = [P.teal[1], P.teal[2], P.teal[3], P.teal[4]];
/** 棕榈茅草（偏灰的金褐） */
const TH: Ramp = [P.wood[0], P.parchmentDeep, P.straw[1], P.parchmentDark, P.straw[2]];
const W = P.wood;

// ───────────────────────── 屋顶 ─────────────────────────

/** 三段式束带线脚：上下两道凸线，中间一排线轴纹。顶在 y，占 3 行。 */
function atadura(p: Px, x: number, w: number, y: number): void {
  p.hline(x, x + w - 1, y, ST[4]);
  for (let i = 0; i < w; i++) p.set(x + i, y + 1, i % 3 === 1 ? ST[1] : ST[3]);
  p.hline(x, x + w - 1, y + 2, ST[1]);
}

/** 阶梯纹的石雕饰带：一正一倒的阶梯三角交替（下面的三角刷赭红），一道亮线沿着台阶起伏。 */
function fretBand(p: Px, x: number, y: number, w: number, h: number, painted = true): void {
  const unit = 16;
  for (let xx = x; xx < x + w; xx++) {
    const u = (((xx - x) % unit) + unit) % unit;
    const level = u < 8 ? Math.floor(u / 2) : Math.floor((15 - u) / 2);
    const edge = h - 1 - Math.round((level * (h - 1)) / 3);
    for (let yy = y; yy < y + h; yy++) {
      const row = yy - y;
      if (row === edge) p.set(xx, yy, ST[4]);
      else if (row > edge) p.set(xx, yy, painted ? (row === h - 1 ? MR[1] : MR[2]) : ST[1]);
      else p.set(xx, yy, row === 0 ? ST[3] : ST[2]);
    }
  }
}

/** 石屋的平顶：上沿一道束带线脚，下面一道阶梯回纹饰带。y 为墙顶；返回最高点。 */
function flatRoof(c: Canvas, x: number, w: number, y: number, frieze = 5): number {
  const p = c.p;
  const top = y - frieze - 3;
  atadura(p, x - 2, w + 4, top);
  fretBand(p, x - 1, top + 3, w + 2, frieze);
  atadura(p, x - 2, w + 4, y - 1 + 1);
  c.markRoof(x - 2, top, w + 4, 2, ST, 0);
  eaveShadow(c, x, w, y + 3, 1);
  return top;
}

/** 镂空的屋顶冠饰：中心 cx，底在 y，宽 w、高 h；刷赭红，开几排方孔，顶上阶梯形。返回最高点。 */
function cresteria(c: Canvas, cx: number, y: number, w: number, h: number): number {
  const p = c.p;
  const x = cx - Math.floor(w / 2);
  p.rect(x, y - h, w, h, MR[2]);
  p.vline(x, y - h, y - 1, MR[3]);
  p.vline(x + w - 1, y - h, y - 1, MR[0]);
  for (let yy = y - h + 3; yy < y - 2; yy += 4) {
    for (let xx = x + 2; xx < x + w - 2; xx += 4) p.rect(xx, yy, 2, 2, ink.brown);
  }
  // 阶梯形顶与两角的绿松石
  p.hline(x + 1, x + w - 2, y - h - 1, MR[2]);
  p.hline(x + 3, x + w - 4, y - h - 2, MR[3]);
  p.set(x, y - h, TQ[2]).set(x + w - 1, y - h, TQ[2]).set(cx, y - h - 3, TQ[3]);
  c.markRoof(x, y - h - 2, w, 3, MR, 0);
  return y - h - 3;
}

/** 棕榈茅草顶：又高又圆（椭圆屋的端头），一层层草片，顶上一道压脊。返回最高点。 */
function thatch(c: Canvas, x: number, w: number, y: number, h: number, over: number): number {
  const p = c.p;
  const x0 = x - over;
  const x1 = x + w - 1 + over;
  const yb = y + 2;
  const mid = (x0 + x1) / 2;
  const half = (x1 - x0) / 2 + 0.5;
  fillProfile(
    p,
    x0,
    x1,
    (xx) => {
      if (xx < x0 || xx > x1) return null;
      const u = Math.abs(xx - mid) / half;
      // 圆头：两端是椭圆的四分之一，中间平
      const flat = 0.45;
      const t = u <= flat ? 1 : Math.sqrt(Math.max(0, 1 - ((u - flat) / (1 - flat)) ** 2));
      return [yb - Math.round(t * h), yb] as const;
    },
    (xx, _yy, e) => {
      const layer = Math.floor(e.fromBot / 4);
      const k = e.fromBot % 4;
      const r = h01(xx, layer, c.seed + 3);
      let col: string = k === 0 ? (r < 0.4 ? TH[1] : TH[2]) : k === 1 ? TH[4] : k === 2 ? TH[3] : TH[2];
      if (k === 0 && layer === 0 && r < 0.3) return null;
      if (xx > mid + half * 0.4) col = col === TH[4] ? TH[3] : col === TH[3] ? TH[2] : TH[1];
      return col;
    },
  );
  // 压脊
  const ry = yb - h;
  p.hline(Math.round(mid - half * 0.45), Math.round(mid + half * 0.45), ry - 1, TH[0]);
  p.hline(Math.round(mid - half * 0.45) + 1, Math.round(mid + half * 0.45) - 1, ry - 2, TH[1]);
  c.markRoof(x0, ry - 2, x1 - x0 + 1, h + 3, TH, 1);
  c.eave(x0 + 2, x1 - 2, yb);
  eaveShadow(c, x, w, y + 3, 1);
  return ry - 2;
}

function roof(c: Canvas, x: number, w: number, y: number, kind: RoofKind = "main"): number {
  const p = c.p;
  if (kind === "gable") return thatch(c, x, w, y, Math.min(26, Math.round(w * 0.62) + 2), 4);
  if (kind === "shed") return thatch(c, x, w, y, 12, 3);
  if (kind === "porch") {
    p.rect(x - 2, y - 3, w + 4, 4, ST[3]);
    atadura(p, x - 2, w + 4, y - 3);
    p.hline(x - 2, x + w + 1, y + 1, MR[1]);
    c.markRoof(x - 2, y - 3, w + 4, 1, ST, 0);
    eaveShadow(c, x, w, y + 2, 1);
    return y - 3;
  }
  if (kind === "tower") {
    // 塔顶：两层退台，台上一座小庙与冠饰
    const cx = x + Math.floor(w / 2);
    const t1 = flatRoof(c, x, w, y, 3);
    const tw = w - 6;
    const tx = cx - Math.floor(tw / 2);
    const tt = t1 - 9;
    plaster(p, tx, tt, tw, 9, LS, c.seed + 5);
    p.rect(tx, tt, tw, 3, MR[2]);
    p.rect(cx - 2, tt + 4, 5, 5, c.o.lit ? P.lamp[1] : ink.brown);
    p.set(cx - 2, tt + 4, LS[3]).set(cx + 2, tt + 4, LS[3]);
    atadura(p, tx - 1, tw + 2, tt - 3);
    return cresteria(c, cx, tt - 3, Math.max(8, tw - 4), 9);
  }
  const top = flatRoof(c, x, w, y, kind === "grand" ? 6 : 4);
  if (kind === "grand") {
    const cx = x + Math.floor(w / 2);
    return cresteria(c, cx, top, Math.min(30, Math.max(12, Math.round(w * 0.38))), Math.min(14, Math.max(8, Math.round(w * 0.14))));
  }
  return top;
}

// ───────────────────────── 门窗 ─────────────────────────

const winSizes: Record<WinKind, readonly [number, number]> = {
  std: [6, 7],
  tall: [4, 10],
  small: [4, 4],
  round: [7, 7],
  wide: [14, 7],
};

const doorSizes: Record<DoorKind, readonly [number, number]> = {
  std: [8, 12],
  double: [12, 14],
  grand: [14, 16],
  open: [16, 12],
  iron: [12, 13],
  barn: [18, 16],
};

function window(c: Canvas, x: number, y: number, kind: WinKind = "std"): void {
  const p = c.p;
  const [w, h] = winSizes[kind];
  const dark = c.o.lit ? P.lamp[1] : ink.brown;
  if (kind === "round") {
    // 四瓣形的窗
    p.stamp([".aaa.", "aabaa", "abbba", "aabaa", ".aaa."], { a: ST[1], b: dark }, x + 1, y + 1);
    p.set(x + 3, y, ST[1]).set(x + 3, y + 6, ST[1]).set(x, y + 3, ST[1]).set(x + 6, y + 3, ST[1]);
    return;
  }
  if (kind === "wide") {
    // 两根短圆柱分开的柱廊式窗洞
    p.rect(x - 1, y - 1, w + 2, h + 2, ST[1]);
    p.rect(x, y, w, h, dark);
    for (const cx of [x + 4, x + 9]) {
      p.rect(cx, y, 2, h, ST[3]);
      p.vline(cx, y, y + h - 1, ST[4]);
      p.hline(cx - 1, cx + 2, y, ST[2]);
    }
    c.ledge(x - 1, x + w, y + h);
    return;
  }
  if (kind === "std") {
    // T 字形窗
    p.rect(x - 1, y - 1, w + 2, h + 2, ST[1]);
    p.rect(x, y, w, h, LS[3]);
    p.rect(x, y, w, 2, dark);
    p.rect(x + 2, y + 2, 2, h - 2, dark);
    p.hline(x - 1, x + w, y + h, MR[1]);
    c.ledge(x - 1, x + w, y + h);
    return;
  }
  // 细缝窗 / 方孔
  p.rect(x - 1, y - 1, w + 2, h + 2, ST[1]);
  p.rect(x, y, w, h, dark);
  p.hline(x - 1, x + w, y - 1, ST[4]);
}

/** 叠涩拱门洞：高 h、宽 w，顶上 rise 行每行左右各收 1 像素。 */
function corbel(p: Px, x: number, y: number, w: number, h: number, rise: number, col: string): void {
  for (let row = 0; row < h; row++) {
    const k = row < rise ? rise - row : 0;
    if (x + k > x + w - 1 - k) continue;
    p.hline(x + k, x + w - 1 - k, y + row, col);
  }
}

function door(c: Canvas, cx: number, bottom: number, kind: DoorKind = "std"): void {
  const p = c.p;
  const [w, h] = doorSizes[kind];
  const x = cx - Math.floor(w / 2);
  const y = bottom - h;
  if (kind === "double" || kind === "grand") {
    // 叠涩拱：石框，里面一道织纹门帘
    const rise = Math.floor(w / 2) - 1;
    corbel(p, x - 2, y - 3, w + 4, h + 3, rise + 1, ST[1]);
    corbel(p, x, y, w, h, rise, c.o.lit ? P.lamp[1] : ink.brown);
    const cy = y + rise;
    for (let yy = cy; yy < cy + 5; yy++) for (let xx = x; xx < x + w; xx++) p.set(xx, yy, (xx + yy) % 4 < 2 ? MR[2] : (xx + yy) % 4 === 2 ? TQ[1] : LS[3]);
    p.hline(x, x + w - 1, cy + 5, MR[1]);
    return;
  }
  // 平门楣：石门框与一根刻纹的木楣
  p.rect(x - 2, y - 2, w + 4, h + 2, ST[1]);
  p.vline(x - 2, y - 2, bottom - 1, ST[3]);
  p.rect(x - 3, y - 3, w + 6, 2, W[2]);
  for (let xx = x - 3; xx < x + w + 3; xx += 2) p.set(xx, y - 3, W[3]);
  if (kind === "open" || kind === "barn") {
    opening(c, x, y, w, h);
    if (kind === "open") {
      for (const px of [x + 4, x + w - 6]) {
        p.rect(px, y, 2, h, ST[3]);
        p.vline(px, y, y + h - 1, ST[4]);
      }
    }
    return;
  }
  opening(c, x, y, w, h);
  // 半挂起的织纹门帘（赭红与绿松石的条纹）
  const ch = Math.floor(h * 0.55);
  const heavy = kind === "iron";
  for (let yy = y; yy < y + ch; yy++) {
    for (let xx = x; xx < x + w; xx++) {
      const band = Math.floor((yy - y) / 2) % 3;
      p.set(xx, yy, heavy ? (band === 1 ? MR[0] : W[1]) : band === 0 ? MR[2] : band === 1 ? LS[3] : TQ[1]);
    }
  }
  p.hline(x, x + w - 1, y + ch, MR[0]);
}

/** 彩绘的灰塑嵌板：绿松石边、赭红底。 */
function sign(c: Canvas, cx: number, y: number, fac: Facility): number {
  const p = c.p;
  const x = cx - 7;
  p.rect(x, y, 15, 13, TQ[1]);
  p.hline(x, x + 14, y, TQ[2]);
  p.rect(x + 1, y + 1, 13, 11, ST[3]);
  p.rect(x + 2, y + 2, 11, 9, MR[0]);
  for (const [sx, sy] of [
    [x, y],
    [x + 14, y],
    [x, y + 12],
    [x + 14, y + 12],
  ] as const)
    p.set(sx, sy, P.gold[3]);
  drawEmblem(p, fac, x + 3, y + 2, maya.flag);
  c.ledge(x, x + 14, y);
  return 13;
}

// ───────────────────────── 墙 ─────────────────────────

function wall(c: Canvas, x: number, y: number, w: number, h: number, kind: WallKind = "main"): void {
  const p = c.p;
  if (kind === "upper") {
    // 上层：束带线脚下面一片菱格石雕
    p.rect(x, y, w, h, ST[2]);
    atadura(p, x, w, y);
    // 菱格
    for (let yy = y + 3; yy < y + h; yy++) {
      for (let xx = x; xx < x + w; xx++) {
        const d = ((xx + yy) % 4 === 0) || ((xx - yy + 400) % 4 === 0);
        p.set(xx, yy, d ? ST[1] : ST[3]);
      }
    }
    p.vline(x, y, y + h - 1, ST[4]);
    p.vline(x + w - 1, y, y + h - 1, ST[0]);
    return;
  }
  if (kind === "stone") {
    // 方整的石灰岩贴面，中段一排小圆柱
    ashlar(p, x, y, w, h, ST, { course: 4, min: 4, max: 6, seed: c.seed + x, light: 2 });
    const cy = y + Math.floor(h * 0.45);
    p.rect(x, cy, w, 6, ST[2]);
    for (let xx = x + 1; xx < x + w - 1; xx += 3) {
      p.vline(xx, cy, cy + 5, ST[4]);
      p.vline(xx + 1, cy, cy + 5, ST[1]);
    }
    p.hline(x, x + w - 1, cy, ST[4]);
    p.hline(x, x + w - 1, cy + 5, ST[0]);
    p.vline(x, y, y + h - 1, ST[4]);
    p.vline(x + w - 1, y, y + h - 1, ST[0]);
    return;
  }
  // 白灰墙，墙脚刷一道赭红，上面一道绿松石细线
  plaster(p, x, y, w, h, LS, c.seed + x + y);
  const dh = Math.min(4, Math.floor(h / 3));
  p.rect(x, y + h - dh, w, dh, MR[2]);
  p.hline(x, x + w - 1, y + h - dh, MR[3]);
  p.hline(x, x + w - 1, y + h - dh - 1, TQ[1]);
  if (kind === "plain") {
    // 泥墙里露出的竖向木杆
    for (let xx = x + 3; xx < x + w - 2; xx += 5) p.vline(xx, y + 1, y + h - dh - 3, LS[2]);
    p.vline(x, y, y + h - 1, LS[4]);
    p.vline(x + w - 1, y, y + h - 1, LS[1]);
    return;
  }
  p.vline(x, y, y + h - 1, LS[4]);
  p.vline(x + w - 1, y, y + h - 1, LS[1]);
  if (kind === "ground") p.hline(x, x + w - 1, y, LS[1]);
}

export const maya: Kit = {
  style: "maya",
  flag: [MR[1], MR[2], MR[3]],
  trim: W,
  plinthH: 3,
  awning: [MR, TQ],
  lamp: "shell",
  tavernRoof: "gable",
  wall,
  plinth(c, x, w, h) {
    // 石灰岩台基，顶上一道亮边
    const p = c.p;
    const g = c.gy;
    ashlar(p, x, g - h, w, h, ST, { course: Math.min(3, h), min: 6, max: 11, seed: c.seed + 3, light: 2 });
    p.hline(x, x + w - 1, g - h, ST[4]);
  },
  roof,
  band(c, x, w, y) {
    atadura(c.p, x - 1, w + 2, y - 1);
  },
  post(c, x, y0, y1, kind = "post") {
    const p = c.p;
    if (kind === "column") {
      // 圆石柱，方柱头，柱身一道赭红
      p.rect(x, y0, 3, y1 - y0 + 1, ST[3]);
      p.vline(x, y0, y1, ST[4]);
      p.vline(x + 2, y0, y1, ST[1]);
      p.rect(x - 1, y0, 5, 2, ST[3]);
      p.hline(x - 1, x + 3, y0 + 1, ST[1]);
      p.hline(x, x + 2, y0 + 4, MR[2]);
      p.rect(x - 1, y1 - 1, 5, 2, ST[2]);
      return 3;
    }
    p.rect(x, y0, 2, y1 - y0 + 1, W[2]);
    p.vline(x + 1, y0, y1, W[1]);
    return 2;
  },
  winSize: (kind = "std") => winSizes[kind],
  window,
  doorSize: (kind = "std") => doorSizes[kind],
  door,
  sign,
  decor(c, x, w, y) {
    const p = c.p;
    const g = c.gy;
    // 墙脚一对大陶罐；夏秋两季檐下挂一束玉米
    for (const [px, big] of [
      [x - 6, true],
      [x + w + 1, false],
    ] as const) {
      const hh = big ? 7 : 5;
      p.rect(px + 1, g - hh, 4, hh, MR[1]);
      p.rect(px, g - hh + 2, 6, hh - 3, MR[1]);
      p.vline(px, g - hh + 2, g - 3, MR[3]);
      p.hline(px + 1, px + 4, g - hh, MR[0]);
      p.hline(px, px + 5, g - hh + 3, P.white);
    }
    if (c.o.season === 1 || c.o.season === 2) {
      const mx = x + w - 6;
      p.vline(mx + 2, y + 3, y + 5, P.straw[1]);
      for (const dx of [0, 2, 4]) {
        p.vline(mx + dx, y + 6, y + 10, dx === 2 ? P.gold[3] : P.gold[2]);
        p.set(mx + dx, y + 11, P.gold[1]);
      }
    }
  },
};

// ───────────────────────── 地标：阶梯金字塔 ─────────────────────────

function landmark(c: Canvas): void {
  const p = c.p;
  const g = c.gy;
  const cx = 48;
  const tiers = 7;
  const th = 10;
  let bottom = g;
  let hw = 36;
  const stairHW = 6;
  for (let i = 0; i < tiers; i++) {
    const top = bottom - th;
    // 每层：略向内收的斜面（左亮右暗），顶上一道亮边
    for (let yy = top; yy < bottom; yy++) {
      const inset = Math.round(((yy - top) / th) * -2) + 2;
      const a = cx - hw + inset;
      const b = cx + hw - inset;
      for (let xx = a; xx <= b; xx++) {
        const u = (xx - cx) / hw;
        p.set(xx, yy, u < -0.5 ? ST[3] : u < 0.45 ? ST[2] : ST[1]);
      }
      p.set(a, yy, ST[4]);
    }
    p.hline(cx - hw + 2, cx + hw - 2, top, ST[4]);
    p.hline(cx - hw + 3, cx + hw - 3, top + 1, ST[3]);
    // 层面上的横向线脚与凹格
    for (let xx = cx - hw + 6; xx < cx + hw - 6; xx += 6) if (Math.abs(xx - cx) > stairHW + 2) p.rect(xx, top + 4, 3, 4, ST[1]);
    bottom = top;
    hw -= 4;
  }
  // 中央大台阶：两侧护栏，台阶一行亮一行暗
  for (let yy = bottom; yy < g; yy++) {
    p.hline(cx - stairHW + 1, cx + stairHW - 1, yy, (g - yy) % 2 === 0 ? ST[3] : ST[1]);
    p.set(cx - stairHW, yy, ST[4]).set(cx + stairHW, yy, ST[0]);
  }
  // 顶上的小庙：白灰墙、赭红饰带、叠涩门、屋顶冠饰
  const tw = 24;
  const tx = cx - tw / 2;
  const tt = bottom - 16;
  plaster(p, tx, tt, tw, 16, LS, 7);
  p.vline(tx, tt, bottom - 1, LS[4]);
  p.vline(tx + tw - 1, tt, bottom - 1, LS[1]);
  for (const dx of [-7, 0, 7]) corbel(p, cx + dx - 2, tt + 8, 5, 8, 2, c.o.lit && dx === 0 ? P.lamp[1] : ink.brown);
  const ft = flatRoof(c, tx, tw, tt, 5);
  cresteria(c, cx, ft, 18, 14);
  // 台阶脚下一对石火盆
  for (const fx of [cx - stairHW - 4, cx + stairHW + 1]) {
    p.rect(fx, g - 5, 4, 5, ST[2]);
    p.rect(fx - 1, g - 7, 6, 2, MR[1]);
    if (c.o.lit) p.set(fx + 1, g - 8, P.lamp[2]).set(fx + 2, g - 9, P.lamp[1]);
  }
}

// ───────────────────────── 城门与城墙 ─────────────────────────

function gate(c: Canvas): void {
  const p = c.p;
  const g = c.gy;
  const cx = Math.floor(c.w / 2);
  const bw = 74;
  const x = cx - bw / 2;
  const top = g - 40;
  // 门楼主体：下部白灰墙，上部回纹与菱格石雕
  plaster(p, x, g - 22, bw, 22, LS, 5);
  p.rect(x, g - 4, bw, 4, MR[2]);
  p.hline(x, x + bw - 1, g - 4, MR[3]);
  wall(c, x, top, bw, 18, "upper");
  atadura(p, x - 2, bw + 4, g - 23);
  // 叠涩拱门洞：穿过整座门楼
  const aw = 20;
  corbel(p, cx - aw / 2 - 2, g - 23, aw + 4, 23, 12, ST[1]);
  corbel(p, cx - aw / 2, g - 21, aw, 21, 10, ink.brown);
  p.rect(cx - aw / 2 + 3, g - 5, aw - 6, 5, P.sand[2]);
  p.dither(cx - aw / 2 + 3, g - 11, aw - 6, 6, P.leaf[1], 1);
  // 两侧小室的门
  for (const dx of [-26, 20]) {
    p.rect(cx + dx - 1, g - 15, 8, 15, ST[1]);
    p.rect(cx + dx, g - 14, 6, 14, ink.brown);
    p.rect(cx + dx - 2, g - 17, 10, 2, W[2]);
  }
  flatRoof(c, x, bw, top, 3);
  maya.sign(c, cx, top + 3, "office");
  cresteria(c, cx, top - 6, 34, 14);
}

function wallBody(c: Canvas, W: number, top: number): void {
  const p = c.p;
  const H = c.gy;
  // 干砌石墙：大小不一的石块，墙顶抹圆的一层白灰
  wrapCourses(p, W, top + 2, H - top - 2, ST, 4, 3, 8, c.seed, 2);
  for (let i = 0; i < Math.floor((W * (H - top)) / 40); i++) {
    const x = Math.floor(h01(i, c.seed, 5) * W);
    const y = top + 3 + Math.floor(h01(i, c.seed, 6) * (H - top - 4));
    p.put(x, y, ST[0]);
  }
  for (let x = 0; x < W; x++) {
    p.put(x, top - 1, LS[3]);
    p.put(x, top, LS[4]);
    p.put(x, top + 1, LS[2]);
  }
  for (const x of spots(W, 24)) wrap(W, (dx) => p.rect(x + dx + 12, top + 2, 4, 1, MR[2]));
}

function wallTower(c: Canvas, x: number, top: number): void {
  const p = c.p;
  const H = c.gy;
  // 两层退台的小平台，台上一座茅草哨棚
  ashlar(p, x - 2, top - 6, 22, H - top + 6, ST, { course: 4, min: 4, max: 7, seed: x, light: 2 });
  ashlar(p, x + 1, top - 12, 16, 6, ST, { course: 3, min: 4, max: 6, seed: x + 1, light: 2 });
  p.hline(x - 2, x + 19, top - 6, ST[4]);
  p.hline(x + 1, x + 16, top - 12, ST[4]);
  plaster(p, x + 3, top - 19, 12, 7, LS, x);
  p.rect(x + 7, top - 17, 4, 5, ink.brown);
  thatch(c, x + 3, 12, top - 20, 8, 2);
}

// ───────────────────────── 远景 ─────────────────────────

function farHouse(k: FarCtx, x: number, w: number, h: number, seed: number): void {
  const p = k.p;
  const b = k.base;
  const f = k.f;
  if (h01(seed, 4, 5) < 0.55) {
    // 茅草椭圆屋：矮白墙、又高又圆的草顶
    const wh = Math.min(h, 6);
    p.rect(x, b - wh, w, wh, LS[3]);
    p.vline(x + w - 1, b - wh, b - 1, LS[1]);
    p.hline(x, x + w - 1, b - 2, MR[1]);
    const rh = Math.max(5, Math.round(w * 0.6));
    const mid = x + (w - 1) / 2;
    const half = w / 2 + 2;
    for (let xx = x - 2; xx <= x + w + 1; xx++) {
      const u = Math.abs(xx - mid) / half;
      const t = u <= 0.4 ? 1 : Math.sqrt(Math.max(0, 1 - ((u - 0.4) / 0.6) ** 2));
      const top = b - wh - Math.round(t * rh);
      p.vline(xx, top, b - wh + 1, xx > mid ? f.roof[0] : f.roof[1]);
      p.set(xx, top, f.roof[2]);
    }
    k.roofs.push([x - 2, b - wh - rh, w + 4, rh + 2]);
    return;
  }
  // 平顶石屋：白墙、线脚、一道赭红
  const wallTop = b - h;
  p.rect(x, wallTop, w, h, f.wall[2]);
  p.vline(x + w - 1, wallTop, b - 1, f.wall[0]);
  farWindows(k, x, wallTop + 3, w, h - 3, seed);
  p.hline(x - 1, x + w, wallTop, f.wall[2]);
  p.hline(x - 1, x + w, wallTop + 1, f.accent[1]);
  p.hline(x, x + w - 1, b - 2, f.accent[1]);
  k.roofs.push([x - 1, wallTop, w + 2, 1]);
}

/** 远景的金字塔：五层退台、中央台阶、顶上小庙与冠饰。 */
function farPyramid(k: FarCtx, x: number): number {
  const p = k.p;
  const b = k.base;
  const f = k.f;
  const cx = x + 16;
  let bottom = b;
  let hw = 16;
  for (let i = 0; i < 5; i++) {
    p.rect(cx - hw, bottom - 5, hw * 2 + 1, 5, f.wall[1]);
    p.hline(cx - hw, cx + hw, bottom - 5, f.wall[2]);
    p.vline(cx + hw, bottom - 5, bottom - 1, f.wall[0]);
    bottom -= 5;
    hw -= 3;
  }
  for (let yy = bottom; yy < b; yy++) p.hline(cx - 2, cx + 2, yy, (b - yy) % 2 ? f.wall[0] : f.wall[2]);
  p.rect(cx - 4, bottom - 6, 9, 6, f.accent[1]);
  p.rect(cx - 1, bottom - 4, 3, 4, ink.brown);
  k.lights.push([cx, bottom - 3]);
  p.rect(cx - 3, bottom - 11, 7, 5, f.accent[1]);
  p.set(cx - 1, bottom - 9, f.wall[0]).set(cx + 1, bottom - 9, f.wall[0]);
  k.roofs.push([cx - 4, bottom - 11, 9, 2]);
  return 34;
}

/** 远景的木棉树：笔直的灰干、伞形的树冠。 */
function farCeiba(k: FarCtx, x: number, h: number): void {
  const p = k.p;
  const b = k.base;
  p.vline(x, b - h, b - 1, P.stone[2]);
  p.vline(x + 1, b - h, b - 1, P.stone[1]);
  p.ellipse(x + 0.5, b - h, 8, 3, P.leaf[1]);
  p.hline(x - 7, x + 8, b - h - 2, P.leaf[2]);
  k.roofs.push([x - 8, b - h - 3, 17, 3]);
}

function farTower(k: FarCtx, x: number, seed: number): number {
  const used = farPyramid(k, x);
  if (h01(seed, 3, 1) < 0.6) {
    farCeiba(k, x + used + 4, 22 + Math.floor(h01(seed, 4, 1) * 8));
    return used + 12;
  }
  return used;
}

/** 白色的石砌堤道（sacbe）：抬高的白灰路面，两侧砌石挡墙。 */
function farWall(k: FarCtx, top: number): void {
  const p = k.p;
  const W = k.W;
  p.rect(0, top, W, 8, ST[2]);
  p.hline(0, W - 1, top, LS[4]);
  p.hline(0, W - 1, top + 1, LS[3]);
  p.hline(0, W - 1, top + 2, LS[2]);
  for (let x = 0; x < W; x += 3) p.put(x, top + 4 + (Math.floor(x / 3) % 2), ST[1]);
  for (let x = 1; x < W; x += 5) p.put(x, top + 6, ST[0]);
}

// ───────────────────────── 街道小物件 ─────────────────────────

/** 石柱上的陶火盆：夜里燃着火，白天是暗红的余烬。 */
function lamp(c: Canvas): void {
  const p = c.p;
  const g = c.gy;
  const lit = c.o.lit;
  p.rect(2, g - 3, 9, 3, ST[2]);
  p.hline(2, 10, g - 3, ST[4]);
  p.rect(4, g - 18, 5, 15, ST[3]);
  p.vline(4, g - 18, g - 4, ST[4]);
  p.vline(8, g - 18, g - 4, ST[1]);
  p.hline(4, 8, g - 12, MR[2]);
  // 火盆
  p.rect(1, g - 22, 11, 4, MR[1]);
  p.hline(1, 11, g - 22, MR[3]);
  p.hline(2, 10, g - 19, MR[0]);
  for (const xx of [3, 6, 9]) p.set(xx, g - 21, P.white);
  if (lit) {
    p.stamp(["..a..", ".aba.", "abcba", "bcccb"], { a: P.red[3], b: P.lamp[1], c: P.lamp[2] }, 4, g - 26);
    tintOpaque(p, 0, g - 28, 13, 14, overlay.glow, 2);
  } else {
    p.hline(3, 9, g - 23, P.wood[0]);
    p.set(5, g - 23, P.red[2]).set(8, g - 23, P.red[1]);
  }
}

/** 石井口：一圈齐地的石环，木架上吊着葫芦瓢，旁边一只大陶罐。 */
function well(c: Canvas): void {
  const p = c.p;
  const g = c.gy;
  p.rect(2, g - 4, 16, 4, ST[2]);
  p.hline(2, 17, g - 4, ST[4]);
  p.rect(5, g - 3, 10, 2, ink.brown);
  for (const x of [3, 15]) {
    p.rect(x, g - 18, 2, 14, W[2]);
    p.vline(x, g - 18, g - 5, W[3]);
  }
  p.hline(2, 17, g - 17, W[2]);
  p.vline(10, g - 16, g - 9, P.straw[1]);
  p.circle(10, g - 7, 1, P.gold[1]);
  p.set(9, g - 8, P.gold[3]);
  // 大陶罐
  p.rect(19, g - 9, 6, 9, MR[1]);
  p.rect(20, g - 11, 4, 2, MR[1]);
  p.vline(19, g - 8, g - 2, MR[3]);
  p.hline(19, 24, g - 6, P.white);
}

/** 石凳：白灰抹面，刷一道赭红边。 */
function bench(p: Px): void {
  const g = p.h;
  p.rect(1, g - 5, 16, 5, LS[3]);
  p.hline(1, 16, g - 5, LS[4]);
  p.hline(1, 16, g - 2, MR[2]);
  p.hline(1, 16, g - 1, MR[1]);
  p.vline(16, g - 5, g - 1, LS[1]);
}

/** 背篓架：玛雅人没有车，货物绑在木架上用额带背着走；歇脚时靠在一块石头上。 */
function cart(p: Px, v: number): void {
  const g = p.h;
  // 歇脚的石头
  p.rect(14, g - 5, 10, 5, ST[2]);
  p.hline(14, 23, g - 5, ST[4]);
  p.vline(23, g - 5, g - 1, ST[1]);
  // 斜靠的 A 字木架
  p.line(4, g - 1, 15, g - 24, W[2]);
  p.line(9, g - 1, 19, g - 22, W[2]);
  for (let i = 0; i < 4; i++) p.line(5 + i * 3, g - 4 - i * 5, 10 + i * 3, g - 4 - i * 5, W[1]);
  if (v % 2 === 0) {
    // 一大包条纹织物
    for (let yy = g - 20; yy < g - 9; yy++) {
      for (let xx = 8; xx < 17; xx++) {
        const band = Math.floor((yy - (g - 20)) / 2) % 3;
        p.set(xx, yy, band === 0 ? MR[2] : band === 1 ? LS[3] : TQ[1]);
      }
    }
    p.hline(8, 16, g - 15, P.straw[1]);
  } else {
    // 一篮玉米
    p.rect(8, g - 15, 9, 6, P.straw[1]);
    p.hline(8, 16, g - 15, P.straw[3]);
    for (const xx of [9, 11, 13, 15]) {
      p.vline(xx, g - 19, g - 16, P.gold[2]);
      p.set(xx, g - 20, P.gold[3]);
    }
  }
  // 额带
  p.line(15, g - 24, 22, g - 20, P.straw[1]);
}

export const MAYA: CultureArt = {
  kit: maya,
  landmark,
  gate,
  wallBody,
  wallTower,
  far: { roof: [TH[1], TH[2], TH[3]], wall: [ST[1], ST[2], ST[3]], accent: [MR[0], MR[1], MR[2]] },
  farHouse,
  farTower,
  farWall,
  props: {
    flag: [MR[1], MR[2], MR[3]],
    stall: [MR, TQ],
    lamp,
    well,
    bench,
    cart,
  },
};
