// 地中海风格（mediterranean，埃斯佩兰王国）：白灰墙、浅色石砌底层与隅石、赭红筒瓦的低坡屋顶、
// 半圆拱门窗与拱廊、铁艺阳台与窗栅、蓝白瓷砖饰带、三角山花与栏杆、屋顶小望楼、盆栽与攀墙的三角梅。
import type { Facility } from "../../store/game";
import { P, ink } from "../palette";
import type { Px } from "../px";
import { drawEmblem } from "./emblems";
import { type Canvas, type Ramp, ashlar, fillProfile, flowerBox, gableFront, h01, hipProfile, maskedFill, plaster } from "./kit";
import { wallLamp } from "./parts";
import { type DoorKind, type Kit, type RoofKind, type WallKind, type WinKind, eaveShadow, pickTone } from "./style";

/** 赭红筒瓦：暗、中暗、中、亮、高光 */
export const TR: Ramp = P.brick;
/** 石灰华（浅暖色石材）：门窗框、底层、柱子 */
export const TRAV: Ramp = [P.plaster[0], P.parchmentDark, P.parchment, P.paper, P.white];
/** 白灰墙 */
const LIME: Ramp = P.plaster;
/** 蓝白瓷砖的蓝 */
export const AZ: Ramp = P.cloth.blue;
const W = P.wood;
const IR = P.iron;

/** 半圆拱：宽 w 的拱在第 row 行（0 为拱顶）左右各缩进多少；拱高约为 w/2。 */
export function roundInset(w: number, row: number): number {
  const r = w / 2;
  if (row >= Math.ceil(r)) return 0;
  const dy = r - row - 0.5;
  return Math.max(0, Math.round(r - Math.sqrt(Math.max(0, r * r - dy * dy))));
}

/** 扁拱（椭圆拱）：宽 w、拱高 rise 的拱在第 row 行左右各缩进多少。 */
export function flatInset(w: number, rise: number, row: number): number {
  if (row >= rise) return 0;
  const a = w / 2;
  const t = (rise - row - 0.5) / rise;
  return Math.max(0, Math.round(a - a * Math.sqrt(Math.max(0, 1 - t * t))));
}

/** 按半圆拱轮廓逐行填充：顶在 y、宽 w、高 h（含拱）；col 返回每个像素的颜色。 */
export function archFill(c: Canvas, x: number, y: number, w: number, h: number, col: (xx: number, row: number, k: number) => string | null): void {
  for (let row = 0; row < h; row++) {
    const k = roundInset(w, row);
    for (let xx = x + k; xx < x + w - k; xx++) {
      const v = col(xx, row, k);
      if (v) c.p.set(xx, y + row, v);
    }
  }
}

/** 筒瓦纹理：竖向的瓦垄（亮、中）与瓦沟（暗）每 3 列一组，每 4 行一道搭接线；檐口一排瓦头，右侧坡面背光。 */
export function barrelTex(x0: number, x1: number, inset: number) {
  const mid = (x0 + x1) / 2;
  return (xx: number, _yy: number, e: { fromTop: number; fromBot: number }): string => {
    const d = Math.min(xx - x0, x1 - xx);
    const slope = d < inset;
    const ph = (((xx - x0) % 3) + 3) % 3;
    if (e.fromBot === 0) return ph === 0 ? TR[2] : TR[0];
    if (e.fromBot === 1) return ph === 0 ? TR[4] : ph === 1 ? TR[3] : TR[1];
    if (e.fromTop === 0) return slope && xx > mid ? TR[2] : TR[3];
    let col: string = ph === 0 ? TR[3] : ph === 1 ? TR[2] : TR[1];
    if ((e.fromBot - 2) % 4 === 3 && ph !== 2) col = ph === 0 ? TR[2] : TR[1];
    if (slope && xx > mid) col = col === TR[3] ? TR[2] : TR[1];
    if (slope && xx < mid && e.fromTop === 1) col = TR[4];
    return col;
  };
}

/** 屋脊：一排半圆脊瓦（亮暗相间）。 */
function ridge(c: Canvas, x0: number, x1: number, y: number): void {
  const p = c.p;
  p.hline(x0, x1, y, TR[1]);
  for (let xx = x0; xx <= x1; xx += 2) p.set(xx, y, TR[3]);
  p.hline(x0 + 1, x1 - 1, y - 1, TR[2]);
}

