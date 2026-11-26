// 斯瓦希里风格（swahili）：斯瓦希里海岸的石头城。
// 珊瑚石砌墙抹白灰、平顶，女儿墙下一排伸出墙面的红树林木梁头，木水槽从屋顶伸出；
// 雕花的厚木门（门框刻链纹、门楣一道雕带、门扇钉满铜钉），门两侧是白灰的石凳（baraza）；
// 墙上嵌着青花瓷碗；穷人家是泥篱墙与灰褐的椰叶茅草顶（makuti）；公共建筑的平顶上一排白色的小穹顶与筒拱；
// 地标是嵌瓷碗的柱墓与没有宣礼塔的小清真寺；城墙是白珊瑚石墙，墙台上搭着茅草瞭望棚；
// 街上有白灰柱龛里的油灯、珊瑚石井栏、铺草席的石凳与装椰子、红树林木杆的手推车；远景里是白色的平顶、柱墓与椰子树。
import type { Facility } from "../../store/game";
import { P, ink, overlay } from "../palette";
import type { Px } from "../px";
import { drawEmblem } from "./emblems";
import { type Canvas, type Ramp, ashlar, fillProfile, h01, hipProfile, plaster, tintOpaque } from "./kit";
import { opening, steps, wallLamp } from "./parts";
import { type DoorKind, type Kit, type RoofKind, type WallKind, type WinKind, eaveShadow } from "./style";
import { type CultureArt, type FarCtx, farWindows, spots, wrap, wrapCourses } from "./townArt";

/** 白灰（抹在珊瑚石上） */
const CL: Ramp = [P.plaster[0], P.plaster[1], P.plaster[2], P.plaster[3], P.white];
/** 露出的珊瑚石块 */
const CR: Ramp = [P.plaster[0], P.parchmentDark, P.parchment, P.plaster[3], P.white];
/** 椰叶茅草（makuti）：灰褐 */
const MK: Ramp = [P.wood[0], P.wood[1], P.parchmentDeep, P.parchmentDark, P.parchment];
const W = P.wood;
/** 青花瓷 */
const BW: Ramp = [P.cloth.navy[1], P.cloth.blue[1], P.cloth.blue[2], P.white];
/** 泥篱墙 */
const MUD: Ramp = P.sand;

// ───────────────────────── 屋顶 ─────────────────────────

/** 一排红树林木梁头：从 x 到 x+w-1，在 y 行。 */
function boriti(p: Px, x: number, w: number, y: number, step = 5): void {
  for (let xx = x + 2; xx < x + w - 1; xx += step) {
    p.rect(xx, y, 2, 2, W[1]);
    p.set(xx, y, W[2]);
    p.set(xx + 1, y + 2, overlay.shadow);
  }
}

/** 白灰平顶：女儿墙顶边圆润，下面一排梁头，两端伸出木水槽。y 为墙顶；返回最高点。 */
function flatRoof(c: Canvas, x: number, w: number, y: number, ph = 4): number {
  const p = c.p;
  const top = y - ph;
  plaster(p, x, top, w, ph + 2, CL, c.seed + 91);
  // 圆润的压顶
  p.hline(x + 1, x + w - 2, top - 1, CL[4]);
  p.hline(x, x + w - 1, top, CL[3]);
  p.set(x, top - 1, CL[3]).set(x + w - 1, top - 1, CL[2]);
  p.vline(x, top, y + 1, CL[4]);
  p.vline(x + w - 1, top, y + 1, CL[1]);
  boriti(p, x, w, y + 1);
  // 木水槽
  for (const [gx, dir] of [
    [x - 1, -1],
    [x + w, 1],
  ] as const) {
    p.hline(gx + (dir < 0 ? -2 : 0), gx + (dir < 0 ? 0 : 2), top + 2, W[2]);
    p.set(gx + dir * 2, top + 3, W[1]);
  }
  c.markRoof(x, top - 1, w, 2, CL, 0);
  return top - 1;
}

/** 椰叶茅草：一层层灰褐的草片，下缘参差，左亮右暗。 */
function makutiTex(x0: number, x1: number, seed: number) {
  const mid = (x0 + x1) / 2;
  const span = Math.max(1, (x1 - x0) / 2);
  return (xx: number, _yy: number, e: { fromTop: number; fromBot: number }): string | null => {
    const layer = Math.floor(e.fromBot / 3);
    const k = e.fromBot % 3;
    const r = h01(xx, layer, seed);
    const side = (xx - mid) / span;
    let col: string;
    if (k === 0) {
      if (layer === 0 && r < 0.35) return null;
      col = r < 0.4 ? MK[1] : MK[2];
    } else if (k === 1) col = r < 0.3 ? MK[2] : MK[3];
    else col = r < 0.5 ? MK[3] : MK[4];
    if (e.fromTop === 0) col = MK[2];
    if (side > 0.5) col = col === MK[4] ? MK[3] : col === MK[3] ? MK[2] : MK[1];
    return col;
  };
}

