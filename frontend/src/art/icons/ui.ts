// 界面图标：状态与资源、季节、功能面板、港口设施、操作。每个都是 16×16、透明底、1 像素深色描边、左上受光。
// 设施图标与 docs/ART.md 第 3 节的招牌图样一致：天平、锚与锤、酒杯、商会旗、钱币、钟、木箱、卷轴与柱、旗。
import { Px } from "../px";
import { P, R, ball, canvas, grid, ink, leaf, outline, shape, stroke } from "./kit";

type Maker = () => Px;

// ---------------------------------------------------------------- 可复用的部件

const ANCHOR = [
  ".....33.....",
  "....3..3....",
  ".....33.....",
  "..34444443..",
  ".....43.....",
  ".....43.....",
  ".....43.....",
  ".....43.....",
  "3....43....3",
  "43...43...32",
  ".43..43..32.",
  "..44434333..",
  "...444333...",
  ".....33.....",
];

const COIN = [
  "....4444.....",
  "..45544443...",
  ".4432222333..",
  ".43233334332.",
  "432335433433.",
  "4323543234332",
  "4323432234332",
  "4323322334332",
  ".432333343322",
  ".33344443332.",
  "..3333333322.",
  "...23333222..",
  ".....2222....",
];

const HOLED_COIN = [
  "....4444.....",
  "..45544443...",
  ".4454444333..",
  ".45444444332.",
  "4534....2333.",
  "4534....23332",
  "4434....23332",
  "4334....23332",
  ".432222223322",
  ".33333333332.",
  "..3333333322.",
  "...23333222..",
  ".....2222....",
];

// ---------------------------------------------------------------- 状态与资源

const coin: Maker = () => outline(grid(canvas(), COIN, { a: R.gold }), ink.brown);

const calendar: Maker = () =>
  outline(
    grid(
      canvas(),
      [
        "...q.....q...",
        ".44r44444r44.",
        ".43333333332.",
        ".32222222221.",
        ".edddddddddc.",
        ".edbdbdbdbdc.",
        ".edddddddddc.",
        ".edbdbd33bdc.",
        ".eddddd32ddc.",
        ".edbdbdbdbdc.",
        ".edddddddddc.",
        ".ccccccccccb.",
      ],
      { a: R.red, b: R.parch, c: R.iron },
    ),
  );

const clock: Maker = () =>
  outline(
    grid(
      canvas(),
      [
        "....4444....",
        "..44eeee43..",
        ".4eeexeeed3.",
        ".4eeexeddd3.",
        "4eeeexeddd32",
        "4eeeexeddd32",
        "4eedexxxdd32",
        "4dddddddcd32",
        ".3dddddddc2.",
        ".3dddddccc2.",
        "..33cccc22..",
        "....2222....",
      ],
      { a: R.gold, b: R.parch },
    ),
    ink.brown,
  );

const wind: Maker = () =>
  outline(
    grid(
      canvas(),
      [
        "........444...",
        ".544...4...4..",
        "...........4..",
        "..........4...",
        "54444444444...",
        "..............",
        "..............",
        "544444444444..",
        "............4.",
        ".........4..4.",
        "..........44..",
      ],
      { a: [P.sky[1], P.sky[2], P.sky[3], P.sky[4], P.white] },
    ),
    ink.blue,
  );

const food: Maker = () =>
  outline(
    grid(
      canvas(),
      [
        "......4444....",
        "....44555443..",
        "...4455544333.",
        "...4455443332.",
        "...4454433322.",
        "...3443333222.",
        "....33333222..",
        "...ed322221...",
        "..edc22211....",
        ".edc..........",
        "eeddc.........",
        "edcc..........",
        ".cc...........",
      ],
      { a: R.brick, b: R.parch },
    ),
    ink.brown,
  );

const water: Maker = () =>
  outline(
    grid(
      canvas(),
      [
        "....44....",
        "...4443...",
        "...4543...",
        "..445443..",
        "..4w5443..",
        ".44w54443.",
        ".4w544433.",
        "44w5444332",
        "4455444332",
        "3445443322",
        ".34444322.",
        "..333322..",
        "...2222...",
      ],
      { a: R.sea },
    ),
    ink.blue,
  );

