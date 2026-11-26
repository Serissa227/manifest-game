// 开拓者风格（frontier，新大陆的殖民地）：粗圆木墙与浅色填缝、墙角交叉的木头端面、风化的灰褐木瓦或茅草顶、
// 毛石墙基、木板门与 Z 形撑、挂在木桩上的粗木招牌、墙上绷着的兽皮、柴垛与劈柴墩。设施都是简陋的版本。
import type { Facility } from "../../store/game";
import { P, ink } from "../palette";
import type { Px } from "../px";
import { drawEmblem } from "./emblems";
import { type Canvas, type Ramp, fillProfile, gableFront, h01, hipProfile, planks } from "./kit";
import { thatchTex } from "./islands";
import { lantern } from "./parts";
import { type DoorKind, type Kit, type RoofKind, type WallKind, type WinKind, eaveShadow, pickTone } from "./style";

const W = P.wood;
/** 风化的木瓦：由暗褐到灰白 */
export const SH: Ramp = [P.wood[0], P.wood[1], P.stone[1], P.stone[2], P.stone[3]];
/** 毛石 */
const FS = P.stone;
/** 填缝的灰泥 */
const CHINK = P.plaster[1];
const ST = P.straw;

/** 粗圆木墙：每根 4 行（亮、中、暗、填缝），偶有树疤与接缝。 */
export function chinkedLogs(p: Px, x: number, y: number, w: number, h: number, seed = 0): void {
  let row = 0;
  const y1 = y + h - 1;
  for (let ly = y; ly <= y1; ly += 4, row++) {
    const lines: [number, string][] = [
      [ly, W[3]],
      [ly + 1, W[2]],
      [ly + 2, W[1]],
      [ly + 3, CHINK],
    ];
    for (const [yy, col] of lines) if (yy <= y1) p.hline(x, x + w - 1, yy, col);
    // 填缝里零星的暗缝
    for (let i = 0; i < w; i += 3) if (ly + 3 <= y1 && h01(i, row, seed + 1) < 0.3) p.set(x + i, ly + 3, W[0]);
    // 圆木顶边偶尔断开
    for (let i = 0; i < w; i += 4) if (h01(i, row, seed + 2) < 0.3) p.hline(x + i, Math.min(x + w - 1, x + i + 1), ly, W[2]);
    // 树疤
    const kx = x + 2 + Math.floor(h01(row, seed, 3) * Math.max(1, w - 5));
    if (h01(row, seed, 4) < 0.7 && ly + 1 <= y1) p.set(kx, ly + 1, W[0]).set(kx + 1, ly + 1, W[1]);
    // 两根木头的对接
    if (w > 22 && ly + 2 <= y1 && h01(row, seed, 5) < 0.45) {
      const jx = x + 7 + Math.floor(h01(row, seed, 6) * (w - 14));
      p.vline(jx, ly, ly + 2, W[0]);
      p.set(jx + 1, ly, W[4]);
    }
  }
}

/** 墙角交叉伸出的圆木端面（竖排，每 4 行一个），x 为端面左边。 */
export function logCorner(p: Px, x: number, y: number, h: number): void {
  for (let ly = y; ly + 2 <= y + h; ly += 4) {
    p.stamp(["abba", "bcdb", "bddb"], { a: W[1], b: W[2], c: W[4], d: W[3] }, x, ly);
    p.set(x + 3, ly + 2, W[0]);
  }
}

/** 毛石墙：灰泥底上一块块大小不一的圆石，左上受光、右下背光。 */
export function rubble(p: Px, x: number, y: number, w: number, h: number, seed = 0): void {
  p.rect(x, y, w, h, P.plaster[0]);
  let row = 0;
  for (let cy = y; cy < y + h; row++) {
    const ch = 3 + Math.floor(h01(row, seed, 1) * 2);
    let cx = x - Math.floor(h01(row, seed, 2) * 4);
    let k = 0;
    while (cx < x + w) {
      const len = 4 + Math.floor(h01(k, row + seed * 7, 3) * 4);
      const r = h01(k, row + seed * 7, 4);
      const face = r < 0.25 ? FS[3] : r > 0.8 ? FS[1] : FS[2];
      for (let yy = cy; yy < Math.min(y + h, cy + ch - 1); yy++) {
        const edge = yy === cy || yy === cy + ch - 2;
        const a = Math.max(x, cx + (edge ? 1 : 0));
        const b = Math.min(x + w - 1, cx + len - 2 - (edge ? 1 : 0));
        if (b < a) continue;
        p.hline(a, b, yy, face);
        if (yy === cy) p.hline(a, b, yy, r < 0.25 ? FS[4] : FS[3]);
        if (yy === cy + ch - 2) p.hline(a, b, yy, FS[1]);
      }
      cx += len;
      k++;
    }
    cy += ch;
  }
}

