// 街道小物件：货箱、木桶、手推车、路灯、旗杆、水井、货摊、长凳、麻袋、船锚。
// 风格只影响细节（灯的样式、井亭的屋顶、车上装的货、货摊的布色）；variant 改变摆法。
// 第九批的六种文化风格的街灯、水井、长凳、车与旗色、布色由各自的文件给出（见 cultures.ts 与 townArt.ts 的 CultureProps）。
import type { ArchStyle, PropKind, TownStyle } from "../buildings";
import { P } from "../palette";
import { Px, rgba } from "../px";
import { hash32 } from "../rng";
import { Canvas, type Ramp, adobe, ashlar, bricks, h01, outline } from "./kit";
import { awning, barrel, barrelSide, bench, crate, flagCloth, lantern, sack } from "./parts";
import { seedTag } from "./style";
import { cultureArt } from "./cultures";
import type { CultureProps } from "./townArt";

/** 把任意颜色（势力色）扩成暗、中、亮三阶。 */
export function rampOf(hexColor: string): readonly string[] {
  const v = rgba(hexColor);
  const r = (v >>> 24) & 0xff;
  const g = (v >>> 16) & 0xff;
  const b = (v >>> 8) & 0xff;
  const mix = (t: number, to: number) => {
    const f = (c: number) =>
      Math.round(c + (to - c) * t)
        .toString(16)
        .padStart(2, "0");
    return `#${f(r)}${f(g)}${f(b)}`;
  };
  return [mix(0.45, 20), `#${hexColor.replace("#", "").slice(0, 6)}`, mix(0.35, 255)];
}

/** 风格的默认旗色。 */
const STYLE_FLAG: Readonly<Record<ArchStyle, readonly string[]>> = {
  mediterranean: P.cloth.crimson,
  nordic: P.cloth.blue,
  lowland: [P.gold[1], P.gold[2], P.gold[3]],
  desert: [P.red[1], P.red[2], P.red[3]],
  islands: [P.teal[1], P.teal[2], P.teal[3]],
  eastern: [P.jade[1], P.jade[2], P.jade[3]],
  frontier: P.cloth.green,
};

/** 货摊布色。 */
const STALL: Readonly<Record<ArchStyle, readonly [Ramp, Ramp]>> = {
  mediterranean: [P.cloth.blue, [P.plaster[1], P.plaster[3], P.white]],
  nordic: [P.cloth.blue, [P.plaster[1], P.plaster[2], P.plaster[3]]],
  lowland: [P.autumn, [P.plaster[1], P.plaster[2], P.plaster[3]]],
  desert: [P.red, [P.sand[2], P.sand[3], P.sand[4]]],
  islands: [P.teal, [P.straw[1], P.straw[2], P.straw[3]]],
  eastern: [P.red, [P.plaster[1], P.plaster[2], P.plaster[3]]],
  frontier: [
    [P.parchmentDeep, P.parchmentDark, P.parchment],
    [P.cloth.green[0], P.cloth.green[1], P.cloth.green[2]],
  ],
};

function wheel(p: Px, cx: number, cy: number, r: number): void {
  p.ring(cx, cy, r, r, P.wood[1]);
  p.ring(cx, cy, r - 1, r - 1, P.wood[3]);
  p.line(cx - r + 1, cy, cx + r - 1, cy, P.wood[2]);
  p.line(cx, cy - r + 1, cx, cy + r - 1, P.wood[2]);
  p.set(cx, cy, P.iron[2]);
}

function crates(p: Px, v: number): void {
  const g = p.h;
  const n = (v % 3) + 1;
  for (let i = 0; i < n; i++) crate(p, 2 + i * 7, g, 7, P.wood, v + i);
  if (n >= 2) crate(p, 5, g - 7, 7, P.wood, v + 9);
  if (n === 3) crate(p, 12, g - 7, 6, P.wood, v + 4);
}

