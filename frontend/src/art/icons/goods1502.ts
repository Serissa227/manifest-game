// 航海历 1502 年追加的 33 种商品图标（新大陆作物、矿产、奇幻特产与新加工链）。
// 风格与 goods.ts 一致：16×16、透明底、1 像素深色描边、左上受光、2–3 阶明暗；内容画在中间 14×14 内。
import { Px } from "../px";
import { P, R, ball, canvas, grid, ink, leaf, outline, shape, stroke, type Ramp } from "./kit";

type Maker = () => Px;

const g = (rows: readonly string[], ramps: Parameters<typeof grid>[2], o: string = ink.deep): Px => outline(grid(canvas(), rows, ramps), o);

// 本文件用到的色阶（全部取自共享调色板）
const COFFEE: Ramp = [ink.brown, P.cloth.brown[0], P.cloth.brown[1], P.cloth.brown[2], P.sand[2]];
const MAHOGANY: Ramp = [P.wood[0], P.brick[0], P.brick[1], P.brick[2], P.brick[3]];
const HEMP: Ramp = [P.wood[1], P.cloth.ochre[0], P.straw[1], P.straw[2], P.straw[3]];
const BARK: Ramp = [P.brick[0], P.brick[1], P.autumn[1], P.brick[2], P.brick[3]];
const SILVER: Ramp = [P.stone[1], P.stone[2], P.stone[3], P.stone[4], P.white];
const CLAY: Ramp = [P.snow[0], P.snow[1], P.plaster[3], P.snow[2], P.white];
const GLOW: Ramp = [P.teal[1], P.teal[2], P.teal[3], P.teal[4], P.white];
const AMBER_GLASS: Ramp = [P.wood[0], P.autumn[0], P.autumn[1], P.autumn[2], P.autumn[3]];
const BRASS: Ramp = [P.cloth.ochre[0], P.gold[1], P.cloth.ochre[1], P.cloth.ochre[2], P.gold[4]];
const SCARLET: Ramp = [P.red[0], P.cloth.crimson[0], P.red[1], P.red[2], P.red[3]];
const CANVAS: Ramp = [P.parchmentDeep, P.parchmentDark, P.parchment, P.paper, P.white];
const PORCELAIN: Ramp = [P.snow[0], P.snow[1], P.snow[2], P.white];
const GLASS: Ramp = [P.sky[1], P.sky[2], P.sky[3], P.sky[4], P.white];

// ---------------------------------------------------------------- 新大陆作物与原料

/** 玉米：一根金黄的玉米棒，两侧剥开的绿苞叶。 */
const maize: Maker = () =>
  g(
    [
      "....545....",
      "...54543...",
      "...45454...",
      "...54543...",
      "d..45453..b",
      "dc.54543.ba",
      "dcc45453bba",
      ".dc54543ba.",
      ".dcc4543ba.",
      "..dcc43bba.",
      "..ddcc3ba..",
      "...dccbba..",
      "....dcba...",
      ".....cb....",
    ],
    { a: R.gold, b: R.leaf },
    ink.brown,
  );

/** 马铃薯：两块疙瘩状的块茎，带几个芽眼，顶上冒一片小嫩叶。 */
const potato: Maker = () => {
  const p = canvas();
  leaf(p, 10, 5, 13.5, 1.5, 2.6, R.leaf, false);
  ball(p, 10.2, 7.2, 3.6, 3, R.sand);
  ball(p, 6.3, 10, 5.2, 3.8, R.sand);
  ball(p, 3.6, 8.6, 2.2, 2, R.sand);
  for (const [x, y] of [
    [5, 9],
    [8, 11],
    [3, 11],
    [11, 6],
    [9, 8],
  ] as const) {
    p.put(x, y, P.sand[0]).put(x + 1, y, P.sand[1]);
  }
  p.put(4, 7, P.sand[4]).put(5, 7, P.sand[4]);
  return outline(p, ink.brown);
};

/** 咖啡豆：两颗带中缝的深褐色烘豆，后面一枝红果与叶。 */
const coffee: Maker = () => {
  const p = canvas();
  p.line(3, 2, 9, 7, P.wood[2]);
  leaf(p, 4.5, 3.5, 1.8, 7.5, 3, R.leaf, false);
  leaf(p, 7, 5, 11.5, 1.2, 3, R.leaf, false);
  ball(p, 9.4, 7, 1.9, 1.9, R.red, true);
  ball(p, 12, 5.6, 1.7, 1.7, R.red);
  const bean = (cx: number, cy: number) => {
    ball(p, cx, cy, 2.9, 3.6, COFFEE);
    // 中缝：略弯的一道暗线
    for (let y = Math.floor(cy - 2.5); y <= cy + 2.5; y++) p.put(Math.floor(cx + (y - cy) * 0.25), y, ink.brown);
  };
  bean(4.8, 11);
  bean(10.5, 11.5);
  return outline(p, ink.brown);
};

