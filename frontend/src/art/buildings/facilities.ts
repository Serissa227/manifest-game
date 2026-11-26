// 九种设施的构图。构图只决定体块、开间、门窗与招牌的位置，材质与屋顶交给风格套件，
// 所以同一设施在各种风格下轮廓相近、一眼能认出用途，而材质与屋顶随风格变化。
import type { Facility } from "../../store/game";
import { P, ink, overlay } from "../palette";
import { Px } from "../px";
import { type Canvas, type Ramp, h01, tintOpaque } from "./kit";
import { type LampKind, awning, barrel, barrelSide, bench, crate, flagCloth, lantern, opening, sack, steps } from "./parts";
import { type Kit, windowRow } from "./style";

/** 画布尺寸：足够放下最大的设施（最终会裁掉透明边）。 */
export const CANVAS_W = 136;
export const CANVAS_H = 104;

/** 经典风格的灯笼样式。 */
const LAMP: Readonly<Partial<Record<Kit["style"], LampKind>>> = { mediterranean: "iron", nordic: "iron", lowland: "iron", desert: "brass", islands: "shell", eastern: "red", frontier: "iron" };

/** 本风格的灯笼样式（套件给出 lamp 时用它）。 */
function lampKind(k: Kit): LampKind {
  return k.lamp ?? LAMP[k.style] ?? "iron";
}

/** 临时强制亮灯（酒馆的暖窗白天也亮着）。 */
function withLit(c: Canvas, fn: () => void): void {
  const saved = c.o.lit;
  c.o.lit = true;
  fn();
  c.o.lit = saved;
}

/** 货摊柜台与货物：柜台顶在 y，宽 w。 */
function stallGoods(c: Canvas, x: number, w: number, y: number, seed: number): void {
  const p = c.p;
  // 柜台
  p.hline(x, x + w - 1, y, P.wood[3]);
  p.rect(x, y + 1, w, 3, P.wood[2]);
  p.hline(x, x + w - 1, y + 1, P.wood[1]);
  for (let i = x + 3; i < x + w - 1; i += 4) p.vline(i, y + 2, y + 3, P.wood[1]);
  // 货物：果堆、布匹、陶罐、筐
  let i = x + 1;
  let k = 0;
  while (i < x + w - 3) {
    const r = h01(k, seed, 301);
    if (r < 0.3) {
      const ramp = h01(k, seed, 302) < 0.5 ? P.red : P.gold;
      p.hline(i, i + 3, y - 1, ramp[2]);
      p.hline(i + 1, i + 2, y - 2, ramp[3]);
      p.set(i + 1, y - 1, ramp[3]);
      i += 5;
    } else if (r < 0.55) {
      const cl = [P.cloth.blue, P.cloth.crimson, P.cloth.green, P.cloth.ochre][Math.floor(h01(k, seed, 303) * 4)];
      p.rect(i, y - 3, 3, 3, cl[1]);
      p.hline(i, i + 2, y - 3, cl[2]);
      p.set(i + 2, y - 1, cl[0]);
      i += 4;
    } else if (r < 0.8) {
      p.rect(i, y - 3, 3, 3, P.sand[2]);
      p.hline(i, i + 2, y - 3, P.sand[1]);
      p.set(i, y - 2, P.sand[3]);
      p.set(i + 1, y - 4, P.sand[1]);
      i += 4;
    } else {
      p.rect(i, y - 2, 5, 2, P.straw[2]);
      p.hline(i, i + 4, y - 2, P.straw[3]);
      p.set(i + 1, y - 3, P.leaf[3]).set(i + 2, y - 3, P.red[3]).set(i + 3, y - 3, P.leaf[2]);
      i += 6;
    }
    k++;
  }
}

/** 一堆货箱：从 x 往右堆，底在 y。 */
function cratePile(c: Canvas, x: number, y: number, n: number, seed: number): void {
  const p = c.p;
  const s = 7;
  for (let i = 0; i < n; i++) crate(p, x + i * s, y, s, P.wood, seed + i);
  for (let i = 0; i < n - 1; i++) crate(p, x + 3 + i * s, y - s, s, P.wood, seed + 7 + i);
}

// ───────────────────────── 设施 ─────────────────────────