/** 木瓦纹理：每层 3 行，层下缘受光、上层压出的阴影在上沿；竖缝错开，瓦色深浅不一；右坡背光。 */
export function shingleTex(x0: number, x1: number, inset: number, seed = 0) {
  const mid = (x0 + x1) / 2;
  return (xx: number, _yy: number, e: { fromTop: number; fromBot: number }): string => {
    const d = Math.min(xx - x0, x1 - xx);
    if (e.fromBot === 0) return SH[1];
    if (e.fromTop === 0) return d < inset && xx > mid ? SH[2] : SH[4];
    const course = Math.floor((e.fromBot - 1) / 3);
    const ph = (e.fromBot - 1) % 3;
    const u = xx + course * 2 + Math.floor(h01(course, 1, seed) * 3);
    const jx = ((u % 4) + 4) % 4;
    const r = h01(Math.floor(u / 4), course, seed + 5);
    let col: string = r < 0.28 ? SH[3] : r > 0.82 ? SH[1] : SH[2];
    if (ph === 0) col = r < 0.28 ? SH[4] : SH[3];
    else if (ph === 2) col = SH[1];
    if (jx === 0 && ph !== 0) col = SH[0];
    if (d < inset && xx > mid) col = col === SH[4] ? SH[3] : col === SH[3] ? SH[2] : col === SH[2] ? SH[1] : col;
    if (d < inset && xx < mid && e.fromTop === 1) col = SH[4];
    return col;
  };
}

/** 一面小三角旗（挂在杆顶右侧）。 */
function pennantOn(p: Px, x: number, y: number, ramp: Ramp): void {
  p.hline(x, x + 5, y, ramp[2]);
  p.hline(x, x + 3, y + 1, ramp[1]);
  p.hline(x, x + 1, y + 2, ramp[0]);
}

/** 屋顶上的石砌烟囱。 */
function chimney(c: Canvas, x: number, yb: number, h: number): number {
  const p = c.p;
  rubble(p, x, yb - h, 5, h, x);
  p.rect(x - 1, yb - h - 1, 7, 2, FS[2]);
  p.hline(x - 1, x + 5, yb - h - 1, FS[3]);
  p.rect(x + 1, yb - h - 2, 3, 1, ink.deep);
  c.markRoof(x - 1, yb - h - 1, 7, 1, FS, 0);
  return yb - h - 2;
}