/** 香草荚：一束细长的深褐豆荚用麻绳扎住，旁边一朵淡黄的藤兰花。 */
const vanilla: Maker = () => {
  const p = canvas();
  const pod = (x0: number, y0: number, x1: number, y1: number) => {
    p.line(x0, y0, x1, y1, P.cloth.brown[1]);
    p.line(x0 + 1, y0, x1 + 1, y1, P.cloth.brown[0]);
    p.put(x0, y0, P.cloth.brown[2]);
  };
  pod(2, 4, 6, 14);
  pod(4, 3, 7, 14);
  pod(7, 3, 8, 14);
  pod(10, 5, 9, 14);
  // 麻绳
  p.rect(3, 10, 8, 2, P.straw[2]).rect(3, 11, 8, 1, P.straw[1]);
  // 花：五片乳白花瓣、黄心
  const cx = 11.5;
  const cy = 4;
  for (const a of [-90, -18, 54, 126, 198]) {
    const t = (a * Math.PI) / 180;
    ball(p, cx + Math.cos(t) * 2, cy + Math.sin(t) * 2, 1.4, 1.4, [P.cloth.cream[0], P.cloth.cream[1], P.cloth.cream[2]]);
  }
  p.put(11, 4, P.lamp[1]).put(12, 4, P.gold[2]);
  return outline(p, ink.brown);
};

/** 胭脂虫：仙人掌掌片上趴着几团白绒小虫，右下一碟猩红虫粉。 */
const cochineal: Maker = () => {
  const p = canvas();
  ball(p, 6, 6.5, 4.6, 5.4, R.leaf);
  ball(p, 11.2, 3.4, 2, 2.3, R.leaf);
  // 刺座
  for (const [x, y] of [
    [3, 4],
    [7, 2],
    [2, 8],
    [9, 7],
    [12, 3],
  ] as const) {
    p.put(x, y, P.leaf[4]);
  }
  // 白绒小虫：成团的白絮
  for (const [x, y] of [
    [4, 5],
    [7, 9],
  ] as const) {
    p.put(x, y, P.white).put(x + 1, y, P.snow[2]).put(x, y + 1, P.snow[2]).put(x + 1, y + 1, P.snow[1]).put(x + 2, y + 1, P.snow[2]);
  }
  p.put(10, 3, P.white).put(11, 3, P.snow[2]);
  // 一碟虫粉
  grid(p, ["...443...", "..44333..", "cdddccccb", ".bbbbbba."], { a: SCARLET, b: R.wood }, 6, 11);
  return outline(p, ink.deep);
};

/** 苏木：一段斜放的红心木，截面露出褐色树皮、浅色边材与暗红心材，旁边几片劈下的红木片。 */
const dyewood: Maker = () => {
  const p = canvas();
  // 木身：自左下到右上
  for (let k = 0; k < 9; k++) {
    const x = 2 + k;
    const y = 10 - k * 0.6;
    for (let d = -2; d <= 2; d++) p.put(x, Math.round(y + d), d <= -2 ? P.wood[3] : d >= 2 ? P.wood[0] : d === -1 ? P.wood[2] : P.wood[1]);
  }
  // 截面
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const dx = (x + 0.5 - 11.2) / 2.9;
      const dy = (y + 0.5 - 4.6) / 3.2;
      const r = Math.hypot(dx, dy);
      if (r > 1) continue;
      p.put(x, y, r > 0.8 ? P.wood[1] : r > 0.62 ? P.sand[3] : r > 0.3 ? P.red[1] : P.cloth.crimson[0]);
    }
  }
  p.put(10, 3, P.red[2]);
  // 木片
  p.line(2, 13, 4, 13, P.red[2]).line(3, 14, 5, 14, P.red[0]);
  p.line(8, 13, 10, 12, P.red[2]).line(9, 13, 11, 12, P.red[0]);
  return outline(p, ink.brown);
};