/** 交易所：敞开的三开间门面、货摊与遮阳棚、门口堆着货箱与麻袋，二楼正中挂天平招牌。 */
function market(c: Canvas, k: Kit): void {
  const p = c.p;
  const g = c.gy;
  const bw = 80;
  const x = Math.floor((c.w - bw) / 2);
  const ph = k.plinthH;
  const yb = g - ph;
  const y1 = yb - 18;
  const y0 = y1 - 16;
  k.plinth(c, x - 2, bw + 4, ph);
  k.wall(c, x, y1, bw, 18, "ground");
  k.wall(c, x, y0, bw, 16, "upper");
  k.roof(c, x, bw, y0, "main");
  k.band(c, x, bw, y1 - 1);
  // 三开间门面
  const bayW = Math.floor((bw - 4) / 3);
  for (let i = 0; i < 3; i++) {
    const bx = x + 2 + i * bayW;
    (k.bay ?? opening)(c, bx + 2, y1 + 6, bayW - 3, yb - y1 - 6);
    stallGoods(c, bx + 2, bayW - 3, yb - 5, c.seed + i * 13);
  }
  for (let i = 0; i <= 3; i++) k.post(c, x + 1 + i * bayW - (i === 3 ? 1 : 0), y1 + 1, yb - 1);
  awning(c, x - 1, y1 + 2, bw + 2, 3, k.awning[0], k.awning[1]);
  windowRow(c, k, x + 2, bw - 4, y0 + 6, 4, "std", (i) => i === 1 || i === 2);
  k.sign(c, x + Math.floor(bw / 2), y0 + 2, "market");
  k.decor(c, x, bw, y0, yb);
  // 门口的货
  cratePile(c, x + bw - 12, g, 2, c.seed + 5);
  sack(p, x - 5, g, 0);
  sack(p, x + 1, g, 1);
  sack(p, x - 2, g - 5, 0);
}

/** 船体骨架：龙骨、首尾柱、一排露天的肋骨、下半截已钉好的船板与撑木。左端是船首。 */
function shipFrame(c: Canvas, x: number, w: number, keel: number, h: number): void {
  const p = c.p;
  const W = P.wood;
  // 船底：中段平直，船首一段上翘的曲线，船尾略翘
  const bottom = (xx: number) => {
    const t = (xx - x) / (w - 1);
    if (t < 0.22) return keel - Math.round(((0.22 - t) / 0.22) ** 2 * h * 0.75);
    if (t > 0.9) return keel - Math.round(((t - 0.9) / 0.1) ** 2 * h * 0.25);
    return keel;
  };
  // 舷缘：首尾高、中间低
  const sheer = (xx: number) => {
    const t = (xx - x) / (w - 1);
    return keel - h + Math.round((t - 0.5) ** 2 * 9) - (t < 0.08 ? 1 : 0);
  };
  // 撑木（在船身后面）
  for (let i = 0; i < 3; i++) {
    const sx = x + 10 + i * Math.floor((w - 20) / 2);
    p.line(sx - 5, keel + 2, sx, sheer(sx) + 6, W[1]);
  }
  // 肋骨：每 4 像素一根，左亮右暗
  for (let xx = x + 3; xx < x + w - 2; xx += 4) {
    const top = sheer(xx);
    p.vline(xx, top, bottom(xx), W[3]);
    p.vline(xx + 1, top + 1, bottom(xx), W[1]);
    p.set(xx, top, W[4]);
  }
  // 舷缘纵梁
  for (let xx = x + 1; xx < x + w - 1; xx++) p.set(xx, sheer(xx) + 1, W[2]);
  // 下半截船板：三列板带
  for (let xx = x; xx < x + w; xx++) {
    const b = bottom(xx);
    const planked = Math.max(sheer(xx) + 3, b - 6);
    for (let yy = planked; yy <= b; yy++) {
      const row = (b - yy) % 2;
      p.set(xx, yy, row === 0 ? W[1] : W[2]);
    }
    p.set(xx, planked, W[3]);
  }
  // 龙骨与垫木
  for (let xx = x - 1; xx < x + w + 1; xx++) {
    p.set(xx, bottom(Math.min(Math.max(xx, x), x + w - 1)) + 1, W[0]);
  }
  for (let i = x + 5; i < x + w - 6; i += 11) {
    p.rect(i, keel + 2, 5, 3, W[1]);
    p.hline(i, i + 4, keel + 2, W[3]);
    p.hline(i, i + 4, keel + 3, W[2]);
  }
  // 首柱：从船底弯上去，探出船头；尾柱：略向后倾
  const bx = x;
  const stemH = bottom(bx) - sheer(bx) + 3;
  for (let k = 0; k <= stemH; k++) {
    const yy = bottom(bx) - k;
    const dx = Math.round((k / stemH) ** 1.6 * 4);
    p.set(bx - dx, yy, W[1]);
    p.set(bx - dx + 1, yy, W[2]);
  }
  for (let k = 0; k <= h; k++) {
    const yy = bottom(x + w - 1) - k;
    const dx = Math.round((k / h) * 2);
    p.set(x + w - 1 + dx, yy, W[2]);
    p.set(x + w + dx, yy, W[1]);
  }
}

