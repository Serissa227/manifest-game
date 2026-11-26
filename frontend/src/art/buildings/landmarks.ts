// 地标：每种风格一座原创地标——地中海的圆顶大教堂与钟楼、东方的多层楼阁、北地的石砌尖塔、低地的大风车、
// 沙漠的圆顶望楼、群岛的珊瑚石灯塔、开拓者的原木瞭望塔。第九批的六种文化风格的地标在各自的文件里（见 cultures.ts）。
import type { ArchStyle, TownStyle } from "../buildings";
import { P, ink, overlay } from "../palette";
import type { Px } from "../px";
import { hash32 } from "../rng";
import { desert, dome, merlon } from "./desert";
import { brackets, eastern, lattice, pearl, tier } from "./eastern";
import { SH, chinkedLogs, frontier, logCorner, pelt, shingleTex } from "./frontier";
import { islands, thatchTex } from "./islands";
import { type DrawOpts, Canvas, adobe, ashlar, bricks, coral, fillProfile, finish, h01, plaster, tintOpaque } from "./kit";
import { lowland, tileTex } from "./lowland";
import { AZ, TR, TRAV, archFill, balustrade, barrelTex, cypress, mediterranean } from "./mediterranean";
import { nordic, slateTex } from "./nordic";
import { glass, steps } from "./parts";
import { seedTag } from "./style";
import { cultureArt } from "./cultures";

const W = P.wood;

/** 东方：五重檐楼阁。石台基、朱柱、白墙格窗，层层收分，顶上金珠宝顶。 */
function pavilion(c: Canvas): void {
  const p = c.p;
  const g = c.gy;
  const cx = Math.floor(c.w / 2);
  // 三层石台基
  for (let i = 0; i < 3; i++) {
    const w = 54 - i * 4;
    ashlar(p, cx - w / 2, g - 3 * (i + 1), w, 3, P.stone, { course: 3, min: 6, max: 10, seed: i });
    p.hline(cx - w / 2, cx + w / 2 - 1, g - 3 * (i + 1), P.stone[4]);
  }
  steps(c, cx, 10, 9, g, P.stone);
  let bottom = g - 9;
  const widths = [38, 32, 26, 21, 16];
  const heights = [17, 12, 11, 10, 9];
  for (let i = 0; i < widths.length; i++) {
    const w = widths[i];
    const h = heights[i];
    const x = cx - Math.floor(w / 2);
    const top = bottom - h;
    plaster(p, x, top, w, h, P.plaster, i);
    if (i === 0) {
      // 底层：四根朱柱、正中朱门、两侧格窗
      eastern.door(c, cx, bottom, "double");
      for (const px of [x + 1, x + 9, x + w - 12, x + w - 4]) eastern.post(c, px, top + 1, bottom - 1, "column");
      lattice(c, x + 4, top + 5, 5, 8);
      lattice(c, x + w - 9, top + 5, 5, 8);
    } else {
      // 楼层：栏杆 + 两根角柱 + 格窗或圆窗
      p.rect(x, top, 2, h, W[1]);
      p.rect(x + w - 2, top, 2, h, W[0]);
      if (i === widths.length - 1) eastern.window(c, cx - 4, top + 1, "round");
      else {
        lattice(c, cx - 5, top + 2, 4, h - 5);
        lattice(c, cx + 1, top + 2, 4, h - 5);
      }
      // 平座栏杆
      p.hline(x - 2, x + w + 1, bottom - 3, P.red[2]);
      for (let bx = x - 2; bx <= x + w + 1; bx += 2) p.vline(bx, bottom - 2, bottom - 1, P.red[1]);
      p.hline(x - 2, x + w + 1, bottom - 1, W[0]);
    }
    const ridge = tier(c, x, w, top, i === 0 ? 8 : 7, i === 0 ? 7 : 5, 2);
    brackets(c, x, w, top + 2);
    if (i === widths.length - 1) pearl(c, cx, ridge, true);
    bottom = ridge + 3;
  }
}

