// 寰宇追加的 44 种交易品图标（docs/drafts/goods-expansion.json，key 与草稿一致；数据由 G01 合入寰宇的商品分片）。
// 风格与 goods.ts、goods1502.ts 一致：16×16、透明底、1 像素深色描边、左上受光、2–3 阶明暗；内容画在中间 14×14 内。
// 相近的货靠轮廓与主色区分：香料（小豆蔻是淡青的棱荚、天堂椒是褐荚加红籽堆、番椒是弯红椒）、
// 布（亚麻布是灰白叠层加麻绳、宽幅呢是带绒的粗卷加铅封，旧有的布卷、丝绸不同色）、
// 皮（生牛皮是黑白花斑整张捆绳、鹿皮是钉平的黄褐带白斑、熟皮是红褐带缝线的折片）、
// 珠子（玻璃珠是蓝白红三色一圈、玛瑙珠是橙红大珠一短串）。
import { Px } from "../px";
import { P, R, ball, canvas, grid, ink, leaf, outline, shape, type Ramp } from "./kit";

type Maker = () => Px;
type Pt2 = readonly [number, number];

/** 两色取中（仅用于从调色板派生一阶过渡色）。 */
function mix2(a: string, b: string): string {
  const pa = Number.parseInt(a.slice(1), 16);
  const pb = Number.parseInt(b.slice(1), 16);
  const ch = (s: number) => Math.round((((pa >> s) & 0xff) + ((pb >> s) & 0xff)) / 2);
  return `#${[16, 8, 0].map((s) => ch(s).toString(16).padStart(2, "0")).join("")}`;
}

/** 按受光值取色（与 kit 的球体同一套阈值：最亮一阶留给高光）。 */
function shadeOf(r: Ramp, l: number): string {
  const top = r.length - 1;
  const at = (i: number) => r[Math.max(0, Math.min(top, i))];
  if (l > 0.55) return at(top);
  if (l > 0.0) return at(top - 1);
  if (l > -0.5) return at(top - 2);
  return at(top - 3);
}

/** 二次贝塞尔曲线。 */
function bez(a: Pt2, b: Pt2, c: Pt2): (t: number) => Pt2 {
  return (t) => {
    const u = 1 - t;
    return [u * u * a[0] + 2 * u * t * b[0] + t * t * c[0], u * u * a[1] + 2 * u * t * b[1] + t * t * c[1]];
  };
}

/** 三次贝塞尔曲线。 */
function bez3(a: Pt2, b: Pt2, c: Pt2, d: Pt2): (t: number) => Pt2 {
  return (t) => {
    const u = 1 - t;
    const k0 = u * u * u;
    const k1 = 3 * u * u * t;
    const k2 = 3 * u * t * t;
    const k3 = t * t * t;
    return [k0 * a[0] + k1 * b[0] + k2 * c[0] + k3 * d[0], k0 * a[1] + k1 * b[1] + k2 * c[1] + k3 * d[1]];
  };
}

/**
 * 管状体：沿曲线扫出的圆管（辣椒、兽牙、角、羽毛、毛绺共用）。
 * 每个像素取最近的截面，按截面法线与左上光线的点积得受光值 l（-1…1）；
 * color(t, l, depth) 按曲线位置 t、受光值与离表面的深度取色，返回 null 表示留空。
 */
function tube(
  p: Px,
  at: (t: number) => Pt2,
  rad: (t: number) => number,
  color: (t: number, l: number, depth: number) => string | null,
  steps = 72,
): Px {
  const s: [number, number, number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const [x, y] = at(t);
    s.push([x, y, rad(t), t]);
  }
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      let best = 0;
      let bd = Number.POSITIVE_INFINITY;
      for (let i = 0; i < s.length; i++) {
        const d = Math.hypot(px - s[i][0], py - s[i][1]) - s[i][2];
        if (d < bd) {
          bd = d;
          best = i;
        }
      }
      if (bd > 0) continue;
      const [sx, sy, r, t] = s[best];
      const k = Math.max(0.5, r);
      const l = -(((px - sx) / k) * 0.62 + ((py - sy) / k) * 0.78);
      const c = color(t, l, -bd);
      if (c) p.put(x, y, c);
    }
  }
  return p;
}

/** 确定性的像素噪声（0…n-1），用于斑纹与毛糙的边。 */
function hash(x: number, y: number, n: number): number {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) % n;
}

/**
 * 叠在前面的物件：先画在单独的画布上，再贴到 p 上；物件压住已有内容的那一圈补上深色分界线，
 * 露在外面的边留给最后统一的描边（不会描成两层）。
 */
function piece(p: Px, draw: (q: Px) => void, o: string = ink.deep): Px {
  const q = canvas();
  draw(q);
  const ring = outline(q.clone(), o);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      if (q.isOpaque(x, y)) p.put(x, y, q.get(x, y));
      else if (ring.isOpaque(x, y) && p.isOpaque(x, y)) p.put(x, y, o);
    }
  }
  return p;
}

/** 椭圆内逐像素着色（中心、半轴，f 返回 null 表示不画）。 */
function oval(p: Px, cx: number, cy: number, rx: number, ry: number, f: (dx: number, dy: number, r: number, x: number, y: number) => string | null): Px {
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const dx = (x + 0.5 - cx) / rx;
      const dy = (y + 0.5 - cy) / ry;
      const r = Math.hypot(dx, dy);
      if (r > 1) continue;
      const c = f(dx, dy, r, x, y);
      if (c) p.put(x, y, c);
    }
  }
  return p;
}

// 本文件用到的色阶（全部取自共享调色板，少数过渡色由两阶取中）
const SNOW: Ramp = [P.snow[0], P.snow[1], P.snow[2], P.white];
const PARCH: Ramp = [P.parchmentDeep, P.parchmentDark, P.parchment, P.paper, P.white];
const RED4: Ramp = [P.red[0], P.red[1], P.red[2], P.red[3]];
const BLUE_BEAD: Ramp = [P.cloth.blue[0], P.cloth.blue[1], P.cloth.blue[2], P.sky[3]];
const DATE: Ramp = [P.wood[0], P.brick[0], P.brick[1], P.autumn[1]];
const POT: Ramp = [P.wood[0], P.wood[1], P.wood[2], P.wood[3], P.sand[3]];
const PALM_OIL: Ramp = [P.red[1], P.red[2], P.autumn[2], P.autumn[3], P.lamp[2]];
const FRUIT: Ramp = [P.red[0], P.red[1], P.red[2], P.autumn[2]];
const CURRANT: Ramp = [ink.deep, P.cloth.purple[0], P.cloth.purple[1], P.cloth.purple[2]];
const TREPANG: Ramp = [ink.brown, P.cloth.black[1], P.cloth.brown[0], P.cloth.brown[1]];
const KOLA: Ramp = [P.red[0], P.cloth.crimson[1], P.blossom[0], P.blossom[1], P.blossom[2]];
const AGAVE: Ramp = [P.jade[0], P.jade[1], P.jade[2], P.jade[3], P.jade[4]];
const FIBER: Ramp = [P.straw[1], P.straw[2], P.straw[3], P.paper];
const COIR: Ramp = [P.wood[0], P.wood[1], P.wood[2], P.sand[2], P.sand[3]];
const LAC: Ramp = [P.red[0], P.brick[0], P.brick[1], P.brick[2], P.brick[3]];
const PODG: Ramp = [P.leaf[1], P.leaf[2], mix2(P.leaf[3], P.straw[2]), mix2(P.leaf[4], P.straw[3]), P.lamp[2]];
const ICE: Ramp = [P.snow[0], P.sky[3], P.snow[1], P.snow[2], P.white];
const VELVET: Ramp = [P.cloth.purple[0], P.cloth.purple[1], P.cloth.purple[2]];
const MYRRH: Ramp = [P.red[0], P.brick[0], P.brick[1], P.autumn[1], P.brick[3]];
const HORN: Ramp = [P.wood[1], P.sand[1], P.sand[2], P.sand[3], P.cloth.cream[1]];
const TORT: Ramp = [P.autumn[0], P.autumn[1], P.autumn[2], P.autumn[3], P.gold[4]];
const IVORY: Ramp = [P.parchmentDark, P.parchment, P.paper, P.white];
const GUAIAC: Ramp = [P.leaf[0], mix2(P.leaf[1], P.wood[1]), mix2(P.cloth.green[1], P.straw[0]), mix2(P.cloth.green[2], P.straw[1])];
const VIAL: Ramp = [P.teal[0], P.teal[1], P.teal[2], P.teal[3], P.teal[4]];
const BALSAM: Ramp = [ink.brown, P.cloth.brown[0], P.cloth.brown[1], P.autumn[1]];
const ROOT: Ramp = [P.wood[1], P.straw[0], P.cloth.ochre[1], P.straw[2], P.straw[3]];
const BRONZE: Ramp = [P.wood[0], P.gold[0], P.gold[1], P.cloth.ochre[2], P.gold[3]];
const LEATHER: Ramp = [P.wood[0], P.brick[0], P.brick[1], P.brick[2], P.brick[3]];
const LINEN: Ramp = [P.plaster[0], P.plaster[1], P.plaster[2], P.plaster[3], P.white];
const WOOLEN: Ramp = [P.parchmentDeep, P.parchmentDark, P.parchment, P.cloth.cream[1], P.paper];
const PEWTER: Ramp = [P.stone[0], P.stone[1], P.stone[2], P.stone[3]];
const CARNELIAN: Ramp = [P.red[0], P.red[1], P.red[2], P.autumn[2], P.autumn[3]];
const ROSE: Ramp = [P.red[1], P.blossom[0], P.blossom[1], P.blossom[2]];
const PINK: Ramp = [P.blossom[0], P.blossom[1], P.blossom[2], P.blossom[3]];
const SOAP: Ramp = [P.parchmentDark, mix2(P.parchment, P.leaf[4]), mix2(P.cloth.cream[1], P.leaf[4]), P.cloth.cream[1], P.white];

