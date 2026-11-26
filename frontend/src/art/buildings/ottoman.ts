// 奥斯曼风格（ottoman）：石砌的底层，上层是涂成白、赭黄或牛血红的木骨墙、整层向外悬挑在一排斜撑上，
// 出挑的木格子凸窗（cumba），红瓦低缓的四坡顶、出檐很深；公共建筑是一排铅灰的小穹顶（客栈与学堂的样子），
// 银行用石与砖相间的砌法；地标是带两座铅笔形宣礼塔、层层叠落的穹顶清真寺；城墙与城门是要塞的圆塔与铅皮尖顶；
// 街上有铜吊灯、大理石的泉亭（çeşme）、铺花毯的木榻与装香料的手推车；远景里是穹顶与细高的塔。
// 尖顶饰（alem）只画成金色的尖杆与圆球，不画任何宗教符号。
import type { Facility } from "../../store/game";
import { P, ink, overlay } from "../palette";
import type { Px } from "../px";
import { drawEmblem } from "./emblems";
import { type Canvas, type Ramp, ashlar, fillProfile, h01, hipProfile, plaster, tintOpaque } from "./kit";
import { glass, lantern, opening, steps, wallLamp } from "./parts";
import { type DoorKind, type Kit, type RoofKind, type WallKind, type WinKind, eaveShadow, pickTone } from "./style";
import { type CultureArt, type FarCtx, farWindows, spots, wrap, wrapCourses } from "./townArt";

/** 红瓦 */
const T: Ramp = P.brick;
/** 铅皮（穹顶、尖顶） */
const LD: Ramp = P.slate;
/** 浅色石灰岩 */
const KS: Ramp = [P.plaster[0], P.plaster[1], P.plaster[2], P.plaster[3], P.white];
const W = P.wood;
/** 伊兹尼克瓷砖的钴蓝与碧青 */
const IZ: Ramp = [P.cloth.navy[1], P.cloth.blue[1], P.cloth.blue[2], P.teal[3]];
/** 上层木骨墙的三种漆色：白灰、赭黄、牛血红 */
const PAINTS: readonly Ramp[] = [
  [P.plaster[1], P.plaster[2], P.plaster[3], P.white],
  [P.gold[0], P.gold[1], P.cloth.ochre[2], P.gold[3]],
  [P.brick[0], P.brick[1], P.brick[2], P.brick[3]],
];

// ───────────────────────── 屋顶 ─────────────────────────

/** 土耳其瓦：每 2 列一道细瓦垄，每 3 行一道搭接，右坡背光。 */
function tileTex(x0: number, x1: number, inset: number) {
  const mid = (x0 + x1) / 2;
  return (xx: number, _yy: number, e: { fromTop: number; fromBot: number }): string => {
    const d = Math.min(xx - x0, x1 - xx);
    if (e.fromBot === 0) return (xx - x0) % 2 ? T[0] : T[2];
    if (e.fromTop === 0) return d < inset && xx > mid ? T[2] : T[3];
    let col: string = (xx - x0) % 2 ? T[2] : T[3];
    if ((e.fromBot - 1) % 3 === 0) col = T[1];
    if (d < inset && xx > mid) col = col === T[3] ? T[2] : T[1];
    if (d < inset && xx < mid && e.fromTop === 1) col = T[4];
    return col;
  };
}

/** 低缓的四坡红瓦顶，出檐深远，檐下三行阴影。返回屋面顶行与左右端。 */
function hipRoof(c: Canvas, x: number, w: number, y: number, h: number, over: number): { yt: number; x0: number; x1: number; inset: number } {
  const p = c.p;
  const x0 = x - over;
  const x1 = x + w - 1 + over;
  const yb = y + 1;
  const yt = yb - h + 1;
  const inset = Math.min(Math.floor((x1 - x0) / 2) - 1, Math.round(h * 1.6));
  fillProfile(p, x0, x1, hipProfile(x0, x1, yt, yb, inset, 1, 2), tileTex(x0, x1, inset));
  p.hline(x0 + inset - 1, x1 - inset + 1, yt - 1, T[1]);
  for (let xx = x0 + inset; xx <= x1 - inset; xx += 2) p.set(xx, yt - 1, T[3]);
  // 木檐板
  p.hline(x0 + 1, x1 - 1, yb + 1, W[1]);
  c.markRoof(x0, yt - 1, x1 - x0 + 1, h + 1, T, 1);
  c.eave(x0 + 1, x1 - 1, yb + 1);
  eaveShadow(c, x, w, y + 3, 2);
  return { yt, x0, x1, inset };
}

/** 金色尖顶饰：细杆上两颗金球、顶上一个尖。底在 y，返回最高点。 */
function alem(p: Px, cx: number, y: number, tall = 6): number {
  p.vline(cx, y - tall, y, P.gold[1]);
  p.set(cx, y - 2, P.gold[3]).set(cx - 1, y - 2, P.gold[2]).set(cx + 1, y - 2, P.gold[1]);
  p.set(cx, y - tall + 2, P.gold[3]).set(cx - 1, y - tall + 2, P.gold[2]);
  p.set(cx, y - tall - 1, P.gold[4]);
  return y - tall - 1;
}

/** 铅皮穹顶：中心 cx，底在 y，半径 r；竖向铅皮接缝，左上高光。返回最高点（含尖顶饰）。 */
function leadDome(c: Canvas, cx: number, y: number, r: number, finial = true): number {
  const p = c.p;
  const hgt = Math.max(2, Math.round(r * 0.85));
  for (let row = 0; row <= hgt; row++) {
    const t = row / hgt;
    const half = Math.round(r * Math.sqrt(Math.max(0, 1 - t * t)));
    const yy = y - row;
    for (let xx = cx - half; xx <= cx + half; xx++) {
      const u = (xx - cx) / Math.max(1, r);
      let col: string = u < -0.4 ? LD[3] : u > 0.45 ? LD[1] : LD[2];
      if (u < -0.1 && u > -0.55 && t > 0.3 && t < 0.75) col = LD[4];
      if (xx === cx + half) col = LD[0];
      p.set(xx, yy, col);
    }
  }
  // 铅皮接缝
  if (r >= 5) {
    for (const k of [-0.5, 0, 0.5]) {
      for (let row = 1; row < hgt - 1; row++) {
        const t = row / hgt;
        const xx = Math.round(cx + k * r * Math.sqrt(Math.max(0, 1 - t * t)));
        if (p.get(xx, y - row) !== 0) p.set(xx, y - row, k > 0 ? LD[1] : LD[2]);
      }
    }
  }
  c.markRoof(cx - r, y - hgt, r * 2 + 1, hgt + 1, LD, 0);
  if (!finial) return y - hgt;
  return alem(p, cx, y - hgt - 1, r >= 8 ? 6 : 4);
}

