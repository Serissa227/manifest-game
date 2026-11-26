// 殖民建筑：殖民地的 14 种建筑（docs/EXPANSION.md §4.1 的 key），各 1–3 级，逐级变大、变精致。
// 1 级是开拓者的简陋营地（帐篷、窝棚、露天的木架）；2 级是开拓者风格的原木房子；
// 3 级换成殖民地所有者的建筑风格（风格套件画墙与屋顶），开拓者自己的殖民地仍是原木风格。
// 农田、种植园垄、矿洞、晒网这类露天设施与风格无关，只随季节变化（作物的青、黄与收割后的茬）。
import type { TownStyle } from "../buildings";
import { P, ink, overlay } from "../palette";
import type { Px } from "../px";
import { hash32 } from "../rng";
import { type DrawOpts, type Ramp, Canvas, fillProfile, finish, h01, planks, tintOpaque } from "./kit";
import { choppingBlock, pelt, rubble, SH, chinkedLogs, logCorner, shingleTex } from "./frontier";
import { thatchTex } from "./islands";
import { awning, barrel, barrelSide, bench, crate, flagCloth, lantern, sack } from "./parts";
import { type DoorKind, type Kit, type RoofKind, type WallKind, type WinKind, seedTag, windowRow } from "./style";

/** 殖民建筑的 key，顺序与 data/colony.toml 一致（只允许追加）。 */
export const COLONY_KEYS = [
  "farm",
  "plantation",
  "lumber",
  "mine",
  "fishery",
  "hunting",
  "distillery",
  "sugarmill",
  "storehouse",
  "fort",
  "chapel",
  "tavern",
  "dock",
  "housing",
] as const;
export type ColonyBuildingKey = (typeof COLONY_KEYS)[number];

/** 码头精灵：桥面上沿到底边的距离（桩脚在底边，街景据此把桥面对齐岸边）。 */
export const DOCK_DECK_FROM_BOTTOM = 14;

const CW = 128;
const CH = 104;
const W = P.wood;
/** 帐篷帆布：暗、中、亮、高光 */
const CANVAS: Ramp = [P.parchmentDeep, P.parchmentDark, P.parchment, P.paper];
/** 铜（蒸馏器、熬糖锅） */
const CU: Ramp = P.autumn;

/** 绘制上下文：画布、墙与屋顶用的风格套件、等级、旗色。 */
interface Ctx {
  c: Canvas;
  k: Kit;
  lv: 1 | 2 | 3;
  flag: Ramp;
}

// ───────────────────────── 小部件 ─────────────────────────

type Crop = "wheat" | "maize" | "potato" | "cane" | "tobacco" | "coffee";

/** 一株作物：根在 (x, y)，季节 s，r 为 0–1 的随机数（高矮与花果）。 */
function plant(p: Px, x: number, y: number, crop: Crop, s: number, r: number): void {
  switch (crop) {
    case "wheat": {
      if (s === 3) {
        if (r < 0.6) p.set(x, y, P.straw[0]);
        return;
      }
      const h = s === 0 ? 3 : 6 + (r < 0.5 ? 1 : 0);
      p.vline(x, y - h + 1, y, s === 0 ? P.leaf[3] : s === 1 ? P.leaf[2] : P.straw[2]);
      if (s >= 1) {
        p.vline(x, y - h - 1, y - h + 1, s === 1 ? P.gold[2] : P.gold[3]);
        p.set(x + 1, y - h, s === 1 ? P.gold[1] : P.gold[2]);
      }
      return;
    }
    case "maize": {
      if (s === 3) {
        if (r < 0.7) p.vline(x, y - 1, y, P.straw[1]);
        return;
      }
      if (s === 0) {
        p.vline(x, y - 3, y, P.leaf[3]);
        p.set(x - 1, y - 2, P.leaf[3]);
        return;
      }
      const dry = s === 2;
      const h = 10 + (r < 0.4 ? 1 : 0);
      const st = dry ? P.straw[2] : P.leaf[2];
      const lf = dry ? P.straw[3] : P.leaf[3];
      const dk = dry ? P.straw[1] : P.leaf[1];
      p.vline(x, y - h + 1, y, st);
      p.set(x - 1, y - 4, lf).set(x - 2, y - 5, lf).set(x + 1, y - 7, dk).set(x + 2, y - 8, dk);
      p.set(x - 1, y - 8, lf);
      p.set(x, y - h, P.gold[3]).set(x - 1, y - h - 1, P.gold[2]).set(x + 1, y - h - 1, P.gold[2]);
      p.set(x + 1, y - 5, P.gold[2]).set(x + 1, y - 4, dry ? P.gold[3] : P.leaf[3]);
      return;
    }
    case "potato": {
      if (s === 3) {
        p.hline(x - 1, x + 1, y, W[2]);
        return;
      }
      if (s === 0) {
        p.set(x, y, P.leaf[3]).set(x, y - 1, P.leaf[3]);
        return;
      }
      const top = s === 2 ? P.straw[2] : P.leaf[3];
      p.hline(x - 1, x + 1, y, s === 2 ? P.straw[1] : P.leaf[1]);
      p.hline(x - 1, x + 1, y - 1, s === 2 ? P.straw[1] : P.leaf[2]);
      p.set(x, y - 2, top).set(x - 1, y - 2, top);
      if (s === 1) p.set(x + 1, y - 2, r < 0.5 ? P.white : P.cloth.purple[2]);
      return;
    }
    case "cane": {
      const h = s === 0 ? 7 : 11 + Math.floor(r * 3);
      for (const [dx, dh] of [
        [-1, -2],
        [0, 0],
        [1, -1],
      ] as const) {
        p.vline(x + dx, y - h - dh + 1, y, dx === 1 ? P.leaf[1] : P.leaf[2]);
        for (let yy = y - 3; yy > y - h - dh; yy -= 4) p.set(x + dx, yy, P.leaf[0]);
      }
      p.line(x, y - h, x - 3, y - h + 3, P.leaf[3]);
      p.line(x, y - h + 1, x + 3, y - h + 4, P.leaf[2]);
      if (s === 2) p.set(x, y - h - 1, P.plaster[3]).set(x, y - h - 2, P.plaster[2]);
      return;
    }
    case "tobacco": {
      if (s === 3) {
        p.vline(x, y - 2, y, P.straw[0]);
        return;
      }
      const h = s === 0 ? 4 : 8;
      const lf = s === 2 ? [P.gold[2], P.straw[1]] : [P.leaf[3], P.leaf[2]];
      p.vline(x, y - h + 1, y, P.leaf[1]);
      for (let yy = y - 1; yy > y - h + 1; yy -= 3) {
        p.hline(x - 2, x - 1, yy, lf[0]).set(x - 3, yy + 1, lf[0]);
        p.hline(x + 1, x + 2, yy - 1, lf[1]).set(x + 3, yy, lf[1]);
      }
      if (s === 1) p.set(x, y - h, P.blossom[1]).set(x - 1, y - h - 1, P.blossom[2]).set(x + 1, y - h - 1, P.blossom[1]);
      return;
    }
    case "coffee": {
      p.vline(x, y - 1, y, W[1]);
      p.ellipse(x, y - 4, 3, 3, P.leaf[1]);
      p.set(x - 2, y - 6, P.leaf[3]).set(x - 1, y - 5, P.leaf[2]).set(x - 2, y - 4, P.leaf[2]).set(x, y - 7, P.leaf[2]);
      if (s === 0) p.set(x + 1, y - 5, P.white).set(x - 1, y - 3, P.white);
      else if (s === 1 || s === 2) {
        p.set(x + 1, y - 4, P.red[2]).set(x - 1, y - 3, P.red[3]);
        if (r < 0.6) p.set(x + 2, y - 2, P.red[2]);
      }
      return;
    }
  }
}

/** 一块田：x0..x1，rows 行（每行后退 3 像素），作物按行轮换。 */
function field(c: Canvas, x0: number, x1: number, rows: number, crops: readonly Crop[], seed: number): void {
  const p = c.p;
  const g = c.gy;
  const s = c.o.season;
  const top = g - rows * 3;
  // 田土：犁沟一行亮一行暗
  for (let yy = top; yy < g; yy++) p.hline(x0, x1, yy, (g - yy) % 3 === 1 ? W[2] : W[1]);
  for (let xx = x0; xx <= x1; xx++) if (h01(xx, 3, seed) < 0.2) p.set(xx, top, W[3]);
  for (let r = 0; r < rows; r++) {
    const crop = crops[(rows - 1 - r) % crops.length];
    const y = top + 2 + r * 3;
    const step = crop === "wheat" ? 2 : crop === "coffee" ? 7 : crop === "tobacco" ? 5 : 4;
    for (let xx = x0 + 2 + (r % 2); xx <= x1 - 2; xx += step) plant(p, xx, y, crop, s, h01(xx, r, seed + 7));
  }
}