function barrels(p: Px, v: number): void {
  const g = p.h;
  if (v % 3 === 0) {
    barrel(p, 2, g);
  } else if (v % 3 === 1) {
    barrel(p, 2, g);
    barrel(p, 9, g);
  } else {
    barrelSide(p, 2, g);
    barrelSide(p, 11, g);
    barrelSide(p, 6, g - 7);
  }
}

/** 手推车上装的货，按风格区分。 */
const CART_LOAD: Readonly<Record<ArchStyle, "jars" | "logs" | "hay" | "rugs" | "fruit" | "citrus" | "furs">> = {
  mediterranean: "citrus",
  nordic: "logs",
  lowland: "hay",
  desert: "rugs",
  islands: "fruit",
  eastern: "jars",
  frontier: "furs",
};

function cart(p: Px, style: ArchStyle, v: number): void {
  const g = p.h;
  // 车斗
  p.rect(3, g - 10, 18, 4, P.wood[2]);
  p.hline(3, 20, g - 10, P.wood[3]);
  p.hline(3, 20, g - 7, P.wood[1]);
  for (let x = 7; x < 20; x += 5) p.vline(x, g - 9, g - 8, P.wood[1]);
  // 车把
  p.line(21, g - 8, 26, g - 5, P.wood[1]);
  p.line(21, g - 9, 26, g - 6, P.wood[3]);
  // 支腿
  p.vline(24, g - 5, g - 1, P.wood[1]);
  // 货：按风格装不同的东西
  const load = CART_LOAD[style];
  const alt = v % 2 === 1;
  if (load === "citrus" && !alt) {
    // 两筐柑橘与一只陶罐
    for (const x of [4, 11]) {
      p.rect(x, g - 13, 6, 3, P.straw[1]);
      p.hline(x, x + 5, g - 13, P.straw[2]);
      for (let i = 0; i < 3; i++) p.set(x + 1 + i * 2, g - 14, i % 2 ? P.autumn[3] : P.autumn[2]).set(x + i * 2, g - 15, P.gold[3]);
    }
    p.rect(17, g - 16, 3, 6, P.brick[2]);
    p.vline(17, g - 15, g - 11, P.brick[3]);
    p.hline(17, 19, g - 17, P.brick[1]);
  } else if (load === "furs") {
    // 一捆毛皮与一只木桶
    for (let i = 0; i < 3; i++) {
      const cl = [P.cloth.brown, P.hair.dark, P.cloth.ochre][i];
      p.rect(4, g - 12 - i * 2, 11 - i * 2, 2, cl[1]);
      p.hline(4, 14 - i * 2, g - 12 - i * 2, cl[2]);
      p.set(15 - i * 2, g - 11 - i * 2, cl[0]);
    }
    p.vline(8, g - 17, g - 10, P.straw[1]);
    p.rect(15, g - 16, 5, 6, P.wood[2]);
    p.hline(15, 19, g - 14, P.iron[2]);
    p.hline(15, 19, g - 11, P.iron[2]);
    p.vline(15, g - 16, g - 11, P.wood[3]);
  } else if (load === "hay" || (alt && load !== "logs")) {
    p.ellipse(11, g - 12, 8, 3, P.straw[2]);
    p.hline(5, 17, g - 14, P.straw[3]);
    for (let x = 4; x < 19; x += 3) p.set(x, g - 11, P.straw[1]);
  } else if (load === "jars") {
    for (const x of [6, 11, 16]) {
      p.rect(x - 2, g - 15, 4, 5, P.sand[1]);
      p.hline(x - 1, x, g - 16, P.sand[2]);
      p.vline(x - 2, g - 14, g - 11, P.sand[2]);
    }
  } else if (load === "logs") {
    for (let i = 0; i < 3; i++) {
      p.rect(3, g - 12 - i * 2, 18 - i * 3, 2, P.wood[i % 2 ? 2 : 3]);
      p.set(3, g - 12 - i * 2, P.wood[4]);
    }
  } else if (load === "rugs") {
    const cl = [P.red, P.teal, P.gold];
    for (let i = 0; i < 3; i++) {
      p.rect(4 + i * 5, g - 14, 5, 4, cl[i][2]);
      p.hline(4 + i * 5, 8 + i * 5, g - 14, cl[i][3]);
      p.set(5 + i * 5, g - 12, cl[i][1]);
    }
  } else {
    for (let i = 0; i < 5; i++) {
      const x = 5 + i * 3;
      p.circle(x, g - 12, 1, i % 2 ? P.wood[1] : P.leaf[2]);
      p.set(x - 1, g - 13, i % 2 ? P.wood[2] : P.leaf[3]);
    }
  }
  wheel(p, 8, g - 5, 4);
  wheel(p, 17, g - 5, 4);
}

