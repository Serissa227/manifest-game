// 低地风格（lowland）：红砖底层与木构架上层、橙色鱼鳞陶瓦、朝街的山墙（顶上一束金麦穗）、白框绿百叶窗与花箱。
import type { Facility } from "../../store/game";
import { P } from "../palette";
import { Px } from "../px";
import { drawEmblem } from "./emblems";
import { type Canvas, type Ramp, ashlar, bricks, fillProfile, flowerBox, gableFront, h01, hipProfile, plaster, timber } from "./kit";
import { opening, wallLamp } from "./parts";
import { type DoorKind, type Kit, type RoofKind, type WallKind, type WinKind, eaveShadow, pickTone } from "./style";

const T = P.autumn; // 陶瓦：暗、中暗、橙、亮橙
const B = P.brick;
const W = P.wood;
const G = P.cloth.green;
const LIME: Ramp = [P.plaster[0], P.plaster[1], P.plaster[2], P.plaster[3], P.white];

/** 鱼鳞陶瓦：每片 4×3，下缘圆，逐行错开 2。 */
export function tileTex(x0: number, x1: number, inset: number) {
  const mid = (x0 + x1) / 2;
  return (xx: number, _yy: number, e: { fromTop: number; fromBot: number }): string => {
    const d = Math.min(xx - x0, x1 - xx);
    if (e.fromBot === 0) return T[1];
    if (e.fromTop === 0) return d < inset && xx > mid ? T[2] : T[3];
    const row = Math.floor((e.fromBot - 1) / 3);
    const ph = (e.fromBot - 1) % 3; // 0 = 瓦片下缘
    const col = (xx + (row % 2) * 2) % 4;
    let c: string = T[2];
    if (ph === 0) c = col === 0 || col === 3 ? T[1] : T[2];
    else if (ph === 1) c = col === 0 ? T[1] : col === 1 ? T[3] : T[2];
    else c = col === 0 ? T[2] : T[2];
    if (d < inset && xx > mid && c === T[3]) c = T[2];
    if (d < inset && xx < mid && e.fromTop === 1) c = T[3];
    return c;
  };
}

/** 麦束顶饰：中心 cx，底在 y。 */
export function sheaf(c: Canvas, cx: number, y: number): number {
  const p = c.p;
  p.vline(cx, y - 2, y, P.gold[1]);
  p.stamp([".y.y.", "yoyoy", ".yoy.", "..r..", ".o.o."], { y: P.gold[3], o: P.gold[2], r: P.red[2] }, cx - 2, y - 7);
  p.set(cx, y - 8, P.gold[4]);
  return y - 8;
}

/** 朝街山墙：底边 y、中心 cx、半宽 hw、高 h；墙面木构架，正中圆窗，两坡陶瓦封檐。 */
function gable(c: Canvas, cx: number, y: number, hw: number, h: number, brick = false): number {
  const p = c.p;
  const tri = (inset: number) =>
    [
      [cx - hw + inset, y + 1],
      [cx + 0.5, y - h + inset * 1.2],
      [cx + hw + 1 - inset, y + 1],
    ] as const;
  // 墙面：先在临时图上画好材质，再按三角形蒙版拷过来
  const mask = new Px(p.w, p.h).poly(tri(1), P.white);
  const tex = new Px(p.w, p.h);
  if (brick) bricks(tex, cx - hw, y - h, hw * 2 + 1, h + 1, B, 3);
  else {
    plaster(tex, cx - hw, y - h, hw * 2 + 1, h + 1, P.plaster, 5);
    tex.hline(cx - hw, cx + hw, y - Math.floor(h / 2), W[1]);
    tex.vline(cx - 1, y - h, y, W[1]);
    tex.vline(cx + 1, y - h, y, W[1]);
    tex.line(cx - hw + 4, y, cx - 2, y - Math.floor(h / 2), W[1]);
    tex.line(cx + hw - 4, y, cx + 2, y - Math.floor(h / 2), W[1]);
  }
  for (let yy = y - h; yy <= y + 1; yy++) {
    for (let xx = cx - hw; xx <= cx + hw + 1; xx++) if (mask.isOpaque(xx, yy)) p.put(xx, yy, tex.get(xx, yy));
  }
  // 圆窗
  const oy = y - Math.floor(h * 0.45);
  p.circle(cx, oy, 3, P.plaster[3]);
  p.circle(cx, oy, 2, c.o.lit ? P.lamp[1] : P.slate[1]);
  p.set(cx - 1, oy - 1, c.o.lit ? P.lamp[2] : P.slate[3]);
  p.vline(cx, oy - 2, oy + 2, P.plaster[3]);
  // 两坡封檐瓦：三行宽
  for (let t = 0; t <= h + 2; t++) {
    const yy = y + 1 - t;
    const dx = Math.round((t * (hw + 2)) / (h + 2));
    const lx = cx - hw - 2 + dx;
    const rx = cx + hw + 2 - dx;
    if (lx > rx) break;
    p.set(lx, yy, T[3]).set(lx + 1, yy, T[2]).set(lx + 2, yy, T[1]);
    p.set(rx, yy, T[1]).set(rx - 1, yy, T[2]).set(rx - 2, yy, T[1]);
  }
  c.markRoof(cx - hw - 2, y - h - 2, hw * 2 + 5, h + 3, T, 0);
  return sheaf(c, cx, y - h - 1);
}

