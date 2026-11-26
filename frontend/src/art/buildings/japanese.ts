// 日本风格（japanese）：16 世纪的港町。
// 町家：底层深色木板墙与格子窗、门口挂藏青暖帘，上层白土墙与虫笼窗，两层之间一道瓦葺的下屋檐（庇），
// 屋顶是灰瓦的切妻 / 入母屋（厚屋脊、两端鬼瓦），正式建筑加千鸟破风与金鯱，门廊是唐破风；
// 仓库与银行是海鼠壁的土藏；地标是寺院的山门与多宝塔；城墙是石垣上的白土塀与隅橹，城门是石垣夹着的橹门；
// 街上有辻行灯、吊桶井、铺红毡的床几与装米俵的大八车；远景里有天守、五重塔与朱红鸟居。
import type { Facility } from "../../store/game";
import { P, ink, overlay } from "../palette";
import type { Px } from "../px";
import { drawEmblem } from "./emblems";
import { type Canvas, type Ramp, ashlar, fillProfile, gableFront, h01, hipProfile, plaster, tintOpaque } from "./kit";
import { lantern, opening, steps } from "./parts";
import { type DoorKind, type Kit, type RoofKind, type WallKind, type WinKind, eaveShadow } from "./style";
import { type CultureArt, type FarCtx, farWindows, spots, wrap, wrapCourses } from "./townArt";

/** 灰瓦（燻瓦）：暗、中暗、中、亮、高光 */
const K: Ramp = P.stone;
const W = P.wood;
/** 柿涩色的格子（红褐） */
const LAT: Ramp = [P.wood[0], P.brick[0], P.brick[1]];
/** 朱漆（鸟居、多宝塔） */
const VM: Ramp = [P.red[0], P.red[1], P.red[2], P.red[3]];
/** 藏青（暖帘、旗） */
const AI: Ramp = [P.cloth.navy[0], P.cloth.navy[1], P.cloth.navy[2], P.cloth.blue[2]];
/** 白土墙 */
const WH: Ramp = [P.plaster[0], P.plaster[1], P.plaster[2], P.plaster[3], P.white];
/** 桧皮（棚屋的屋顶） */
const HW: Ramp = [P.wood[0], P.wood[1], P.brick[0], P.wood[2], P.wood[3]];

// ───────────────────────── 屋顶 ─────────────────────────

/** 本瓦的纹理：每 3 列一道瓦垄（亮、中、暗沟），檐口一排瓦当，右坡背光。 */
function kawaraTex(x0: number, x1: number, inset: number, R: Ramp = K) {
  const mid = (x0 + x1) / 2;
  return (xx: number, _yy: number, e: { fromTop: number; fromBot: number }): string => {
    const d = Math.min(xx - x0, x1 - xx);
    const ph = (((xx - x0) % 3) + 3) % 3;
    if (e.fromBot === 0) return ph === 0 ? R[3] : R[0];
    if (e.fromTop === 0) return d < inset && xx > mid ? R[2] : R[3];
    let col: string = ph === 0 ? R[3] : ph === 1 ? R[2] : R[1];
    if (d < inset && xx > mid) col = col === R[3] ? R[2] : R[1];
    if (d < inset && xx < mid && e.fromTop === 1) col = R[4];
    return col;
  };
}

/** 一层瓦顶（入母屋的下半与切妻的檐）：墙 x..x+w-1，墙顶 y，坡高 h，出檐 over；两端檐口微微反翘。返回屋面顶行。 */
function tileRoof(c: Canvas, x: number, w: number, y: number, h: number, over: number, R: Ramp = K): { yt: number; x0: number; x1: number; inset: number } {
  const p = c.p;
  const x0 = x - over;
  const x1 = x + w - 1 + over;
  const yb = y + 1;
  const yt = yb - h + 1;
  const inset = Math.min(Math.floor((x1 - x0) / 2) - 2, Math.round(h * 0.8) + 1);
  const base = hipProfile(x0, x1, yt, yb, inset, 1.6, 2);
  const prof = (xx: number) => {
    const r = base(xx);
    if (!r) return null;
    const d = Math.min(xx - x0, x1 - xx);
    // 反り：最外两列檐口抬起 1 像素
    const lift = d < 2 ? 1 : 0;
    return [r[0] - lift, r[1] - lift] as const;
  };
  fillProfile(p, x0, x1, prof, kawaraTex(x0, x1, inset, R));
  c.markRoof(x0, yt - 1, x1 - x0 + 1, h + 1, R, 1);
  c.eave(x0 + 2, x1 - 2, yb);
  return { yt, x0, x1, inset };
}

/** 屋脊：三层熨斗瓦（上亮下暗），两端鬼瓦；返回最高点。 */
function ridge(c: Canvas, rx0: number, rx1: number, yt: number, R: Ramp = K): number {
  const p = c.p;
  p.hline(rx0, rx1, yt - 1, R[1]);
  p.hline(rx0, rx1, yt - 2, R[2]);
  for (let xx = rx0 + 1; xx < rx1; xx += 2) p.set(xx, yt - 2, R[3]);
  p.hline(rx0 + 1, rx1 - 1, yt - 3, R[3]);
  // 鬼瓦：两端各一块上宽下窄的方块，向外翘出 1 像素
  for (const [ex, dir] of [
    [rx0, -1],
    [rx1, 1],
  ] as const) {
    p.rect(ex - 1, yt - 4, 3, 4, R[2]);
    p.vline(ex - 1, yt - 4, yt - 1, R[3]);
    p.vline(ex + 1, yt - 4, yt - 1, R[1]);
    p.hline(ex - 1, ex + 1, yt - 5, R[3]);
    p.set(ex + dir * 2, yt - 5, R[3]);
    p.set(ex, yt - 3, R[0]);
  }
  c.markRoof(rx0 - 2, yt - 5, rx1 - rx0 + 5, 5, R, 0);
  return yt - 5;
}

/** 金鯱：屋脊两端一对金色的鱼形脊饰（尾巴朝上）；ex 为屋脊端点。 */
function shachi(c: Canvas, ex: number, yt: number, dir: -1 | 1): number {
  const p = c.p;
  const G = P.gold;
  // 头朝下压在脊端，身子竖起，尾鳍分成 V 字朝天
  p.stamp(["a..a", ".ab.", ".bb.", "bbc.", "bcc.", ".cc."], { a: G[4], b: G[3], c: G[2] }, ex - 2 + (dir > 0 ? 1 : 0), yt - 9, dir > 0);
  p.vline(ex, yt - 4, yt - 3, G[1]);
  return yt - 9;
}

/** 千鸟破风：屋面正中的三角山墙，白壁、木框、两坡瓦边，山尖下挂金色悬鱼。底边 y，中心 cx，半宽 hw。返回顶点。 */
function chidori(c: Canvas, cx: number, y: number, hw: number, R: Ramp = K): number {
  const h = Math.max(4, Math.round(hw * 0.7));
  const apex = gableFront(
    c,
    cx,
    y,
    hw,
    h,
    (t) => {
      t.rect(cx - hw, y - h - 1, hw * 2 + 2, h + 3, WH[4]);
      t.hline(cx - hw, cx + hw, y, W[1]);
      t.vline(cx, y - h, y, W[1]);
    },
    [R[1], R[2], R[3]],
    { thick: 2, over: 1, mark: R },
  );
  c.p.set(cx, apex + 3, P.gold[3]).set(cx - 1, apex + 4, P.gold[2]).set(cx + 1, apex + 4, P.gold[2]);
  return apex;
}