// ---------------------------------------------------------------- 粮食

/** 沙孤米（西米）：三块方形的西谷饼叠在一片芭蕉叶上，饼面发白、侧边烤黄。 */
const sago: Maker = () =>
  outline(
    grid(
      canvas(),
      [
        "...555555554..",
        "...54s444s43..",
        "...4444s4443..",
        "..5ssssssssr..",
        "..4rrrrrrrrq..",
        "..444444443...",
        "..ssssssssr5..",
        "..rrrrrrrrq4..",
        "...444444443..",
        ".ddssssssssrd.",
        "dddrrrrrrrrqdc",
        "eeeeeeeeeeeec.",
        ".bccccccccccb.",
        "...aaaaaaaa...",
      ],
      { a: PARCH, b: R.leaf, c: R.sand },
      1,
      1,
    ),
    ink.brown,
  );

const DATE_FRUIT = [".43.", "4w32", "4332", "4321", "3221", ".21."];

/** 椰枣：橙黄的果穗梗上垂着一串油亮的深褐椰枣。 */
const dates: Maker = () => {
  const p = canvas();
  p.line(14, 1, 9, 3, P.autumn[3]).line(14, 2, 9, 4, P.autumn[1]);
  for (const [x, y] of [
    [3, 5],
    [7, 4],
    [12, 5],
    [5, 9],
    [9, 9],
  ] as const) {
    p.line(9, 3, x, y, P.autumn[2]);
  }
  for (const [x, y] of [
    [2, 4],
    [6, 3],
    [10, 4],
    [3, 8],
    [7, 9],
    [11, 8],
  ] as const) {
    piece(p, (q) => grid(q, DATE_FRUIT, { a: DATE }, x, y), ink.brown);
  }
  return outline(p, ink.brown);
};

/** 棕榈油：一口阔口陶罐盛满油亮的橙红棕榈油，旁边一小簇红棕榈果。 */
const palm_oil: Maker = () => {
  const p = canvas();
  grid(
    p,
    [
      "..5444443..",
      ".5rsttsrq3.",
      "5rssrrrqqp2",
      "4qrrqqqppp2",
      ".444333322.",
      "..2222211..",
      ".344433322.",
      "34444333322",
      "34443333221",
      "22222222211",
      ".333332221.",
      "..2222111..",
    ],
    { a: POT, c: PALM_OIL },
    1,
    2,
  );
  for (const [x, y] of [
    [12, 8],
    [10, 11],
    [12, 11],
  ] as const) {
    piece(p, (q) => grid(q, [".y.", "434", "432", ".2."], { a: FRUIT }, x, y), ink.brown);
  }
  return outline(p, ink.brown);
};

/** 科林斯葡萄干：一小堆皱缩的深紫小葡萄干，摊在一方白布上。 */
const currants: Maker = () => {
  const p = canvas();
  shape(
    p,
    [
      [1, 10.6],
      [8, 7.4],
      [15, 10.4],
      [8, 14.9],
    ],
    SNOW,
  );
  p.line(2, 11, 8, 14, P.snow[1]).line(9, 14, 14, 11, P.snow[1]);
  // 一颗颗 2×2 的葡萄干堆成矮丘：左上一点高光、右下一点最暗，颗与颗之间就分得开；高光的位置略有不同，显得皱
  const berry = (x: number, y: number) => {
    const lit = x + y < 15;
    const hi = lit ? CURRANT[3] : CURRANT[2];
    const twist = hash(x, y, 3) === 0;
    p.put(x, y, twist ? CURRANT[2] : hi).put(x + 1, y, twist ? hi : CURRANT[2]).put(x, y + 1, CURRANT[1]).put(x + 1, y + 1, CURRANT[0]);
  };
  const rows: [number, number[]][] = [
    [10, [3, 5, 7, 9, 11]],
    [8, [4, 6, 8, 10]],
    [6, [5, 7, 9]],
  ];
  for (const [y, xs] of rows) for (const x of xs) berry(x, y);
  berry(7, 5);
  berry(2, 12);
  berry(12, 12);
  return outline(p, ink.deep);
};

/** 海参：一条晒干的深褐刺参，背上一排肉刺，横躺在竹编的圆托盘上。 */
const sea_cucumber: Maker = () => {
  const p = canvas();
  oval(p, 8, 10.8, 6.8, 3.6, (dx, dy, r, x, y) => {
    if (r > 0.78) return dx + dy < 0 ? P.straw[3] : P.straw[1];
    return (Math.floor(x / 2) + y) % 2 ? P.straw[2] : P.straw[1];
  });
  // 参身：两头收细、斜躺；背上一排浅色的锥形肉刺
  const body = bez([2, 10.6], [6.6, 4.4], [13.4, 5.6]);
  const rad = (t: number) => 0.7 + 1.5 * Math.sin(Math.PI * t) ** 0.6;
  piece(
    p,
    (q) => {
      tube(q, body, rad, (_t, l) => shadeOf(TREPANG, l));
      for (const t of [0.16, 0.34, 0.52, 0.7, 0.86]) {
        const [x, y] = body(t);
        const r = rad(t);
        q.put(Math.floor(x - 0.4), Math.floor(y - r - 0.5), P.cloth.brown[2]);
        q.put(Math.floor(x - 0.4), Math.floor(y - r - 1.5), P.sand[2]);
      }
      for (const t of [0.25, 0.43, 0.61, 0.78]) {
        const [x, y] = body(t);
        q.put(Math.floor(x), Math.floor(y), P.sand[1]);
      }
    },
    ink.brown,
  );
  return outline(p, ink.brown);
};

// ---------------------------------------------------------------- 嗜好品

/** 柯拉果：一只疙疙瘩瘩的青果荚，前面两瓣粉红的柯拉果仁。 */
const kola: Maker = () => {
  const p = canvas();
  const th = (-38 * Math.PI) / 180;
  const cx = 6.2;
  const cy = 6.4;
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const u = (dx * Math.cos(th) + dy * Math.sin(th)) / 5.6;
      const v = (-dx * Math.sin(th) + dy * Math.cos(th)) / 3.5;
      const r = Math.hypot(u, v);
      const a = Math.atan2(v, u);
      if (r > 0.94 + 0.08 * Math.cos(a * 9)) continue;
      const l = -((dx / 5) * 0.62 + (dy / 5) * 0.78);
      let c = shadeOf(R.leaf, l);
      if (Math.abs(v - 0.28) < 0.12 && Math.abs(u) < 0.8) c = P.leaf[1];
      else if (hash(x, y, 5) === 0) c = l > 0 ? P.leaf[4] : P.leaf[1];
      p.put(x, y, c);
    }
  }
  const nut = (cx: number, cy: number, rx: number, ry: number) =>
    piece(p, (q) => {
      ball(q, cx, cy, rx, ry, KOLA);
      q.ellipse(cx - 0.6, cy - 0.5, Math.max(0.5, rx - 1.6), Math.max(0.5, ry - 1.4), P.blossom[2]);
      q.line(Math.floor(cx - rx * 0.4), Math.floor(cy - ry * 0.7), Math.floor(cx + rx * 0.4), Math.floor(cy + ry * 0.7), KOLA[1]);
    });
  nut(7.4, 11.8, 3, 2.4);
  nut(12, 10.6, 2.5, 2.8);
  return outline(p, ink.deep);
};