function streetLamp(c: Canvas, style: ArchStyle): void {
  const p = c.p;
  const g = c.gy;
  if (style === "mediterranean") {
    // 铁艺灯柱：石座、细铁柱、卷草弯臂挂一盏灯
    p.rect(2, g - 3, 6, 3, P.parchmentDark);
    p.hline(2, 7, g - 3, P.paper);
    p.rect(4, g - 24, 2, 21, P.iron[1]);
    p.vline(4, g - 24, g - 4, P.iron[2]);
    p.hline(4, 11, g - 24, P.iron[1]);
    p.set(12, g - 23, P.iron[1]).set(12, g - 22, P.iron[1]);
    p.set(6, g - 22, P.iron[1]).set(7, g - 21, P.iron[1]).set(8, g - 22, P.iron[1]);
    p.set(3, g - 25, P.iron[2]).set(5, g - 26, P.iron[3]);
    lantern(c, 12, g - 21, "iron");
    return;
  }
  if (style === "frontier") {
    // 木桩横杆上吊一盏铁笼灯
    p.rect(3, g - 26, 3, 26, P.wood[2]);
    p.vline(3, g - 26, g - 1, P.wood[3]);
    p.vline(5, g - 26, g - 1, P.wood[1]);
    p.hline(3, 12, g - 25, P.wood[2]);
    p.hline(3, 12, g - 24, P.wood[1]);
    p.line(5, g - 19, 9, g - 24, P.wood[1]);
    p.vline(11, g - 23, g - 22, P.straw[1]);
    lantern(c, 11, g - 21, "iron");
    return;
  }
  if (style === "islands") {
    // 竹竿火把：竹节、椰壳灯碗、一团火
    p.rect(5, g - 22, 2, 22, P.straw[2]);
    p.vline(5, g - 22, g - 1, P.straw[3]);
    for (let y = g - 20; y < g; y += 5) p.hline(5, 6, y, P.straw[1]);
    p.rect(3, g - 25, 6, 3, P.wood[1]);
    p.hline(3, 8, g - 25, P.wood[2]);
    p.stamp(["..a..", ".aba.", "abcba", ".bcb."], { a: P.red[3], b: P.lamp[1], c: P.lamp[2] }, 3, g - 29);
    return;
  }
  const post = style === "eastern" ? P.stone : style === "desert" ? P.sand : P.iron;
  if (style === "eastern") {
    // 石灯笼：基座、立柱、灯室、宝顶
    p.rect(2, g - 3, 9, 3, post[2]);
    p.hline(2, 10, g - 3, post[3]);
    p.rect(4, g - 14, 5, 11, post[2]);
    p.vline(4, g - 14, g - 4, post[3]);
    p.vline(8, g - 14, g - 4, post[1]);
    p.rect(2, g - 16, 9, 2, post[3]);
    p.rect(3, g - 21, 7, 5, post[1]);
    p.rect(4, g - 20, 5, 3, c.o.lit ? P.lamp[2] : P.wood[0]);
    p.poly(
      [
        [1, g - 21],
        [6.5, g - 26],
        [12, g - 21],
      ],
      post[3],
    );
    p.hline(1, 11, g - 22, post[2]);
    p.set(6, g - 27, P.stone[4]);
    return;
  }
  // 灯柱 + 顶上的灯
  p.rect(2, g - 3, 6, 3, post[2]);
  p.hline(2, 7, g - 3, post[3]);
  p.rect(4, g - 22, 2, 19, post[2]);
  p.vline(4, g - 22, g - 4, post[3]);
  p.hline(3, 6, g - 12, post[3]);
  lantern(c, 5, g - 30, style === "desert" ? "brass" : "iron");
}