/** 唐破风：门廊的弓形封檐板（中间拱起），正中一枚金色兔毛通。 */
function karahafu(c: Canvas, x: number, w: number, y: number): number {
  const p = c.p;
  const cx = x + (w - 1) / 2;
  let top = y;
  for (let xx = x - 2; xx <= x + w + 1; xx++) {
    const u = Math.min(1, Math.abs(xx - cx) / ((w + 4) / 2));
    // 中间圆拱、两端微翘
    const rise = Math.round(5 * Math.cos((u * Math.PI) / 2) ** 2) - (u > 0.9 ? 1 : 0);
    const yy = y - rise;
    top = Math.min(top, yy - 1);
    p.set(xx, yy - 1, W[3]);
    p.set(xx, yy, W[2]);
    p.set(xx, yy + 1, W[1]);
  }
  const mx = Math.round(cx);
  p.stamp([".a.", "aba", ".a."], { a: P.gold[2], b: P.gold[4] }, mx - 1, y - 3);
  return top;
}

function roof(c: Canvas, x: number, w: number, y: number, kind: RoofKind = "main"): number {
  const p = c.p;
  if (kind === "gable") {
    // 妻入：山墙朝街，白壁上露出深色的梁与束，灰瓦两坡，山尖挂悬鱼；墙下一道小庇
    const cx = x + Math.floor(w / 2);
    const hw = Math.floor(w / 2);
    const h = Math.round(hw * 0.62);
    const apex = gableFront(
      c,
      cx,
      y,
      hw,
      h,
      (t) => {
        plaster(t, x, y - h, w, h + 1, P.plaster, 7);
        t.hline(x, x + w - 1, y - Math.floor(h * 0.45), W[0]);
        t.vline(cx, y - h, y, W[0]);
        for (const dx of [-Math.round(hw * 0.5), Math.round(hw * 0.5)]) t.vline(cx + dx, y - Math.floor(h * 0.45), y, W[0]);
      },
      [K[1], K[2], K[3]],
      { thick: 3, over: 3, mark: K },
    );
    p.stamp([".a.", "aba", "b.b"], { a: P.gold[3], b: P.gold[1] }, cx - 1, apex + 4);
    // 山墙下的小庇
    pent(c, x, w, y + 2, 2);
    return apex;
  }
  if (kind === "shed") {
    // 桧皮葺的低矮棚顶：横向细密的层纹，屋脊压一道灰瓦
    const x0 = x - 3;
    const x1 = x + w + 2;
    const yb = y + 1;
    const h = 9;
    const yt = yb - h + 1;
    const inset = h;
    fillProfile(p, x0, x1, hipProfile(x0, x1, yt, yb, inset, 1.4, 2), (xx, yy, e) => {
      if (e.fromBot === 0) return HW[1];
      if (e.fromBot === 1) return HW[4];
      const right = xx > (x0 + x1) / 2 && Math.min(xx - x0, x1 - xx) < inset;
      const band = (yb - yy) % 2 === 0 ? HW[3] : HW[2];
      return right ? (band === HW[3] ? HW[2] : HW[1]) : band;
    });
    c.markRoof(x0, yt, x1 - x0 + 1, h, HW, 1);
    c.eave(x0 + 1, x1 - 1, yb);
    p.hline(x0 + inset - 1, x1 - inset + 1, yt - 1, K[2]);
    p.hline(x0 + inset - 1, x1 - inset + 1, yt - 2, K[3]);
    eaveShadow(c, x, w, y + 2, 1);
    return yt - 2;
  }
  if (kind === "tower") {
    // 橹：入母屋的下层屋顶 + 白壁上层（武者窗）+ 上层屋顶，两端金鯱
    const t1 = tileRoof(c, x, w, y, 7, 3);
    eaveShadow(c, x, w, y + 2, 1);
    const ux = x + 3;
    const uw = w - 6;
    const uy = t1.yt - 7;
    plaster(p, ux, uy, uw, t1.yt - uy + 2, WH, 19);
    p.vline(ux, uy, t1.yt + 1, WH[4]);
    p.vline(ux + uw - 1, uy, t1.yt + 1, WH[1]);
    for (let xx = ux + 3; xx < ux + uw - 3; xx += 4) {
      p.rect(xx, uy + 2, 2, 3, c.o.lit ? P.lamp[1] : ink.brown);
      p.vline(xx + 1, uy + 2, uy + 4, W[1]);
    }
    const t2 = tileRoof(c, ux, uw, uy, 7, 4);
    const top = ridge(c, t2.x0 + t2.inset, t2.x1 - t2.inset, t2.yt);
    shachi(c, t2.x0 + t2.inset, t2.yt, -1);
    shachi(c, t2.x1 - t2.inset, t2.yt, 1);
    return Math.min(top, t2.yt - 8);
  }
  if (kind === "porch") {
    // 唐破风的门廊
    const r = tileRoof(c, x, w, y, 6, 2);
    ridge(c, r.x0 + r.inset, r.x1 - r.inset, r.yt);
    const kt = karahafu(c, x, w, y);
    eaveShadow(c, x, w, y + 2, 1);
    return Math.min(r.yt - 5, kt);
  }
  // main / grand：入母屋的灰瓦大屋顶
  const h = Math.min(13, Math.max(8, Math.round(w * 0.12) + 4));
  const r = tileRoof(c, x, w, y, h, 4);
  const rx0 = r.x0 + r.inset;
  const rx1 = r.x1 - r.inset;
  let peak = ridge(c, rx0, rx1, r.yt);
  // 入母屋的妻：屋面上半两端各一小块白色三角山墙（侧看只露出一条）
  for (const ex of [rx0 + 2, rx1 - 2]) {
    p.vline(ex, r.yt, r.yt + 2, WH[3]);
    p.set(ex, r.yt + 3, W[1]);
  }
  eaveShadow(c, x, w, y + 2, 1);
  if (kind === "grand") {
    const cx = x + Math.floor(w / 2);
    const hw = Math.min(10, Math.max(5, Math.round(w * 0.12)));
    peak = Math.min(peak, chidori(c, cx, y - 1, hw));
    if (w >= 60) {
      peak = Math.min(peak, shachi(c, rx0, r.yt, -1));
      shachi(c, rx1, r.yt, 1);
    }
  }
  return peak;
}