/** 槟榔：一片心形的青蒌叶，前面半颗剖开的槟榔，露出褐白相间的大理石纹。 */
const betel: Maker = () => {
  const p = canvas();
  const cx = 6.5;
  const cy = 6.8;
  const s = 4.7;
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const u = (x + 0.5 - cx) / s;
      const v = -(y + 0.5 - cy) / s;
      const f = (u * u + v * v - 1) ** 3 - u * u * v * v * v;
      if (f > 0) continue;
      let c: string = u < 0 ? P.leaf[3] : P.leaf[2];
      if (Math.abs(u) > 0.75 || v < -0.75) c = u < 0 ? P.leaf[2] : P.leaf[1];
      if (Math.abs(u) < 0.11 && v < 0.75) c = P.leaf[4];
      // 两道弧形侧脉
      if (Math.abs(Math.hypot(u * 1.1, v - 0.55) - 0.75) < 0.07 && v < 0.6 && v > -0.6) c = u < 0 ? P.leaf[4] : P.leaf[3];
      p.put(x, y, c);
    }
  }
  p.put(6, 12, P.leaf[2]).put(5, 13, P.leaf[1]);
  piece(p, (q) =>
    oval(q, 11.2, 11.2, 3.3, 3.3, (dx, dy, r) => {
      if (r > 0.76) return dx + dy < 0 ? P.autumn[2] : P.autumn[1];
      return Math.sin(Math.atan2(dy, dx) * 5 + r * 5) > 0.25 ? P.wood[2] : dx + dy < 0 ? P.paper : P.sand[4];
    }),
  );
  return outline(p, ink.deep);
};

/** 番椒：两只弯弯的鲜红辣椒，带青绿的蒂与短梗。 */
const chili: Maker = () => {
  const p = canvas();
  const pepper = (a: Pt2, b: Pt2, c: Pt2) => {
    const at = bez(a, b, c);
    tube(
      p,
      at,
      (t) => 2.0 * (1 - t) ** 0.6 + 0.35,
      (_t, l) => shadeOf(RED4, l),
    );
    const [hx, hy] = at(0.25);
    p.put(Math.floor(hx - 1), Math.floor(hy - 0.5), P.red[4]);
    const ax = Math.floor(a[0]);
    const ay = Math.floor(a[1]);
    p.put(ax - 1, ay - 1, P.leaf[3]).put(ax, ay - 1, P.leaf[2]).put(ax + 1, ay - 1, P.leaf[1]);
    p.line(ax, ay - 2, ax + 1, ay - 3, P.leaf[2]);
  };
  pepper([10, 4.6], [10, 10], [14, 10.6]);
  pepper([4.4, 5], [3, 13], [11.5, 13.4]);
  return outline(p, ink.deep);
};

// ---------------------------------------------------------------- 原料

/** 软木：一块拱起的栓皮栎树皮（外侧灰褐粗裂、内层黄褐多孔），前面立着一只软木塞。 */
const cork: Maker = () => {
  const p = canvas();
  for (let x = 1; x <= 10; x++) {
    const top = Math.round(4.2 - 2.4 * Math.sin((Math.PI * (x - 0.5)) / 10));
    const bump = hash(x, 1, 3) === 0 ? -1 : 0;
    for (let y = top + bump; y <= top + 5; y++) {
      const k = y - top;
      let c: string;
      if (k <= 0) c = x % 3 === 0 ? P.stone[1] : P.stone[2];
      else if (k === 1) c = x % 3 === 0 ? ink.brown : P.wood[1];
      else if (k === 2) c = P.sand[3];
      else if (k <= 3) c = P.sand[2];
      else c = P.sand[1];
      if (k >= 2 && hash(x, y, 4) === 0) c = P.sand[0];
      p.put(x, y, c);
    }
  }
  // 软木塞：上小下略收的圆柱，顶面与侧面满是细孔
  piece(
    p,
    (q) => grid(q, ["..5554..", ".55p4443", "45544432", "33333222", "43p33p22", "4p333222", "433p3p22", "4p333221", ".3p3322.", "..32221."], { a: R.sand, c: R.sand }, 6, 5),
    ink.brown,
  );
  return outline(p, ink.brown);
};

/** 生牛皮：一整张黑白花斑的硬生牛皮，腰上捆着两道麻绳。 */
const hides: Maker = () =>
  outline(
    grid(
      canvas(),
      [
        "......54......",
        ".4...5ab3...3.",
        ".44.5aab43.33.",
        "..445aab4bb3..",
        "...CCCCCCCB...",
        "...544aabb3...",
        "...44aaab32...",
        "...4ab44432...",
        "...CCCCCCCB...",
        "...4bb44332...",
        ".44aa44333222.",
        ".4a.343332.22.",
        ".3....32....2.",
        "......22......",
      ],
      { a: PARCH, b: [ink.brown, P.cloth.brown[0], P.cloth.brown[1]], d: R.straw },
      1,
      1,
    ),
    ink.brown,
  );

/** 龙舌兰麻：一束长长的淡草黄纤维挽成一绺，旁边一片带刺的青灰龙舌兰叶。 */
const henequen: Maker = () => {
  const p = canvas();
  leaf(p, 3, 14.2, 7.2, 1.4, 5, AGAVE, true);
  for (let t = 0.2; t < 0.9; t += 0.17) {
    const x = 3 + (7.2 - 3) * t;
    const y = 14.2 + (1.4 - 14.2) * t;
    const half = 2.5 * Math.sin(Math.PI * t) ** 0.8;
    p.put(Math.max(1, Math.floor(x - half - 0.6)), Math.floor(y), P.jade[1]);
    p.put(Math.floor(x + half + 0.6), Math.floor(y + 0.5), P.jade[0]);
  }
  p.put(7, 1, P.wood[0]);
  piece(p, (q) => {
    for (let y = 4; y <= 14; y++) {
      const half = 1 + (y - 4) * 0.3;
      const cx = 11.2;
      for (let x = Math.round(cx - half); x <= Math.round(cx + half); x++) {
        if (x > 14) continue;
        if (y === 14 && x % 2 === 0) continue;
        let c = x % 2 ? FIBER[2] : FIBER[3];
        if (x >= cx + half - 0.5) c = FIBER[1];
        if (hash(x, y, 7) === 0) c = FIBER[0];
        q.put(x, y, c);
      }
    }
    q.rect(10, 1, 3, 2, FIBER[2]).put(11, 1, FIBER[3]).put(10, 1, FIBER[3]);
    q.hline(10, 13, 3, P.wood[1]).put(10, 3, P.wood[2]);
  });
  return outline(p, ink.deep);
};

/** 椰棕：一盘粗糙的褐色椰棕绳，后面半个椰壳，壳里一圈白椰肉。 */
const coir: Maker = () => {
  const p = canvas();
  ball(p, 5.5, 6.2, 4.4, 3.6, R.wood);
  oval(p, 5.5, 4.2, 4.2, 1.9, (_dx, _dy, r) => (r > 0.62 ? P.white : P.parchment));
  for (const [x, y] of [
    [2, 7],
    [4, 8],
    [7, 8],
    [3, 6],
  ] as const) {
    p.put(x, y, P.wood[3]);
  }
  // 椰棕绳：由里往外盘两圈的螺旋，绳股一节节拧着，外圈带毛刺；绳头拖在右下
  const turns = 2.1;
  const coil = (t: number): Pt2 => {
    const a = t * turns * 2 * Math.PI;
    const r = 0.5 + 3.7 * t;
    return [9.8 + Math.cos(a) * r, 10.8 + Math.sin(a) * r * 0.78];
  };
  piece(
    p,
    (q) => {
      tube(
        q,
        coil,
        () => 0.95,
        (t, l, depth) => {
          if (depth < 0.35) return COIR[0];
          const twist = Math.floor(t * 46) % 2 === 0;
          if (l > 0.3) return twist ? COIR[4] : COIR[3];
          if (l > -0.3) return twist ? COIR[3] : COIR[2];
          return COIR[1];
        },
        160,
      );
      q.line(13, 13, 14, 14, COIR[2]).put(14, 13, COIR[3]);
      for (const [x, y] of [
        [6, 9],
        [13, 8],
        [7, 13],
      ] as const) {
        if (q.isOpaque(x, y)) q.put(x, y, COIR[4]);
      }
    },
    ink.brown,
  );
  return outline(p, ink.brown);
};

