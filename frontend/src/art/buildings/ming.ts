// 明风格（ming）：明代闽粤的海港。
// 红瓦屋顶的屋脊两端高高翘起、分叉成燕尾，脊上嵌着青绿、金、白的剪粘；墙是白花岗岩与红砖“出砖入石”，
// 底层是骑楼前身的檐廊（花岗岩方柱、檐下一片阴影），门边贴红对联；民居另一种屋顶是徽式的马头墙（粉墙黛瓦）；
// 地标是天妃宫与花岗岩的八角石塔；城墙是灰砖的垛口墙与敌楼，城门是砖砌券门上的重檐城楼；
// 街上有挂红灯笼的灯架、花岗岩井栏、石条凳与推独轮车的货郎；远景里有燕尾脊、马头墙与砖塔。
import type { Facility } from "../../store/game";
import { P, ink, overlay } from "../palette";
import type { Px } from "../px";
import { drawEmblem } from "./emblems";
import { type Canvas, type Ramp, ashlar, bricks, fillProfile, h01, plaster, tintOpaque } from "./kit";
import { lantern, opening, steps } from "./parts";
import { type DoorKind, type Kit, type RoofKind, type WallKind, type WinKind, eaveShadow, pickTone } from "./style";
import { type CultureArt, type FarCtx, farWindows, spots, wrap, wrapCourses } from "./townArt";

/** 红瓦 */
const R: Ramp = P.brick;
/** 白花岗岩 */
const GR: Ramp = P.stone;
/** 墨瓦（马头墙的压顶） */
const DK: Ramp = [P.iron[0], P.iron[1], P.slate[1], P.slate[2]];
const W = P.wood;
const RED = P.red;
/** 剪粘的彩瓷：青绿、金、白、碧 */
const JIAN = [P.jade[3], P.gold[3], P.white, P.teal[3], P.jade[2]];
/** 红砖墙 */
const BR: Ramp = [P.brick[0], P.brick[1], P.brick[2], P.brick[3], P.brick[4]];

// ───────────────────────── 屋顶 ─────────────────────────

/** 红瓦纹理：每 3 列一道瓦垄，檐口一排瓦当（滴水），右坡背光。 */
function tileTex(x0: number, x1: number, edge: number) {
  const mid = (x0 + x1) / 2;
  return (xx: number, _yy: number, e: { fromTop: number; fromBot: number }): string => {
    const d = Math.min(xx - x0, x1 - xx);
    const ph = (((xx - x0) % 3) + 3) % 3;
    if (e.fromBot === 0) return ph === 0 ? R[3] : R[1];
    if (e.fromBot === 1) return ph === 0 ? R[2] : R[0];
    if (e.fromTop === 0) return R[3];
    let col: string = ph === 0 ? R[3] : ph === 1 ? R[2] : R[1];
    // 每 3 行一道瓦片搭接的暗线
    if ((e.fromBot - 2) % 3 === 2 && ph !== 0) col = R[1];
    if (d < edge && xx > mid) col = col === R[3] ? R[2] : R[1];
    return col;
  };
}

/** 燕尾：屋脊端点 (ex, ey)（脊身顶行），向外 dir 翘起、分叉。size 2 或 3。返回最高点。 */
function swallowtail(c: Canvas, ex: number, ey: number, dir: -1 | 1, size = 3): number {
  const p = c.p;
  const n = size + 2;
  // 主干：向外上方弯起
  for (let i = 1; i <= n; i++) {
    const xx = ex + dir * i;
    const yy = ey - Math.round((i * i) / (n + 1)) - (i > 1 ? 1 : 0);
    p.set(xx, yy, R[3]);
    p.set(xx, yy + 1, R[1]);
  }
  const tx = ex + dir * n;
  const ty = ey - Math.round((n * n) / (n + 1)) - 1;
  // 分叉：一支朝上、一支朝外
  p.set(tx, ty - 1, R[3]).set(tx, ty - 2, R[4]);
  p.set(tx + dir, ty - 1, R[3]).set(tx + dir * 2, ty - 2, R[4]);
  p.set(tx - dir, ty, R[2]);
  return ty - 2;
}

/** 屋脊的高度曲线：中间最低，往两端逐渐抬起 lift 像素。 */
function ridgeY(xx: number, x0: number, x1: number, base: number, lift: number): number {
  const u = Math.abs((xx - (x0 + x1) / 2) / ((x1 - x0) / 2 || 1));
  return base - Math.round(lift * Math.pow(u, 2.4));
}

/**
 * 燕尾脊的红瓦屋顶：墙 x..x+w-1、墙顶 y、坡高 h、出檐 over；脊身三行（压顶、剪粘、暗线），两端燕尾。
 * 返回 { peak, yt }（最高点与脊身最低处的顶行）。
 */
function swallowRoof(c: Canvas, x: number, w: number, y: number, h: number, over: number, lift: number, size = 3, orn = true): { peak: number; yt: number; x0: number; x1: number } {
  const p = c.p;
  const x0 = x - over;
  const x1 = x + w - 1 + over;
  const yb = y + 1;
  const yt = yb - h + 1;
  // 屋面：檐口平直，上沿随屋脊曲线起翘；两端山墙处收成竖直
  const edge = Math.max(2, Math.round(h * 0.5));
  fillProfile(
    p,
    x0,
    x1,
    (xx) => {
      if (xx < x0 || xx > x1) return null;
      const d = Math.min(xx - x0, x1 - xx);
      const top = ridgeY(xx, x0, x1, yt, lift) + (d < 1 ? 2 : 0);
      return [top, yb] as const;
    },
    tileTex(x0, x1, edge),
  );
  // 脊身：暗线、两行剪粘彩带、压顶（不加装饰时只有一行红砖）
  const rx0 = x0 + 1;
  const rx1 = x1 - 1;
  const th = orn ? 4 : 3;
  for (let xx = rx0; xx <= rx1; xx++) {
    const ry = ridgeY(xx, x0, x1, yt, lift);
    p.set(xx, ry - 1, R[0]);
    const k = xx - rx0;
    if (orn) {
      p.set(xx, ry - 2, k % 3 === 1 ? JIAN[(k >> 1) % JIAN.length] : R[1]);
      p.set(xx, ry - 3, k % 3 === 2 ? JIAN[((k >> 1) + 2) % JIAN.length] : R[2]);
    } else p.set(xx, ry - 2, R[2]);
    p.set(xx, ry - th, R[3]);
  }
  const ly = ridgeY(rx0, x0, x1, yt, lift) - th;
  const ry = ridgeY(rx1, x0, x1, yt, lift) - th;
  const t1 = swallowtail(c, rx0, ly + 1, -1, size);
  const t2 = swallowtail(c, rx1, ry + 1, 1, size);
  c.markRoof(x0, Math.min(t1, t2), x1 - x0 + 1, yb - Math.min(t1, t2) + 1, R, 1);
  c.eave(x0 + 1, x1 - 1, yb);
  return { peak: Math.min(t1, t2, yt - th), yt, x0, x1 };
}

