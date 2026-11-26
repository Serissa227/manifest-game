// 海图上的地点标记：港口、内陆城市（七种建筑风格）、殖民点（未开拓 / 势力占领 / 已建殖民地）与发现物。
// 每种标记都有“未探索”的草图版本（羊皮纸上的墨线）。全部是纯函数，结果按参数记忆化。
import { styleOf, type ArchStyle } from "../buildings";
import { P, ink } from "../palette";
import { Px, luma, rgba } from "../px";
import { memo } from "../render";
import type { DiscoveryKind, SiteMark } from "./types";

interface TownPal {
  wall: string;
  wallShade: string;
  roof: string;
  roofLight: string;
  roofShade: string;
  /** 城墙（内陆城市）的石料色阶（5 阶） */
  stone: readonly string[];
}

const PLASTER5 = [P.plaster[0], P.plaster[1], P.plaster[2], P.plaster[3], P.white];

function townPal(style: ArchStyle): TownPal {
  switch (style) {
    case "nordic":
      return { wall: P.wood[3], wallShade: P.wood[2], roof: P.slate[3], roofLight: P.slate[4], roofShade: P.slate[2], stone: P.stone };
    case "lowland":
      return { wall: P.brick[3], wallShade: P.brick[2], roof: P.brick[2], roofLight: P.brick[4], roofShade: P.brick[1], stone: P.brick };
    case "desert":
      return { wall: P.sand[4], wallShade: P.sand[3], roof: P.teal[3], roofLight: P.teal[4], roofShade: P.teal[2], stone: P.sand };
    case "islands":
      return { wall: P.wood[4], wallShade: P.wood[3], roof: P.straw[2], roofLight: P.straw[3], roofShade: P.straw[1], stone: P.wood };
    case "eastern":
      return { wall: P.plaster[3], wallShade: P.plaster[2], roof: P.jade[2], roofLight: P.jade[4], roofShade: P.jade[1], stone: P.stone };
    case "frontier":
      return { wall: P.wood[3], wallShade: P.wood[2], roof: P.wood[1], roofLight: P.wood[2], roofShade: P.wood[0], stone: P.wood };
    default:
      // 地中海：白墙红瓦
      return { wall: P.white, wallShade: P.plaster[2], roof: P.brick[3], roofLight: P.brick[4], roofShade: P.brick[2], stone: PLASTER5 };
  }
}

/** 屋顶：画在墙顶 y 之上、宽 w 的房子上方。各风格的屋顶一眼可辨。 */
function roof(p: Px, style: ArchStyle, x: number, y: number, w: number, pal: TownPal): void {
  const mid = x + (w - 1) / 2;
  switch (style) {
    case "desert": {
      // 圆顶，顶上一颗金尖
      const rx = (w - 1) / 2;
      for (let r = 0; r < 3; r++) {
        const half = Math.round(rx * Math.sqrt(1 - ((2 - r) / 3) ** 2));
        const yy = y - 3 + r;
        p.hline(Math.round(mid - half), Math.round(mid), yy, r === 0 ? pal.roofLight : pal.roof);
        p.hline(Math.round(mid) + 1, Math.round(mid + half), yy, pal.roofShade);
      }
      p.set(Math.round(mid), y - 4, P.gold[3]);
      break;
    }
    case "eastern": {
      // 翘角屋檐：宽出墙面、两端上翘
      p.hline(x - 1, x + w, y - 1, pal.roof);
      p.set(x - 2, y - 2, pal.roof).set(x + w + 1, y - 2, pal.roofShade);
      p.hline(x, x + w - 1, y - 2, pal.roofLight);
      p.hline(x + 1, x + w - 2, y - 3, pal.roof);
      p.set(x + w - 2, y - 3, pal.roofShade).set(x + w - 1, y - 2, pal.roofShade);
      p.hline(x - 1, x + w, y, pal.roofShade);
      break;
    }
    case "mediterranean": {
      // 平缓的红陶瓦四坡顶：出檐一像素，瓦垄一明一暗
      for (let r = 0; r < 2; r++) {
        const yy = y - 2 + r;
        const x0 = x - r + (r === 0 ? 1 : 0);
        const x1 = x + w - 1 + r - (r === 0 ? 1 : 0);
        for (let xx = x0; xx <= x1; xx++) p.set(xx, yy, xx > mid ? pal.roofShade : (xx - x0) % 2 === 0 ? pal.roofLight : pal.roof);
      }
      p.hline(x - 1, x + w, y, pal.roofShade);
      break;
    }
    default: {
      // 三角山墙屋顶（北地与开拓者更陡，群岛是厚茅草）
      const steep = style === "nordic" || style === "frontier" ? 4 : 3;
      const over = style === "islands" ? 1 : 0;
      for (let r = 0; r < steep; r++) {
        const half = Math.round(((r + 1) / steep) * ((w + 1) / 2)) + (r === steep - 1 ? over : 0);
        const yy = y - steep + r;
        p.hline(Math.round(mid - half), Math.round(mid), yy, r === 0 ? pal.roofLight : pal.roof);
        p.hline(Math.round(mid) + 1, Math.round(mid + half), yy, pal.roofShade);
      }
      if (style === "nordic") p.set(Math.round(mid) + 2, y - steep, P.stone[2]).set(Math.round(mid) + 2, y - steep - 1, P.stone[2]);
      if (style === "frontier") p.set(Math.round(mid) + 2, y - steep, P.stone[3]).set(Math.round(mid) + 2, y - steep - 1, P.stone[2]);
    }
  }
}

