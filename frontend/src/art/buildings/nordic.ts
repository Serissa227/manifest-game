// 北地风格（nordic）：石砌基座、原木墙、陡峭的青灰石板屋顶、烟囱、老虎窗与尖塔；冬季屋顶积雪。
import type { Facility } from "../../store/game";
import { P, ink } from "../palette";
import { drawEmblem } from "./emblems";
import { type Canvas, ashlar, fillProfile, flowerBox, gableFront, h01, hipProfile, logEnds, logs, planks, siding } from "./kit";
import { opening, wallLamp } from "./parts";
import { type DoorKind, type Kit, type RoofKind, type WallKind, type WinKind, eaveShadow, pickTone } from "./style";

const S = P.slate;
const W = P.wood;
const ST = P.stone;

/** 石板瓦纹理：每行 3 像素（两行瓦面 + 一行暗缝），竖缝错开，偶有浅色瓦。 */
export function slateTex(x0: number, inset: number, x1: number) {
  const mid = (x0 + x1) / 2;
  return (xx: number, _yy: number, e: { fromTop: number; fromBot: number; top: number }): string => {
    const d = Math.min(xx - x0, x1 - xx);
    if (e.fromBot === 0) return S[0];
    if (e.fromTop === 0) return d < inset && xx > mid ? S[2] : S[3];
    const course = Math.floor((e.fromBot - 1) / 3);
    const ph = (e.fromBot - 1) % 3;
    if (ph === 0) return S[1];
    const off = course % 2 ? 2 : 0;
    const jx = (xx + off) % 4;
    if (jx === 0) return S[1];
    let col: string = h01(Math.floor((xx + off) / 4), course, 5) < 0.2 ? S[3] : S[2];
    if (jx === 1 && ph === 2) col = S[3];
    // 左坡受光、右坡背光
    if (d < inset && xx < mid && e.fromTop <= 1) col = S[4];
    if (d < inset && xx > mid && col === S[3]) col = S[2];
    return col;
  };
}

/** 石砌烟囱：底在 yb，高 h。 */
export function chimney(c: Canvas, x: number, yb: number, h: number): void {
  const p = c.p;
  ashlar(p, x, yb - h, 5, h, ST, { course: 3, min: 3, max: 5, seed: x });
  p.rect(x - 1, yb - h - 2, 7, 2, ST[3]);
  p.hline(x - 1, x + 5, yb - h - 2, ST[4]);
  p.hline(x - 1, x + 5, yb - h - 1, ST[1]);
  p.rect(x + 1, yb - h - 3, 3, 1, ST[0]);
  c.markRoof(x - 1, yb - h - 3, 7, 2, ST, 0);
}

/** 老虎窗：屋面上凸出的小山墙窗，底在 yb，中心 cx。 */
function dormer(c: Canvas, cx: number, yb: number): void {
  const p = c.p;
  const x = cx - 4;
  p.rect(x, yb - 6, 9, 6, W[2]);
  p.hline(x, x + 8, yb - 6, W[3]);
  p.rect(x + 2, yb - 5, 5, 4, P.plaster[3]);
  if (c.o.lit) p.rect(x + 3, yb - 4, 3, 3, P.lamp[1]);
  else {
    p.rect(x + 3, yb - 4, 3, 3, S[1]);
    p.set(x + 5, yb - 4, S[3]);
  }
  p.hline(x + 1, x + 7, yb - 1, W[1]);
  // 小尖顶
  p.poly(
    [
      [x - 2, yb - 5],
      [cx + 0.5, yb - 13],
      [x + 11, yb - 5],
    ],
    S[2],
  );
  p.line(x - 1, yb - 6, cx, yb - 12, S[3]);
  p.line(cx + 1, yb - 12, x + 9, yb - 6, S[1]);
  p.hline(x - 1, x + 9, yb - 6, S[0]);
  c.markRoof(x - 2, yb - 13, 13, 7, S, 0);
}