/** 脊上正中的宝珠（双龙戏珠的珠与两侧青绿的龙身）。 */
function ridgePearl(c: Canvas, cx: number, ry: number): number {
  const p = c.p;
  p.circle(cx, ry - 4, 2, P.gold[2]);
  p.set(cx - 1, ry - 5, P.gold[4]);
  p.vline(cx, ry - 2, ry - 1, P.gold[1]);
  // 两条龙：青绿的波浪身子，朝向宝珠
  for (const dir of [-1, 1] as const) {
    for (let i = 0; i < 8; i++) {
      const xx = cx + dir * (4 + i);
      const yy = ry - 3 - (i % 4 < 2 ? 1 : 0) - (i > 5 ? 1 : 0);
      p.set(xx, yy, i % 3 === 0 ? P.jade[4] : P.jade[2]);
      p.set(xx, yy + 1, P.jade[1]);
    }
    p.set(cx + dir * 11, ry - 6, P.jade[3]).set(cx + dir * 12, ry - 6, P.gold[3]);
  }
  return ry - 7;
}

/** 马头墙：白墙向上砌成阶梯，每级压一道墨瓦、外端翘起马头。墙 x..x+w-1、墙顶 y；返回最高点。 */
function horseHead(c: Canvas, x: number, w: number, y: number): number {
  const p = c.p;
  const steps3 = w >= 34 ? 3 : 2;
  const stepW = Math.floor(w / (steps3 * 2 - 1));
  const rise = 5;
  let peak = y;
  for (let i = 0; i < steps3; i++) {
    const sx0 = x + i * stepW;
    const sx1 = x + w - 1 - i * stepW;
    const top = y - rise * (i + 1);
    // 墙身
    plaster(p, sx0, top, sx1 - sx0 + 1, rise + 1, P.plaster, c.seed + i);
    p.vline(sx0, top, y, P.white);
    p.vline(sx1, top, y, P.plaster[1]);
    // 墨瓦压顶：出挑 1 像素，外端马头翘起
    p.hline(sx0 - 1, sx1 + 1, top - 1, DK[1]);
    p.hline(sx0 - 1, sx1 + 1, top - 2, DK[2]);
    for (let xx = sx0; xx <= sx1; xx += 2) p.set(xx, top - 2, DK[3]);
    p.hline(sx0, sx1, top, DK[0]);
    for (const [ex, dir] of [
      [sx0 - 1, -1],
      [sx1 + 1, 1],
    ] as const) {
      p.set(ex, top - 3, DK[2]).set(ex + dir, top - 3, DK[3]).set(ex + dir, top - 4, DK[3]);
    }
    c.markRoof(sx0 - 2, top - 4, sx1 - sx0 + 5, 4, DK, 1);
    peak = Math.min(peak, top - 4);
  }
  // 墙面上一扇小漏窗
  const cx = x + Math.floor(w / 2);
  const wy = y - rise * steps3 + 2;
  p.rect(cx - 2, wy, 5, 3, c.o.lit ? P.lamp[1] : ink.brown);
  p.set(cx, wy + 1, P.plaster[3]);
  return peak;
}

