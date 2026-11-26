// 商品图标：goods.toml 的 38 种商品各有专属图样（16×16、透明底、1 像素描边、左上受光），
// 另有按类别（粮食 原料 矿产 嗜好品 奢侈品 加工品 军需）画的通用图样，给以后新增的商品兜底。
import { Px } from "../px";
import { P, R, ball, canvas, grid, ink, leaf, outline, shape, type Ramp } from "./kit";
import { PARTS } from "./ui";

type Maker = () => Px;

const IRON5: Ramp = [P.iron[0], P.iron[1], P.iron[2], P.iron[3], P.stone[3]];
const AMBER: Ramp = [P.autumn[0], P.autumn[1], P.autumn[2], P.autumn[3], P.gold[4]];
const TOBACCO: Ramp = [P.cloth.brown[0], P.cloth.brown[1], P.cloth.brown[2], P.sand[2], P.sand[3]];
const GRAPE: Ramp = [P.cloth.purple[0], P.cloth.purple[1], P.cloth.purple[2], P.blossom[1]];
const SILK_RAW: Ramp = [P.straw[0], P.straw[1], P.straw[2], P.straw[3], P.gold[4]];
const SULFUR: Ramp = [P.gold[1], P.gold[2], P.lamp[1], P.gold[4], P.lamp[2]];
const INDIGO: Ramp = [ink.blue, P.cloth.navy[1], P.cloth.blue[0], P.cloth.blue[1], P.cloth.blue[2]];
const PLANK: Ramp = [P.wood[1], P.wood[2], P.wood[3], P.wood[4], P.sand[4]];
const SHELL: Ramp = [P.brick[1], P.brick[2], P.brick[3], P.brick[4], P.blossom[3]];
const PEARL: Ramp = [P.snow[0], P.snow[1], P.snow[2], P.white];
const POWDER: Ramp = [ink.deep, P.iron[0], P.iron[1], P.iron[2]];

const g = (rows: readonly string[], ramps: Parameters<typeof grid>[2], o: string = ink.deep): Px => outline(grid(canvas(), rows, ramps), o);

// ---------------------------------------------------------------- 粮食与原料

const grain: Maker = () =>
  g(
    [
      "......5......",
      ".4...454...4.",
      "..5..343..5..",
      ".454.454.454.",
      ".343.343.343.",
      ".454.454.454.",
      ".343..3..343.",
      ".454..c..454.",
      "..3...c...3..",
      "..c...c...c..",
      "...c..c..c...",
      "....BCCCB....",
      "...cdcdcdc...",
      "..cdcdcdcdc..",
    ],
    { a: R.gold, b: R.straw, d: R.wood },
    ink.brown,
  );

const LOG = [".2222.", "255552", "254452", "254352", "255442", ".2222."];
const timber: Maker = () => {
  const p = canvas();
  grid(p, LOG, { a: R.wood }, 1, 8);
  grid(p, LOG, { a: R.wood }, 8, 8);
  grid(p, LOG, { a: R.wood }, 4, 3);
  return outline(p, ink.brown);
};

const cotton: Maker = () => {
  const p = canvas();
  const white: Ramp = [P.snow[0], P.snow[1], P.snow[2], P.white];
  const bract: Ramp = [P.wood[0], P.wood[1], P.wood[2], P.wood[3], P.sand[3]];
  // 星形的褐色苞片藏在棉团后面，只在四角露出尖儿；下方一小段茎
  leaf(p, 8, 8, 1.2, 2.8, 3.2, bract, false);
  leaf(p, 8, 8, 14.8, 2.8, 3.2, bract, false);
  leaf(p, 8, 8, 1.2, 13.2, 3.2, bract, false);
  leaf(p, 8, 8, 14.8, 13.2, 3.2, bract, false);
  p.line(8, 12, 8, 14, P.wood[2]).line(9, 12, 9, 14, P.wood[1]);
  ball(p, 5.4, 6.3, 3.4, 3.2, white);
  ball(p, 10.8, 6.3, 3.4, 3.2, white);
  ball(p, 8.1, 9.8, 3.8, 3, white);
  ball(p, 8.1, 4.2, 3, 2.6, white);
  return outline(p, ink.brown);
};