/** 北地：石砌钟塔与陡尖顶。sh 为尖顶高度。 */
function spireTower(c: Canvas, sh = 44): void {
  const p = c.p;
  const g = c.gy;
  const cx = Math.floor(c.w / 2);
  const w = 26;
  const x = cx - w / 2;
  const top = g - 78;
  nordic.plinth(c, x - 3, w + 6, 5);
  ashlar(p, x, top, w, g - 5 - top, P.stone, { course: 4, min: 5, max: 9, seed: 5 });
  // 角部扶壁
  for (const bx of [x - 2, x + w - 2]) {
    ashlar(p, bx, g - 40, 4, 35, P.stone, { course: 4, min: 4, max: 4, seed: bx, light: 3 });
    p.poly(
      [
        [bx, g - 40],
        [bx + 2, g - 44],
        [bx + 4, g - 40],
      ],
      P.stone[3],
    );
  }
  // 腰线
  for (const yy of [g - 40, top + 18]) {
    p.hline(x - 1, x + w, yy, P.stone[4]);
    p.hline(x - 1, x + w, yy + 1, P.stone[1]);
  }
  nordic.door(c, cx, g - 5, "std");
  // 细高窗
  for (const yy of [g - 36, top + 24]) {
    p.rect(cx - 1, yy, 3, 8, P.stone[1]);
    p.rect(cx, yy + 1, 1, 7, c.o.lit ? P.lamp[1] : ink.blue);
    p.set(cx, yy, P.stone[1]);
  }
  // 钟面
  p.circle(cx, top + 32, 5, P.stone[1]);
  p.circle(cx, top + 32, 4, c.o.lit ? P.lamp[2] : P.white);
  p.vline(cx, top + 29, top + 32, P.iron[0]);
  p.hline(cx, cx + 2, top + 32, P.iron[0]);
  // 钟楼层：两孔拱窗，里面挂着铜钟
  for (const ax of [x + 5, x + w - 10]) {
    p.rect(ax, top + 4, 5, 10, P.stone[1]);
    p.rect(ax + 1, top + 5, 3, 9, ink.blue);
    p.set(ax + 1, top + 5, P.stone[1]).set(ax + 3, top + 5, P.stone[1]);
    p.rect(ax + 1, top + 9, 3, 3, P.gold[2]);
    p.set(ax + 1, top + 9, P.gold[3]);
    p.hline(ax, ax + 4, top + 14, P.stone[4]);
  }
  // 塔顶檐口与四角小尖
  p.rect(x - 2, top - 2, w + 4, 3, P.stone[3]);
  p.hline(x - 2, x + w + 1, top - 2, P.stone[4]);
  p.hline(x - 2, x + w + 1, top, P.stone[1]);
  for (const px of [x - 2, x + w - 1]) {
    p.rect(px, top - 7, 3, 5, P.stone[3]);
    p.set(px + 1, top - 9, P.stone[3]).set(px + 1, top - 8, P.stone[3]);
    c.markRoof(px, top - 9, 3, 2, P.stone, 0);
  }
  // 尖顶
  const x0 = x + 1;
  const x1 = x + w - 2;
  fillProfile(
    p,
    x0,
    x1,
    (xx) => {
      if (xx < x0 || xx > x1) return null;
      const d = Math.min(xx - x0, x1 - xx) + 0.5;
      return [top - 2 - Math.round((d / ((x1 - x0) / 2)) * sh), top - 2] as const;
    },
    slateTex(x0, 99, x1),
  );
  c.markRoof(x0, top - 2 - sh, x1 - x0 + 1, sh + 1, P.slate, 0);
  // 尖顶上的小老虎窗
  for (const [dx, yy] of [
    [-5, top - 12],
    [5, top - 12],
  ] as const) {
    p.rect(cx + dx - 1, yy - 3, 3, 3, P.plaster[3]);
    p.set(cx + dx, yy - 2, c.o.lit ? P.lamp[1] : P.slate[0]);
    p.set(cx + dx, yy - 5, P.slate[2]).hline(cx + dx - 1, cx + dx + 1, yy - 4, P.slate[2]);
  }
  // 金球与三角旗
  const t = top - 2 - sh;
  p.vline(cx, t - 8, t, P.iron[1]);
  p.circle(cx, t - 3, 1, P.gold[2]);
  p.set(cx - 1, t - 4, P.gold[4]);
  p.rect(cx + 1, t - 8, 5, 2, P.cloth.blue[1]);
  p.hline(cx + 1, cx + 5, t - 8, P.cloth.blue[2]);
  p.set(cx + 6, t - 8, P.cloth.blue[1]);
}