/** 桃花心木：两根上下叠放的红褐色方木，端面有年轮，木面有细密的纹理。 */
const mahogany: Maker = () => {
  const p = canvas();
  const beam = (x: number, y: number, len: number) => {
    p.rect(x + 1, y, len - 1, 1, MAHOGANY[4]);
    p.rect(x, y + 1, len, 3, MAHOGANY[2]);
    p.rect(x, y + 4, len, 1, MAHOGANY[1]);
    p.rect(x, y + 1, 1, 3, MAHOGANY[3]);
    // 细密的波纹
    for (let i = 1; i < len - 1; i++) {
      if ((i + y) % 5 === 0) p.put(x + i, y + 2, MAHOGANY[1]);
      if ((i + y) % 5 === 2) p.put(x + i, y + 3, MAHOGANY[1]);
      if ((i + y) % 7 === 3) p.put(x + i, y + 1, MAHOGANY[3]);
    }
    // 端面年轮
    grid(p, [".cb.", "cdcb", "cdcb", "cbba", ".aa."], { b: [P.brick[1], P.brick[2], P.brick[3], P.sand[3]] }, x + len, y);
  };
  beam(1, 2, 9);
  beam(3, 8, 8);
  return outline(p, ink.brown);
};

/** 亚麻：一束细茎扎在一起，顶上开着天蓝小花。 */
const flax: Maker = () => {
  const p = canvas();
  const tops: [number, number][] = [
    [2, 5],
    [5, 3],
    [8, 2],
    [11, 3],
    [13, 6],
  ];
  for (const [x, y] of tops) p.line(7, 13, x, y + 1, P.leaf[2]);
  p.line(8, 13, 9, 6, P.leaf[1]);
  for (const [x, y] of tops) {
    p.put(x, y, P.cloth.blue[2]).put(x + 1, y, P.cloth.blue[1]).put(x, y + 1, P.cloth.blue[1]).put(x - 1, y, P.cloth.blue[2]);
    p.put(x, y - 1, P.cloth.blue[2]);
    p.put(x, y, P.white);
  }
  p.rect(5, 10, 5, 2, P.straw[2]).rect(5, 11, 5, 1, P.straw[1]);
  p.line(7, 12, 6, 14, P.leaf[2]).line(8, 12, 9, 14, P.leaf[1]);
  return outline(p, ink.deep);
};

/** 粗麻：一捆两头蓬松的麻纤维，中间用褐绳扎紧。 */
const hemp: Maker = () =>
  g(
    [
      ".45.5454.4.",
      "4545454543.",
      "54545454343",
      ".4545454332",
      "..4545433..",
      "...45433...",
      "...BCCBB...",
      "...ABBAA...",
      "...45433...",
      "..4545432..",
      ".454543432.",
      "4545434332.",
      "5454343232.",
      ".4.43.32.2.",
    ],
    { a: HEMP, d: R.wood },
    ink.brown,
  );

/** 金鸡纳树皮：两卷卷成筒的红褐树皮，端口露出卷起的浅色内皮，上面一片叶。 */
const quinine: Maker = () => {
  const p = canvas();
  leaf(p, 5, 4.5, 12, 1.6, 3.2, R.leaf);
  const quill = (x0: number, y0: number, len: number) => {
    for (let i = 0; i < len; i++) {
      const x = x0 + i;
      const y = y0 - Math.round(i * 0.25);
      p.put(x, y - 1, BARK[4]).put(x, y, BARK[3]).put(x, y + 1, BARK[2]).put(x, y + 2, BARK[1]);
      if (i % 4 === 1) p.put(x, y, BARK[2]);
    }
    // 端口：一圈卷起的内皮
    const ex = x0 + len;
    const ey = y0 - Math.round(len * 0.25);
    grid(p, [".dc.", "dca.", "cbdc", ".cc."], { b: [P.brick[0], P.sand[1], P.sand[2], P.sand[3], P.sand[4]] }, ex - 1, ey - 1);
  };
  quill(1, 8, 10);
  quill(2, 12, 10);
  return outline(p, ink.brown);
};

// ---------------------------------------------------------------- 矿产

/** 金矿砂：一块白石英，裂缝里嵌着金脉，旁边散落几粒金块。 */
const gold_ore: Maker = () => {
  const p = canvas();
  shape(
    p,
    [
      [1.5, 11],
      [3, 5],
      [7, 2.5],
      [11.5, 4],
      [13.5, 9],
      [11, 13],
      [4, 13.5],
    ],
    [P.stone[2], P.stone[3], P.plaster[3], P.stone[4], P.white],
  );
  // 金脉
  p.line(3, 9, 7, 6, P.gold[2]).line(7, 6, 10, 7, P.gold[3]).line(6, 11, 10, 9, P.gold[2]);
  p.put(5, 7, P.gold[4]).put(8, 6, P.gold[4]).put(9, 9, P.gold[4]);
  // 金块
  ball(p, 12.6, 12.2, 1.8, 1.6, R.gold, true);
  ball(p, 9.2, 13, 1.3, 1.1, R.gold);
  return outline(p, ink.brown);
};