/** 下屋檐（庇）：两层之间、出挑 over 的一道瓦檐；顶在 y-1，檐口在 y+rows。 */
function pent(c: Canvas, x: number, w: number, y: number, over = 3, rows = 2): void {
  const p = c.p;
  const x0 = x - over;
  const x1 = x + w - 1 + over;
  p.hline(x0 + 1, x1 - 1, y - 1, K[3]);
  for (let i = 0; i < rows; i++) {
    for (let xx = x0; xx <= x1; xx++) {
      const ph = (xx - x0) % 3;
      p.set(xx, y + i, ph === 0 ? K[3] : ph === 1 ? K[2] : K[1]);
    }
  }
  for (let xx = x0; xx <= x1; xx++) p.set(xx, y + rows, (xx - x0) % 3 === 0 ? K[3] : K[0]);
  c.markRoof(x0, y - 1, x1 - x0 + 1, rows + 2, K, 1);
  c.eave(x0 + 1, x1 - 1, y + rows);
  eaveShadow(c, x, w, y + rows + 1, 1);
}

// ───────────────────────── 门窗 ─────────────────────────

const winSizes: Record<WinKind, readonly [number, number]> = {
  std: [8, 7],
  tall: [7, 11],
  small: [6, 5],
  round: [9, 9],
  wide: [14, 7],
};

const doorSizes: Record<DoorKind, readonly [number, number]> = {
  std: [8, 12],
  double: [12, 13],
  grand: [14, 15],
  open: [16, 12],
  iron: [12, 13],
  barn: [18, 16],
};

/** 格子窗：红褐的竖格棂，后面是障子纸（夜里透出暖光）。 */
function koshi(c: Canvas, x: number, y: number, w: number, h: number): void {
  const p = c.p;
  const lit = c.o.lit;
  p.rect(x - 1, y - 1, w + 2, h + 2, W[0]);
  p.rect(x, y, w, h, lit ? P.lamp[1] : P.parchment);
  if (lit) p.rect(x + 1, y + 1, w - 2, h - 2, P.lamp[2]);
  else p.hline(x, x + w - 1, y, P.parchmentDark);
  for (let xx = x + 1; xx < x + w; xx += 2) p.vline(xx, y, y + h - 1, LAT[1]);
  p.hline(x - 1, x + w, y + h, W[2]);
  c.ledge(x - 1, x + w, y + h);
}

function window(c: Canvas, x: number, y: number, kind: WinKind = "std"): void {
  const p = c.p;
  const [w, h] = winSizes[kind];
  const lit = c.o.lit;
  if (kind === "small") {
    // 虫笼窗：白土的粗竖棂，里面是暗处
    p.rect(x - 1, y - 1, w + 2, h + 2, WH[1]);
    p.rect(x, y, w, h, lit ? P.lamp[1] : ink.brown);
    for (let xx = x + 1; xx < x + w; xx += 2) p.vline(xx, y, y + h - 1, WH[3]);
    p.hline(x - 1, x + w, y - 1, WH[4]);
    return;
  }
  if (kind === "round") {
    // 圆窗：圆框里横竖的障子格
    const cx = x + 4;
    const cy = y + 4;
    p.circle(cx, cy, 4, W[0]);
    p.circle(cx, cy, 3, lit ? P.lamp[1] : P.parchment);
    if (lit) p.circle(cx, cy, 2, P.lamp[2]);
    for (const d of [-1, 1]) {
      p.vline(cx + d, cy - 3, cy + 3, W[1]);
      p.hline(cx - 3, cx + 3, cy + d * 2, W[1]);
    }
    return;
  }
  if (kind === "wide") {
    // 出格子：带小瓦檐的宽格子窗
    koshi(c, x, y, w, h);
    p.hline(x - 2, x + w + 1, y - 3, K[3]);
    for (let xx = x - 2; xx <= x + w + 1; xx++) p.set(xx, y - 2, (xx - x) % 3 === 0 ? K[3] : K[1]);
    c.markRoof(x - 2, y - 3, w + 4, 2, K, 0);
    return;
  }
  koshi(c, x, y, w, h);
  if (kind === "tall") p.hline(x, x + w - 1, y + Math.floor(h / 2), W[1]);
}

/** 暖帘：门楣上的竹竿挂一幅藏青布，分成 n 片，正中印一个白色的圆纹。 */
function noren(c: Canvas, x: number, y: number, w: number, n: number): void {
  const p = c.p;
  const h = 6;
  p.hline(x - 1, x + w, y, W[3]);
  for (let xx = x; xx < x + w; xx++) {
    const seg = Math.floor(((xx - x) * n) / w);
    const gap = n > 1 && Math.floor(((xx + 1 - x) * n) / w) !== seg && xx < x + w - 1;
    if (gap) continue;
    for (let yy = y + 1; yy <= y + h; yy++) p.set(xx, yy, yy === y + h ? AI[0] : xx === x ? AI[2] : AI[1]);
  }
  const cx = x + Math.floor(w / 2);
  p.ring(cx, y + 3, 1, 1, P.white);
  p.set(cx, y + 3, AI[1]);
}

function door(c: Canvas, cx: number, bottom: number, kind: DoorKind = "std"): void {
  const p = c.p;
  const [w, h] = doorSizes[kind];
  const x = cx - Math.floor(w / 2);
  const y = bottom - h;
  // 门框
  p.rect(x - 1, y - 1, w + 2, h + 1, W[0]);
  p.hline(x - 2, x + w + 1, y - 2, W[1]);
  if (kind === "std" || kind === "open") {
    opening(c, x, y, w, h);
    // 土间里的格子拉门（只露出一半）
    if (kind === "std") for (let xx = x + w - 3; xx < x + w; xx++) p.vline(xx, y + 6, bottom - 1, xx % 2 ? LAT[1] : P.parchment);
    noren(c, x, y, w, kind === "open" ? 3 : 2);
    return;
  }
  if (kind === "iron") {
    // 土藏的观音开：厚厚的白土门扇，门框一层层退进
    p.rect(x - 2, y - 2, w + 4, h + 2, WH[2]);
    p.rect(x - 1, y - 1, w + 2, h + 1, WH[1]);
    p.rect(x, y, w, h, WH[3]);
    p.vline(x, y, bottom - 1, WH[4]);
    p.vline(cx - 1, y, bottom - 1, WH[1]);
    p.vline(cx, y, bottom - 1, WH[0]);
    p.vline(x + w - 1, y, bottom - 1, WH[2]);
    for (let yy = y + 2; yy < bottom - 1; yy += 3) p.hline(x + 1, x + w - 2, yy, WH[2]);
    p.set(cx - 2, y + Math.floor(h / 2), P.iron[2]).set(cx + 1, y + Math.floor(h / 2), P.iron[2]);
    return;
  }
  if (kind === "barn") {
    // 板户：横向的木板拉门
    for (let yy = y; yy < bottom; yy++) p.hline(x, x + w - 1, yy, (yy - y) % 3 === 0 ? W[1] : (yy - y) % 3 === 1 ? W[3] : W[2]);
    p.vline(cx, y, bottom - 1, W[0]);
    p.vline(x + 2, y, bottom - 1, W[1]);
    p.vline(x + w - 3, y, bottom - 1, W[1]);
    return;
  }
  if (kind === "grand") {
    // 黑漆大门：门板竖缝、一排排金色的饰钉与横带
    const B = P.iron;
    p.rect(x, y, w, h, B[1]);
    for (let xx = x + 2; xx < x + w; xx += 3) p.vline(xx, y, bottom - 1, B[0]);
    p.vline(cx, y, bottom - 1, B[0]);
    for (const yy of [y + 3, bottom - 4]) {
      p.hline(x, x + w - 1, yy, B[2]);
      for (let xx = x + 1; xx < x + w; xx += 2) p.set(xx, yy, P.gold[3]);
    }
    p.set(cx - 2, y + Math.floor(h / 2), P.gold[2]).set(cx + 1, y + Math.floor(h / 2), P.gold[2]);
    return;
  }
  // double：格子拉门
  p.rect(x, y, w, h, W[1]);
  koshi(c, x + 1, y + 1, Math.floor(w / 2) - 2, h - 3);
  koshi(c, cx + 1, y + 1, Math.ceil(w / 2) - 2, h - 3);
  p.vline(cx, y, bottom - 1, W[0]);
}