/** 低地：砖砌塔式大风车。收分的塔身、木回廊、陶瓦帽顶、四片格子风叶。towerH 为塔身高度。 */
function windmill(c: Canvas, towerH = 74): void {
  const p = c.p;
  const g = c.gy;
  const cx = Math.floor(c.w / 2);
  const top = g - towerH;
  const hwB = 15;
  const hwT = 10;
  // 塔身（砖）：逐行收分
  const tex = c.p.clone().clear();
  bricks(tex, cx - hwB, top, hwB * 2 + 1, g - top, P.brick, 3);
  for (let y = top; y < g; y++) {
    const t = (y - top) / (g - top);
    const hw = Math.round(hwT + (hwB - hwT) * t);
    for (let x = cx - hw; x <= cx + hw; x++) p.put(x, y, tex.get(x, y));
    p.set(cx + hw, y, P.brick[1]);
    p.set(cx + hw - 1, y, P.brick[1]);
    p.set(cx - hw, y, P.brick[3]);
  }
  lowland.plinth(c, cx - hwB - 2, hwB * 2 + 5, 3);
  lowland.door(c, cx, g - 3, "std");
  for (const yy of [g - 30, top + 12]) lowland.window(c, cx - 3, yy, "small");
  // 木回廊
  const gy = g - 44;
  p.rect(cx - hwB - 5, gy, (hwB + 5) * 2 + 1, 2, W[2]);
  p.hline(cx - hwB - 5, cx + hwB + 5, gy, W[3]);
  p.hline(cx - hwB - 5, cx + hwB + 5, gy - 5, W[2]);
  for (let x = cx - hwB - 5; x <= cx + hwB + 5; x += 3) p.vline(x, gy - 4, gy - 1, W[1]);
  for (const x of [cx - hwB - 4, cx + hwB + 4]) p.line(x, gy + 2, x + (x < cx ? 5 : -5), gy + 7, W[1]);
  // 帽顶：船形陶瓦
  const x0 = cx - 13;
  const x1 = cx + 13;
  fillProfile(
    p,
    x0,
    x1,
    (xx) => {
      if (xx < x0 || xx > x1) return null;
      const u = (xx - cx) / 13.5;
      return [top - Math.round(Math.sqrt(Math.max(0, 1 - u * u)) * 11), top + 1] as const;
    },
    tileTex(x0, x1, 99),
  );
  c.markRoof(x0, top - 11, x1 - x0 + 1, 12, P.autumn, 1);
  // 风叶：四片斜向的格子叶，每片一根叶杆 + 一侧的格架与帆布
  const hx = cx;
  const hy = top - 3;
  const L = 34;
  for (const [dx, dy] of [
    [1, -1],
    [-1, -1],
    [-1, 1],
    [1, 1],
  ] as const) {
    // 格架在叶杆顺时针一侧
    const sx = -dy;
    const sy = dx;
    for (let k = 6; k <= L; k++) {
      for (let j = 1; j <= 6; j++) {
        const px = hx + dx * k + Math.round((sx * j) / 1.4);
        const py = hy + dy * k + Math.round((sy * j) / 1.4);
        const frame = k % 5 === 0 || j === 6 || k === L;
        // 帆布：叶片内段整片张开，外段只剩格架
        const cloth = !frame && j >= 2 && k >= 9 && k <= L - 7;
        if (frame) p.set(px, py, W[3]);
        else if (cloth) p.set(px, py, j >= 4 ? P.plaster[2] : P.plaster[3]);
      }
    }
    p.line(hx, hy, hx + dx * (L + 1), hy + dy * (L + 1), W[1]);
    p.line(hx + 1, hy, hx + dx * (L + 1) + 1, hy + dy * (L + 1), W[2]);
  }
  p.circle(hx, hy, 2, W[1]);
  p.set(hx - 1, hy - 1, P.gold[3]).set(hx, hy, P.gold[2]);
  // 回廊边的麦束
  for (const x of [cx - hwB - 3, cx + hwB + 2]) {
    p.vline(x, gy - 10, gy - 6, P.gold[1]);
    p.stamp([".y.", "yoy", ".o."], { y: P.gold[3], o: P.gold[2] }, x - 1, gy - 12);
  }
}

