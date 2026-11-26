// 各风格共用的小部件：玻璃窗、遮阳棚、台阶、灯笼、木桶、木箱、麻袋、长凳等。
// 这些部件同时被设施建筑、民居与街道小物件使用。
import { P, ink, overlay } from "../palette";
import type { Px } from "../px";
import { type Canvas, type Ramp, h01, tintOpaque } from "./kit";

/** 窗玻璃：白天是映着天光的深色玻璃，亮灯时透出暖光。左上一行是窗洞的阴影。 */
export function glass(c: Canvas, x: number, y: number, w: number, h: number, lit = c.o.lit): void {
  const p = c.p;
  if (lit) {
    p.rect(x, y, w, h, P.lamp[1]);
    p.hline(x, x + w - 1, y, P.lamp[0]);
    p.vline(x, y, y + h - 1, P.lamp[0]);
    if (w > 3 && h > 3) p.rect(x + Math.floor(w / 2), y + Math.floor(h / 2), Math.max(1, Math.floor(w / 3)), Math.max(1, Math.floor(h / 3)), P.lamp[2]);
  } else {
    p.rect(x, y, w, h, P.slate[1]);
    p.hline(x, x + w - 1, y, P.slate[0]);
    p.vline(x, y, y + h - 1, P.slate[0]);
    // 斜向的天光反射
    for (let i = 0; i < Math.min(w, h) - 1; i++) {
      if (i < 2) p.set(x + w - 2 - i, y + 1 + i, P.slate[3]);
    }
    p.set(x + w - 1, y + h - 1, P.slate[2]);
  }
}

/** 暗色门洞（敞开的门面、拱廊）：亮灯时里面透出暖光。 */
export function opening(c: Canvas, x: number, y: number, w: number, h: number, lit = c.o.lit): void {
  const p = c.p;
  if (lit) {
    p.rect(x, y, w, h, P.lamp[0]);
    p.rect(x + 1, y + Math.floor(h / 3), w - 2, h - Math.floor(h / 3), P.lamp[1]);
    p.hline(x, x + w - 1, y, P.wood[0]);
    p.vline(x, y, y + h - 1, P.wood[0]);
  } else {
    p.rect(x, y, w, h, P.wood[0]);
    p.rect(x + 1, y + 1, w - 1, h - 1, ink.brown);
    p.hline(x + 1, x + w - 1, y + h - 1, P.wood[1]);
  }
}

/** 竖条纹遮阳棚：顶在 y、高 h，下缘是一排小垂边。cols 为两种条纹色（各取中、暗阶）。 */
export function awning(c: Canvas, x: number, y: number, w: number, h: number, a: Ramp, b: Ramp): void {
  const p = c.p;
  for (let i = 0; i < w; i++) {
    const stripe = Math.floor(i / 3) % 2 === 0 ? a : b;
    const lit = stripe[Math.min(stripe.length - 1, 2)];
    const mid = stripe[1];
    for (let j = 0; j < h; j++) p.set(x + i, y + j, j === 0 ? mid : lit);
    // 垂边：每 3 像素一个半圆齿
    const ph = i % 3;
    p.set(x + i, y + h, ph === 1 ? mid : lit);
    if (ph === 1) p.set(x + i, y + h + 1, mid);
  }
  // 棚下阴影
  tintOpaque(p, x, y + h + 1, w, 2, overlay.shadow);
  tintOpaque(p, x, y + h + 3, w, 1, overlay.shadow, 2);
  c.ledge(x, x + w - 1, y);
}

/** 台阶：中心 cx，最上一级宽 w，占 n 行（每级两行：踏面亮、踢面暗），逐级加宽 2 像素，最下一行是 y0-1。 */
export function steps(c: Canvas, cx: number, w: number, n: number, y0: number, ramp: Ramp = P.stone): void {
  const p = c.p;
  const levels = Math.max(1, Math.ceil(n / 2));
  for (let i = 0; i < levels; i++) {
    const ww = w + i * 4;
    const x = cx - Math.floor(ww / 2);
    const tread = y0 - n + i * 2;
    // 踏面：受光
    p.hline(x, x + ww - 1, tread, ramp[3]);
    p.set(x, tread, ramp[4] ?? ramp[3]);
    // 踢面：背光，右端更暗
    if (tread + 1 < y0) {
      p.hline(x, x + ww - 1, tread + 1, ramp[2]);
      p.set(x + ww - 1, tread + 1, ramp[1]);
    }
  }
}