function flagpole(p: Px, style: ArchStyle, v: number, flag?: string, culture?: CultureProps): void {
  const g = p.h;
  let ramp = culture ? culture.flag : STYLE_FLAG[style];
  if (flag) {
    try {
      ramp = rampOf(flag);
    } catch {
      // 颜色写错时退回风格默认旗色
    }
  }
  p.rect(2, g - 3, 5, 3, P.stone[2]);
  p.hline(2, 6, g - 3, P.stone[3]);
  p.vline(4, g - 38, g - 4, P.wood[3]);
  p.vline(5, g - 38, g - 4, P.wood[1]);
  p.set(4, g - 39, P.gold[3]).set(5, g - 39, P.gold[2]);
  flagCloth(p, 6, g - 37, 14, 9, ramp, v % 4);
}

function well(c: Canvas, style: ArchStyle): void {
  const p = c.p;
  const g = c.gy;
  if (style === "mediterranean") {
    // 石井栏，上面一道铁艺拱架挂着辘轳
    ashlar(p, 2, g - 8, 18, 8, [P.plaster[0], P.parchmentDark, P.parchment, P.paper, P.white], { course: 4, min: 4, max: 6, seed: 5 });
    p.hline(1, 20, g - 9, P.white);
    for (let x = 3; x < 19; x += 2) p.set(x, g - 5, (x >> 1) % 2 ? P.cloth.blue[1] : P.white);
    p.vline(3, g - 20, g - 10, P.iron[1]);
    p.vline(18, g - 20, g - 10, P.iron[1]);
    for (let i = 0; i <= 14; i++) {
      const x = 4 + i;
      const y = g - 20 - Math.round(Math.sin((i / 14) * Math.PI) * 5);
      p.set(x, y, P.iron[1]);
    }
    p.set(10, g - 24, P.iron[2]).set(11, g - 25, P.iron[3]);
    p.rect(9, g - 21, 4, 2, P.wood[2]);
    p.vline(11, g - 19, g - 13, P.straw[1]);
    p.rect(9, g - 13, 4, 3, P.wood[2]);
    p.hline(9, 12, g - 13, P.iron[2]);
    return;
  }
  if (style === "frontier") {
    // 原木井框 + 茅草小顶
    for (let r = 0; r < 3; r++) {
      const y = g - 3 - r * 3;
      p.rect(2, y, 18, 3, P.wood[2]);
      p.hline(2, 19, y, P.wood[3]);
      p.hline(2, 19, y + 2, P.wood[1]);
      p.stamp(["ab", "bc"], { a: P.wood[3], b: P.wood[2], c: P.wood[1] }, 0, y);
      p.stamp(["ab", "bc"], { a: P.wood[3], b: P.wood[2], c: P.wood[1] }, 20, y);
    }
    p.rect(3, g - 22, 2, 13, P.wood[2]);
    p.rect(17, g - 22, 2, 13, P.wood[1]);
    p.hline(4, 17, g - 18, P.wood[3]);
    p.vline(11, g - 17, g - 12, P.straw[1]);
    p.rect(9, g - 12, 4, 3, P.wood[2]);
    for (let i = 0; i < 6; i++) p.hline(i, 21 - i, g - 23 - i, i === 0 ? P.straw[1] : i === 5 ? P.straw[3] : P.straw[2]);
    for (let x = 1; x < 21; x += 3) p.set(x, g - 23, P.straw[0]);
    return;
  }
  // 井栏
  if (style === "desert") adobe(p, 2, g - 8, 18, 8, P.sand, 3);
  else if (style === "lowland") bricks(p, 2, g - 8, 18, 8, P.brick, 3);
  else if (style === "islands") {
    ashlar(p, 2, g - 8, 18, 8, [P.blossom[0], P.blossom[1], P.blossom[2], P.blossom[3], P.white], { course: 4, min: 4, max: 6, seed: 3 });
  } else ashlar(p, 2, g - 8, 18, 8, P.stone, { course: 4, min: 4, max: 6, seed: 3 });
  p.hline(1, 20, g - 9, style === "desert" ? P.sand[4] : P.stone[3]);
  // 两根立柱、辘轳、吊桶
  p.rect(3, g - 22, 2, 13, P.wood[2]);
  p.rect(17, g - 22, 2, 13, P.wood[1]);
  p.hline(4, 17, g - 18, P.wood[3]);
  p.rect(9, g - 19, 4, 3, P.wood[2]);
  p.vline(11, g - 16, g - 12, P.straw[1]);
  p.rect(9, g - 12, 4, 3, P.wood[2]);
  p.hline(9, 12, g - 12, P.iron[2]);
  // 小屋顶（风格化）
  const roof = style === "eastern" ? P.jade : style === "nordic" ? P.slate : style === "lowland" ? P.autumn : style === "desert" ? P.teal : P.straw;
  if (style === "desert") {
    // 小圆顶：只画椭圆的上半
    for (let y = g - 27; y <= g - 23; y++) {
      const t = (g - 23 - y) / 4.5;
      const half = Math.round(9 * Math.sqrt(Math.max(0, 1 - t * t)));
      p.hline(10 - half, 11 + half, y, roof[2]);
      p.set(11 + half, y, roof[1]);
    }
    p.hline(2, 19, g - 23, roof[1]);
    p.set(6, g - 25, roof[3]).set(10, g - 27, roof[3]);
    p.vline(10, g - 30, g - 28, P.gold[2]);
  } else {
    for (let i = 0; i < 6; i++) {
      p.hline(i, 21 - i, g - 23 - i, i === 0 ? roof[1] : i === 5 ? roof[3] : roof[2]);
    }
    if (style === "eastern") {
      p.set(0, g - 24, roof[2]).set(21, g - 24, roof[2]);
    }
  }
}