/** 低坡四坡筒瓦顶（不含顶上的附件）：墙 x..x+w-1，墙顶 y；返回屋面顶行。 */
function hipTiles(c: Canvas, x: number, w: number, y: number, h: number, over = 3): { yt: number; x0: number; x1: number; inset: number } {
  const p = c.p;
  const x0 = x - over;
  const x1 = x + w - 1 + over;
  const yb = y + 1;
  const yt = yb - h + 1;
  const inset = Math.min(Math.floor((x1 - x0) / 2) - 1, h + 3);
  fillProfile(p, x0, x1, hipProfile(x0, x1, yt, yb, inset, 1, 2), barrelTex(x0, x1, inset));
  ridge(c, x0 + inset - 1, x1 - inset + 1, yt - 1);
  c.markRoof(x0, yt - 2, x1 - x0 + 1, h + 2, TR, 1);
  c.eave(x0 + 1, x1 - 1, yb);
  return { yt, x0, x1, inset };
}

/** 檐下白色线脚与一排小齿饰，再加檐下阴影。 */
function cornice(c: Canvas, x: number, w: number, y: number): void {
  const p = c.p;
  p.hline(x - 1, x + w, y + 2, P.white);
  p.hline(x - 1, x + w, y + 3, LIME[2]);
  for (let i = x; i < x + w; i += 2) p.set(i, y + 3, LIME[1]);
  eaveShadow(c, x, w, y + 4, 1);
}

/** 三角山花：底边 y（山花最下一行），中心 cx，半宽 hw，高 h；石灰华墙面、正中圆窗、两坡筒瓦压顶、顶上金球。返回最高点。 */
function pediment(c: Canvas, cx: number, y: number, hw: number, h: number): number {
  const p = c.p;
  maskedFill(
    p,
    [
      [cx - hw, y + 1],
      [cx + 0.5, y - h],
      [cx + hw + 1, y + 1],
    ],
    (t) => t.rect(cx - hw, y - h, hw * 2 + 1, h + 2, TRAV[3]),
  );
  // 底边檐口
  p.hline(cx - hw - 1, cx + hw + 1, y, TRAV[4]);
  p.hline(cx - hw - 1, cx + hw + 1, y + 1, TRAV[1]);
  // 两坡压顶：一行白石 + 一行瓦
  for (let t = 0; t <= h + 1; t++) {
    const yy = y - t;
    const dx = Math.round((t * (hw + 1)) / (h + 1));
    const lx = cx - hw - 1 + dx;
    const rx = cx + hw + 1 - dx;
    if (lx > rx) break;
    p.set(lx, yy, TR[3]).set(lx + 1, yy, TRAV[4]);
    p.set(rx, yy, TR[1]).set(rx - 1, yy, TRAV[2]);
  }
  // 圆窗
  const oy = y - Math.max(2, Math.floor(h * 0.45));
  const r = h >= 8 ? 2 : 1;
  p.circle(cx, oy, r + 1, TRAV[2]);
  p.circle(cx, oy, r, c.o.lit ? P.lamp[1] : P.slate[1]);
  if (!c.o.lit && r > 1) p.set(cx - 1, oy - 1, P.slate[3]);
  c.markRoof(cx - hw - 1, y - h - 1, hw * 2 + 3, h + 1, [TR[0], TR[1], TR[2], TR[3], TRAV[4], TRAV[2]], 0);
  // 顶端金球
  const top = y - h - 2;
  p.vline(cx, top - 1, top, P.gold[1]);
  p.circle(cx, top - 3, 1, P.gold[2]);
  p.set(cx - 1, top - 4, P.gold[4]);
  return top - 5;
}

/** 石栏杆：顶在 y，高 4（压顶、瓶形栏杆柱、底座），x0..x1。 */
export function balustrade(c: Canvas, x0: number, x1: number, y: number): void {
  const p = c.p;
  p.hline(x0, x1, y, TRAV[4]);
  p.hline(x0, x1, y + 1, TRAV[2]);
  for (let xx = x0 + 1; xx < x1; xx += 2) {
    p.set(xx, y + 2, TRAV[3]);
    p.set(xx, y + 3, TRAV[2]);
  }
  p.hline(x0, x1, y + 4, TRAV[3]);
  c.ledge(x0, x1, y);
}

/** 石瓶饰（栏杆端头的装饰）：底在 y。 */
function urn(c: Canvas, cx: number, y: number): void {
  const p = c.p;
  p.stamp([".a.", "abc", "abc", ".b.", "abc"], { a: TRAV[4], b: TRAV[3], c: TRAV[1] }, cx - 1, y - 5);
}