/** 紫梗（紫胶）：一截细枝上结满疙瘩状的红褐紫胶，底下挂着两滴深红的胶滴。 */
const lac: Maker = () => {
  const p = canvas();
  p.line(1, 12, 14, 4, P.wood[2]).line(1, 13, 14, 5, P.wood[0]);
  p.line(11, 6, 13, 2, P.wood[2]);
  for (const [cx, cy, r] of [
    [3.8, 10, 1.5],
    [5.6, 9.4, 1.8],
    [7.4, 8.2, 1.6],
    [6.4, 7.4, 1.3],
    [9.2, 7.2, 1.8],
    [10.6, 5.6, 1.3],
    [8.4, 9.6, 1.2],
  ] as const) {
    ball(p, cx, cy, r, r, LAC);
  }
  p.put(5, 8, P.white).put(8, 6, P.brick[4]).put(9, 6, P.brick[4]).put(3, 9, P.brick[4]);
  for (const [x, y] of [
    [5, 11],
    [9, 9],
  ] as const) {
    p.put(x, y + 1, P.cloth.crimson[1]).put(x, y + 2, P.red[2]).put(x + 1, y + 2, P.cloth.crimson[0]).put(x, y + 3, P.cloth.crimson[0]).put(x + 1, y + 3, P.red[0]);
  }
  return outline(p, ink.deep);
};

/** 鹿皮：一张四脚钉开、绷成长方的黄褐鹿皮，脊线两侧两行白斑。 */
const deerskin: Maker = () => {
  const p = canvas();
  shape(
    p,
    [
      [1.2, 1.2],
      [4.8, 3.4],
      [6.6, 3.3],
      [7.2, 1.4],
      [8.8, 1.4],
      [9.4, 3.3],
      [11.2, 3.4],
      [14.8, 1.2],
      [12.6, 4.8],
      [12.3, 8],
      [12.6, 11.2],
      [14.8, 14.8],
      [11.2, 12.6],
      [9.4, 12.7],
      [8.6, 14.8],
      [7.4, 14.8],
      [6.6, 12.7],
      [4.8, 12.6],
      [1.2, 14.8],
      [3.4, 11.2],
      [3.7, 8],
      [3.4, 4.8],
    ],
    R.sand,
  );
  p.vline(8, 3, 12, P.sand[1]).vline(7, 3, 12, P.sand[2]);
  for (const [x, y] of [
    [5, 5],
    [5, 8],
    [5, 11],
    [10, 5],
    [10, 8],
    [10, 11],
  ] as const) {
    p.put(x, y, P.paper);
  }
  for (const [x, y] of [
    [1, 1],
    [14, 1],
    [14, 14],
    [1, 14],
  ] as const) {
    p.put(x, y, P.wood[3]);
  }
  return outline(p, ink.brown);
};

/** 安卡拉羊毛：一绺蓬松的长卷安哥拉山羊毛，雪白有光泽，顶上用红绳扎住。 */
const mohair: Maker = () => {
  const p = canvas();
  // 一束斜放的长卷毛：左上的绺根用红绳扎住，四股螺旋状的卷毛（一圈圈斜纹）向右下散开，末梢各自打卷
  const root: Pt2 = [4, 4];
  const lock = (end: Pt2, bend: number, phase: number) =>
    piece(p, (q) =>
      tube(
        q,
        (t) => {
          const dx = end[0] - root[0];
          const dy = end[1] - root[1];
          const n = Math.hypot(dx, dy);
          const w = Math.sin(t * Math.PI * 2.4 + phase) * 0.55 + bend * Math.sin(Math.PI * t);
          return [root[0] + dx * t - (dy / n) * w, root[1] + dy * t + (dx / n) * w];
        },
        (t) => 1.0 + 0.25 * t,
        (t, l) => {
          if (l < -0.55) return P.snow[0];
          const band = Math.floor(t * 10 + l * 1.4 + 9) % 2 === 0;
          if (l > 0.2) return band ? P.white : P.snow[2];
          return band ? P.snow[2] : P.snow[1];
        },
      ),
    );
  lock([13.2, 6.2], -0.6, 0.4);
  lock([7.2, 13.4], 0.6, 1.8);
  lock([12.6, 10.4], -0.3, 2.6);
  lock([10.4, 13], 0.2, 1.1);
  // 绺根：一小撮毛头与两道红绳
  p.put(2, 2, P.white).put(3, 2, P.snow[2]).put(2, 3, P.snow[2]).put(1, 2, P.snow[1]).put(2, 1, P.snow[2]);
  p.line(2, 5, 5, 2, P.red[2]).line(3, 5, 5, 3, P.red[1]).put(1, 6, P.red[2]).put(1, 7, P.red[1]);
  return outline(p, ink.deep);
};

// ---------------------------------------------------------------- 奢侈品

/** 沉香：一块带黑色油脂纹的沉香木片，上面升起一缕灰白的细烟。 */
const agarwood: Maker = () => {
  const p = canvas();
  shape(
    p,
    [
      [1.5, 11],
      [3, 8.5],
      [6, 9],
      [9, 7.6],
      [14.5, 8.6],
      [13.5, 12],
      [9, 14.5],
      [2.5, 14],
    ],
    [ink.brown, P.wood[0], P.wood[1], P.wood[2], P.wood[3]],
  );
  p.line(2, 12, 7, 11, ink.deep).line(7, 11, 13, 10, ink.deep).line(4, 13, 9, 13, ink.deep).line(9, 9, 12, 9, P.wood[0]);
  p.put(4, 10, P.gold[1]).put(11, 11, P.gold[0]);
  // 细烟：两像素宽的一缕 S 形，自木片升起，越往上越淡
  const smoke: [number, number, string, string][] = [
    [8, 7, P.stone[2], P.stone[1]],
    [7, 6, P.stone[3], P.stone[2]],
    [5, 5, P.stone[3], P.stone[3]],
    [5, 4, P.stone[4], P.stone[3]],
    [6, 3, P.stone[4], P.stone[3]],
    [8, 2, P.white, P.stone[4]],
    [9, 1, P.white, P.stone[4]],
  ];
  for (const [x, y, c0, c1] of smoke) p.put(x, y, c0).put(x + 1, y, c1);
  p.put(7, 5, P.stone[2]).put(7, 3, P.stone[3]).put(4, 4, P.stone[4]);
  return outline(p, ink.deep);
};

/** 燕窝：一只半月形的象牙白小盏，由细丝层层织成，盏沿参差。 */
const birds_nest: Maker = () => {
  const p = canvas();
  const NEST: Ramp = [P.parchmentDark, P.cloth.cream[0], P.parchment, P.cloth.cream[1], P.white];
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const dx = (x + 0.5 - 8) / 6.4;
      const rim = (y + 0.5 - 5.6) / 2;
      const low = (y + 0.5 - 5.6) / 7.2;
      const inRim = dx * dx + rim * rim <= 1;
      const inBody = y + 0.5 >= 5.6 && dx * dx + low * low <= 1;
      if (!inRim && !inBody) continue;
      // 参差的盏沿
      if (y <= 3 && hash(x, y, 3) === 0) continue;
      let c: string;
      const cav = ((x + 0.5 - 8) / 5) ** 2 + ((y + 0.5 - 5.4) / 1.2) ** 2 <= 1;
      if (cav) c = hash(x, y, 2) ? NEST[1] : NEST[0];
      else if (inRim && y + 0.5 < 5.6) c = hash(x, y, 4) === 0 ? NEST[3] : NEST[4];
      else {
        const wave = (y + Math.round(Math.sin(x * 0.9) * 0.8)) % 2 === 0;
        const lit = dx < 0.1;
        c = wave ? (lit ? NEST[4] : NEST[3]) : lit ? NEST[3] : NEST[2];
        if (dx > 0.6 || low > 0.85) c = wave ? NEST[2] : NEST[1];
      }
      p.put(x, y, c);
    }
  }
  return outline(p, ink.brown);
};

/** 小豆蔻：三只淡青绿、有棱的小豆蔻荚，前面一只裂开露出黑籽。 */
const cardamom: Maker = () => {
  const p = canvas();
  // 饱满的卵形荚，像一只小瓜：纵向三条浅、深相间的棱，两头圆，尖头一点、果柄一点；ang 是尖头的朝向
  const pod = (cx: number, cy: number, ang: number) =>
    piece(p, (q) => {
      const c = Math.cos(ang);
      const s = Math.sin(ang);
      for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
          const dx = x + 0.5 - cx;
          const dy = y + 0.5 - cy;
          const u = (dx * c + dy * s) / 3.3;
          const v = (-dx * s + dy * c) / 2.3;
          if (u * u + v * v > 1) continue;
          const l = -((dx / 2.6) * 0.62 + (dy / 2.6) * 0.78);
          const i = l > 0.45 ? 4 : l > -0.1 ? 3 : l > -0.6 ? 2 : 1;
          const rib = Math.abs(Math.abs(v) - 0.5) < 0.16;
          q.put(x, y, PODG[rib ? Math.max(0, i - 2) : i]);
        }
      }
      q.put(Math.round(cx + c * 3.7 - 0.5), Math.round(cy + s * 3.7 - 0.5), PODG[1]);
      q.put(Math.round(cx - c * 3.7 - 0.5), Math.round(cy - s * 3.7 - 0.5), P.wood[2]);
    });
  pod(7.6, 3.8, 0);
  pod(11.6, 9.8, (-78 * Math.PI) / 180);
  piece(p, (q) =>
    grid(
      q,
      ["..4.4..", ".45x43.", "45xBx32", "45xxA32", "4xAxx32", ".4xB32.", "..432..", "...y..."],
      { a: PODG, d: [P.cloth.brown[0], P.cloth.brown[1]] },
      2,
      6,
    ),
  );
  return outline(p, ink.deep);
};