/** 椰叶茅草的四坡陡顶；返回最高点。 */
function makuti(c: Canvas, x: number, w: number, y: number, h: number, over: number): number {
  const p = c.p;
  const x0 = x - over;
  const x1 = x + w - 1 + over;
  const yb = y + 2;
  const yt = yb - h + 1;
  const inset = Math.min(Math.floor((x1 - x0) / 2) - 1, Math.round(h * 0.75));
  fillProfile(p, x0, x1, hipProfile(x0, x1, yt, yb, inset, 0.8, 3), makutiTex(x0, x1, c.seed + x));
  // 屋脊：一道压紧的草束
  p.hline(x0 + inset - 1, x1 - inset + 1, yt - 1, MK[1]);
  for (let xx = x0 + inset; xx < x1 - inset; xx += 3) p.set(xx, yt - 1, MK[3]);
  c.markRoof(x0, yt - 1, x1 - x0 + 1, h + 1, MK, 1);
  c.eave(x0 + 2, x1 - 2, yb);
  eaveShadow(c, x, w, y + 3, 1);
  return yt - 1;
}

/** 白灰小穹顶（顶上一点尖）；可带竖向的凹槽（瓜棱）。中心 cx，底在 y，半径 r；返回最高点。 */
function limeDome(c: Canvas, cx: number, y: number, r: number, fluted = false): number {
  const p = c.p;
  const hgt = Math.max(2, Math.round(r * 0.9));
  for (let row = 0; row <= hgt; row++) {
    const t = row / hgt;
    const half = Math.round(r * Math.sqrt(Math.max(0, 1 - t * t)) * (1 - t * 0.12));
    for (let xx = cx - half; xx <= cx + half; xx++) {
      const u = (xx - cx) / Math.max(1, r);
      let col: string = u < -0.35 ? CL[4] : u > 0.45 ? CL[1] : CL[3];
      if (fluted && (xx - cx + 99) % 2 === 0 && row < hgt - 1) col = u > 0.2 ? CL[0] : CL[2];
      p.set(xx, y - row, col);
    }
  }
  p.set(cx, y - hgt - 1, CL[3]);
  c.markRoof(cx - r, y - hgt - 1, r * 2 + 1, hgt + 2, CL, 0);
  return y - hgt - 1;
}

function roof(c: Canvas, x: number, w: number, y: number, kind: RoofKind = "main"): number {
  const p = c.p;
  if (kind === "gable") {
    const h = Math.min(18, Math.max(10, Math.round(w * 0.3) + 3));
    return makuti(c, x, w, y, h, 4);
  }
  if (kind === "shed") return makuti(c, x, w, y, 10, 3);
  if (kind === "porch") {
    // 廊顶：一块白灰平板，板下梁头
    p.rect(x - 2, y - 2, w + 4, 3, CL[3]);
    p.hline(x - 2, x + w + 1, y - 2, CL[4]);
    p.hline(x - 2, x + w + 1, y + 1, CL[1]);
    boriti(p, x - 2, w + 4, y + 2, 4);
    c.markRoof(x - 2, y - 2, w + 4, 2, CL, 0);
    return y - 2;
  }
  if (kind === "tower") {
    // 塔顶：白灰的阶梯垛口，一座带瓜棱的小穹顶
    const top = flatRoof(c, x, w, y, 3);
    for (let xx = x; xx < x + w; xx += 4) {
      p.rect(xx, top - 3, 3, 3, CL[3]);
      p.hline(xx, xx + 2, top - 3, CL[4]);
      p.set(xx + 1, top - 4, CL[4]);
    }
    const cx = x + Math.floor(w / 2);
    p.rect(cx - 5, top - 6, 11, 4, CL[3]);
    p.rect(cx - 1, top - 5, 3, 3, c.o.lit ? P.lamp[1] : ink.brown);
    return limeDome(c, cx, top - 7, 5, true);
  }
  const ph = kind === "grand" ? 3 : 4;
  const flat = flatRoof(c, x, w, y, ph);
  let peak = flat;
  if (kind === "grand") {
    // 一排白色的小穹顶与筒拱（正中的一座带瓜棱）
    const n = Math.max(3, Math.floor(w / 13));
    for (let i = 0; i < n; i++) {
      const cx = x + Math.round(((i + 0.5) * w) / n);
      const mid = i === Math.floor(n / 2);
      if (!mid && i % 2 === 1) {
        // 筒拱：一道低低的半圆柱
        p.rect(cx - 4, flat - 3, 9, 3, CL[3]);
        p.hline(cx - 3, cx + 3, flat - 4, CL[4]);
        p.vline(cx + 4, flat - 3, flat - 1, CL[1]);
        c.markRoof(cx - 4, flat - 4, 9, 2, CL, 0);
        continue;
      }
      peak = Math.min(peak, limeDome(c, cx, flat - 1, mid ? 6 : 4, mid));
    }
  } else if (w >= 60) {
    // 宽大的平顶上搭一座椰叶茅草的凉棚（屋顶露台）
    const sw = Math.round(w * 0.32);
    const sx = x + w - sw - 6;
    for (const px of [sx + 1, sx + sw - 3]) {
      p.rect(px, flat - 7, 2, 7, W[1]);
      p.vline(px, flat - 7, flat - 1, W[2]);
    }
    peak = Math.min(peak, makuti(c, sx, sw, flat - 9, 7, 2));
  }
  return peak;
}

// ───────────────────────── 门窗 ─────────────────────────

const winSizes: Record<WinKind, readonly [number, number]> = {
  std: [5, 7],
  tall: [5, 10],
  small: [3, 4],
  round: [7, 7],
  wide: [12, 7],
};