/** 一排小穹顶（客栈、学堂、门廊）：x..x+w-1 平铺在 y（铅皮平顶）上；返回最高点。 */
function domeRow(c: Canvas, x: number, w: number, y: number, r: number): number {
  const p = c.p;
  // 平顶：一道铅灰与一道石檐
  p.hline(x - 2, x + w + 1, y, KS[4]);
  p.hline(x - 2, x + w + 1, y + 1, KS[1]);
  p.rect(x - 1, y - 2, w + 2, 2, LD[2]);
  p.hline(x - 1, x + w, y - 2, LD[3]);
  c.markRoof(x - 1, y - 2, w + 2, 2, LD, 0);
  const n = Math.max(1, Math.floor((w + 2) / (r * 2 + 3)));
  let peak = y - 2;
  for (let i = 0; i < n; i++) {
    const cx = x + Math.round(((i + 0.5) * w) / n);
    peak = Math.min(peak, leadDome(c, cx, y - 3, r, r >= 5));
  }
  eaveShadow(c, x, w, y + 2, 1);
  return peak;
}

function roof(c: Canvas, x: number, w: number, y: number, kind: RoofKind = "main"): number {
  const p = c.p;
  if (kind === "porch") return domeRow(c, x, w, y, w >= 36 ? 5 : 6);
  if (kind === "grand") {
    // 客栈 / 学堂：铅皮平顶上一排小穹顶，正中一座大穹顶
    const r = Math.min(13, Math.max(7, Math.round(w * 0.13)));
    const cx = x + Math.floor(w / 2);
    let peak = domeRow(c, x, w, y, 4);
    // 大穹顶的八角鼓座
    const dy = y - 3;
    p.rect(cx - r, dy - 4, r * 2 + 1, 5, KS[3]);
    p.hline(cx - r, cx + r, dy - 4, KS[4]);
    for (let xx = cx - r + 2; xx <= cx + r - 2; xx += 3) p.vline(xx, dy - 3, dy - 1, c.o.lit ? P.lamp[1] : ink.brown);
    peak = Math.min(peak, leadDome(c, cx, dy - 5, r));
    return peak;
  }
  if (kind === "tower") {
    // 钟塔的顶：一圈带栏杆的阳台，上面一段细塔身，戴铅皮的铅笔尖顶
    const cx = x + Math.floor(w / 2);
    p.rect(x - 2, y - 2, w + 4, 3, KS[3]);
    p.hline(x - 2, x + w + 1, y - 2, KS[4]);
    p.hline(x - 2, x + w + 1, y, KS[1]);
    // 钟乳石檐托
    for (let xx = x - 1; xx < x + w + 1; xx += 2) p.set(xx, y + 1, KS[2]);
    p.hline(x - 2, x + w + 1, y - 6, KS[4]);
    for (let xx = x - 2; xx <= x + w + 1; xx += 2) p.vline(xx, y - 5, y - 3, KS[2]);
    const sw = Math.max(8, w - 10);
    const sx = cx - Math.floor(sw / 2);
    const st = y - 16;
    plaster(p, sx, st, sw, 14, KS, c.seed + 7);
    p.vline(sx, st, y - 3, KS[4]);
    p.vline(sx + sw - 1, st, y - 3, KS[1]);
    p.rect(cx - 1, st + 4, 3, 6, c.o.lit ? P.lamp[1] : ink.brown);
    p.set(cx, st + 3, ink.brown);
    // 铅笔尖顶
    const ch = 14;
    const x0 = sx - 1;
    const x1 = sx + sw;
    fillProfile(
      p,
      x0,
      x1,
      (xx) => {
        if (xx < x0 || xx > x1) return null;
        const d = Math.min(xx - x0, x1 - xx) + 0.5;
        return [st - Math.round((d / ((x1 - x0) / 2)) * ch), st] as const;
      },
      (xx) => {
        const u = (xx - x0) / (x1 - x0);
        return u < 0.35 ? LD[3] : u < 0.65 ? LD[2] : LD[1];
      },
    );
    p.hline(x0 - 1, x1 + 1, st, LD[2]);
    c.markRoof(x0, st - ch, x1 - x0 + 1, ch + 1, LD, 0);
    return alem(p, cx, st - ch - 1, 5);
  }
  if (kind === "shed") {
    const r = hipRoof(c, x, w, y, 7, 3);
    return r.yt - 1;
  }
  if (kind === "gable") {
    // 四坡瓦顶上的瞭望小阁（cihannüma）：一圈窗、自带小四坡顶
    const h = Math.min(10, Math.max(6, Math.round(w * 0.12) + 3));
    const r = hipRoof(c, x, w, y, h, 5);
    const cw = Math.max(12, Math.round(w * 0.42));
    const cx = x + Math.floor(w / 2);
    const bx = cx - Math.floor(cw / 2);
    const bt = r.yt - 7;
    const tone = pickTone(c, PAINTS);
    p.rect(bx, bt, cw, 8, tone[2]);
    p.vline(bx, bt, bt + 7, tone[3]);
    p.vline(bx + cw - 1, bt, bt + 7, tone[0]);
    for (let xx = bx + 2; xx < bx + cw - 2; xx += 4) glass(c, xx, bt + 2, 2, 4);
    const r2 = hipRoof(c, bx, cw, bt, 5, 3);
    return r2.yt - 1;
  }
  const h = Math.min(10, Math.max(6, Math.round(w * 0.12) + 3));
  const r = hipRoof(c, x, w, y, h, 5);
  let peak = r.yt - 1;
  if (w >= 30 && w < 70) {
    // 小烟囱：圆筒戴小铅帽
    const chx = x + Math.round(w * 0.7);
    p.rect(chx, r.yt - 4, 3, 6, KS[3]);
    p.vline(chx, r.yt - 4, r.yt + 1, KS[4]);
    p.hline(chx - 1, chx + 3, r.yt - 5, LD[2]);
    p.set(chx + 1, r.yt - 6, LD[3]);
    peak = Math.min(peak, r.yt - 6);
  }
  return peak;
}