/** 金刚石：一颗多面切磨的白钻立在深紫丝绒垫上，闪着星芒。 */
const diamonds: Maker = () => {
  const p = canvas();
  shape(
    p,
    [
      [2.5, 10],
      [13.5, 10],
      [14.9, 14.9],
      [1.1, 14.9],
    ],
    VELVET,
  );
  p.hline(3, 12, 10, P.gold[2]);
  grid(
    p,
    ["..4555543..", ".45w544543.", "45545454343", "32323232321", ".432543231.", "..4325321..", "...43521...", "....421....", ".....1....."],
    { a: ICE },
    2,
    2,
  );
  p.put(13, 2, P.white).put(12, 2, P.lamp[2]).put(14, 2, P.lamp[2]).put(13, 1, P.lamp[2]).put(13, 3, P.lamp[2]);
  return outline(p, ink.blue);
};

/** 没药：几块不规则的红褐色树脂，半透明，迎光处透出橙色。 */
const myrrh: Maker = () => {
  const p = canvas();
  const lumps: Pt2[][] = [
    [
      [5.5, 4.5],
      [8, 2.5],
      [10.5, 4],
      [10, 7.5],
      [6.5, 7.5],
    ],
    [
      [1.5, 8.5],
      [3, 6.5],
      [5, 7.5],
      [4.5, 10],
      [2, 10.5],
    ],
    [
      [10, 8.5],
      [12.5, 6.5],
      [14.5, 8.5],
      [14, 12],
      [11.5, 12],
    ],
    [
      [3, 10],
      [6, 7.5],
      [10, 8],
      [11.5, 11],
      [9.5, 14],
      [4.5, 14],
    ],
  ];
  for (const pts of lumps) piece(p, (q) => shape(q, pts, MYRRH), ink.brown);
  for (const [x, y] of [
    [8, 11],
    [9, 11],
    [8, 12],
    [12, 10],
    [8, 5],
  ] as const) {
    p.put(x, y, P.autumn[2]);
  }
  p.put(5, 9, P.white).put(7, 3, P.white).put(11, 8, P.white);
  return outline(p, ink.brown);
};

/** 灵猫香：一只封了红蜡口的小角筒，前面一柄小骨匙挑着一点黄色的香膏。 */
const civet: Maker = () => {
  const p = canvas();
  const at = bez([2.4, 2.4], [3.2, 9.4], [11.2, 8.2]);
  tube(
    p,
    at,
    (t) => 0.45 + 2.4 * t,
    (t, l) => shadeOf(t < 0.22 ? [ink.brown, P.wood[0], P.wood[1], P.wood[2]] : HORN, l),
  );
  p.ellipse(12, 8, 0.6, 2.4, P.red[2]);
  p.vline(13, 6, 10, P.red[1]).put(12, 6, P.red[3]);
  p.vline(10, 6, 10, P.wood[1]);
  piece(
    p,
    (q) => {
      q.line(7, 13, 13, 12, P.parchment).line(7, 14, 13, 13, P.parchmentDark);
      grid(q, [".453.", "44432", ".322."], { a: R.gold }, 2, 11);
    },
    ink.brown,
  );
  return outline(p, ink.brown);
};

/** 玳瑁：一面拱起的玳瑁背甲，琥珀色甲片上散着深褐的云斑，甲片之间有缝。 */
const tortoiseshell: Maker = () => {
  const p = canvas();
  // 甲片布局：m 缘甲、v 椎甲、c 肋甲、y 甲缝；上缘留出头部的缺口，后缘带锯齿
  const SHELL = [
    "...mm..mm...",
    "..mmmmmmmm..",
    ".mcyvvvvycm.",
    ".mcyvvvvycm.",
    "mccyvvvvyccm",
    "mccyyyyyyccm",
    "mccyvvvvyccm",
    "myyyvvvvyyym",
    "mccyvvvvyccm",
    "mccyyyyyyccm",
    ".mcyvvvvycm.",
    ".mcyvvvvycm.",
    "..mmmmmmmm..",
    "...m.mm.m...",
  ];
  for (const [j, row] of SHELL.entries()) {
    for (let i = 0; i < row.length; i++) {
      const ch = row[i];
      if (ch === ".") continue;
      const x = i + 2;
      const y = j + 1;
      const l = -(((x + 0.5 - 8) / 6) * 0.62 + ((y + 0.5 - 8) / 7) * 0.78);
      let c: string;
      if (ch === "y") c = P.wood[0];
      else if (ch === "m") c = (x + y) % 3 === 0 ? P.cloth.brown[0] : l > 0 ? TORT[3] : TORT[1];
      else {
        // 甲片：琥珀底上散着几团深褐的云斑
        const blot = hash(Math.floor(x / 2), Math.floor((y + 1) / 2), 4) === 0 && hash(x, y, 3) !== 0;
        c = blot ? (l > 0.3 ? P.cloth.brown[1] : P.cloth.brown[0]) : shadeOf(TORT, l + 0.3);
      }
      p.put(x, y, c);
    }
  }
  return outline(p, ink.brown);
};

// ---------------------------------------------------------------- 嗜好品（续）

/** 天堂椒：一只起皱的红褐长荚，尖端一圈萼片，旁边倒出一小堆红褐的细籽。 */
const malagueta: Maker = () => {
  const p = canvas();
  const at = bez([3.4, 3.4], [5, 9], [10.6, 9]);
  tube(
    p,
    at,
    (t) => 0.7 + 2.1 * Math.sin(Math.PI * (0.15 + t * 0.75)) ** 0.8,
    (_t, l) => {
      const stripe = Math.floor(l * 3.5 + 7) % 2 === 0;
      if (l > 0.5) return stripe ? P.wood[3] : P.wood[2];
      if (l > -0.3) return stripe ? P.wood[2] : P.cloth.brown[1];
      return stripe ? P.cloth.brown[1] : P.wood[0];
    },
  );
  p.put(2, 2, P.wood[2]).put(4, 1, P.wood[1]).put(1, 4, P.wood[1]).put(3, 3, P.wood[3]).put(3, 2, P.wood[2]).put(2, 3, P.wood[1]);
  piece(
    p,
    (q) =>
      oval(q, 10.6, 14.8, 4.4, 4.6, (dx, dy, _r, x, y) => {
        if (y > 14) return null;
        const h = hash(x, y, 4);
        const lit = dx + dy < -0.5;
        return h === 0 ? (lit ? P.brick[3] : P.brick[2]) : h === 1 ? P.red[0] : lit ? P.brick[2] : P.brick[1];
      }),
    ink.brown,
  );
  return outline(p, ink.brown);
};

/** 鸵鸟羽：一根大而卷曲的白色鸵鸟羽，根部是黑羽。 */
const ostrich_plumes: Maker = () => {
  const p = canvas();
  // 羽轴自左下的细羽管升起，向右上弯、羽梢垂下打卷；羽枝蓬松，边缘参差；靠近羽管的一段是黑羽
  const at = bez3([4.2, 14.2], [3, 6.4], [8.6, 0.6], [13.8, 5.6]);
  const rad = (t: number) => (t < 0.14 ? 0.5 + t * 2 : 0.8 + 2.4 * Math.sin((Math.PI * (t - 0.08)) / 0.95) ** 0.7);
  tube(p, at, rad, (t, l, depth) => {
    if (t >= 0.14 && depth < 0.6 && hash(Math.floor(t * 50), Math.floor(l * 4 + 9), 2) === 0) return null;
    if (t < 0.14) return l > 0 ? P.paper : P.parchmentDark;
    const black = t < 0.34;
    if (depth > rad(t) - 0.5) return black ? P.stone[1] : P.snow[1];
    const band = Math.floor(t * 26 - depth * 1.6 + 20) % 2 === 0;
    if (black) return l > 0.3 ? P.cloth.black[2] : band ? P.cloth.black[1] : P.cloth.black[0];
    if (l > 0.3) return band ? P.white : P.snow[2];
    if (l > -0.35) return band ? P.snow[2] : P.snow[1];
    return P.snow[0];
  });
  return outline(p, ink.deep);
};