/** 灯笼的样式：东方红灯笼、北地铁笼灯、沙漠铜灯、群岛贝壳灯、日本的白纸提灯。 */
export type LampKind = "red" | "iron" | "brass" | "shell" | "paper";

/** 挂着的灯笼（东方红灯笼、沙漠铜灯、北地铁笼灯、群岛贝壳灯、白纸提灯），顶端挂点 (cx, y)。 */
export function lantern(c: Canvas, cx: number, y: number, kind: LampKind = "red"): void {
  const p = c.p;
  const lit = c.o.lit;
  if (kind === "paper") {
    // 白纸提灯：上下两道黑漆木圈，纸面一道竖骨的暗影；夜里透出暖黄
    p.stamp(
      [".kkk.", "kkkkk", "pPPPq", "PPPPq", "pPPPq", "PPPPq", "kkkkk", ".kkk."],
      {
        k: P.wood[0],
        P: lit ? P.lamp[2] : P.paper,
        p: lit ? P.lamp[1] : P.parchment,
        q: lit ? P.lamp[1] : P.parchmentDark,
      },
      cx - 2,
      y,
    );
    if (!lit) p.set(cx, y + 3, P.red[2]).set(cx, y + 4, P.red[2]);
  } else if (kind === "red") {
    p.stamp(
      ["..o..", ".OoO.", "rRrrq", "Rrrrq", "rrrrq", ".OoO.", "..o..", "..r.."],
      {
        o: P.gold[2],
        O: P.gold[1],
        R: lit ? P.lamp[2] : P.red[3],
        r: lit ? P.red[3] : P.red[2],
        q: lit ? P.red[2] : P.red[1],
      },
      cx - 2,
      y,
    );
  } else {
    // 金属框的四方灯：灯帽、两格玻璃、底座；白天玻璃是暗琥珀色，夜里透亮
    const frame = kind === "brass" ? P.gold[1] : kind === "shell" ? P.wood[1] : P.iron[1];
    const cap = kind === "brass" ? P.gold[2] : kind === "shell" ? P.straw[2] : P.iron[2];
    const capHi = kind === "brass" ? P.gold[3] : kind === "shell" ? P.straw[3] : P.iron[3];
    const g1 = lit ? P.lamp[2] : kind === "shell" ? P.blossom[3] : P.lamp[0];
    const g2 = lit ? P.lamp[1] : kind === "shell" ? P.blossom[2] : P.wood[1];
    p.stamp(
      ["..h..", ".hcc.", "ccccf", "fgGgf", "fgGgf", "fGGGf", ".fff.", "..f.."],
      { h: capHi, c: cap, f: frame, g: g1, G: g2 },
      cx - 2,
      y,
    );
    if (!lit) p.set(cx - 1, y + 3, P.lamp[1]);
  }
  if (lit) {
    // 灯周围一圈淡淡的光晕（只染在已有像素上）
    tintOpaque(p, cx - 4, y, 9, 10, overlay.glow, 2);
  }
}

/** 壁灯：从墙边 (x, y) 伸出一根铁臂，灯挂在臂端；dir 为 -1 向左、1 向右。 */
export function wallLamp(c: Canvas, x: number, y: number, kind: LampKind, dir: -1 | 1): void {
  const p = c.p;
  const ex = x + dir * 4;
  p.hline(Math.min(x, ex), Math.max(x, ex), y, P.iron[1]);
  p.set(x + dir, y + 1, P.iron[1]);
  p.set(x, y + 2, P.iron[1]);
  lantern(c, ex, y + 1, kind);
}

/** 木桶（7×9），左下角在 (x, y)（y 为桶底所在行的下一行，也就是地面线）。 */
export function barrel(p: Px, x: number, y: number, ramp: Ramp = P.wood): void {
  p.stamp(
    [".aaaaa.", "abbbbba", "iiiiiij", "cddddde", "cddfdde", "iiiiiij", "cddfdde", "iiiiiij", ".eeeee."],
    { a: ramp[1], b: ramp[3], c: ramp[3], d: ramp[2], e: ramp[1], f: ramp[1], i: P.iron[2], j: P.iron[1] },
    x,
    y - 9,
  );
}