const sugarcane: Maker = () =>
  g(
    [
      "e....d.....d",
      ".d...dc...c.",
      "..c..cc..c..",
      "..dc.cd.cd..",
      "..43.43.43..",
      "..43.21.43..",
      "..21.43.21..",
      "..43.43.43..",
      "..43.43.43..",
      "..43.21.43..",
      "..21.43.21..",
      "..43.43.43..",
      "..43.43.43..",
      "..21.21.21..",
    ],
    { a: [P.leaf[1], P.straw[1], P.straw[2], P.straw[3]], b: R.leaf },
  );

const iron_ore: Maker = () =>
  g(
    [
      "....5544.....",
      "..455544433..",
      ".4554dd44433.",
      "4455bd4443332",
      "4544444dd3322",
      "44444443bd322",
      "3444qr3333222",
      ".33333332221.",
      "..222222211..",
    ],
    { a: R.stone, b: IRON5, c: R.autumn },
  );

const copper_ore: Maker = () =>
  g(
    [
      ".....5544....",
      "...455544433.",
      "..4554rs44432",
      ".4554rsr44332",
      "45544r4CD4332",
      "4544444CDC322",
      "44444433DC322",
      "3344433332221",
      ".33333322221.",
    ],
    { a: [P.sand[0], P.sand[1], mix2(P.sand[1], P.sand[2]), P.sand[2], P.sand[3]], c: R.teal, d: R.autumn },
  );

/** 两色取中（仅用于从调色板派生一阶过渡色）。 */
function mix2(a: string, b: string): string {
  const pa = Number.parseInt(a.slice(1), 16);
  const pb = Number.parseInt(b.slice(1), 16);
  const ch = (s: number) => Math.round((((pa >> s) & 0xff) + ((pb >> s) & 0xff)) / 2);
  return `#${[16, 8, 0].map((s) => ch(s).toString(16).padStart(2, "0")).join("")}`;
}

const wool: Maker = () => {
  const p = canvas();
  const cream: Ramp = [P.parchmentDeep, P.parchmentDark, P.parchment, P.paper, P.white];
  for (const [x, y, r] of [
    [4, 7, 3.1],
    [8, 5.2, 3.6],
    [12, 7, 3.1],
    [5.5, 10.5, 3.2],
    [10.5, 10.5, 3.2],
  ] as const) {
    ball(p, x, y, r, r * 0.92, cream);
  }
  // 卷曲的毛：几个小“C”形
  for (const [x, y] of [
    [3, 6],
    [7, 4],
    [11, 6],
    [5, 10],
    [9, 10],
  ] as const) {
    p.put(x, y, P.parchmentDark).put(x + 1, y - 1, P.parchmentDark).put(x + 1, y + 1, P.parchment);
  }
  // 捆扎的麻绳
  for (let y = 2; y <= 13; y++) p.put(8, y, y % 2 ? P.wood[2] : P.wood[1]).put(9, y, y % 2 ? P.wood[1] : P.wood[0]);
  return outline(p, ink.brown);
};

const cocoons: Maker = () => {
  const p = canvas();
  grid(
    p,
    [
      ".....44443...",
      "..444554443..",
      ".445544443322",
      "3455555555521",
      ".334444333222",
      "..333333222..",
      "....22222....",
    ],
    { a: R.leaf },
    1,
    8,
  );
  const COCOON = [".dddc.", "ddccbb", "dccbba", ".bbaa."];
  const white = { b: [P.snow[0], P.snow[1], P.snow[2], P.white] };
  grid(p, COCOON, white, 2, 4);
  grid(p, COCOON, white, 8, 6);
  return outline(p);
};