/** 屋顶小望楼：一间开两孔拱的白色小阁，自带小四坡顶；底在 y。返回最高点。 */
function belvedere(c: Canvas, cx: number, y: number, w: number): number {
  const p = c.p;
  const x = cx - Math.floor(w / 2);
  const h = 8;
  plaster(p, x, y - h, w, h, LIME, c.seed + 3);
  p.vline(x, y - h, y - 1, P.white);
  p.vline(x + w - 1, y - h, y - 1, LIME[1]);
  const aw = 3;
  for (const ax of [x + 2, x + w - 2 - aw]) {
    archFill(c, ax, y - h + 2, aw, h - 3, () => (c.o.lit ? P.lamp[1] : ink.brown));
  }
  const { yt } = hipTiles(c, x, w, y - h, 4, 2);
  return yt - 2;
}

/** 刷白的烟囱，顶上一顶小瓦帽。 */
function chimney(c: Canvas, x: number, yb: number, h: number): number {
  const p = c.p;
  plaster(p, x, yb - h, 4, h, LIME, x);
  p.vline(x, yb - h, yb - 1, P.white);
  p.vline(x + 3, yb - h, yb - 1, LIME[1]);
  p.rect(x + 1, yb - h + 1, 2, 1, ink.brown);
  p.hline(x - 1, x + 4, yb - h - 1, TR[3]);
  p.hline(x, x + 3, yb - h - 2, TR[2]);
  p.hline(x - 1, x + 4, yb - h, TR[1]);
  c.markRoof(x - 1, yb - h - 2, 6, 2, TR, 0);
  return yb - h - 2;
}

function roof(c: Canvas, x: number, w: number, y: number, kind: RoofKind = "main"): number {
  const p = c.p;
  if (kind === "tower") {
    // 钟楼顶：一层开拱的钟室（挂着铜钟）+ 低矮的筒瓦四角锥 + 金球风向标
    const bh = 10;
    plaster(p, x, y - bh + 1, w, bh, LIME, c.seed + 11);
    p.vline(x, y - bh + 1, y, P.white);
    p.vline(x + w - 1, y - bh + 1, y, LIME[1]);
    const aw = Math.max(5, Math.round(w * 0.42) | 1);
    const ax = x + Math.floor((w - aw) / 2);
    archFill(c, ax - 1, y - bh + 2, aw + 2, bh - 1, () => TRAV[3]);
    archFill(c, ax, y - bh + 3, aw, bh - 2, () => ink.brown);
    const bx = x + Math.floor(w / 2);
    p.stamp([".a.", "abc", "abc", "aac", ".d."], { a: P.gold[3], b: P.gold[2], c: P.gold[1], d: P.gold[0] }, bx - 1, y - bh + 5);
    p.hline(x - 1, x + w, y - bh + 1, TRAV[4]);
    p.hline(x - 1, x + w, y - bh, TRAV[2]);
    const x0 = x - 2;
    const x1 = x + w + 1;
    const h = Math.max(6, Math.round(w * 0.45));
    const yb = y - bh;
    const cx = (x0 + x1) / 2;
    fillProfile(
      p,
      x0,
      x1,
      (xx) => {
        if (xx < x0 || xx > x1) return null;
        const d = Math.min(xx - x0, x1 - xx) + 0.5;
        return [yb - Math.round((d / ((x1 - x0) / 2)) * h), yb] as const;
      },
      barrelTex(x0, x1, 99),
    );
    c.markRoof(x0, yb - h, x1 - x0 + 1, h + 1, TR, 1);
    const icx = Math.round(cx);
    const top = yb - h;
    p.vline(icx, top - 6, top, IR[1]);
    p.circle(icx, top - 2, 1, P.gold[2]);
    p.set(icx - 1, top - 3, P.gold[4]);
    p.hline(icx - 3, icx + 2, top - 5, IR[2]);
    p.set(icx + 3, top - 5, IR[2]).set(icx + 3, top - 6, IR[2]).set(icx - 3, top - 6, IR[2]);
    return top - 7;
  }
  if (kind === "porch") {
    // 门廊：一座低矮的三角山花
    const cx = x + Math.floor(w / 2);
    const hw = Math.floor(w / 2);
    return pediment(c, cx, y, hw, Math.max(5, Math.round(w * 0.28)));
  }
  if (kind === "gable") {
    // 朝街的低坡山墙：白墙三角、两坡筒瓦封檐、正中一个拱形小气窗
    const cx = x + Math.floor(w / 2);
    const hw = Math.floor(w / 2);
    const h = Math.max(6, Math.round(hw * 0.55));
    const apex = gableFront(
      c,
      cx,
      y,
      hw,
      h,
      (t) => {
        plaster(t, x, y - h, w, h + 1, LIME, c.seed + 7);
        t.vline(x, y - h, y, P.white);
      },
      [TR[0], TR[2], TR[3]],
      { thick: 3, over: 3, mark: TR },
    );
    const vy = y - Math.floor(h * 0.6);
    archFill(c, cx - 1, vy, 3, 4, () => (c.o.lit ? P.lamp[1] : ink.brown));
    p.hline(cx - 2, cx + 2, vy + 4, TRAV[3]);
    cornice(c, x, w, y - 1);
    // 屋脊端头一只小陶瓶
    p.stamp([".a.", "abb", ".b."], { a: TR[3], b: TR[1] }, cx - 1, apex - 3);
    return apex - 3;
  }
  const h = kind === "shed" ? 8 : Math.min(13, Math.max(8, Math.round(w * 0.13) + 4));
  const { yt, x0, x1, inset } = hipTiles(c, x, w, y, h);
  cornice(c, x, w, y);
  let peak = yt - 2;
  if (kind === "grand") {
    // 正式屋顶：正中三角山花，宽屋顶两侧加一道石栏杆与瓶饰
    const cx = x + Math.floor(w / 2);
    const hw = Math.min(Math.floor((w - 8) / 2), Math.max(10, Math.round(w * 0.22)));
    if (w >= 60) {
      balustrade(c, x - 1, cx - hw - 2, y - 3);
      balustrade(c, cx + hw + 2, x + w, y - 3);
      urn(c, x, y - 3);
      urn(c, x + w - 1, y - 3);
    }
    peak = Math.min(peak, pediment(c, cx, y + 1, hw, Math.max(6, Math.round(hw * 0.55))));
  } else if (kind === "main" && w >= 50) {
    peak = Math.min(peak, belvedere(c, x + Math.floor(w / 2), yt + 2, 14));
  } else if (kind === "main" && w >= 28) {
    const chx = x + Math.round(w * 0.72);
    const r = hipProfile(x0, x1, yt, y + 1, inset, 1, 2)(chx);
    peak = Math.min(peak, chimney(c, chx, (r ? r[0] : yt) + 3, (r ? r[0] - yt : 0) + 6));
  }
  return peak;
}