// ───────────────────────── 门窗 ─────────────────────────

const winSizes: Record<WinKind, readonly [number, number]> = {
  std: [6, 10],
  tall: [6, 13],
  small: [4, 6],
  round: [7, 7],
  wide: [14, 9],
};

const doorSizes: Record<DoorKind, readonly [number, number]> = {
  std: [8, 12],
  double: [12, 14],
  grand: [14, 16],
  open: [16, 12],
  iron: [12, 14],
  barn: [18, 16],
};

/** 尖拱的每行缩进（宽 w，第 row 行）。 */
function pointed(w: number, row: number): number {
  const k = Math.ceil(w / 2);
  if (row >= k) return 0;
  return Math.max(0, Math.round((k - row) * 0.9) - 1);
}

function window(c: Canvas, x: number, y: number, kind: WinKind = "std"): void {
  const p = c.p;
  const [w, h] = winSizes[kind];
  const lit = c.o.lit;
  if (kind === "round") {
    p.circle(x + 3, y + 3, 3, IZ[1]);
    p.circle(x + 3, y + 3, 2, lit ? P.lamp[1] : ink.brown);
    p.set(x + 3, y + 3, IZ[3]);
    return;
  }
  if (kind === "small") {
    // 小尖拱窗
    for (let row = 0; row < h; row++) {
      const k = pointed(w, row);
      p.hline(x - 1 + k, x + w - k, y + row - 1, KS[4]);
    }
    for (let row = 0; row < h; row++) {
      const k = pointed(w - 2, row);
      p.hline(x + k, x + w - 1 - k, y + row, lit ? P.lamp[1] : ink.brown);
    }
    return;
  }
  if (kind === "wide") {
    // 凸窗（cumba）：木框盒子，三格木格窗，顶上斜面小瓦檐，底下两根斜撑
    p.rect(x - 2, y - 1, w + 4, h + 2, W[2]);
    p.hline(x - 2, x + w + 1, y - 1, W[3]);
    p.vline(x + w + 1, y - 1, y + h, W[1]);
    for (let i = 0; i < 3; i++) {
      const gx = x + 1 + i * 4;
      glass(c, gx, y + 1, 3, h - 3);
      for (let yy = y + 2; yy < y + h - 2; yy += 2) p.set(gx + 1, yy, W[1]);
    }
    p.hline(x - 3, x + w + 2, y - 2, T[2]);
    p.hline(x - 2, x + w + 1, y - 3, T[3]);
    p.line(x - 1, y + h + 1, x + 2, y + h + 4, W[1]);
    p.line(x + w, y + h + 1, x + w - 3, y + h + 4, W[1]);
    c.markRoof(x - 3, y - 3, w + 6, 2, T, 0);
    c.ledge(x - 2, x + w + 1, y + h + 1);
    return;
  }
  // 方窗 + 上方的小尖拱窗（tepe penceresi），石框
  const ah = 3;
  p.rect(x - 1, y - 1, w + 2, h + 2, KS[3]);
  p.hline(x - 1, x + w, y - 1, KS[4]);
  for (let row = 0; row < ah; row++) {
    const k = pointed(w - 2, row);
    p.hline(x + 1 + k, x + w - 2 - k, y + row, lit ? P.lamp[1] : IZ[1]);
  }
  const gy = y + ah + 1;
  const gh = h - ah - 1;
  p.rect(x, gy, w, gh, W[1]);
  // 木格子（kafes）：斜方格
  for (let yy = gy; yy < gy + gh; yy++) {
    for (let xx = x; xx < x + w; xx++) {
      const on = (xx + yy) % 3 === 0 || (xx - yy + 99) % 3 === 0;
      p.set(xx, yy, on ? W[2] : lit ? P.lamp[1] : ink.brown);
    }
  }
  p.hline(x - 1, x + w, y + h, KS[4]);
  c.ledge(x - 1, x + w, y + h);
}