/** 分道栅栏：x0..x1，立柱每 6 像素，两道横木。 */
function fence(c: Canvas, x0: number, x1: number, h = 6): void {
  const p = c.p;
  const g = c.gy;
  for (let x = x0; x <= x1; x += 6) {
    p.vline(x, g - h, g - 1, W[1]);
    p.set(x, g - h, W[3]);
  }
  p.hline(x0, x1, g - h + 1, W[3]);
  p.hline(x0, x1, g - 3, W[2]);
}

/** A 字形帆布帐篷：左边 x，宽 w，高 h。 */
function tent(c: Canvas, x: number, w: number, h: number, ramp: Ramp = CANVAS): void {
  const p = c.p;
  const g = c.gy;
  const cx = x + Math.floor(w / 2);
  for (let yy = 0; yy < h; yy++) {
    const y = g - 1 - yy;
    const hw = Math.round(((h - yy) / h) * (w / 2));
    for (let xx = cx - hw; xx <= cx + hw; xx++) {
      const left = xx <= cx;
      let col: string = left ? ramp[2] : ramp[1];
      if (xx === cx - hw) col = ramp[3];
      if (xx === cx + hw) col = ramp[0];
      if ((xx - cx) % 5 === 0 && xx !== cx && yy > 1) col = left ? ramp[1] : ramp[0];
      p.set(xx, y, col);
    }
  }
  // 门帘：挽起一角，里面暗（夜里透出灯光）
  const eh = Math.round(h * 0.62);
  const ew = Math.max(2, Math.round(w * 0.16));
  for (let yy = 0; yy < eh; yy++) {
    const hw = Math.round(((eh - yy) / eh) * ew);
    p.hline(cx - hw, cx + hw, g - 1 - yy, c.o.lit ? P.lamp[1] : ink.brown);
  }
  p.line(cx - ew - 1, g - 1, cx, g - eh, ramp[3]);
  // 顶杆与牵绳
  p.vline(cx, g - h - 3, g - h, W[1]);
  p.line(cx - Math.round(w * 0.3), g - Math.round(h * 0.55), x - 3, g - 1, P.straw[1]);
  p.line(cx + Math.round(w * 0.3), g - Math.round(h * 0.55), x + w + 2, g - 1, P.straw[0]);
  c.markRoof(x, g - h, w + 1, Math.ceil(h / 2), ramp, 0);
  seasonal(c, x, w);
}

/** 单坡窝棚：后高前低的木架上铺茅草，前面敞开。左边 x，宽 w，后柱高 h。 */
function leanTo(c: Canvas, x: number, w: number, h: number): void {
  const p = c.p;
  const g = c.gy;
  p.rect(x, g - h + 2, w, h - 2, ink.brown);
  p.hline(x, x + w - 1, g - 1, W[1]);
  p.vline(x, g - h, g - 1, W[2]);
  p.vline(x + w - 1, g - Math.round(h * 0.65), g - 1, W[2]);
  // 草顶：从后柱顶斜到前柱顶，厚 3 行
  const y0 = g - h - 1;
  const y1 = g - Math.round(h * 0.65) - 1;
  for (let xx = x - 2; xx <= x + w + 1; xx++) {
    const t = (xx - x + 2) / (w + 3);
    const y = Math.round(y0 + (y1 - y0) * t);
    p.set(xx, y, P.straw[3]).set(xx, y + 1, P.straw[2]).set(xx, y + 2, h01(xx, 1, 5) < 0.4 ? P.straw[0] : P.straw[1]);
  }
  c.markRoof(x - 2, y0, w + 4, y1 - y0 + 3, P.straw, 1);
  seasonal(c, x, w);
}

/** 篝火：一圈石头与一团火（夜里更亮）。 */
function campfire(c: Canvas, cx: number): void {
  const p = c.p;
  const g = c.gy;
  p.hline(cx - 3, cx + 3, g - 1, P.stone[2]);
  p.set(cx - 3, g - 2, P.stone[3]).set(cx + 3, g - 2, P.stone[1]);
  p.stamp(["..a..", ".aba.", "abcba", ".bcb."], { a: P.red[2], b: P.lamp[1], c: P.lamp[2] }, cx - 2, g - 5);
  if (c.o.lit) tintOpaque(p, cx - 5, g - 8, 11, 8, overlay.glow, 2);
}

/** 原木堆（端面朝外，堆成金字塔）：左下 (x, g)，底层 n 根。 */
function logPile(c: Canvas, x: number, n: number): void {
  const p = c.p;
  const g = c.gy;
  for (let r = 0; r < n; r++) {
    for (let i = 0; i < n - r; i++) {
      p.stamp([".aa.", "abca", "acda", ".aa."], { a: W[1], b: W[4], c: W[3], d: W[2] }, x + i * 4 + r * 2, g - 4 - r * 3);
    }
  }
}

/** 一摞木板（侧看）：左边 x，长 len，高 n 层。 */
function plankStack(c: Canvas, x: number, len: number, n: number): void {
  const p = c.p;
  const g = c.gy;
  for (let i = 0; i < n; i++) {
    const y = g - 2 - i * 2;
    p.hline(x + (i % 2), x + len - 1 - (i % 2), y, W[3]);
    p.hline(x + (i % 2), x + len - 1 - (i % 2), y + 1, W[2]);
  }
  p.vline(x + 2, g - 2 * n - 1, g - 1, W[0]);
  p.vline(x + len - 3, g - 2 * n - 1, g - 1, W[0]);
}

/** 树桩。 */
function stump(c: Canvas, x: number, h = 3): void {
  const p = c.p;
  const g = c.gy;
  p.rect(x, g - h, 5, h, W[1]);
  p.hline(x, x + 4, g - h, W[4]);
  p.set(x + 2, g - h, W[3]);
  p.set(x - 1, g - 1, W[1]).set(x + 5, g - 1, W[0]);
}

/** 水车：中心 (cx, cy)，半径 r；辐条、轮缘与叶板。 */
function waterWheel(c: Canvas, cx: number, cy: number, r: number): void {
  const p = c.p;
  for (let a = 0; a < 8; a++) {
    const ang = (a * Math.PI) / 4 + 0.2;
    p.line(cx, cy, cx + Math.round(Math.cos(ang) * r), cy + Math.round(Math.sin(ang) * r), W[1]);
  }
  p.ring(cx, cy, r, r, W[2]);
  p.ring(cx, cy, r - 1, r - 1, W[1]);
  for (let a = 0; a < 12; a++) {
    const ang = (a * Math.PI) / 6;
    const px = cx + Math.round(Math.cos(ang) * (r + 1));
    const py = cy + Math.round(Math.sin(ang) * (r + 1));
    p.rect(px - 1, py - 1, 2, 2, W[3]);
  }
  p.circle(cx, cy, 1, P.iron[2]);
  p.set(cx, cy, P.iron[3]);
}

/** 木渡槽：从 (x0, y) 到 (x1, y) 的水槽，槽里一道水，末端淌下的水帘落到水车上。 */
function flume(c: Canvas, x0: number, x1: number, y: number, fall: number): void {
  const p = c.p;
  p.hline(x0, x1, y, W[3]);
  p.hline(x0, x1, y + 1, P.sea[3]);
  p.hline(x0, x1, y + 2, W[1]);
  for (let x = x0 + 2; x < x1; x += 7) p.vline(x, y + 3, c.gy - 1, W[1]);
  for (let yy = y + 2; yy < y + 2 + fall; yy++) p.set(x1 + 1, yy, yy % 2 ? P.sea[4] : P.foam);
}

/** 冒烟的烟囱顶：几团向右上飘散的烟（浅灰）。 */
function smoke(c: Canvas, x: number, y: number): void {
  const p = c.p;
  const puffs: [number, number, number][] = [
    [0, -2, 1],
    [2, -6, 1],
    [5, -10, 2],
    [9, -15, 2],
  ];
  for (const [dx, dy, r] of puffs) {
    p.circle(x + dx, y + dy, r, P.plaster[3]);
    p.set(x + dx + r, y + dy, P.plaster[1]).set(x + dx, y + dy + r, P.plaster[1]);
    p.set(x + dx - r + 1, y + dy - r + 1, P.white);
  }
}