const winSizes: Record<WinKind, readonly [number, number]> = {
  std: [6, 10],
  tall: [6, 13],
  small: [4, 5],
  round: [7, 7],
  wide: [13, 9],
};

const doorSizes: Record<DoorKind, readonly [number, number]> = {
  std: [8, 13],
  double: [12, 15],
  grand: [14, 17],
  open: [16, 13],
  iron: [12, 15],
  barn: [18, 17],
};

/** 百叶窗扇（2 像素宽）：绿、蓝或赭色。 */
function shutters(c: Canvas, x: number, y: number, w: number, h: number): void {
  const p = c.p;
  const sh = pickTone(c, [P.cloth.green, AZ, P.cloth.green, P.cloth.ochre]);
  for (const sx of [x - 3, x + w + 1]) {
    p.rect(sx, y, 2, h, sh[1]);
    p.vline(sx, y, y + h - 1, sh[2]);
    for (let yy = y + 1; yy < y + h - 1; yy += 2) p.set(sx + 1, yy, sh[0]);
  }
}

/** 窗玻璃：白天映着天光，亮灯时透出暖光。 */
function pane(c: Canvas, x: number, y: number, w: number, h: number): void {
  const p = c.p;
  if (c.o.lit) {
    p.rect(x, y, w, h, P.lamp[1]);
    p.hline(x, x + w - 1, y, P.lamp[0]);
    if (w > 2 && h > 3) p.rect(x + 1, y + Math.floor(h / 2), w - 2, Math.ceil(h / 2) - 1, P.lamp[2]);
  } else {
    p.rect(x, y, w, h, P.slate[1]);
    p.hline(x, x + w - 1, y, P.slate[0]);
    p.set(x + w - 2, y + 1, P.slate[3]).set(x + w - 1, y + 2, P.slate[3]);
  }
}

/** 铁艺阳台：挑出的石板 + 一排铁栏杆，栏杆上摆两盆天竺葵。石板顶在 y。 */
function balcony(c: Canvas, x: number, y: number, w: number): void {
  const p = c.p;
  const x0 = x - 3;
  const x1 = x + w + 2;
  p.hline(x0, x1, y, TRAV[4]);
  p.hline(x0, x1, y + 1, TRAV[1]);
  for (let i = x0 + 2; i < x1; i += 4) p.set(i, y + 2, TRAV[1]);
  // 栏杆：扶手、立杆、底部一道横档与卷草
  p.hline(x0, x1, y - 4, IR[1]);
  for (let xx = x0; xx <= x1; xx += 2) p.vline(xx, y - 3, y - 1, IR[1]);
  p.hline(x0, x1, y - 1, IR[1]);
  for (let xx = x0 + 1; xx < x1; xx += 4) p.set(xx, y - 2, IR[2]);
  const s = c.o.season;
  if (s !== 3) {
    for (const px of [x0 + 1, x1 - 2]) {
      p.set(px, y - 5, s === 2 ? P.autumn[2] : P.red[3]).set(px + 1, y - 5, P.leaf[2]);
      p.set(px, y - 6, P.leaf[3]);
    }
  }
  c.ledge(x0, x1, y);
}