const tea: Maker = () => {
  const p = canvas();
  const dark: Ramp = [P.leaf[0], P.leaf[1], P.leaf[2], P.leaf[3], P.leaf[4]];
  p.line(8, 9, 8, 14, P.wood[2]);
  leaf(p, 8, 10, 1.5, 5, 5.5, dark);
  leaf(p, 8, 9, 14.5, 4, 5.5, dark);
  leaf(p, 8, 9.5, 8.6, 0.8, 3.6, [P.leaf[1], P.leaf[2], P.leaf[3], P.leaf[4], P.white]);
  return outline(p);
};

const spice: Maker = () =>
  g(
    [
      "....srs.....",
      "...srrrq....",
      "..srrrqqq...",
      ".4333333332.",
      "..BCCCCBB...",
      "..3443332...",
      ".344433332..",
      "34444333322.",
      "34443333322.",
      "34433333222.",
      "33333322221.",
      ".2222222111.",
      "......qr.qr.",
    ],
    { a: R.straw, c: R.autumn, d: R.wood },
    ink.brown,
  );

const fish: Maker = () =>
  g(
    [
      "......322.....",
      "2...44555443..",
      "32.4555554443.",
      "3444555444x443",
      ".3444444444443",
      "324wwwwwww443.",
      "2..3wwwwww33..",
      "....3322233...",
      "......2.2.....",
    ],
    { a: R.sky },
    ink.blue,
  );

const salt: Maker = () =>
  g(
    [
      "......dd......",
      ".....ddcc.....",
      "....dddcbb....",
      "...ddcdcbba...",
      "..dddccbcbba..",
      ".ddcdccbbbbaa.",
      "54444444444443",
      "43333333333332",
      ".333333333322.",
      "..3333333222..",
      "....222222....",
    ],
    { a: R.wood, b: [P.snow[0], P.snow[1], P.snow[2], P.white] },
    ink.brown,
  );

const fur: Maker = () =>
  g(
    [
      "......33......",
      ".3...4444...3.",
      ".44.455443.43.",
      "..44455544433.",
      "...455554443..",
      "...455544433..",
      "...455444333..",
      "...454444332..",
      "...444443332..",
      "..44444433322.",
      ".44.444333.32.",
      ".3....33....2.",
      "......22......",
    ],
    { a: [P.cloth.brown[0], P.cloth.brown[1], P.cloth.brown[2], P.sand[2], P.sand[3]] },
    ink.brown,
  );

const grapes: Maker = () => {
  const p = canvas();
  p.line(8, 1, 9, 3, P.wood[2]);
  leaf(p, 9, 3.6, 14.6, 3, 3.4, R.leaf);
  const pos: [number, number][] = [
    [4, 5],
    [7.3, 4.6],
    [10.6, 5],
    [5.6, 8],
    [9, 8],
    [12, 8.3],
    [7.3, 11],
    [10.4, 11],
    [8.8, 13.8],
  ];
  for (const [x, y] of pos) ball(p, x, y, 1.9, 1.9, GRAPE);
  return outline(p);
};

const cocoa: Maker = () => {
  const p = canvas();
  grid(
    p,
    [
      "...BB...",
      "...43...",
      "..4432..",
      ".443432.",
      ".443432.",
      "44434322",
      "44434322",
      "44434322",
      "34334221",
      ".333221.",
      ".233221.",
      "..2221..",
      "...21...",
    ],
    { a: R.autumn, d: R.wood },
    2,
    1,
  );
  const BEAN = [".BC.", "ABCB", ".AA."];
  grid(p, BEAN, { d: R.wood }, 10, 9);
  grid(p, BEAN, { d: R.wood }, 11, 12);
  return outline(p, ink.brown);
};