/** 小炮：炮身朝右（flip 朝左），底在地面线。 */
function cannon(c: Canvas, x: number, flip = false): void {
  const p = c.p;
  const g = c.gy;
  const d = flip ? -1 : 1;
  const bx = flip ? x - 9 : x;
  p.rect(bx, g - 6, 10, 3, P.iron[1]);
  p.hline(bx, bx + 9, g - 6, P.iron[3]);
  p.set(flip ? bx : bx + 9, g - 5, ink.deep);
  p.rect(x - 2 * d - (flip ? 3 : 0), g - 4, 6, 2, W[2]);
  p.circle(x + (flip ? -1 : 1), g - 2, 2, W[1]);
  p.set(x + (flip ? -1 : 1), g - 2, P.iron[2]);
}

/** 挂旗的旗杆：底在地面线，高 h，旗面用 flag 色阶。 */
function flagpole(c: Canvas, x: number, h: number, flag: Ramp): void {
  const p = c.p;
  const g = c.gy;
  p.vline(x, g - h, g - 1, W[1]);
  p.set(x, g - h - 1, P.gold[3]);
  flagCloth(p, x + 1, g - h, 11, 7, flag, 0);
}

/** 立在屋顶上的短旗杆：杆脚在 (x, y)，杆长 len。 */
function roofFlag(c: Canvas, x: number, y: number, len: number, flag: Ramp): void {
  c.p.vline(x, y - len, y, W[1]);
  c.p.set(x, y - len - 1, P.gold[3]);
  flagCloth(c.p, x + 1, y - len, 11, 7, flag, 0);
}

/** 削尖的圆木栅栏：x0..x1，高 h。 */
function palisade(c: Canvas, x0: number, x1: number, h: number, seed = 0): void {
  const p = c.p;
  const g = c.gy;
  for (let x = x0; x <= x1 - 2; x += 3) {
    const tip = g - h - (h01(x, 1, seed) < 0.4 ? 1 : 0);
    p.vline(x, tip + 1, g - 1, W[3]);
    p.vline(x + 1, tip, g - 1, W[2]);
    p.vline(x + 2, tip + 1, g - 1, W[1]);
  }
  p.hline(x0, x1, g - h + 3, W[1]);
  p.hline(x0, x1, g - 4, W[1]);
}

/** 墙脚的季节点缀（画在墙面范围内，不加宽建筑）：春天野花、夏天草丛、秋天南瓜与晒干的玉米，冬天什么也没有。 */
function seasonal(c: Canvas, x: number, w: number): void {
  const p = c.p;
  const g = c.gy;
  const s = c.o.season;
  if (s === 3 || w < 10) return;
  if (s === 2) {
    const px = x + w - 7;
    p.ellipse(px + 2, g - 2, 2, 1, P.autumn[2]);
    p.set(px + 1, g - 3, P.autumn[3]).set(px + 2, g - 4, P.leaf[2]);
    p.ellipse(px + 5, g - 2, 1, 1, P.autumn[1]);
    p.stamp(["aba", "bab", ".a."], { a: P.gold[2], b: P.autumn[2] }, x + 1, g - 12);
    return;
  }
  for (let i = 0; i < 4; i++) {
    const fx = x + 2 + i * 3 + (i > 1 ? w - 16 : 0);
    if (fx >= x + w - 1) continue;
    p.set(fx, g - 1, P.leaf[3]).set(fx + 1, g - 2, P.leaf[2]);
    if (s === 0) p.set(fx, g - 2, i % 2 ? P.blossom[1] : P.white);
    else p.set(fx + 1, g - 3, P.leaf[3]);
  }
}

/** 一座用风格套件画的小屋：墙宽 w、墙高 h，返回墙顶、墙底与屋顶最高点。 */
function hut(
  c: Canvas,
  k: Kit,
  x: number,
  w: number,
  h: number,
  roof: RoofKind,
  o: { door?: DoorKind | null; doorAt?: number; wins?: number[]; win?: WinKind; wall?: WallKind } = {},
): { y: number; yb: number; peak: number } {
  const g = c.gy;
  const ph = Math.max(1, k.plinthH - 1);
  const yb = g - ph;
  const y = yb - h;
  k.plinth(c, x - 1, w + 2, ph);
  k.wall(c, x, y, w, h, o.wall ?? "main");
  const peak = k.roof(c, x, w, y, roof);
  const win = o.win ?? "small";
  const [, wh] = k.winSize(win);
  for (const wx of o.wins ?? []) k.window(c, wx, y + Math.max(3, Math.floor((h - wh) / 2) - 1), win);
  if (o.door !== null) k.door(c, o.doorAt ?? x + Math.floor(w / 2), yb, o.door ?? "std");
  seasonal(c, x, w);
  return { y, yb, peak };
}

/** 两层的排屋：墙宽 w，门在左侧；楼上两扇窗。 */
function rowHouse(c: Canvas, k: Kit, x: number, w: number, roof: RoofKind, tone: number): number {
  const g = c.gy;
  const ph = Math.max(1, k.plinthH - 1);
  const yb = g - ph;
  const yg = yb - 16;
  const yu = yg - 14;
  c.tone = tone;
  k.plinth(c, x - 1, w + 2, ph);
  k.wall(c, x, yg, w, 16, tone % 2 ? "plain" : "main");
  k.wall(c, x, yu, w, 14, tone % 3 === 2 ? "plain" : "upper");
  const peak = k.roof(c, x, w, yu, roof);
  k.band(c, x, w, yg - 1);
  windowRow(c, k, x, w, yu + 4, 2, "std");
  const [dw] = k.doorSize("std");
  k.door(c, x + 3 + Math.ceil(dw / 2), yb, "std");
  const [sw] = k.winSize("small");
  k.window(c, x + w - sw - 3, yg + 5, "small");
  return peak;
}

// ───────────────────────── 14 种建筑 ─────────────────────────

/** 农庄：麦田与玉米地，稻草人 → 原木谷仓与栅栏 → 大谷仓、圆筒粮仓与草垛。 */
function farm({ c, k, lv }: Ctx): void {
  const p = c.p;
  const g = c.gy;
  const cx = CW / 2;
  if (lv === 1) {
    field(c, cx - 20, cx + 12, 2, ["wheat"], 1);
    // 稻草人
    p.vline(cx - 6, g - 17, g - 4, W[1]);
    p.hline(cx - 11, cx - 1, g - 14, W[2]);
    p.rect(cx - 8, g - 14, 5, 5, P.cloth.crimson[1]);
    p.circle(cx - 6, g - 17, 2, P.straw[3]);
    p.hline(cx - 9, cx - 3, g - 19, P.straw[1]);
    p.hline(cx - 8, cx - 4, g - 20, P.straw[2]);
    // 草垛
    p.ellipse(cx + 17, g - 5, 5, 5, P.straw[2]);
    p.rect(cx + 12, g - 4, 11, 4, P.straw[2]);
    p.set(cx + 14, g - 8, P.straw[3]).set(cx + 15, g - 9, P.straw[3]).set(cx + 20, g - 3, P.straw[1]);
    c.markRoof(cx + 12, g - 10, 11, 4, P.straw, 0);
    return;
  }
  if (lv === 2) {
    field(c, cx - 30, cx + 6, 3, ["wheat", "maize"], 2);
    fence(c, cx - 33, cx + 9);
    hut(c, k, cx + 12, 24, 14, "main", { door: "barn", doorAt: cx + 24 });
    return;
  }
  field(c, cx - 46, cx - 2, 3, ["wheat", "maize", "potato"], 3);
  fence(c, cx - 49, cx + 2);
  // 圆筒粮仓：竖板筒身、圆锥木瓦顶
  const sx = cx + 4;
  planks(p, sx, g - 30, 12, 30, W, 2, 3);
  for (const yy of [g - 24, g - 14, g - 5]) p.hline(sx, sx + 11, yy, P.iron[1]);
  const x0 = sx - 2;
  const x1 = sx + 13;
  fillProfile(
    p,
    x0,
    x1,
    (xx) => {
      if (xx < x0 || xx > x1) return null;
      const d = Math.min(xx - x0, x1 - xx) + 0.5;
      return [g - 30 - Math.round((d / ((x1 - x0) / 2)) * 9), g - 30] as const;
    },
    shingleTex(x0, x1, 99, 3),
  );
  c.markRoof(x0, g - 39, x1 - x0 + 1, 10, SH, 1);
  hut(c, k, cx + 20, 34, 18, "main", { door: "barn", doorAt: cx + 37, wins: [cx + 23] });
  // 草垛
  p.ellipse(cx - 40, g - 6, 6, 6, P.straw[2]);
  p.rect(cx - 46, g - 5, 13, 5, P.straw[2]);
  p.set(cx - 43, g - 10, P.straw[3]).set(cx - 41, g - 11, P.straw[3]);
  c.markRoof(cx - 46, g - 12, 13, 5, P.straw, 0);
}