const doorSizes: Record<DoorKind, readonly [number, number]> = {
  std: [8, 13],
  double: [12, 14],
  grand: [14, 16],
  open: [16, 12],
  iron: [12, 14],
  barn: [18, 16],
};

/** 墙上嵌的青花瓷碗：白底、蓝圈、中间一点蓝。 */
function bowl(p: Px, cx: number, cy: number, r = 2): void {
  p.circle(cx, cy, r, BW[3]);
  p.ring(cx, cy, r, r, BW[1]);
  p.set(cx, cy, BW[2]);
  if (r >= 3) p.ring(cx, cy, r - 2, r - 2, BW[2]);
}

function window(c: Canvas, x: number, y: number, kind: WinKind = "std"): void {
  const p = c.p;
  const [w, h] = winSizes[kind];
  const lit = c.o.lit;
  if (kind === "round") {
    // 一只嵌在墙里的大瓷碗
    bowl(p, x + 3, y + 3, 3);
    return;
  }
  if (kind === "small") {
    // 通风小孔
    p.rect(x, y, w, h, lit ? P.lamp[1] : ink.brown);
    p.hline(x - 1, x + w, y + h, CL[4]);
    return;
  }
  // 雕花木框：外圈深木，里面木栅
  p.rect(x - 2, y - 2, w + 4, h + 4, W[1]);
  for (let xx = x - 2; xx < x + w + 2; xx += 2) p.set(xx, y - 2, W[3]);
  p.hline(x - 2, x + w + 1, y - 3, W[2]);
  p.rect(x, y, w, h, lit ? P.lamp[1] : ink.brown);
  if (lit) p.rect(x + 1, y + 1, w - 2, h - 2, P.lamp[2]);
  for (let xx = x + 1; xx < x + w; xx += 2) p.vline(xx, y, y + h - 1, W[2]);
  if (kind === "wide") for (let yy = y + 2; yy < y + h; yy += 3) p.hline(x, x + w - 1, yy, W[2]);
  p.hline(x - 2, x + w + 1, y + h + 2, CL[4]);
  c.ledge(x - 2, x + w + 1, y + h + 2);
}

/** 门两侧的白灰石凳（baraza）。 */
function baraza(c: Canvas, x0: number, x1: number, bottom: number): void {
  const p = c.p;
  for (const [a, b] of [
    [x0 - 8, x0 - 3],
    [x1 + 3, x1 + 8],
  ] as const) {
    p.rect(a, bottom - 4, b - a + 1, 4, CL[3]);
    p.hline(a, b, bottom - 4, CL[4]);
    p.hline(a, b, bottom - 1, CL[1]);
    p.vline(b, bottom - 4, bottom - 1, CL[1]);
    c.ledge(a, b, bottom - 4);
  }
}

function door(c: Canvas, cx: number, bottom: number, kind: DoorKind = "std"): void {
  const p = c.p;
  const [w, h] = doorSizes[kind];
  const x = cx - Math.floor(w / 2);
  const y = bottom - h;
  if (kind !== "barn") baraza(c, x - 2, x + w + 1, bottom);
  if (kind === "open") {
    p.rect(x - 2, y - 2, w + 4, h + 2, W[1]);
    opening(c, x, y, w, h);
    // 半卷的草席门帘
    p.rect(x, y, w, 3, P.straw[2]);
    for (let xx = x; xx < x + w; xx += 2) p.set(xx, y + 1, P.straw[1]);
    return;
  }
  if (kind === "barn") {
    p.rect(x - 1, y - 1, w + 2, h + 1, W[0]);
    for (let xx = x; xx < x + w; xx++) p.vline(xx, y, bottom - 1, (xx - x) % 3 === 0 ? W[1] : W[2]);
    p.vline(cx, y, bottom - 1, W[0]);
    return;
  }
  // 雕花门框：两侧链纹，门楣一道雕带
  const fw = 2;
  p.rect(x - fw, y - 5, w + fw * 2, h + 5, W[2]);
  for (let yy = y - 5; yy < bottom; yy++) {
    p.set(x - fw, yy, (yy - y) % 2 ? W[3] : W[1]);
    p.set(x + w + fw - 1, yy, (yy - y) % 2 ? W[1] : W[0]);
  }
  for (let xx = x - fw; xx < x + w + fw; xx++) {
    p.set(xx, y - 5, W[3]);
    p.set(xx, y - 4, (xx - x) % 3 === 0 ? W[4] : W[2]);
    p.set(xx, y - 3, (xx - x) % 3 === 1 ? W[1] : W[3]);
    p.set(xx, y - 2, (xx - x) % 2 ? W[1] : W[2]);
  }
  if (kind === "grand") {
    // 门楣上的莲花冠饰与一只瓷碗
    p.stamp(["..a..", ".aba.", "aabaa"], { a: W[2], b: W[4] }, cx - 2, y - 8);
    bowl(p, cx, y - 11, 2);
  }
  // 门扇：深色柚木，正中立柱，钉满铜钉
  const leaf = kind === "iron" ? P.iron : W;
  p.rect(x, y, w, h, leaf[1]);
  p.vline(x, y, bottom - 1, leaf[2]);
  p.rect(cx - 1, y, 2, h, leaf[2]);
  p.vline(cx - 1, y, bottom - 1, leaf[3]);
  for (let yy = y + 2; yy < bottom - 1; yy += 3) {
    for (let xx = x + 1; xx < x + w - 1; xx += 2) {
      if (xx === cx - 1 || xx === cx) continue;
      p.set(xx, yy, P.gold[3]);
    }
  }
}