/** 银矿石：暗青的石块，断面结着一层霜白的银色晶簇。 */
const silver_ore: Maker = () => {
  const p = canvas();
  shape(
    p,
    [
      [1.5, 10],
      [4, 4],
      [9, 2],
      [13.5, 5],
      [14.5, 11],
      [10, 14],
      [4, 13.5],
    ],
    R.slate,
  );
  // 银色晶簇：成团的亮点
  for (const [x, y, c] of [
    [5, 5, P.white],
    [6, 5, SILVER[3]],
    [5, 6, SILVER[2]],
    [7, 4, SILVER[3]],
    [9, 7, P.white],
    [10, 7, SILVER[2]],
    [9, 8, SILVER[3]],
    [4, 9, SILVER[3]],
    [5, 9, P.white],
    [11, 10, SILVER[3]],
    [7, 11, SILVER[2]],
    [8, 10, SILVER[3]],
  ] as const) {
    p.put(x, y, c);
  }
  p.line(3, 11, 6, 13, P.slate[0]).line(12, 6, 13, 9, P.slate[1]);
  return outline(p, ink.blue);
};

/** 宝石原石：石座上长出绿、红、紫三根未切磨的六棱晶柱。 */
const gems: Maker = () => {
  const p = canvas();
  const prism = (x: number, y: number, h: number, ramp: Ramp) => {
    // 左面亮、右面暗，顶端收尖
    p.put(x + 1, y, ramp[ramp.length - 1]);
    p.put(x, y + 1, ramp[ramp.length - 1]).put(x + 1, y + 1, ramp[ramp.length - 2]).put(x + 2, y + 1, ramp[ramp.length - 3]);
    for (let k = 2; k < h; k++) {
      p.put(x, y + k, ramp[ramp.length - 2]).put(x + 1, y + k, ramp[ramp.length - 3]).put(x + 2, y + k, ramp[ramp.length - 4]);
    }
  };
  prism(5, 2, 9, R.jade);
  prism(1, 5, 7, [P.red[0], P.red[1], P.red[2], P.red[3]]);
  prism(9, 4, 8, [P.cloth.purple[0], P.cloth.purple[1], P.cloth.purple[2], P.blossom[1]]);
  prism(12, 8, 4, R.jade);
  p.put(6, 3, P.white);
  grid(p, [".44443333322.", "4444333332221", ".3332222211.."], { a: R.stone }, 1, 11);
  return outline(p, ink.deep);
};

/** 石英砂：一堆洁白的细砂，旁边立着两根透明的石英晶柱，闪着光。 */
const quartz_sand: Maker = () => {
  const p = canvas();
  // 晶柱：左面亮、右面暗，顶端收尖
  const prism = (x: number, y: number, h: number) => {
    p.put(x + 1, y, P.white);
    p.put(x, y + 1, P.white).put(x + 1, y + 1, P.snow[2]).put(x + 2, y + 1, P.snow[1]);
    for (let k = 2; k < h; k++) p.put(x, y + k, P.snow[2]).put(x + 1, y + k, P.sky[4]).put(x + 2, y + k, P.snow[0]);
  };
  prism(9, 2, 9);
  prism(12, 5, 6);
  // 砂堆
  grid(
    p,
    [
      "....5554.....",
      "..55444443...",
      ".5444444333..",
      "544444443332.",
      "4444444333322",
      ".33333322222.",
    ],
    { a: [P.sand[1], P.sand[2], P.sand[3], P.sand[4], P.white] },
    1,
    8,
  );
  for (const [x, y] of [
    [4, 10],
    [7, 11],
    [9, 12],
  ] as const) {
    p.put(x, y, P.white);
  }
  // 闪光
  p.put(6, 4, P.white).put(5, 4, P.lamp[2]).put(7, 4, P.lamp[2]).put(6, 3, P.lamp[2]).put(6, 5, P.lamp[2]);
  return outline(p, ink.brown);
};