/** 沙漠：高窄的圆顶望楼。砂岩底座、土坯塔身、木挑窗、拱廊亭与青绿圆顶。 */
function watchtower(c: Canvas): void {
  const p = c.p;
  const g = c.gy;
  const cx = Math.floor(c.w / 2);
  const hw0 = 13;
  const hw1 = 10;
  const top = g - 86;
  desert.plinth(c, cx - hw0 - 3, hw0 * 2 + 7, 3);
  // 塔身逐段收分：下段砂岩、上段土坯
  const stages = [
    { h: 30, hw: hw0, stone: true },
    { h: 28, hw: hw0 - 1, stone: false },
    { h: 25, hw: hw1, stone: false },
  ];
  let y = g - 3;
  stages.forEach((s, i) => {
    const x = cx - s.hw;
    const w = s.hw * 2 + 1;
    const t = y - s.h;
    if (s.stone) ashlar(p, x, t, w, s.h, P.sand, { course: 4, min: 6, max: 10, seed: 7, light: 3 });
    else adobe(p, x, t, w, s.h, P.sand, 11 + i);
    p.vline(x, t, y - 1, P.sand[4]);
    p.vline(x + w - 1, t, y - 1, P.sand[1]);
    // 段间挑檐与彩瓷带
    p.hline(x - 1, x + w, t, P.sand[4]);
    p.hline(x - 1, x + w, t + 1, P.sand[2]);
    for (let xx = x; xx < x + w; xx++) p.set(xx, t + 2, (xx - x) % 4 < 2 ? P.teal[2] : P.red[2]);
    y = t;
  });
  desert.door(c, cx, g - 3, "std");
  // 尖拱窗
  for (const yy of [g - 48, g - 72]) desert.window(c, cx - 2, yy, "tall");
  // 木挑窗（凸出的格子阳台）
  const by = g - 56;
  p.rect(cx - 8, by, 17, 9, W[2]);
  p.hline(cx - 8, cx + 8, by, W[3]);
  for (let xx = cx - 7; xx < cx + 8; xx++) for (let yy = by + 2; yy < by + 7; yy++) if ((xx + yy) % 2 === 0) p.set(xx, yy, c.o.lit ? P.lamp[1] : W[0]);
  p.hline(cx - 8, cx + 8, by + 8, W[1]);
  for (let xx = cx - 7; xx <= cx + 7; xx += 4) p.line(xx, by + 9, xx + 1, by + 11, W[1]);
  // 顶上拱廊亭
  const ay = top;
  const aw = hw1 * 2 + 5;
  const ax = cx - Math.floor(aw / 2);
  p.rect(ax, ay - 12, aw, 12, P.sand[3]);
  for (let i = 0; i < 3; i++) {
    const ox = ax + 3 + i * 7;
    for (let row = 0; row < 9; row++) {
      const k = row < 2 ? 2 - row : 0;
      p.hline(ox + k, ox + 4 - k, ay - 10 + row, ink.brown);
    }
  }
  p.vline(ax, ay - 12, ay - 1, P.sand[4]);
  p.vline(ax + aw - 1, ay - 12, ay - 1, P.sand[1]);
  p.hline(ax - 1, ax + aw, ay - 13, P.sand[4]);
  p.hline(ax - 1, ax + aw, ay - 12, P.sand[2]);
  merlon(c, ax + 1, ay - 13);
  merlon(c, ax + aw - 2, ay - 13);
  dome(c, cx, ay - 13, 8);
  if (c.o.lit) tintOpaque(p, ax, ay - 12, aw, 12, overlay.glow, 2);
}