/** 窗：石灰华窗框、玻璃、白色窗棂与两侧百叶；楼上的窗多带铁艺阳台，底层的窗装铁窗栅。 */
function window(c: Canvas, x: number, y: number, kind: WinKind = "std"): void {
  const p = c.p;
  const [w, h] = winSizes[kind];
  if (kind === "round") {
    p.circle(x + 3, y + 3, 3, TRAV[2]);
    p.circle(x + 3, y + 3, 2, c.o.lit ? P.lamp[1] : P.slate[1]);
    p.set(x + 2, y + 2, c.o.lit ? P.lamp[2] : P.slate[3]);
    p.vline(x + 3, y + 1, y + 5, TRAV[3]);
    p.set(x + 3, y, TRAV[4]);
    return;
  }
  const upper = y + h <= c.gy - 18;
  if (kind === "small") {
    // 小窗：凹进的窗洞 + 铁栅
    p.rect(x - 1, y - 1, w + 2, h + 2, TRAV[3]);
    p.hline(x - 1, x + w, y + h, TRAV[1]);
    pane(c, x, y, w, h);
    for (let xx = x; xx < x + w; xx += 2) p.vline(xx, y, y + h - 1, IR[1]);
    c.ledge(x - 1, x + w, y + h);
    return;
  }
  // 窗框：tall 与 wide 是半圆拱顶
  const arched = kind === "tall" || kind === "wide";
  if (arched) {
    archFill(c, x - 1, y - 1, w + 2, h + 2, () => TRAV[3]);
    archFill(c, x, y, w, h, () => TRAV[3]);
    // 拱心石
    p.rect(x + Math.floor(w / 2) - 1, y - 2, 2 + (w % 2), 2, TRAV[4]);
    const gx = x + 1;
    const gw = w - 2;
    for (let row = 0; row < h - 1; row++) {
      const k = roundInset(gw, row);
      if (gw - 2 * k <= 0) continue;
      if (c.o.lit) p.hline(gx + k, gx + gw - 1 - k, y + 1 + row, row > h / 2 ? P.lamp[2] : P.lamp[1]);
      else p.hline(gx + k, gx + gw - 1 - k, y + 1 + row, row === 0 ? P.slate[0] : P.slate[1]);
    }
    if (!c.o.lit) p.set(gx + gw - 2, y + 3, P.slate[3]).set(gx + gw - 1, y + 4, P.slate[3]);
    // 窗棂
    const bar = y + Math.floor(h * 0.45);
    p.hline(x + 1, x + w - 2, bar, TRAV[4]);
    for (let xx = x + 3; xx < x + w - 1; xx += 3) p.vline(xx, bar - 2, y + h - 2, TRAV[4]);
    p.vline(x + Math.floor(w / 2), y + 1, bar, TRAV[4]);
  } else {
    p.rect(x - 1, y - 2, w + 2, 2, TRAV[3]);
    p.hline(x - 1, x + w, y - 1, TRAV[1]);
    p.rect(x, y, w, h, TRAV[4]);
    pane(c, x + 1, y + 1, w - 2, h - 2);
    p.hline(x + 1, x + w - 2, y + Math.floor(h / 2), TRAV[4]);
    p.vline(x + Math.floor(w / 2), y + 1, y + h - 2, TRAV[4]);
  }
  if (kind === "std" || kind === "tall") shutters(c, x, y, w, h);
  p.hline(x - 1, x + w, y + h, TRAV[3]);
  p.hline(x - 1, x + w, y + h + 1, TRAV[1]);
  if (kind === "std") {
    if (!upper) {
      // 底层窗：鼓出的铁窗栅
      for (let xx = x; xx < x + w; xx += 2) p.vline(xx, y + 1, y + h - 1, IR[1]);
      p.hline(x - 1, x + w, y + 1, IR[2]);
      p.hline(x - 1, x + w, y + h - 1, IR[1]);
      c.ledge(x - 1, x + w, y + h);
    } else if (h01(x, y, c.seed + 5) < 0.55) balcony(c, x, y + h + 1, w);
    else flowerBox(c, x, y + h + 2, w, TR);
  } else c.ledge(x - 1, x + w, y + h);
}

