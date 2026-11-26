// 民居：每种风格 8 种变体（1–3 层、两种屋顶、门的位置、墙面与门窗配色各不相同），variant 取模。
// 变体表只描述体量与配色，材质与屋顶仍由风格套件决定，所以同一变体在各种风格下各有面貌。
import type { TownStyle } from "../buildings";
import type { Px } from "../px";
import { hash32 } from "../rng";
import { type DrawOpts, Canvas, doorCharm, finish } from "./kit";
import { awning, barrel, crate, sack } from "./parts";
import { type Kit, type RoofKind, type WallKind, type WinKind, seedTag, windowRow } from "./style";

interface HouseSpec {
  /** 墙宽（成图超过 48 时自动收窄） */
  w: number;
  floors: 1 | 2 | 3;
  roof: RoofKind;
  /** 门的位置：-1 左、0 中、1 右 */
  door: -1 | 0 | 1;
  ground: WallKind;
  upper: WallKind;
  /** 配色变体 */
  tone: number;
  win: WinKind;
  extra?: "awning" | "shop" | "barrels";
}

/** 民居变体表（可以直接增删改）。 */
const SPECS: readonly HouseSpec[] = [
  { w: 34, floors: 2, roof: "main", door: -1, ground: "main", upper: "upper", tone: 0, win: "std" },
  { w: 30, floors: 1, roof: "gable", door: 0, ground: "plain", upper: "plain", tone: 1, win: "small", extra: "barrels" },
  { w: 38, floors: 3, roof: "main", door: 1, ground: "ground", upper: "upper", tone: 2, win: "std" },
  { w: 36, floors: 2, roof: "gable", door: 1, ground: "plain", upper: "plain", tone: 1, win: "std", extra: "awning" },
  { w: 28, floors: 1, roof: "main", door: 0, ground: "main", upper: "main", tone: 2, win: "round" },
  { w: 40, floors: 2, roof: "gable", door: -1, ground: "ground", upper: "upper", tone: 0, win: "tall", extra: "shop" },
  { w: 32, floors: 3, roof: "gable", door: 0, ground: "plain", upper: "upper", tone: 2, win: "std" },
  { w: 42, floors: 2, roof: "main", door: 0, ground: "ground", upper: "plain", tone: 1, win: "std", extra: "awning" },
];

export const HOUSE_VARIANTS = SPECS.length;

const GROUND_H = 16;
const UPPER_H = 15;

function house(c: Canvas, k: Kit, s: HouseSpec, w: number): void {
  const p = c.p;
  const g = c.gy;
  const x = Math.floor((c.w - w) / 2);
  const ph = k.style === "islands" || k.stilted ? k.plinthH : Math.max(2, k.plinthH - 1);
  const yb = g - ph;
  const yg = yb - GROUND_H;
  k.plinth(c, x - 1, w + 2, ph);
  k.wall(c, x, yg, w, GROUND_H, s.ground);
  let top = yg;
  const floorTops: number[] = [];
  for (let i = 1; i < s.floors; i++) {
    top -= UPPER_H;
    k.wall(c, x, top, w, UPPER_H, s.upper);
    floorTops.push(top);
  }
  k.roof(c, x, w, top, s.roof);
  // 楼层之间的腰线
  k.band(c, x, w, yg - 1);
  for (let i = 0; i + 1 < floorTops.length; i++) k.band(c, x, w, floorTops[i] - 1);
  // 楼上的窗
  const n = w >= 38 ? 3 : 2;
  floorTops.forEach((ft, i) => {
    const isTop = i === floorTops.length - 1;
    windowRow(c, k, x, w, ft + (isTop ? 5 : 3), n, s.win === "round" ? "std" : s.win);
  });
  // 底层：门 + 窗（或店面）
  const [dw] = k.doorSize("std");
  const dcx = s.door === 0 ? x + Math.floor(w / 2) : s.door < 0 ? x + 3 + Math.floor(dw / 2) + 1 : x + w - 4 - Math.floor(dw / 2);
  const free: [number, number] = s.door < 0 ? [dcx + Math.ceil(dw / 2) + 2, x + w - 2] : s.door > 0 ? [x + 2, dcx - Math.ceil(dw / 2) - 2] : [x + 2, x + w - 2];
  const gy0 = yg + (s.floors === 1 ? 6 : 4);
  if (s.extra === "shop") {
    const [ww, wh] = k.winSize("wide");
    const wx = Math.floor((free[0] + free[1] - ww) / 2);
    if (wx >= free[0] - 1) k.window(c, wx, yb - wh - 3, "wide");
    awning(c, free[0] - 1, yg + 2, free[1] - free[0] + 3, 2, k.awning[0], k.awning[1]);
  } else if (s.door !== 0) {
    const span = free[1] - free[0];
    const kind: WinKind = s.win === "tall" ? "std" : s.win;
    const cnt = span >= 24 ? 2 : span >= 9 ? 1 : 0;
    if (cnt) windowRow(c, k, free[0], span, gy0, cnt, kind);
  } else if (w >= 34) {
    const kind: WinKind = s.win === "tall" ? "small" : s.win === "round" ? "round" : "small";
    windowRow(c, k, x, Math.floor(w / 2) - Math.ceil(dw / 2), gy0 + 1, 1, kind);
    windowRow(c, k, x + Math.floor(w / 2) + Math.ceil(dw / 2), Math.floor(w / 2) - Math.ceil(dw / 2), gy0 + 1, 1, kind);
  } else if (s.win === "round" && s.floors === 1) {
    k.window(c, x + 2, gy0, "small");
  }
  k.door(c, dcx, yb, "std");
  if (s.extra === "awning") {
    awning(c, dcx - Math.ceil(dw / 2) - 3, yb - 17, dw + 6, 2, k.awning[0], k.awning[1]);
  }
  doorCharm(c, dcx + Math.ceil(dw / 2) + 2, yb - 13);
  if (s.extra === "barrels") {
    barrel(p, x + w + 1, g);
    crate(p, x - 7, g, 6);
    sack(p, x - 6, g - 6, 1);
  }
}

/** 画一栋民居；成图宽度保证在 28–48 之间。 */
export function drawHouseWith(style: TownStyle, k: Kit, variant: number, o: DrawOpts): Px {
  const v = ((Math.floor(variant) % SPECS.length) + SPECS.length) % SPECS.length;
  const round = Math.floor(Math.floor(variant) / SPECS.length);
  const s = SPECS[v];
  let w = s.w;
  for (;;) {
    const c = new Canvas(96, 104, style, { ...o }, hash32(`house/${seedTag(style)}/${variant}`));
    c.tone = s.tone + round;
    house(c, k, s, w);
    const px = finish(c);
    if ((px.w <= 48 && px.w >= 28) || w <= 16 || w >= 60) return px;
    w += px.w > 48 ? -2 : 2;
  }
}