function stall(c: Canvas, style: ArchStyle, v: number, culture?: CultureProps): void {
  const p = c.p;
  const g = c.gy;
  const [a, b] = culture ? culture.stall : STALL[style];
  // 立杆
  p.vline(2, g - 18, g - 1, P.wood[1]);
  p.vline(23, g - 18, g - 1, P.wood[1]);
  // 桌子与货
  p.rect(1, g - 8, 24, 2, P.wood[3]);
  p.rect(2, g - 6, 22, 5, P.wood[2]);
  p.hline(2, 23, g - 6, P.wood[1]);
  for (let x = 4; x < 23; x += 4) {
    const r = h01(x, v, 7);
    const ramp = r < 0.33 ? P.red : r < 0.66 ? P.gold : P.leaf;
    p.hline(x, x + 2, g - 9, ramp[2]);
    p.set(x + 1, g - 10, ramp[3]);
  }
  awning(c, 0, g - 21, 26, 3, a, b);
}

function anchor(p: Px): void {
  const g = p.h;
  p.stamp(
    [
      ".....aa.....",
      "....a..a....",
      ".....aa.....",
      "..bbbbbbbb..",
      ".....ab.....",
      ".....ab.....",
      ".....ab.....",
      ".....ab.....",
      ".....ab.....",
      "b....ab....b",
      "ab...ab...ab",
      ".ab..ab..ab.",
      "..aaaabbbb..",
      "...aaabbb...",
    ],
    { a: P.iron[3], b: P.iron[1] },
    1,
    g - 15,
  );
  // 一段缆绳
  p.line(8, g - 14, 12, g - 12, P.straw[2]);
  p.line(12, g - 12, 12, g - 2, P.straw[1]);
  p.hline(10, 14, g - 1, P.straw[2]);
}