const tobacco: Maker = () => {
  const p = canvas();
  leaf(p, 8, 3, 2.5, 14.5, 5, TOBACCO);
  leaf(p, 8, 3, 13.5, 14.5, 5, TOBACCO);
  leaf(p, 8, 3, 8, 15, 5.5, TOBACCO);
  p.rect(6, 3, 5, 2, P.red[2]).rect(6, 4, 5, 1, P.red[1]);
  p.line(8, 1, 8, 2, P.straw[2]);
  return outline(p, ink.brown);
};

const amber: Maker = () => {
  const p = canvas();
  ball(p, 7, 8.5, 5.5, 4.6, AMBER);
  ball(p, 9.8, 6.2, 3.6, 3.2, AMBER);
  // 透光：内部右下反而更亮
  for (const [x, y] of [
    [8, 10],
    [9, 10],
    [10, 9],
    [9, 11],
  ] as const) {
    p.put(x, y, P.autumn[3]);
  }
  p.put(4, 6, P.white).put(5, 5, P.white).put(4, 7, P.gold[4]);
  // 琥珀里的小虫
  p.put(7, 8, P.autumn[0]).put(8, 8, P.autumn[0]).put(7, 9, P.wood[0]);
  return outline(p, ink.brown);
};

const pearl: Maker = () => {
  const p = canvas();
  // 扇贝壳：以底部为轴展开的扇形，放射状肋纹
  const hx = 8;
  const hy = 14.5;
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const dx = x + 0.5 - hx;
      const dy = y + 0.5 - hy;
      if (Math.hypot(dx, dy * 0.8) > 7.4 || dy > -0.5) continue;
      const a = Math.atan2(-dy, dx);
      if (a < 0.42 || a > Math.PI - 0.42) continue;
      const rib = Math.abs(Math.sin(a * 9)) < 0.3;
      // 扇缘的波浪
      if (Math.hypot(dx, dy * 0.8) > 6.9 + Math.cos(a * 18) * 0.4) continue;
      const l = -dx / 8;
      p.put(x, y, rib ? SHELL[1] : l > 0.2 ? SHELL[4] : l > -0.25 ? SHELL[3] : SHELL[2]);
    }
  }
  p.rect(6, 13, 5, 2, SHELL[1]).rect(7, 13, 3, 1, SHELL[2]);
  ball(p, 8, 9.6, 3.1, 3.1, PEARL, true);
  return outline(p, ink.brown);
};

const coral: Maker = () => {
  const p = canvas();
  const br = (x0: number, y0: number, x1: number, y1: number) => {
    p.line(x0, y0, x1, y1, P.red[3]);
    p.line(x0 + 1, y0, x1 + 1, y1, P.red[1]);
  };
  br(7, 13, 7, 9);
  br(7, 10, 4, 6);
  br(4, 6, 3, 2);
  br(4, 7, 1, 5);
  br(7, 9, 10, 5);
  br(10, 5, 10, 1);
  br(10, 6, 13, 4);
  br(7, 11, 11, 10);
  // 枝头圆润的亮点
  for (const [x, y] of [
    [3, 2],
    [1, 5],
    [10, 1],
    [13, 4],
    [11, 10],
  ] as const) {
    p.put(x, y, P.blossom[2]).put(x + 1, y, P.red[3]);
  }
  p.rect(4, 13, 8, 1, P.stone[2]).rect(5, 14, 6, 1, P.stone[1]);
  return outline(p);
};

const sulfur: Maker = () => {
  const p = canvas();
  shape(
    p,
    [
      [5, 5],
      [7.5, 1.5],
      [10.5, 2.5],
      [10.5, 6.5],
      [7, 7.5],
    ],
    SULFUR,
  );
  shape(
    p,
    [
      [9, 8],
      [11.5, 4.5],
      [14.5, 6],
      [14.5, 11.5],
      [11, 13],
    ],
    SULFUR,
  );
  shape(
    p,
    [
      [1.5, 9.5],
      [4, 5],
      [8.5, 4.5],
      [10.5, 8],
      [9, 13],
      [3.5, 13.5],
    ],
    SULFUR,
  );
  // 棱线
  p.line(4, 6, 6, 12, P.gold[4]);
  p.line(12, 6, 12, 11, P.lamp[2]);
  return outline(p, ink.brown);
};