/** 造船厂：左边工棚（锚与锤的招牌），右边船台上是未完工的船骨架，头顶一座吊架，前面堆着木料。 */
function shipyard(c: Canvas, k: Kit): void {
  const p = c.p;
  const g = c.gy;
  const total = 98;
  const x = Math.floor((c.w - total) / 2);
  const sw = 36;
  const ph = k.plinthH;
  const yb = g - ph;
  const y0 = yb - 24;
  // 船台（在工棚后面先画）
  const sx = x + sw + 6;
  const swid = total - sw - 8;
  // 吊架：两根立柱、横梁与斜撑
  const gx0 = sx + 2;
  const gx1 = sx + swid - 3;
  const gt = g - 54;
  const W = P.wood;
  for (const gx of [gx0, gx1]) {
    p.rect(gx, gt, 3, g - gt, W[2]);
    p.vline(gx, gt, g - 1, W[3]);
    p.vline(gx + 2, gt, g - 1, W[1]);
  }
  p.rect(gx0 - 2, gt - 3, gx1 - gx0 + 7, 3, W[2]);
  p.hline(gx0 - 2, gx1 + 4, gt - 3, W[3]);
  p.hline(gx0 - 2, gx1 + 4, gt - 1, W[1]);
  p.line(gx0 + 3, gt + 8, gx0 + 10, gt, W[1]);
  p.line(gx1 - 1, gt + 8, gx1 - 8, gt, W[1]);
  // 滑轮、吊索与一根吊着的木料
  const hx = Math.floor((gx0 + gx1) / 2) + 6;
  p.rect(hx - 1, gt, 3, 3, P.iron[1]);
  p.set(hx, gt + 1, P.iron[3]);
  p.vline(hx, gt + 3, gt + 16, P.straw[1]);
  p.rect(hx - 8, gt + 17, 17, 2, W[3]);
  p.hline(hx - 8, hx + 8, gt + 18, W[1]);
  p.set(hx - 1, gt + 16, P.straw[1]).set(hx + 1, gt + 16, P.straw[1]);
  // 船台斜坡
  for (let i = 0; i < swid; i++) {
    const yy = g - 3 + Math.floor(i / 20);
    p.vline(sx + i, Math.min(yy, g - 1), g - 1, i % 5 === 0 ? W[1] : W[2]);
    p.set(sx + i, Math.min(yy, g - 1), W[3]);
  }
  shipFrame(c, sx + 9, swid - 13, g - 6, 16);
  // 工棚
  k.plinth(c, x - 1, sw + 2, ph);
  k.wall(c, x, y0, sw, yb - y0, "main");
  k.roof(c, x, sw, y0, "shed");
  // 敞开的大门，里面挂着工具
  const ox = x + 5;
  const ow = sw - 10;
  opening(c, ox, y0 + 10, ow, yb - y0 - 10);
  for (let i = ox + 3; i < ox + ow - 2; i += 5) {
    p.vline(i, y0 + 12, y0 + 15, P.iron[2]);
    p.set(i - 1, y0 + 12, P.iron[3]).set(i + 1, y0 + 12, P.iron[2]);
  }
  p.rect(ox + 2, yb - 5, ow - 4, 2, W[3]);
  p.vline(ox + 3, yb - 3, yb - 1, W[1]).vline(ox + ow - 4, yb - 3, yb - 1, W[1]);
  k.post(c, ox - 2, y0 + 10, yb - 1);
  k.post(c, ox + ow, y0 + 10, yb - 1);
  k.sign(c, x + Math.floor(sw / 2), y0 - 1, "shipyard");
  // 木料堆：端面朝外的原木（三、二、一）+ 一摞木板
  const lx = x + sw - 1;
  for (let r = 0; r < 3; r++) {
    for (let i = 0; i < 3 - r; i++) {
      p.stamp([".aa.", "abca", "acda", ".aa."], { a: W[1], b: W[4], c: W[3], d: W[2] }, lx + i * 4 + r * 2, g - 4 - r * 3);
    }
  }
  p.rect(x - 4, g - 3, 12, 3, W[3]);
  p.hline(x - 4, x + 7, g - 1, W[1]);
  p.hline(x - 4, x + 7, g - 2, W[2]);
}

