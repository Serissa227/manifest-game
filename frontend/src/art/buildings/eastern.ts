// 东方风格（eastern）：白粉墙、深色木梁、翠绿琉璃瓦的翘角屋檐、圆窗与格栅、朱漆大门、红灯笼。
import type { Facility } from "../../store/game";
import { P, ink } from "../palette";
import { drawEmblem } from "./emblems";
import { type Canvas, type Ramp, ashlar, fillProfile, hipProfile, plaster } from "./kit";
import { lantern, opening } from "./parts";
import { type DoorKind, type Kit, type RoofKind, type WallKind, type WinKind, eaveShadow, pickTone } from "./style";

const JADE: Ramp = P.jade;
const J = JADE;
/** 民居的青灰瓦。 */
const GRAY: Ramp = P.stone;
const W = P.wood;
const R = P.red;

/** 一层翘角琉璃瓦檐：墙 x..x+w-1、墙顶 y、坡高 h、出檐 over；返回屋脊顶行的 y。 */
export function tier(c: Canvas, x: number, w: number, y: number, h: number, over: number, orn: number, J = JADE, RJ = J): number {
  const p = c.p;
  const x0 = x - over;
  const x1 = x + w - 1 + over;
  const yb = y + 1;
  const yt = yb - h + 1;
  const inset = Math.min(Math.floor((x1 - x0) / 2) - 2, Math.round(h * 1.2) + 2);
  const base = hipProfile(x0, x1, yt, yb, inset, 1.8, 2);
  const lifts = [3, 2, 1, 1];
  const prof = (xx: number) => {
    const r = base(xx);
    if (!r) return null;
    const d = Math.min(xx - x0, x1 - xx);
    const lift = d < lifts.length ? lifts[d] : 0;
    return [r[0] - lift, r[1] - lift] as const;
  };
  const mid = (x0 + x1) / 2;
  fillProfile(p, x0, x1, prof, (xx, _yy, e) => {
    const d = Math.min(xx - x0, x1 - xx);
    const ph = (xx - x0) % 3;
    // 檐口一排瓦当
    if (e.fromBot === 0) return ph === 1 ? J[4] : J[1];
    // 坡面边缘：左亮右暗
    if (e.fromTop === 0 && d < inset) return xx < mid ? J[4] : J[2];
    if (e.fromTop === 0) return J[3];
    let col: string = ph === 1 ? J[3] : ph === 2 ? J[2] : J[1];
    // 右侧坡面整体压暗一阶，左侧提亮一阶，做出体积
    if (d < inset && xx > mid && col !== J[1]) col = col === J[3] ? J[2] : J[1];
    if (d < inset && xx < mid && e.fromTop === 1) col = J[4];
    return col;
  });
  // 屋脊：两行，上亮下暗；两端上卷的脊饰
  const rx0 = x0 + inset - 1;
  const rx1 = x1 - inset + 1;
  p.hline(rx0, rx1, yt - 1, RJ[1]);
  p.hline(rx0, rx1, yt - 2, RJ[2]);
  p.hline(rx0 + 2, Math.floor(mid), yt - 2, RJ[3]);
  for (const [ex, dir] of [
    [rx0, 1],
    [rx1, -1],
  ] as const) {
    p.vline(ex, yt - 2 - orn, yt - 1, RJ[1]);
    p.vline(ex + dir, yt - 2 - orn, yt - 1 - orn, RJ[3]);
    p.set(ex - dir, yt - 2 - orn, RJ[3]);
    p.set(ex, yt - 2 - orn, RJ[4]);
  }
  c.markRoof(x0, yt - 2, x1 - x0 + 1, yb - yt + 3, J, 1);
  if (RJ !== J) c.markRoof(x0, yt - 2 - orn, x1 - x0 + 1, orn + 2, RJ, 0);
  c.eave(x0 + 3, x1 - 3, yb);
  return yt - 2;
}

/** 檐下彩绘斗拱：一行深木、一行红绿相间的拱头，下面一道阴影。 */
export function brackets(c: Canvas, x: number, w: number, y: number): void {
  const p = c.p;
  p.hline(x, x + w - 1, y, W[0]);
  for (let i = 0; i < w; i++) {
    const ph = i % 4;
    p.set(x + i, y + 1, ph === 1 ? R[2] : ph === 3 ? J[2] : W[1]);
  }
  eaveShadow(c, x, w, y + 2, 1);
}

/** 屋脊正中的金珠（可带一根宝顶尖）。 */
export function pearl(c: Canvas, cx: number, ridge: number, spire: boolean): number {
  const p = c.p;
  p.circle(cx, ridge - 2, 1, P.gold[2]);
  p.set(cx - 1, ridge - 3, P.gold[4]);
  p.vline(cx, ridge - 1, ridge, P.gold[1]);
  if (!spire) return ridge - 3;
  p.vline(cx, ridge - 8, ridge - 4, P.gold[2]);
  p.vline(cx + 1, ridge - 6, ridge - 4, P.gold[1]);
  p.set(cx, ridge - 9, P.gold[4]);
  return ridge - 9;
}