/** 星辉晶：一簇自己发光的淡蓝晶体，周围闪着星芒。 */
const star_crystal: Maker = () => {
  const p = canvas();
  const spike = (x0: number, y0: number, x1: number, y1: number, w: number) => {
    shape(
      p,
      [
        [x0 - w, y0],
        [x1, y1],
        [x0 + w, y0],
      ],
      GLOW,
    );
  };
  spike(8, 13, 7.5, 1.5, 2.6);
  spike(5.5, 13, 2.5, 5, 2);
  spike(10.5, 13, 13, 5.5, 2);
  p.line(7, 4, 7, 11, P.white);
  p.rect(3, 12, 10, 2, P.teal[1]).rect(4, 13, 8, 1, P.teal[0]);
  // 星芒
  for (const [x, y] of [
    [12, 2],
    [2, 2],
  ] as const) {
    p.put(x, y, P.white).put(x - 1, y, P.lamp[2]).put(x + 1, y, P.lamp[2]).put(x, y - 1, P.lamp[2]).put(x, y + 1, P.lamp[2]);
  }
  return outline(p, ink.blue);
};

/** 鲸油：立着的油桶，桶身烙着鲸尾标记，桶口滴下一滴金黄的油。 */
const whale_oil: Maker = () => {
  const p = canvas();
  grid(
    p,
    [
      ".dddddddc.",
      "d44333322c",
      "ccdddcccbb",
      "4443333222",
      "44y333y222",
      "44yy3yy222",
      "443yyy3222",
      "4443y33222",
      "ccdddcccbb",
      "4443333222",
      ".4433322..",
      ".cddcccb..",
    ],
    { a: R.wood, b: R.iron },
    1,
    3,
  );
  // 油滴
  grid(p, ["..4..", ".454.", "45543", "44432", ".332."], { a: R.gold }, 10, 1);
  return outline(p, ink.brown);
};

/** 高岭土：三块叠起的洁白瓷土砖，阴面带一点冷灰。 */
const kaolin: Maker = () => {
  const BRICK = [".55554.", "5444443", "4444432", "4344332", "3333322", ".22222."];
  const p = canvas();
  grid(p, BRICK, { a: CLAY }, 1, 9);
  grid(p, BRICK, { a: CLAY }, 8, 9);
  grid(p, BRICK, { a: CLAY }, 4, 4);
  p.put(6, 6, P.snow[1]).put(11, 12, P.snow[1]).put(3, 12, P.snow[1]);
  return outline(p, ink.blue);
};

/** 古代遗物：刻着古文字的残破石板，前面一枚长了铜绿的古币。 */
const relics: Maker = () => {
  const p = canvas();
  grid(
    p,
    [
      "..455555...",
      ".4544444...",
      "4541x1x43..",
      "44444444432",
      "441x1x1x432",
      "44444444432",
      "4411x1x4332",
      "44444443322",
      "4433333332.",
      "33333322...",
    ],
    { a: R.stone },
    1,
    1,
  );
  // 铜绿古币：边缘一圈、中间头像的剪影
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const dx = x + 0.5 - 11;
      const dy = y + 0.5 - 11;
      const r = Math.hypot(dx, dy);
      if (r > 3.6) continue;
      const lit = dx + dy < 0;
      p.put(x, y, r > 2.7 ? (lit ? P.teal[3] : P.teal[1]) : lit ? P.teal[2] : P.teal[1]);
    }
  }
  p.put(10, 10, P.jade[3]).put(11, 10, P.jade[3]).put(10, 11, P.jade[2]).put(11, 12, P.gold[2]);
  return outline(p, ink.deep);
};

// ---------------------------------------------------------------- 加工品

/** 朗姆酒：矮胖的琥珀色洋葱瓶，软木塞、纸标签，旁边一只小木杯。 */
const rum: Maker = () => {
  const p = canvas();
  grid(
    p,
    [
      "...CD...",
      "...BC...",
      "...43...",
      "...43...",
      "..4432..",
      ".454432.",
      "45444322",
      "4eeedc22",
      "4edddc22",
      "4ccccb21",
      ".433221.",
      "..2211..",
    ],
    { a: AMBER_GLASS, b: R.parch, d: R.wood },
    1,
    2,
  );
  grid(p, ["5443", "4332", "4332", "3221"], { a: R.wood }, 10, 10);
  p.put(3, 7, P.autumn[3]);
  return outline(p, ink.brown);
};