function roof(c: Canvas, x: number, w: number, y: number, kind: RoofKind = "main"): number {
  const p = c.p;
  if (kind === "gable") return horseHead(c, x, w, y);
  if (kind === "shed") {
    // 棚：灰瓦的单坡低顶
    const x0 = x - 2;
    const x1 = x + w + 1;
    for (let xx = x0; xx <= x1; xx++) {
      for (let yy = y - 6; yy <= y + 1; yy++) {
        const ph = (xx - x0) % 3;
        p.set(xx, yy, yy === y + 1 ? (ph === 0 ? GR[3] : GR[0]) : yy === y - 6 ? GR[3] : ph === 0 ? GR[3] : ph === 1 ? GR[2] : GR[1]);
      }
    }
    p.hline(x0, x1, y - 7, DK[1]);
    c.markRoof(x0, y - 7, x1 - x0 + 1, 8, GR, 1);
    c.eave(x0 + 1, x1 - 1, y + 1);
    eaveShadow(c, x, w, y + 2, 1);
    return y - 7;
  }
  if (kind === "tower") {
    // 小楼阁：下层燕尾檐 + 朱柱小阁 + 上层燕尾顶与葫芦宝顶
    const r1 = swallowRoof(c, x, w, y, 6, 3, 2, 2, true);
    eaveShadow(c, x, w, y + 2, 1);
    const ux = x + 4;
    const uw = w - 8;
    const uy = r1.yt - 8;
    p.rect(ux, uy, uw, r1.yt - uy, P.plaster[3]);
    for (const px of [ux, ux + uw - 2]) {
      p.rect(px, uy, 2, r1.yt - uy, RED[2]);
      p.vline(px, uy, r1.yt - 1, RED[3]);
    }
    p.rect(ux + 4, uy + 2, uw - 8, 4, c.o.lit ? P.lamp[1] : W[0]);
    for (let xx = ux + 5; xx < ux + uw - 4; xx += 2) p.vline(xx, uy + 2, uy + 5, RED[1]);
    const r2 = swallowRoof(c, ux, uw, uy, 6, 4, 3, 2, true);
    const cx = x + Math.floor(w / 2);
    // 葫芦
    p.circle(cx, r2.yt - 6, 2, P.gold[2]);
    p.circle(cx, r2.yt - 9, 1, P.gold[2]);
    p.set(cx - 1, r2.yt - 7, P.gold[4]);
    p.vline(cx, r2.yt - 12, r2.yt - 11, P.gold[1]);
    return Math.min(r2.peak, r2.yt - 12);
  }
  if (kind === "porch") {
    const r = swallowRoof(c, x, w, y, 5, 2, 2, 2, true);
    eaveShadow(c, x, w, y + 2, 1);
    return r.peak;
  }
  if (kind === "grand") {
    // 重檐：下层一道出檐，一段白墙，上层燕尾脊大屋顶与双龙戏珠
    const x0 = x - 5;
    const x1 = x + w + 4;
    for (let xx = x0; xx <= x1; xx++) {
      const ph = (xx - x0) % 3;
      p.set(xx, y - 1, R[3]);
      p.set(xx, y, ph === 0 ? R[3] : ph === 1 ? R[2] : R[1]);
      p.set(xx, y + 1, ph === 0 ? R[2] : R[1]);
      p.set(xx, y + 2, ph === 0 ? R[3] : R[0]);
    }
    c.markRoof(x0, y - 1, x1 - x0 + 1, 4, R, 1);
    c.eave(x0 + 1, x1 - 1, y + 2);
    eaveShadow(c, x, w, y + 3, 1);
    const ux = x + 3;
    const uw = w - 6;
    const uy = y - 5;
    p.rect(ux, uy, uw, 4, P.plaster[3]);
    for (let xx = ux + 2; xx < ux + uw - 2; xx += 5) p.rect(xx, uy + 1, 3, 2, c.o.lit ? P.lamp[1] : W[0]);
    const h = Math.min(12, Math.max(8, Math.round(w * 0.11) + 3));
    const r = swallowRoof(c, ux, uw, uy, h, 4, 4, 3, true);
    const cx = x + Math.floor(w / 2);
    return Math.min(r.peak, ridgePearl(c, cx, ridgeY(cx, r.x0, r.x1, r.yt, 4)));
  }
  const h = Math.min(12, Math.max(7, Math.round(w * 0.11) + 3));
  const r = swallowRoof(c, x, w, y, h, 3, 3, w >= 40 ? 3 : 2, true);
  eaveShadow(c, x, w, y + 2, 1);
  return r.peak;
}

// ───────────────────────── 门窗 ─────────────────────────