/** 屋根看板：深色木板，顶上一道小瓦檐。 */
function sign(c: Canvas, cx: number, y: number, fac: Facility): number {
  const p = c.p;
  const x = cx - 7;
  // 小瓦檐
  p.hline(x - 2, x + 16, y, K[3]);
  for (let xx = x - 2; xx <= x + 16; xx++) p.set(xx, y + 1, (xx - x) % 3 === 0 ? K[3] : K[1]);
  c.markRoof(x - 2, y, 19, 2, K, 0);
  p.rect(x, y + 2, 15, 13, W[2]);
  p.hline(x, x + 14, y + 2, W[3]);
  p.rect(x + 1, y + 3, 13, 11, W[0]);
  p.rect(x + 2, y + 4, 11, 9, ink.deep);
  drawEmblem(p, fac, x + 3, y + 4, japanese.flag);
  return 15;
}

// ───────────────────────── 墙 ─────────────────────────

/** 海鼠壁：灰色方瓦，白色斜格灰缝。 */
function namako(p: Px, x: number, y: number, w: number, h: number): void {
  for (let yy = y; yy < y + h; yy++) {
    for (let xx = x; xx < x + w; xx++) {
      const a = (((xx + yy) % 6) + 6) % 6;
      const b = (((xx - yy) % 6) + 6) % 6;
      const joint = a === 0 || b === 0;
      p.set(xx, yy, joint ? WH[4] : (xx + yy) % 2 ? K[1] : K[2]);
    }
  }
  p.hline(x, x + w - 1, y, WH[3]);
}

/** 卯建：上层两端突出的防火白墙，顶上压一道小瓦。 */
function udatsu(c: Canvas, x: number, y: number, h: number): void {
  const p = c.p;
  p.rect(x, y, 3, h, WH[3]);
  p.vline(x, y, y + h - 1, WH[4]);
  p.vline(x + 2, y, y + h - 1, WH[1]);
  p.hline(x - 1, x + 3, y - 1, K[2]);
  p.hline(x - 1, x + 3, y - 2, K[3]);
  c.markRoof(x - 1, y - 2, 5, 2, K, 0);
}

function wall(c: Canvas, x: number, y: number, w: number, h: number, kind: WallKind = "main"): void {
  const p = c.p;
  if (kind === "stone") {
    // 土藏：上部白土墙，下部海鼠壁
    plaster(p, x, y, w, h, WH, c.seed + x);
    const nh = Math.max(4, Math.floor(h * 0.45));
    namako(p, x, y + h - nh, w, nh);
    p.vline(x, y, y + h - 1, WH[4]);
    p.vline(x + w - 1, y, y + h - 1, WH[1]);
    return;
  }
  if (kind === "ground") {
    // 町家的底层：深色的横向木板墙，柱子露在外面
    for (let yy = y; yy < y + h; yy++) p.hline(x, x + w - 1, yy, (yy - y) % 3 === 0 ? W[1] : (yy - y) % 3 === 1 ? W[0] : W[1]);
    for (let xx = x + 11; xx < x + w - 6; xx += 12) {
      p.rect(xx, y, 2, h, W[2]);
      p.vline(xx, y, y + h - 1, W[3]);
    }
  } else if (kind === "plain") {
    // 下半截焼杉的竖板，上半截白土
    plaster(p, x, y, w, h, WH, c.seed + x + y);
    const bh = Math.min(h, Math.max(5, Math.floor(h * 0.45)));
    for (let xx = x; xx < x + w; xx++) p.vline(xx, y + h - bh, y + h - 1, (xx - x) % 3 === 0 ? P.iron[0] : (xx - x) % 3 === 1 ? P.iron[1] : W[0]);
    p.hline(x, x + w - 1, y + h - bh - 1, W[2]);
  } else {
    plaster(p, x, y, w, h, WH, c.seed + x + y);
    if (kind === "upper") {
      // 上层的白土墙两端立卯建
      if (h >= 12) {
        udatsu(c, x - 2, y + 3, h - 3);
        udatsu(c, x + w - 1, y + 3, h - 3);
      }
    } else {
      // main：下部一段腰板
      const bh = Math.min(4, h - 2);
      for (let xx = x; xx < x + w; xx++) p.vline(xx, y + h - bh, y + h - 1, (xx - x) % 4 === 0 ? W[0] : W[1]);
      p.hline(x, x + w - 1, y + h - bh, W[2]);
    }
  }
  // 两端的柱子
  p.rect(x, y, 2, h, W[1]);
  p.vline(x, y, y + h - 1, W[2]);
  p.rect(x + w - 2, y, 2, h, W[0]);
}