/** 翘角琉璃瓦屋顶。y 为墙顶；返回最高点。塔顶是两重檐的小楼阁。 */
function roof(c: Canvas, x: number, w: number, y: number, kind: RoofKind = "main"): number {
  const p = c.p;
  if (kind === "tower") {
    const r1 = tier(c, x, w, y, 7, 4, 2);
    brackets(c, x, w, y + 2);
    // 上层小阁：白墙木柱，一扇圆窗
    const ux = x + 4;
    const uw = w - 8;
    const uy = r1 - 5;
    plaster(p, ux, uy, uw, r1 - uy + 3, P.plaster, 17);
    p.rect(ux, uy, 2, r1 - uy + 3, W[1]);
    p.rect(ux + uw - 2, uy, 2, r1 - uy + 3, W[0]);
    p.hline(ux, ux + uw - 1, uy + 5, W[1]);
    const r2 = tier(c, ux, uw, uy, 7, 5, 2);
    brackets(c, ux, uw, uy + 2);
    return Math.min(r2 - 4, pearl(c, x + Math.floor(w / 2), r2, true));
  }
  const over = kind === "porch" ? 3 : kind === "gable" ? 4 : 6;
  const h = kind === "porch" ? 6 : Math.min(14, Math.max(9, Math.round(w * 0.12) + 4));
  const orn = kind === "porch" ? 2 : 3;
  // gable：民居常用的青灰瓦顶，只在屋脊上留一道翠绿
  const ridge = tier(c, x, w, y, h, over, orn, kind === "gable" ? GRAY : JADE, JADE);
  let peak = ridge - orn;
  if (kind !== "shed") brackets(c, x, w, y + 2);
  if (kind === "grand") peak = Math.min(peak, pearl(c, x + Math.floor(w / 2), ridge, false));
  return peak;
}

/** 格栅窗：深木框、窗纸（夜里透出暖光）、方格棂条。 */
export function lattice(c: Canvas, x: number, y: number, w: number, h: number): void {
  const p = c.p;
  const lit = c.o.lit;
  p.rect(x, y, w, h, W[0]);
  p.rect(x + 1, y + 1, w - 2, h - 2, lit ? P.lamp[1] : P.parchment);
  if (lit) p.rect(x + 2, y + 2, w - 4, h - 4, P.lamp[2]);
  else p.hline(x + 1, x + w - 2, y + 1, P.parchmentDark);
  const bar = lit ? W[1] : W[1];
  for (let i = x + 3; i < x + w - 2; i += 3) p.vline(i, y + 1, y + h - 2, bar);
  for (let j = y + 3; j < y + h - 2; j += 3) p.hline(x + 1, x + w - 2, j, bar);
}

function roundWindow(c: Canvas, cx: number, cy: number, r: number): void {
  const p = c.p;
  const lit = c.o.lit;
  p.circle(cx, cy, r, W[0]);
  p.circle(cx, cy, r - 1, lit ? P.lamp[1] : P.parchment);
  if (lit) p.circle(cx, cy, r - 2, P.lamp[2]);
  p.vline(cx, cy - r + 1, cy + r - 1, W[1]);
  p.hline(cx - r + 1, cx + r - 1, cy, W[1]);
  if (r >= 4) {
    p.ring(cx, cy, r - 2, r - 2, W[1]);
  }
  // 窗框左上受光
  p.set(cx - r + 1, cy - r + 1, P.plaster[1]);
}

const winSizes: Record<WinKind, readonly [number, number]> = {
  std: [8, 8],
  tall: [8, 11],
  small: [5, 5],
  round: [9, 9],
  wide: [14, 8],
};

const doorSizes: Record<DoorKind, readonly [number, number]> = {
  std: [8, 12],
  double: [12, 13],
  grand: [14, 15],
  open: [16, 12],
  iron: [12, 13],
  barn: [18, 16],
};

/** 朱漆门：门钉成排、铜环一对；iron 为包铁的黑漆门。 */
function door(c: Canvas, cx: number, bottom: number, kind: DoorKind = "std"): void {
  const p = c.p;
  const [w, h] = doorSizes[kind];
  const x = cx - Math.floor(w / 2);
  const y = bottom - h;
  // 门框与门槛
  p.rect(x - 1, y - 1, w + 2, h + 1, W[0]);
  p.hline(x - 2, x + w + 1, y - 2, W[1]);
  if (kind === "open") {
    opening(c, x, y, w, h);
    return;
  }
  const base = kind === "iron" ? P.iron : kind === "barn" ? W : pickTone(c, [R, W, R]);
  p.rect(x, y, w, h, base[2]);
  p.vline(x, y, bottom - 1, base[3]);
  if (w >= 10) {
    const m = x + Math.floor(w / 2);
    p.vline(m - 1, y, bottom - 1, base[1]);
    p.vline(m, y, bottom - 1, base[3]);
  }
  p.vline(x + w - 1, y, bottom - 1, base[1]);
  p.hline(x, x + w - 1, y, base[1]);
  if (kind === "barn") {
    for (let i = x + 2; i < x + w - 1; i += 3) p.vline(i, y + 1, bottom - 1, W[1]);
    p.line(x + 1, bottom - 2, x + Math.floor(w / 2) - 2, y + 2, W[3]);
    return;
  }
  // 门钉
  const stud = kind === "iron" ? P.iron[3] : P.gold[3];
  for (let j = y + 2; j < bottom - 3; j += 3) {
    for (let i = x + 2; i < x + w - 1; i += 2) {
      if (w >= 10 && (i === x + Math.floor(w / 2) - 1 || i === x + Math.floor(w / 2))) continue;
      p.set(i, j, stud);
    }
  }
  // 铜环
  const m = x + Math.floor(w / 2);
  p.set(m - 2, y + Math.floor(h / 2), P.gold[2]).set(m + 1, y + Math.floor(h / 2), P.gold[2]);
}