/** 种植园：整齐的甘蔗与烟草垄 → 加一座晾烟叶的板条棚 → 再加园主的两层带回廊的宅子。 */
function plantation({ c, k, lv }: Ctx): void {
  const p = c.p;
  const g = c.gy;
  const cx = CW / 2;
  /** 板条晾棚：挂满一串串的叶子。 */
  const dryShed = (x: number, w: number, h: number) => {
    for (let xx = x; xx < x + w; xx += 3) p.vline(xx, g - h, g - 1, W[2]);
    for (let xx = x + 1; xx < x + w; xx += 3) {
      for (let yy = g - h + 3; yy < g - 3; yy += 4) p.vline(xx, yy, yy + 2, c.o.season === 1 ? P.leaf[2] : P.gold[1]);
    }
    const x0 = x - 3;
    const x1 = x + w + 2;
    fillProfile(p, x0, x1, (xx) => (xx < x0 || xx > x1 ? null : ([g - h - Math.round((1 - Math.abs(xx - (x0 + x1) / 2) / ((x1 - x0) / 2)) * 8), g - h] as const)), thatchTex(x0, x1, x));
    c.markRoof(x0, g - h - 8, x1 - x0 + 1, 9, P.straw, 1);
  };
  if (lv === 1) {
    field(c, cx - 22, cx + 6, 2, ["tobacco", "cane"], 4);
    tent(c, cx + 9, 16, 11);
    return;
  }
  if (lv === 2) {
    field(c, cx - 32, cx + 4, 3, ["cane", "tobacco"], 5);
    dryShed(cx + 9, 22, 15);
    return;
  }
  field(c, cx - 52, cx - 12, 3, ["coffee", "cane", "tobacco"], 6);
  // 园主宅：两层，楼下一排回廊柱
  const hx = cx - 6;
  const hw = 38;
  const ph = Math.max(1, k.plinthH - 1);
  const yb = g - ph;
  const yg = yb - 16;
  const yu = yg - 14;
  k.plinth(c, hx - 2, hw + 4, ph);
  k.wall(c, hx, yg, hw, 16, "main");
  k.wall(c, hx, yu, hw, 14, "upper");
  k.roof(c, hx, hw, yu, "main");
  windowRow(c, k, hx, hw, yu + 4, 3, "std");
  k.door(c, hx + Math.floor(hw / 2), yb, "double");
  windowRow(c, k, hx, hw, yg + 4, 4, "std", (i) => i === 1 || i === 2);
  // 回廊：一道挑檐与细柱
  p.rect(hx - 3, yg - 1, hw + 6, 2, W[2]);
  p.hline(hx - 3, hx + hw + 2, yg - 1, W[3]);
  for (let xx = hx - 2; xx <= hx + hw + 1; xx += 8) p.vline(xx, yg + 1, yb - 1, W[3]);
  tintOpaque(p, hx, yg + 1, hw, 2, overlay.shadow);
  dryShed(cx + 36, 16, 14);
}

/** 伐木场：树桩、锯木架与小柴堆 → 大原木堆、锯木坑与窝棚 → 水力锯木坊、渡槽与木板垛。 */
function lumber({ c, k, lv }: Ctx): void {
  const p = c.p;
  const g = c.gy;
  const cx = CW / 2;
  /** 锯木架：两个 X 形架子上横着一根原木，架间一把长锯。 */
  const sawhorse = (x: number, len: number) => {
    for (const sx of [x + 2, x + len - 5]) {
      p.line(sx, g - 1, sx + 3, g - 7, W[1]);
      p.line(sx + 3, g - 1, sx, g - 7, W[2]);
    }
    p.rect(x, g - 9, len, 3, W[2]);
    p.hline(x, x + len - 1, g - 9, W[3]);
    p.stamp([".a.", "abc", ".c."], { a: W[3], b: W[4], c: W[1] }, x + len - 2, g - 10);
    p.line(x + Math.floor(len / 2), g - 12, x + Math.floor(len / 2) + 1, g - 6, P.iron[2]);
    p.hline(x + Math.floor(len / 2) - 1, x + Math.floor(len / 2) + 2, g - 12, W[1]);
  };
  if (lv === 1) {
    stump(c, cx - 18);
    stump(c, cx - 10, 2);
    sawhorse(cx - 4, 16);
    logPile(c, cx + 14, 2);
    choppingBlock(p, cx - 26, g);
    return;
  }
  if (lv === 2) {
    leanTo(c, cx - 30, 20, 16);
    logPile(c, cx - 28, 3);
    sawhorse(cx - 6, 20);
    logPile(c, cx + 16, 4);
    stump(c, cx + 11);
    return;
  }
  // 水力锯木坊
  const mx = cx - 20;
  hut(c, k, mx, 34, 18, "shed", { door: "open", doorAt: mx + 22, wins: [mx + 4] });
  waterWheel(c, mx - 9, g - 12, 10);
  flume(c, mx - 34, mx - 18, g - 26, 6);
  logPile(c, cx + 18, 5);
  plankStack(c, cx - 50, 20, 4);
  stump(c, cx + 42);
  choppingBlock(p, mx + 36, g);
}