const morale: Maker = () =>
  outline(
    grid(
      canvas(),
      [
        "..445...433..",
        ".45w54.44443.",
        "4455544444332",
        "4555444443332",
        "4454444433332",
        ".44444333332.",
        "..443333322..",
        "...3333222...",
        "....33222....",
        ".....322.....",
        "......2......",
      ],
      { a: R.red },
    ),
  );

const crew: Maker = () =>
  outline(
    grid(
      canvas(),
      [
        "...cccccc...",
        "..ccbbbbbb..",
        "..aaaaaaaaa.",
        "..aa444443..",
        "..a4444x43..",
        "..a44444444.",
        "...4444443..",
        "...3444422..",
        "....3332....",
        ".DDDDDDDDCC.",
        "bbbbbbbbbbba",
        "DDDDDDDDDCCB",
        "bbbbbbbbbbba",
      ],
      { a: R.skin, b: R.navy, d: R.snow },
    ),
  );

const cannon: Maker = () => {
  const p = canvas();
  // 炮架尾板
  p.line(1, 12, 6, 9, P.wood[3]).line(1, 13, 6, 10, P.wood[1]);
  // 炮管：从炮尾 (2,8) 斜向上到炮口 (13,3)，上亮下暗，三像素粗
  const cols = [P.iron[3], P.iron[2], P.iron[1]];
  for (let k = 0; k < 3; k++) p.line(2, 7 + k, 12, 3 + k, cols[k]);
  p.put(13, 2, P.iron[3]).put(13, 3, P.iron[2]).put(13, 4, P.iron[2]).put(13, 5, P.iron[1]);
  p.put(1, 8, P.iron[2]).put(1, 9, P.iron[1]);
  p.put(6, 6, P.iron[3]).put(6, 7, P.iron[3]);
  // 大轮子：轮辋、辐条、轮毂
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const dx = x + 0.5 - 7.5;
      const dy = y + 0.5 - 10.5;
      const r = Math.hypot(dx, dy);
      if (r > 3.9) continue;
      if (r > 2.7) p.put(x, y, dx + dy < 0 ? P.wood[3] : P.wood[1]);
      else if (Math.abs(dx) < 0.6 || Math.abs(dy) < 0.6) p.put(x, y, P.wood[2]);
    }
  }
  p.put(7, 10, P.iron[3]).put(7, 11, P.iron[1]);
  return outline(p);
};

const cargo: Maker = () =>
  outline(
    grid(
      canvas(),
      [
        "..ddddddd..",
        ".d5544433c.",
        ".ccdddcccb.",
        "45443333322",
        "45443333322",
        "cdddcccbbba",
        "45443333322",
        "45443333322",
        "cdddcccbbba",
        "45443333322",
        ".444333322.",
        ".cddcccbba.",
        "..3332222..",
      ],
      { a: R.wood, b: R.iron },
    ),
    ink.brown,
  );

const star: Maker = () =>
  outline(
    grid(
      canvas(),
      [
        "......5......",
        ".....454.....",
        ".....443.....",
        "....45443....",
        "4455544443332",
        ".45554444332.",
        "..455444332..",
        "...4444432...",
        "...4443332...",
        "..4443.3322..",
        "..443...322..",
        ".443.....322.",
        ".43.......22.",
      ],
      { a: R.gold },
    ),
    ink.brown,
  );

// ---------------------------------------------------------------- 季节

const spring: Maker = () => {
  const p = canvas();
  stroke(p, 8, 11, 7, 14, P.leaf[2]);
  leaf(p, 7.5, 13.5, 12.5, 11, 3, R.leaf);
  const cx = 7.5;
  const cy = 7;
  for (const a of [126, 54, 198, -18, -90]) {
    const t = (a * Math.PI) / 180;
    ball(p, cx + Math.cos(t) * 3.4, cy + Math.sin(t) * 3.4, 2.5, 2.5, R.blossom);
  }
  ball(p, cx, cy, 1.7, 1.7, [P.gold[1], P.gold[2], P.gold[3], P.gold[4]]);
  return outline(p, ink.deep);
};