export const japanese: Kit = {
  style: "japanese",
  flag: [AI[1], AI[2], AI[3]],
  trim: W,
  plinthH: 2,
  awning: [AI, P.cloth.cream],
  lamp: "paper",
  tavernRoof: "gable",
  wall,
  plinth(c, x, w, h) {
    const p = c.p;
    const g = c.gy;
    ashlar(p, x, g - h, w, h, K, { course: Math.max(2, h), min: 6, max: 11, seed: c.seed + 3, light: 2 });
    p.hline(x, x + w - 1, g - h, K[3]);
  },
  roof,
  band(c, x, w, y) {
    // 两层之间的庇
    pent(c, x, w, y);
  },
  post(c, x, y0, y1, kind = "post") {
    const p = c.p;
    if (kind === "column") {
      // 圆柱：深色木、黑漆柱脚与金色的饰金具
      p.rect(x, y0, 3, y1 - y0 + 1, W[1]);
      p.vline(x, y0, y1, W[2]);
      p.vline(x + 2, y0, y1, W[0]);
      p.rect(x, y1 - 2, 3, 3, P.iron[1]);
      p.hline(x, x + 2, y1 - 3, P.gold[2]);
      p.hline(x, x + 2, y0 + 1, P.gold[2]);
      p.rect(x - 1, y0, 5, 1, W[0]);
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
  decor(c, x, w, y) {
    // 檐下两盏白纸提灯；春天墙角探出一枝樱花
    lantern(c, x + 3, y + 3, "paper");
    lantern(c, x + w - 4, y + 3, "paper");
    if (c.o.season === 0) {
      const p = c.p;
      const bx = x + w - 2;
      const by = y + 12;
      p.line(bx, by, bx + 5, by - 4, W[1]);
      for (const [dx, dy] of [
        [2, -2],
        [4, -4],
        [5, -2],
        [6, -5],
        [3, -4],
      ] as const) {
        p.set(bx + dx, by + dy, P.blossom[2]);
        p.set(bx + dx + 1, by + dy, P.blossom[3]);
      }
    }
  },
};

// ───────────────────────── 地标：山门与多宝塔 ─────────────────────────

/** 斗栱带：朱、白相间的一排栱头，下面一道阴影。 */
function bracketBand(c: Canvas, x: number, w: number, y: number): void {
  const p = c.p;
  p.hline(x, x + w - 1, y, W[0]);
  for (let i = 0; i < w; i++) p.set(x + i, y + 1, i % 3 === 1 ? WH[4] : VM[2]);
  eaveShadow(c, x, w, y + 2, 1);
}

/** 相轮：细杆上九道金环，顶上宝珠。底在 y，返回顶点。 */
function sorin(c: Canvas, cx: number, y: number, len: number): number {
  const p = c.p;
  const G = P.gold;
  // 露盘
  p.rect(cx - 2, y - 2, 5, 2, G[1]);
  p.hline(cx - 2, cx + 2, y - 2, G[2]);
  p.vline(cx, y - len, y - 3, G[1]);
  for (let i = 0; i < 9; i++) {
    const yy = y - 4 - i * 2;
    if (yy < y - len + 4) break;
    p.hline(cx - 1, cx + 1, yy, G[3]);
    p.set(cx + 1, yy, G[1]);
  }
  // 水烟与宝珠
  p.stamp([".a.", "aba", ".c."], { a: G[3], b: G[4], c: G[2] }, cx - 1, y - len - 2);
  return y - len - 2;
}

function landmark(c: Canvas): void {
  const p = c.p;
  const g = c.gy;
  const cx = 58;
  // 基坛
  ashlar(p, cx - 24, g - 4, 49, 4, K, { course: 2, min: 5, max: 9, seed: 3 });
  p.hline(cx - 24, cx + 24, g - 4, K[4]);
  steps(c, cx, 10, 4, g, K);
  // 初层：方形，朱柱白壁，正中朱扉
  const bw = 28;
  const bx = cx - bw / 2;
  const b1 = g - 4;
  const t1 = b1 - 20;
  plaster(p, bx, t1, bw, 20, WH, 5);
  for (const px of [bx, bx + 8, bx + bw - 11, bx + bw - 3]) {
    p.rect(px, t1, 3, 20, VM[2]);
    p.vline(px, t1, b1 - 1, VM[3]);
    p.vline(px + 2, t1, b1 - 1, VM[1]);
  }
  p.hline(bx, bx + bw - 1, t1 + 4, VM[1]);
  p.rect(cx - 4, t1 + 6, 8, 14, VM[2]);
  p.vline(cx, t1 + 6, b1 - 1, VM[0]);
  for (let yy = t1 + 8; yy < b1 - 1; yy += 3) p.set(cx - 2, yy, P.gold[3]).set(cx + 2, yy, P.gold[3]);
  for (const wx of [bx + 4, bx + bw - 7]) {
    p.rect(wx, t1 + 8, 3, 7, c.o.lit ? P.lamp[1] : ink.brown);
    for (let yy = t1 + 8; yy < t1 + 15; yy += 2) p.hline(wx, wx + 2, yy, VM[1]);
  }
  bracketBand(c, bx, bw, t1);
  // 裳阶：宽大的下层屋顶（桧皮色的厚檐）
  const r1 = tileRoof(c, bx, bw, t1 - 1, 9, 9, HW);
  // 龟腹：白色的馒头形
  const ky = r1.yt + 1;
  for (let row = 0; row < 6; row++) {
    const t = row / 6;
    const hw = Math.round(10 * Math.sqrt(1 - t * t));
    p.hline(cx - hw, cx + hw, ky - row, row === 5 ? WH[4] : WH[3]);
    p.set(cx + hw, ky - row, WH[1]);
    p.set(cx - hw, ky - row, WH[4]);
  }
  // 上层：圆身（左亮右暗）与密集的斗栱
  const uw = 16;
  const ux = cx - uw / 2;
  const ub = ky - 5;
  const ut = ub - 12;
  for (let xx = ux; xx < ux + uw; xx++) {
    const u = (xx - ux) / (uw - 1);
    p.vline(xx, ut, ub, u < 0.25 ? WH[4] : u < 0.7 ? WH[3] : WH[1]);
  }
  for (const px of [ux + 2, ux + uw - 4]) p.vline(px, ut + 2, ub, VM[1]);
  p.rect(cx - 2, ut + 4, 4, 6, c.o.lit ? P.lamp[1] : VM[1]);
  bracketBand(c, ux - 3, uw + 6, ut);
  p.hline(ux - 3, ux + uw + 2, ut + 3, VM[2]);
  // 上层屋顶：方形大屋顶，出檐深远
  const r2 = tileRoof(c, ux - 2, uw + 4, ut - 1, 11, 12, HW);
  sorin(c, cx, r2.yt - 1, 30);
  // 屋角挂的风铎
  for (const ex of [r2.x0 + 1, r2.x1 - 1]) {
    p.vline(ex, r2.yt + 10, r2.yt + 11, P.iron[1]);
    p.set(ex, r2.yt + 12, P.gold[2]).set(ex, r2.yt + 13, P.gold[1]);
  }
  // 山门：左前方一座小门，朱柱、灰瓦切妻、门扉敞开
  const gx = 4;
  const gw = 30;
  const gt = g - 32;
  for (const px of [gx + 2, gx + gw - 5]) {
    p.rect(px, gt, 3, g - gt, VM[2]);
    p.vline(px, gt, g - 1, VM[3]);
    p.vline(px + 2, gt, g - 1, VM[1]);
    p.rect(px - 1, g - 2, 5, 2, K[3]);
  }
  p.rect(gx + 5, gt + 2, gw - 10, 2, VM[1]);
  p.hline(gx, gx + gw - 1, gt, W[0]);
  bracketBand(c, gx + 1, gw - 2, gt - 1);
  const gr = tileRoof(c, gx, gw, gt - 2, 8, 4);
  ridge(c, gr.x0 + gr.inset, gr.x1 - gr.inset, gr.yt);
  // 门下敞开的门扉（黑漆）与里面的石板路
  p.rect(gx + 5, gt + 4, gw - 10, g - gt - 4, ink.brown);
  p.rect(gx + 9, g - 4, gw - 18, 4, K[3]);
  p.hline(gx + 9, gx + gw - 10, g - 4, K[4]);
  for (const dx of [5, gw - 7]) {
    p.rect(gx + dx, gt + 6, 2, g - gt - 6, P.iron[1]);
    p.vline(gx + dx, gt + 6, g - 1, P.iron[2]);
  }
  // 门前的石灯笼
  stoneLantern(p, 86, g, c.o.lit);
}

/** 石灯笼：基座、竿、火袋、笠与宝珠。底在 g。 */
function stoneLantern(p: Px, cx: number, g: number, lit: boolean): void {
  p.rect(cx - 3, g - 3, 7, 3, K[2]);
  p.hline(cx - 3, cx + 3, g - 3, K[3]);
  p.rect(cx - 1, g - 11, 3, 8, K[2]);
  p.vline(cx - 1, g - 11, g - 4, K[3]);
  p.rect(cx - 3, g - 13, 7, 2, K[3]);
  p.rect(cx - 2, g - 18, 5, 5, K[2]);
  p.rect(cx - 1, g - 17, 3, 3, lit ? P.lamp[2] : ink.brown);
  p.poly(
    [
      [cx - 5, g - 18],
      [cx + 0.5, g - 22],
      [cx + 6, g - 18],
    ],
    K[3],
  );
  p.hline(cx - 5, cx + 5, g - 19, K[2]);
  p.set(cx, g - 23, K[4]);
}

// ───────────────────────── 城门：石垣与橹门 ─────────────────────────

/** 石垣：野面积的大石块，墙面略向内倾（左右两侧逐行收进）。 */
function ishigaki(c: Canvas, x: number, w: number, top: number, bottom: number, lean: -1 | 0 | 1 = 0, seed = 0): void {
  const p = c.p;
  const tex = p.clone().clear();
  ashlar(tex, x - 4, top, w + 8, bottom - top, K, { course: 5, min: 5, max: 11, seed, light: 2 });
  const h = bottom - top;
  for (let yy = top; yy < bottom; yy++) {
    // 扇形的勾配：越往上收得越多
    const t = (bottom - yy) / h;
    const inset = Math.round(t * t * 4);
    const a = x + (lean <= 0 ? inset : 0);
    const b = x + w - 1 - (lean >= 0 ? inset : 0);
    for (let xx = a; xx <= b; xx++) p.put(xx, yy, tex.get(xx, yy));
  }
}

/** 白土塀上的狭间（三角、方、圆轮流）。 */
function sama(p: Px, x: number, y: number, k: number): void {
  const col = ink.deep;
  if (k % 3 === 0) p.stamp(["..a..", ".aaa.", "aaaaa"], { a: col }, x - 2, y);
  else if (k % 3 === 1) p.rect(x - 1, y, 3, 3, col);
  else p.stamp([".a.", "aaa", ".a."], { a: col }, x - 1, y);
}

function gate(c: Canvas): void {
  const p = c.p;
  const g = c.gy;
  const cx = Math.floor(c.w / 2);
  const gw = 26;
  // 两侧石垣
  const top = g - 30;
  ishigaki(c, cx - gw / 2 - 30, 30, top, g, -1, 5);
  ishigaki(c, cx + gw / 2, 30, top, g, 1, 9);
  // 门洞：深处的暗影与敞开的黑漆门扉
  p.rect(cx - gw / 2, top, gw, g - top, ink.brown);
  p.rect(cx - gw / 2 + 4, g - 6, gw - 8, 6, K[3]);
  p.hline(cx - gw / 2 + 4, cx + gw / 2 - 5, g - 6, K[4]);
  for (const dx of [-gw / 2, gw / 2 - 4]) {
    p.rect(cx + dx, top + 4, 4, g - top - 4, P.iron[1]);
    p.vline(cx + dx, top + 4, g - 1, P.iron[2]);
    for (let yy = top + 7; yy < g - 2; yy += 5) p.hline(cx + dx, cx + dx + 3, yy, P.iron[3]);
  }
  // 门上的冠木
  p.rect(cx - gw / 2 - 2, top, gw + 4, 4, W[1]);
  p.hline(cx - gw / 2 - 2, cx + gw / 2 + 1, top, W[2]);
  // 橹：横跨两侧石垣的白壁长屋，下半黑色的下见板，开武者窗与狭间
  const yw = 66;
  const yx = cx - yw / 2;
  const yt = top - 18;
  plaster(p, yx, yt, yw, 18, WH, 13);
  for (let xx = yx; xx < yx + yw; xx++) p.vline(xx, top - 7, top - 1, (xx - yx) % 3 === 0 ? P.iron[0] : P.iron[1]);
  p.hline(yx, yx + yw - 1, top - 8, W[1]);
  for (let i = 0; i < 4; i++) {
    const wx = yx + 6 + i * 16;
    if (i === 1 || i === 2) {
      p.rect(wx, yt + 4, 7, 5, c.o.lit ? P.lamp[1] : ink.brown);
      for (let xx = wx + 1; xx < wx + 7; xx += 2) p.vline(xx, yt + 4, yt + 8, W[1]);
    } else sama(p, wx + 3, yt + 5, i);
  }
  p.vline(yx, yt, top - 1, WH[4]);
  p.vline(yx + yw - 1, yt, top - 1, WH[1]);
  japanese.sign(c, cx, top - 16, "office");
  const r = tileRoof(c, yx, yw, yt, 11, 5);
  const rx0 = r.x0 + r.inset;
  const rx1 = r.x1 - r.inset;
  ridge(c, rx0, rx1, r.yt);
  chidori(c, cx, yt - 1, 9);
  shachi(c, rx0, r.yt, -1);
  shachi(c, rx1, r.yt, 1);
  eaveShadow(c, yx, yw, yt + 2, 1);
}

// ───────────────────────── 城墙：石垣、白土塀与隅橹 ─────────────────────────

function wallBody(c: Canvas, W: number, top: number): void {
  const p = c.p;
  const H = c.gy;
  const s = c.seed;
  // 石垣
  wrapCourses(p, W, top + 9, H - top - 9, K, 5, 5, 11, s, 2);
  // 白土塀：白壁、下缘一道黑木，按宽度取模开狭间
  p.rect(0, top, W, 9, WH[3]);
  p.rect(0, top + 7, W, 2, P.wood[0]);
  p.hline(0, W - 1, top + 6, WH[1]);
  spots(W, 14).forEach((x, i) => wrap(W, (dx) => sama(p, x + dx + 7, top + 2, i)));
  // 瓦顶
  for (let x = 0; x < W; x++) {
    p.put(x, top - 3, K[3]);
    p.put(x, top - 2, x % 3 === 0 ? K[3] : K[2]);
    p.put(x, top - 1, x % 3 === 0 ? K[4] : K[0]);
  }
  c.markRoof(0, top - 3, W, 3, K, 1);
  tintOpaque(p, 0, top, W, 1, overlay.shadow);
}

function wallTower(c: Canvas, x: number, top: number): void {
  const p = c.p;
  // 隅橹：两层白壁，下层压在土塀上，下见板涂黑
  const w = 20;
  const lt = top - 10;
  plaster(p, x, lt, w, 19, WH, x);
  for (let xx = x; xx < x + w; xx++) p.vline(xx, top + 3, top + 8, (xx - x) % 3 === 0 ? P.iron[0] : P.iron[1]);
  p.vline(x, lt, top + 8, WH[4]);
  p.vline(x + w - 1, lt, top + 8, WH[1]);
  sama(p, x + 5, lt + 4, 0);
  p.rect(x + 11, lt + 3, 5, 4, c.o.lit ? P.lamp[1] : ink.brown);
  p.vline(x + 13, lt + 3, lt + 6, W[1]);
  const r1 = tileRoof(c, x, w, lt, 5, 3);
  const ux = x + 4;
  const uw = w - 8;
  const ut = r1.yt - 5;
  plaster(p, ux, ut, uw, r1.yt - ut + 1, WH, x + 1);
  p.rect(ux + 4, ut + 1, 4, 3, c.o.lit ? P.lamp[1] : ink.brown);
  const r2 = tileRoof(c, ux, uw, ut, 5, 3);
  // 小屋脊：一道熨斗瓦，两端各一点鬼瓦
  p.hline(r2.x0 + r2.inset - 1, r2.x1 - r2.inset + 1, r2.yt - 1, K[2]);
  p.set(r2.x0 + r2.inset - 1, r2.yt - 2, K[3]).set(r2.x1 - r2.inset + 1, r2.yt - 2, K[3]);
}

// ───────────────────────── 远景 ─────────────────────────

const FAR = { roof: [K[0], K[1], K[2]], wall: [WH[1], WH[2], WH[3]], accent: [VM[1], VM[2], VM[3]] } as const;

function farHouse(k: FarCtx, x: number, w: number, h: number, seed: number): void {
  const p = k.p;
  const b = k.base;
  const f = k.f;
  const wallTop = b - h;
  p.rect(x, wallTop, w, h, f.wall[1]);
  p.vline(x + w - 1, wallTop, b - 1, f.wall[0]);
  p.vline(x, wallTop, b - 1, f.wall[2]);
  // 底层深色的格子与木板
  const gh = Math.min(h - 2, Math.max(3, Math.round(h * 0.45)));
  p.rect(x, b - gh, w, gh, W[1]);
  for (let xx = x + 1; xx < x + w - 1; xx += 2) p.vline(xx, b - gh + 1, b - 1, W[0]);
  farWindows(k, x, wallTop, w, h - gh, seed);
  // 两层之间的庇
  if (h - gh >= 4) {
    p.hline(x - 1, x + w, b - gh - 1, f.roof[0]);
    p.hline(x, x + w - 1, b - gh - 2, f.roof[1]);
    k.roofs.push([x - 1, b - gh - 2, w + 2, 2]);
  }
  // 灰瓦顶：出檐、两端微翘、平直的厚屋脊与鬼瓦
  const over = 2;
  const rh = Math.max(4, Math.round(w * 0.34));
  const x0 = x - over;
  const x1 = x + w - 1 + over;
  const inset = Math.min(Math.floor((x1 - x0) / 2) - 1, rh + 1);
  const mid = (x0 + x1) / 2;
  for (let xx = x0; xx <= x1; xx++) {
    const d = Math.min(xx - x0, x1 - xx);
    const t = Math.min(1, d / inset);
    const top = wallTop - Math.round(Math.pow(t, 1.4) * rh);
    const lift = d === 0 ? 1 : 0;
    const right = xx > mid && d < inset;
    p.vline(xx, top - lift, wallTop + 1 - lift, right ? f.roof[0] : f.roof[1]);
    if (!right && d < inset) p.set(xx, top - lift, f.roof[2]);
    p.set(xx, wallTop + 1 - lift, f.roof[0]);
  }
  p.hline(x0 + inset - 1, x1 - inset + 1, wallTop - rh - 1, f.roof[2]);
  p.set(x0 + inset - 1, wallTop - rh - 2, f.roof[2]).set(x1 - inset + 1, wallTop - rh - 2, f.roof[2]);
  k.roofs.push([x0, wallTop - rh - 2, x1 - x0 + 1, rh + 3]);
}

/** 远景的天守：三层白壁，层层灰瓦，中层千鸟破风，顶上金鯱。 */
function farCastle(k: FarCtx, x: number): number {
  const p = k.p;
  const b = k.base;
  const f = k.f;
  // 石垣
  p.poly(
    [
      [x, b],
      [x + 3, b - 8],
      [x + 25, b - 8],
      [x + 28, b],
    ],
    K[1],
  );
  p.line(x, b - 1, x + 3, b - 8, K[2]);
  let y = b - 8;
  const widths = [22, 16, 11];
  const cx = x + 14;
  widths.forEach((w, i) => {
    const hh = i === 0 ? 9 : 7;
    const wx = cx - Math.floor(w / 2);
    p.rect(wx, y - hh, w, hh, f.wall[2]);
    p.vline(wx + w - 1, y - hh, y - 1, f.wall[0]);
    k.lights.push([cx - 2, y - Math.floor(hh / 2)], [cx + 2, y - Math.floor(hh / 2)]);
    p.set(cx - 2, y - Math.floor(hh / 2), f.wall[0]).set(cx + 2, y - Math.floor(hh / 2), f.wall[0]);
    y -= hh;
    const ow = w + 6;
    const ox = cx - Math.floor(ow / 2);
    p.hline(ox, ox + ow - 1, y, f.roof[1]);
    p.hline(ox + 1, ox + ow - 2, y - 1, f.roof[1]);
    p.hline(ox + 2, ox + ow - 3, y - 2, f.roof[2]);
    p.set(ox, y - 1, f.roof[2]).set(ox + ow - 1, y - 1, f.roof[0]);
    if (i === 1) {
      // 千鸟破风
      p.set(cx, y - 4, f.roof[2]).hline(cx - 1, cx + 1, y - 3, f.roof[2]);
      p.hline(cx - 2, cx + 2, y - 2, f.wall[2]);
    }
    k.roofs.push([ox, y - 2, ow, 3]);
    y -= 2;
  });
  p.hline(cx - 3, cx + 3, y, f.roof[2]);
  p.set(cx - 3, y - 1, P.gold[2]).set(cx + 3, y - 1, P.gold[2]);
  return 29;
}

/** 远景的五重塔：细高的塔身，五层几乎同宽的灰瓦檐，顶上相轮。 */
function farPagoda(k: FarCtx, x: number): number {
  const p = k.p;
  const b = k.base;
  const f = k.f;
  const cx = x + 9;
  let y = b;
  for (let i = 0; i < 5; i++) {
    const bw = 9 - Math.floor(i / 2);
    const hh = i === 0 ? 8 : 6;
    p.rect(cx - Math.floor(bw / 2), y - hh, bw, hh, f.accent[0]);
    p.vline(cx - Math.floor(bw / 2), y - hh, y - 1, f.accent[1]);
    k.lights.push([cx, y - 3]);
    y -= hh;
    const ow = 19 - i;
    const ox = cx - Math.floor(ow / 2);
    p.hline(ox, ox + ow - 1, y, f.roof[1]);
    p.set(ox, y - 1, f.roof[2]).set(ox + ow - 1, y - 1, f.roof[1]);
    p.hline(ox + 2, ox + ow - 3, y - 1, f.roof[1]);
    p.hline(ox + 3, ox + ow - 4, y - 2, f.roof[2]);
    k.roofs.push([ox, y - 2, ow, 3]);
    y -= 2;
  }
  p.vline(cx, y - 12, y, P.gold[1]);
  for (let yy = y - 10; yy < y; yy += 2) p.hline(cx - 1, cx + 1, yy, P.gold[2]);
  return 20;
}

/** 远景的朱红鸟居：两根柱、贯与上翘的笠木。底在 b。 */
function farTorii(p: Px, x: number, b: number, f: { accent: readonly string[] }): number {
  const A = f.accent;
  p.vline(x + 2, b - 12, b - 1, A[1]);
  p.vline(x + 10, b - 12, b - 1, A[1]);
  p.hline(x + 1, x + 11, b - 10, A[1]);
  p.hline(x, x + 12, b - 13, A[2]);
  p.hline(x - 1, x + 13, b - 14, ink.deep);
  p.set(x - 2, b - 15, ink.deep).set(x + 14, b - 15, ink.deep);
  p.vline(x + 6, b - 13, b - 10, A[1]);
  return 15;
}

function farTower(k: FarCtx, x: number, seed: number): number {
  const r = h01(seed, 11, 1);
  if (r < 0.45) return farCastle(k, x);
  const used = farPagoda(k, x);
  if (r < 0.8) return used + farTorii(k.p, x + used + 1, k.base, k.f) + 1;
  return used;
}

function farWall(k: FarCtx, top: number): void {
  const p = k.p;
  const W = k.W;
  // 石垣上的白土塀与瓦顶
  p.rect(0, top, W, 8, WH[2]);
  p.rect(0, top + 4, W, 4, K[1]);
  for (let x = 0; x < W; x += 3) p.put(x, top + 5 + (x % 2), K[2]);
  for (let x = 0; x < W; x++) {
    p.put(x, top - 1, x % 3 === 0 ? K[3] : K[2]);
    p.put(x, top, x % 3 === 0 ? K[2] : K[0]);
  }
  k.roofs.push([0, top - 1, W, 2]);
}

// ───────────────────────── 街道小物件 ─────────────────────────

/** 辻行灯：木柱上一只方形纸灯箱，顶上一道小瓦檐。 */
function lamp(c: Canvas): void {
  const p = c.p;
  const g = c.gy;
  const lit = c.o.lit;
  p.rect(3, g - 3, 7, 3, K[2]);
  p.hline(3, 9, g - 3, K[3]);
  p.rect(5, g - 18, 3, 15, W[2]);
  p.vline(5, g - 18, g - 4, W[3]);
  p.vline(7, g - 18, g - 4, W[1]);
  // 灯箱
  p.rect(2, g - 27, 9, 9, W[0]);
  p.rect(3, g - 26, 7, 7, lit ? P.lamp[2] : P.paper);
  if (!lit) {
    p.vline(9, g - 26, g - 20, P.parchment);
    p.hline(3, 9, g - 20, P.parchment);
  } else p.vline(9, g - 26, g - 20, P.lamp[1]);
  p.vline(6, g - 26, g - 20, lit ? P.lamp[1] : P.parchmentDark);
  // 小瓦檐
  p.hline(0, 12, g - 28, K[2]);
  p.hline(1, 11, g - 29, K[3]);
  p.set(0, g - 29, K[3]).set(12, g - 29, K[3]);
  p.set(6, g - 30, K[3]);
  if (lit) tintOpaque(p, 0, g - 31, 13, 14, overlay.glow, 2);
}

/** 吊桶井：木井栏、两根柱与横梁上的滑车，顶上一座小小的灰瓦切妻。 */
function well(c: Canvas): void {
  const p = c.p;
  const g = c.gy;
  for (let x = 3; x < 19; x++) p.vline(x, g - 7, g - 1, (x - 3) % 3 === 0 ? W[1] : (x - 3) % 3 === 1 ? W[3] : W[2]);
  p.hline(2, 19, g - 8, W[3]);
  p.hline(2, 19, g - 4, W[1]);
  p.rect(3, g - 22, 2, 14, W[2]);
  p.rect(17, g - 22, 2, 14, W[1]);
  p.hline(3, 18, g - 20, W[3]);
  p.circle(11, g - 19, 1, P.iron[2]);
  p.vline(10, g - 18, g - 12, P.straw[1]);
  p.rect(8, g - 12, 5, 3, W[2]);
  p.hline(8, 12, g - 12, W[3]);
  // 小屋顶
  for (let i = 0; i < 4; i++) p.hline(1 + i, 20 - i, g - 23 - i, i === 3 ? K[3] : i === 0 ? K[1] : K[2]);
  p.set(0, g - 23, K[2]).set(21, g - 23, K[2]);
  p.hline(4, 17, g - 27, K[3]);
  p.set(4, g - 28, K[3]).set(17, g - 28, K[3]);
}

/** 床几：铺红毡的矮木凳。 */
function bench(p: Px): void {
  const g = p.h;
  p.rect(1, g - 6, 16, 2, P.red[2]);
  p.hline(1, 16, g - 6, P.red[3]);
  p.set(1, g - 4, P.red[1]).set(16, g - 4, P.red[1]);
  p.hline(1, 16, g - 4, W[1]);
  for (const x of [2, 14]) p.rect(x, g - 3, 2, 3, W[1]);
  p.hline(3, 14, g - 2, W[2]);
}

/** 大八车：一对大木轮、长木板车台与车把；装米俵（或盖着草席的酒樽）。 */
function cart(p: Px, v: number): void {
  const g = p.h;
  p.rect(2, g - 9, 22, 3, W[2]);
  p.hline(2, 23, g - 9, W[3]);
  p.hline(2, 23, g - 7, W[1]);
  p.line(24, g - 8, 29, g - 6, W[1]);
  p.line(24, g - 9, 29, g - 7, W[3]);
  if (v % 2 === 0) {
    // 米俵：草色的圆筒，两道绳箍
    for (const [x, y] of [
      [4, g - 13],
      [12, g - 13],
      [8, g - 17],
    ] as const) {
      p.rect(x, y, 8, 4, P.straw[2]);
      p.hline(x, x + 7, y, P.straw[3]);
      p.hline(x, x + 7, y + 3, P.straw[1]);
      p.vline(x + 2, y, y + 3, P.straw[0]);
      p.vline(x + 5, y, y + 3, P.straw[0]);
      p.vline(x, y + 1, y + 2, P.straw[1]);
    }
  } else {
    // 酒樽：裹着草席的木桶
    for (const x of [4, 13]) {
      p.rect(x, g - 16, 8, 7, P.straw[2]);
      p.hline(x, x + 7, g - 16, W[3]);
      p.hline(x, x + 7, g - 13, P.straw[0]);
      p.vline(x, g - 15, g - 10, P.straw[3]);
      p.rect(x + 2, g - 15, 3, 2, P.red[2]);
    }
  }
  // 大轮
  p.ring(9, g - 5, 4, 4, W[1]);
  p.ring(9, g - 5, 3, 3, W[3]);
  for (const [dx, dy] of [
    [0, -3],
    [0, 3],
    [-3, 0],
    [3, 0],
    [2, 2],
    [-2, -2],
  ] as const) p.line(9, g - 5, 9 + dx, g - 5 + dy, W[2]);
  p.set(9, g - 5, P.iron[2]);
}

export const JAPANESE: CultureArt = {
  kit: japanese,
  landmark,
  gate,
  wallBody,
  wallTower,
  far: { roof: FAR.roof, wall: FAR.wall, accent: FAR.accent },
  farHouse,
  farTower,
  farWall,
  props: {
    flag: [AI[1], AI[2], AI[3]],
    stall: [AI, P.cloth.cream],
    lamp,
    well,
    bench,
    cart,
  },
};