function roof(c: Canvas, x: number, w: number, y: number, kind: RoofKind = "main"): number {
  const p = c.p;
  if (kind === "tower") {
    // 瞭望塔顶：挑出的木栏平台 + 低矮的木瓦四角锥 + 旗杆
    p.rect(x - 3, y - 1, w + 6, 2, W[2]);
    p.hline(x - 3, x + w + 2, y - 1, W[3]);
    p.hline(x - 3, x + w + 2, y - 5, W[2]);
    for (let xx = x - 3; xx <= x + w + 2; xx += 3) p.vline(xx, y - 4, y - 2, W[1]);
    for (const px of [x - 2, x + w]) p.vline(px, y - 12, y - 2, W[1]);
    const x0 = x - 5;
    const x1 = x + w + 4;
    const h = Math.max(7, Math.round(w * 0.5));
    const yb = y - 12;
    fillProfile(
      p,
      x0,
      x1,
      (xx) => {
        if (xx < x0 || xx > x1) return null;
        const d = Math.min(xx - x0, x1 - xx) + 0.5;
        return [yb - Math.round((d / ((x1 - x0) / 2)) * h), yb] as const;
      },
      shingleTex(x0, x1, 99, c.seed),
    );
    c.markRoof(x0, yb - h, x1 - x0 + 1, h + 1, SH, 1);
    const cx = Math.round((x0 + x1) / 2);
    const top = yb - h;
    p.vline(cx, top - 8, top, W[1]);
    pennantOn(p, cx + 1, top - 8, P.cloth.green);
    return top - 8;
  }
  if (kind === "gable") {
    // 朝街的茅草 A 字山墙：竖板三角墙、正中一扇小窗
    const cx = x + Math.floor(w / 2);
    const hw = Math.floor(w / 2);
    const h = Math.round(hw * 0.95);
    const apex = gableFront(c, cx, y, hw, h, (t) => planks(t, x, y - h, w, h + 1, W, c.seed, 4), [ST[0], ST[2], ST[3]], { thick: 5, over: 4, mark: ST });
    for (let k = 1; k < 4; k++) {
      const yy = apex + Math.round((h * k) / 4);
      const dx = Math.round(((yy - apex) * (hw + 0.5)) / h);
      p.hline(cx - dx - 4, cx - dx, yy + 2, ST[1]);
      p.hline(cx + dx, cx + dx + 4, yy + 2, ST[0]);
    }
    const wy = y - Math.round(h * 0.5);
    p.rect(cx - 2, wy, 5, 4, W[1]);
    p.rect(cx - 1, wy + 1, 3, 2, c.o.lit ? P.lamp[1] : ink.brown);
    p.hline(x, x + w - 1, y + 1, W[1]);
    eaveShadow(c, x, w, y + 2, 1);
    p.line(cx - 1, apex, cx - 3, apex - 3, W[1]);
    p.line(cx + 1, apex, cx + 3, apex - 3, W[2]);
    return apex - 3;
  }
  if (kind === "shed") {
    // 工棚：茅草四坡顶
    const x0 = x - 4;
    const x1 = x + w + 3;
    const h = 10;
    const yb = y + 1;
    fillProfile(p, x0, x1, hipProfile(x0, x1, yb - h + 1, yb, h, 1, 2), thatchTex(x0, x1, c.seed));
    c.markRoof(x0, yb - h, x1 - x0 + 1, h + 1, ST, 1);
    eaveShadow(c, x, w, y + 2, 1);
    return yb - h;
  }
  const over = kind === "porch" ? 2 : 3;
  const x0 = x - over;
  const x1 = x + w - 1 + over;
  const h = kind === "porch" ? 6 : Math.min(20, Math.max(10, Math.round(w * 0.26) + 4));
  const yb = y + 1;
  const yt = yb - h + 1;
  const inset = Math.min(Math.floor((x1 - x0) / 2) - 1, Math.round(h * 0.7));
  fillProfile(p, x0, x1, hipProfile(x0, x1, yt, yb, inset, 1, 2), shingleTex(x0, x1, inset, c.seed));
  // 屋脊：一根压脊的圆木
  p.hline(x0 + inset - 2, x1 - inset + 2, yt - 1, W[2]);
  p.hline(x0 + inset - 1, x1 - inset + 1, yt - 2, W[3]);
  c.markRoof(x0, yt - 2, x1 - x0 + 1, h + 2, SH, 1);
  // 檐下：一道封檐板
  p.hline(x, x + w - 1, y + 2, W[1]);
  eaveShadow(c, x, w, y + 3, 1);
  c.eave(x0 + 1, x1 - 1, yb);
  let peak = yt - 2;
  if (kind === "grand") {
    // 官署：屋脊正中一座小望亭，顶上挂旗
    const cx = x + Math.floor(w / 2);
    const bw = 10;
    p.rect(cx - bw / 2, yt - 8, bw, 7, W[2]);
    p.hline(cx - bw / 2, cx + bw / 2 - 1, yt - 8, W[3]);
    for (let xx = cx - bw / 2 + 1; xx < cx + bw / 2 - 1; xx += 3) p.rect(xx, yt - 6, 2, 4, c.o.lit ? P.lamp[1] : ink.brown);
    const px0 = cx - bw / 2 - 2;
    const px1 = cx + bw / 2 + 1;
    fillProfile(
      p,
      px0,
      px1,
      (xx) => {
        if (xx < px0 || xx > px1) return null;
        const d = Math.min(xx - px0, px1 - xx) + 0.5;
        return [yt - 9 - Math.round((d / ((px1 - px0) / 2)) * 5), yt - 9] as const;
      },
      shingleTex(px0, px1, 99, c.seed + 1),
    );
    c.markRoof(px0, yt - 14, px1 - px0 + 1, 6, SH, 1);
    p.vline(cx, yt - 22, yt - 14, W[1]);
    pennantOn(p, cx + 1, yt - 22, P.cloth.green);
    peak = yt - 22;
  } else if (kind === "main" && w >= 28) {
    const chx = x + Math.round(w * 0.74);
    const r = hipProfile(x0, x1, yt, yb, inset, 1, 2)(chx);
    peak = Math.min(peak, chimney(c, chx, (r ? r[0] : yt) + 4, (r ? r[0] - yt : 0) + 8));
  }
  return peak;
}