/** 陡坡石板顶。y 为墙顶；返回最高点。 */
function roof(c: Canvas, x: number, w: number, y: number, kind: RoofKind = "main"): number {
  const p = c.p;
  if (kind === "tower") {
    // 尖塔：很陡的四棱锥，顶上一面小三角旗
    const x0 = x - 2;
    const x1 = x + w + 1;
    const h = Math.min(28, Math.round(w * 1.5) + 4);
    const yb = y + 1;
    const cx = (x0 + x1) / 2;
    const prof = (xx: number) => {
      if (xx < x0 || xx > x1) return null;
      const d = Math.min(xx - x0, x1 - xx) + 0.5;
      const rise = Math.round((d / ((x1 - x0) / 2)) * h);
      return [yb - rise, yb] as const;
    };
    fillProfile(p, x0, x1, prof, slateTex(x0, 99, x1));
    p.hline(x0, x1, yb, W[1]);
    const top = yb - h;
    const icx = Math.round(cx);
    p.vline(icx, top - 6, top, P.iron[1]);
    p.set(icx, top - 7, P.gold[3]);
    p.rect(icx + 1, top - 6, 4, 2, P.cloth.blue[1]);
    p.set(icx + 5, top - 6, P.cloth.blue[1]);
    c.markRoof(x0, top, x1 - x0 + 1, h + 1, S, 1);
    return top - 7;
  }
  if (kind === "gable") {
    // 朝街的陡峭山墙：原木三角墙、正中一扇小窗、两坡厚石板
    const cx = x + Math.floor(w / 2);
    const hw = Math.floor(w / 2);
    const h = Math.round(hw * 1.25);
    const apex = gableFront(c, cx, y, hw, h, (t) => logs(t, x, y - h, w, h + 1, W, c.seed + 5), [S[0], S[2], S[3]], { thick: 4, over: 3, mark: S });
    const wy = y - Math.round(h * 0.55);
    p.rect(cx - 2, wy, 5, 5, P.plaster[3]);
    p.rect(cx - 1, wy + 1, 3, 3, c.o.lit ? P.lamp[1] : S[1]);
    p.hline(cx - 3, cx + 3, wy + 5, P.plaster[3]);
    c.ledge(cx - 3, cx + 3, wy + 5);
    p.hline(x, x + w - 1, y + 1, W[1]);
    eaveShadow(c, x, w, y + 2, 1);
    return apex;
  }
  const over = kind === "porch" ? 2 : 3;
  const x0 = x - over;
  const x1 = x + w - 1 + over;
  const h = kind === "porch" ? 7 : kind === "shed" ? 12 : Math.min(26, Math.max(13, Math.round(w * 0.3) + 5));
  const yb = y + 1;
  const yt = yb - h + 1;
  const inset = Math.min(Math.floor((x1 - x0) / 2) - 1, Math.round(h * 0.55));
  fillProfile(p, x0, x1, hipProfile(x0, x1, yt, yb, inset, 1, 2), slateTex(x0, inset, x1));
  // 屋脊：一道深色压顶，正式建筑加一排铁花脊饰
  p.hline(x0 + inset - 1, x1 - inset + 1, yt - 1, S[0]);
  p.hline(x0 + inset, x1 - inset, yt - 1, S[1]);
  let peak = yt - 1;
  if (kind === "grand") {
    for (let xx = x0 + inset; xx <= x1 - inset; xx += 3) p.set(xx, yt - 2, P.iron[2]);
    p.vline(x0 + inset - 1, yt - 5, yt - 2, P.iron[1]);
    p.vline(x1 - inset + 1, yt - 5, yt - 2, P.iron[1]);
    p.set(x0 + inset - 1, yt - 6, P.gold[3]).set(x1 - inset + 1, yt - 6, P.gold[3]);
    peak = yt - 6;
  }
  c.markRoof(x0, yt - 1, x1 - x0 + 1, h + 1, S, 1);
  // 檐下：木封檐板与阴影
  p.hline(x, x + w - 1, y + 2, W[1]);
  eaveShadow(c, x, w, y + 3, 1);
  c.eave(x0 + 1, x1 - 1, yb);
  // 大屋顶上开老虎窗、立烟囱
  if (kind === "main" || kind === "grand") {
    if (w >= 50) {
      const n = w >= 80 ? 2 : 1;
      for (let i = 0; i < n; i++) dormer(c, x + Math.round(((i + 0.5) * w) / n) + (n === 1 ? -8 : 0), yb - 3);
    }
    if (w >= 30 && kind === "main") {
      const chx = x + Math.round(w * 0.78);
      const r = hipProfile(x0, x1, yt, yb, inset, 1, 2)(chx);
      chimney(c, chx, (r ? r[0] : yt) + 4, (r ? r[0] - yt : 0) + 9);
      peak = Math.min(peak, yt - 7);
    }
  }
  return peak;
}

const winSizes: Record<WinKind, readonly [number, number]> = {
  std: [6, 8],
  tall: [6, 11],
  small: [4, 5],
  round: [7, 7],
  wide: [12, 8],
};

const doorSizes: Record<DoorKind, readonly [number, number]> = {
  std: [8, 12],
  double: [12, 13],
  grand: [14, 15],
  open: [16, 12],
  iron: [12, 13],
  barn: [18, 17],
};