const summer: Maker = () => {
  const p = canvas();
  const cx = 8;
  const cy = 8;
  for (let k = 0; k < 8; k++) {
    const t = (k * Math.PI) / 4;
    const x0 = cx + Math.cos(t) * 5.2;
    const y0 = cy + Math.sin(t) * 5.2;
    const x1 = cx + Math.cos(t) * 6.9;
    const y1 = cy + Math.sin(t) * 6.9;
    p.line(x0 - 0.5, y0 - 0.5, x1 - 0.5, y1 - 0.5, k % 2 ? P.gold[3] : P.lamp[1]);
  }
  ball(p, cx, cy, 4.2, 4.2, [P.gold[1], P.gold[2], P.gold[3], P.gold[4], P.lamp[2]], true);
  return outline(p, ink.brown);
};

const autumn: Maker = () => {
  const p = canvas();
  const pts: [number, number][] = [
    [8, 0.8],
    [9.3, 4.2],
    [12.4, 2.6],
    [11.5, 6],
    [15, 6.2],
    [12.5, 8.6],
    [13.6, 10.3],
    [9.8, 9.8],
    [8.6, 11.8],
    [8, 10.8],
    [7.4, 11.8],
    [6.2, 9.8],
    [2.4, 10.3],
    [3.5, 8.6],
    [1, 6.2],
    [4.5, 6],
    [3.6, 2.6],
    [6.7, 4.2],
  ];
  shape(p, pts, R.autumn);
  const vein = P.autumn[1];
  p.line(8, 10, 8, 3, vein);
  p.line(8, 9, 11, 5, vein);
  p.line(8, 9, 5, 5, vein);
  p.line(8, 10, 12, 8, vein);
  p.line(8, 10, 4, 8, vein);
  stroke(p, 8, 11, 8, 14, P.wood[2]);
  return outline(p, ink.brown);
};

const winter: Maker = () => {
  const p = canvas();
  const cx = 7.5;
  const cy = 7.5;
  for (let k = 0; k < 6; k++) {
    const t = (k * Math.PI) / 3 + Math.PI / 2;
    const ex = cx + Math.cos(t) * 6.4;
    const ey = cy + Math.sin(t) * 6.4;
    p.line(Math.round(cx), Math.round(cy), Math.round(ex), Math.round(ey), P.white);
    const bx = cx + Math.cos(t) * 3.6;
    const by = cy + Math.sin(t) * 3.6;
    for (const s of [-1, 1]) {
      const u = t + (s * Math.PI) / 3.2;
      p.line(Math.round(bx), Math.round(by), Math.round(bx + Math.cos(u) * 2), Math.round(by + Math.sin(u) * 2), P.sky[4]);
    }
  }
  p.put(7, 7, P.sky[3]).put(8, 8, P.sky[3]).put(7, 8, P.sky[4]).put(8, 7, P.white);
  return outline(p, ink.blue);
};

// ---------------------------------------------------------------- 功能面板

const port: Maker = () => {
  const p = canvas();
  grid(
    p,
    [
      "....4....",
      "...444...",
      "..44433..",
      ".4443333.",
      "444333322",
      ".dcccccb.",
      ".dcpqccb.",
      ".dcqqccb.",
      ".dcccccb.",
      ".dABcccb.",
      ".dABcccb.",
    ],
    { a: R.brick, b: R.plaster, c: R.sky, d: R.wood },
    1,
    1,
  );
  grid(
    p,
    [
      "...33...",
      "..3..3..",
      "...33...",
      ".344443.",
      "...43...",
      "...43...",
      "3..43..3",
      "43.43.32",
      ".444333.",
      "...33...",
    ],
    { a: R.iron },
    7,
    5,
  );
  return outline(p);
};

const fleet: Maker = () =>
  outline(
    grid(
      canvas(),
      [
        "......Arr.....",
        "......Ae......",
        "......Aee.....",
        ".....dAeee....",
        ".....dAeeee...",
        "....ddAeeeee..",
        "....ddAeeeeed.",
        "...dddAeeeeedd",
        "...cccAccccccc",
        "......A.......",
        "54444444444443",
        ".433333333332.",
        "..2222222222..",
      ],
      { a: R.wood, b: R.parch, c: R.red, d: R.wood },
    ),
    ink.brown,
  );