/** 巧克力：分格的深褐巧克力板，一半还包着红纸与金边锡纸。 */
const chocolate: Maker = () =>
  g(
    [
      "..........pq..",
      ".555455545pqr.",
      ".544345434qrrs",
      ".543345334qrrs",
      ".444444444qrrs",
      ".555455545qrrs",
      ".544345434qrrs",
      ".543345334qrrs",
      ".433333333qrrs",
      ".5554555453qrs",
      ".54434543432qr",
      ".54334533432q.",
      ".3333333333...",
    ],
    { a: COFFEE, c: [P.gold[1], P.gold[2], P.red[1], P.red[2], P.red[3]] },
    ink.brown,
  );

/** 雪茄：三支并排斜放的雪茄，靠近烟嘴处箍着金红烟标，一支点着。 */
const cigars: Maker = () => {
  const p = canvas();
  const cigar = (x: number, y: number, lit: boolean) => {
    for (let i = 0; i < 11; i++) {
      const cx = x + i;
      const cy = y - Math.round(i * 0.5);
      p.put(cx, cy - 1, P.cloth.brown[2]).put(cx, cy, P.cloth.brown[1]).put(cx, cy + 1, P.cloth.brown[0]);
      if (i === 2 || i === 3) p.put(cx, cy - 1, P.gold[3]).put(cx, cy, P.red[2]).put(cx, cy + 1, P.red[1]);
    }
    const ex = x + 11;
    const ey = y - 6;
    if (lit) p.put(ex, ey - 1, P.stone[3]).put(ex, ey, P.red[3]).put(ex, ey + 1, P.stone[2]);
    else p.put(ex, ey, P.cloth.brown[0]);
  };
  cigar(1, 7, false);
  cigar(2, 10, true);
  cigar(3, 13, false);
  return outline(p, ink.brown);
};

const GOLD_BAR = ["..55555554..", ".5444444443.", "544444444432", "333333333222", ".2222222221."];

/** 金锭：两块金锭叠放，上面一块打着熔铸所的印记。 */
const gold_ingot: Maker = () => {
  const p = canvas();
  grid(p, GOLD_BAR, { a: R.gold }, 1, 9);
  grid(p, GOLD_BAR, { a: R.gold }, 3, 4);
  // 印记：熔铸所的王冠戳
  p.put(7, 6, P.gold[1]).put(9, 6, P.gold[1]).put(11, 6, P.gold[1]).put(8, 7, P.gold[1]).put(9, 7, P.gold[1]).put(10, 7, P.gold[1]);
  p.put(5, 5, P.white);
  return outline(p, ink.brown);
};

/** 银锭：三块银锭错落地叠成一摞，最上面一块打着印记。 */
const silver_ingot: Maker = () => {
  const p = canvas();
  const bar = (x: number, y: number, w: number) => {
    p.rect(x + 1, y, w - 2, 1, SILVER[4]);
    p.rect(x, y + 1, w, 1, SILVER[3]);
    p.put(x, y + 1, SILVER[4]);
    p.rect(x, y + 2, w, 1, SILVER[2]);
    p.rect(x + 1, y + 3, w - 2, 1, SILVER[0]);
  };
  bar(1, 10, 12);
  bar(3, 6, 12);
  bar(1, 2, 12);
  p.rect(5, 3, 4, 1, SILVER[2]).put(5, 3, SILVER[1]);
  return outline(p, ink.blue);
};

/** 珠宝：一串金链坠着红宝石，前面一枚镶蓝宝石的金戒指。 */
const jewelry: Maker = () => {
  const p = canvas();
  // 金链：自左上垂成弧形
  for (let i = 0; i <= 12; i++) {
    const x = 1 + i;
    const y = Math.round(1 + 6 * Math.sin((Math.PI * i) / 12));
    p.put(x, y, i % 2 ? P.gold[2] : P.gold[4]);
  }
  // 吊坠：金托红宝石
  grid(p, [".cc.", "c55c", "c43b", ".bb."], { a: R.red, b: R.gold }, 5, 7);
  // 戒指
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const dx = (x + 0.5 - 11) / 3;
      const dy = (y + 0.5 - 12) / 2.2;
      const r = Math.hypot(dx, dy);
      if (r > 1 || r < 0.55) continue;
      p.put(x, y, dx + dy < 0 ? P.gold[3] : P.gold[1]);
    }
  }
  grid(p, [".4.", "453", ".3."], { a: [P.cloth.blue[0], P.cloth.blue[1], P.cloth.blue[2], P.sky[3], P.white] }, 10, 7);
  return outline(p, ink.brown);
};