/** 酒馆：两层，暖色亮窗、门口酒桶与长凳、门上挂灯、侧面伸出酒杯挂牌。 */
function tavern(c: Canvas, k: Kit): void {
  const p = c.p;
  const g = c.gy;
  const bw = 62;
  const x = Math.floor((c.w - bw) / 2) + 2;
  const ph = k.plinthH;
  const yb = g - ph;
  const y1 = yb - 18;
  const y0 = y1 - 16;
  k.plinth(c, x - 1, bw + 2, ph);
  k.wall(c, x, y1, bw, 18, "ground");
  k.wall(c, x, y0, bw, 16, "upper");
  // 酒馆的屋顶换一种：山墙朝街（低地、北地）、屋顶小阁与凉棚（沙漠）、茅草 A 字顶（开拓者）
  const gabled = k.style === "lowland" || k.style === "desert" || k.style === "nordic" || k.style === "frontier";
  k.roof(c, x, bw, y0, k.tavernRoof ?? (gabled ? "gable" : "main"));
  k.band(c, x, bw, y1 - 1);
  const dcx = x + 18;
  k.door(c, dcx, yb, "std");
  // 底层两扇大亮窗
  withLit(c, () => {
    k.window(c, x + 32, y1 + 5, "wide");
  });
  windowRow(c, k, x, bw, y0 + 6, 3, "std");
  k.decor(c, x, bw, y0, yb);
  // 门上挂灯
  const [, dh] = k.doorSize("std");
  lantern(c, dcx + 7, yb - dh - 3, lampKind(k));
  // 从墙角伸出的铁臂挂牌
  const arm = y1 + 1;
  p.hline(x - 12, x, arm, P.iron[1]);
  p.hline(x - 12, x - 1, arm - 1, P.iron[2]);
  p.line(x - 1, arm + 5, x - 6, arm, P.iron[1]);
  p.set(x - 13, arm - 1, P.iron[3]);
  k.sign(c, x - 6, arm + 1, "tavern");
  // 酒桶与长凳
  barrel(p, x + bw - 1, g);
  barrel(p, x + bw + 6, g);
  barrelSide(p, x + bw + 1, g - 9);
  bench(p, x + 30, g);
  tintOpaque(p, x + 30, g - 1, 10, 1, overlay.shadowLight);
}

/** 商会：较大的会馆，正中带柱廊门廊，两侧垂着商会旗。 */
function guild(c: Canvas, k: Kit): void {
  const p = c.p;
  const g = c.gy;
  const bw = 88;
  const x = Math.floor((c.w - bw) / 2);
  const ph = k.plinthH;
  const yb = g - ph;
  const y1 = yb - 18;
  const y0 = y1 - 16;
  k.plinth(c, x - 2, bw + 4, ph);
  k.wall(c, x, y1, bw, 18, "ground");
  k.wall(c, x, y0, bw, 16, "upper");
  k.roof(c, x, bw, y0, "grand");
  k.band(c, x, bw, y1 - 1);
  windowRow(c, k, x, bw, y0 + 6, 5, "std", (i) => i === 2);
  windowRow(c, k, x, bw, y1 + 4, 5, "std", (i) => i === 1 || i === 2 || i === 3);
  // 门廊：四根柱子、小屋顶，墙面在廊下变暗
  const pw = 40;
  const px0 = x + Math.floor((bw - pw) / 2);
  const py = y1 + 2;
  tintOpaque(p, px0, py, pw, yb - py, overlay.shadowLight);
  k.door(c, x + Math.floor(bw / 2), yb, "double");
  for (let i = 0; i < 4; i++) k.post(c, px0 + 1 + Math.round((i * (pw - 5)) / 3), py + 1, yb - 1, "column");
  k.roof(c, px0, pw, py - 1, "porch");
  steps(c, x + Math.floor(bw / 2), pw - 2, 2, g, P.stone);
  k.sign(c, x + Math.floor(bw / 2), y0 + 1, "guild");
  // 商会旗：两侧竖幡（卷轴与印章的颜色）
  for (const fx of [x + 6, x + bw - 11]) {
    p.hline(fx - 1, fx + 5, y1 + 2, P.wood[1]);
    p.rect(fx, y1 + 3, 5, 12, P.cloth.crimson[1]);
    p.vline(fx, y1 + 3, y1 + 14, P.cloth.crimson[2]);
    p.vline(fx + 4, y1 + 3, y1 + 14, P.cloth.crimson[0]);
    p.rect(fx + 1, y1 + 5, 3, 4, P.paper);
    p.set(fx + 2, y1 + 10, P.gold[3]);
    p.set(fx + 1, y1 + 15, P.cloth.crimson[1]).set(fx + 3, y1 + 15, P.cloth.crimson[1]);
  }
  k.decor(c, x, bw, y0, yb);
}