const mate: Maker = () =>
  outline(
    grid(
      canvas(),
      [
        "....AAAA....",
        "...ACCCBA...",
        "..ACBBBBBA..",
        "..AB44444A..",
        "..A4444x43..",
        "..A44444443.",
        "...4444433..",
        "...3344432..",
        "....3333....",
        "..bcc33ccb..",
        ".bcccc3cccb.",
        "bccccrccccba",
        "bccccrcccbba",
      ],
      { a: R.skin, b: R.blue, c: R.gold, d: R.hairBrown },
    ),
  );

const futures: Maker = () => {
  const p = canvas();
  p.rect(1, 3, 12, 11, P.paper).rect(1, 3, 12, 1, P.white).rect(1, 3, 1, 11, P.white);
  p.rect(12, 4, 1, 10, P.parchment).rect(2, 13, 11, 1, P.parchment);
  // 刻度
  for (const y of [6, 9, 12]) p.put(2, y, P.parchmentDark);
  const pts: [number, number][] = [
    [2, 11],
    [4, 9],
    [6, 10],
    [8, 7],
    [10, 8],
    [12, 4],
  ];
  for (let i = 0; i + 1 < pts.length; i++) {
    p.line(pts[i][0], pts[i][1] + 1, pts[i + 1][0], pts[i + 1][1] + 1, P.leaf[1]);
    p.line(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], P.leaf[3]);
  }
  // 箭头
  p.put(11, 2, P.leaf[3]).put(12, 2, P.leaf[3]).put(13, 2, P.leaf[4]).put(13, 3, P.leaf[3]).put(13, 4, P.leaf[2]).put(12, 3, P.leaf[3]);
  return outline(p, ink.brown);
};

/** 行情预测：左边是走过的价格（青），竖虚线是起点，右边是预测（金色虚线）与逐渐变宽的预测区间。 */
const forecast: Maker = () => {
  const p = canvas();
  p.rect(1, 2, 13, 12, P.paper).rect(1, 2, 13, 1, P.white).rect(1, 2, 1, 12, P.white);
  p.rect(13, 3, 1, 11, P.parchment).rect(2, 13, 12, 1, P.parchment);
  // 预测区间：越往后越宽
  const band: [number, number, number][] = [
    [9, 6, 8],
    [10, 5, 9],
    [11, 4, 10],
    [12, 3, 11],
  ];
  for (const [x, y0, y1] of band) for (let y = y0; y <= y1; y++) p.put(x, y, y === y0 || y === y1 ? P.gold[3] : P.gold[4]);
  // 起点的竖虚线
  for (let y = 3; y < 13; y += 2) p.put(8, y, P.parchmentDark);
  // 走过的价格
  const pts: [number, number][] = [
    [2, 10],
    [4, 8],
    [6, 9],
    [8, 7],
  ];
  for (let i = 0; i + 1 < pts.length; i++) {
    p.line(pts[i][0], pts[i][1] + 1, pts[i + 1][0], pts[i + 1][1] + 1, P.teal[1]);
    p.line(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], P.teal[2]);
  }
  // 预测线（虚线）
  p.put(9, 7, P.gold[1]).put(11, 7, P.gold[1]).put(12, 7, P.gold[2]);
  return outline(p, ink.brown);
};

const caravan: Maker = () =>
  outline(
    grid(
      canvas(),
      [
        "..........44..",
        "....444...4443",
        "...45544..43..",
        "..4cdddc4.43..",
        ".44cbbbc44443.",
        "3444444443332.",
        "3344444433322.",
        ".333333322222.",
        "..3.3...3.3...",
        "..3.3...3.3...",
        "..3.3...3.3...",
        "..2.2...2.2...",
      ],
      { a: R.sand, b: R.red },
    ),
    ink.brown,
  );