/** 鲟鱼子：一只敞口的小木桶，满满一桶油亮的黑鱼子。 */
const caviar: Maker = () => {
  const p = canvas();
  grid(
    p,
    [".dddddddddc.", "d4433333222c", "ccdddddcccbb", "443333332222", "443333332222", "443333332222", "ccdddddcccbb", ".4433332222.", "..3332222..."],
    { a: R.wood, b: R.iron },
    2,
    6,
  );
  oval(p, 8, 6.6, 5.6, 3.6, (dx, dy, _r, x, y) => {
    if (y > 6) return null;
    const shift = Math.floor(y / 2) % 2;
    const lx = (x + shift) % 2;
    const ly = y % 2;
    const lit = dx + dy < -0.2;
    if (lx === 0 && ly === 0) return lit ? P.white : P.stone[2];
    if (lx === 1 && ly === 1) return ink.deep;
    return P.cloth.black[1];
  });
  return outline(p, ink.brown);
};

/** 海象牙：一根弯弯的黄白海象牙，根部颜色略深，牙面一道浅沟。 */
const walrus_ivory: Maker = () => {
  const p = canvas();
  const at = bez([3.6, 12.4], [4.2, 3.4], [13.6, 2.6]);
  tube(
    p,
    at,
    (t) => 2.2 * (1 - t) ** 0.8 + 0.45,
    (t, l, depth) => {
      if (t < 0.1) return shadeOf([P.parchmentDeep, P.parchmentDark, P.parchment, P.paper], l);
      if (t > 0.18 && t < 0.8 && depth > 0.9 && depth < 1.4) return P.parchmentDark;
      return shadeOf(IVORY, l);
    },
  );
  return outline(p, ink.brown);
};

/** 愈创木：一段截短的木头，端面是致密的青褐心材与一圈黄白边材，旁边一片卷起的刨花。 */
const guaiacum: Maker = () => {
  const p = canvas();
  for (let y = 3; y <= 11; y++) {
    for (let x = 2; x <= 10; x++) {
      if ((x === 2 && (y === 3 || y === 11)) || (y === 3 && x > 9)) continue;
      let c: string = y <= 4 ? P.wood[3] : y <= 8 ? P.wood[2] : P.wood[1];
      if (hash(x, y, 5) === 0 || (x % 3 === 0 && y > 4 && y < 10)) c = P.wood[1];
      p.put(x, y, c);
    }
  }
  oval(p, 10.6, 7.2, 3, 4.3, (dx, dy, r) => {
    if (r > 0.86) return P.wood[1];
    if (r > 0.66) return dx + dy < 0 ? P.straw[3] : P.straw[2];
    if (r > 0.34) return Math.abs(r - 0.5) < 0.06 ? GUAIAC[1] : GUAIAC[3];
    return GUAIAC[2];
  });
  // 两片细刨花
  piece(
    p,
    (q) => {
      q.line(8, 13, 11, 12, P.straw[3]).line(9, 14, 12, 13, P.straw[1]).put(12, 12, P.straw[2]);
      q.line(4, 14, 6, 13, P.straw[3]).put(7, 13, P.straw[2]);
    },
    ink.brown,
  );
  return outline(p, ink.brown);
};

/** 秘鲁香脂：一只深青玻璃小瓶，瓶口挂下浓稠的深褐香脂，滴成一小摊。 */
const balsam: Maker = () => {
  const p = canvas();
  p.hline(4, 8, 2, VIAL[3]).put(4, 2, VIAL[4]).put(8, 2, VIAL[1]);
  for (let y = 3; y <= 5; y++) p.put(5, y, VIAL[3]).put(6, y, VIAL[2]).put(7, y, VIAL[1]);
  for (let y = 6; y <= 13; y++) {
    for (let x = 2; x <= 10; x++) {
      if ((y === 6 || y === 13) && (x === 2 || x === 10)) continue;
      let c: string = x <= 3 ? VIAL[3] : x >= 9 ? VIAL[0] : VIAL[2];
      if (y >= 9 && x > 3 && x < 9) c = x < 6 ? BALSAM[2] : BALSAM[1];
      if (x === 3 && y >= 7 && y <= 11) c = VIAL[4];
      p.put(x, y, c);
    }
  }
  p.put(8, 3, BALSAM[2]).put(9, 3, BALSAM[1]).put(9, 4, BALSAM[1]).put(9, 5, BALSAM[0]);
  for (let y = 6; y <= 12; y++) p.put(11, y, y % 3 === 0 ? BALSAM[3] : BALSAM[1]);
  p.put(10, 5, BALSAM[1]);
  p.hline(10, 14, 14, BALSAM[1]).hline(11, 13, 13, BALSAM[2]).put(12, 13, BALSAM[3]);
  return outline(p, ink.deep);
};

/** 大黄：一块疙瘩状的黄褐干根，切开的一面露出橙色的星状大理石纹。 */
const rhubarb: Maker = () => {
  const p = canvas();
  shape(
    p,
    [
      [1.2, 8.5],
      [2.4, 5.5],
      [1.6, 3.6],
      [4, 3.2],
      [6.5, 2],
      [9.5, 3.4],
      [11, 8],
      [9.5, 12.5],
      [6, 13.8],
      [3.5, 13.4],
      [2.2, 11.5],
    ],
    ROOT,
  );
  p.line(3, 7, 5, 9, P.wood[1]).line(5, 4, 7, 5, P.wood[1]).line(4, 11, 7, 12, P.wood[1]).put(3, 5, P.straw[3]);
  piece(
    p,
    (q) =>
      oval(q, 10.6, 8.8, 3.8, 4.6, (dx, dy, r, x, y) => {
        if (r > 0.8) return dx + dy < 0 ? P.sand[2] : P.sand[1];
        if (Math.abs(r - 0.55) < 0.08) return P.autumn[0];
        const a = Math.atan2(dy, dx);
        if (r < 0.55 && Math.abs(Math.sin(a * 2.5)) < 0.3) return P.red[1];
        if (hash(x, y, 4) === 0) return P.gold[3];
        return dx + dy < 0 ? P.autumn[3] : P.autumn[2];
      }),
    ink.brown,
  );
  return outline(p, ink.brown);
};

// ---------------------------------------------------------------- 矿产

/** 朱砂：一簇朱红的菱面晶体长在暗色母岩上，旁边一只小白碟盛着朱砂粉。 */
const cinnabar: Maker = () => {
  const p = canvas();
  shape(
    p,
    [
      [5, 12],
      [7, 9.5],
      [12, 9.5],
      [14.5, 12],
      [13, 14],
      [6, 14],
    ],
    [P.stone[0], P.stone[1], P.stone[2]],
  );
  const crystal = (top: Pt2, right: Pt2, bot: Pt2, left: Pt2) =>
    piece(p, (q) => {
      q.poly([top, bot, left], P.red[3]);
      q.poly([top, right, bot], P.red[1]);
      q.line(Math.round(top[0]), Math.round(top[1]), Math.round(bot[0]) - 1, Math.round(bot[1]) - 1, P.red[2]);
      q.put(Math.round(top[0]) - 1, Math.round(top[1]) + 1, P.red[4]);
    });
  crystal([5.5, 5], [7.8, 8.4], [6.5, 11.5], [3.8, 8.6]);
  crystal([12.6, 4.4], [14.8, 7.6], [13, 11], [10.8, 8]);
  crystal([9, 1.4], [12.2, 5.6], [10, 11.5], [6.8, 6.4]);
  piece(p, (q) => grid(q, ["..rss..", ".rqqqp.", "dccccbb", ".bbbba."], { b: SNOW, c: RED4 }, 1, 11));
  return outline(p, ink.deep);
};

// ---------------------------------------------------------------- 加工品

const COIN = ["..4554..", ".433332.", "43444232", "534yy232", "434yy232", "33422221", ".322221.", "..2211.."];

/** 铜钱：三枚方孔青铜钱叠成一串，红绳从钱孔穿出，结成一束红穗。 */
const copper_cash: Maker = () => {
  const p = canvas();
  for (const [x, y] of [
    [7, 2],
    [4, 4],
    [1, 6],
  ] as const) {
    piece(p, (q) => grid(q, COIN, { a: BRONZE }, x, y), ink.brown);
  }
  // 前面一枚的钱孔里穿着红绳，绳头垂下一束红穗
  p.put(4, 9, P.red[2]).put(5, 9, P.red[2]).put(4, 10, P.red[1]).put(5, 10, P.red[1]);
  p.line(6, 10, 9, 11, P.red[2]);
  piece(p, (q) => grid(q, [".ss.", "srrq", ".rq.", "rqqp", "qrpq"], { c: RED4 }, 9, 10));
  return outline(p, ink.brown);
};