/** 矿坑：一座石丘上的木框矿洞口 → 加铁轨与矿车、工具棚 → 大矿山、井架天轮与矿砂仓。 */
function mine({ c, k, lv }: Ctx): void {
  const p = c.p;
  const g = c.gy;
  const cx = CW / 2;
  /** 石丘：x0..x1，最高 h；顶上长草。 */
  const mound = (x0: number, x1: number, h: number, seed: number) => {
    const grass: string[] = [];
    for (let x = x0; x <= x1; x++) {
      const t = (x - x0) / (x1 - x0);
      const top = g - Math.round(Math.pow(Math.sin(Math.PI * t), 0.7) * h + (h01(x >> 2, 1, seed) - 0.5) * 3);
      for (let y = top; y < g; y++) {
        // 按 4×3 的石块取色，块与块之间留暗缝，岩层随高度起伏
        const bx = (x + (Math.floor(y / 3) % 2) * 2) >> 2;
        const by = Math.floor(y / 3);
        const r = h01(bx, by, seed);
        let col: string = t < 0.35 ? P.stone[3] : t > 0.68 ? P.stone[1] : P.stone[2];
        if (r < 0.18) col = t > 0.68 ? P.stone[0] : P.stone[1];
        else if (r > 0.85 && t < 0.68) col = P.stone[4];
        if (y % 3 === 2 && h01(bx, by, seed + 1) < 0.6) col = t > 0.68 ? P.stone[0] : P.stone[1];
        p.set(x, y, col);
      }
      if (top < g - 1) {
        grass.push(`${x},${top}`);
        p.set(x, top, P.leaf[t < 0.5 ? 3 : 2]);
        if (h01(x, 2, seed) < 0.5) p.set(x, top + 1, P.leaf[1]);
      }
    }
    c.markRoof(x0, g - h - 3, x1 - x0 + 1, h + 3, [P.leaf[1], P.leaf[2], P.leaf[3]], 0);
    void grass;
  };
  /** 木框矿洞口：中心 x，高 h。 */
  const adit = (x: number, h: number) => {
    p.rect(x - 5, g - h, 10, h, ink.deep);
    p.rect(x - 4, g - h + 2, 8, h - 2, ink.brown);
    p.rect(x - 6, g - h, 2, h, W[2]);
    p.vline(x - 6, g - h, g - 1, W[3]);
    p.rect(x + 4, g - h, 2, h, W[1]);
    p.rect(x - 8, g - h - 3, 16, 3, W[2]);
    p.hline(x - 8, x + 7, g - h - 3, W[3]);
    if (c.o.lit) lantern(c, x - 8, g - h, "iron");
  };
  /** 矿车：左边 x，车底离地 lift。 */
  const cart = (x: number, lift = 0) => {
    const b = g - 2 - lift;
    p.rect(x, b - 5, 10, 5, W[1]);
    p.hline(x, x + 9, b - 5, W[3]);
    p.vline(x, b - 5, b - 1, P.iron[2]);
    p.vline(x + 9, b - 5, b - 1, P.iron[1]);
    for (let i = 0; i < 4; i++) p.set(x + 2 + i * 2, b - 6, i % 2 ? P.stone[3] : P.gold[2]).set(x + 3 + i * 2, b - 7, P.stone[2]);
    p.circle(x + 2, b + 1, 1, P.iron[1]);
    p.circle(x + 7, b + 1, 1, P.iron[1]);
  };
  const rails = (x0: number, x1: number) => {
    p.hline(x0, x1, g - 1, P.iron[2]);
    for (let x = x0; x <= x1; x += 3) p.set(x, g - 1, W[1]);
  };
  const orePile = (x: number, w: number) => {
    for (let i = 0; i < w; i++) {
      const hgt = Math.round(Math.sin((Math.PI * (i + 0.5)) / w) * (w / 3));
      for (let y = g - hgt; y < g; y++) p.set(x + i, y, h01(x + i, y, 9) < 0.2 ? P.gold[2] : h01(x + i, y, 8) < 0.5 ? P.stone[2] : P.stone[1]);
    }
  };
  if (lv === 1) {
    mound(cx - 22, cx + 18, 20, 1);
    adit(cx - 2, 12);
    orePile(cx + 14, 9);
    // 靠在洞口的镐
    p.line(cx + 5, g - 1, cx + 8, g - 8, W[3]);
    p.line(cx + 6, g - 9, cx + 10, g - 7, P.iron[2]);
    return;
  }
  if (lv === 2) {
    mound(cx - 34, cx + 12, 28, 2);
    adit(cx - 12, 14);
    rails(cx - 12, cx + 26);
    cart(cx + 2);
    orePile(cx + 16, 10);
    hut(c, k, cx + 28, 16, 12, "porch", { door: "std" });
    return;
  }
  mound(cx - 50, cx + 4, 40, 3);
  adit(cx - 22, 16);
  // 井架：A 字木塔，顶上天轮，钢索垂入矿井
  const hx = cx - 2;
  p.line(hx - 8, g - 1, hx - 1, g - 50, W[2]);
  p.line(hx + 8, g - 1, hx + 1, g - 50, W[1]);
  for (let y = g - 44; y < g - 4; y += 10) {
    const hw = Math.round(1 + ((y - (g - 50)) / 50) * 7);
    p.hline(hx - hw, hx + hw, y, W[2]);
    p.line(hx - hw, y, hx + hw + 1, y + 10, W[1]);
  }
  p.ring(hx, g - 51, 4, 4, P.iron[1]);
  p.set(hx, g - 51, P.iron[3]);
  p.line(hx + 4, g - 51, hx + 4, g - 6, P.iron[2]);
  p.line(hx - 4, g - 51, hx - 20, g - 20, P.iron[2]);
  p.rect(hx + 2, g - 7, 5, 6, P.iron[1]);
  rails(cx - 22, cx + 34);
  cart(cx + 10);
  cart(cx + 22);
  // 矿砂仓：高脚木仓
  const bx = cx + 34;
  for (const px of [bx, bx + 12]) p.vline(px, g - 12, g - 1, W[1]);
  planks(p, bx - 1, g - 26, 15, 14, W, 1, 3);
  p.hline(bx - 2, bx + 14, g - 27, W[3]);
  p.line(bx + 13, g - 13, bx + 17, g - 8, W[2]);
  orePile(bx + 15, 8);
  c.markRoof(bx - 2, g - 27, 17, 1, W, 0);
  void k;
}

/** 渔场：短栈桥、晒鱼架与晾网杆 → 加一间渔屋与倒扣的小船 → 熏鱼房、成排的晒架与鱼桶。 */
function fishery({ c, k, lv }: Ctx): void {
  const p = c.p;
  const g = c.gy;
  const cx = CW / 2;
  /** 晒鱼架：两根桩一根横杆，挂一排头朝上的银鱼（鱼身两像素宽、尾巴分叉）。 */
  const rack = (x: number, w: number, h: number) => {
    p.vline(x, g - h, g - 1, W[1]);
    p.vline(x + w - 1, g - h, g - 1, W[1]);
    p.hline(x - 1, x + w, g - h, W[3]);
    for (let xx = x + 2, i = 0; xx < x + w - 3; xx += 3, i++) {
      const len = 4 + (i % 2);
      const y0 = g - h + 1;
      p.set(xx, y0, P.straw[1]);
      p.vline(xx, y0 + 1, y0 + len, P.stone[4]);
      p.vline(xx + 1, y0 + 1, y0 + len, P.stone[2]);
      p.set(xx, y0 + 1, P.stone[3]);
      p.set(xx - 1, y0 + len + 1, P.stone[2]).set(xx + 2, y0 + len + 1, P.stone[1]);
    }
  };
  /** 晾网：两根杆之间垂着一张深色网眼的渔网，网边挂着红色浮子。 */
  const net = (x: number, w: number, h: number) => {
    p.vline(x, g - h, g - 1, W[2]);
    p.vline(x + w, g - h, g - 1, W[1]);
    for (let xx = x + 1; xx < x + w; xx++) {
      const t = (xx - x) / w;
      const sag = Math.round(Math.sin(Math.PI * t) * 3);
      const top = g - h + 1 + sag;
      const bottom = g - 4 - Math.round(Math.sin(Math.PI * t) * 2);
      for (let yy = top + 1; yy < bottom; yy++) if ((xx + yy) % 4 === 0 || (xx - yy) % 4 === 0) p.set(xx, yy, P.wood[1]);
      p.set(xx, top, P.straw[1]);
      p.set(xx, bottom, P.wood[1]);
      if ((xx - x) % 5 === 2) p.set(xx, top, P.red[2]).set(xx, top + 1, P.red[1]);
    }
  };
  /** 倒扣在木架上的小船。 */
  const boat = (x: number) => {
    p.vline(x + 2, g - 4, g - 1, W[1]);
    p.vline(x + 15, g - 4, g - 1, W[1]);
    p.ellipse(x + 9, g - 5, 9, 3, P.teal[2]);
    p.rect(x, g - 5, 19, 2, P.teal[1]);
    p.hline(x + 2, x + 16, g - 8, P.teal[3]);
    p.hline(x, x + 18, g - 4, W[0]);
  };
  if (lv === 1) {
    rack(cx - 20, 14, 12);
    net(cx - 2, 16, 14);
    barrel(p, cx + 17, g);
    return;
  }
  if (lv === 2) {
    hut(c, k, cx - 34, 20, 12, "main", { door: "std", doorAt: cx - 28, wins: [cx - 22] });
    rack(cx - 8, 14, 12);
    net(cx + 8, 16, 14);
    boat(cx + 26);
    return;
  }
  // 熏鱼房：墙上冒烟的气窗
  const sx = cx - 48;
  const { peak } = hut(c, k, sx, 28, 16, "main", { door: "std", doorAt: sx + 7, wins: [sx + 16] });
  smoke(c, sx + 22, peak);
  rack(sx + 34, 14, 14);
  rack(sx + 50, 14, 12);
  net(cx + 18, 18, 16);
  boat(cx + 38);
  barrel(p, cx + 8, g);
  barrel(p, cx + 1, g);
  barrelSide(p, cx + 3, g - 9);
}

/** 猎场：窝棚、兽皮绷架与鹿角 → 原木猎屋，门上挂鹿角 → 毛皮收购站与成排的皮架、熏肉棚。 */
function hunting({ c, k, lv }: Ctx): void {
  const p = c.p;
  const g = c.gy;
  const cx = CW / 2;
  /** 皮架：两根桩上绷着几张兽皮。 */
  const furRack = (x: number, n: number) => {
    p.vline(x, g - 12, g - 1, W[1]);
    p.vline(x + n * 8, g - 12, g - 1, W[1]);
    p.hline(x, x + n * 8, g - 12, W[3]);
    for (let i = 0; i < n; i++) pelt(p, x + 1 + i * 8, g - 11);
  };
  const antlers = (x: number, y: number) => {
    p.stamp(["a.a.a...a.a.a", ".a.a.....a.a.", "..aaa...aaa..", "....aa.aa....", "......b......"], { a: P.plaster[3], b: W[1] }, x - 6, y);
  };
  if (lv === 1) {
    leanTo(c, cx - 18, 16, 14);
    furRack(cx + 2, 1);
    campfire(c, cx + 16);
    p.vline(cx - 22, g - 12, g - 1, W[1]);
    antlers(cx - 22, g - 17);
    return;
  }
  if (lv === 2) {
    const { y } = hut(c, k, cx - 24, 28, 14, "main", { door: "std", doorAt: cx - 10, wins: [cx - 20] });
    antlers(cx - 10, y - 1);
    furRack(cx + 8, 2);
    choppingBlock(p, cx + 27, g);
    return;
  }
  const { y } = hut(c, k, cx - 44, 42, 18, "main", { door: "double", doorAt: cx - 23, wins: [cx - 40, cx - 12] });
  antlers(cx - 23, y - 1);
  furRack(cx + 2, 3);
  // 熏肉棚
  leanTo(c, cx + 30, 14, 14);
  for (let xx = cx + 32; xx < cx + 42; xx += 3) p.vline(xx, g - 10, g - 7, P.red[1]);
  smoke(c, cx + 36, g - 18);
}