const winSizes: Record<WinKind, readonly [number, number]> = {
  std: [6, 7],
  tall: [6, 10],
  small: [4, 4],
  round: [5, 5],
  wide: [12, 7],
};

const doorSizes: Record<DoorKind, readonly [number, number]> = {
  std: [7, 12],
  double: [12, 13],
  grand: [14, 14],
  open: [14, 12],
  iron: [11, 13],
  barn: [18, 16],
};

/** 小方格玻璃：粗木框、十字窗棂；亮灯时透出暖光。 */
function panes(c: Canvas, x: number, y: number, w: number, h: number): void {
  const p = c.p;
  if (c.o.lit) {
    p.rect(x, y, w, h, P.lamp[1]);
    p.rect(x, y + Math.floor(h / 2), w, Math.ceil(h / 2), P.lamp[2]);
  } else {
    p.rect(x, y, w, h, P.slate[1]);
    p.hline(x, x + w - 1, y, P.slate[0]);
    p.set(x + w - 1, y + 1, P.slate[3]);
  }
}

/** 窗：粗木框、小方格玻璃，std 与 tall 左侧一扇敞开的木板窗扇。 */
function window(c: Canvas, x: number, y: number, kind: WinKind = "std"): void {
  const p = c.p;
  const [w, h] = winSizes[kind];
  if (kind === "round") {
    p.circle(x + 2, y + 2, 3, W[1]);
    p.circle(x + 2, y + 2, 2, c.o.lit ? P.lamp[1] : ink.brown);
    p.set(x + 2, y, W[3]);
    return;
  }
  // 新劈的浅色木框：上沿受光、右下背光
  p.rect(x - 1, y - 1, w + 2, h + 2, W[3]);
  p.hline(x - 1, x + w, y - 1, W[4]);
  p.vline(x + w, y, y + h, W[1]);
  panes(c, x, y, w, h);
  p.vline(x + Math.floor(w / 2), y, y + h - 1, W[3]);
  if (h >= 6) p.hline(x, x + w - 1, y + Math.floor(h / 2), W[3]);
  if ((kind === "std" || kind === "tall") && h01(x, y, c.seed + 3) < 0.6) {
    // 敞开的木板窗扇
    const sx = x - 5;
    p.rect(sx, y - 1, 3, h + 2, W[2]);
    p.vline(sx, y - 1, y + h, W[3]);
    p.vline(sx + 2, y - 1, y + h, W[1]);
    p.hline(sx, sx + 2, y + 1, W[1]).hline(sx, sx + 2, y + h - 2, W[1]);
  }
  // 粗木窗台
  p.hline(x - 2, x + w + 1, y + h + 1, W[3]);
  p.hline(x - 2, x + w + 1, y + h + 2, W[1]);
  c.ledge(x - 2, x + w + 1, y + h + 1);
}