function door(c: Canvas, cx: number, bottom: number, kind: DoorKind = "std"): void {
  const p = c.p;
  const [w, h] = doorSizes[kind];
  const x = cx - Math.floor(w / 2);
  const y = bottom - h;
  if (kind === "grand" || kind === "double") {
    // 礼仪门（taç kapı）：高出门洞的石框、尖拱门头里一层层的钟乳石雕
    const fx = x - 4;
    const fw = w + 8;
    const fy = y - 6;
    p.rect(fx, fy, fw, bottom - fy, KS[3]);
    p.hline(fx, fx + fw - 1, fy, KS[4]);
    p.vline(fx, fy, bottom - 1, KS[4]);
    p.vline(fx + fw - 1, fy, bottom - 1, KS[1]);
    p.rect(fx + 1, fy + 1, fw - 2, 1, IZ[1]);
    for (let row = 0; row < bottom - y + 4; row++) {
      const k = pointed(w + 2, row);
      p.hline(x - 1 + k, x + w - k, y - 4 + row, KS[2]);
    }
    // 钟乳石：门头里交错的小格
    for (let row = 0; row < 4; row++) {
      const k = pointed(w + 2, row);
      for (let xx = x - 1 + k; xx <= x + w - k; xx++) if ((xx + row) % 2 === 0) p.set(xx, y - 4 + row, KS[1]);
    }
  } else {
    // 普通门：石框，门上一小块尖拱瓷砖门楣
    p.rect(x - 2, y - 4, w + 4, h + 4, KS[3]);
    p.hline(x - 2, x + w + 1, y - 4, KS[4]);
    for (let row = 0; row < 3; row++) {
      const k = pointed(w, row);
      p.hline(x + k, x + w - 1 - k, y - 3 + row, IZ[1]);
    }
  }
  if (kind === "open") {
    opening(c, x, y, w, h);
    return;
  }
  const leaf = kind === "iron" ? P.iron : W;
  p.rect(x, y, w, h, leaf[2]);
  p.vline(x, y, bottom - 1, leaf[3]);
  p.vline(x + w - 1, y, bottom - 1, leaf[1]);
  if (w >= 10) p.vline(cx, y, bottom - 1, leaf[0]);
  if (kind === "barn") {
    for (let xx = x + 2; xx < x + w - 1; xx += 3) p.vline(xx, y + 1, bottom - 1, W[1]);
    return;
  }
  // 门板上的方格嵌板与铜门环
  for (const yy of [y + 2, y + Math.floor(h / 2) + 1]) {
    for (const px of w >= 10 ? [x + 1, cx + 1] : [x + 1]) {
      const pw = w >= 10 ? Math.floor(w / 2) - 2 : w - 2;
      p.rect(px, yy, pw, Math.floor(h / 2) - 3, leaf[1]);
      p.hline(px, px + pw - 1, yy, leaf[3]);
    }
  }
  p.set(cx - 2, y + Math.floor(h / 2), P.gold[3]).set(cx + 1, y + Math.floor(h / 2), P.gold[3]);
}

/** 绿底金框的匾（levha）。 */
function sign(c: Canvas, cx: number, y: number, fac: Facility): number {
  const p = c.p;
  const x = cx - 7;
  p.rect(x, y, 15, 13, P.gold[1]);
  p.hline(x, x + 14, y, P.gold[3]);
  p.rect(x + 1, y + 1, 13, 11, P.gold[2]);
  p.rect(x + 2, y + 2, 11, 9, P.leaf[0]);
  drawEmblem(p, fac, x + 3, y + 2, ottoman.flag);
  c.ledge(x, x + 14, y);
  return 13;
}

// ───────────────────────── 墙 ─────────────────────────

/** 石与砖相间（almaşık）：三行石、一道两行的砖带。 */
function almasik(p: Px, x: number, y: number, w: number, h: number, seed: number): void {
  ashlar(p, x, y, w, h, KS, { course: 4, min: 6, max: 10, seed, light: 2 });
  for (let yy = y + 4; yy < y + h - 1; yy += 7) {
    for (let xx = x; xx < x + w; xx++) {
      p.set(xx, yy, T[1]);
      p.set(xx, yy + 1, (xx + (yy >> 1)) % 4 === 0 ? T[1] : T[2]);
    }
  }
}

/** 木骨墙：漆面，深色的立柱、横梁与斜撑。 */
function himis(c: Canvas, x: number, y: number, w: number, h: number, tone: Ramp): void {
  const p = c.p;
  p.rect(x, y, w, h, tone[2]);
  p.hline(x, x + w - 1, y + h - 1, tone[1]);
  for (let xx = x + 8; xx < x + w - 4; xx += 10) {
    p.vline(xx, y, y + h - 1, W[1]);
    if (h01(xx, y, c.seed) < 0.4) p.line(xx + 1, y + h - 2, xx + 5, y + 2, tone[1]);
  }
  p.vline(x, y, y + h - 1, tone[3]);
}

function wall(c: Canvas, x: number, y: number, w: number, h: number, kind: WallKind = "main"): void {
  const p = c.p;
  if (kind === "stone") {
    almasik(p, x, y, w, h, c.seed + x);
    p.vline(x, y, y + h - 1, KS[4]);
    p.vline(x + w - 1, y, y + h - 1, KS[1]);
    return;
  }
  if (kind === "ground") {
    ashlar(p, x, y, w, h, KS, { course: 4, min: 5, max: 9, seed: c.seed + y, light: 2 });
    p.vline(x, y, y + h - 1, KS[4]);
    p.vline(x + w - 1, y, y + h - 1, KS[1]);
    return;
  }
  if (kind === "upper") {
    // 上层整层悬挑：比底层每边宽出 2 像素
    const tone = pickTone(c, PAINTS);
    himis(c, x - 2, y, w + 4, h, tone);
    p.rect(x - 2, y, 2, h, W[1]);
    p.rect(x + w, y, 2, h, W[0]);
    p.vline(x - 2, y, y + h - 1, W[2]);
    return;
  }
  // main / plain：白灰墙，墙脚一段石砌
  plaster(p, x, y, w, h, KS, c.seed + x + y);
  const bh = Math.min(h, kind === "plain" ? 4 : 6);
  ashlar(p, x, y + h - bh, w, bh, KS, { course: bh > 4 ? 3 : bh, min: 5, max: 9, seed: c.seed + 3, light: 2 });
  p.vline(x, y, y + h - 1, KS[4]);
  p.vline(x + w - 1, y, y + h - 1, KS[1]);
  if (kind === "main") {
    for (let xx = x + 10; xx < x + w - 6; xx += 12) p.vline(xx, y, y + h - bh - 1, W[1]);
    p.hline(x, x + w - 1, y + 2, W[1]);
  }
}