const industry: Maker = () =>
  outline(
    grid(
      canvas(),
      [
        ".........stt..",
        "........sttts.",
        "..........ss..",
        "..........43..",
        ".b....b...43..",
        ".cb...cb..43..",
        ".ccb..ccb.43..",
        ".cccb.cccb43..",
        "44444444444443",
        "45CC45CC45CC43",
        "44BB44BB44BB33",
        "44444444444433",
        "33333333333332",
      ],
      { a: R.brick, b: R.slate, c: R.stone, d: R.lamp },
    ),
    ink.brown,
  );

const report: Maker = () =>
  outline(
    grid(
      canvas(),
      [
        "12333333333.",
        "12333333333d",
        "12333333333d",
        "1233ssssr33d",
        "1233srrrq33d",
        "1233rqqqq33d",
        "12333333333d",
        "12333333333d",
        "12333333333d",
        "12333333333d",
        "12222222222d",
        ".cdcdcdcdcd.",
        "......rq....",
      ],
      { a: R.green, b: R.parch, c: R.gold },
    ),
  );

const intel: Maker = () =>
  outline(
    grid(
      canvas(),
      [
        "...4444444444.",
        "..455555555543",
        "..322222222221",
        "...5444444443.",
        "...5411111143.",
        "...5444444443.",
        "...5411114443.",
        "...5444444443.",
        "...5411111143.",
        "...5444444443.",
        "..455555555543",
        "..322222222221",
        "...1111111111.",
      ],
      { a: R.parch },
    ),
    ink.brown,
  );

const settings: Maker = () => {
  const p = canvas();
  const cx = 8;
  const cy = 8;
  const ramp = [P.stone[1], P.stone[2], P.stone[3], P.stone[4]];
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const r = Math.hypot(dx, dy);
      const a = Math.atan2(dy, dx);
      const tooth = Math.cos(a * 8) > 0.15;
      if (r < 2.1 || r > (tooth ? 6.9 : 5.3)) continue;
      const l = -(dx * 0.62 + dy * 0.78) / 6;
      let c = l > 0.35 ? ramp[3] : l > -0.1 ? ramp[2] : l > -0.5 ? ramp[1] : ramp[0];
      // 内圈的一道凹槽
      if (r > 3.2 && r < 4.1) c = l > 0 ? ramp[1] : ramp[2];
      p.put(x, y, c);
    }
  }
  return outline(p, ink.deep);
};

const battle: Maker = () => {
  const p = canvas();
  // 一把剑：剑身两像素（亮刃 + 暗刃）、护手、握柄、柄头
  const sword = (flip: boolean) => {
    const X = (x: number) => (flip ? 15 - x : x);
    p.line(X(1), 1, X(9), 9, P.stone[4]);
    p.line(X(2), 1, X(10), 9, P.stone[2]);
    p.put(X(1), 1, P.white);
    p.line(X(7), 12, X(12), 7, P.gold[3]);
    p.line(X(8), 12, X(12), 8, P.gold[2]);
    p.line(X(11), 11, X(12), 12, P.wood[2]);
    p.put(X(13), 13, P.gold[3]).put(X(14), 14, P.gold[2]);
  };
  sword(true);
  sword(false);
  return outline(p);
};

const debug: Maker = () => {
  const p = canvas();
  // 镜柄
  stroke(p, 10, 10, 13, 13, P.wood[3], 2);
  p.line(10, 11, 13, 14, P.wood[1]);
  // 镜片与镜框
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const dx = x + 0.5 - 6.5;
      const dy = y + 0.5 - 6.5;
      const r = Math.hypot(dx, dy);
      if (r > 5.4) continue;
      const l = -(dx * 0.62 + dy * 0.78) / 5;
      if (r > 3.9) p.put(x, y, l > 0.2 ? P.gold[4] : l > -0.3 ? P.gold[3] : P.gold[2]);
      else p.put(x, y, l > 0.45 && r > 1.8 ? P.white : r < 3 && l < -0.2 ? P.sky[3] : P.sky[4]);
    }
  }
  return outline(p, ink.deep);
};