/** 群岛：珊瑚石灯塔。粉白相间的圆塔、回廊、玻璃灯室与茅草尖帽。 */
function lighthouse(c: Canvas): void {
  const p = c.p;
  const g = c.gy;
  const cx = Math.floor(c.w / 2);
  const base = g - 6;
  coral(p, cx - 17, base, 35, 6, 3);
  p.hline(cx - 17, cx + 17, base, P.blossom[3]);
  steps(c, cx, 8, 3, g, [P.blossom[0], P.blossom[1], P.blossom[2], P.blossom[3], P.white]);
  const top = g - 82;
  const hwB = 12;
  const hwT = 8;
  for (let y = top; y < base; y++) {
    const t = (y - top) / (base - top);
    const hw = Math.round(hwT + (hwB - hwT) * t);
    const band = Math.floor((base - y) / 8) % 2 === 0;
    const ramp = band ? [P.blossom[0], P.blossom[1], P.blossom[2], P.blossom[3]] : [P.plaster[1], P.plaster[2], P.plaster[3], P.white];
    for (let x = cx - hw; x <= cx + hw; x++) {
      const u = (x - cx) / Math.max(1, hw);
      const col = u < -0.55 ? ramp[3] : u < 0.25 ? ramp[2] : u < 0.75 ? ramp[1] : ramp[0];
      p.set(x, y, col);
    }
    // 石缝
    if ((base - y) % 4 === 0) for (let x = cx - hw + 1; x < cx + hw; x += 3) if (h01(x, y, 5) < 0.4) p.set(x, y, ramp[1]);
  }
  // 小窗（螺旋上升）
  for (let i = 0; i < 4; i++) {
    const yy = base - 14 - i * 16;
    const xx = cx - 3 + (i % 2) * 5;
    p.rect(xx, yy, 2, 4, c.o.lit ? P.lamp[1] : ink.brown);
    p.set(xx, yy, P.blossom[0]);
  }
  islands.door(c, cx, base, "iron");
  // 回廊：外挑的平台与栏杆
  p.rect(cx - hwT - 5, top - 2, (hwT + 5) * 2 + 1, 3, P.plaster[2]);
  p.hline(cx - hwT - 5, cx + hwT + 5, top - 2, P.white);
  p.hline(cx - hwT - 5, cx + hwT + 5, top, P.plaster[0]);
  p.hline(cx - hwT - 5, cx + hwT + 5, top - 7, P.teal[2]);
  for (let x = cx - hwT - 5; x <= cx + hwT + 5; x += 2) p.vline(x, top - 6, top - 3, P.teal[1]);
  // 灯室
  const lw = 13;
  const lx = cx - 6;
  const ly = top - 17;
  p.rect(lx, ly, lw, 10, P.teal[1]);
  glass(c, lx + 1, ly + 1, lw - 2, 8, c.o.lit);
  if (!c.o.lit) {
    p.circle(cx, ly + 5, 2, P.gold[2]);
    p.set(cx - 1, ly + 4, P.gold[4]);
  } else {
    p.circle(cx, ly + 5, 3, P.lamp[2]);
    // 光束（只在已有像素之外画淡淡的两道）
    for (let k = 1; k < 10; k++) {
      p.set(lx - k, ly + 4 - Math.floor(k / 3), overlay.glow);
      p.set(lx + lw - 1 + k, ly + 4 - Math.floor(k / 3), overlay.glow);
    }
  }
  for (const x of [lx + 4, lx + 8]) p.vline(x, ly + 1, ly + 8, P.teal[1]);
  // 茅草尖帽
  const x0 = cx - 9;
  const x1 = cx + 9;
  fillProfile(
    p,
    x0,
    x1,
    (xx) => {
      if (xx < x0 || xx > x1) return null;
      const t = 1 - Math.abs(xx - cx) / 9.5;
      return [ly - Math.round(Math.pow(t, 1.2) * 14), ly + 1] as const;
    },
    thatchTex(x0, x1, 17),
  );
  c.markRoof(x0, ly - 14, x1 - x0 + 1, 15, P.straw, 1);
  p.vline(cx, ly - 20, ly - 14, W[1]);
  p.set(cx, ly - 21, P.blossom[3]).set(cx - 1, ly - 19, P.teal[3]).set(cx + 1, ly - 19, P.teal[3]);
}

/** 带竖肋的筒瓦大圆顶：中心 cx，底在 y，半径 r，高 hgt。返回顶点 y。 */
function ribbedDome(c: Canvas, cx: number, y: number, r: number, hgt: number): number {
  const p = c.p;
  for (let row = 0; row <= hgt; row++) {
    const t = row / hgt;
    const half = Math.round(r * Math.sqrt(Math.max(0, 1 - t * t)));
    const yy = y - row;
    for (let xx = cx - half; xx <= cx + half; xx++) {
      const u = (xx - cx) / Math.max(1, r);
      let col: string = u < -0.45 ? TR[3] : u > 0.4 ? TR[1] : TR[2];
      if (u < -0.15 && u > -0.5 && t > 0.25 && t < 0.7) col = TR[4];
      if (xx === cx + half) col = TR[0];
      p.set(xx, yy, col);
    }
  }
  // 白石肋：按球面投影从底收向顶
  for (const k of [-0.78, -0.4, 0, 0.4, 0.78]) {
    for (let row = 1; row < hgt - 1; row++) {
      const t = row / hgt;
      const half = r * Math.sqrt(Math.max(0, 1 - t * t));
      p.set(Math.round(cx + k * half), y - row, k > 0.3 ? TRAV[2] : TRAV[4]);
    }
  }
  c.markRoof(cx - r, y - hgt, r * 2 + 1, hgt, TR, 0);
  return y - hgt;
}