function roof(c: Canvas, x: number, w: number, y: number, kind: RoofKind = "main"): number {
  const p = c.p;
  if (kind === "tower") {
    // 塔顶：陶瓦四角锥 + 麦穗风向标
    const x0 = x - 2;
    const x1 = x + w + 1;
    const h = Math.round(w * 0.8) + 2;
    const yb = y + 1;
    const prof = (xx: number) => {
      if (xx < x0 || xx > x1) return null;
      const d = Math.min(xx - x0, x1 - xx) + 0.5;
      return [yb - Math.round((d / ((x1 - x0) / 2)) * h), yb] as const;
    };
    fillProfile(p, x0, x1, prof, tileTex(x0, x1, 99));
    c.markRoof(x0, yb - h, x1 - x0 + 1, h + 1, T, 1);
    const cx = Math.round((x0 + x1) / 2);
    p.vline(cx, yb - h - 5, yb - h, P.iron[1]);
    p.hline(cx - 3, cx + 2, yb - h - 3, P.gold[2]);
    p.set(cx + 3, yb - h - 3, P.gold[3]).set(cx + 3, yb - h - 4, P.gold[3]).set(cx + 4, yb - h - 3, P.gold[3]);
    p.set(cx - 3, yb - h - 4, P.gold[2]);
    return yb - h - 6;
  }
  if (kind === "gable") {
    // 整面朝街的山墙：木构架三角墙、圆窗、两坡陶瓦，顶上一束麦穗
    const cx = x + Math.floor(w / 2);
    const hw = Math.floor(w / 2);
    const h = Math.round(hw * 0.9);
    const apex = gableFront(
      c,
      cx,
      y,
      hw,
      h,
      (t) => {
        plaster(t, x, y - h, w, h + 1, P.plaster, 7);
        t.hline(x, x + w - 1, y - Math.floor(h / 2), W[1]);
        for (let i = x + 3; i < x + w - 2; i += 6) t.vline(i, y - h, y, W[1]);
      },
      [T[0], T[2], T[3]],
      { thick: 3, over: 3, mark: T },
    );
    const oy = y - Math.floor(h * 0.4);
    p.circle(cx, oy, 2, P.plaster[3]);
    p.set(cx, oy, c.o.lit ? P.lamp[1] : P.slate[1]);
    p.hline(x, x + w - 1, y + 1, P.plaster[3]);
    p.hline(x, x + w - 1, y + 2, P.plaster[1]);
    eaveShadow(c, x, w, y + 3, 1);
    return sheaf(c, cx, apex);
  }
  const over = kind === "porch" ? 2 : 4;
  const x0 = x - over;
  const x1 = x + w - 1 + over;
  if (kind === "porch") {
    // 门廊：小三角山花
    const cx = x + Math.floor(w / 2);
    return gable(c, cx, y, Math.floor(w / 2), Math.round(w * 0.35), false);
  }
  const h = kind === "shed" ? 10 : Math.min(17, Math.max(10, Math.round(w * 0.17) + 4));
  const yb = y + 1;
  const yt = yb - h + 1;
  const inset = Math.min(Math.floor((x1 - x0) / 2) - 1, h + 1);
  fillProfile(p, x0, x1, hipProfile(x0, x1, yt, yb, inset, 1, 2), tileTex(x0, x1, inset));
  p.hline(x0 + inset - 1, x1 - inset + 1, yt - 1, T[1]);
  p.hline(x0 + inset, x1 - inset, yt - 1, T[2]);
  for (let xx = x0 + inset; xx <= x1 - inset; xx += 2) p.set(xx, yt - 1, T[3]);
  c.markRoof(x0, yt - 1, x1 - x0 + 1, h + 1, T, 1);
  // 檐下白色檐口线脚
  p.hline(x, x + w - 1, y + 2, P.plaster[3]);
  p.hline(x, x + w - 1, y + 3, P.plaster[1]);
  for (let i = x + 1; i < x + w - 1; i += 3) p.set(i, y + 3, P.plaster[3]);
  eaveShadow(c, x, w, y + 4, 1);
  c.eave(x0 + 1, x1 - 1, yb);
  let peak = yt - 1;
  if ((kind === "main" || kind === "grand") && w >= 50) {
    const gw = Math.min(16, Math.round(w * 0.2));
    const cx = x + Math.floor(w / 2);
    peak = Math.min(peak, gable(c, cx, y + 1, gw, h + 3, kind === "grand"));
  } else if (kind === "main" && w >= 30) {
    // 小房子：一根砖烟囱
    const chx = x + Math.round(w * 0.72);
    p.rect(chx, yt - 4, 4, 8, B[2]);
    bricks(p, chx, yt - 4, 4, 8, B, 9);
    p.rect(chx - 1, yt - 5, 6, 1, B[3]);
    peak = Math.min(peak, yt - 5);
  }
  return peak;
}