/** 半圆拱门：石灰华拱券与拱心石，漆木门扇镶铜钉；grand 外圈加一道蓝白瓷砖。 */
function door(c: Canvas, cx: number, bottom: number, kind: DoorKind = "std"): void {
  const p = c.p;
  const [w, h] = doorSizes[kind];
  const x = cx - Math.floor(w / 2);
  const y = bottom - h;
  if (kind === "grand") {
    archFill(c, x - 5, y - 5, w + 10, h + 5, (xx, row) => (((xx - x) >> 1) + (row >> 1)) % 2 === 0 ? AZ[1] : P.white);
  }
  // 拱券
  archFill(c, x - 3, y - 3, w + 6, h + 3, (xx) => (xx >= x + w + 1 ? TRAV[2] : TRAV[3]));
  archFill(c, x - 2, y - 2, w + 4, h + 2, (xx, row, k) => (xx === x - 2 + k || row === 0 ? TRAV[4] : TRAV[3]));
  p.rect(cx - 1, y - 4, 2 + (w % 2), 3, TRAV[4]);
  p.set(cx, y - 2, TRAV[2]);
  if (kind === "open") {
    archFill(c, x, y, w, h, (_xx, row) => (c.o.lit ? (row > h / 3 ? P.lamp[1] : P.lamp[0]) : row === 0 ? P.wood[0] : ink.brown));
    p.hline(x + 1, x + w - 2, bottom - 1, W[1]);
    return;
  }
  if (kind === "iron") {
    archFill(c, x, y, w, h, (_xx, row) => (c.o.lit ? (row > h / 2 ? P.lamp[2] : P.lamp[1]) : ink.brown));
    archFill(c, x, y, w, h, (xx, row, k) => ((xx - x) % 2 === 0 || row === Math.floor(h / 2) || xx === x + k ? IR[2] : null));
    p.circle(cx, y + Math.floor(w / 4) + 1, 2, IR[3]);
    p.set(cx, y + Math.floor(w / 4) + 1, IR[1]);
    return;
  }
  const leaf = kind === "barn" ? W : pickTone(c, [P.cloth.green, AZ, W, P.cloth.crimson]);
  archFill(c, x, y, w, h, (xx) => {
    const ph = (xx - x) % 3;
    return ph === 0 ? leaf[0] : ph === 1 ? leaf[2] : leaf[1];
  });
  // 扇形气窗（门上的半圆）
  const fan = Math.max(3, Math.floor(w / 2) - 1);
  archFill(c, x + 1, y + 1, w - 2, fan, (xx, row) => {
    if (row === fan - 1) return TRAV[3];
    return (xx - cx) % 2 === 0 ? TRAV[3] : c.o.lit ? P.lamp[1] : P.slate[1];
  });
  if (w >= 12) p.vline(cx, y + fan, bottom - 1, leaf[0]);
  for (let yy = y + fan + 3; yy < bottom - 1; yy += 4) {
    for (let xx = x + 1; xx < x + w - 1; xx += 3) p.set(xx, yy, P.gold[3]);
  }
  if (kind === "barn") {
    // 大车门：中间开一扇小门
    const wx = cx - 3;
    p.stroke(wx, bottom - 9, 6, 9, W[0]);
    p.set(wx + 4, bottom - 5, P.gold[3]);
  } else p.set(x + w - 2, y + Math.floor(h * 0.6), P.gold[3]);
}

/** 蓝白瓷砖招牌：白底框、蓝白相间的砖边、深蓝底上金色图样，顶上两只铁钩。 */
function sign(c: Canvas, cx: number, y: number, fac: Facility): number {
  const p = c.p;
  const x = cx - 7;
  p.set(x + 3, y, IR[1]).set(x + 11, y, IR[1]);
  p.rect(x, y + 1, 15, 13, P.white);
  for (let i = 0; i < 15; i++) {
    const col = i % 2 === 0 ? AZ[1] : P.white;
    p.set(x + i, y + 1, col);
    p.set(x + i, y + 13, i % 2 === 0 ? AZ[0] : LIME[2]);
  }
  for (let j = 1; j < 13; j++) {
    p.set(x, y + 1 + j, j % 2 === 0 ? AZ[1] : P.white);
    p.set(x + 14, y + 1 + j, j % 2 === 0 ? AZ[0] : LIME[2]);
  }
  p.rect(x + 2, y + 3, 11, 9, P.cloth.navy[1]);
  p.hline(x + 2, x + 12, y + 3, P.cloth.navy[2]);
  drawEmblem(p, fac, x + 3, y + 3, P.gold.slice(1));
  c.ledge(x, x + 14, y + 1);
  return 14;
}