/** 房子：左上角 (x, y)，宽 w、高 h（不含屋顶）。 */
function house(p: Px, style: ArchStyle, x: number, y: number, w: number, h: number, pal: TownPal, door: boolean) {
  p.rect(x, y, w, h, pal.wall);
  p.vline(x + w - 1, y, y + h - 1, pal.wallShade);
  p.hline(x, x + w - 1, y, pal.wallShade);
  if (style === "islands") {
    // 高脚屋：墙下露出木桩
    p.rect(x, y + h - 1, w, 1, null);
    p.set(x, y + h - 1, P.wood[1]).set(x + w - 1, y + h - 1, P.wood[1]);
  }
  if (style === "frontier") {
    // 原木墙：一道道横向的木缝
    for (let yy = y + 2; yy < y + h; yy += 2) p.hline(x, x + w - 2, yy, pal.wallShade);
  }
  if (door) p.rect(x + Math.floor(w / 2), y + h - 3, 1, style === "islands" ? 2 : 3, P.wood[0]);
  if (h >= 4) p.set(x + 1, y + 2, P.lamp[1]);
  if (h >= 6) p.set(x + w - 3, y + 2, P.lamp[1]).set(x + 1, y + 4, P.lamp[1]);
  roof(p, style, x, y, w, pal);
}

/** 旗杆与旗：(x, y) 为旗杆底部，旗面 5×3，右下角被风吹起。 */
function flagpole(p: Px, x: number, y: number, h: number, flag: string, shade: string) {
  p.vline(x, y - h + 1, y, P.wood[1]);
  const top = y - h + 1;
  p.rect(x + 1, top, 5, 3, flag);
  p.hline(x + 1, x + 5, top + 2, shade);
  p.set(x + 5, top + 2, null);
  p.set(x + 1, top, lighter(flag));
  p.set(x, top - 1, P.gold[3]);
}

/** 未探索地点的“草图”版本：同样的轮廓与结构，用羊皮纸上的墨色（按明暗分三阶）描出。 */
function sketch(src: Px): Px {
  const p = new Px(src.w, src.h);
  for (let y = 0; y < src.h; y++) {
    for (let x = 0; x < src.w; x++) {
      const v = src.get(x, y);
      if (!(v & 0xff)) continue;
      const l = luma(v);
      // 草图用深一档的墨色（最深处是深褐），在浅色的羊皮纸云上也看得清
      p.put(x, y, l < 90 ? P.wood[0] : l < 150 ? P.parchmentDeep : l < 205 ? P.parchmentDark : P.parchment);
    }
  }
  return p;
}