/** 招牌：铜边的柚木板。 */
function sign(c: Canvas, cx: number, y: number, fac: Facility): number {
  const p = c.p;
  const x = cx - 7;
  p.rect(x, y, 15, 13, P.gold[1]);
  p.hline(x, x + 14, y, P.gold[3]);
  p.rect(x + 1, y + 1, 13, 11, W[1]);
  for (let xx = x + 1; xx < x + 14; xx += 2) p.set(xx, y + 1, W[3]);
  p.rect(x + 2, y + 2, 11, 9, ink.brown);
  drawEmblem(p, fac, x + 3, y + 2, swahili.flag);
  c.ledge(x, x + 14, y);
  return 13;
}

// ───────────────────────── 墙 ─────────────────────────

/** 泥篱墙：土色泥面，零星剥落处露出交叉的枝条。 */
function daub(c: Canvas, x: number, y: number, w: number, h: number): void {
  const p = c.p;
  p.rect(x, y, w, h, MUD[3]);
  for (let i = 0; i < Math.floor((w * h) / 70); i++) {
    const sx = x + 1 + Math.floor(h01(i, c.seed, 1) * Math.max(1, w - 6));
    const sy = y + 1 + Math.floor(h01(i, c.seed, 2) * Math.max(1, h - 5));
    p.rect(sx, sy, 4, 3, MUD[1]);
    p.line(sx, sy, sx + 3, sy + 2, W[2]);
    p.line(sx + 3, sy, sx, sy + 2, W[2]);
  }
  p.hline(x, x + w - 1, y + h - 1, MUD[2]);
}

function wall(c: Canvas, x: number, y: number, w: number, h: number, kind: WallKind = "main"): void {
  const p = c.p;
  if (kind === "stone") {
    // 露出的珊瑚石块
    ashlar(p, x, y, w, h, CR, { course: 4, min: 4, max: 9, seed: c.seed + x, light: 2 });
    for (let i = 0; i < Math.floor((w * h) / 25); i++) {
      const sx = x + Math.floor(h01(i, c.seed, 7) * w);
      const sy = y + Math.floor(h01(i, c.seed, 8) * h);
      if (p.get(sx, sy)) p.set(sx, sy, CR[1]);
    }
    p.vline(x, y, y + h - 1, CR[4]);
    p.vline(x + w - 1, y, y + h - 1, CR[1]);
    return;
  }
  if (kind === "plain") {
    daub(c, x, y, w, h);
    p.vline(x, y, y + h - 1, W[1]);
    p.vline(x + w - 1, y, y + h - 1, W[0]);
    return;
  }
  // 抹白灰的珊瑚石墙：边角圆润，墙脚溅着一圈旧痕
  plaster(p, x, y, w, h, CL, c.seed + x + y);
  p.vline(x, y, y + h - 1, CL[4]);
  p.vline(x + w - 1, y, y + h - 1, CL[1]);
  p.vline(x + w - 2, y, y + h - 1, CL[2]);
  if (kind === "upper") {
    // 墙顶一排通风小孔
    for (let xx = x + 4; xx < x + w - 3; xx += 5) p.rect(xx, y + 1, 1, 2, ink.brown);
  } else if (kind === "ground") {
    // 墙脚一段剥落、露出珊瑚石
    const bh = 3;
    ashlar(p, x, y + h - bh, w, bh, CR, { course: bh, min: 4, max: 7, seed: c.seed + 3, light: 2 });
  }
}

export const swahili: Kit = {
  style: "swahili",
  flag: [P.cloth.crimson[0], P.cloth.crimson[1], P.cloth.crimson[2]],
  trim: W,
  plinthH: 2,
  awning: [P.cloth.ochre, P.cloth.cream],
  lamp: "brass",
  tavernRoof: "gable",
  wall,
  plinth(c, x, w, h) {
    const p = c.p;
    const g = c.gy;
    ashlar(p, x, g - h, w, h, CR, { course: Math.max(2, h), min: 6, max: 12, seed: c.seed + 13, light: 2 });
    p.hline(x, x + w - 1, g - h, CR[4]);
  },
  roof,
  band(c, x, w, y) {
    const p = c.p;
    p.hline(x - 1, x + w, y, CL[4]);
    p.hline(x - 1, x + w, y + 1, CL[2]);
    boriti(p, x, w, y + 2, 6);
  },
  post(c, x, y0, y1, kind = "post") {
    const p = c.p;
    if (kind === "column") {
      // 八角的白灰柱
      p.rect(x, y0, 3, y1 - y0 + 1, CL[3]);
      p.vline(x, y0, y1, CL[4]);
      p.vline(x + 2, y0, y1, CL[1]);
      p.rect(x - 1, y0, 5, 2, CL[3]);
      p.hline(x - 1, x + 3, y0 + 1, CL[1]);
      p.rect(x - 1, y1 - 1, 5, 2, CL[2]);
      return 3;
    }
    // 红树林木杆
    p.rect(x, y0, 2, y1 - y0 + 1, W[1]);
    p.vline(x, y0, y1, W[2]);
    for (let yy = y0 + 4; yy < y1; yy += 7) p.set(x + 1, yy, W[3]);
    return 2;
  },
  winSize: (kind = "std") => winSizes[kind],
  window,
  doorSize: (kind = "std") => doorSizes[kind],
  door,
  sign,
  decor(c, x, w, y) {
    const p = c.p;
    // 墙上高处嵌两只青花瓷碗，墙角一盏铜油灯
    bowl(p, x + 6, y + 4, 2);
    bowl(p, x + w - 7, y + 4, 2);
    wallLamp(c, x + w - 1, y + 9, "brass", 1);
  },
};