/** 木板门：粗木门框与门楣、Z 形斜撑、铁合页与木门闩；open 为挂着兽皮门帘的门洞，barn 为叉撑大门。 */
function door(c: Canvas, cx: number, bottom: number, kind: DoorKind = "std"): void {
  const p = c.p;
  const [w, h] = doorSizes[kind];
  const x = cx - Math.floor(w / 2);
  const y = bottom - h;
  // 门框与门楣
  p.rect(x - 2, y - 2, w + 4, h + 2, W[1]);
  p.hline(x - 3, x + w + 2, y - 2, W[3]);
  p.hline(x - 3, x + w + 2, y - 1, W[2]);
  p.vline(x - 2, y, bottom - 1, W[2]);
  if (kind === "open") {
    p.rect(x, y, w, h, c.o.lit ? P.lamp[1] : ink.brown);
    if (c.o.lit) p.rect(x + 1, y + Math.floor(h / 2), w - 2, Math.ceil(h / 2), P.lamp[2]);
    // 挽起的兽皮门帘
    const hide = P.cloth.brown;
    for (let row = 0; row < h - 3; row++) {
      const d = Math.max(1, 4 - Math.floor(row / 3));
      p.hline(x, x + d, y + row, hide[1]);
      p.set(x, y + row, hide[2]);
    }
    p.hline(x, x + w - 1, y, hide[0]);
    return;
  }
  const leaf = kind === "iron" ? W : pickTone(c, [W, W, [P.cloth.green[0], P.cloth.green[0], P.cloth.green[1], P.cloth.green[2]]] as const);
  planks(p, x, y, w, h, leaf, 0, 3);
  if (w >= 12) p.vline(cx, y, bottom - 1, W[0]);
  if (kind === "barn") {
    for (const [a, b] of [
      [x, cx - 1],
      [cx + 1, x + w - 1],
    ] as const) {
      p.stroke(a, y, b - a + 1, h, W[1]);
      p.line(a, y, b, bottom - 1, W[3]);
      p.line(a, bottom - 1, b, y, W[3]);
    }
    return;
  }
  // Z 形撑：上下横档与一道斜撑
  const halves = w >= 12 ? [x, cx + 1] : [x];
  const hw = w >= 12 ? Math.floor(w / 2) - 1 : w;
  for (const hx of halves) {
    p.hline(hx, hx + hw - 1, y + 2, W[1]);
    p.hline(hx, hx + hw - 1, bottom - 3, W[1]);
    p.line(hx, bottom - 4, hx + hw - 1, y + 3, W[1]);
  }
  if (kind === "iron") {
    for (const yy of [y + 1, y + Math.floor(h / 2), bottom - 2]) {
      p.hline(x, x + w - 1, yy, P.iron[1]);
      for (let xx = x + 1; xx < x + w; xx += 3) p.set(xx, yy, P.iron[3]);
    }
  } else {
    for (const yy of [y + 2, bottom - 3]) p.set(x, yy, P.iron[2]).set(x + 1, yy, P.iron[1]);
  }
  p.set(x + w - 2, y + Math.floor(h / 2), P.iron[3]);
}

/** 挂在木桩横杆下的粗木招牌：树皮边、深色板面上画着图样。 */
function sign(c: Canvas, cx: number, y: number, fac: Facility): number {
  const p = c.p;
  const x = cx - 7;
  p.set(x + 2, y, ST[1]).set(x + 12, y, ST[1]);
  p.rect(x, y + 1, 15, 13, W[2]);
  p.hline(x, x + 14, y + 1, W[3]);
  p.vline(x, y + 1, y + 13, W[3]);
  p.hline(x + 1, x + 14, y + 13, W[1]);
  p.vline(x + 14, y + 2, y + 13, W[1]);
  // 树皮边上的缺口
  p.set(x, y + 1, null).set(x + 14, y + 13, null).set(x + 6, y + 13, W[0]);
  p.rect(x + 2, y + 3, 11, 9, W[0]);
  drawEmblem(p, fac, x + 3, y + 3, P.cloth.green);
  c.ledge(x, x + 14, y + 1);
  return 14;
}

/** 绷在方木框上的兽皮（挂在墙上晾晒），左上角 (x, y)，7×7：木框、四角的绑绳，框里一张四爪张开的毛皮。 */
export function pelt(p: Px, x: number, y: number): void {
  p.stamp(
    ["abbbbba", "bc.d.cb", "b.ddd.b", "bdeeedb", "b.ddd.b", "bc.d.cb", "abbbbba"],
    { a: P.straw[1], b: W[1], c: P.cloth.brown[0], d: P.cloth.brown[1], e: P.cloth.brown[2] },
    x,
    y,
  );
}