/** 白框玻璃窗，两侧青灰百叶，窗台积雪。 */
function window(c: Canvas, x: number, y: number, kind: WinKind = "std"): void {
  const p = c.p;
  const [w, h] = winSizes[kind];
  if (kind === "round") {
    p.circle(x + 3, y + 3, 3, P.plaster[3]);
    p.circle(x + 3, y + 3, 2, c.o.lit ? P.lamp[1] : S[1]);
    p.vline(x + 3, y + 1, y + 5, P.plaster[3]);
    p.hline(x + 1, x + 5, y + 3, P.plaster[3]);
    return;
  }
  // 石窗楣
  p.rect(x - 1, y - 2, w + 2, 2, ST[3]);
  p.hline(x - 1, x + w, y - 1, ST[1]);
  // 窗框与玻璃
  p.rect(x, y, w, h, P.plaster[3]);
  const lit = c.o.lit;
  p.rect(x + 1, y + 1, w - 2, h - 2, lit ? P.lamp[1] : S[1]);
  p.hline(x + 1, x + w - 2, y + 1, lit ? P.lamp[0] : S[0]);
  if (lit) p.rect(x + 2, y + 3, w - 4, h - 5, P.lamp[2]);
  else p.set(x + w - 3, y + 2, S[3]).set(x + w - 2, y + 3, S[3]);
  p.hline(x + 1, x + w - 2, y + Math.floor(h / 2), P.plaster[3]);
  if (w >= 8) p.vline(x + Math.floor(w / 2), y + 1, y + h - 2, P.plaster[3]);
  // 百叶（民居换色：青灰、朱红、墨绿）
  if (kind !== "small") {
    const sh = pickTone(c, [S.slice(1), P.cloth.crimson, P.cloth.green]);
    for (const sx of [x - 2, x + w]) {
      p.rect(sx, y, 2, h, sh[1]);
      p.vline(sx, y, y + h - 1, sh[2]);
      for (let yy = y + 1; yy < y + h; yy += 2) p.set(sx + 1, yy, sh[0]);
    }
  }
  // 窗台
  p.hline(x - 1, x + w, y + h, P.plaster[3]);
  p.hline(x - 1, x + w, y + h + 1, ST[1]);
  if (kind === "std" && h01(x, y, c.seed) < 0.6) flowerBox(c, x, y + h + 1, w);
  else c.ledge(x - 1, x + w, y + h);
}

/** 圆拱木门：石拱券、铁合页。 */
function door(c: Canvas, cx: number, bottom: number, kind: DoorKind = "std"): void {
  const p = c.p;
  const [w, h] = doorSizes[kind];
  const x = cx - Math.floor(w / 2);
  const y = bottom - h;
  // 石拱券
  p.rect(x - 2, y - 1, w + 4, h + 1, ST[2]);
  p.rect(x - 1, y - 3, w + 2, 2, ST[2]);
  p.hline(x, x + w - 1, y - 4, ST[2]);
  p.hline(x - 1, x + w, y - 3, ST[3]);
  p.vline(x - 2, y - 1, bottom - 1, ST[3]);
  p.vline(x + w + 1, y - 1, bottom - 1, ST[1]);
  p.rect(cx - 1, y - 4, 2, 3, ST[4]);
  // 门扇：顶部两角削圆
  const clip = (yy: number) => (yy === y - 2 ? 2 : yy === y - 1 ? 1 : 0);
  for (let yy = y - 2; yy < bottom; yy++) {
    const k = clip(yy);
    p.hline(x + k, x + w - 1 - k, yy, W[0]);
  }
  if (kind === "open") {
    opening(c, x + 1, y, w - 2, h);
    return;
  }
  const iron = kind === "iron";
  if (iron) {
    p.rect(x + 1, y - 1, w - 2, h + 1, P.iron[2]);
    p.vline(x + 1, y - 1, bottom - 1, P.iron[3]);
    for (let yy = y + 1; yy < bottom - 1; yy += 3) for (let xx = x + 2; xx < x + w - 2; xx += 3) p.set(xx, yy, P.iron[3]);
  } else {
    planks(p, x + 1, y - 1, w - 2, h + 1, W, 0, 3);
    // 铁合页
    for (const yy of [y + 2, bottom - 4]) {
      p.hline(x + 1, x + w - 3, yy, P.iron[1]);
      p.set(x + 1, yy, P.iron[2]);
    }
    if (kind === "barn") p.line(x + 2, bottom - 2, x + w - 3, y + 3, W[1]);
  }
  if (w >= 12) p.vline(cx, y - 1, bottom - 1, W[0]);
  p.set(cx + (w >= 12 ? 2 : 2), y + Math.floor(h / 2), P.gold[2]);
  for (let yy = y - 2; yy < bottom; yy++) {
    const k = clip(yy);
    p.set(x + k, yy, W[0]);
    p.set(x + w - 1 - k, yy, W[0]);
  }
}