/** 银行：厚重的石构、贯通两层的巨柱柱廊、铁门与宽台阶，檐下正中是钱币招牌。 */
function bank(c: Canvas, k: Kit): void {
  const p = c.p;
  const g = c.gy;
  const bw = 76;
  const x = Math.floor((c.w - bw) / 2);
  const ph = k.plinthH + 2;
  const yb = g - ph;
  const y1 = yb - 18;
  const y0 = y1 - 16;
  k.plinth(c, x - 3, bw + 6, ph);
  k.wall(c, x, y0, bw, yb - y0, "stone");
  k.roof(c, x, bw, y0, "grand");
  // 柱廊后面的墙压暗，显出进深
  tintOpaque(p, x + 3, y0 + 7, bw - 6, yb - y0 - 7, overlay.shadowLight);
  // 檐下厚重的额枋
  p.rect(x - 1, y0 + 4, bw + 2, 3, P.stone[3]);
  p.hline(x - 1, x + bw, y0 + 4, P.stone[4]);
  p.hline(x - 1, x + bw, y0 + 6, P.stone[1]);
  const cols = 5;
  const span = bw - 8;
  const cx = x + Math.floor(bw / 2);
  // 柱间：上层小窗、下层高窗，正中铁门
  for (let i = 0; i < cols - 1; i++) {
    const a = x + 4 + Math.round((i * span) / (cols - 1));
    const b = x + 4 + Math.round(((i + 1) * span) / (cols - 1));
    const mid = Math.floor((a + b) / 2);
    const [sw] = k.winSize("small");
    k.window(c, mid - Math.floor(sw / 2) + 1, y0 + 10, "small");
    if (i !== 1 && i !== 2) {
      const [tw] = k.winSize("tall");
      k.window(c, mid - Math.floor(tw / 2) + 1, y1 + 3, "tall");
    }
  }
  k.door(c, cx, yb, "iron");
  for (let i = 0; i < cols; i++) k.post(c, x + 2 + Math.round((i * span) / (cols - 1)), y0 + 7, yb - 1, "column");
  steps(c, cx, bw - 10, ph, g, P.stone);
  k.sign(c, cx, y0 + 1, "bank");
  k.decor(c, x, bw, y0, yb);
}

/** 行情板：深色板面上几列涨跌数字。 */
function tickerBoard(c: Canvas, x: number, y: number, w: number, h: number): void {
  const p = c.p;
  p.rect(x - 1, y - 1, w + 2, h + 2, P.wood[1]);
  p.hline(x - 1, x + w, y - 1, P.wood[3]);
  p.rect(x, y, w, h, ink.blue);
  for (let row = 0; row < Math.floor((h - 1) / 3); row++) {
    for (let i = x + 1; i < x + w - 1; i += 2) {
      const r = h01(i, row, c.seed + 401);
      const col = i > x + w - 5 ? (r < 0.5 ? P.leaf[4] : P.red[3]) : r < 0.3 ? P.gold[3] : P.white;
      if (r < 0.8) p.set(i, y + 1 + row * 3, col);
      if (r < 0.4) p.set(i, y + 2 + row * 3, col);
    }
  }
}

/** 钟面：白底、深框、两根指针。 */
function clockFace(c: Canvas, cx: number, cy: number, r: number, rim: Ramp): void {
  const p = c.p;
  p.circle(cx, cy, r + 1, rim[1]);
  p.circle(cx, cy, r, c.o.lit ? P.lamp[2] : P.white);
  p.set(cx - r + 1, cy, P.plaster[2]).set(cx + r - 1, cy, P.plaster[2]);
  p.set(cx, cy - r + 1, P.plaster[2]).set(cx, cy + r - 1, P.plaster[2]);
  p.vline(cx, cy - r + 2, cy, P.iron[0]);
  p.hline(cx, cx + r - 2, cy, P.iron[0]);
  p.set(cx - r, cy - r + 2, rim[2]);
}