const quest: Maker = () =>
  outline(
    grid(
      canvas(),
      [
        "44444444443...",
        "45555555553...",
        "45222222253...",
        "45555555553...",
        "45222222253...",
        "45555555553...",
        "45222225553...",
        "45555555553...",
        "4555555ddcc...",
        "455555eddccb..",
        "455555ddbbcb..",
        "455555dcbbcb..",
        "333333ccccbb..",
        ".......bbbb...",
      ],
      { a: R.parch, b: R.red },
    ),
    ink.brown,
  );

// ---------------------------------------------------------------- 港口设施（与招牌图样一致）

const market: Maker = () =>
  outline(
    grid(
      canvas(),
      [
        "......55......",
        "......43......",
        ".444444433333.",
        ".3....43....3.",
        ".3....43....3.",
        "44443.43.44432",
        ".333..43..332.",
        "......43......",
        "......43......",
        "......43......",
        "....ddddcc....",
        "...dddddccbb..",
      ],
      { a: R.gold, b: R.wood },
    ),
    ink.brown,
  );

const shipyard: Maker = () => {
  const p = canvas();
  // 锤：木柄斜放在锚后面，方头朝右上
  p.line(4, 13, 11, 6, P.wood[3]).line(5, 13, 12, 6, P.wood[1]);
  const c = [12, 4.2];
  const u = [0.707, 0.707];
  const v = [0.707, -0.707];
  const corner = (a: number, b: number): [number, number] => [c[0] + u[0] * a + v[0] * b, c[1] + u[1] * a + v[1] * b];
  shape(p, [corner(-3.4, -1.9), corner(3.4, -1.9), corner(3.4, 1.9), corner(-3.4, 1.9)], [P.iron[0], P.iron[1], P.iron[2], P.iron[3], P.stone[4]]);
  grid(p, ANCHOR, { a: R.iron }, 1, 1);
  return outline(p, ink.deep);
};

const tavern: Maker = () =>
  outline(
    grid(
      canvas(),
      [
        "..ddd.ddd.....",
        ".ddddcdddb....",
        ".cdcccccbb....",
        ".rsssssrrq....",
        ".454433332rrq.",
        ".454433332..q.",
        ".454433332..q.",
        ".rsssssrrq..q.",
        ".454433332rrq.",
        ".454433332....",
        ".rsssssrrq....",
        ".333322222....",
      ],
      { a: R.wood, b: R.snow, c: R.iron },
    ),
    ink.brown,
  );

const guild: Maker = () =>
  outline(
    grid(
      canvas(),
      [
        "bddddddddccb",
        ".3222222221.",
        ".3222222221.",
        ".322ssrr221.",
        ".322sddr221.",
        ".322rddq221.",
        ".322rqqq221.",
        ".3222222221.",
        ".3cccccccc1.",
        ".3222222221.",
        ".3222222221.",
        ".3222..2221.",
        ".322....221.",
        ".32......21.",
      ],
      { a: R.blue, b: R.gold, c: R.red },
    ),
  );

const bank: Maker = () => outline(grid(canvas(), HOLED_COIN, { a: R.gold }), ink.brown);

const exchange: Maker = () =>
  outline(
    grid(
      canvas(),
      [
        ".....33.....",
        "....3..3....",
        ".....44.....",
        "....4553....",
        "...455443...",
        "...454433...",
        "...454433...",
        "..45444333..",
        "..45443332..",
        ".4544433322.",
        "455444333222",
        "333333222222",
        ".....22.....",
      ],
      { a: R.gold },
    ),
    ink.brown,
  );

const CRATE = [
  "5555555555554",
  "5444444444432",
  "5433333335432",
  "5433333354332",
  "5422222542232",
  "5433335433332",
  "5433354333332",
  "5422542222232",
  "5435433333332",
  "5454333333332",
  "5322222222222",
  "3222222222221",
];

const warehouse: Maker = () => outline(grid(canvas(), CRATE, { a: R.wood }), ink.brown);

const invest: Maker = () => {
  const p = canvas();
  grid(
    p,
    [
      "555555554",
      ".4444443.",
      "..44433..",
      "..54343..",
      "..54343..",
      "..54343..",
      "..54343..",
      "..54343..",
      "..54343..",
      "..54343..",
      ".4444443.",
      "555555554",
      "333333332",
    ],
    { a: R.stone },
    1,
    1,
  );
  grid(
    p,
    [
      ".eeeeee.",
      "edrdddda",
      "ecrcccca",
      ".bbbbbb.",
    ],
    { b: R.parch, c: R.red },
    7,
    9,
  );
  return outline(p);
};