/** 拱廊开间：扁圆拱的门洞（交易所的货摊、廊下），拱券带拱心石。 */
function bay(c: Canvas, x: number, y: number, w: number, h: number): void {
  const p = c.p;
  const rise = Math.min(Math.ceil(w / 2), Math.max(3, Math.floor(h / 2)));
  for (let row = -2; row < h; row++) {
    const k = flatInset(w + 4, rise + 2, row + 2);
    p.hline(x - 2 + k, x + w + 1 - k, y + row, row < 0 || row < rise - 1 ? TRAV[3] : TRAV[3]);
    p.set(x - 2 + k, y + row, TRAV[4]);
  }
  p.rect(x + Math.floor(w / 2) - 1, y - 3, 2 + (w % 2), 3, TRAV[4]);
  const lit = c.o.lit;
  for (let row = 0; row < h; row++) {
    const k = flatInset(w, rise, row);
    const col = lit ? (row > h / 3 ? P.lamp[1] : P.lamp[0]) : row === 0 ? P.wood[0] : ink.brown;
    p.hline(x + k, x + w - 1 - k, y + row, col);
  }
  if (!lit) p.hline(x + 1, x + w - 1, y + h - 1, W[1]);
}

/** 攀墙的三角梅：从墙脚沿墙角爬上去，春夏开紫红花，秋天叶子转红，冬天只剩枝条。 */
function bougainvillea(c: Canvas, x: number, top: number): void {
  const p = c.p;
  const g = c.gy;
  const s = c.o.season;
  for (let yy = g - 1; yy >= top; yy--) {
    const sway = Math.round(Math.sin(yy * 0.5) * 1);
    p.set(x + sway, yy, W[1]);
  }
  if (s === 3) {
    for (let yy = top; yy < g - 4; yy += 5) p.set(x + 1, yy, P.leaf[1]);
    return;
  }
  const flower = s === 2 ? [P.autumn[1], P.autumn[2]] : [P.blossom[0], P.blossom[1]];
  for (let yy = top; yy < g - 3; yy++) {
    const spread = yy < top + 6 ? 3 : 2;
    for (let dx = -1; dx <= spread; dx++) {
      const r = h01(x + dx, yy, 131);
      if (r < 0.35) continue;
      const col = r < 0.6 ? P.leaf[2] : r < 0.72 ? P.leaf[1] : r < 0.88 ? flower[1] : flower[0];
      p.set(x + dx, yy, col);
    }
  }
}

/** 陶盆绿植：一盆结着金果的柑橘小树（冬天只剩绿叶）。底在地面线。 */
function citrusPot(c: Canvas, x: number): void {
  const p = c.p;
  const g = c.gy;
  p.rect(x, g - 4, 5, 4, TR[2]);
  p.hline(x - 1, x + 5, g - 4, TR[3]);
  p.vline(x + 4, g - 3, g - 1, TR[1]);
  p.vline(x + 2, g - 7, g - 5, W[1]);
  p.ellipse(x + 2, g - 9, 3, 2, P.leaf[1]);
  p.set(x + 1, g - 10, P.leaf[3]).set(x + 2, g - 11, P.leaf[2]).set(x, g - 9, P.leaf[2]);
  if (c.o.season === 1 || c.o.season === 2) p.set(x + 3, g - 9, P.gold[3]).set(x + 1, g - 8, P.gold[2]);
  else if (c.o.season === 0) p.set(x + 3, g - 10, P.white).set(x + 1, g - 8, P.white);
}