/** 期货交易所：最高的建筑。正中一座钟楼从地面升起（门开在楼脚），两翼立着行情板。 */
function exchange(c: Canvas, k: Kit): void {
  const g = c.gy;
  const bw = 84;
  const x = Math.floor((c.w - bw) / 2);
  const ph = k.plinthH;
  const yb = g - ph;
  const y1 = yb - 18;
  const y0 = y1 - 16;
  const tw = 22;
  const tx = x + Math.floor((bw - tw) / 2);
  const tTop = y0 - 24;
  k.plinth(c, x - 2, bw + 4, ph);
  k.wall(c, x, y1, bw, 18, "ground");
  k.wall(c, x, y0, bw, 16, "upper");
  k.roof(c, x, bw, y0, "main");
  k.band(c, x, bw, y1 - 1);
  windowRow(c, k, x, bw, y0 + 6, 4, "std", (i) => i === 1 || i === 2);
  // 钟楼：压在主屋顶前面
  k.wall(c, tx, tTop, tw, yb - tTop, "stone");
  k.band(c, tx, tw, y1 - 1);
  k.band(c, tx, tw, y0 - 1);
  k.roof(c, tx, tw, tTop, "tower");
  clockFace(c, tx + Math.floor(tw / 2), tTop + 11, 6, P.gold);
  k.window(c, tx + Math.floor(tw / 2) - Math.floor(k.winSize("small")[0] / 2), y0 + 2, "small");
  k.door(c, x + Math.floor(bw / 2), yb, "double");
  tickerBoard(c, x + 5, y1 + 4, 17, 10);
  tickerBoard(c, x + bw - 22, y1 + 4, 17, 10);
  k.sign(c, x + Math.floor(bw / 2), y1 - 13, "exchange");
  k.decor(c, x, bw, y0, yb);
}

/** 仓库：宽大的双开门、阁楼门与伸出的吊臂，门口堆着木箱。 */
function warehouse(c: Canvas, k: Kit): void {
  const p = c.p;
  const g = c.gy;
  const bw = 86;
  const x = Math.floor((c.w - bw) / 2) - 2;
  const ph = k.plinthH;
  const yb = g - ph;
  const y0 = yb - 30;
  k.plinth(c, x - 1, bw + 2, ph);
  k.wall(c, x, y0, bw, yb - y0, "main");
  k.roof(c, x, bw, y0, "main");
  const cx = x + Math.floor(bw / 2);
  k.door(c, cx, yb, "barn");
  // 阁楼门
  const lx = cx - 4;
  const ly = y0 + 5;
  p.rect(lx - 1, ly - 1, 10, 10, P.wood[0]);
  opening(c, lx, ly, 8, 8);
  p.rect(lx + 5, ly, 3, 8, P.wood[2]);
  p.vline(lx + 5, ly, ly + 7, P.wood[3]);
  p.hline(lx - 1, lx + 8, ly + 8, P.wood[3]);
  c.ledge(lx - 1, lx + 8, ly + 8);
  // 吊臂：从阁楼门上方伸出，吊着一只木箱
  const ay = ly - 3;
  p.rect(cx - 2, ay, 20, 2, P.wood[2]);
  p.hline(cx - 2, cx + 17, ay, P.wood[3]);
  p.line(cx + 4, ly + 1, cx + 12, ay + 2, P.wood[1]);
  p.rect(cx + 15, ay + 2, 3, 2, P.iron[1]);
  p.vline(cx + 16, ay + 4, ay + 12, P.straw[1]);
  crate(p, cx + 13, ay + 19, 7, P.wood, 3);
  windowRow(c, k, x, bw, y0 + 7, 4, "small", (i) => i === 1 || i === 2);
  k.sign(c, cx - 24, yb - 22, "warehouse");
  k.decor(c, x, bw, y0, yb);
  cratePile(c, x - 4, g, 2, c.seed + 11);
  crate(p, x + bw - 6, g, 8, P.wood, 9);
  crate(p, x + bw + 2, g, 6, P.wood, 4);
  sack(p, x + bw - 1, g - 8, 1);
}