function scale(c: string, k: number): string {
  const v = rgba(c);
  const f = (s: number) => Math.max(0, Math.min(255, Math.round(((v >>> s) & 0xff) * k)));
  return `#${[f(24), f(16), f(8)].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
}
const darker = (c: string) => scale(c, 0.62);
const lighter = (c: string) => scale(c, 1.3);

/** 港口标记：码头上的两栋房子、飘着势力旗，码头边系着一条小帆船，19×20。unknown 为未探索时的草图版本。 */
export function drawPortMarker(style: ArchStyle, flag: string, opts: { unknown?: boolean } = {}): Px {
  return memo(`mk-port:${style}:${flag}:${opts.unknown ? 1 : 0}`, () => {
    const pal = townPal(style);
    const p = new Px(17, 18);
    // 码头：石砌（开拓者是木栈桥）与木桩
    const deck = style === "frontier" ? P.wood : P.stone;
    p.rect(0, 15, 12, 2, deck[3]);
    p.hline(0, 11, 16, deck[2]);
    p.hline(0, 11, 15, deck[4]);
    for (const x of [1, 6, 10]) p.set(x, 17, P.wood[1]);
    // 高楼（带旗）与矮房；地中海的高楼是带拱窗的钟楼
    if (style === "mediterranean") {
      p.rect(2, 6, 4, 9, pal.wall);
      p.vline(5, 6, 14, pal.wallShade);
      p.set(3, 8, ink.deep).set(4, 8, ink.deep).set(3, 7, P.gold[2]);
      p.set(3, 11, P.lamp[1]);
      p.hline(1, 6, 5, pal.roofShade).hline(2, 5, 4, pal.roof).hline(3, 4, 3, pal.roofLight);
      flagpole(p, 3, 2, 4, flag, darker(flag));
    } else {
      house(p, style, 1, 8, 6, 7, pal, false);
      flagpole(p, 2, 6, 6, flag, darker(flag));
    }
    house(p, style, 7, 11, 5, 4, pal, true);
    // 码头边的小帆船
    p.hline(12, 16, 15, P.wood[3]);
    p.hline(13, 15, 16, P.wood[1]);
    p.vline(14, 9, 14, P.wood[1]);
    p.stamp(["w..", "ww.", "www", "wws"], { w: P.white, s: P.plaster[2] }, 15, 10);
    const done = p.outlined(ink.brown);
    return opts.unknown ? sketch(done) : done;
  });
}

/**
 * 小地点的圆点（M01）：带描边的 5×5 小点——港口是圆点、城市是方点、殖民点是菱形，中间是势力色。
 * 大地图的远档上港口挤在一起时，排在后面的只画这个点（不再整个标记互相盖住）；unknown 为未到访的草图色。
 */
export function drawPlaceDot(kind: "port" | "city" | "site", flag: string, opts: { unknown?: boolean } = {}): Px {
  return memo(`mk-dot:${kind}:${flag}:${opts.unknown ? 1 : 0}`, () => {
    const p = new Px(5, 5);
    const rows =
      kind === "city"
        ? ["eeeee", "ehffe", "efffe", "efffe", "eeeee"]
        : kind === "site"
          ? ["..e..", ".ehe.", "efffe", ".efe.", "..e.."]
          : [".eee.", "ehffe", "efffe", "efffe", ".eee."];
    const fill = opts.unknown ? P.parchmentDark : flag;
    p.stamp(rows, { e: opts.unknown ? P.parchmentDeep : ink.deep, f: fill, h: opts.unknown ? P.parchment : lighter(fill) });
    return p;
  });
}

/** 内陆城市标记：带垛口的城墙（开拓者是木栅栏）、两座角楼、城门与主楼上的势力旗，19×20。 */
export function drawCityMarker(style: ArchStyle, flag: string, opts: { unknown?: boolean } = {}): Px {
  return memo(`mk-city:${style}:${flag}:${opts.unknown ? 1 : 0}`, () => {
    const pal = townPal(style);
    const s = pal.stone;
    const p = new Px(17, 18);
    // 主楼（城内）
    house(p, style, 5, 8, 7, 4, pal, false);
    flagpole(p, 8, 5, 5, flag, darker(flag));
    if (style === "frontier") {
      // 木栅栏：一根根削尖的原木，中间是木门
      for (let x = 0; x < 17; x++) {
        const top = x % 2 === 0 ? 11 : 12;
        p.vline(x, top, 17, x % 2 === 0 ? P.wood[3] : P.wood[2]);
        p.set(x, top, P.wood[4]);
      }
      p.hline(0, 16, 14, P.wood[1]);
      p.rect(7, 13, 3, 5, P.wood[0]);
      p.vline(8, 13, 17, P.wood[1]);
      // 两侧瞭望塔
      for (const x of [0, 13]) {
        p.rect(x, 7, 4, 4, P.wood[2]);
        p.hline(x - 1, x + 4, 6, P.wood[1]);
        p.set(x + 1, 8, ink.deep);
        p.vline(x, 11, 17, P.wood[1]).vline(x + 3, 11, 17, P.wood[1]);
      }
    } else {
      // 城墙：顶面亮、墙面中、底部暗，垛口交错
      p.rect(0, 12, 17, 6, s[3]);
      p.hline(0, 16, 12, s[4]);
      p.rect(0, 16, 17, 2, s[2]);
      for (let x = 1; x < 17; x += 3) p.set(x, 11, s[3]).set(x + 1, 11, s[4]);
      // 城门（拱门）
      p.rect(7, 14, 3, 4, P.wood[0]);
      p.set(8, 13, P.wood[0]);
      // 两侧角楼
      for (const x of [0, 13]) {
        p.rect(x, 8, 4, 5, s[3]);
        p.vline(x + 3, 8, 12, s[2]);
        p.set(x, 7, s[4]).set(x + 2, 7, s[4]);
        p.set(x + 1, 10, ink.deep);
      }
      if (style === "mediterranean") {
        // 角楼顶上的红瓦尖顶
        for (const x of [0, 13]) p.hline(x, x + 3, 7, P.brick[3]).hline(x + 1, x + 2, 6, P.brick[4]);
      }
    }
    const done = p.outlined(ink.brown);
    return opts.unknown ? sketch(done) : done;
  });
}

/** 由势力 key（及势力数据的 style 字段）取港口与城市标记的风格，规则同 styleOf。 */
export function markerStyle(factionKey: string | undefined, style?: string | null): ArchStyle {
  return styleOf(factionKey, style);
}

// ───────────────────────────── 殖民点 ─────────────────────────────

/** 主角的旗色（殖民地、舰队）。 */
export const PLAYER_FLAG = P.gold[3];

/** 殖民点标记的记忆化键（用于渲染器的纹理缓存）。 */
export function siteMarkKey(mark: SiteMark = {}, unknown = false): string {
  const kind = mark.colony ? `c${mark.colony.flag}${Math.max(0, Math.min(2, mark.colony.size ?? 0))}` : mark.claim ? `f${mark.claim}` : "w";
  return `mk-site:${kind}:${unknown ? 1 : 0}`;
}

/** 殖民点下方的一小片海滩与浪花（画在 17×18 画布的底部）。 */
function beach(p: Px) {
  p.hline(4, 11, 13, P.sand[4]);
  p.hline(2, 13, 14, P.sand[4]);
  p.hline(13, 13, 14, P.sand[3]);
  p.hline(1, 14, 15, P.sand[3]);
  p.hline(2, 13, 16, P.sand[2]);
  // 浪花：海滩外缘的白浪
  for (const x of [1, 2, 5, 6, 7, 10, 11, 14]) p.set(x, 17, P.foam);
  p.set(0, 16, P.foam).set(15, 16, P.foam);
}

/** 原木小屋：左下角墙脚 (x, y)（y 为墙底行），宽 w，墙高 h。 */
function cabin(p: Px, x: number, y: number, w: number, h: number) {
  const top = y - h + 1;
  // 浅色的原木墙（一道道木缝）与深色的木瓦屋顶，一眼能和船身区分开
  p.rect(x, top, w, h, P.wood[4]);
  for (let yy = top + 1; yy <= y; yy += 2) p.hline(x, x + w - 1, yy, P.wood[3]);
  p.vline(x + w - 1, top, y, P.wood[2]);
  p.vline(x + Math.floor(w / 2), y - 1, y, P.wood[0]);
  if (w >= 5) p.set(x + 1, top + 1, P.lamp[1]);
  const mid = x + (w - 1) / 2;
  for (let r = 0; r < 3; r++) {
    const half = Math.round(((r + 1) / 3) * ((w + 1) / 2)) + (r === 2 ? 1 : 0);
    const yy = top - 3 + r;
    p.hline(Math.round(mid - half), Math.round(mid), yy, r === 0 ? P.brick[2] : P.brick[1]);
    p.hline(Math.round(mid) + 1, Math.round(mid + half), yy, P.brick[0]);
  }
  // 烟囱与一缕炊烟
  const cx = Math.round(mid) + 2;
  p.set(cx, top - 3, P.stone[2]).set(cx, top - 4, P.stone[3]);
  p.set(cx, top - 6, P.snow[1]).set(cx + 1, top - 7, P.snow[2]);
}

/** 殖民地的菜地：几行作物。(x, y) 为左上角。 */
function plot(p: Px, x: number, y: number, w: number) {
  p.rect(x, y, w, 2, P.wood[2]);
  for (let k = 0; k < w; k += 2) p.set(x + k, y, P.leaf[3]).set(x + k + 1, y + 1, P.leaf[4]);
}

/** 问号小旗：旗杆底部 (x, y)。 */
function questionFlag(p: Px, x: number, y: number) {
  p.vline(x, y - 11, y, P.wood[1]);
  p.set(x, y - 12, P.gold[3]);
  // 白旗（燕尾），上面一个红色问号
  p.rect(x + 1, y - 11, 6, 7, P.white);
  p.vline(x + 6, y - 11, y - 5, P.plaster[2]);
  p.hline(x + 1, x + 6, y - 5, P.plaster[2]);
  p.set(x + 6, y - 8, null);
  p.stamp(["xx.", "..x", ".x.", "...", ".x."], { x: P.red[2] }, x + 2, y - 10);
}

/**
 * 殖民点标记（19×20，码头位置与港口标记相同：底部的海滩压在锚地格上）：
 * 未开拓——海滩与问号小旗；被势力占领——海滩、帐篷与势力色小旗；
 * 已建殖民地——原木小屋（规模越大屋子越多，并有木栅栏与瞭望塔）与所有者的旗。
 */
export function drawSiteMarker(mark: SiteMark = {}, opts: { unknown?: boolean } = {}): Px {
  return memo(siteMarkKey(mark, opts.unknown), () => {
    const p = new Px(17, 18);
    beach(p);
    if (mark.colony) {
      const size = Math.max(0, Math.min(2, mark.colony.size ?? 0));
      const flag = mark.colony.flag;
      // 空地上的草皮
      p.hline(3, 12, 13, P.leaf[3]);
      p.hline(4, 11, 12, P.leaf[2]);
      if (size >= 2) {
        // 瞭望塔与两侧削尖的木栅栏
        p.rect(0, 3, 4, 3, P.wood[2]);
        p.hline(0, 3, 3, P.wood[3]);
        p.hline(-1, 4, 2, P.brick[1]);
        p.set(1, 4, ink.deep);
        p.vline(0, 6, 14, P.wood[1]).vline(3, 6, 14, P.wood[1]);
        p.set(1, 9, P.wood[1]).set(2, 11, P.wood[1]);
        for (const x of [14, 15]) p.vline(x, x === 14 ? 9 : 10, 14, x === 14 ? P.wood[3] : P.wood[2]);
      }
      if (size === 0) {
        cabin(p, 2, 13, 6, 4);
        plot(p, 1, 14, 5);
      } else {
        cabin(p, size >= 2 ? 5 : 1, 13, 5, 4);
        cabin(p, size >= 2 ? 10 : 7, 12, 4, 3);
        if (size === 1) plot(p, 7, 14, 5);
      }
      flagpole(p, size >= 2 ? 12 : size === 1 ? 12 : 10, size >= 2 ? 8 : 13, size >= 2 ? 7 : 11, flag, darker(flag));
    } else if (mark.claim) {
      // 帐篷与势力旗
      p.poly(
        [
          [2, 13.5],
          [5.5, 7.5],
          [9, 13.5],
        ],
        P.plaster[3],
      );
      p.poly(
        [
          [5.5, 7.5],
          [9, 13.5],
          [6, 13.5],
        ],
        P.plaster[2],
      );
      p.vline(5, 11, 13, P.wood[0]).vline(6, 12, 13, P.wood[0]);
      p.set(5, 7, P.wood[1]).set(6, 6, P.wood[1]);
      const flag = mark.claim;
      p.vline(11, 2, 13, P.wood[1]);
      p.set(11, 1, P.gold[3]);
      p.rect(12, 2, 5, 4, flag);
      p.hline(12, 16, 5, darker(flag));
      p.set(12, 2, lighter(flag));
      p.set(16, 5, null);
    } else {
      // 灌木与问号小旗
      p.stamp([".oo.", "ohmo", "omdo", ".oo."], { o: P.leaf[1], h: P.leaf[4], m: P.leaf[3], d: P.leaf[2] }, 2, 10);
      questionFlag(p, 8, 13);
    }
    const done = p.outlined(ink.brown);
    return opts.unknown ? sketch(done) : done;
  });
}

// ───────────────────────────── 发现物 ─────────────────────────────

/** 发现物图标（17×17）：羊皮纸圆章上画着遗迹、奇观、沉船、遗物、海兽或地标。未知种类画一颗星。 */
export function drawDiscoveryMarker(kind: DiscoveryKind | string): Px {
  return memo(`mk-disc:${kind}`, () => {
    const p = new Px(15, 15);
    // 圆章：金边、羊皮纸底
    p.circle(7, 7, 7, P.gold[1]);
    p.circle(7, 7, 6, P.paper);
    p.ring(7, 7, 6, 6, P.parchment);
    p.set(4, 3, P.white).set(3, 4, P.white);
    switch (kind) {
      case "ruins": {
        // 两根古柱（一根折断）、残存的横梁与碎石
        p.hline(2, 12, 11, P.stone[2]).hline(3, 11, 12, P.stone[1]);
        p.rect(4, 5, 2, 6, P.stone[3]);
        p.vline(5, 5, 10, P.stone[2]);
        p.hline(3, 7, 4, P.stone[4]).hline(3, 7, 3, P.stone[3]);
        p.rect(9, 7, 2, 4, P.stone[3]);
        p.vline(10, 7, 10, P.stone[2]);
        p.set(9, 6, P.stone[3]).set(11, 10, P.stone[2]).set(8, 10, P.stone[2]);
        break;
      }
      case "wonder": {
        // 星辉晶簇：中间一根高的晶柱，两侧小晶体，周围闪光
        p.poly(
          [
            [7.5, 1.5],
            [9.5, 5],
            [9.5, 11.5],
            [5.5, 11.5],
            [5.5, 5],
          ],
          P.teal[3],
        );
        p.vline(6, 5, 11, P.teal[4]).vline(9, 5, 11, P.teal[2]);
        p.set(7, 2, P.white).set(7, 3, P.teal[4]);
        p.poly(
          [
            [4, 6],
            [5.5, 8],
            [5.5, 11.5],
            [2.5, 11.5],
            [2.5, 8],
          ],
          P.teal[2],
        );
        p.poly(
          [
            [11, 7],
            [12.5, 9],
            [12.5, 11.5],
            [9.5, 11.5],
            [9.5, 9],
          ],
          P.teal[2],
        );
        p.set(3, 8, P.teal[4]).set(10, 9, P.teal[4]);
        p.hline(3, 11, 12, P.stone[2]);
        p.set(2, 3, P.lamp[2]).set(12, 3, P.lamp[2]).set(12, 5, P.white);
        break;
      }
      case "wreck": {
        // 半沉的船体与折断的桅杆
        p.rect(2, 10, 11, 3, P.sea[3]);
        p.hline(2, 12, 10, P.sea[4]);
        p.poly(
          [
            [2.5, 7.5],
            [9.5, 9.5],
            [8.5, 11.5],
            [3.5, 10.5],
          ],
          P.wood[2],
        );
        p.line(3, 8, 9, 10, P.wood[3]);
        p.line(6, 9, 9, 3, P.wood[1]);
        p.stamp(["ww.", "w.w", ".w."], { w: P.plaster[2] }, 8, 4);
        p.set(11, 11, P.foam).set(4, 12, P.foam);
        break;
      }
      case "relic": {
        // 金色圣杯，杯身嵌一颗红宝石
        p.rect(4, 3, 7, 4, P.gold[3]);
        p.hline(4, 10, 3, P.gold[4]);
        p.vline(10, 3, 6, P.gold[1]);
        p.hline(5, 9, 7, P.gold[2]);
        p.set(7, 5, P.red[3]).set(7, 4, P.red[4]);
        p.rect(7, 8, 1, 2, P.gold[2]);
        p.hline(5, 9, 10, P.gold[3]).hline(4, 10, 11, P.gold[1]);
        p.set(5, 4, P.white).set(12, 2, P.lamp[2]).set(2, 8, P.lamp[2]);
        break;
      }
      case "beast": {
        // 海兽：从浪里拱起的两道身躯与抬起的头
        p.rect(2, 10, 11, 3, P.sea[3]);
        p.hline(2, 12, 10, P.sea[4]);
        const body = P.jade[2];
        const belly = P.jade[3];
        p.ring(4, 10, 2, 2, body).hline(3, 5, 8, belly);
        p.ring(8, 10, 2, 2, body).hline(7, 9, 8, belly);
        p.rect(10, 5, 2, 5, body);
        p.rect(10, 4, 3, 2, body);
        p.set(12, 4, P.red[3]).set(13, 5, body);
        p.set(9, 5, P.jade[1]).set(9, 7, P.jade[1]);
        p.hline(2, 12, 11, P.sea[3]);
        p.set(3, 11, P.foam).set(11, 11, P.foam);
        break;
      }
      case "landmark": {
        // 天然石拱：拱门下透出天光，顶上长着草
        p.rect(3, 4, 9, 8, P.stone[3]);
        p.rect(6, 7, 3, 5, P.paper);
        p.hline(6, 8, 6, P.stone[2]);
        p.vline(11, 4, 11, P.stone[2]).vline(3, 4, 11, P.stone[4]);
        p.hline(3, 11, 3, P.leaf[3]).hline(4, 10, 2, P.leaf[4]);
        p.hline(2, 12, 12, P.stone[1]);
        break;
      }
      case "animal": {
        // 珍禽：站在草地上的胖身子大鸟（渡渡鸟一类），弯喙、短腿
        p.hline(2, 12, 12, P.leaf[2]).hline(3, 11, 11, P.leaf[3]);
        p.rect(3, 6, 7, 4, P.stone[2]);
        p.hline(4, 8, 9, P.stone[3]).set(3, 6, P.stone[3]);
        p.rect(8, 3, 3, 3, P.stone[2]);
        p.set(9, 4, P.stone[0]);
        p.hline(11, 12, 4, P.gold[2]).set(12, 5, P.gold[1]);
        p.set(2, 6, P.plaster[3]).set(2, 7, P.plaster[3]);
        p.vline(5, 10, 11, P.gold[1]).vline(7, 10, 11, P.gold[1]);
        break;
      }
      case "plant": {
        // 珍木：一根枝条、三片叶子、顶上结一颗果荚
        p.hline(3, 11, 12, P.wood[2]);
        p.vline(7, 4, 11, P.leaf[1]);
        p.rect(3, 5, 4, 2, P.leaf[3]).set(3, 5, P.leaf[4]);
        p.rect(8, 7, 4, 2, P.leaf[2]).set(11, 7, P.leaf[4]);
        p.rect(3, 9, 4, 2, P.leaf[2]);
        p.rect(6, 2, 3, 2, P.autumn[2]).set(6, 2, P.autumn[3]);
        break;
      }
      case "fallen": {
        // 天降石：斜着划下的火尾，落进地上的一块黑石
        for (let i = 0; i < 6; i++) p.set(2 + i, 2 + i, i < 2 ? P.lamp[2] : i < 4 ? P.lamp[1] : P.gold[2]);
        p.set(3, 2, P.lamp[2]).set(2, 3, P.lamp[2]).set(5, 4, P.gold[3]).set(4, 5, P.gold[3]);
        p.hline(3, 12, 12, P.sand[2]);
        p.rect(8, 8, 4, 4, P.slate[1]);
        p.hline(8, 11, 8, P.slate[2]).set(8, 8, P.slate[3]);
        p.set(12, 9, P.gold[3]).set(7, 11, P.gold[3]);
        break;
      }
      case "phantom": {
        // 幻岛：雾里若有若无的岛与城楼，轮廓只画一半
        p.hline(2, 12, 10, P.sky[3]).hline(3, 11, 12, P.sky[3]);
        for (let x = 3; x <= 11; x += 2) p.set(x, 8, P.plaster[1]);
        p.rect(4, 6, 7, 2, P.plaster[2]);
        p.vline(5, 3, 5, P.plaster[1]).vline(9, 4, 5, P.plaster[1]);
        p.set(5, 2, P.plaster[0]).set(9, 3, P.plaster[0]);
        for (let x = 2; x <= 12; x += 3) p.set(x, 11, P.white);
        break;
      }
      default: {
        // 四角星
        p.poly(
          [
            [7.5, 2],
            [9, 6],
            [13, 7.5],
            [9, 9],
            [7.5, 13],
            [6, 9],
            [2, 7.5],
            [6, 6],
          ],
          P.gold[3],
        );
        p.set(7, 7, P.gold[4]);
      }
    }
    return p.outlined(ink.brown);
  });
}