/** 酿酒坊：窝棚下的铜壶蒸馏器 → 带烟囱的原木作坊与酒桶垛 → 石砌酿酒坊、高烟囱与桶架。 */
function distillery({ c, k, lv }: Ctx): void {
  const p = c.p;
  const g = c.gy;
  const cx = CW / 2;
  /** 铜壶蒸馏器：石灶上一只洋葱形铜壶，鹅颈管接到冷凝桶。size 为壶的半径。 */
  const still = (x: number, size: number) => {
    const hy = g - 4;
    p.rect(x - size - 2, hy, size * 2 + 5, 4, P.stone[2]);
    p.hline(x - size - 2, x + size + 2, hy, P.stone[3]);
    p.stamp([".a.", "aba"], { a: P.red[2], b: P.lamp[1] }, x - 1, g - 3);
    const py = hy - size;
    p.ellipse(x, py, size + 1, size, CU[2]);
    p.ellipse(x - 1, py - 1, Math.max(1, size - 2), Math.max(1, size - 2), CU[3]);
    p.set(x - Math.floor(size / 2), py - Math.floor(size / 2), CU[3]);
    p.vline(x + size + 1, py - 1, py + 2, CU[1]);
    p.rect(x - 1, py - size - 4, 3, 4, CU[2]);
    p.vline(x - 1, py - size - 4, py - size - 1, CU[3]);
    // 鹅颈管与冷凝桶
    p.line(x + 1, py - size - 4, x + size + 7, py - size + 1, CU[1]);
    p.line(x + 1, py - size - 5, x + size + 7, py - size, CU[3]);
    barrel(p, x + size + 5, g);
  };
  if (lv === 1) {
    leanTo(c, cx - 16, 24, 17);
    still(cx - 7, 4);
    barrel(p, cx + 12, g);
    return;
  }
  if (lv === 2) {
    const { peak } = hut(c, k, cx - 30, 30, 16, "main", { door: "std", doorAt: cx - 22, wins: [cx - 13] });
    smoke(c, cx - 8, peak);
    still(cx + 8, 5);
    for (let i = 0; i < 3; i++) barrelSide(p, cx + 22 + (i % 2) * 5, g - Math.floor(i / 2) * 7);
    return;
  }
  const sx = cx - 44;
  hut(c, k, sx, 48, 22, "main", { door: "double", doorAt: sx + 14, wins: [sx + 26, sx + 38], wall: "stone", win: "std" });
  // 高砖烟囱
  const chx = sx + 50;
  for (let y = g - 56; y < g; y++) {
    p.hline(chx, chx + 5, y, (y >> 1) % 2 ? P.brick[2] : P.brick[3]);
    p.set(chx + 5, y, P.brick[1]);
  }
  p.rect(chx - 1, g - 58, 8, 2, P.brick[1]);
  smoke(c, chx + 3, g - 58);
  still(cx + 18, 6);
  // 桶架
  const rx = cx + 36;
  p.rect(rx - 1, g - 16, 2, 16, W[1]);
  p.rect(rx + 19, g - 16, 2, 16, W[1]);
  for (let r = 0; r < 2; r++) for (let i = 0; i < 2; i++) barrelSide(p, rx + 1 + i * 9, g - r * 8);
}

/** 糖坊：畜力压榨机与甘蔗捆 → 水车糖坊与熬糖烟囱 → 大水车、熬糖房、高烟囱与糖桶。 */
function sugarmill({ c, k, lv }: Ctx): void {
  const p = c.p;
  const g = c.gy;
  const cx = CW / 2;
  const caneBundle = (x: number) => {
    for (let i = 0; i < 6; i++) p.line(x + i, g - 1, x + i + 2, g - 9, i % 2 ? P.leaf[1] : P.leaf[2]);
    p.hline(x + 1, x + 6, g - 5, P.straw[1]);
    p.set(x + 8, g - 10, P.leaf[3]).set(x + 6, g - 10, P.leaf[3]);
  };
  const sugarBarrel = (x: number) => {
    barrel(p, x, g);
    p.hline(x + 1, x + 5, g - 9, P.white);
  };
  if (lv === 1) {
    // 三辊压榨机：竖直的三根木辊，顶上一根长长的推杆
    const mx = cx - 6;
    p.rect(mx - 7, g - 3, 15, 3, P.stone[2]);
    p.hline(mx - 7, mx + 7, g - 3, P.stone[3]);
    for (const dx of [-5, -1, 3]) {
      p.rect(mx + dx, g - 13, 3, 10, W[2]);
      p.vline(mx + dx, g - 13, g - 4, W[3]);
      p.hline(mx + dx, mx + dx + 2, g - 9, P.iron[1]);
    }
    p.rect(mx - 7, g - 15, 15, 2, W[1]);
    p.line(mx, g - 16, mx - 20, g - 10, W[2]);
    p.line(mx, g - 17, mx - 20, g - 11, W[3]);
    caneBundle(cx + 6);
    caneBundle(cx + 14);
    return;
  }
  if (lv === 2) {
    const mx = cx - 16;
    hut(c, k, mx, 30, 16, "main", { door: "open", doorAt: mx + 18, wins: [mx + 5] });
    waterWheel(c, mx - 6, g - 9, 8);
    flume(c, mx - 26, mx - 16, g - 20, 4);
    // 熬糖烟囱
    const chx = mx + 36;
    rubble(p, chx, g - 26, 6, 26, 3);
    smoke(c, chx + 3, g - 27);
    caneBundle(chx + 9);
    return;
  }
  const mx = cx - 22;
  hut(c, k, mx, 36, 22, "main", { door: "open", doorAt: mx + 25, wins: [mx + 5, mx + 12], win: "std" });
  waterWheel(c, mx - 9, g - 13, 12);
  flume(c, mx - 30, mx - 24, g - 30, 5);
  // 熬糖房：毛石矮屋与高烟囱
  const bx = mx + 40;
  rubble(p, bx, g - 14, 22, 14, 9);
  p.rect(bx + 4, g - 9, 6, 9, c.o.lit ? P.lamp[1] : ink.brown);
  p.hline(bx - 1, bx + 24, g - 15, P.stone[3]);
  p.hline(bx - 1, bx + 24, g - 14, P.stone[1]);
  const chx = bx + 16;
  rubble(p, chx, g - 44, 6, 30, 4);
  smoke(c, chx + 3, g - 45);
  caneBundle(bx + 27);
  sugarBarrel(bx + 12);
  sugarBarrel(bx + 2);
}

/** 仓棚：四根柱子撑起的茅草棚 → 原木仓房与货箱 → 带阁楼吊臂的大仓库。 */
function storehouse({ c, k, lv }: Ctx): void {
  const p = c.p;
  const g = c.gy;
  const cx = CW / 2;
  if (lv === 1) {
    const x = cx - 16;
    const w = 30;
    for (const px of [x, x + w - 2]) p.rect(px, g - 14, 2, 14, W[2]);
    const x0 = x - 4;
    const x1 = x + w + 3;
    fillProfile(p, x0, x1, (xx) => (xx < x0 || xx > x1 ? null : ([g - 15 - Math.round((1 - Math.abs(xx - (x0 + x1) / 2) / ((x1 - x0) / 2)) * 8), g - 13] as const)), thatchTex(x0, x1, 3));
    c.markRoof(x0, g - 23, x1 - x0 + 1, 10, P.straw, 1);
    tintOpaque(p, x, g - 12, w, 12, overlay.shadowLight);
    crate(p, x + 3, g, 7, W, 1);
    crate(p, x + 10, g, 6, W, 2);
    crate(p, x + 5, g - 7, 6, W, 3);
    sack(p, x + 18, g, 1);
    sack(p, x + 23, g, 0);
    return;
  }
  if (lv === 2) {
    hut(c, k, cx - 24, 40, 16, "main", { door: "barn", doorAt: cx - 6, wins: [cx + 7] });
    crate(p, cx + 18, g, 7, W, 4);
    crate(p, cx + 25, g, 6, W, 5);
    sack(p, cx - 31, g, 1);
    return;
  }
  const x = cx - 36;
  const w = 62;
  const { y } = hut(c, k, x, w, 26, "main", { door: "barn", doorAt: x + 24, wins: [x + 44, x + 52] });
  // 阁楼门与吊臂
  const lx = x + 20;
  p.rect(lx, y + 3, 8, 7, ink.brown);
  p.stroke(lx - 1, y + 2, 10, 9, W[1]);
  p.rect(lx + 2, y, 18, 2, W[2]);
  p.hline(lx + 2, lx + 19, y, W[3]);
  p.vline(lx + 17, y + 2, y + 12, P.straw[1]);
  crate(p, lx + 14, y + 19, 7, W, 6);
  crate(p, x + w + 1, g, 7, W, 7);
  crate(p, x + w + 8, g, 6, W, 8);
  crate(p, x + w + 3, g - 7, 6, W, 9);
  sack(p, x - 7, g, 1);
  sack(p, x - 4, g - 5, 0);
}