const saltpeter: Maker = () =>
  g(
    [
      "........4.....",
      ".......432....",
      "..4....432....",
      ".432...432....",
      ".432...432.4..",
      ".432.4.432432.",
      ".432432432432.",
      ".432432432432.",
      ".432432432432.",
      ".432432432432.",
      ".432432432432.",
      ".cddcddccdccb.",
      "abbbbbbbbbbba.",
    ],
    { a: [P.snow[0], P.snow[1], P.snow[2], P.white], b: R.stone },
    ink.blue,
  );

const herbs: Maker = () => {
  const p = canvas();
  const stems: [number, number][] = [
    [2, 3],
    [5, 2],
    [9, 2],
    [13, 3],
    [1, 8],
    [14, 8],
  ];
  for (const [x, y] of stems) p.line(7.5, 12, x, y, P.leaf[1]);
  for (const [x, y] of stems) {
    const mx = (7.5 + x) / 2;
    const my = (12 + y) / 2;
    leaf(p, mx, my, mx + (x < 7.5 ? -2.5 : 2.5), my - 1.5, 2.4, R.leaf, false);
  }
  for (const [x, y] of stems.slice(0, 4)) {
    p.put(x, y, P.cloth.purple[2]).put(x + 1, y, P.cloth.purple[1]).put(x, y - 1, P.blossom[2]);
  }
  p.line(7, 12, 7, 14, P.leaf[1]).line(8, 12, 8, 14, P.leaf[0]);
  p.rect(6, 11, 4, 2, P.red[2]).rect(6, 12, 4, 1, P.red[1]);
  return outline(p);
};

const CUBE = [".55554.", "5444443", "3333322", "3333322", "3333322", "3333322", ".22221."];
const indigo: Maker = () => {
  const p = canvas();
  grid(p, CUBE, { a: INDIGO }, 7, 2);
  grid(p, CUBE, { a: INDIGO }, 2, 7);
  leaf(p, 1.5, 5.5, 7, 1.5, 3, R.leaf);
  return outline(p, ink.deep);
};

// ---------------------------------------------------------------- 加工品

const yarn: Maker = () =>
  g(
    [
      ".45555554.",
      "3444444442",
      ".22222222.",
      "..ddddcb..",
      "..cdddcb..",
      "..dcddcb..",
      "..ddcdcb..",
      "..dddcbb..",
      "..cdddcb..",
      "..dcddcb..",
      ".45555554.",
      "3444444442",
      ".22222222.",
    ],
    { a: R.wood, b: [P.snow[0], P.snow[1], P.snow[2], P.white] },
    ink.brown,
  );

const cloth: Maker = () => {
  const p = canvas();
  // 布卷：横放的圆柱，左端露出卷层；前面垂下一段布；布面织一道蓝条
  const body = [P.white, P.paper, P.paper, P.parchment, P.parchment, P.parchmentDark];
  for (let y = 0; y < body.length; y++) p.rect(5, 2 + y, 10, 1, body[y]);
  p.rect(5, 4, 10, 1, P.cloth.blue[1]);
  p.rect(5, 5, 10, 1, P.cloth.blue[0]);
  shape(
    p,
    [
      [8, 8],
      [15, 8],
      [14, 14],
      [9, 14],
    ],
    [P.parchmentDark, P.parchment, P.paper, P.white],
  );
  p.rect(9, 10, 5, 1, P.cloth.blue[1]).rect(9, 11, 5, 1, P.cloth.blue[0]);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const dx = (x + 0.5 - 4.5) / 3.3;
      const dy = (y + 0.5 - 5) / 3.4;
      const r = Math.hypot(dx, dy);
      if (r > 1) continue;
      p.put(x, y, r > 0.8 ? P.parchmentDark : r > 0.55 ? P.paper : r > 0.3 ? P.parchment : P.parchmentDeep);
    }
  }
  return outline(p, ink.brown);
};