// ───────────────────────── 地标：柱墓与小清真寺 ─────────────────────────

/** 椰子树：弯弯的树干，顶上一簇下垂的羽叶。底在 g。 */
function palm(p: Px, x: number, g: number, h: number, lean: 1 | -1, season: number): void {
  for (let k = 0; k < h; k++) {
    const dx = Math.round(lean * (k / h) ** 2 * 5);
    p.set(x + dx, g - 1 - k, k % 3 === 0 ? W[1] : W[2]);
    p.set(x + dx + 1, g - 1 - k, W[1]);
  }
  const tx = x + lean * 5;
  const ty = g - h;
  const leaf = season === 3 ? P.leaf[1] : P.leaf[2];
  for (const [dx, dy] of [
    [-8, 4],
    [8, 4],
    [-7, 0],
    [7, 0],
    [-3, -4],
    [4, -4],
  ] as const) {
    const mx = tx + Math.round(dx * 0.55);
    const my = ty + Math.min(0, dy) - 2;
    p.line(tx, ty, mx, my, leaf);
    p.line(mx, my, tx + dx, ty + dy, P.leaf[1]);
    p.line(tx, ty + 1, mx, my + 1, P.leaf[1]);
  }
  p.set(tx, ty + 1, P.wood[1]).set(tx - 1, ty + 2, P.leaf[3]).set(tx + 1, ty + 2, P.gold[2]);
}

function landmark(c: Canvas): void {
  const p = c.p;
  const g = c.gy;
  // 柱墓：墓围的矮墙（凹格嵌板、阶梯垛），后墙正中立起一根嵌瓷碗的高柱
  const tx = 44;
  const tw = 46;
  const pcx = tx + Math.floor(tw / 2);
  // 柱身：粗壮、略收分的八角柱（左亮右暗，棱线分出各面），顶上一圈线脚与圆顶
  const ptop = g - 92;
  for (let yy = ptop; yy < g - 14; yy++) {
    const t = (yy - ptop) / (g - 14 - ptop);
    const hw = Math.round(6 + t * 2);
    for (let xx = pcx - hw; xx <= pcx + hw; xx++) {
      const u = (xx - pcx) / hw;
      p.set(xx, yy, u < -0.55 ? CL[4] : u < 0.1 ? CL[3] : u < 0.6 ? CL[2] : CL[1]);
    }
    p.set(pcx - Math.round(hw * 0.55), yy, CL[2]);
    p.set(pcx + Math.round(hw * 0.6), yy, CL[1]);
  }
  for (const yy of [ptop + 4, ptop + 24, g - 38]) {
    p.hline(pcx - 8, pcx + 8, yy, CL[4]);
    p.hline(pcx - 8, pcx + 8, yy + 1, CL[1]);
  }
  // 柱上一圈圈嵌着的青花瓷碗
  for (let i = 0; i < 3; i++) bowl(p, pcx, ptop + 9 + i * 5, 2);
  for (const dx of [-4, 4]) bowl(p, pcx + dx, ptop + 14, 1);
  for (const dx of [-4, 0, 4]) bowl(p, pcx + dx, ptop + 30, 1);
  bowl(p, pcx, g - 46, 2);
  // 柱顶：一圈挑出的线脚，上面一只小圆顶与尖
  p.rect(pcx - 8, ptop - 3, 17, 3, CL[3]);
  p.hline(pcx - 8, pcx + 8, ptop - 3, CL[4]);
  p.hline(pcx - 7, pcx + 7, ptop, CL[1]);
  limeDome(c, pcx, ptop - 4, 6, true);
  // 墓围
  const et = g - 16;
  plaster(p, tx, et, tw, 16, CL, 9);
  p.vline(tx, et, g - 1, CL[4]);
  p.vline(tx + tw - 1, et, g - 1, CL[1]);
  for (let i = 0; i < 4; i++) {
    const nx = tx + 3 + i * 11;
    p.rect(nx, et + 4, 7, 8, CL[2]);
    p.rect(nx + 1, et + 5, 5, 6, CL[1]);
    p.hline(nx, nx + 6, et + 4, CL[0]);
    if (i === 1 || i === 2) bowl(p, nx + 3, et + 8, 1);
  }
  for (let xx = tx; xx < tx + tw; xx += 4) {
    p.rect(xx, et - 3, 3, 3, CL[3]);
    p.hline(xx, xx + 2, et - 3, CL[4]);
    p.set(xx + 1, et - 4, CL[4]);
  }
  c.ledge(tx, tx + tw - 1, et - 3);
  // 小清真寺：平顶，一排白色小穹顶，正面尖拱廊（没有宣礼塔）
  const mx = 2;
  const mw = 40;
  const mt = g - 26;
  plaster(p, mx, mt, mw, 26, CL, 5);
  p.vline(mx, mt, g - 1, CL[4]);
  p.vline(mx + mw - 1, mt, g - 1, CL[1]);
  for (let i = 0; i < 3; i++) {
    const ax = mx + 4 + i * 12;
    for (let row = 0; row < 16; row++) {
      const k = row < 4 ? 4 - row : 0;
      p.hline(ax + Math.max(0, k - 1), ax + 7 - Math.max(0, k - 1), g - 16 + row, c.o.lit && i === 1 ? P.lamp[1] : ink.brown);
    }
    p.hline(ax - 1, ax + 8, g - 17, CL[4]);
  }
  roof(c, mx, mw, mt, "grand");
  steps(c, mx + mw / 2, 12, 2, g, CR);
  // 椰子树
  palm(p, 88, g, 64, -1, c.o.season);
  palm(p, 6, g - 20, 40, 1, c.o.season);
}