/** 栅栏堡：一段带门的木栅与旗杆 → 木栅围着一座外挑的原木堡、门前一门炮 → 毛石棱堡、木塔与两门炮。 */
function fort({ c, flag, lv }: Ctx): void {
  const p = c.p;
  const g = c.gy;
  const cx = CW / 2;
  /** 外挑的原木堡：墙宽 w，下层高 h1，上层高 h2。 */
  const blockhouse = (x: number, w: number, h1: number, h2: number, base = 0) => {
    const b = g - base;
    chinkedLogs(p, x, b - h1, w, h1, x);
    logCorner(p, x - 2, b - h1, h1);
    logCorner(p, x + w - 2, b - h1, h1);
    const ut = b - h1 - h2;
    chinkedLogs(p, x - 3, ut, w + 6, h2, x + 1);
    logCorner(p, x - 5, ut, h2);
    logCorner(p, x + w + 1, ut, h2);
    p.hline(x - 3, x + w + 2, ut + h2, W[0]);
    for (const sx of [x + 1, x + Math.floor(w / 2) - 1, x + w - 3]) p.rect(sx, ut + 3, 2, 3, c.o.lit ? P.lamp[1] : ink.deep);
    const x0 = x - 6;
    const x1 = x + w + 5;
    const rh = Math.round(w * 0.45);
    fillProfile(p, x0, x1, (xx) => (xx < x0 || xx > x1 ? null : ([ut - Math.round(((Math.min(xx - x0, x1 - xx) + 0.5) / ((x1 - x0) / 2)) * rh), ut] as const)), shingleTex(x0, x1, 99, x));
    c.markRoof(x0, ut - rh, x1 - x0 + 1, rh + 1, SH, 1);
    return ut - rh;
  };
  if (lv === 1) {
    palisade(c, cx - 26, cx - 5, 16, 1);
    palisade(c, cx + 5, cx + 24, 16, 2);
    // 门：两根高门柱与一根横梁
    for (const px of [cx - 5, cx + 3]) p.rect(px, g - 20, 3, 20, W[2]);
    p.rect(cx - 7, g - 21, 13, 2, W[3]);
    flagpole(c, cx + 18, 26, flag);
    return;
  }
  if (lv === 2) {
    palisade(c, cx - 34, cx + 32, 16, 3);
    const top = blockhouse(cx - 9, 18, 14, 10);
    roofFlag(c, cx, top + 1, 10, flag);
    cannon(c, cx - 30);
    cannon(c, cx + 28, true);
    return;
  }
  // 毛石棱堡：下宽上窄的石墙，墙顶一排木栅与炮眼
  const x0 = cx - 50;
  const x1 = cx + 46;
  const wallH = 22;
  // 墙顶后面的木栅（先画，下半截被石墙挡住）
  palisade(c, x0 + 6, cx - 14, wallH + 8, 4);
  palisade(c, cx + 14, x1 - 6, wallH + 8, 5);
  rubble(p, x0, g - wallH + 1, x1 - x0 + 1, wallH - 1, 17);
  for (let y = g - wallH; y < g; y++) {
    // 墙身下宽上窄：两端按高度削去
    const k = Math.round(((g - y) / wallH) * 4);
    if (k > 0) {
      p.hline(x0, x0 + k - 1, y, null);
      p.hline(x1 - k + 1, x1, y, null);
    }
  }
  p.hline(x0 + 4, x1 - 4, g - wallH, P.stone[4]);
  for (let x = x0 + 8; x < x1 - 8; x += 14) {
    p.rect(x, g - wallH + 5, 4, 3, ink.deep);
    p.rect(x + 1, g - wallH + 6, 3, 1, P.iron[2]);
  }
  // 石墙正中的门洞
  p.rect(cx - 6, g - 14, 12, 14, ink.brown);
  p.hline(cx - 7, cx + 6, g - 15, P.stone[4]);
  const top = blockhouse(cx - 10, 20, 18, 12, wallH - 4);
  roofFlag(c, cx, top + 1, 12, flag);
  cannon(c, x0 + 10);
  cannon(c, x1 - 10, true);
}

/** 礼拜堂：原木小堂与木架上的钟 → 屋脊上带小钟亭的木堂 → 带钟楼的石砌礼拜堂（所有者风格）。顶上是金色星饰。 */
function chapel({ c, k, lv }: Ctx): void {
  const p = c.p;
  const g = c.gy;
  const cx = CW / 2;
  const star = (x: number, y: number) => {
    p.vline(x, y - 3, y, W[1]);
    p.stamp([".a.", "aba", ".a."], { a: P.gold[3], b: P.gold[4] }, x - 1, y - 6);
  };
  const bell = (x: number, y: number) => {
    p.stamp([".a.", "abc", "abc", "aac"], { a: P.gold[3], b: P.gold[2], c: P.gold[1] }, x - 1, y);
  };
  if (lv === 1) {
    const { peak } = hut(c, k, cx - 12, 22, 13, "gable", { door: "std" });
    star(cx - 1, peak);
    // 钟架
    const bx = cx + 16;
    p.vline(bx - 4, g - 16, g - 1, W[2]);
    p.vline(bx + 4, g - 16, g - 1, W[1]);
    p.rect(bx - 5, g - 17, 11, 2, W[3]);
    bell(bx, g - 15);
    return;
  }
  if (lv === 2) {
    const x = cx - 18;
    const w = 34;
    const { y, peak } = hut(c, k, x, w, 17, "main", { door: "double", wins: [x + 3, x + w - 7] });
    // 屋脊上的钟亭
    const bx = cx - 1;
    const by = peak + 2;
    p.rect(bx - 4, by - 9, 2, 9, W[2]);
    p.rect(bx + 3, by - 9, 2, 9, W[1]);
    bell(bx, by - 7);
    const x0 = bx - 7;
    const x1 = bx + 7;
    fillProfile(p, x0, x1, (xx) => (xx < x0 || xx > x1 ? null : ([by - 10 - Math.round(((Math.min(xx - x0, x1 - xx) + 0.5) / 7.5) * 6), by - 9] as const)), shingleTex(x0, x1, 99, 5));
    c.markRoof(x0, by - 16, 15, 7, SH, 1);
    star(bx, by - 16);
    p.circle(cx - 1, y + 5, 2, c.o.lit ? P.lamp[1] : P.slate[1]);
    return;
  }
  const x = cx - 22;
  const w = 38;
  hut(c, k, x, w, 22, "gable", { door: "double", doorAt: x + 21, wins: [x + 5, x + w - 9], win: "tall", wall: "stone" });
  // 钟楼
  const tx = x - 12;
  const tw = 14;
  const ph = Math.max(1, k.plinthH - 1);
  const tTop = g - ph - 44;
  k.plinth(c, tx - 1, tw + 2, ph);
  k.wall(c, tx, tTop, tw, g - ph - tTop, "stone");
  k.band(c, tx, tw, g - ph - 22);
  const [sw] = k.winSize("small");
  k.window(c, tx + Math.floor((tw - sw) / 2), tTop + 6, "small");
  k.window(c, tx + Math.floor((tw - sw) / 2), g - ph - 18, "small");
  const peak = k.roof(c, tx, tw, tTop, "tower");
  star(tx + Math.floor(tw / 2), Math.max(8, peak));
}