const garments: Maker = () =>
  g(
    [
      "....3eeee2....",
      "..333e32e222..",
      ".33333r222222.",
      "333333r2222221",
      "33.333r2222.21",
      "21.333r2222.11",
      "...333r2222...",
      "...333r2222...",
      "...333r2222...",
      "...333r2222...",
      "...33332222...",
      "...22221111...",
    ],
    { a: R.blue, b: R.parch, c: R.gold },
  );

const INGOT = [".55554.", "4444443", "3333332", ".22221."];
const pig_iron: Maker = () => {
  const p = canvas();
  grid(p, INGOT, { a: IRON5 }, 1, 9);
  grid(p, INGOT, { a: IRON5 }, 8, 9);
  grid(p, INGOT, { a: IRON5 }, 4, 5);
  return outline(p, ink.deep);
};

const ironware: Maker = () =>
  g(
    [
      "...3333333...",
      "..3.......2..",
      ".3.........2.",
      "5555555555554",
      "3222222222221",
      ".44333333322.",
      "4443333333221",
      "4433333332221",
      "4433333322211",
      ".33333322211.",
      "..332222211..",
      "..2.......1..",
    ],
    { a: IRON5 },
  );

const cannonGood: Maker = () => {
  const p = canvas();
  // 炮管：炮尾粗、渐细、炮口加箍；尾部一个小球钮
  const cy = 4.5;
  for (let x = 1; x <= 14; x++) {
    const r = x <= 1 ? 1 : x >= 13 ? 2.3 : 2.4 - (x - 2) * 0.08;
    for (let y = Math.floor(cy - r); y <= cy + r; y++) {
      const t = (y + 0.5 - cy) / r;
      p.put(x, y, t < -0.5 ? IRON5[4] : t < 0.1 ? IRON5[3] : t < 0.6 ? IRON5[2] : IRON5[1]);
    }
  }
  p.rect(4, 2, 1, 5, IRON5[1]);
  ball(p, 4.5, 11.5, 2.4, 2.4, IRON5, true);
  ball(p, 9.5, 11.5, 2.4, 2.4, IRON5, true);
  ball(p, 7, 8.6, 2.4, 2.4, IRON5, true);
  return outline(p);
};

const raw_silk: Maker = () => {
  const p = canvas();
  // 一绞生丝：拧成麻花的丝束斜放着，两端各有一个线圈，中间扎一道红绳
  const cx = 8;
  const cy = 8;
  const ang = -0.45;
  const ux = Math.cos(ang);
  const uy = Math.sin(ang);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const along = dx * ux + dy * uy;
      const across = -dx * uy + dy * ux;
      if (Math.abs(along) > 6.6) continue;
      const half = 2.6 + (Math.abs(along) > 4.6 ? 0.6 : 0);
      if (Math.abs(across) > half) continue;
      // 两端的线圈留出中空
      if (Math.abs(along) > 4.9 && Math.abs(across) < 0.9) continue;
      const strand = Math.floor((along * 1.3 + across * 1.1 + 20) / 1.4) % 2 === 0;
      const lit = across < -0.6;
      let c = strand ? SILK_RAW[4] : SILK_RAW[3];
      if (!lit) c = strand ? SILK_RAW[3] : SILK_RAW[2];
      if (across > half - 0.9) c = SILK_RAW[1];
      p.put(x, y, c);
    }
  }
  for (let t = -2.6; t <= 2.6; t += 0.5) {
    const x = Math.floor(cx + ux * 0.3 - uy * t);
    const y = Math.floor(cy + uy * 0.3 + ux * t);
    p.put(x, y, t < 0 ? P.red[3] : P.red[2]).put(x + 1, y, P.red[1]);
  }
  return outline(p, ink.brown);
};