// ───────────────────────── 城门与城墙 ─────────────────────────

/** 白灰的阶梯小垛（三级）。 */
function stepMerlon(p: Px, x: number, top: number): void {
  p.rect(x, top - 2, 5, 2, CL[3]);
  p.hline(x + 1, x + 3, top - 3, CL[3]);
  p.set(x + 2, top - 4, CL[4]);
  p.hline(x, x + 4, top - 2, CL[4]);
}

/** 墙台上的椰叶茅草瞭望棚：四根木杆、草顶。 */
function lookoutHut(c: Canvas, x: number, w: number, base: number): number {
  const p = c.p;
  for (const px of [x + 1, x + w - 3]) {
    p.rect(px, base - 9, 2, 9, W[1]);
    p.vline(px, base - 9, base - 1, W[2]);
  }
  p.hline(x, x + w - 1, base - 4, W[2]);
  return makuti(c, x, w, base - 10, 9, 3);
}

function gate(c: Canvas): void {
  const p = c.p;
  const g = c.gy;
  const cx = Math.floor(c.w / 2);
  const bw = 58;
  const x = cx - bw / 2;
  const top = g - 40;
  plaster(p, x, top, bw, 40, CL, 3);
  ashlar(p, x, g - 8, bw, 8, CR, { course: 4, min: 5, max: 9, seed: 7, light: 2 });
  p.vline(x, top, g - 1, CL[4]);
  p.vline(x + bw - 1, top, g - 1, CL[1]);
  boriti(p, x, bw, top + 3);
  for (let xx = x; xx < x + bw - 3; xx += 6) stepMerlon(p, xx, top);
  // 尖拱门洞，里面是一扇雕花大门（敞开一半）
  const aw = 20;
  const ah = 30;
  for (let row = 0; row < ah + 3; row++) {
    const k = row < 9 ? Math.round((9 - row) * 0.95) : 0;
    p.hline(cx - aw / 2 - 2 + k, cx + aw / 2 + 1 - k, g - ah - 3 + row, CL[4]);
  }
  for (let row = 0; row < ah; row++) {
    const k = row < 8 ? Math.round((8 - row) * 0.95) : 0;
    p.hline(cx - aw / 2 + k, cx + aw / 2 - 1 - k, g - ah + row, ink.brown);
  }
  // 半开的雕花门：左扇正面、右扇敞开
  const dx = cx - aw / 2 + 1;
  p.rect(dx, g - 22, 8, 22, W[1]);
  p.vline(dx, g - 22, g - 1, W[2]);
  for (let yy = g - 20; yy < g - 1; yy += 3) for (let xx = dx + 1; xx < dx + 7; xx += 2) p.set(xx, yy, P.gold[3]);
  p.rect(cx + aw / 2 - 3, g - 22, 2, 22, W[0]);
  for (const sx of [cx - 9, cx + 9]) bowl(p, sx, g - ah - 7, 2);
  swahili.sign(c, cx, top + 6, "office");
  // 两侧方墙台，台上茅草瞭望棚
  for (const tx of [x - 14, x + bw - 2]) {
    const tt = g - 50;
    plaster(p, tx, tt, 16, 50, CL, tx);
    ashlar(p, tx, g - 8, 16, 8, CR, { course: 4, min: 4, max: 7, seed: tx, light: 2 });
    p.vline(tx, tt, g - 1, CL[4]);
    p.vline(tx + 15, tt, g - 1, CL[1]);
    p.rect(tx + 7, tt + 14, 2, 5, ink.deep);
    boriti(p, tx, 16, tt + 2, 4);
    lookoutHut(c, tx + 2, 12, tt);
  }
}

function wallBody(c: Canvas, W: number, top: number): void {
  const p = c.p;
  const H = c.gy;
  // 白灰墙面（按宽度取模的旧痕）与墙脚露出的珊瑚石
  p.rect(0, top, W, H - top, CL[3]);
  for (let i = 0; i < Math.floor((W * (H - top)) / 90); i++) {
    const x = Math.floor(h01(i, c.seed, 1) * W);
    const y = top + 4 + Math.floor(h01(i, c.seed, 2) * (H - top - 14));
    p.put(x, y, CL[2]);
    p.put((x + 1) % W, y, CL[2]);
  }
  wrapCourses(p, W, H - 10, 10, CR, 5, 5, 10, c.seed, 2);
  for (let x = 0; x < W; x++) {
    p.put(x, top, CL[4]);
    p.put(x, top + 1, CL[2]);
  }
  for (const x of spots(W, 7)) wrap(W, (dx) => stepMerlon(p, x + dx, top));
  for (const x of spots(W, 6)) wrap(W, (dx) => boriti(p, x + dx, 5, top + 3, 5));
  for (const x of spots(W, 20)) wrap(W, (dx) => p.rect(x + dx + 10, top + 9, 2, 3, ink.deep));
}