const winSizes: Record<WinKind, readonly [number, number]> = {
  std: [7, 8],
  tall: [7, 11],
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

function window(c: Canvas, x: number, y: number, kind: WinKind = "std"): void {
  const p = c.p;
  const [w, h] = winSizes[kind];
  const lit = c.o.lit;
  if (kind === "round") {
    // 圆形花窗：花岗岩圈，里面方胜格
    const cx = x + 4;
    const cy = y + 4;
    p.circle(cx, cy, 4, GR[3]);
    p.circle(cx, cy, 3, lit ? P.lamp[1] : ink.brown);
    for (let d = -3; d <= 3; d++) {
      p.set(cx + d, cy + d, GR[2]);
      p.set(cx + d, cy - d, GR[2]);
    }
    p.set(cx - 3, cy - 3, GR[4]);
    return;
  }
  // 花岗岩窗框（上下加厚）
  p.rect(x - 1, y - 2, w + 2, h + 3, GR[3]);
  p.hline(x - 2, x + w + 1, y - 2, GR[4]);
  p.hline(x - 2, x + w + 1, y + h, GR[2]);
  p.rect(x, y, w, h, lit ? P.lamp[1] : ink.brown);
  if (lit) p.rect(x + 1, y + 1, w - 2, h - 2, P.lamp[2]);
  if (kind === "tall" || kind === "wide") {
    // 木格栅（红褐）
    for (let xx = x + 1; xx < x + w; xx += 2) p.vline(xx, y, y + h - 1, W[1]);
    for (let yy = y + 2; yy < y + h; yy += 3) p.hline(x, x + w - 1, yy, W[1]);
  } else {
    // 石窗：直棂（白花岗岩的竖条）
    for (let xx = x + 1; xx < x + w; xx += 2) p.vline(xx, y, y + h - 1, GR[3]);
    p.vline(x + 1, y, y + h - 1, GR[4]);
  }
  c.ledge(x - 2, x + w + 1, y + h);
}

/** 门两侧与门楣上的红对联（细红纸条，点几点金）。 */
function couplets(p: Px, x: number, y: number, w: number, h: number): void {
  for (const xx of [x - 3, x + w + 1]) {
    p.rect(xx, y + 1, 2, h - 3, RED[2]);
    p.vline(xx, y + 1, y + h - 3, RED[3]);
    for (let yy = y + 3; yy < y + h - 3; yy += 3) p.set(xx + 1, yy, P.gold[3]);
  }
  p.rect(x + 1, y - 4, w - 2, 2, RED[2]);
  for (let xx = x + 2; xx < x + w - 2; xx += 2) p.set(xx, y - 4, P.gold[3]);
}

function door(c: Canvas, cx: number, bottom: number, kind: DoorKind = "std"): void {
  const p = c.p;
  const [w, h] = doorSizes[kind];
  const x = cx - Math.floor(w / 2);
  const y = bottom - h;
  // 花岗岩门框（凹寿：门框外再退一圈）
  p.rect(x - 2, y - 2, w + 4, h + 2, GR[3]);
  p.hline(x - 2, x + w + 1, y - 2, GR[4]);
  p.vline(x + w + 1, y - 2, bottom - 1, GR[2]);
  if (kind === "open") {
    opening(c, x, y, w, h);
    return;
  }
  const leaf = kind === "iron" ? P.iron : kind === "barn" ? W : pickTone(c, [[P.iron[0], P.iron[1], P.iron[2], P.iron[3]], RED, [P.iron[0], P.iron[1], P.iron[2], P.iron[3]]]);
  p.rect(x, y, w, h, leaf[1]);
  p.vline(x, y, bottom - 1, leaf[2]);
  if (w >= 10) {
    p.vline(cx - 1, y, bottom - 1, leaf[0]);
    p.vline(cx, y, bottom - 1, leaf[2]);
  }
  if (kind === "barn") {
    for (let xx = x + 2; xx < x + w - 1; xx += 3) p.vline(xx, y + 1, bottom - 1, W[1]);
    p.hline(x, x + w - 1, y + 4, W[3]);
    p.hline(x, x + w - 1, bottom - 5, W[3]);
    return;
  }
  // 门板上两道横带与铜门环
  p.hline(x, x + w - 1, y + 3, leaf[2]);
  p.hline(x, x + w - 1, bottom - 4, leaf[2]);
  const ry = y + Math.floor(h / 2);
  if (w >= 10) p.set(cx - 2, ry, P.gold[3]).set(cx + 1, ry, P.gold[3]);
  else p.set(cx + 1, ry, P.gold[3]);
  couplets(p, x, y, w, h);
  if (kind === "grand") {
    // 门前一对抱鼓石
    for (const sx of [x - 6, x + w + 3]) {
      p.circle(sx + 1, bottom - 6, 2, GR[3]);
      p.set(sx, bottom - 7, GR[4]);
      p.rect(sx - 1, bottom - 3, 5, 3, GR[2]);
      p.hline(sx - 1, sx + 3, bottom - 3, GR[3]);
    }
  }
}

/** 竖招牌：金边朱框的黑漆竖牌，下面垂一绺红穗。 */
function sign(c: Canvas, cx: number, y: number, fac: Facility): number {
  const p = c.p;
  const x = cx - 6;
  p.rect(x, y, 13, 14, RED[1]);
  p.rect(x + 1, y + 1, 11, 12, P.gold[2]);
  p.hline(x + 1, x + 11, y + 1, P.gold[3]);
  p.rect(x + 2, y + 2, 9, 10, ink.deep);
  drawEmblem(p, fac, x + 2, y + 2, ming.flag);
  // 顶上一道小红瓦檐
  p.hline(x - 1, x + 13, y - 1, R[2]);
  p.set(x - 2, y - 2, R[3]).set(x + 14, y - 2, R[3]);
  p.vline(cx, y + 14, y + 15, RED[2]);
  p.set(cx, y + 16, P.gold[3]);
  c.ledge(x - 1, x + 13, y - 1);
  return 16;
}

// ───────────────────────── 墙 ─────────────────────────

/** 出砖入石：花岗岩条石与竖砌红砖交错。 */
function brickStone(p: Px, x: number, y: number, w: number, h: number, seed: number): void {
  ashlar(p, x, y, w, h, GR, { course: 3, min: 5, max: 10, seed, light: 2 });
  for (let i = 0; i < Math.floor((w * h) / 30); i++) {
    const bx = x + Math.floor(h01(i, seed, 1) * (w - 2));
    const by = y + Math.floor(h01(i, seed, 2) * (h - 3));
    p.rect(bx, by, 2, 3, BR[2]);
    p.set(bx, by, BR[3]);
  }
}

function wall(c: Canvas, x: number, y: number, w: number, h: number, kind: WallKind = "main"): void {
  const p = c.p;
  if (kind === "stone") {
    ashlar(p, x, y, w, h, GR, { course: 4, min: 7, max: 13, seed: c.seed + x, light: 2 });
    p.vline(x, y, y + h - 1, GR[4]);
    p.vline(x + w - 1, y, y + h - 1, GR[1]);
    return;
  }
  if (kind === "plain") {
    // 徽式粉墙：白灰，下半截青石墙裙
    plaster(p, x, y, w, h, P.plaster, c.seed + x + y);
    const bh = Math.min(h, 5);
    ashlar(p, x, y + h - bh, w, bh, GR, { course: bh, min: 6, max: 10, seed: c.seed + 5 });
    p.vline(x, y, y + h - 1, P.white);
    p.vline(x + w - 1, y, y + h - 1, P.plaster[1]);
    return;
  }
  if (kind === "upper") {
    // 红砖墙，墙角花岗岩隅石
    bricks(p, x, y, w, h, BR, c.seed + x);
  } else if (kind === "ground") {
    // 檐廊：墙退在廊下的阴影里，两端花岗岩方柱
    brickStone(p, x, y, w, h, c.seed + x);
    tintOpaque(p, x, y, w, h, overlay.shadowLight);
    tintOpaque(p, x, y, w, 3, overlay.shadow);
    for (const px of [x, x + w - 4]) {
      p.rect(px, y, 4, h, GR[3]);
      p.vline(px, y, y + h - 1, GR[4]);
      p.vline(px + 3, y, y + h - 1, GR[1]);
      p.hline(px, px + 3, y + h - 2, GR[2]);
    }
    return;
  } else {
    // main：上部白灰，下部出砖入石
    plaster(p, x, y, w, h, P.plaster, c.seed + x + y);
    const bh = Math.max(4, Math.floor(h * 0.4));
    brickStone(p, x, y + h - bh, w, bh, c.seed + y);
    p.hline(x, x + w - 1, y + h - bh, GR[4]);
  }
  // 隅石
  for (let yy = y; yy < y + h; yy += 3) {
    const long = ((yy - y) / 3) % 2 === 0;
    p.rect(x, yy, long ? 4 : 2, 2, GR[3]);
    p.rect(x + w - (long ? 4 : 2), yy, long ? 4 : 2, 2, GR[2]);
  }
}

export const ming: Kit = {
  style: "ming",
  flag: [RED[1], RED[2], RED[3]],
  trim: W,
  plinthH: 3,
  awning: [P.cloth.blue, P.cloth.cream],
  lamp: "red",
  wall,
  plinth(c, x, w, h) {
    const p = c.p;
    const g = c.gy;
    ashlar(p, x, g - h, w, h, GR, { course: h, min: 8, max: 14, seed: c.seed + 3, light: 2 });
    p.hline(x, x + w - 1, g - h, GR[4]);
  },
  roof,
  band(c, x, w, y) {
    // 花岗岩横梁上一道彩绘：青、绿、朱相间；下面是檐廊的阴影
    const p = c.p;
    p.hline(x - 1, x + w, y - 1, GR[4]);
    p.hline(x - 1, x + w, y, GR[2]);
    for (let i = 0; i < w; i++) {
      const ph = i % 6;
      p.set(x + i, y + 1, ph < 2 ? P.cloth.blue[1] : ph < 4 ? P.jade[2] : RED[2]);
    }
    p.hline(x - 1, x + w, y + 2, GR[1]);
    c.ledge(x - 1, x + w, y - 1);
  },
  post(c, x, y0, y1, kind = "post") {
    const p = c.p;
    if (kind === "column") {
      // 盘龙石柱：花岗岩柱身绕着一道暗色的龙纹
      p.rect(x, y0, 3, y1 - y0 + 1, GR[3]);
      p.vline(x, y0, y1, GR[4]);
      p.vline(x + 2, y0, y1, GR[1]);
      for (let yy = y0 + 2; yy < y1 - 2; yy++) if ((yy - y0) % 6 < 3) p.set(x + ((yy - y0) % 6), yy, P.jade[1]);
      p.rect(x - 1, y1 - 1, 5, 2, GR[2]);
      p.rect(x - 1, y0, 5, 1, RED[1]);
      return 3;
    }
    p.rect(x, y0, 3, y1 - y0 + 1, GR[3]);
    p.vline(x, y0, y1, GR[4]);
    p.vline(x + 2, y0, y1, GR[1]);
    return 3;
  },
  winSize: (kind = "std") => winSizes[kind],
  window,
  doorSize: (kind = "std") => doorSizes[kind],
  door,
  sign,
  decor(c, x, w, y) {
    const p = c.p;
    // 檐下两盏红灯笼；门口一盆金桔（春天挂满果子）
    lantern(c, x + 3, y + 3, "red");
    lantern(c, x + w - 4, y + 3, "red");
    const px = x + w + 1;
    const g = c.gy;
    p.rect(px, g - 4, 6, 4, P.cloth.blue[1]);
    p.hline(px, px + 5, g - 4, P.white);
    p.set(px + 1, g - 2, P.white).set(px + 4, g - 2, P.white);
    // 金桔四季常绿，冬春（过年前后）挂满金黄的果子
    p.circle(px + 3, g - 8, 3, P.leaf[1]);
    p.set(px + 2, g - 10, P.leaf[3]).set(px + 1, g - 8, P.leaf[2]);
    if (c.o.season === 0 || c.o.season === 3) {
      for (const [dx, dy] of [
        [1, -9],
        [4, -7],
        [3, -10],
        [5, -9],
        [2, -6],
      ] as const)
        p.set(px + dx, g + dy, P.autumn[2]);
    }
  },
};

// ───────────────────────── 地标：天妃宫与八角石塔 ─────────────────────────

function landmark(c: Canvas): void {
  const p = c.p;
  const g = c.gy;
  // 石塔（在殿后面先画）：五层八角，层层收分，石出檐、栏杆，顶上塔刹
  const tcx = 70;
  let bottom = g - 8;
  ashlar(p, tcx - 16, bottom, 33, 8, GR, { course: 4, min: 6, max: 10, seed: 7 });
  p.hline(tcx - 16, tcx + 16, bottom, GR[4]);
  const widths = [22, 19, 17, 15, 13];
  const heights = [15, 13, 12, 11, 10];
  for (let i = 0; i < 5; i++) {
    const bw = widths[i];
    const bh = heights[i];
    const bx = tcx - Math.floor(bw / 2);
    const top = bottom - bh;
    // 八角塔身：左亮、中、右暗三面
    for (let xx = bx; xx < bx + bw; xx++) {
      const u = (xx - bx) / (bw - 1);
      p.vline(xx, top, bottom - 1, u < 0.3 ? GR[4] : u < 0.7 ? GR[3] : GR[2]);
    }
    p.vline(bx + Math.round(bw * 0.3), top, bottom - 1, GR[2]);
    p.vline(bx + Math.round(bw * 0.7), top, bottom - 1, GR[1]);
    // 正面券龛与两侧浮雕
    const nh = Math.min(8, bh - 4);
    for (let row = 0; row < nh; row++) {
      const k = row < 2 ? 2 - row : 0;
      p.hline(tcx - 2 + k, tcx + 2 - k, bottom - 1 - nh + row, c.o.lit && i === 0 ? P.lamp[1] : ink.brown);
    }
    p.rect(bx + 2, top + 3, 2, bh - 6, GR[2]);
    // 石出檐：比塔身宽，两角微翘，檐下阴影
    const ew = bw + 8;
    const ex = tcx - Math.floor(ew / 2);
    p.hline(ex, ex + ew - 1, top - 1, GR[3]);
    p.hline(ex + 1, ex + ew - 2, top - 2, GR[4]);
    p.hline(ex + 2, ex + ew - 3, top - 3, GR[2]);
    p.set(ex - 1, top - 2, GR[4]).set(ex + ew, top - 2, GR[3]);
    tintOpaque(p, bx, top, bw, 1, overlay.shadow);
    c.markRoof(ex - 1, top - 3, ew + 2, 3, GR, 0);
    // 平座栏杆
    p.hline(bx - 1, bx + bw, top - 5, GR[3]);
    for (let xx = bx - 1; xx <= bx + bw; xx += 2) p.set(xx, top - 4, GR[2]);
    bottom = top - 5;
  }
  // 塔刹：覆钵、相轮与葫芦
  p.rect(tcx - 3, bottom - 2, 7, 2, GR[3]);
  p.vline(tcx, bottom - 16, bottom - 3, P.iron[1]);
  for (let yy = bottom - 14; yy < bottom - 3; yy += 2) p.hline(tcx - 1, tcx + 1, yy, P.gold[2]);
  p.circle(tcx, bottom - 18, 2, P.gold[2]);
  p.set(tcx - 1, bottom - 19, P.gold[4]);
  // 天妃宫：花岗岩台基、龙柱、朱门，重檐燕尾脊
  const hx = 4;
  const hw = 58;
  const hb = g - 5;
  ashlar(p, hx - 3, hb, hw + 6, 5, GR, { course: 5, min: 8, max: 12, seed: 9 });
  p.hline(hx - 3, hx + hw + 2, hb, GR[4]);
  steps(c, hx + hw / 2, 16, 4, g, GR);
  const ht = hb - 24;
  brickStone(p, hx, ht, hw, 24, 11);
  tintOpaque(p, hx + 4, ht, hw - 8, 24, overlay.shadowLight);
  ming.door(c, hx + hw / 2, hb, "grand");
  for (const wx of [hx + 7, hx + hw - 14]) ming.window(c, wx, ht + 8, "round");
  for (const px of [hx + 1, hx + 15, hx + hw - 18, hx + hw - 4]) ming.post(c, px, ht + 1, hb - 1, "column");
  ming.band(c, hx, hw, ht - 1);
  // 檐下一排红灯笼
  for (const lx of [hx + 10, hx + hw - 11]) lantern(c, lx, ht + 2, "red");
  roof(c, hx, hw, ht - 2, "grand");
}

// ───────────────────────── 城门与城墙 ─────────────────────────

/** 灰砖：按城砖的尺寸错缝。 */
function cityBricks(p: Px, x: number, y: number, w: number, h: number, seed: number): void {
  ashlar(p, x, y, w, h, GR, { course: 3, min: 5, max: 8, seed, light: 2 });
}

/** 垛口：灰砖的长方垛，正中一个小方射孔。 */
function crenel(p: Px, x: number, top: number): void {
  p.rect(x, top - 5, 6, 5, GR[2]);
  p.hline(x, x + 5, top - 5, GR[3]);
  p.vline(x + 5, top - 5, top - 1, GR[1]);
  p.rect(x + 2, top - 3, 2, 2, ink.deep);
}

function gate(c: Canvas): void {
  const p = c.p;
  const g = c.gy;
  const cx = Math.floor(c.w / 2);
  const bw = 84;
  const x = cx - bw / 2;
  const top = g - 38;
  cityBricks(p, x, top, bw, 38, 3);
  p.vline(x, top, g - 1, GR[3]);
  p.vline(x + bw - 1, top, g - 1, GR[1]);
  for (let xx = x; xx < x + bw - 4; xx += 8) crenel(p, xx, top);
  // 半圆券门洞
  const aw = 18;
  const ah = 26;
  const r = aw / 2;
  for (let yy = g - ah - 2; yy < g; yy++) {
    const fromTop = yy - (g - ah - 2);
    const k = fromTop < r + 2 ? Math.round(r + 2 - Math.sqrt(Math.max(0, (r + 2) ** 2 - (r + 2 - fromTop) ** 2))) : 0;
    p.hline(cx - r - 2 + k, cx + r + 1 - k, yy, GR[4]);
  }
  for (let yy = g - ah; yy < g; yy++) {
    const fromTop = yy - (g - ah);
    const k = fromTop < r ? Math.round(r - Math.sqrt(Math.max(0, r * r - (r - fromTop) ** 2))) : 0;
    p.hline(cx - r + k, cx + r - 1 - k, yy, ink.brown);
  }
  p.hline(cx - r + 2, cx + r - 3, g - 1, GR[1]);
  // 朱漆门扇半开，门钉
  for (const dx of [-r, r - 4]) {
    p.rect(cx + dx, g - 17, 4, 17, RED[2]);
    p.vline(cx + dx, g - 17, g - 1, RED[3]);
    for (let yy = g - 15; yy < g - 2; yy += 3) p.set(cx + dx + 2, yy, P.gold[3]);
  }
  // 石匾
  p.rect(cx - 9, top + 3, 19, 7, GR[4]);
  p.rect(cx - 8, top + 4, 17, 5, ink.deep);
  for (let xx = cx - 6; xx <= cx + 6; xx += 3) p.rect(xx, top + 5, 2, 3, P.gold[3]);
  // 城楼：朱柱、白墙、重檐燕尾脊
  const tw = 52;
  const tx = cx - tw / 2;
  const ty = top - 15;
  p.rect(tx - 3, top - 2, tw + 6, 2, GR[3]);
  for (let bx = tx - 3; bx < tx + tw + 3; bx += 2) p.set(bx, top - 3, RED[1]);
  p.rect(tx, ty, tw, top - 2 - ty, P.plaster[3]);
  for (let xx = tx + 6; xx < tx + tw - 6; xx += 7) p.rect(xx, ty + 4, 4, 6, c.o.lit ? P.lamp[1] : W[0]);
  for (const px of [tx, tx + 12, tx + tw - 15, tx + tw - 3]) {
    p.rect(px, ty, 3, top - 2 - ty, RED[2]);
    p.vline(px, ty, top - 3, RED[3]);
    p.vline(px + 2, ty, top - 3, RED[1]);
  }
  lantern(c, tx + 8, ty + 3, "red");
  lantern(c, tx + tw - 9, ty + 3, "red");
  roof(c, tx, tw, ty, "grand");
}

function wallBody(c: Canvas, W: number, top: number): void {
  const p = c.p;
  const H = c.gy;
  wrapCourses(p, W, top, H - top, GR, 3, 5, 8, c.seed, 2);
  // 墙顶一道压檐砖
  for (let x = 0; x < W; x++) {
    p.put(x, top, GR[4]);
    p.put(x, top + 1, GR[1]);
  }
  for (const x of spots(W, 9)) wrap(W, (dx) => crenel(p, x + dx, top));
  // 墙身的射孔
  for (const x of spots(W, 18)) wrap(W, (dx) => p.rect(x + dx + 8, top + 9, 2, 3, ink.deep));
}

function wallTower(c: Canvas, x: number, top: number): void {
  const p = c.p;
  const H = c.gy;
  // 马面：凸出的砖台，台上一座朱柱红瓦的小敌楼
  const w = 22;
  const t = top - 4;
  cityBricks(p, x, t, w, H - t, x);
  p.vline(x, t, H - 1, GR[3]);
  p.vline(x + w - 1, t, H - 1, GR[1]);
  for (let xx = x; xx < x + w - 3; xx += 7) crenel(p, xx, t);
  const ux = x + 3;
  const uw = w - 6;
  const ut = t - 14;
  p.rect(ux, ut, uw, t - 5 - ut, P.plaster[3]);
  for (const px of [ux, ux + uw - 2]) {
    p.rect(px, ut, 2, t - 5 - ut, RED[2]);
    p.vline(px, ut, t - 6, RED[3]);
  }
  p.rect(ux + 5, ut + 3, uw - 10, 4, c.o.lit ? P.lamp[1] : W[0]);
  swallowRoof(c, ux, uw, ut, 5, 3, 2, 2, false);
}

// ───────────────────────── 远景 ─────────────────────────

function farHouse(k: FarCtx, x: number, w: number, h: number, seed: number): void {
  const p = k.p;
  const b = k.base;
  const f = k.f;
  const wallTop = b - h;
  const horse = h01(seed, 4, 5) < 0.3 && w >= 12;
  p.rect(x, wallTop, w, h, horse ? P.plaster[3] : f.wall[1]);
  p.vline(x + w - 1, wallTop, b - 1, f.wall[0]);
  p.vline(x, wallTop, b - 1, f.wall[2]);
  farWindows(k, x, wallTop + 2, w, h - 2, seed);
  if (horse) {
    // 马头墙：两级台阶，墨瓦压顶
    const s = Math.floor(w / 3);
    for (let i = 0; i < 2; i++) {
      const a = x + i * s;
      const bb = x + w - 1 - i * s;
      const top = wallTop - 4 * (i + 1);
      p.rect(a, top, bb - a + 1, 4, P.plaster[3]);
      p.hline(a - 1, bb + 1, top - 1, DK[1]);
      p.set(a - 1, top - 2, DK[2]).set(bb + 1, top - 2, DK[2]);
      k.roofs.push([a - 1, top - 2, bb - a + 3, 2]);
    }
    return;
  }
  // 红瓦屋顶，屋脊两端燕尾翘起
  const over = 1;
  const rh = Math.max(3, Math.round(w * 0.24));
  const x0 = x - over;
  const x1 = x + w - 1 + over;
  for (let xx = x0; xx <= x1; xx++) {
    const ry = ridgeY(xx, x0, x1, wallTop - rh, 2);
    p.vline(xx, ry, wallTop + 1, xx > (x0 + x1) / 2 ? f.roof[0] : f.roof[1]);
    p.set(xx, ry, f.roof[2]);
  }
  p.set(x0 - 1, wallTop - rh - 3, f.roof[2]).set(x1 + 1, wallTop - rh - 3, f.roof[2]);
  p.set(x0 - 2, wallTop - rh - 4, f.roof[2]).set(x1 + 2, wallTop - rh - 4, f.roof[2]);
  k.roofs.push([x0, wallTop - rh - 3, x1 - x0 + 1, rh + 4]);
}

/** 远景的八角石塔：七层，层层出檐。 */
function farPagoda(k: FarCtx, x: number): number {
  const p = k.p;
  const b = k.base;
  const cx = x + 8;
  let y = b;
  for (let i = 0; i < 7; i++) {
    const bw = 11 - Math.floor(i * 0.9);
    const hh = i === 0 ? 7 : 5;
    p.rect(cx - Math.floor(bw / 2), y - hh, bw, hh, GR[2]);
    p.vline(cx - Math.floor(bw / 2), y - hh, y - 1, GR[3]);
    p.vline(cx + Math.ceil(bw / 2) - 1, y - hh, y - 1, GR[1]);
    p.set(cx, y - Math.floor(hh / 2), ink.brown);
    k.lights.push([cx, y - Math.floor(hh / 2)]);
    y -= hh;
    p.hline(cx - Math.floor(bw / 2) - 2, cx + Math.ceil(bw / 2) + 1, y, GR[3]);
    p.set(cx - Math.floor(bw / 2) - 3, y - 1, GR[3]).set(cx + Math.ceil(bw / 2) + 2, y - 1, GR[3]);
    k.roofs.push([cx - Math.floor(bw / 2) - 3, y - 1, bw + 6, 2]);
    y -= 1;
  }
  p.vline(cx, y - 7, y, P.iron[1]);
  p.circle(cx, y - 8, 1, P.gold[2]);
  return 17;
}

/** 远景的庙：燕尾脊高高翘起。 */
function farTemple(k: FarCtx, x: number): number {
  const p = k.p;
  const b = k.base;
  const f = k.f;
  const w = 22;
  p.rect(x, b - 10, w, 10, f.wall[1]);
  for (let xx = x + 2; xx < x + w - 1; xx += 5) p.vline(xx, b - 10, b - 1, f.accent[1]);
  k.lights.push([x + 6, b - 5], [x + 15, b - 5]);
  for (let xx = x - 2; xx <= x + w + 1; xx++) {
    const ry = ridgeY(xx, x - 2, x + w + 1, b - 16, 4);
    p.vline(xx, ry, b - 10, xx > x + w / 2 ? f.roof[0] : f.roof[1]);
    p.set(xx, ry - 1, f.roof[2]);
  }
  for (const [ex, dir] of [
    [x - 2, -1],
    [x + w + 1, 1],
  ] as const) {
    p.set(ex + dir, b - 21, f.roof[2]).set(ex + dir * 2, b - 22, f.roof[2]).set(ex + dir, b - 22, f.roof[2]);
  }
  p.set(x + w / 2, b - 18, P.gold[2]);
  k.roofs.push([x - 2, b - 22, w + 4, 8]);
  return w + 4;
}

function farTower(k: FarCtx, x: number, seed: number): number {
  return h01(seed, 11, 1) < 0.55 ? farPagoda(k, x) : farTemple(k, x);
}

function farWall(k: FarCtx, top: number): void {
  const p = k.p;
  const W = k.W;
  p.rect(0, top, W, 8, GR[2]);
  p.hline(0, W - 1, top, GR[3]);
  for (let x = 0; x < W; x += 2) p.put(x, top + 3 + (Math.floor(x / 2) % 2) * 2, GR[1]);
  const n = Math.max(1, Math.round(W / 5));
  for (let j = 0; j < n; j++) {
    const mx = Math.round((j * W) / n);
    p.rect(mx, top - 2, 3, 2, GR[3]);
  }
}

// ───────────────────────── 街道小物件 ─────────────────────────

/** 灯架：木柱横担上挂一盏大红灯笼。 */
function lamp(c: Canvas): void {
  const p = c.p;
  const g = c.gy;
  p.rect(2, g - 3, 7, 3, GR[2]);
  p.hline(2, 8, g - 3, GR[3]);
  p.rect(4, g - 28, 3, 25, W[2]);
  p.vline(4, g - 28, g - 4, W[3]);
  p.vline(6, g - 28, g - 4, W[1]);
  p.hline(4, 16, g - 27, W[2]);
  p.hline(4, 16, g - 26, W[1]);
  p.line(7, g - 20, 12, g - 26, W[1]);
  p.set(17, g - 28, W[3]);
  p.vline(14, g - 25, g - 24, P.gold[1]);
  // 大红灯笼（比墙上的大一圈）
  const lit = c.o.lit;
  p.stamp(
    ["..oo..", ".OooO.", "rRrrrq", "Rrrrrq", "rRrrrq", "rrrrrq", ".OooO.", "..oo..", "..r..."],
    { o: P.gold[2], O: P.gold[1], R: lit ? P.lamp[2] : RED[3], r: lit ? RED[3] : RED[2], q: lit ? RED[2] : RED[1] },
    11,
    g - 23,
  );
  if (lit) tintOpaque(p, 8, g - 25, 12, 13, overlay.glow, 2);
}

/** 花岗岩井栏（八角，口沿一圈亮边）与木辘轳架。 */
function well(c: Canvas): void {
  const p = c.p;
  const g = c.gy;
  ashlar(p, 2, g - 8, 18, 8, GR, { course: 4, min: 5, max: 7, seed: 5, light: 2 });
  p.hline(1, 20, g - 9, GR[4]);
  p.hline(1, 20, g - 8, GR[2]);
  for (const xx of [6, 11, 16]) p.vline(xx, g - 7, g - 2, GR[1]);
  p.rect(3, g - 19, 2, 10, W[2]);
  p.rect(17, g - 19, 2, 10, W[1]);
  p.rect(4, g - 18, 14, 2, W[3]);
  p.hline(4, 17, g - 17, W[1]);
  p.line(18, g - 17, 21, g - 14, W[1]);
  p.vline(10, g - 16, g - 11, P.straw[1]);
  p.rect(8, g - 11, 5, 3, W[2]);
  p.hline(8, 12, g - 11, P.iron[2]);
}

/** 石条凳：一块花岗岩长条搁在两块石墩上。 */
function bench(p: Px): void {
  const g = p.h;
  p.rect(1, g - 5, 16, 2, GR[3]);
  p.hline(1, 16, g - 5, GR[4]);
  p.hline(1, 16, g - 4, GR[2]);
  for (const x of [2, 13]) {
    p.rect(x, g - 3, 3, 3, GR[2]);
    p.vline(x, g - 3, g - 1, GR[3]);
  }
}

/** 独轮车：一只大木轮在车架正中，两根长车把；装青花瓷罐或茶箱。 */
function cart(p: Px, v: number): void {
  const g = p.h;
  p.rect(3, g - 10, 18, 2, W[2]);
  p.hline(3, 20, g - 10, W[3]);
  p.line(20, g - 9, 28, g - 4, W[1]);
  p.line(20, g - 10, 28, g - 5, W[3]);
  p.vline(27, g - 4, g - 1, W[1]);
  if (v % 2 === 0) {
    // 青花瓷罐
    for (const x of [4, 13]) {
      p.rect(x, g - 17, 7, 7, P.white);
      p.hline(x + 1, x + 5, g - 18, P.white);
      p.hline(x + 2, x + 4, g - 19, P.cloth.blue[1]);
      p.hline(x, x + 6, g - 15, P.cloth.blue[1]);
      p.set(x + 2, g - 13, P.cloth.blue[2]).set(x + 4, g - 12, P.cloth.blue[2]);
      p.vline(x + 6, g - 17, g - 11, P.plaster[2]);
    }
  } else {
    // 茶箱：贴红纸的木箱
    for (const [x, y] of [
      [4, g - 16],
      [12, g - 16],
      [8, g - 22],
    ] as const) {
      p.rect(x, y, 8, 6, W[3]);
      p.hline(x, x + 7, y, W[4]);
      p.vline(x + 7, y, y + 5, W[1]);
      p.rect(x + 3, y + 1, 2, 4, RED[2]);
    }
  }
  // 车轮
  p.ring(10, g - 5, 4, 4, W[1]);
  p.ring(10, g - 5, 3, 3, W[3]);
  for (const [dx, dy] of [
    [0, -3],
    [0, 3],
    [-3, 0],
    [3, 0],
  ] as const) p.line(10, g - 5, 10 + dx, g - 5 + dy, W[2]);
  p.set(10, g - 5, P.iron[2]);
}

export const MING: CultureArt = {
  kit: ming,
  landmark,
  gate,
  wallBody,
  wallTower,
  far: { roof: [R[0], R[1], R[2]], wall: [BR[1], BR[2], BR[3]], accent: [RED[0], RED[1], RED[2]] },
  farHouse,
  farTower,
  farWall,
  props: {
    flag: [RED[1], RED[2], RED[3]],
    stall: [P.cloth.blue, P.cloth.cream],
    lamp,
    well,
    bench,
    cart,
  },
};