/** 铁杆挂牌：两段短链吊着木框深蓝底的牌子。 */
function sign(c: Canvas, cx: number, y: number, fac: Facility): number {
  const p = c.p;
  const x = cx - 7;
  p.hline(x - 1, x + 15, y, P.iron[1]);
  p.set(x - 2, y + 1, P.iron[1]).set(x + 16, y + 1, P.iron[1]);
  p.vline(x + 2, y + 1, y + 1, P.iron[2]).vline(x + 12, y + 1, y + 1, P.iron[2]);
  p.rect(x, y + 2, 15, 13, W[1]);
  p.hline(x, x + 14, y + 2, W[3]);
  p.vline(x, y + 2, y + 14, W[2]);
  p.rect(x + 2, y + 4, 11, 9, ink.blue);
  drawEmblem(p, fac, x + 3, y + 4, P.cloth.blue);
  c.ledge(x, x + 14, y + 2);
  return 15;
}

export const nordic: Kit = {
  style: "nordic",
  flag: P.cloth.blue,
  trim: W,
  plinthH: 4,
  awning: [P.cloth.blue, [P.plaster[1], P.plaster[2], P.plaster[3]]],
  wall(c, x, y, w, h, kind: WallKind = "main") {
    const p = c.p;
    if (kind === "ground" || kind === "stone") {
      ashlar(p, x, y, w, h, ST, { course: kind === "stone" ? 5 : 4, min: 6, max: 11, seed: c.seed + y });
      // 墙角隅石
      for (let yy = y; yy < y + h; yy += 4) {
        const long = ((yy - y) / 4) % 2 === 0;
        p.rect(x, yy, long ? 4 : 2, Math.min(3, y + h - yy), ST[3]);
        p.rect(x + w - (long ? 4 : 2), yy, long ? 4 : 2, Math.min(3, y + h - yy), ST[2]);
        p.hline(x, x + (long ? 3 : 1), yy, ST[4]);
      }
      return;
    }
    if (kind === "plain") {
      // 刷漆的护墙板：赭红或土黄
      const boards = pickTone(c, [P.brick, P.gold, P.brick]);
      siding(p, x, y, w, h, [boards[0], boards[1], boards[2], boards[3]]);
      p.rect(x, y, 2, h, P.plaster[3]);
      p.rect(x + w - 2, y, 2, h, P.plaster[2]);
      return;
    }
    logs(p, x, y, w, h, W, c.seed + y);
    logEnds(p, x - 1, y, h, W);
    logEnds(p, x + w - 2, y, h, W);
  },
  plinth(c, x, w, h) {
    const p = c.p;
    const g = c.gy;
    ashlar(p, x, g - h, w, h, ST, { course: Math.max(2, h), min: 5, max: 9, seed: c.seed + 7, light: 1 });
    p.hline(x, x + w - 1, g - h, ST[3]);
  },
  roof,
  band(c, x, w, y) {
    const p = c.p;
    p.hline(x - 1, x + w, y, W[3]);
    p.hline(x - 1, x + w, y + 1, W[1]);
    for (let i = x + 2; i < x + w - 1; i += 6) p.set(i, y + 2, W[1]);
  },
  post(c, x, y0, y1, kind = "post") {
    const p = c.p;
    if (kind === "column") {
      p.rect(x, y0, 4, y1 - y0 + 1, ST[3]);
      p.vline(x, y0, y1, ST[4]);
      p.vline(x + 3, y0, y1, ST[1]);
      p.vline(x + 2, y0, y1, ST[2]);
      p.rect(x - 1, y0, 6, 2, ST[3]);
      p.hline(x - 1, x + 4, y0 + 1, ST[1]);
      p.rect(x - 1, y1 - 1, 6, 2, ST[2]);
      p.hline(x - 1, x + 4, y1 - 1, ST[3]);
      return 4;
    }
    p.rect(x, y0, 3, y1 - y0 + 1, W[2]);
    p.vline(x, y0, y1, W[3]);
    p.vline(x + 2, y0, y1, W[1]);
    return 3;
  },
  winSize: (kind = "std") => winSizes[kind],
  window,
  doorSize: (kind = "std") => doorSizes[kind],
  door,
  sign,
  decor(c, x, w, y, bottom) {
    const p = c.p;
    wallLamp(c, x - 1, y + 7, "iron", -1);
    // 墙边一垛原木：端面朝外，堆成三、二、一的小金字塔
    const wx = x + w + 1;
    const g = c.gy;
    for (let r = 0; r < 3; r++) {
      for (let i = 0; i < 3 - r; i++) {
        const lx = wx + i * 4 + r * 2;
        const ly = g - 4 - r * 3;
        p.stamp([".aa.", "abca", "acda", ".aa."], { a: W[1], b: W[4], c: W[3], d: W[2] }, lx, ly);
      }
    }
    void bottom;
  },
};