/** 劈柴墩与插在上面的斧子，旁边一小垛柴。底在地面线 g，左边 x。 */
export function choppingBlock(p: Px, x: number, g: number): void {
  p.rect(x, g - 4, 5, 4, W[2]);
  p.hline(x, x + 4, g - 4, W[4]);
  p.set(x + 2, g - 4, W[3]);
  p.vline(x + 4, g - 3, g - 1, W[1]);
  // 斧子
  p.line(x + 3, g - 5, x + 6, g - 9, W[3]);
  p.rect(x + 1, g - 7, 3, 2, P.iron[2]);
  p.set(x + 1, g - 7, P.iron[3]);
  for (let r = 0; r < 2; r++) {
    for (let i = 0; i < 3 - r; i++) {
      p.stamp([".aa.", "abca", ".aa."], { a: W[1], b: W[4], c: W[3] }, x + 7 + i * 4 + r * 2, g - 3 - r * 3);
    }
  }
}

export const frontier: Kit = {
  style: "frontier",
  flag: P.cloth.green,
  trim: W,
  plinthH: 2,
  awning: [
    [P.parchmentDeep, P.parchmentDark, P.parchment],
    [P.cloth.green[0], P.cloth.green[1], P.cloth.green[2]],
  ],
  wall(c, x, y, w, h, kind: WallKind = "main") {
    const p = c.p;
    if (kind === "stone") {
      rubble(p, x, y, w, h, c.seed + y);
      // 转角用大条石
      for (let yy = y; yy < y + h; yy += 5) {
        p.rect(x, yy, 3, Math.min(4, y + h - yy), FS[3]);
        p.hline(x, x + 2, yy, FS[4]);
        p.rect(x + w - 3, yy, 3, Math.min(4, y + h - yy), FS[2]);
      }
      return;
    }
    if (kind === "upper") {
      // 竖板墙，底边一道横裙板
      planks(p, x, y, w, h, W, c.seed, 5);
      p.hline(x, x + w - 1, y + h - 1, W[1]);
      p.hline(x, x + w - 1, y + h - 2, W[3]);
      return;
    }
    if (kind === "plain") {
      // 风化的灰色木板
      planks(p, x, y, w, h, SH, c.seed + 3, 4);
      p.vline(x, y, y + h - 1, SH[3]);
      return;
    }
    chinkedLogs(p, x, y, w, h, c.seed + y);
    logCorner(p, x - 2, y, h);
    logCorner(p, x + w - 2, y, h);
  },
  plinth(c, x, w, h) {
    rubble(c.p, x, c.gy - h, w, h, c.seed + 9);
    c.p.hline(x, x + w - 1, c.gy - h, FS[3]);
  },
  roof,
  band(c, x, w, y) {
    const p = c.p;
    // 一根横放的圆木梁，两端露出端面
    p.hline(x - 2, x + w + 1, y, W[3]);
    p.hline(x - 2, x + w + 1, y + 1, W[1]);
    p.set(x - 2, y, W[4]).set(x + w + 1, y + 1, W[0]);
  },
  post(c, x, y0, y1, kind = "post") {
    const p = c.p;
    const wd = kind === "column" ? 4 : 3;
    p.rect(x, y0, wd, y1 - y0 + 1, W[2]);
    p.vline(x, y0, y1, W[3]);
    p.vline(x + wd - 1, y0, y1, W[1]);
    // 树皮纹
    for (let yy = y0 + 2; yy < y1; yy += 5) p.set(x + 1, yy, W[1]);
    if (kind === "column") {
      p.rect(x - 1, y0, wd + 2, 2, W[1]);
      p.hline(x - 1, x + wd, y0, W[3]);
    }
    return wd;
  },
  winSize: (kind = "std") => winSizes[kind],
  window,
  doorSize: (kind = "std") => doorSizes[kind],
  door,
  sign,
  decor(c, x, w, y, bottom) {
    const p = c.p;
    lantern(c, x - 3, y + 6, "iron");
    p.hline(x - 3, x, y + 5, W[1]);
    if (w >= 40) pelt(p, x + w - 11, y + 4);
    // 宽大的建筑把劈柴墩摆在墙前，免得超出画幅
    choppingBlock(p, w >= 70 ? x + w - 22 : x + w + 1, c.gy);
    // 秋天：门边挂一串晒干的玉米
    if (c.o.season === 2) {
      const cx = x + 4;
      p.vline(cx, bottom - 16, bottom - 14, ST[1]);
      p.stamp(["aba", "bab", "aba", ".a."], { a: P.gold[2], b: P.autumn[2] }, cx - 1, bottom - 13);
    }
  },
};