const office: Maker = () =>
  outline(
    grid(
      canvas(),
      [
        ".st..........",
        ".rs..........",
        ".dc4444444433",
        ".dc4444444332",
        ".dc443s443332",
        ".dc44sts43322",
        ".dc443s433322",
        ".dc4433333222",
        ".dc3333322222",
        ".dc..........",
        ".dc..........",
        ".dc..........",
        ".dc..........",
        "cddc.........",
      ],
      { a: R.red, b: R.wood, c: R.gold },
    ),
  );

// ---------------------------------------------------------------- 操作

const sail: Maker = () => {
  // 舵轮：出港、航行
  const p = canvas();
  const cx = 8;
  const cy = 8;
  for (let k = 0; k < 8; k++) {
    const t = (k * Math.PI) / 4 + Math.PI / 8;
    const ex = cx + Math.cos(t) * 6.6;
    const ey = cy + Math.sin(t) * 6.6;
    p.line(Math.floor(cx), Math.floor(cy), Math.floor(ex), Math.floor(ey), P.wood[2]);
    p.put(Math.floor(ex), Math.floor(ey), P.wood[3]);
  }
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const r = Math.hypot(dx, dy);
      const l = -(dx * 0.62 + dy * 0.78) / 5;
      if (r > 3.6 && r < 5.3) p.put(x, y, l > 0.25 ? P.wood[4] : l > -0.2 ? P.wood[3] : P.wood[2]);
      else if (r < 1.8) p.put(x, y, l > 0.1 ? P.gold[4] : P.gold[2]);
    }
  }
  return outline(p, ink.brown);
};

const anchor: Maker = () => outline(grid(canvas(), ANCHOR, { a: R.iron }));

const map: Maker = () => {
  const p = canvas();
  // 三折的羊皮纸：中间一折背光
  p.rect(1, 2, 4, 11, P.paper).rect(5, 3, 4, 11, P.parchment).rect(9, 2, 5, 11, P.paper);
  p.rect(1, 2, 4, 1, P.white).rect(9, 2, 5, 1, P.white).rect(5, 3, 4, 1, P.paper);
  // 陆地与海岸
  for (const [x, y, w] of [
    [2, 4, 3],
    [1, 5, 5],
    [2, 6, 5],
    [3, 7, 3],
    [10, 9, 3],
    [9, 10, 4],
  ] as const) {
    p.rect(x, y, w, 1, x > 8 ? P.leaf[3] : P.leaf[2]);
  }
  // 航线（虚线）与终点红叉
  for (const [x, y] of [
    [3, 11],
    [5, 11],
    [7, 10],
    [8, 8],
    [9, 7],
  ] as const) {
    p.put(x, y, P.red[2]);
  }
  for (const [x, y] of [
    [10, 4],
    [12, 4],
    [11, 5],
    [10, 6],
    [12, 6],
  ] as const) {
    p.put(x, y, P.red[1]);
  }
  return outline(p, ink.brown);
};

const save: Maker = () => {
  const p = canvas();
  // 纸
  p.rect(1, 5, 9, 10, P.paper).rect(1, 5, 9, 1, P.white).rect(9, 6, 1, 9, P.parchment).rect(2, 14, 7, 1, P.parchment);
  for (const y of [8, 10, 12]) p.rect(2, y, 6, 1, P.parchmentDark);
  // 羽毛笔
  leaf(p, 14.2, 1.3, 7.5, 8.5, 4.6, [P.snow[0], P.snow[1], P.snow[2], P.snow[3], P.white], false);
  p.line(14, 2, 6, 10, P.wood[1]);
  p.put(5, 11, ink.deep).put(6, 10, P.wood[1]);
  return outline(p, ink.brown);
};