function wallTower(c: Canvas, x: number, top: number): void {
  const p = c.p;
  const H = c.gy;
  const t = top - 6;
  plaster(p, x, t, 16, H - t, CL, x);
  ashlar(p, x, H - 10, 16, 10, CR, { course: 5, min: 4, max: 7, seed: x, light: 2 });
  p.vline(x, t, H - 1, CL[4]);
  p.vline(x + 15, t, H - 1, CL[1]);
  p.rect(x + 7, t + 8, 2, 4, ink.deep);
  lookoutHut(c, x + 2, 12, t);
  tintOpaque(p, x, t, 16, 1, overlay.shadowLight);
}

// ───────────────────────── 远景 ─────────────────────────

function farPalm(k: FarCtx, x: number, h: number, lean: 1 | -1): void {
  const p = k.p;
  const b = k.base;
  for (let i = 0; i < h; i++) {
    const dx = Math.round(lean * (i / h) ** 2 * 3);
    p.set(x + dx, b - 1 - i, MK[1]);
  }
  const tx = x + lean * 3;
  const ty = b - h;
  for (const [dx, dy] of [
    [-5, 3],
    [5, 3],
    [-4, 0],
    [4, 0],
    [0, -2],
  ] as const) {
    const mx = tx + Math.round(dx * 0.6);
    const my = ty + Math.min(0, dy) - 1;
    p.line(tx, ty, mx, my, P.leaf[1]);
    p.line(mx, my, tx + dx, ty + dy, P.leaf[1]);
  }
}

function farHouse(k: FarCtx, x: number, w: number, h: number, seed: number): void {
  const p = k.p;
  const b = k.base;
  const f = k.f;
  const wallTop = b - h;
  if (h01(seed, 4, 5) < 0.3) {
    // 茅草小屋
    p.rect(x + 1, b - Math.min(h, 8), w - 2, Math.min(h, 8), MUD[2]);
    const rh = Math.max(4, Math.round(w * 0.5));
    const top = b - Math.min(h, 8);
    for (let xx = x - 2; xx <= x + w + 1; xx++) {
      const d = Math.min(xx - x + 2, x + w + 1 - xx);
      const t = Math.min(1, d / Math.max(1, rh * 0.8));
      p.vline(xx, top - Math.round(t * rh), top + 1, xx > x + w / 2 ? MK[1] : MK[2]);
    }
    k.roofs.push([x - 2, top - rh, w + 4, rh + 1]);
    if (h01(seed, 6, 5) < 0.5) farPalm(k, x + w + 2, 14 + Math.floor(h01(seed, 8, 5) * 8), 1);
    return;
  }
  // 白色的平顶屋：女儿墙、梁头
  p.rect(x, wallTop, w, h, f.wall[2]);
  p.vline(x + w - 1, wallTop, b - 1, f.wall[0]);
  p.vline(x, wallTop, b - 1, f.wall[2]);
  farWindows(k, x, wallTop + 3, w, h - 3, seed);
  p.hline(x - 1, x + w, wallTop, f.wall[2]);
  for (let xx = x + 1; xx < x + w - 1; xx += 3) p.set(xx, wallTop + 2, W[1]);
  if (h01(seed, 2, 5) < 0.3 && w > 12) {
    // 屋顶上的小穹顶
    const cx = x + Math.floor(w / 2);
    p.ellipse(cx, wallTop, 3, 3, f.wall[2]);
    p.rect(cx - 4, wallTop + 1, 9, 2, f.wall[2]);
    k.roofs.push([cx - 3, wallTop - 3, 7, 3]);
  }
  k.roofs.push([x - 1, wallTop, w + 2, 1]);
}

function farTower(k: FarCtx, x: number, seed: number): number {
  const p = k.p;
  const b = k.base;
  const f = k.f;
  // 柱墓：墓围与高柱，旁边两棵椰子树
  p.rect(x, b - 6, 14, 6, f.wall[2]);
  for (let xx = x; xx < x + 14; xx += 3) p.set(xx + 1, b - 7, f.wall[2]);
  const cx = x + 7;
  const tall = 26 + Math.floor(h01(seed, 9, 1) * 10);
  p.rect(cx - 2, b - tall, 5, tall - 6, f.wall[2]);
  p.vline(cx + 2, b - tall, b - 7, f.wall[0]);
  p.hline(cx - 3, cx + 3, b - tall, f.wall[2]);
  p.set(cx, b - tall - 1, f.wall[2]);
  p.set(cx, b - tall + 5, f.accent[1]).set(cx, b - tall + 8, f.accent[1]);
  k.roofs.push([cx - 3, b - tall - 1, 7, 2]);
  farPalm(k, x + 17, 22, -1);
  farPalm(k, x + 22, 16, 1);
  return 26;
}