/** 横放的木桶（9×7），用于堆在酒馆门口。 */
export function barrelSide(p: Px, x: number, y: number, ramp: Ramp = P.wood): void {
  p.stamp(
    [".aiaaaia.", "abidddibd", "bbiddfibd", "bcidddibe", "bbiddfibe", "abidddibe", ".eieeeie."],
    { a: ramp[3], b: ramp[3], c: ramp[4], d: ramp[2], e: ramp[1], f: ramp[1], i: P.iron[2] },
    x,
    y - 7,
  );
  p.ellipse(x + 1, y - 4, 1, 2, ramp[3]);
  p.set(x + 1, y - 4, ramp[2]);
}

/** 木箱（边长 s），左下角在 (x, y)。 */
export function crate(p: Px, x: number, y: number, s = 7, ramp: Ramp = P.wood, seed = 0): void {
  const t = y - s;
  p.rect(x, t, s, s, ramp[2]);
  p.hline(x, x + s - 1, t, ramp[3]);
  p.vline(x, t, y - 1, ramp[3]);
  p.hline(x, x + s - 1, y - 1, ramp[1]);
  p.vline(x + s - 1, t, y - 1, ramp[1]);
  if (h01(x, y, seed) < 0.5) {
    p.line(x + 1, y - 2, x + s - 2, t + 1, ramp[1]);
    p.line(x + 1, y - 3, x + s - 3, t + 1, ramp[3]);
  } else {
    p.hline(x + 1, x + s - 2, t + Math.floor(s / 2), ramp[1]);
    p.hline(x + 1, x + s - 2, t + Math.floor(s / 2) - 1, ramp[3]);
  }
}

/** 麻袋（6×6），左下角在 (x, y)；tone 1 为稻草色（粮袋）。 */
export function sack(p: Px, x: number, y: number, tone = 0): void {
  const hi = tone ? P.straw[3] : P.parchment;
  const lo = tone ? P.straw[1] : P.parchmentDark;
  const tie = tone ? P.straw[0] : P.parchmentDeep;
  p.stamp(["..ab..", ".aabb.", ".aaab.", "aaaabb", "aaaabb", ".bbbb."], { a: hi, b: lo }, x, y - 6);
  p.set(x + 2, y - 5, tie).set(x + 3, y - 5, tie);
}

/** 长凳（10×4），左下角在 (x, y)。 */
export function bench(p: Px, x: number, y: number, ramp: Ramp = P.wood): void {
  p.hline(x, x + 9, y - 4, ramp[3]);
  p.hline(x, x + 9, y - 3, ramp[1]);
  p.vline(x + 1, y - 2, y - 1, ramp[1]);
  p.vline(x + 8, y - 2, y - 1, ramp[1]);
}

/** 旗面起伏（每列的纵向偏移）。 */
const WAVE = [0, 0, 1, 1, 0, 0, -1, -1];

/** 旗帜（挂在旗杆右侧）：左上角 (x, y)，宽 w 高 h，ramp 取暗、中、亮三阶；中间一道亮色横带，末端燕尾。 */
export function flagCloth(p: Px, x: number, y: number, w: number, h: number, ramp: readonly string[], wave = 0): void {
  const mid = Math.floor(h / 2);
  for (let i = 0; i < w; i++) {
    const dy = WAVE[(i + wave) % WAVE.length];
    for (let j = 0; j < h; j++) {
      // 燕尾：最后一列中间挖空
      if (i === w - 1 && Math.abs(j - mid) <= 1) continue;
      let col = ramp[1];
      if (j === 0 || Math.abs(j - mid) <= 0) col = ramp[2];
      if (j === h - 1) col = ramp[0];
      // 起伏的背光面压暗
      if (dy > 0 && col === ramp[1]) col = ramp[0];
      p.set(x + i, y + j + dy, col);
    }
  }
  // 靠旗杆一侧的深色镶边
  for (let j = 0; j < h; j++) p.set(x, y + j + WAVE[wave % WAVE.length], ramp[0]);
}