/** 地中海：圆顶大教堂。石灰华与白墙相间的正立面、玫瑰窗与大拱门、三角山花；后面鼓座上的筒瓦大圆顶与采光亭；右侧一座细高的钟楼；两旁柏树。 */
function cathedral(c: Canvas): void {
  const p = c.p;
  const g = c.gy;
  const bx = 14;
  const bw = 46;
  const cx = bx + Math.floor(bw / 2);
  const top = g - 44;
  // 鼓座与圆顶（在正立面后面先画）
  const dw = 30;
  const dTop = g - 70;
  plaster(p, cx - dw / 2, dTop, dw, 26, P.plaster, 3);
  p.vline(cx - dw / 2, dTop, dTop + 25, P.white);
  p.vline(cx + dw / 2 - 1, dTop, dTop + 25, P.plaster[1]);
  for (let i = 0; i < 5; i++) {
    const wx = cx - dw / 2 + 3 + i * 5 + (i > 2 ? 1 : 0);
    archFill(c, wx, dTop + 4, 3, 7, () => (c.o.lit ? P.lamp[1] : ink.brown));
  }
  for (let xx = cx - dw / 2 + 1; xx < cx + dw / 2; xx += 5) p.vline(xx, dTop + 3, dTop + 12, TRAV[3]);
  p.hline(cx - dw / 2 - 1, cx + dw / 2, dTop, TRAV[4]);
  p.hline(cx - dw / 2 - 1, cx + dw / 2, dTop + 1, TRAV[2]);
  const dome = ribbedDome(c, cx, dTop - 1, 15, 17);
  // 采光亭
  plaster(p, cx - 3, dome - 7, 7, 7, P.plaster, 5);
  p.vline(cx - 3, dome - 7, dome - 1, P.white);
  p.rect(cx - 1, dome - 5, 2, 3, c.o.lit ? P.lamp[1] : ink.brown);
  p.hline(cx - 4, cx + 4, dome - 8, TRAV[4]);
  p.ellipse(cx, dome - 9, 3, 2, TR[2]);
  p.set(cx - 1, dome - 10, TR[3]);
  c.markRoof(cx - 3, dome - 11, 7, 3, TR, 0);
  p.vline(cx, dome - 15, dome - 11, P.gold[1]);
  // 顶端一颗金色星饰（不用任何现实宗教的符号）
  p.stamp([".a.", "aba", ".a."], { a: P.gold[3], b: P.gold[4] }, cx - 1, dome - 16);
  // 正立面：下半石灰华、上半白墙，壁柱分成三开间
  ashlar(p, bx, g - 22, bw, 19, TRAV, { course: 4, min: 7, max: 12, seed: 11, light: 2 });
  plaster(p, bx, top, bw, 22, P.plaster, 9);
  for (let yy = top + 3; yy < g - 22; yy += 6) p.hline(bx, bx + bw - 1, yy, TRAV[3]);
  for (const px of [bx, bx + 12, bx + bw - 15, bx + bw - 3]) {
    p.rect(px, top, 3, g - 3 - top, TRAV[3]);
    p.vline(px, top, g - 4, TRAV[4]);
    p.vline(px + 2, top, g - 4, TRAV[1]);
  }
  p.hline(bx - 1, bx + bw, g - 22, TRAV[4]);
  p.hline(bx - 1, bx + bw, g - 21, TRAV[1]);
  // 大拱门（外圈一道蓝白瓷砖）与门上的玫瑰窗
  mediterranean.door(c, cx, g - 3, "grand");
  p.circle(cx, top + 10, 6, TRAV[4]);
  p.circle(cx, top + 10, 5, c.o.lit ? P.lamp[1] : P.cloth.navy[1]);
  for (let a = 0; a < 8; a++) {
    const dx = Math.round(Math.cos((a * Math.PI) / 4) * 3);
    const dy = Math.round(Math.sin((a * Math.PI) / 4) * 3);
    p.line(cx, top + 10, cx + dx, top + 10 + dy, c.o.lit ? P.lamp[2] : AZ[2]);
  }
  p.set(cx, top + 10, P.gold[3]);
  // 两侧开间的拱形壁龛与小窗
  for (const nx of [bx + 5, bx + bw - 10]) {
    archFill(c, nx - 1, top + 5, 6, 12, () => TRAV[3]);
    archFill(c, nx, top + 6, 4, 11, () => (c.o.lit ? P.lamp[1] : ink.brown));
    mediterranean.window(c, nx, g - 19, "small");
  }
  // 山花
  const hw = bw / 2 + 1;
  const ph = 12;
  for (let t = 0; t <= ph; t++) {
    const dx = Math.round((t * hw) / ph);
    p.hline(cx - hw + dx, cx + hw - dx, top - t, TRAV[3]);
  }
  for (let t = 0; t <= ph + 1; t++) {
    const dx = Math.round((t * (hw + 1)) / (ph + 1));
    p.set(cx - hw - 1 + dx, top - t, TR[3]).set(cx - hw + dx, top - t, TRAV[4]);
    p.set(cx + hw + 1 - dx, top - t, TR[1]).set(cx + hw - dx, top - t, TRAV[2]);
  }
  p.hline(bx - 2, bx + bw + 1, top, TRAV[4]);
  p.hline(bx - 2, bx + bw + 1, top + 1, TRAV[1]);
  p.circle(cx, top - 5, 2, c.o.lit ? P.lamp[1] : P.slate[1]);
  c.markRoof(cx - hw - 1, top - ph - 1, hw * 2 + 3, ph + 1, [TR[0], TR[1], TR[2], TR[3], TRAV[4], TRAV[3], TRAV[2]], 0);
  p.circle(cx, top - ph - 3, 1, P.gold[2]);
  // 台阶
  steps(c, cx, bw - 4, 3, g, TRAV);
  // 钟楼：四层，逐层以线脚分隔，顶层开拱挂钟，栏杆上是筒瓦四角锥顶
  const tx = bx + bw + 3;
  const tw = 14;
  const tTop = g - 104;
  ashlar(p, tx, g - 30, tw, 27, TRAV, { course: 4, min: 5, max: 8, seed: 21, light: 2 });
  plaster(p, tx, tTop, tw, g - 30 - tTop, P.plaster, 13);
  p.vline(tx, tTop, g - 31, P.white);
  p.vline(tx + tw - 1, tTop, g - 31, P.plaster[1]);
  for (const yy of [g - 30, g - 52, g - 76, tTop + 14]) {
    p.hline(tx - 1, tx + tw, yy, TRAV[4]);
    p.hline(tx - 1, tx + tw, yy + 1, TRAV[1]);
  }
  for (const yy of [g - 46, g - 70]) archFill(c, tx + 5, yy, 4, 9, () => (c.o.lit ? P.lamp[1] : ink.brown));
  archFill(c, tx + 2, tTop + 2, tw - 4, 12, () => TRAV[3]);
  archFill(c, tx + 3, tTop + 3, tw - 6, 11, () => ink.brown);
  p.stamp([".aa.", "abbc", "abbc", "aabc", ".dd."], { a: P.gold[3], b: P.gold[2], c: P.gold[1], d: P.gold[0] }, tx + 5, tTop + 6);
  balustrade(c, tx - 1, tx + tw, tTop - 4);
  const x0 = tx - 1;
  const x1 = tx + tw;
  fillProfile(
    p,
    x0,
    x1,
    (xx) => {
      if (xx < x0 || xx > x1) return null;
      const d = Math.min(xx - x0, x1 - xx) + 0.5;
      return [tTop - 5 - Math.round((d / ((x1 - x0) / 2)) * 11), tTop - 5] as const;
    },
    barrelTex(x0, x1, 99),
  );
  c.markRoof(x0, tTop - 16, x1 - x0 + 1, 12, TR, 1);
  const tcx = tx + Math.floor(tw / 2);
  p.vline(tcx, tTop - 23, tTop - 16, P.iron[1]);
  p.circle(tcx, tTop - 19, 1, P.gold[2]);
  p.hline(tcx - 3, tcx + 2, tTop - 22, P.iron[2]);
  // 两旁的柏树
  cypress(p, bx - 7, g, 40, 1);
  cypress(p, tx + tw + 6, g, 30, 2);
}