const winSizes: Record<WinKind, readonly [number, number]> = {
  std: [6, 9],
  tall: [6, 11],
  small: [5, 5],
  round: [7, 7],
  wide: [14, 8],
};

const doorSizes: Record<DoorKind, readonly [number, number]> = {
  std: [8, 12],
  double: [12, 13],
  grand: [14, 15],
  open: [16, 12],
  iron: [12, 13],
  barn: [18, 17],
};

/** 白框十字棂玻璃窗，两侧绿百叶，砖砌窗楣，窗下花箱。 */
function window(c: Canvas, x: number, y: number, kind: WinKind = "std"): void {
  const p = c.p;
  const [w, h] = winSizes[kind];
  const lit = c.o.lit;
  if (kind === "round") {
    p.circle(x + 3, y + 3, 3, P.plaster[3]);
    p.circle(x + 3, y + 3, 2, lit ? P.lamp[1] : P.slate[1]);
    p.vline(x + 3, y + 1, y + 5, P.plaster[3]);
    p.hline(x + 1, x + 5, y + 3, P.plaster[3]);
    return;
  }
  // 砖拱窗楣（立砌一排）
  for (let i = -1; i <= w; i++) p.set(x + i, y - 1, i % 2 ? B[3] : B[2]);
  p.set(x + Math.floor(w / 2), y - 2, P.plaster[3]);
  p.rect(x, y, w, h, P.plaster[3]);
  p.rect(x + 1, y + 1, w - 2, h - 2, lit ? P.lamp[1] : P.slate[1]);
  if (lit) p.rect(x + 2, y + 2, w - 4, h - 4, P.lamp[2]);
  else {
    p.hline(x + 1, x + w - 2, y + 1, P.slate[0]);
    p.set(x + w - 3, y + 2, P.slate[3]).set(x + w - 2, y + 3, P.slate[3]);
  }
  p.hline(x + 1, x + w - 2, y + Math.floor(h / 2), P.plaster[3]);
  for (let xx = x + 3; xx < x + w - 1; xx += 4) p.vline(xx, y + 1, y + h - 2, P.plaster[3]);
  if (kind === "std" || kind === "tall") {
    const sh = pickTone(c, [G, P.cloth.blue, P.cloth.crimson]);
    for (const sx of [x - 2, x + w]) {
      p.rect(sx, y, 2, h, sh[1]);
      p.vline(sx, y, y + h - 1, sh[2]);
      for (let yy = y + 1; yy < y + h - 1; yy += 2) p.set(sx + 1, yy, sh[0]);
    }
  }
  p.hline(x - 1, x + w, y + h, P.plaster[3]);
  if (kind === "std" && h01(x, y, c.seed + 1) < 0.65) flowerBox(c, x, y + h + 1, w, W);
  else c.ledge(x - 1, x + w, y + h);
}