/** 折扇：一把展开的折扇，竹骨，金箔扇面上画着一道青浪。 */
const folding_fans: Maker = () => {
  const p = canvas();
  const px0 = 8;
  const py0 = 13.6;
  const a0 = (18 * Math.PI) / 180;
  const a1 = (162 * Math.PI) / 180;
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const dx = (x + 0.5 - px0) / 7;
      const dy = -(y + 0.5 - py0) / 11.6;
      const r = Math.hypot(dx, dy);
      const a = Math.atan2(dy, dx);
      if (r > 1 || a < a0 || a > a1) continue;
      const seg = Math.floor(((a - a0) / (a1 - a0)) * 12);
      if (r < 0.46) {
        const mid = a0 + ((seg + 0.5) * (a1 - a0)) / 12;
        if (Math.abs(a - mid) * r * 7 > 0.55 && r > 0.12) continue;
        p.put(x, y, seg % 2 ? P.straw[1] : P.straw[2]);
        continue;
      }
      let c: string = seg % 2 ? P.gold[2] : P.gold[3];
      if (r > 0.92) c = seg % 2 ? P.gold[1] : P.gold[4];
      const wave = 0.66 + 0.06 * Math.sin(a * 22);
      if (r > wave - 0.1 && r < wave + 0.03) c = seg % 2 ? P.cloth.blue[0] : P.cloth.blue[1];
      if (r >= wave + 0.03 && r < wave + 0.09 && Math.sin(a * 22) > 0.3) c = P.white;
      p.put(x, y, c);
    }
  }
  p.put(8, 13, P.wood[1]).put(7, 13, P.gold[3]);
  return outline(p, ink.brown);
};

/** 屏风：一架六扇折屏，曲折地立着，金箔屏面上画着一株墨绿的松。 */
const folding_screens: Maker = () => {
  const p = canvas();
  const tall = new Set([2, 5, 6, 9, 10, 13]);
  for (let x = 2; x <= 13; x++) {
    const panel = Math.floor((x - 2) / 2);
    const y0 = tall.has(x) ? 2 : 3;
    const y1 = tall.has(x) ? 13 : 12;
    const lit = panel % 2 === 0;
    p.put(x, y0, P.cloth.black[1]).put(x, y1, P.cloth.black[1]);
    for (let y = y0 + 1; y < y1; y++) p.put(x, y, lit ? P.gold[3] : P.gold[2]);
  }
  const pine = (x: number) => (Math.floor((x - 2) / 2) % 2 === 0 ? P.leaf[1] : P.leaf[0]);
  for (const [x, y] of [
    [4, 11],
    [5, 10],
    [6, 9],
    [7, 9],
    [8, 8],
    [9, 7],
  ] as const) {
    p.put(x, y, P.wood[0]);
  }
  for (const [x0, x1, y] of [
    [3, 7, 6],
    [4, 6, 5],
    [7, 11, 5],
    [8, 10, 4],
    [9, 12, 8],
    [10, 11, 7],
  ] as const) {
    for (let x = x0; x <= x1; x++) p.put(x, y, pine(x));
  }
  return outline(p, ink.deep);
};

/** 熟皮：对折的一张光滑红褐熟皮，下层露出参差的皮边，上层沿边一道浅色缝线，折角翻出浅色的肉面。 */
const leather: Maker = () => {
  const p = canvas();
  shape(
    p,
    [
      [2.5, 8],
      [13.5, 7],
      [14.6, 10],
      [13.4, 11.4],
      [14.4, 13.8],
      [9, 13.2],
      [6, 14.6],
      [3, 13.6],
    ],
    [P.wood[0], P.brick[0], P.brick[0], P.brick[1]],
  );
  shape(
    p,
    [
      [1.4, 3],
      [12.6, 1.8],
      [13.4, 10.6],
      [2.2, 11.6],
    ],
    LEATHER,
  );
  p.poly(
    [
      [9.2, 1.9],
      [12.6, 1.8],
      [13.1, 6.4],
    ],
    P.sand[3],
  );
  p.line(10, 2, 12, 5, P.sand[4]);
  for (let x = 3; x <= 9; x += 2) p.put(x, 4 - Math.floor((x - 3) / 6), P.sand[4]);
  for (let y = 6; y <= 10; y += 2) p.put(3, y, P.sand[4]);
  for (let x = 5; x <= 11; x += 2) p.put(x, 10, P.sand[3]);
  p.put(4, 6, P.brick[4]).put(5, 5, P.brick[4]).put(6, 5, P.brick[3]);
  return outline(p, ink.brown);
};

/** 亚麻布：一摞叠得整整齐齐的灰白亚麻布，左边是圆的折边，用麻绳十字捆着。 */
const linen: Maker = () => {
  const p = canvas();
  p.rect(3, 3, 10, 2, LINEN[4]).rect(2, 4, 1, 1, LINEN[3]);
  for (let k = 0; k < 3; k++) {
    const y = 5 + k * 3;
    p.rect(2, y, 11, 1, LINEN[3]).rect(2, y + 1, 11, 1, LINEN[2]).rect(2, y + 2, 11, 1, LINEN[1]);
    p.put(1, y + 1, LINEN[3]);
    p.put(13, y, LINEN[2]).put(13, y + 1, LINEN[1]).put(13, y + 2, LINEN[0]);
  }
  for (const x of [5, 10]) for (let y = 3; y <= 13; y++) p.put(x, y, y % 2 ? P.wood[2] : P.wood[1]);
  p.put(7, 2, P.wood[2]).put(8, 2, P.wood[3]).put(6, 1, P.wood[2]).put(9, 1, P.wood[2]);
  return outline(p, ink.brown);
};

/** 宽幅呢：一大卷未染色的厚呢，奶白起绒，卷头是一圈圈厚厚的呢层，下面用细绳挂一枚铅封。 */
const woolens: Maker = () => {
  const p = canvas();
  // 卷身：上亮下暗的圆柱，零星的绒点
  for (let y = 3; y <= 11; y++) {
    for (let x = 1; x <= 9; x++) {
      const k = y <= 3 ? 4 : y <= 5 ? 3 : y <= 8 ? 2 : y <= 10 ? 1 : 0;
      p.put(x, y, WOOLEN[hash(x, y, 5) === 0 && y > 3 && y < 11 ? k - 1 : k]);
    }
  }
  p.put(1, 3, null).put(1, 11, null);
  // 两头的布边（织进去的一道暗红边线），一看就是整匹的布
  for (const x of [2, 7]) for (let y = 3; y <= 11; y++) p.put(x, y, y <= 5 ? P.red[2] : y <= 9 ? P.red[1] : P.red[0]);
  // 卷头：厚呢卷成的两圈，圈间一道暗线，中心是卷芯
  oval(p, 10.6, 7, 3.2, 4.6, (dx, dy, r) => {
    if (r < 0.22) return WOOLEN[0];
    if (Math.abs(r - 0.58) < 0.12) return WOOLEN[1];
    if (r > 0.86) return dx + dy < 0 ? WOOLEN[4] : WOOLEN[2];
    return dx + dy < 0 ? WOOLEN[4] : WOOLEN[3];
  });
  // 铅封：一枚灰色的圆铅片，用细绳挂在卷头下
  piece(
    p,
    (q) => {
      q.put(10, 12, P.wood[1]).put(9, 12, P.wood[2]);
      ball(q, 9.2, 13.6, 1.6, 1.3, PEWTER);
      q.put(9, 13, P.stone[0]);
    },
    ink.brown,
  );
  return outline(p, ink.brown);
};

/** 麦酒：后面一只木桶，前面一只泡沫满溢的锡酒杯。 */
const beer: Maker = () => {
  const p = canvas();
  grid(
    p,
    [".dddddddc.", "d44333322c", "ccdddcccbb", "4443333222", "4443333222", "4443333222", "ccdddcccbb", "4443333222", ".4433322..", ".cddcccb.."],
    { a: R.wood, b: R.iron },
    1,
    2,
  );
  piece(p, (q) => {
    for (let y = 8; y <= 14; y++) {
      for (let x = 7; x <= 12; x++) {
        let c: string = x <= 8 ? PEWTER[3] : x >= 11 ? PEWTER[1] : PEWTER[2];
        if (y === 9 || y === 13) c = PEWTER[1];
        q.put(x, y, c);
      }
    }
    q.vline(13, 9, 12, PEWTER[2]).vline(14, 10, 11, PEWTER[1]).put(14, 9, PEWTER[2]).put(14, 12, PEWTER[1]);
    grid(q, [".4444.", "443433", "343332", "3.3..2"], { a: SNOW }, 7, 5);
  });
  return outline(p, ink.deep);
};