const load: Maker = () =>
  outline(
    grid(
      canvas(),
      [
        ".44444..44443.",
        "45555533555543",
        "45222533522243",
        "45555533555543",
        "45222533522243",
        "45555533555543",
        "45222533522243",
        "45555533555543",
        "44444433444443",
        "cbbbbbaabbbbba",
        ".aaaaa..aaaaa.",
      ],
      { a: R.parch, b: R.crimson },
    ),
    ink.brown,
  );

const BAR3 = ["555555555554", "333333333332"];
const menu: Maker = () => {
  const p = canvas();
  for (const y of [2, 7, 12]) grid(p, BAR3, { a: R.parch }, 2, y);
  return outline(p, ink.brown);
};

const pause: Maker = () =>
  outline(
    grid(
      canvas(),
      [
        "5555...5555",
        "5443...5443",
        "5443...5443",
        "5443...5443",
        "5443...5443",
        "5443...5443",
        "5443...5443",
        "5443...5443",
        "5443...5443",
        "5443...5443",
        "3332...3332",
      ],
      { a: R.parch },
    ),
    ink.brown,
  );

const play: Maker = () =>
  outline(
    grid(
      canvas(),
      [
        "54........",
        "5444......",
        "544444....",
        "54444444..",
        "544444444.",
        "5444444443",
        "533333332.",
        "53333332..",
        "533332....",
        "5332......",
        "32........",
      ],
      { a: R.parch },
    ),
    ink.brown,
  );

const fast: Maker = () =>
  outline(
    grid(
      canvas(),
      [
        "5.....5......",
        "54....54.....",
        "544...544....",
        "5444..5444...",
        "54444.54444..",
        "544443544443.",
        "53333.53333..",
        "5333..5333...",
        "533...533....",
        "53....53.....",
        "3.....3......",
      ],
      { a: R.parch },
    ),
    ink.brown,
  );

const step: Maker = () =>
  outline(
    grid(
      canvas(),
      [
        "5.......554",
        "54......543",
        "544.....543",
        "5444....543",
        "54444...543",
        "544443..543",
        "53333...543",
        "5333....543",
        "533.....543",
        "53......543",
        "3.......332",
      ],
      { a: R.parch },
    ),
    ink.brown,
  );

const close: Maker = () =>
  outline(
    grid(
      canvas(),
      [
        "54........43",
        "544......443",
        ".444....443.",
        "..444..443..",
        "...444443...",
        "....4443....",
        "....4332....",
        "...333322...",
        "..333..322..",
        ".333....322.",
        "332......322",
        "32........22",
      ],
      { a: R.red },
    ),
  );

// 音乐开关：一对连着符杠的八分音符；关掉时音符变灰、压一道红色斜杠。
const NOTES = [
  "...555555555",
  "...544444443",
  "...53.....53",
  "...53.....53",
  "...53.....53",
  "...53.....53",
  "...53.....53",
  "...53.....53",
  ".5543...5543",
  "54443..54443",
  "54432..54432",
  ".332....332.",
];

const music: Maker = () => outline(grid(canvas(), NOTES, { a: R.gold }), ink.brown);

const music_off: Maker = () => {
  const p = grid(canvas(), NOTES, { a: R.stone });
  for (const [x0, y0, x1, y1, c] of [
    [13, 2, 3, 12, P.red[2]],
    [14, 3, 4, 13, P.red[1]],
  ] as const)
    p.line(x0, y0, x1, y1, c);
  return outline(p, ink.brown);
};

/** 名称 → 画法。 */
export const UI_ICONS = {
  coin,
  calendar,
  clock,
  wind,
  food,
  water,
  morale,
  crew,
  cannon,
  cargo,
  star,
  spring,
  summer,
  autumn,
  winter,
  port,
  fleet,
  mate,
  futures,
  forecast,
  caravan,
  industry,
  report,
  intel,
  settings,
  battle,
  debug,
  quest,
  market,
  shipyard,
  tavern,
  guild,
  bank,
  exchange,
  warehouse,
  invest,
  office,
  sail,
  anchor,
  map,
  save,
  load,
  menu,
  pause,
  play,
  fast,
  step,
  close,
  music,
  music_off,
} as const satisfies Record<string, Maker>;

/** 共享给商品图标的部件。 */
export const PARTS = { CRATE, COIN, ANCHOR };