/** 绿漆门，门上半圆扇窗，白门框；barn 为红漆白叉的谷仓大门。 */
function door(c: Canvas, cx: number, bottom: number, kind: DoorKind = "std"): void {
  const p = c.p;
  const [w, h] = doorSizes[kind];
  const x = cx - Math.floor(w / 2);
  const y = bottom - h;
  const lit = c.o.lit;
  // 白门框
  p.rect(x - 1, y - 1, w + 2, h + 1, P.plaster[3]);
  p.vline(x + w, y - 1, bottom - 1, P.plaster[1]);
  if (kind === "open") {
    opening(c, x, y, w, h);
    return;
  }
  if (kind === "barn") {
    const R = B;
    p.rect(x, y, w, h, R[2]);
    for (let xx = x + 2; xx < x + w; xx += 3) p.vline(xx, y, bottom - 1, R[1]);
    p.vline(x + Math.floor(w / 2), y, bottom - 1, R[0]);
    for (const [a, b] of [
      [x, x + Math.floor(w / 2) - 1],
      [x + Math.floor(w / 2) + 1, x + w - 1],
    ] as const) {
      p.stroke(a, y, b - a + 1, h, P.plaster[3]);
      p.line(a, y, b, bottom - 1, P.plaster[3]);
      p.line(a, bottom - 1, b, y, P.plaster[3]);
    }
    return;
  }
  // 扇窗
  const fan = Math.max(3, Math.floor(w / 2) - 1);
  const leaf = kind === "iron" ? P.iron : pickTone(c, [G, P.cloth.blue, P.cloth.crimson]);
  p.rect(x, y + fan, w, h - fan, leaf[1]);
  p.ellipse(cx - (w % 2 ? 0 : 0.5), y + fan, w / 2 - 0.5, fan - 0.5, lit ? P.lamp[1] : P.slate[1]);
  p.rect(x, y + fan, w, h - fan, leaf[1]);
  p.hline(x, x + w - 1, y + fan, P.plaster[3]);
  for (let i = 1; i < 3; i++) p.line(cx, y + fan, x + Math.round((i * w) / 3), y + 1, P.plaster[3]);
  // 门板：镶板线
  p.vline(x, y + fan, bottom - 1, leaf[2]);
  if (w >= 12) p.vline(cx, y + fan, bottom - 1, leaf[0]);
  const pw = w >= 12 ? Math.floor(w / 2) : w;
  for (let px = x; px < x + w; px += pw) {
    p.stroke(px + 1, y + fan + 2, pw - 2, Math.floor((h - fan) / 2) - 2, leaf[0]);
    p.stroke(px + 1, y + fan + Math.floor((h - fan) / 2) + 1, pw - 2, Math.floor((h - fan) / 2) - 2, leaf[0]);
  }
  p.set(x + w - 2, y + fan + Math.floor((h - fan) / 2), P.gold[3]);
}