/** 锡器：一面暗银灰的锡盘，前面一只带盖的小锡壶。 */
const pewter: Maker = () => {
  const p = canvas();
  oval(p, 6.6, 6.6, 5.6, 5.6, (dx, dy, r) => {
    const lit = dx + dy < 0;
    if (r > 0.82) return lit ? PEWTER[3] : PEWTER[1];
    if (r > 0.68) return lit ? PEWTER[1] : PEWTER[3];
    if (Math.abs(dx + dy + 0.6) < 0.16 && r < 0.6) return PEWTER[3];
    return PEWTER[2];
  });
  piece(p, (q) => grid(q, [".443.2.", "4433321", ".433233", ".4332.2", ".4332.2", ".4332.2", ".433222", ".4332..", "4433221"], { a: PEWTER }, 8, 6), ink.blue);
  return outline(p, ink.blue);
};

/** 自鸣钟：一座鎏金的小台钟，圆形白表盘，顶上一口小铃。 */
const clocks: Maker = () => {
  const p = canvas();
  p.put(7, 1, P.gold[4]).put(8, 1, P.gold[2]);
  ball(p, 7.5, 4.4, 2.8, 2.2, R.gold);
  for (let y = 5; y <= 13; y++) {
    for (let x = 3; x <= 12; x++) {
      let c: string = x <= 4 ? P.gold[3] : x >= 11 ? P.gold[1] : P.gold[2];
      if (y === 5 || y === 12) c = x >= 11 ? P.gold[2] : P.gold[4];
      if (y === 6 || y === 13) c = P.gold[1];
      p.put(x, y, c);
    }
  }
  p.put(3, 14, P.gold[1]).put(12, 14, P.gold[1]).put(2, 13, P.gold[2]).put(13, 13, P.gold[1]);
  oval(p, 8, 9.4, 2.8, 2.8, (_dx, _dy, r) => (r > 0.78 ? P.parchmentDark : P.white));
  p.put(7, 8, ink.deep).put(7, 9, ink.deep).put(8, 9, ink.deep).put(9, 9, ink.deep);
  return outline(p, ink.brown);
};

/** 玻璃镜：一面长方的小镜子，镶着雕花的鎏金框，镜面一道淡蓝的反光。 */
const mirrors: Maker = () => {
  const p = canvas();
  p.rect(6, 1, 4, 2, P.gold[3]).put(6, 1, P.gold[4]).put(9, 2, P.gold[1]);
  for (let y = 3; y <= 14; y++) {
    for (let x = 3; x <= 12; x++) {
      const edge = Math.min(x - 3, 12 - x, y - 3, 14 - y);
      let c: string;
      if (edge === 0) c = x === 12 || y === 14 ? P.gold[1] : P.gold[3];
      else if (edge === 1) c = x === 11 || y === 13 ? P.gold[2] : P.gold[1];
      else {
        c = P.sky[3];
        if (x === 5 || y === 5) c = P.sky[2];
        if (x + y === 13 || x + y === 14) c = P.white;
        if (x + y === 17) c = P.sky[4];
        if (x >= 10 && y >= 11) c = P.sky[2];
      }
      p.put(x, y, c);
    }
  }
  for (const [x, y] of [
    [3, 3],
    [12, 3],
    [3, 14],
    [12, 14],
  ] as const) {
    p.put(x, y, P.gold[4]);
  }
  return outline(p, ink.brown);
};

/** 玻璃珠：一圈蓝、白、红三色相间的小圆玻璃珠。 */
const glass_beads: Maker = () => {
  const p = canvas();
  const ramps = [BLUE_BEAD, SNOW, RED4];
  const beads: [number, number, Ramp][] = [];
  for (let k = 0; k < 12; k++) {
    const a = ((k * 30 + 15) * Math.PI) / 180;
    beads.push([8 + Math.cos(a) * 5.2, 8 + Math.sin(a) * 5, ramps[k % 3]]);
  }
  beads.sort((a, b) => a[1] - b[1]);
  for (const [x, y, r] of beads) {
    ball(p, x, y, 1.5, 1.5, r);
    p.put(Math.floor(x - 0.6), Math.floor(y - 0.6), P.white);
  }
  return outline(p, ink.deep);
};

/** 玛瑙珠：一短串圆珠与长珠相间的橙红玛瑙珠，半透明，穿在细绳上。 */
const carnelian_beads: Maker = () => {
  const p = canvas();
  const beads: [number, number, number, number][] = [
    [3.4, 4.4, 1.8, 1.8],
    [4.6, 8.4, 1.6, 2.2],
    [8, 10.6, 2.2, 2.2],
    [11.4, 8.4, 1.6, 2.2],
    [12.6, 4.4, 1.8, 1.8],
  ];
  p.line(2, 1, 3, 3, P.wood[2]).line(14, 1, 13, 3, P.wood[2]);
  for (let i = 0; i + 1 < beads.length; i++) p.line(Math.floor(beads[i][0]), Math.floor(beads[i][1]), Math.floor(beads[i + 1][0]), Math.floor(beads[i + 1][1]), P.wood[1]);
  for (const [x, y, rx, ry] of beads) {
    piece(
      p,
      (q) => {
        ball(q, x, y, rx, ry, CARNELIAN);
        q.put(Math.floor(x - rx * 0.5), Math.floor(y - ry * 0.5), P.white);
        q.put(Math.floor(x + rx * 0.3), Math.floor(y + ry * 0.4), P.autumn[3]);
      },
      ink.brown,
    );
  }
  return outline(p, ink.brown);
};

/** 玫瑰水：一只细长颈的玻璃洒瓶，装着粉色的玫瑰水，旁边一朵粉玫瑰。 */
const rosewater: Maker = () => {
  const p = canvas();
  ball(p, 5, 11, 3.6, 3.2, PINK);
  for (let y = 3; y <= 8; y++) p.put(4, y, P.snow[2]).put(5, y, P.blossom[1]);
  p.put(4, 2, P.gold[3]).put(5, 2, P.gold[2]).put(4, 1, P.gold[4]);
  p.put(3, 9, P.white).put(2, 10, P.white).put(2, 11, P.blossom[3]);
  piece(p, (q) => {
    q.line(11, 12, 12, 14, P.leaf[1]);
    leaf(q, 11.5, 12.5, 14.5, 13.5, 2.6, R.leaf, false);
    ball(q, 11.4, 8.6, 2.8, 2.6, ROSE);
    q.put(11, 8, P.red[1]).put(12, 8, P.blossom[0]).put(11, 9, P.blossom[0]).put(10, 7, P.blossom[3]);
  });
  return outline(p, ink.deep);
};

/** 橄榄皂：两块淡奶油色的橄榄皂叠放，上面一块压着圆印，旁边冒着两个皂泡。 */
const soap: Maker = () => {
  const p = canvas();
  const bar = (x: number, y: number, w: number) => {
    p.rect(x + 1, y, w - 2, 1, SOAP[4]);
    p.rect(x, y + 1, w, 2, SOAP[3]);
    p.put(x, y + 1, SOAP[4]);
    p.rect(x, y + 3, w, 1, SOAP[2]);
    p.rect(x + 1, y + 4, w - 2, 1, SOAP[1]);
    p.put(x + w - 1, y + 1, SOAP[2]).put(x + w - 1, y + 2, SOAP[2]).put(x + w - 1, y + 3, SOAP[1]);
  };
  bar(1, 9, 11);
  bar(3, 4, 11);
  p.hline(7, 9, 5, SOAP[1]).put(6, 6, SOAP[1]).put(10, 6, SOAP[1]).hline(7, 9, 7, SOAP[1]).put(8, 6, SOAP[2]);
  for (const [cx, cy, r] of [
    [3.2, 3.2, 2],
    [13.4, 13.2, 1.3],
  ] as const) {
    piece(p, (q) => {
      for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
          const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
          if (d > r + 0.3) continue;
          q.put(x, y, d > r - 0.7 ? P.sky[3] : P.snow[2]);
        }
      }
      q.put(Math.floor(cx - 0.6), Math.floor(cy - 0.6), P.white);
    });
  }
  return outline(p, ink.brown);
};

/** 寰宇追加的 44 种商品（key 同 docs/drafts/goods-expansion.json，按草稿顺序）→ 专属图样。 */
export const GOOD_ICONS_1600: Record<string, Maker> = {
  sago,
  dates,
  palm_oil,
  currants,
  sea_cucumber,
  kola,
  betel,
  chili,
  cork,
  hides,
  henequen,
  coir,
  lac,
  deerskin,
  mohair,
  agarwood,
  birds_nest,
  cardamom,
  diamonds,
  myrrh,
  civet,
  tortoiseshell,
  malagueta,
  ostrich_plumes,
  caviar,
  walrus_ivory,
  guaiacum,
  balsam,
  rhubarb,
  cinnabar,
  copper_cash,
  folding_fans,
  folding_screens,
  leather,
  linen,
  woolens,
  beer,
  pewter,
  clocks,
  mirrors,
  glass_beads,
  carnelian_beads,
  rosewater,
  soap,
};