/** 港口投资：官署样式的办事厅——高台基上一座单层高堂，正面整排台阶、两柱门廊、两侧高窗。 */
function invest(c: Canvas, k: Kit): void {
  const p = c.p;
  const g = c.gy;
  const bw = 66;
  const x = Math.floor((c.w - bw) / 2);
  const ph = k.plinthH + 5;
  const yb = g - ph;
  const y0 = yb - 25;
  k.plinth(c, x - 4, bw + 8, ph);
  k.wall(c, x, y0, bw, yb - y0, "main");
  k.roof(c, x, bw, y0, "grand");
  const cx = x + Math.floor(bw / 2);
  // 两侧各两扇高窗
  windowRow(c, k, x, bw, y0 + 8, 6, "tall", (i) => i === 2 || i === 3);
  // 门廊
  const pw = 24;
  tintOpaque(p, cx - pw / 2, y0 + 6, pw, yb - y0 - 6, overlay.shadowLight);
  k.door(c, cx, yb, "double");
  k.post(c, cx - pw / 2 + 1, y0 + 8, yb - 1, "column");
  k.post(c, cx + pw / 2 - 4, y0 + 8, yb - 1, "column");
  k.roof(c, cx - pw / 2, pw, y0 + 7, "porch");
  k.sign(c, cx, y0 - 2, "invest");
  // 正面整排台阶
  steps(c, cx, bw - 16, ph, g, P.stone);
  k.decor(c, x, bw, y0, yb);
}

/** 势力办事处：最正式的建筑，三层主楼与两翼，门口两根旗杆挂势力旗。 */
function office(c: Canvas, k: Kit): void {
  const p = c.p;
  const g = c.gy;
  const bw = 88;
  const x = Math.floor((c.w - bw) / 2);
  const ph = k.plinthH + 1;
  const yb = g - ph;
  const y1 = yb - 18;
  const y0 = y1 - 15;
  const cw = 34;
  const cx0 = x + Math.floor((bw - cw) / 2);
  const ww = cx0 - x;
  const cTop = y0 - 14;
  k.plinth(c, x - 2, bw + 4, ph);
  // 两翼
  for (const wx of [x, cx0 + cw]) {
    k.wall(c, wx, y1, ww, 18, "ground");
    k.wall(c, wx, y0, ww, 15, "upper");
    k.roof(c, wx, ww, y0, "main");
    k.band(c, wx, ww, y1 - 1);
    windowRow(c, k, wx, ww, y0 + 6, 2, "std");
    windowRow(c, k, wx, ww, y1 + 5, 2, "std");
  }
  // 主楼
  k.wall(c, cx0, cTop, cw, yb - cTop, "stone");
  k.roof(c, cx0, cw, cTop, "grand");
  k.band(c, cx0, cw, y1 - 1);
  k.band(c, cx0, cw, y0 - 1);
  windowRow(c, k, cx0, cw, cTop + 6, 2, "small");
  windowRow(c, k, cx0, cw, y0 + 4, 3, "tall", (i) => i === 1);
  const cx = x + Math.floor(bw / 2);
  k.door(c, cx, yb, "grand");
  steps(c, cx, 20, ph, g, P.stone);
  k.sign(c, cx, y0 + 1, "office");
  k.decor(c, x, bw, y0, yb);
  // 两根旗杆
  for (const [fx, flip] of [
    [x - 6, false],
    [x + bw + 5, true],
  ] as const) {
    const top = g - 66;
    p.vline(fx, top, g - 1, P.iron[2]);
    p.vline(fx + 1, top, g - 1, P.iron[1]);
    p.set(fx, top - 1, P.gold[3]).set(fx + 1, top - 1, P.gold[2]);
    p.rect(fx - 1, g - 3, 4, 3, P.stone[2]);
    p.hline(fx - 1, fx + 2, g - 3, P.stone[3]);
    const fl = new Px(14, 10);
    flagCloth(fl, 0, 1, 13, 8, k.flag, flip ? 3 : 0);
    p.blit(fl, flip ? fx - 13 : fx + 2, top, { flipX: flip });
  }
}

/** 设施 → 构图函数。 */
export const FACILITY_DRAW: Readonly<Record<Facility, (c: Canvas, k: Kit) => void>> = {
  market,
  shipyard,
  tavern,
  guild,
  bank,
  exchange,
  warehouse,
  invest,
  office,
};

export { stallGoods };