const silk: Maker = () =>
  g(
    [
      ".4555555w55553",
      "45555555w55443",
      "444444444w4332",
      ".3333333333222",
      ".4555555w55553",
      "4555555w555443",
      "44444444w44332",
      ".3333333333222",
      ".455555w555553",
      "455555555w5443",
      ".3333333333222",
    ],
    { a: R.teal },
  );

const brocade: Maker = () =>
  g(
    [
      "....44dd33....",
      "44444dwwd33332",
      "444c44dd3c3332",
      "4444444d333322",
      "33344444333222",
      "222CCCCBBBB111",
      "...444c4333...",
      "...44444c33...",
      "...4c444333...",
      "..444444c332..",
      "..44c4443332..",
      ".444444433322.",
      ".dddddddddddd.",
    ],
    { a: R.red, b: R.gold, d: R.navy },
  );

const sugar: Maker = () =>
  g(
    [
      "....43....",
      "....443...",
      "...4443...",
      "...44433..",
      "..444433..",
      "..4444333.",
      ".44444333.",
      ".444443332",
      "qrrrrrrrrq",
      "cccccbbbba",
      "ccccbbbbba",
      "cccbbbbbaa",
      ".bbbbbaaa.",
    ],
    { a: [P.snow[0], P.snow[1], P.snow[2], P.white], b: R.blue, c: R.red },
    ink.blue,
  );

const candy: Maker = () =>
  g(
    [
      "..rsrsrsrs..",
      ".rsrsrsrsrq.",
      "..BBBBBBBB..",
      "..deeeeeec..",
      ".e43344334c.",
      "de344334432c",
      "de433443342c",
      "de244332443c",
      "de433244332c",
      "de344334432c",
      ".e24334332c.",
      "..cbbbbbbc..",
    ],
    { a: R.autumn, b: R.teal, c: R.red, d: R.straw },
  );

const planks: Maker = () =>
  g(
    [
      "..355555555555",
      "..244434444434",
      "..122222222222",
      ".355555555555.",
      ".244443444444.",
      ".122222222222.",
      "355555555555..",
      "244444443444..",
      "122222222222..",
    ],
    { a: PLANK },
    ink.brown,
  );

const furniture: Maker = () =>
  g(
    [
      "4444443....",
      "43.3.32....",
      "43.3.32....",
      "43.3.32....",
      "43.3.32....",
      "4555555554.",
      "43333333332",
      "32222222221",
      "3.2.....3.2",
      "3.2.....3.2",
      "3.2.....3.2",
      "2.1.....2.1",
    ],
    { a: R.wood },
    ink.brown,
  );

const gunpowder: Maker = () => {
  const p = canvas();
  grid(
    p,
    [
      ".ddddddd.",
      "d4433322c",
      "ccdddcccb",
      "443333222",
      "443333222",
      "ccdddcccb",
      "443333222",
      ".4333222.",
      ".cddccbb.",
      "..33222..",
    ],
    { a: [P.wood[0], P.wood[0], P.wood[1], P.wood[2], P.wood[3]], b: R.iron },
    1,
    1,
  );
  grid(
    p,
    [
      "...sr...",
      "..srqq..",
      ".srqqpq.",
      "srqqqppp",
    ],
    { c: POWDER },
    7,
    11,
  );
  return outline(p, ink.brown);
};

const wine: Maker = () => {
  const p = canvas();
  grid(
    p,
    [
      "..BB..",
      "..cb..",
      "..cb..",
      "..cb..",
      ".cbba.",
      "cbbbba",
      "cDEEDa",
      "cDqqDa",
      "cDDDDa",
      "cbbbba",
      "cbbbba",
      ".aaaa.",
    ],
    { b: R.green, c: R.red, d: [P.parchmentDeep, P.wood[1], P.parchment, P.paper, P.white] },
    1,
    2,
  );
  grid(
    p,
    [
      "w....w",
      "wrrrsw",
      ".rqqr.",
      "..qq..",
      "..ww..",
      "..ww..",
      ".wwww.",
    ],
    { c: R.red },
    9,
    6,
  );
  return outline(p);
};