/** 殖民地酒馆：帆布大帐篷、凉棚与酒桶 → 原木酒馆，暖窗与挂牌 → 两层的酒馆（所有者风格）。 */
function tavern({ c, k, lv }: Ctx): void {
  const p = c.p;
  const g = c.gy;
  const cx = CW / 2;
  /** 立在木桩上的酒杯招牌。 */
  const signPost = (x: number) => {
    p.vline(x, g - 18, g - 1, W[1]);
    p.hline(x, x + 8, g - 18, W[2]);
    k.sign(c, x + 8, g - 17, "tavern");
  };
  if (lv === 1) {
    tent(c, cx - 18, 30, 16, [P.cloth.crimson[0], P.cloth.crimson[1], P.cloth.crimson[2], P.blossom[2]]);
    awning(c, cx + 8, g - 12, 14, 2, CANVAS, [P.cloth.crimson[0], P.cloth.crimson[1], P.cloth.crimson[2]]);
    p.vline(cx + 8, g - 12, g - 1, W[1]);
    p.vline(cx + 21, g - 12, g - 1, W[1]);
    barrel(p, cx + 11, g);
    bench(p, cx + 12, g);
    signPost(cx - 26);
    return;
  }
  if (lv === 2) {
    const saved = c.o.lit;
    c.o.lit = true;
    hut(c, k, cx - 20, 38, 16, "gable", { door: "std", doorAt: cx - 11, wins: [cx - 3, cx + 7], win: "std" });
    c.o.lit = saved;
    signPost(cx - 32);
    barrel(p, cx + 20, g);
    barrelSide(p, cx + 22, g - 9);
    return;
  }
  const x = cx - 26;
  const w = 50;
  const ph = Math.max(1, k.plinthH - 1);
  const yb = g - ph;
  const yg = yb - 17;
  const yu = yg - 15;
  k.plinth(c, x - 1, w + 2, ph);
  k.wall(c, x, yg, w, 17, "ground");
  k.wall(c, x, yu, w, 15, "upper");
  k.roof(c, x, w, yu, "main");
  k.band(c, x, w, yg - 1);
  windowRow(c, k, x, w, yu + 4, 3, "std");
  const saved = c.o.lit;
  c.o.lit = true;
  const [ww] = k.winSize("wide");
  k.window(c, x + w - ww - 5, yg + 5, "wide");
  c.o.lit = saved;
  k.door(c, x + 12, yb, "std");
  lantern(c, x + 21, yg + 1, "iron");
  // 铁臂挂牌
  p.hline(x - 12, x, yg + 1, P.iron[1]);
  k.sign(c, x - 6, yg + 2, "tavern");
  barrel(p, x + w + 1, g);
  barrel(p, x + w + 8, g);
  bench(p, x + 20, g);
}

/** 码头：短短的木栈桥与系缆桩 → 更长的栈桥、木吊杆与货箱 → 长栈桥上的码头仓棚、吊杆与路灯。桩脚在底边。 */
function dock({ c, k, lv }: Ctx): void {
  const p = c.p;
  const g = c.gy;
  const deck = g - DOCK_DECK_FROM_BOTTOM;
  const cx = CW / 2;
  const len = lv === 1 ? 40 : lv === 2 ? 64 : 96;
  const x0 = cx - Math.floor(len / 2);
  const x1 = x0 + len - 1;
  // 桩与斜撑
  for (let x = x0 + 1; x < x1; x += 8) {
    p.rect(x, deck + 2, 3, g - deck - 2, W[1]);
    p.vline(x, deck + 2, g - 1, W[2]);
    p.hline(x, x + 2, g - 3, P.leaf[1]);
    if (x + 8 < x1) p.line(x + 3, deck + 3, x + 7, deck + 8, W[0]);
  }
  // 桥面：木板端头朝外
  p.rect(x0, deck, len, 3, W[2]);
  p.hline(x0, x1, deck, W[3]);
  p.hline(x0, x1, deck + 2, W[0]);
  for (let x = x0; x <= x1; x += 4) p.set(x, deck + 1, W[1]);
  // 系缆桩与缆绳
  const bollard = (x: number) => {
    p.rect(x, deck - 4, 3, 4, W[1]);
    p.hline(x, x + 2, deck - 4, W[3]);
    p.hline(x - 1, x + 3, deck - 2, P.straw[1]);
  };
  bollard(x0 + 2);
  bollard(x1 - 4);
  if (lv === 1) {
    crate(p, x0 + 12, deck, 6, W, 1);
    lantern(c, x1 - 12, deck - 14, "iron");
    p.vline(x1 - 10, deck - 15, deck - 1, W[1]);
    p.hline(x1 - 12, x1 - 10, deck - 15, W[1]);
    return;
  }
  /** 木吊杆：立柱、斜臂、吊着的货箱。 */
  const crane = (x: number, h: number) => {
    p.rect(x, deck - h, 3, h, W[2]);
    p.vline(x, deck - h, deck - 1, W[3]);
    p.line(x + 2, deck - h, x + 16, deck - h - 6, W[2]);
    p.line(x + 2, deck - h + 5, x + 10, deck - h - 3, W[1]);
    p.vline(x + 16, deck - h - 5, deck - h + 8, P.straw[1]);
    crate(p, x + 13, deck - h + 14, 6, W, 3);
  };
  if (lv === 2) {
    crane(x0 + 8, 20);
    crate(p, x1 - 20, deck, 7, W, 4);
    crate(p, x1 - 13, deck, 6, W, 5);
    barrel(p, x0 + 32, deck);
    return;
  }
  // 码头仓棚（所有者风格）
  const sx = x0 + 44;
  const sw = 32;
  const yb = deck;
  const y = yb - 16;
  k.wall(c, sx, y, sw, 16, "main");
  k.roof(c, sx, sw, y, "main");
  k.door(c, sx + 10, yb, "barn");
  const [ws] = k.winSize("small");
  k.window(c, sx + sw - ws - 4, y + 4, "small");
  crane(x0 + 8, 22);
  crate(p, sx + sw + 3, deck, 7, W, 6);
  barrel(p, x0 + 30, deck);
  barrel(p, x0 + 37, deck);
  p.vline(x1 - 8, deck - 20, deck - 1, P.iron[1]);
  lantern(c, x1 - 8, deck - 26, "iron");
}

/** 住宅区：两顶帐篷、一间窝棚与篝火 → 三间原木小屋 → 一排四栋两层排屋（所有者风格）。 */
function housing({ c, k, lv }: Ctx): void {
  const g = c.gy;
  const cx = CW / 2;
  if (lv === 1) {
    tent(c, cx - 24, 18, 12);
    leanTo(c, cx - 2, 14, 12);
    tent(c, cx + 14, 14, 10);
    campfire(c, cx - 6);
    return;
  }
  if (lv === 2) {
    const roofs: RoofKind[] = ["main", "gable", "main"];
    [cx - 34, cx - 10, cx + 14].forEach((x, i) => {
      c.tone = i;
      hut(c, k, x, 20, 12, roofs[i], { door: "std", doorAt: x + (i === 1 ? 10 : 6), wins: i === 1 ? [] : [x + 13] });
    });
    return;
  }
  const roofs: RoofKind[] = ["main", "gable", "main", "gable"];
  [cx - 50, cx - 25, cx, cx + 25].forEach((x, i) => rowHouse(c, k, x, 23, roofs[i], i));
  void g;
}

const DRAW: Readonly<Record<ColonyBuildingKey, (x: Ctx) => void>> = {
  farm,
  plantation,
  lumber,
  mine,
  fishery,
  hunting,
  distillery,
  sugarmill,
  storehouse,
  fort,
  chapel,
  tavern,
  dock,
  housing,
};

/** 是否为已知的殖民建筑 key。 */
export function isColonyKey(k: unknown): k is ColonyBuildingKey {
  return typeof k === "string" && (COLONY_KEYS as readonly string[]).includes(k);
}

/**
 * 画一座殖民建筑（已描边、裁边，底边是地面线；码头的底边是桩脚）。未知 key 按住宅区画，等级夹到 1–3。
 * kits 为风格 → 构件套件；1、2 级用开拓者套件，3 级用所有者风格的套件。flag 为旗色（堡垒上的旗）。
 */
export function drawColonyImpl(key: string, level: number, style: TownStyle, kits: Readonly<Record<TownStyle, Kit>>, o: DrawOpts, flag: Ramp): Px {
  const k: ColonyBuildingKey = isColonyKey(key) ? key : "housing";
  const lv = (Number.isFinite(level) ? Math.min(3, Math.max(1, Math.floor(level))) : 1) as 1 | 2 | 3;
  const c = new Canvas(CW, CH, style, { ...o }, hash32(`colony/${k}/${lv}/${seedTag(style)}`));
  DRAW[k]({ c, k: lv >= 3 ? kits[style] : kits.frontier, lv, flag });
  return finish(c);
}