/** 金框深绿招牌，顶上两只铜钩。 */
function sign(c: Canvas, cx: number, y: number, fac: Facility): number {
  const p = c.p;
  const x = cx - 7;
  p.set(x + 3, y, P.gold[1]).set(x + 11, y, P.gold[1]);
  p.rect(x, y + 1, 15, 13, P.gold[2]);
  p.hline(x, x + 14, y + 1, P.gold[3]);
  p.vline(x, y + 1, y + 13, P.gold[3]);
  p.hline(x + 1, x + 14, y + 13, P.gold[1]);
  p.vline(x + 14, y + 2, y + 13, P.gold[1]);
  p.rect(x + 2, y + 3, 11, 9, P.leaf[0]);
  drawEmblem(p, fac, x + 3, y + 3, P.gold.slice(1));
  c.ledge(x, x + 14, y + 1);
  return 14;
}

export const lowland: Kit = {
  style: "lowland",
  flag: [P.gold[1], P.gold[2], P.gold[3]],
  trim: W,
  plinthH: 3,
  awning: [T, [P.plaster[1], P.plaster[2], P.plaster[3]]],
  wall(c, x, y, w, h, kind: WallKind = "main") {
    const p = c.p;
    if (kind === "upper") {
      timber(p, x, y, w, h, 9, true, c.seed + y);
      return;
    }
    if (kind === "stone") {
      ashlar(p, x, y, w, h, LIME, { course: 3, min: 6, max: 10, seed: c.seed + y, light: 2 });
      return;
    }
    if (kind === "plain") {
      plaster(p, x, y, w, h, P.plaster, c.seed);
      return;
    }
    bricks(p, x, y, w, h, B, c.seed + y);
    // 白石隅石
    for (let yy = y; yy < y + h; yy += 3) {
      const long = ((yy - y) / 3) % 2 === 0;
      const ww = long ? 4 : 2;
      p.rect(x, yy, ww, Math.min(2, y + h - yy), P.plaster[3]);
      p.rect(x + w - ww, yy, ww, Math.min(2, y + h - yy), P.plaster[2]);
    }
  },
  plinth(c, x, w, h) {
    const p = c.p;
    const g = c.gy;
    bricks(p, x, g - h, w, h, [B[0], B[0], B[1], B[2]], 21);
    p.hline(x, x + w - 1, g - h, P.stone[3]);
  },
  roof,
  band(c, x, w, y) {
    const p = c.p;
    p.hline(x - 1, x + w, y, P.plaster[3]);
    p.hline(x - 1, x + w, y + 1, P.plaster[1]);
  },
  post(c, x, y0, y1, kind = "post") {
    const p = c.p;
    if (kind === "column") {
      p.rect(x, y0, 3, y1 - y0 + 1, P.plaster[3]);
      p.vline(x, y0, y1, P.white);
      p.vline(x + 2, y0, y1, P.plaster[1]);
      p.rect(x - 1, y0, 5, 2, P.plaster[3]);
      p.hline(x - 1, x + 3, y0 + 1, P.plaster[1]);
      p.rect(x - 1, y1 - 1, 5, 2, P.plaster[2]);
      return 3;
    }
    p.rect(x, y0, 2, y1 - y0 + 1, W[1]);
    p.vline(x, y0, y1, W[2]);
    return 2;
  },
  winSize: (kind = "std") => winSizes[kind],
  window,
  doorSize: (kind = "std") => doorSizes[kind],
  door,
  sign,
  decor(c, x, w, y, bottom) {
    const p = c.p;
    // 墙上的铁艺壁灯
    wallLamp(c, x + w, y + 8, "iron", 1);
    // 秋天：墙角的南瓜与麦束
    if (c.o.season === 2) {
      const gx = x + 2;
      const g = c.gy;
      p.ellipse(gx + 2, g - 3, 2, 2, T[2]);
      p.set(gx + 1, g - 4, T[3]).set(gx + 2, g - 6, P.leaf[2]);
      p.ellipse(gx + 6, g - 2, 2, 1, T[2]);
      p.set(gx + 5, g - 3, T[3]);
      void bottom;
    }
  },
};