/** 开拓者：原木瞭望塔。外撑的圆木腿、层层交叉的斜撑与梯子，顶上一间原木小屋挂着警钟，木瓦顶上插旗；脚下一段木栅与柴垛。 */
function lookout(c: Canvas): void {
  const p = c.p;
  const g = c.gy;
  const cx = Math.floor(c.w / 2);
  const legTop = g - 74;
  const hwB = 17;
  const hwT = 10;
  const legX = (y: number, side: -1 | 1) => cx + side * Math.round(hwT + ((hwB - hwT) * (y - legTop)) / (g - legTop));
  // 石墩
  for (const side of [-1, 1] as const) {
    const lx = legX(g - 1, side);
    p.rect(lx - 3, g - 3, 7, 3, P.stone[2]);
    p.hline(lx - 3, lx + 3, g - 3, P.stone[3]);
  }
  // 斜撑：每 16 行一组交叉
  for (let y = legTop + 4; y < g - 10; y += 16) {
    const y2 = Math.min(g - 4, y + 16);
    p.line(legX(y, -1), y, legX(y2, 1), y2, W[1]);
    p.line(legX(y, 1), y, legX(y2, -1), y2, W[2]);
    p.hline(legX(y, -1), legX(y, 1), y, W[2]);
    p.hline(legX(y, -1), legX(y, 1), y + 1, W[1]);
  }
  // 梯子
  for (const lx of [cx - 3, cx + 2]) p.vline(lx, legTop, g - 1, W[3]);
  for (let y = legTop + 2; y < g; y += 4) p.hline(cx - 3, cx + 2, y, W[2]);
  // 两根前腿
  for (let y = legTop; y < g - 2; y++) {
    for (const side of [-1, 1] as const) {
      const lx = legX(y, side);
      p.set(lx - 1, y, W[3]).set(lx, y, W[2]).set(lx + 1, y, W[1]);
    }
  }
  // 平台
  const pw = hwT * 2 + 14;
  const px = cx - Math.floor(pw / 2);
  p.rect(px, legTop - 2, pw, 3, W[2]);
  p.hline(px, px + pw - 1, legTop - 2, W[3]);
  p.hline(px, px + pw - 1, legTop, W[1]);
  for (const sx of [px + 2, px + pw - 7]) p.line(sx + (sx > cx ? 4 : 0), legTop + 1, sx + (sx > cx ? 0 : 4), legTop + 6, W[1]);
  // 小屋：原木墙，瞭望口里挂着警钟
  const hw = hwT * 2 + 6;
  const hx = cx - Math.floor(hw / 2);
  const hTop = legTop - 16;
  chinkedLogs(p, hx, hTop, hw, 14, 3);
  logCorner(p, hx - 2, hTop, 14);
  logCorner(p, hx + hw - 2, hTop, 14);
  p.rect(hx + 4, hTop + 3, hw - 8, 6, c.o.lit ? P.lamp[1] : ink.brown);
  p.vline(cx, hTop + 3, hTop + 4, P.iron[1]);
  p.stamp([".a.", "abc", "abc", "aac"], { a: P.gold[3], b: P.gold[2], c: P.gold[1] }, cx - 1, hTop + 5);
  // 平台栏杆与晾着的兽皮
  p.hline(px, px + pw - 1, legTop - 7, W[3]);
  for (let xx = px; xx < px + pw; xx += 3) p.vline(xx, legTop - 6, legTop - 3, W[1]);
  pelt(p, hx + hw + 1, legTop - 9);
  // 四角锥木瓦顶与旗
  const x0 = hx - 5;
  const x1 = hx + hw + 4;
  const rh = 14;
  fillProfile(
    p,
    x0,
    x1,
    (xx) => {
      if (xx < x0 || xx > x1) return null;
      const d = Math.min(xx - x0, x1 - xx) + 0.5;
      return [hTop - Math.round((d / ((x1 - x0) / 2)) * rh), hTop] as const;
    },
    shingleTex(x0, x1, 99, 7),
  );
  c.markRoof(x0, hTop - rh, x1 - x0 + 1, rh + 1, SH, 1);
  p.vline(cx, hTop - rh - 14, hTop - rh, W[1]);
  const fl = frontier.flag;
  for (let i = 0; i < 9; i++) {
    const len = 6 - Math.floor(i / 2);
    const dy = i % 4 < 2 ? 0 : 1;
    p.vline(cx + 1 + i, hTop - rh - 14 + dy, hTop - rh - 14 + dy + len, i === 0 ? fl[0] : i < 3 ? fl[2] : fl[1]);
  }
  // 脚下：一段削尖的木栅与柴垛
  for (let xx = 2; xx < cx - hwB - 5; xx += 4) {
    const tip = g - 20 - ((xx >> 2) % 2);
    p.rect(xx, tip, 3, g - tip, W[2]);
    p.vline(xx, tip, g - 1, W[3]);
    p.vline(xx + 2, tip, g - 1, W[1]);
    p.set(xx + 1, tip - 1, W[3]);
  }
  p.hline(2, cx - hwB - 6, g - 14, W[1]);
  for (let r = 0; r < 3; r++) {
    for (let i = 0; i < 3 - r; i++) {
      p.stamp([".aa.", "abca", "acda", ".aa."], { a: W[1], b: W[4], c: W[3], d: W[2] }, cx + hwB + 3 + i * 4 + r * 2, g - 4 - r * 3);
    }
  }
}

/** 风格 → 地标。 */
const LANDMARK: Readonly<Record<ArchStyle, (c: Canvas) => void>> = {
  mediterranean: cathedral,
  nordic: (c) => spireTower(c),
  lowland: (c) => windmill(c),
  desert: watchtower,
  islands: lighthouse,
  eastern: pavilion,
  frontier: lookout,
};

export function drawLandmarkImpl(style: TownStyle, o: DrawOpts): Px {
  const c = new Canvas(96, 150, style, { ...o }, hash32(`landmark/${seedTag(style)}`));
  const art = cultureArt(style);
  if (art) art.landmark(c);
  else LANDMARK[style as ArchStyle](c);
  return finish(c);
}