function farWall(k: FarCtx, top: number): void {
  const p = k.p;
  const W = k.W;
  p.rect(0, top, W, 8, CL[3]);
  p.rect(0, top + 5, W, 3, CR[2]);
  p.hline(0, W - 1, top, CL[4]);
  const n = Math.max(1, Math.round(W / 6));
  for (let j = 0; j < n; j++) {
    const mx = Math.round((j * W) / n);
    p.rect(mx, top - 2, 3, 2, CL[3]);
    p.set(mx + 1, top - 3, CL[4]);
    p.put(mx + 1, top + 2, P.wood[1]);
  }
}

// ───────────────────────── 街道小物件 ─────────────────────────

/** 灯龛：一根白灰小柱，顶上的龛里点着油灯。 */
function lamp(c: Canvas): void {
  const p = c.p;
  const g = c.gy;
  const lit = c.o.lit;
  p.rect(3, g - 3, 9, 3, CR[2]);
  p.hline(3, 11, g - 3, CR[3]);
  p.rect(4, g - 22, 7, 19, CL[3]);
  p.vline(4, g - 22, g - 4, CL[4]);
  p.vline(10, g - 22, g - 4, CL[1]);
  // 龛
  p.rect(5, g - 20, 5, 6, lit ? P.lamp[1] : ink.brown);
  p.set(5, g - 20, CL[3]).set(9, g - 20, CL[3]);
  p.rect(6, g - 16, 3, 2, P.gold[1]);
  p.set(7, g - 17, lit ? P.lamp[2] : P.red[3]);
  p.hline(3, 11, g - 23, CL[4]);
  p.set(7, g - 24, CL[3]);
  bowl(p, 7, g - 9, 1);
  if (lit) tintOpaque(p, 1, g - 26, 13, 14, overlay.glow, 2);
}

/** 珊瑚石井栏：白灰方井口，口沿上放一只陶水罐，一根绳子垂下去。 */
function well(c: Canvas): void {
  const p = c.p;
  const g = c.gy;
  plaster(p, 2, g - 9, 18, 9, CL, 3);
  ashlar(p, 2, g - 3, 18, 3, CR, { course: 3, min: 4, max: 6, seed: 4, light: 2 });
  p.hline(1, 20, g - 10, CL[4]);
  p.hline(1, 20, g - 9, CL[2]);
  p.vline(20, g - 9, g - 1, CL[1]);
  // 陶罐
  p.rect(13, g - 15, 5, 5, P.brick[2]);
  p.hline(14, 16, g - 16, P.brick[1]);
  p.vline(13, g - 14, g - 11, P.brick[3]);
  // 绳与木桶
  p.vline(7, g - 18, g - 10, P.straw[1]);
  p.line(4, g - 19, 10, g - 19, W[2]);
  p.vline(4, g - 19, g - 11, W[1]);
}

/** 石凳上铺一张彩色草席。 */
function bench(p: Px): void {
  const g = p.h;
  p.rect(1, g - 5, 16, 5, CL[3]);
  p.hline(1, 16, g - 5, CL[4]);
  p.vline(16, g - 5, g - 1, CL[1]);
  for (let x = 2; x < 15; x++) p.set(x, g - 6, x % 4 < 2 ? P.cloth.ochre[2] : x % 4 === 2 ? P.red[2] : P.straw[3]);
}

/** 手推车：装椰子，或是一捆红树林木杆。 */
function cart(p: Px, v: number): void {
  const g = p.h;
  p.rect(3, g - 10, 18, 4, W[2]);
  p.hline(3, 20, g - 10, W[3]);
  p.hline(3, 20, g - 7, W[1]);
  p.line(21, g - 8, 26, g - 5, W[1]);
  p.vline(24, g - 5, g - 1, W[1]);
  if (v % 2 === 0) {
    for (let i = 0; i < 6; i++) {
      const x = 5 + (i % 4) * 4 + (i >= 4 ? 2 : 0);
      const y = i >= 4 ? g - 15 : g - 12;
      p.circle(x, y, 2, P.leaf[1]);
      p.set(x - 1, y - 1, P.leaf[3]);
      p.set(x + 1, y + 1, P.wood[1]);
    }
  } else {
    for (let i = 0; i < 4; i++) {
      p.hline(2, 24, g - 11 - i * 2, i % 2 ? W[1] : W[2]);
      p.set(2, g - 11 - i * 2, W[3]);
    }
    p.vline(9, g - 17, g - 10, P.straw[1]);
    p.vline(17, g - 17, g - 10, P.straw[1]);
  }
  p.ring(8, g - 5, 4, 4, W[1]);
  p.ring(8, g - 5, 3, 3, W[3]);
  p.line(5, g - 5, 11, g - 5, W[2]);
  p.ring(17, g - 5, 4, 4, W[1]);
  p.ring(17, g - 5, 3, 3, W[3]);
  p.line(14, g - 5, 20, g - 5, W[2]);
}

export const SWAHILI: CultureArt = {
  kit: swahili,
  landmark,
  gate,
  wallBody,
  wallTower,
  far: { roof: [MK[1], MK[2], MK[3]], wall: [CL[1], CL[2], CL[3]], accent: [BW[0], BW[1], BW[2]] },
  farHouse,
  farTower,
  farWall,
  props: {
    flag: [P.cloth.crimson[0], P.cloth.crimson[1], P.cloth.crimson[2]],
    stall: [P.cloth.ochre, P.cloth.cream],
    lamp,
    well,
    bench,
    cart,
  },
};