/** 横匾：黑漆底、金边、翠绿外框。 */
function sign(c: Canvas, cx: number, y: number, fac: Facility): number {
  const p = c.p;
  const x = cx - 7;
  p.rect(x, y, 15, 13, J[1]);
  p.hline(x, x + 14, y, J[3]);
  p.rect(x + 1, y + 1, 13, 11, P.gold[2]);
  p.hline(x + 1, x + 13, y + 1, P.gold[3]);
  p.rect(x + 2, y + 2, 11, 9, ink.deep);
  drawEmblem(p, fac, x + 3, y + 2, J.slice(1));
  c.ledge(x, x + 14, y);
  return 13;
}

export const eastern: Kit = {
  style: "eastern",
  flag: [J[1], J[2], J[3]],
  trim: W,
  plinthH: 3,
  awning: [R, [P.plaster[1], P.plaster[2], P.plaster[3]]],
  wall(c, x, y, w, h, kind: WallKind = "main") {
    const p = c.p;
    if (kind === "stone") {
      ashlar(p, x, y, w, h, P.stone, { course: 4, min: 6, max: 10, seed: c.seed + x });
      return;
    }
    plaster(p, x, y, w, h, P.plaster, c.seed + x + y);
    if (kind === "plain") {
      // 素墙：下半截青砖
      const bh = Math.min(h, 6);
      ashlar(p, x, y + h - bh, w, bh, P.stone, { course: 2, min: 3, max: 5, seed: c.seed + 9, light: 2 });
    }
    // 墙角木柱（深木，左亮右暗）
    p.rect(x, y, 2, h, W[1]);
    p.vline(x, y, y + h - 1, W[2]);
    p.rect(x + w - 2, y, 2, h, W[0]);
    p.vline(x + w - 2, y, y + h - 1, W[1]);
    if (kind === "ground" || kind === "main") {
      // 下半截木护墙
      p.rect(x + 2, y + h - 3, w - 4, 3, W[1]);
      p.hline(x + 2, x + w - 3, y + h - 3, W[2]);
    }
  },
  plinth(c, x, w, h) {
    const p = c.p;
    const g = c.gy;
    ashlar(p, x, g - h, w, h, P.stone, { course: h, min: 7, max: 12, seed: c.seed + 3 });
    p.hline(x, x + w - 1, g - h, P.stone[4]);
  },
  roof,
  band(c, x, w, y) {
    const p = c.p;
    p.hline(x, x + w - 1, y, W[2]);
    p.hline(x, x + w - 1, y + 1, W[0]);
    // 挂落：小檐一排短椽头
    for (let i = x + 1; i < x + w - 1; i += 3) p.set(i, y + 2, W[1]);
  },
  post(c, x, y0, y1, kind = "post") {
    const p = c.p;
    if (kind === "column") {
      // 朱漆圆柱：石础、柱身三阶、柱头木枋
      p.rect(x, y0, 3, y1 - y0 + 1, R[2]);
      p.vline(x, y0, y1, R[3]);
      p.vline(x + 2, y0, y1, R[1]);
      p.rect(x - 1, y1 - 1, 5, 2, P.stone[3]);
      p.hline(x - 1, x + 3, y1, P.stone[2]);
      p.rect(x - 1, y0, 5, 1, W[0]);
      return 3;
    }
    p.rect(x, y0, 2, y1 - y0 + 1, W[1]);
    p.vline(x, y0, y1, W[2]);
    return 2;
  },
  winSize: (kind = "std") => winSizes[kind],
  window(c, x, y, kind: WinKind = "std") {
    const [w, h] = winSizes[kind];
    if (kind === "round") {
      roundWindow(c, x + 4, y + 4, 4);
      return;
    }
    lattice(c, x, y, w, h);
    // 窗楣：一道深木横枋
    c.p.hline(x - 1, x + w, y - 1, W[1]);
  },
  doorSize: (kind = "std") => doorSizes[kind],
  door,
  sign,
  decor(c, x, w, y) {
    // 屋檐两端挂红灯笼
    lantern(c, x + 3, y + 4, "red");
    lantern(c, x + w - 4, y + 4, "red");
  },
};