// ---------------------------------------------------------------- 类别兜底图样

const sack: Maker = () =>
  g(
    [
      "....3..4....",
      ".....343....",
      "....BCCB....",
      "....4443....",
      "...444443...",
      "..44444433..",
      ".4444444332.",
      "444434443322",
      "444444443322",
      "444344433322",
      "444444433322",
      "344444333222",
      ".3333332222.",
    ],
    { a: R.straw, d: R.wood },
    ink.brown,
  );

const bale: Maker = () =>
  g(
    [
      "444C4444C443",
      "434B3434B432",
      "443C4343C332",
      "434B3434B432",
      "443C4343C332",
      "434B3434B432",
      "443C4343C332",
      "333B3333B222",
    ],
    { a: R.straw, d: R.wood },
    ink.brown,
  );

const rock: Maker = () =>
  g(
    [
      "....5544.....",
      "..455544433..",
      ".45544444433.",
      "4455444443332",
      "4544444433322",
      "4444444333222",
      "3444333333222",
      ".33333332221.",
      "..222222211..",
    ],
    { a: R.stone },
  );

const jar: Maker = () =>
  g(
    [
      "...cddc...",
      "...4553...",
      "..544443..",
      ".54444332.",
      "5444443332",
      "5444433322",
      "4444333322",
      ".44333222.",
      "..333222..",
      "...3222...",
      "..332221..",
    ],
    { a: R.brick, b: R.wood },
    ink.brown,
  );

const gem: Maker = () =>
  g(
    [
      "..4455443..",
      ".455w54433.",
      "45554444332",
      "33333333222",
      ".443332221.",
      "..4433221..",
      "...43221...",
      "....321....",
      ".....1.....",
    ],
    { a: R.teal },
    ink.blue,
  );

const parcel: Maker = () =>
  g(
    [
      "5555rs555554",
      "5444rq444443",
      "5444rq444443",
      "5444rq444443",
      "ssssrrrrqqqq",
      "4333rq333332",
      "4333rq333332",
      "4333rq333332",
      "3222qp222221",
    ],
    { a: R.parch, c: R.red },
    ink.brown,
  );

const shot: Maker = () => {
  const p = canvas();
  ball(p, 4.5, 11, 3, 3, IRON5, true);
  ball(p, 11, 11, 3, 3, IRON5, true);
  ball(p, 7.8, 6, 3, 3, IRON5, true);
  return outline(p);
};

/** 商品 key → 专属图样。 */
export const GOOD_ICONS: Record<string, Maker> = {
  grain,
  timber,
  cotton,
  sugarcane,
  iron_ore,
  copper_ore,
  wool,
  cocoons,
  tea,
  spice,
  fish,
  salt,
  fur,
  grapes,
  cocoa,
  tobacco,
  amber,
  pearl,
  coral,
  sulfur,
  saltpeter,
  herbs,
  indigo,
  yarn,
  cloth,
  garments,
  pig_iron,
  ironware,
  cannon: cannonGood,
  raw_silk,
  silk,
  brocade,
  sugar,
  candy,
  planks,
  furniture,
  gunpowder,
  wine,
};

/** 类别 → 通用图样。 */
export const CATEGORY_ICONS: Record<string, Maker> = {
  粮食: sack,
  原料: bale,
  矿产: rock,
  嗜好品: jar,
  奢侈品: gem,
  加工品: parcel,
  军需: shot,
};

/** 未知类别：木箱。 */
export const FALLBACK_GOOD: Maker = () => outline(grid(canvas(), PARTS.CRATE, { a: R.wood }), ink.brown);