export const ottoman: Kit = {
  style: "ottoman",
  flag: [P.red[1], P.red[2], P.red[3]],
  trim: W,
  plinthH: 2,
  awning: [P.cloth.crimson, P.cloth.cream],
  lamp: "brass",
  tavernRoof: "gable",
  wall,
  plinth(c, x, w, h) {
    const p = c.p;
    const g = c.gy;
    ashlar(p, x, g - h, w, h, KS, { course: Math.max(2, h), min: 7, max: 12, seed: c.seed + 13, light: 2 });
    p.hline(x, x + w - 1, g - h, KS[4]);
  },
  roof,
  band(c, x, w, y) {
    // 悬挑的楼板：一道木梁，梁下两端与中间的斜撑
    const p = c.p;
    p.hline(x - 2, x + w + 1, y, W[3]);
    p.hline(x - 2, x + w + 1, y + 1, W[1]);
    for (const bx of [x - 2, x + w + 1]) p.set(bx, y + 2, W[1]);
    for (let bx = x + 6; bx < x + w - 4; bx += 14) {
      p.set(bx, y + 2, W[2]).set(bx + 1, y + 3, W[1]);
    }
    p.line(x - 1, y + 2, x + 1, y + 4, W[1]);
    p.line(x + w, y + 2, x + w - 2, y + 4, W[1]);
    eaveShadow(c, x, w, y + 2, 1);
  },
  post(c, x, y0, y1, kind = "post") {
    const p = c.p;
    if (kind === "column") {
      // 大理石柱：柱础、柱身、钟乳石柱头
      p.rect(x, y0, 3, y1 - y0 + 1, KS[3]);
      p.vline(x, y0, y1, KS[4]);
      p.vline(x + 2, y0, y1, KS[1]);
      p.rect(x - 1, y1 - 1, 5, 2, KS[2]);
      p.rect(x - 1, y0, 5, 3, KS[3]);
      p.set(x - 1, y0 + 2, KS[1]).set(x + 3, y0 + 2, KS[1]).set(x + 1, y0 + 2, KS[1]);
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
    // 墙角铜吊灯；檐下一座小小的鸟屋（带穹顶的小盒子）
    wallLamp(c, x + w - 1, y + 9, "brass", 1);
    const bx = x + 5;
    const by = y + 6;
    p.rect(bx, by + 2, 5, 3, KS[3]);
    p.set(bx + 2, by + 3, ink.brown);
    p.hline(bx - 1, bx + 5, by + 5, KS[2]);
    p.hline(bx + 1, bx + 3, by + 1, LD[2]);
    p.set(bx + 2, by, LD[3]).set(bx + 2, by - 1, P.gold[2]);
    // 墙脚一盆天竺葵（冬天只剩花盆）
    const g = c.gy;
    const px = x - 4;
    p.rect(px, g - 4, 5, 4, T[1]);
    p.hline(px, px + 4, g - 4, T[2]);
    if (c.o.season !== 3) {
      p.rect(px, g - 7, 5, 3, P.leaf[1]);
      p.set(px + 1, g - 8, P.leaf[2]).set(px + 3, g - 8, P.leaf[2]);
      for (const [dx, dy] of [
        [0, -8],
        [2, -9],
        [4, -7],
      ] as const)
        p.set(px + dx, g + dy, c.o.season === 2 ? P.autumn[2] : P.red[3]);
    }
  },
};

// ───────────────────────── 地标：清真寺 ─────────────────────────

/** 铅笔形宣礼塔：方座、圆柱塔身、两圈阳台、细长的铅皮尖顶。中心 cx，底在 g，塔身顶在 top。 */
function minaret(c: Canvas, cx: number, g: number, top: number): void {
  const p = c.p;
  // 方座
  ashlar(p, cx - 4, g - 26, 9, 26, KS, { course: 4, min: 3, max: 5, seed: cx, light: 2 });
  p.vline(cx - 4, g - 26, g - 1, KS[4]);
  p.vline(cx + 4, g - 26, g - 1, KS[1]);
  p.hline(cx - 5, cx + 5, g - 27, KS[4]);
  // 圆柱塔身（左亮右暗）
  for (let xx = cx - 2; xx <= cx + 2; xx++) p.vline(xx, top, g - 28, xx < cx ? KS[4] : xx === cx ? KS[3] : KS[1]);
  // 阳台：外挑的一圈，下有钟乳石托，上有栏杆
  for (const by of [top + Math.round((g - 28 - top) * 0.35), top + 6]) {
    p.hline(cx - 3, cx + 3, by + 2, KS[2]);
    p.hline(cx - 4, cx + 4, by + 1, KS[3]);
    p.hline(cx - 4, cx + 4, by, KS[4]);
    p.hline(cx - 4, cx + 4, by - 3, KS[4]);
    p.set(cx - 4, by - 2, KS[2]).set(cx - 2, by - 2, KS[2]).set(cx, by - 2, KS[2]).set(cx + 2, by - 2, KS[2]).set(cx + 4, by - 2, KS[2]);
    p.set(cx - 4, by - 1, KS[2]).set(cx + 4, by - 1, KS[2]);
    c.ledge(cx - 4, cx + 4, by - 3);
  }
  // 铅皮尖顶
  const ch = 16;
  for (let row = 0; row < ch; row++) {
    const half = Math.max(0, Math.round(2.5 * (1 - row / ch)));
    p.hline(cx - half, cx + half, top - 1 - row, row % 2 ? LD[2] : LD[3]);
    if (half > 0) p.set(cx + half, top - 1 - row, LD[1]);
  }
  c.markRoof(cx - 3, top - ch, 7, ch, LD, 0);
  alem(p, cx, top - ch - 1, 4);
}

function landmark(c: Canvas): void {
  const p = c.p;
  const g = c.gy;
  const cx = 48;
  // 宣礼塔在两侧
  minaret(c, 13, g, g - 118);
  minaret(c, 83, g, g - 118);
  // 礼拜殿：石砌方殿，两层尖拱窗
  const bw = 60;
  const bx = cx - bw / 2;
  const bt = g - 30;
  ashlar(p, bx, bt, bw, 30, KS, { course: 4, min: 6, max: 11, seed: 3, light: 2 });
  p.vline(bx, bt, g - 1, KS[4]);
  p.vline(bx + bw - 1, bt, g - 1, KS[1]);
  for (let i = 0; i < 6; i++) {
    const wx = bx + 5 + i * 9 + (i > 2 ? 2 : 0);
    if (i === 2 || i === 3) continue;
    window(c, wx, bt + 3, "small");
    window(c, wx - 1, bt + 13, "std");
  }
  // 前廊：五个尖拱，上面一排小穹顶
  const ax = bx + 8;
  const aw = bw - 16;
  p.rect(ax, g - 14, aw, 14, KS[3]);
  for (let i = 0; i < 4; i++) {
    const ox = ax + 2 + i * 11;
    for (let row = 0; row < 11; row++) {
      const k = pointed(8, row);
      p.hline(ox + k, ox + 7 - k, g - 11 + row, i === 1 || i === 2 ? (c.o.lit ? P.lamp[1] : ink.brown) : KS[1]);
    }
  }
  door(c, cx, g, "grand");
  domeRow(c, ax, aw, g - 15, 4);
  // 层层叠落的穹顶：两侧半穹顶、四角小塔、正中大穹顶
  p.hline(bx - 1, bx + bw, bt, KS[4]);
  p.hline(bx - 1, bx + bw, bt + 1, KS[1]);
  for (const sx of [bx + 12, bx + bw - 13]) leadDome(c, sx, bt - 1, 9, false);
  const dr = 18;
  const dy = bt - 8;
  p.rect(cx - dr, dy, dr * 2 + 1, 8, KS[3]);
  p.hline(cx - dr, cx + dr, dy, KS[4]);
  for (let xx = cx - dr + 3; xx <= cx + dr - 3; xx += 4) {
    p.vline(xx, dy + 2, dy + 5, c.o.lit ? P.lamp[1] : ink.brown);
    p.set(xx, dy + 1, ink.brown);
  }
  for (const tx of [cx - dr - 1, cx + dr - 1]) {
    p.rect(tx, dy - 4, 3, 12, KS[3]);
    p.vline(tx, dy - 4, dy + 7, KS[4]);
    leadDome(c, tx + 1, dy - 5, 2, false);
    p.vline(tx + 1, dy - 9, dy - 7, P.gold[2]);
  }
  leadDome(c, cx, dy - 1, dr);
  steps(c, cx, 18, 2, g, KS);
}

// ───────────────────────── 城门与城墙：要塞 ─────────────────────────

/** 尖顶的垛口（每个垛口顶上收成一个小尖）。 */
function merlon(p: Px, x: number, top: number): void {
  p.rect(x, top - 4, 5, 4, KS[3]);
  p.hline(x + 1, x + 3, top - 5, KS[3]);
  p.set(x + 2, top - 6, KS[4]);
  p.vline(x + 4, top - 4, top - 1, KS[1]);
  p.vline(x, top - 4, top - 1, KS[4]);
}

/** 圆塔：石与砖相间的圆柱（左亮右暗），顶上一圈尖垛口，戴铅皮锥顶。返回最高点。 */
function roundTower(c: Canvas, x: number, w: number, top: number, bottom: number, cap = true, capK = 0.9): number {
  const p = c.p;
  const tex = p.clone().clear();
  almasik(tex, x, top, w, bottom - top, x);
  for (let xx = x; xx < x + w; xx++) {
    const u = (xx - x) / (w - 1);
    for (let yy = top; yy < bottom; yy++) {
      const v = tex.get(xx, yy);
      if (v) p.put(xx, yy, v);
    }
    if (u > 0.72) tintOpaque(p, xx, top, 1, bottom - top, overlay.shadowLight);
    if (u > 0.88) tintOpaque(p, xx, top, 1, bottom - top, overlay.shadow);
    if (u < 0.12) tintOpaque(p, xx, top, 1, bottom - top, overlay.glow, 2);
  }
  p.hline(x - 1, x + w, top, KS[4]);
  p.hline(x - 1, x + w, top + 1, KS[1]);
  for (let xx = x; xx < x + w - 3; xx += 6) merlon(p, xx, top);
  p.rect(x + Math.floor(w / 2) - 1, top + 8, 2, 5, ink.deep);
  if (!cap) return top - 6;
  // 铅皮锥顶
  const ch = Math.round(w * capK);
  const x0 = x + 1;
  const x1 = x + w - 2;
  fillProfile(
    p,
    x0,
    x1,
    (xx) => {
      if (xx < x0 || xx > x1) return null;
      const d = Math.min(xx - x0, x1 - xx) + 0.5;
      return [top - 4 - Math.round((d / ((x1 - x0) / 2)) * ch), top - 4] as const;
    },
    (xx) => {
      const u = (xx - x0) / (x1 - x0);
      return u < 0.35 ? LD[3] : u < 0.65 ? LD[2] : LD[1];
    },
  );
  c.markRoof(x0, top - 4 - ch, x1 - x0 + 1, ch + 1, LD, 0);
  return alem(p, x + Math.floor(w / 2), top - 5 - ch, 4);
}

function gate(c: Canvas): void {
  const p = c.p;
  const g = c.gy;
  const cx = Math.floor(c.w / 2);
  const bw = 46;
  const x = cx - bw / 2;
  const top = g - 42;
  almasik(p, x, top, bw, 42, 5);
  p.hline(x - 1, x + bw, top, KS[4]);
  for (let xx = x; xx < x + bw - 3; xx += 7) merlon(p, xx, top);
  // 尖拱门洞与钟乳石门头
  const aw = 18;
  const ah = 28;
  for (let row = 0; row < ah + 3; row++) {
    const k = pointed(aw + 6, row);
    p.hline(cx - aw / 2 - 3 + k, cx + aw / 2 + 2 - k, g - ah - 3 + row, KS[4]);
  }
  for (let row = 0; row < ah; row++) {
    const k = pointed(aw, row);
    p.hline(cx - aw / 2 + k, cx + aw / 2 - 1 - k, g - ah + row, ink.brown);
  }
  for (const dx of [-aw / 2, aw / 2 - 3]) {
    p.rect(cx + dx, g - 18, 3, 18, W[1]);
    for (let yy = g - 16; yy < g - 1; yy += 3) p.set(cx + dx + 1, yy, P.iron[3]);
  }
  p.hline(cx - aw / 2 + 2, cx + aw / 2 - 3, g - 1, KS[1]);
  ottoman.sign(c, cx, top + 3, "office");
  // 两座圆塔
  roundTower(c, x - 16, 18, g - 60, g, true);
  roundTower(c, x + bw - 2, 18, g - 60, g, true);
}

function wallBody(c: Canvas, W: number, top: number): void {
  const p = c.p;
  const H = c.gy;
  wrapCourses(p, W, top, H - top, KS, 4, 6, 10, c.seed, 2);
  // 砖带：每 8 行一道两行的砖
  for (let yy = top + 5; yy < H - 2; yy += 8) {
    for (let x = 0; x < W; x++) {
      p.put(x, yy, T[1]);
      p.put(x, yy + 1, (x + (yy >> 1)) % 4 === 0 ? T[1] : T[2]);
    }
  }
  for (let x = 0; x < W; x++) {
    p.put(x, top, KS[4]);
    p.put(x, top + 1, KS[1]);
  }
  for (const x of spots(W, 8)) wrap(W, (dx) => merlon(p, x + dx, top));
}

function wallTower(c: Canvas, x: number, top: number): void {
  roundTower(c, x, 16, top - 8, c.gy, true, 0.75);
}

// ───────────────────────── 远景 ─────────────────────────

function farHouse(k: FarCtx, x: number, w: number, h: number, seed: number): void {
  const p = k.p;
  const b = k.base;
  const f = k.f;
  const wallTop = b - h;
  // 底层石墙，上层悬挑、漆成不同颜色
  const gh = Math.max(3, Math.round(h * 0.45));
  p.rect(x, b - gh, w, gh, f.wall[1]);
  p.vline(x + w - 1, b - gh, b - 1, f.wall[0]);
  const tone = PAINTS[Math.floor(h01(seed, 7, 3) * PAINTS.length)];
  p.rect(x - 1, wallTop, w + 2, h - gh, tone[1]);
  p.vline(x - 1, wallTop, b - gh - 1, tone[2]);
  p.vline(x + w, wallTop, b - gh - 1, tone[0]);
  p.hline(x - 1, x + w, b - gh, W[1]);
  farWindows(k, x, wallTop, w, h - gh, seed);
  // 低缓的四坡红瓦，出檐深
  const over = 3;
  const rh = Math.max(3, Math.round(w * 0.18));
  const x0 = x - over;
  const x1 = x + w - 1 + over;
  const inset = Math.min(Math.floor((x1 - x0) / 2), rh * 2);
  for (let xx = x0; xx <= x1; xx++) {
    const d = Math.min(xx - x0, x1 - xx);
    const t = Math.min(1, d / inset);
    const top = wallTop - Math.round(t * rh);
    p.vline(xx, top, wallTop, xx > (x0 + x1) / 2 + inset / 2 ? f.roof[0] : f.roof[1]);
    if (xx < (x0 + x1) / 2) p.set(xx, top, f.roof[2]);
  }
  p.hline(x0, x1, wallTop + 1, W[0]);
  k.roofs.push([x0, wallTop - rh, x1 - x0 + 1, rh + 1]);
}

/** 远景的清真寺：穹顶、两侧半穹顶与一两座铅笔形宣礼塔。 */
function farMosque(k: FarCtx, x: number, seed: number): number {
  const p = k.p;
  const b = k.base;
  const f = k.f;
  const cx = x + 16;
  p.rect(cx - 12, b - 10, 25, 10, f.wall[2]);
  p.vline(cx + 12, b - 10, b - 1, f.wall[0]);
  k.lights.push([cx - 6, b - 5], [cx + 6, b - 5]);
  for (const sx of [cx - 8, cx + 8]) {
    p.ellipse(sx, b - 10, 4, 3, f.accent[1]);
    p.rect(sx - 5, b - 9, 11, 2, f.wall[2]);
  }
  p.rect(cx - 7, b - 14, 15, 4, f.wall[2]);
  p.ellipse(cx, b - 14, 7, 6, f.accent[1]);
  p.rect(cx - 8, b - 13, 17, 3, f.wall[2]);
  p.set(cx - 3, b - 18, f.accent[2]).set(cx - 2, b - 19, f.accent[2]);
  p.vline(cx, b - 23, b - 20, P.gold[2]);
  k.roofs.push([cx - 7, b - 20, 15, 7]);
  const two = h01(seed, 5, 2) < 0.6;
  for (const mx of two ? [x + 1, x + 31] : [x + 31]) {
    p.rect(mx - 1, b - 30, 3, 30, f.wall[2]);
    p.vline(mx + 1, b - 30, b - 1, f.wall[0]);
    p.hline(mx - 2, mx + 2, b - 22, f.wall[2]);
    p.vline(mx, b - 36, b - 31, f.accent[1]);
    p.set(mx, b - 37, P.gold[2]);
    k.roofs.push([mx - 1, b - 36, 3, 6]);
  }
  return 34;
}

function farTower(k: FarCtx, x: number, seed: number): number {
  if (h01(seed, 11, 1) < 0.7) return farMosque(k, x, seed);
  // 要塞圆塔
  const p = k.p;
  const b = k.base;
  const f = k.f;
  p.rect(x, b - 26, 10, 26, f.wall[1]);
  p.vline(x, b - 26, b - 1, f.wall[2]);
  p.vline(x + 9, b - 26, b - 1, f.wall[0]);
  for (let yy = b - 22; yy < b; yy += 6) p.hline(x, x + 9, yy, f.roof[0]);
  for (let row = 0; row < 9; row++) {
    const half = Math.round(5.5 * (1 - row / 9));
    p.hline(x + 4 - half, x + 5 + half, b - 27 - row, f.accent[1]);
  }
  k.roofs.push([x - 1, b - 36, 12, 10]);
  k.lights.push([x + 4, b - 15]);
  return 12;
}

function farWall(k: FarCtx, top: number): void {
  const p = k.p;
  const W = k.W;
  p.rect(0, top, W, 8, KS[2]);
  p.hline(0, W - 1, top, KS[3]);
  p.hline(0, W - 1, top + 4, T[1]);
  const n = Math.max(1, Math.round(W / 5));
  for (let j = 0; j < n; j++) {
    const mx = Math.round((j * W) / n);
    p.rect(mx, top - 2, 3, 2, KS[3]);
    p.set(mx + 1, top - 3, KS[3]);
  }
}

// ───────────────────────── 街道小物件 ─────────────────────────

/** 木柱弯臂上挂一盏铜灯。 */
function lamp(c: Canvas): void {
  const p = c.p;
  const g = c.gy;
  p.rect(2, g - 3, 7, 3, KS[2]);
  p.hline(2, 8, g - 3, KS[3]);
  p.rect(4, g - 26, 3, 23, W[2]);
  p.vline(4, g - 26, g - 4, W[3]);
  p.vline(6, g - 26, g - 4, W[1]);
  p.set(5, g - 27, P.gold[3]);
  // 卷曲的铁臂
  p.hline(6, 12, g - 24, P.iron[1]);
  p.set(13, g - 23, P.iron[1]).set(8, g - 22, P.iron[1]).set(9, g - 21, P.iron[1]);
  lantern(c, 12, g - 22, "brass");
}

/** 泉亭（çeşme）：大理石方块，尖拱龛里一只铜龙头流进水槽，顶上一道深檐。 */
function well(c: Canvas): void {
  const p = c.p;
  const g = c.gy;
  p.rect(3, g - 22, 18, 22, KS[3]);
  p.vline(3, g - 22, g - 1, KS[4]);
  p.vline(20, g - 22, g - 1, KS[1]);
  // 尖拱龛
  for (let row = 0; row < 13; row++) {
    const k = pointed(10, row);
    p.hline(7 + k, 16 - k, g - 19 + row, row < 3 ? IZ[1] : KS[1]);
  }
  for (let row = 0; row < 3; row++) {
    const k = pointed(10, row);
    for (let xx = 7 + k; xx <= 16 - k; xx++) if ((xx + row) % 2 === 0) p.set(xx, g - 19 + row, IZ[2]);
  }
  // 龙头与水
  p.set(11, g - 11, P.gold[2]).set(12, g - 11, P.gold[3]);
  p.vline(12, g - 10, g - 6, P.sea[4]);
  // 水槽
  p.rect(5, g - 5, 14, 3, KS[2]);
  p.hline(5, 18, g - 5, KS[4]);
  p.hline(6, 17, g - 4, P.sea[3]);
  // 深檐与小穹顶
  p.hline(0, 23, g - 23, W[3]);
  p.hline(1, 22, g - 24, T[2]);
  p.hline(2, 21, g - 25, T[3]);
  p.ellipse(11.5, g - 26, 3, 2, LD[2]);
  p.set(11, g - 28, LD[4]);
  p.vline(12, g - 31, g - 29, P.gold[2]);
}

/** 木榻：矮木座铺一条红蓝相间的花毯。 */
function bench(p: Px): void {
  const g = p.h;
  p.rect(1, g - 4, 16, 2, W[2]);
  p.hline(1, 16, g - 4, W[3]);
  for (const x of [1, 15]) p.rect(x, g - 2, 2, 2, W[1]);
  for (let x = 2; x < 16; x++) {
    p.set(x, g - 6, x % 4 < 2 ? P.red[2] : IZ[1]);
    p.set(x, g - 5, x % 4 === 1 ? P.gold[3] : P.red[1]);
  }
  p.hline(2, 15, g - 7, P.red[3]);
}

/** 手推车：装一堆堆香料（红、黄、褐的小丘）或卷起的地毯。 */
function cart(p: Px, v: number): void {
  const g = p.h;
  p.rect(3, g - 10, 18, 4, W[2]);
  p.hline(3, 20, g - 10, W[3]);
  p.hline(3, 20, g - 7, W[1]);
  p.line(21, g - 8, 26, g - 5, W[1]);
  p.line(21, g - 9, 26, g - 6, W[3]);
  p.vline(24, g - 5, g - 1, W[1]);
  if (v % 2 === 0) {
    const spice = [P.red[2], P.gold[2], P.autumn[1], P.leaf[2]];
    for (let i = 0; i < 4; i++) {
      const x = 4 + i * 4;
      p.rect(x, g - 12, 4, 2, P.straw[1]);
      p.hline(x, x + 3, g - 13, spice[i]);
      p.set(x + 1, g - 14, spice[i]).set(x + 2, g - 14, spice[i]);
    }
  } else {
    const cl = [P.red, IZ, P.gold];
    for (let i = 0; i < 3; i++) {
      p.rect(4, g - 12 - i * 2, 16, 2, cl[i][1]);
      p.hline(4, 19, g - 12 - i * 2, cl[i][2]);
      p.set(4, g - 11 - i * 2, cl[i][0]).set(19, g - 11 - i * 2, cl[i][0]);
    }
  }
  p.ring(8, g - 5, 4, 4, W[1]);
  p.ring(8, g - 5, 3, 3, W[3]);
  p.line(5, g - 5, 11, g - 5, W[2]);
  p.line(8, g - 8, 8, g - 2, W[2]);
  p.ring(17, g - 5, 4, 4, W[1]);
  p.ring(17, g - 5, 3, 3, W[3]);
  p.line(14, g - 5, 20, g - 5, W[2]);
  p.line(17, g - 8, 17, g - 2, W[2]);
}

export const OTTOMAN: CultureArt = {
  kit: ottoman,
  landmark,
  gate,
  wallBody,
  wallTower,
  far: { roof: [T[1], T[2], T[3]], wall: [KS[1], KS[2], KS[3]], accent: [LD[1], LD[2], LD[3]] },
  farHouse,
  farTower,
  farWall,
  props: {
    flag: [P.red[1], P.red[2], P.red[3]],
    stall: [P.cloth.crimson, P.cloth.cream],
    lamp,
    well,
    bench,
    cart,
  },
};