export const mediterranean: Kit = {
  style: "mediterranean",
  flag: P.cloth.crimson,
  trim: W,
  plinthH: 3,
  awning: [AZ, [P.plaster[1], P.plaster[3], P.white]],
  wall(c, x, y, w, h, kind: WallKind = "main") {
    const p = c.p;
    if (kind === "ground") {
      // 粗面石砌底层：大块浅暖色条石，深缝
      ashlar(p, x, y, w, h, TRAV, { course: 4, min: 7, max: 12, seed: c.seed + y, light: 2 });
      p.vline(x, y, y + h - 1, TRAV[4]);
      return;
    }
    if (kind === "stone") {
      ashlar(p, x, y, w, h, TRAV, { course: 3, min: 6, max: 10, seed: c.seed + y, light: 3 });
      return;
    }
    if (kind === "plain") {
      // 淡彩粉墙：赭黄、白、淡粉三种
      const tone = pickTone(c, [
        [P.sand[1], P.sand[2], P.sand[3], P.sand[4]],
        LIME,
        [P.blossom[0], P.blossom[1], P.blossom[2], P.blossom[3]],
      ] as const);
      plaster(p, x, y, w, h, tone, c.seed + y);
      p.vline(x, y, y + h - 1, tone === LIME ? P.white : tone[3]);
      p.vline(x + w - 1, y, y + h - 1, tone[2]);
      return;
    }
    plaster(p, x, y, w, h, LIME, c.seed + y);
    p.vline(x, y, y + h - 1, P.white);
    p.vline(x + w - 1, y, y + h - 1, LIME[2]);
    if (kind === "main") {
      // 浅色石隅石
      for (let yy = y; yy < y + h; yy += 4) {
        const long = ((yy - y) / 4) % 2 === 0;
        const ww = long ? 4 : 2;
        const hh = Math.min(3, y + h - yy);
        p.rect(x, yy, ww, hh, TRAV[3]);
        p.hline(x, x + ww - 1, yy, TRAV[4]);
        p.rect(x + w - ww, yy, ww, hh, TRAV[2]);
      }
    }
  },
  plinth(c, x, w, h) {
    const p = c.p;
    const g = c.gy;
    ashlar(p, x, g - h, w, h, TRAV, { course: Math.max(2, h), min: 6, max: 11, seed: c.seed + 17, light: 1 });
    p.hline(x, x + w - 1, g - h, TRAV[4]);
    // 墙脚一道蓝白瓷砖
    if (h >= 3) for (let xx = x + 1; xx < x + w - 1; xx++) p.set(xx, g - h + 1, (xx >> 1) % 2 ? AZ[1] : P.white);
  },
  roof,
  band(c, x, w, y) {
    const p = c.p;
    p.hline(x - 1, x + w, y, TRAV[4]);
    p.hline(x - 1, x + w, y + 1, TRAV[1]);
  },
  post(c, x, y0, y1, kind = "post") {
    const p = c.p;
    if (kind === "column") {
      // 托斯卡纳式石柱：柱础、柱身、柱头
      p.rect(x, y0, 3, y1 - y0 + 1, TRAV[3]);
      p.vline(x, y0, y1, TRAV[4]);
      p.vline(x + 2, y0, y1, TRAV[1]);
      p.rect(x - 1, y0, 5, 2, TRAV[4]);
      p.hline(x - 1, x + 3, y0 + 1, TRAV[2]);
      p.rect(x - 1, y1 - 1, 5, 2, TRAV[3]);
      p.hline(x - 1, x + 3, y1, TRAV[1]);
      return 3;
    }
    // 刷白的方柱
    p.rect(x, y0, 3, y1 - y0 + 1, LIME[3]);
    p.vline(x, y0, y1, P.white);
    p.vline(x + 2, y0, y1, LIME[1]);
    return 3;
  },
  winSize: (kind = "std") => winSizes[kind],
  window,
  doorSize: (kind = "std") => doorSizes[kind],
  door,
  sign,
  decor(c, x, w, y, bottom) {
    wallLamp(c, x + w, y + 8, "iron", 1);
    bougainvillea(c, x + 1, Math.max(y + 2, bottom - 26));
    citrusPot(c, x + w - 7);
  },
  bay,
};

/** 柏树：细高的纺锤形常青树，中心 cx，底在 bottom，高 h（含 2 像素树干）。左侧受光、右侧背光。 */
export function cypress(p: Px, cx: number, bottom: number, h: number, seed = 0): void {
  const crown = h - 2;
  const top = bottom - h;
  const maxW = Math.max(2, Math.round(h / 7));
  for (let i = 0; i < crown; i++) {
    const t = i / Math.max(1, crown - 1);
    const hw = Math.max(0, Math.round(maxW * Math.sin(Math.PI * Math.pow(t, 0.62)) * (t < 0.1 ? t * 8 : 1)));
    const y = top + i;
    for (let dx = -hw; dx <= hw; dx++) {
      const u = dx / Math.max(1, hw);
      const r = h01(cx + dx, y, seed + 141);
      let col: string = u < -0.3 ? P.leaf[2] : u > 0.35 ? P.leaf[0] : P.leaf[1];
      if (u < -0.3 && r < 0.25) col = P.leaf[3];
      if (u > 0.35 && r < 0.3) col = P.leaf[1];
      if (Math.abs(u) < 0.35 && r < 0.18) col = P.leaf[2];
      p.set(cx + dx, y, col);
    }
  }
  p.vline(cx, bottom - 2, bottom - 1, W[1]);
}