/** 猩红呢绒：搭在木杆上垂下的一幅猩红呢绒，布面有竖褶，下摆镶金边。 */
const scarlet_cloth: Maker = () => {
  const p = canvas();
  // 布：自木杆垂下，竖褶左亮右暗
  for (let y = 3; y <= 13; y++) {
    const sway = y > 10 ? (y - 10) % 2 : 0;
    for (let x = 3; x <= 12; x++) {
      const k = (x - 3 + sway) % 3;
      let c = k === 0 ? SCARLET[4] : k === 1 ? SCARLET[2] : SCARLET[1];
      if (x === 12) c = SCARLET[0];
      if (y === 3) c = SCARLET[3];
      p.put(x, y, c);
    }
  }
  // 下摆的金边与流苏
  p.hline(3, 12, 12, P.gold[3]).hline(3, 12, 13, P.gold[1]);
  for (const x of [3, 6, 9, 12]) p.put(x, 14, P.gold[2]);
  // 木杆
  p.hline(1, 14, 2, P.wood[3]).hline(1, 14, 3, P.wood[1]);
  p.put(1, 2, P.gold[3]).put(14, 2, P.gold[3]).put(1, 3, P.gold[1]).put(14, 3, P.gold[1]);
  return outline(p, ink.deep);
};

/** 帆布：一面挂在短桁上的三角帆布，缝着加强的布缝，边上一排索眼。 */
const sailcloth: Maker = () => {
  const p = canvas();
  shape(
    p,
    [
      [2, 3],
      [13.5, 3],
      [3, 14.5],
    ],
    CANVAS,
  );
  // 布缝
  for (const x of [5, 8, 11]) p.line(x, 4, x - Math.round((x - 2) * 0.1), Math.round(3 + (13.5 - x) * 1.05), P.parchmentDark);
  // 索眼
  for (const [x, y] of [
    [3, 5],
    [3, 8],
    [3, 11],
  ] as const) {
    p.put(x, y, P.wood[1]);
  }
  // 帆桁
  stroke(p, 1, 2, 14, 2, P.wood[3]);
  p.line(1, 1, 14, 1, P.wood[4]).put(14, 2, P.wood[1]);
  return outline(p, ink.brown);
};

/** 缆绳：盘成一圈圈的粗麻绳，一头松开搭在外面。 */
const rope: Maker = () => {
  const p = canvas();
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const dx = (x + 0.5 - 8) / 6.4;
      const dy = (y + 0.5 - 8.5) / 4.6;
      const r = Math.hypot(dx, dy);
      if (r > 1 || r < 0.22) continue;
      // 一圈圈的绳：按半径分环，每环上亮下暗，环缝暗
      const ring = r * 3.4;
      const f = ring - Math.floor(ring);
      const lit = dy < 0.1;
      let c = f < 0.25 ? HEMP[1] : lit ? (f < 0.6 ? HEMP[4] : HEMP[3]) : f < 0.6 ? HEMP[3] : HEMP[2];
      // 绳股的斜纹
      if (f >= 0.25 && (x + y) % 3 === 0) c = HEMP[2];
      p.put(x, y, c);
    }
  }
  // 松开的绳头
  p.line(12, 11, 14, 13, HEMP[3]).line(11, 12, 13, 14, HEMP[1]);
  p.put(14, 13, HEMP[4]);
  return outline(p, ink.brown);
};

/** 药剂：圆肚的蓝玻璃药瓶，软木塞与系绳的纸签，旁边一枝药草。 */
const medicine: Maker = () => {
  const p = canvas();
  leaf(p, 11, 13, 13.4, 5, 3, R.leaf);
  grid(
    p,
    [
      "...BC...",
      "..ABCB..",
      "...43...",
      "...32...",
      "..4432..",
      ".453322.",
      "45wee322",
      "44eddc22",
      "44dddc21",
      "34cccb21",
      ".322211.",
      "..2111..",
    ],
    { a: [ink.blue, P.cloth.blue[0], P.cloth.blue[1], P.cloth.blue[2], P.sky[3]], b: R.parch, d: R.wood },
    2,
    2,
  );
  p.put(5, 9, P.red[1]).put(6, 9, P.red[1]);
  return outline(p, ink.deep);
};

/** 黄铜：一只黄铜烛台（托盘、葫芦形烛柱、接蜡盘），比金色暗一点、偏橄榄。 */
const brass: Maker = () =>
  g(
    [
      ".54444443.",
      "3222222221",
      "...5443...",
      "....43....",
      "...5433...",
      "..544332..",
      "...5432...",
      "....43....",
      "...5433...",
      "..544432..",
      ".54444432.",
      "5444443332",
      "3333332221",
    ],
    { a: BRASS },
    ink.brown,
  );