/** 画一件小物件（已描边、裁边，底边是地面线）。 */
export function drawPropImpl(kind: PropKind, town: TownStyle, opts: { variant?: number; flag?: string }, lit = false): Px {
  const v = Math.abs(Math.floor(opts.variant ?? 0));
  const c = new Canvas(32, 44, town, { season: 1, snow: false, lit }, hash32(`prop/${kind}/${seedTag(town)}/${v}`));
  const p = c.p;
  const art = cultureArt(town)?.props;
  if (art && (kind === "lamp" || kind === "well" || kind === "bench" || kind === "cart")) {
    // 六种文化风格：街灯、水井、长凳与车整件换成各自的画法
    if (kind === "lamp") art.lamp(c);
    else if (kind === "well") art.well(c);
    else if (kind === "bench") art.bench(p);
    else art.cart(p, v);
    outline(p);
    return p.trimmed();
  }
  // 其余物件：经典风格按 style 画；文化风格走到这里的只有与风格无关的物件和旗杆、货摊（旗色、布色取自 art），
  // 不会查到按经典风格建的表
  const style = town as ArchStyle;
  switch (kind) {
    case "crates":
      crates(p, v);
      break;
    case "barrels":
      barrels(p, v);
      break;
    case "cart":
      cart(p, style, v);
      break;
    case "lamp":
      streetLamp(c, style);
      break;
    case "flagpole":
      flagpole(p, style, v, opts.flag, art);
      break;
    case "well":
      well(c, style);
      break;
    case "stall":
      stall(c, style, v, art);
      break;
    case "bench":
      if (style === "mediterranean") {
        // 石凳，靠背嵌一排蓝白瓷砖
        p.rect(2, p.h - 9, 14, 4, P.white);
        for (let x = 3; x < 15; x++) p.set(x, p.h - 8, (x >> 1) % 2 ? P.cloth.blue[1] : P.white).set(x, p.h - 7, (x >> 1) % 2 ? P.white : P.cloth.blue[1]);
        p.rect(1, p.h - 5, 16, 2, P.paper);
        p.hline(1, 16, p.h - 5, P.white);
        p.rect(2, p.h - 3, 3, 3, P.parchment);
        p.rect(13, p.h - 3, 3, 3, P.parchmentDark);
      } else if (style === "frontier") {
        // 劈开的半圆木搭在两截木墩上
        p.rect(1, p.h - 5, 14, 2, P.wood[3]);
        p.hline(1, 14, p.h - 5, P.wood[4]);
        p.hline(1, 14, p.h - 4, P.wood[2]);
        for (const x of [2, 11]) {
          p.rect(x, p.h - 3, 3, 3, P.wood[1]);
          p.set(x, p.h - 3, P.wood[2]);
        }
      } else if (style === "eastern" || style === "desert") {
        // 石凳
        const s = style === "eastern" ? P.stone : P.sand;
        p.rect(2, p.h - 5, 12, 2, s[3]);
        p.hline(2, 13, p.h - 5, s[4]);
        p.rect(3, p.h - 3, 2, 3, s[2]);
        p.rect(11, p.h - 3, 2, 3, s[1]);
      } else bench(p, 2, p.h, P.wood);
      break;
    case "sacks": {
      const n = (v % 3) + 2;
      for (let i = 0; i < n; i++) sack(p, 2 + i * 5, p.h, (i + v) % 2);
      if (n >= 3) sack(p, 4, p.h - 5, v % 2);
      break;
    }
    case "anchor":
      anchor(p);
      break;
  }
  outline(p);
  return p.trimmed();
}