/** 玻璃：两块斜靠的淡蓝玻璃板，板面有白色斜向反光。 */
const glass: Maker = () => {
  const p = canvas();
  const pane = (x: number, y: number, w: number, h: number) => {
    for (let yy = 0; yy < h; yy++) {
      for (let xx = 0; xx < w; xx++) {
        const edge = xx === 0 || yy === 0;
        const dark = xx === w - 1 || yy === h - 1;
        let c = edge ? GLASS[4] : dark ? GLASS[1] : GLASS[3];
        if (!edge && !dark && (xx + yy) % 7 === 2) c = GLASS[4];
        if (!edge && !dark && (xx + yy) % 7 === 3) c = P.white;
        if (!edge && !dark && (xx - yy + 20) % 9 === 0) c = GLASS[2];
        p.put(x + xx, y + yy, c);
      }
    }
  };
  pane(1, 2, 9, 11);
  pane(6, 5, 9, 10);
  return outline(p, ink.blue);
};

/** 航海仪器：挂环吊着的黄铜星盘，盘里是镂空的星网，一根照准规斜穿盘面。 */
const instruments: Maker = () => {
  const p = canvas();
  const cx = 8;
  const cy = 9;
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const r = Math.hypot(dx, dy);
      if (r > 5.8) continue;
      const lit = dx * 0.62 + dy * 0.78 < 0;
      if (r > 4.4) p.put(x, y, lit ? P.gold[3] : P.gold[1]);
      else if (r > 3.6) p.put(x, y, P.gold[0]);
      else if (Math.abs(dx - dy * 0.3) < 0.6 || Math.abs(r - 2.2) < 0.45) p.put(x, y, lit ? P.gold[2] : P.gold[1]);
      else p.put(x, y, P.cloth.navy[1]);
    }
  }
  // 照准规
  p.line(3, 13, 13, 5, P.gold[4]).line(4, 13, 13, 6, P.gold[1]);
  p.put(8, 9, P.white);
  // 挂环
  p.put(7, 1, P.gold[3]).put(8, 1, P.gold[2]).put(6, 2, P.gold[3]).put(9, 2, P.gold[1]).put(7, 3, P.gold[2]).put(8, 3, P.gold[1]);
  // 星网上的几颗星
  p.put(6, 7, P.lamp[2]).put(10, 11, P.lamp[2]).put(10, 7, P.lamp[1]);
  return outline(p, ink.brown);
};

/** 星辉灯：黄铜提灯里嵌着一颗发光的星辉晶，灯罩内一片淡蓝的光。 */
const crystal_lamp: Maker = () =>
  g(
    [
      "....543....",
      "...5..3....",
      "...5432....",
      "..5444332..",
      ".2222222211",
      ".4qrsrq2...",
      ".4rstsr2..w",
      ".4stwts2.w.",
      ".4rstsr2...",
      ".4qrsrq2w..",
      ".5444433...",
      "5444443332.",
      "3333322221.",
    ],
    { a: BRASS, c: GLOW },
    ink.brown,
  );

/** 瓷器：白底青花的长颈瓶，瓶肩一道回纹，瓶腹一枝缠枝花。 */
const porcelain: Maker = () =>
  g(
    [
      "...qrrq...",
      "....44....",
      "....43....",
      "...5443...",
      "..544433..",
      ".qrqrqrqp.",
      ".54444333.",
      "5444rr4332",
      "544r44r332",
      "44r4qq4r32",
      "444rq4r332",
      ".4444r332.",
      "..443332..",
      "..qrrrrq..",
    ],
    { a: PORCELAIN, c: [ink.blue, P.cloth.navy[1], P.cloth.blue[0], P.cloth.blue[1], P.cloth.blue[2]] },
    ink.blue,
  );

/** 追加的 33 种商品（key 同 goods.toml）→ 专属图样。 */
export const GOOD_ICONS_1502: Record<string, Maker> = {
  maize,
  potato,
  coffee,
  vanilla,
  cochineal,
  dyewood,
  mahogany,
  flax,
  hemp,
  quinine,
  gold_ore,
  silver_ore,
  gems,
  quartz_sand,
  star_crystal,
  whale_oil,
  kaolin,
  relics,
  rum,
  chocolate,
  cigars,
  gold_ingot,
  silver_ingot,
  jewelry,
  scarlet_cloth,
  sailcloth,
  rope,
  medicine,
  brass,
  glass,
  instruments,
  crystal_lamp,
  porcelain,
};
