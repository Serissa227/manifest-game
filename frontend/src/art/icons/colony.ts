// 航海历 1502 年追加的界面图标：殖民、探险与组合事件，以及 14 种殖民建筑（与 data/colony.toml 的建筑 key 对应）。
// 风格与 ui.ts 一致：16×16、透明底、1 像素深色描边、左上受光；内容画在中间 14×14 内。
import { Px } from "../px";
import { P, R, ball, canvas, grid, ink, leaf, outline, shape, type Ramp } from "./kit";

type Maker = () => Px;

const COPPER: Ramp = [P.brick[0], P.brick[1], P.autumn[1], P.autumn[2], P.autumn[3]];

/** 带光影的椭圆盘（光在左上）：r 以内按受光取色。 */
function disc(p: Px, cx: number, cy: number, rx: number, ry: number, pick: (lit: number, r: number) => string | null): Px {
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const dx = (x + 0.5 - cx) / rx;
      const dy = (y + 0.5 - cy) / ry;
      const r = Math.hypot(dx, dy);
      if (r > 1) continue;
      const c = pick(-(dx * 0.62 + dy * 0.78), r);
      if (c) p.put(x, y, c);
    }
  }
  return p;
}

/** 原木墙：横放的圆木一根根叠起，两端露出木头截面。 */
function logWall(p: Px, x: number, y: number, w: number, h: number): void {
  for (let k = 0; k < h; k++) {
    const yy = y + k;
    p.rect(x, yy, w, 1, k % 2 === 0 ? P.wood[3] : P.wood[2]);
    p.put(x, yy, k % 2 === 0 ? P.wood[4] : P.sand[3]);
    p.put(x + w - 1, yy, k % 2 === 0 ? P.wood[2] : P.wood[1]);
  }
}

// ---------------------------------------------------------------- 殖民与探险

/** 殖民地：插着旗的木屋。 */
const colony: Maker = () => {
  const p = canvas();
  shape(
    p,
    [
      [4, 8.5],
      [9.5, 3],
      [15, 8.5],
    ],
    R.brick,
  );
  logWall(p, 5, 8, 9, 6);
  p.rect(9, 10, 2, 4, P.wood[0]).put(9, 10, P.wood[1]);
  p.rect(6, 9, 2, 2, P.lamp[1]).put(6, 9, P.lamp[2]);
  // 旗杆与旗
  p.line(2, 1, 2, 14, P.wood[3]).line(3, 4, 3, 14, P.wood[1]);
  p.put(2, 1, P.gold[3]);
  grid(p, ["CCCB", "CBBA", "BAA."], { d: R.blue }, 3, 1);
  p.put(4, 2, P.gold[3]);
  return outline(p, ink.brown);
};

/** 殖民点：尚未开拓的海岸——一株棕榈、一片沙滩与拍岸的浪。 */
const site: Maker = () => {
  const p = canvas();
  // 海
  shape(
    p,
    [
      [1, 9],
      [8, 11],
      [14.5, 7],
      [14.5, 14.5],
      [1, 14.5],
    ],
    [P.sea[1], P.sea[2], P.sea[3], P.sea[4]],
  );
  // 沙滩
  shape(
    p,
    [
      [1, 6],
      [6, 7],
      [11, 5],
      [14.5, 4.5],
      [14.5, 7.5],
      [8, 11],
      [1, 9.5],
    ],
    [P.sand[2], P.sand[3], P.sand[4]],
  );
  // 浪花
  p.line(2, 10, 6, 11, P.foam).line(9, 10, 13, 8, P.foam);
  p.line(3, 13, 6, 13, P.sea[4]).line(9, 13, 12, 12, P.sea[4]);
  // 棕榈
  p.line(6, 8, 7, 3, P.wood[2]).line(7, 8, 8, 3, P.wood[3]);
  leaf(p, 7.5, 3, 1.5, 4.5, 2.6, R.leaf, false);
  leaf(p, 7.5, 3, 13, 4.5, 2.6, R.leaf, false);
  leaf(p, 7.5, 3, 4, 1.6, 2.4, R.leaf, false);
  leaf(p, 7.5, 3, 11.5, 1.6, 2.4, R.leaf, false);
  return outline(p, ink.deep);
};

/** 发现：一支拉开的黄铜望远镜（皮面目镜、两节铜筒、镜口的蓝镜片），旁边闪着一颗星。 */
const discovery: Maker = () => {
  const p = canvas();
  // 自左下（目镜）到右上（物镜）逐段加粗
  const seg = (t0: number, t1: number, w: number, ramp: readonly string[]) => {
    for (let t = t0; t <= t1; t += 0.5) {
      const cx = 2 + t * 0.85;
      const cy = 13 - t * 0.85;
      for (let k = -w / 2; k <= w / 2; k += 0.5) {
        const x = Math.round(cx + k * 0.7);
        const y = Math.round(cy + k * 0.7);
        const c = k < -w / 4 ? ramp[3] : k < w / 4 ? ramp[2] : ramp[1];
        p.put(x, y, c);
      }
    }
  };
  seg(0, 3, 2, [P.wood[0], P.wood[1], P.wood[2], P.wood[3]]);
  seg(3.5, 7.5, 3, [P.gold[0], P.gold[1], P.gold[2], P.gold[3]]);
  seg(8, 12.5, 4, [P.gold[0], P.gold[1], P.gold[3], P.gold[4]]);
  // 节与节之间的深色铜箍
  for (const t of [3.3, 7.8]) {
    const cx = 2 + t * 0.85;
    const cy = 13 - t * 0.85;
    for (let k = -2; k <= 2; k += 0.5) p.put(Math.round(cx + k * 0.7), Math.round(cy + k * 0.7), P.gold[0]);
  }
  // 镜片
  p.put(12, 3, P.sky[4]).put(13, 4, P.sky[2]).put(11, 2, P.gold[4]);
  // 星
  p.put(3, 3, P.white).put(2, 3, P.lamp[2]).put(4, 3, P.lamp[2]).put(3, 2, P.lamp[2]).put(3, 4, P.lamp[2]);
  return outline(p, ink.brown);
};

/** 名声：月桂花环，底部系着红缎带。 */
const fame: Maker = () => {
  const p = canvas();
  const cx = 8;
  const cy = 7.5;
  for (const side of [-1, 1]) {
    for (let k = 0; k < 5; k++) {
      const a = Math.PI / 2 + side * (0.35 + k * 0.52);
      const x = cx + Math.cos(a) * 4.6;
      const y = cy + Math.sin(a) * 4.6;
      const tx = x + Math.cos(a + side * 1.35) * 2.4;
      const ty = y + Math.sin(a + side * 1.35) * 2.4;
      leaf(p, x, y, tx, ty, 2.6, R.leaf, false);
    }
  }
  // 缎带结
  grid(p, [".sr.qr.", "srqqqrq", ".q.q.q.", "q..q..q"], { c: R.red }, 5, 11);
  return outline(p, ink.deep);
};

/** 殖民者：戴宽檐帽的拓荒者，肩上扛着铁锹。 */
const settler: Maker = () => {
  const p = canvas();
  // 铁锹
  p.line(12, 4, 8, 10, P.wood[3]);
  grid(p, [".44.", "4553", "4432", ".32."], { a: R.iron }, 11, 1);
  grid(
    p,
    [
      "....ccccb....",
      "...cccccbb...",
      ".aacccccbbba.",
      "....44444....",
      "....4x4x3....",
      "....44443....",
      ".....333.....",
      "..rrqDCqqp...",
      ".rrrqDCqqqp..",
      ".rrqqDCqqqpp.",
      ".rrqqDCqqqpp.",
      ".rqqqqqqqqpp.",
    ],
    { a: R.skin, b: R.brown, c: R.green, d: R.parch },
    1,
    3,
  );
  return outline(p, ink.brown);
};

/** 占领：一面插进土丘的旗。 */
const claim: Maker = () => {
  const p = canvas();
  // 土丘与草
  grid(p, ["....CDDDC....", "..BCCDDCCBB..", ".BCCCCCBBBAA.", "BBBBBBAAAAAA."], { d: [P.wood[1], P.wood[2], P.wood[3], P.wood[4]] }, 1, 11);
  for (const x of [3, 6, 10, 12]) p.put(x, 11, P.leaf[3]).put(x, 10, P.leaf[2]);
  // 旗杆
  p.line(5, 2, 5, 12, P.wood[3]).line(6, 2, 6, 12, P.wood[1]);
  p.put(5, 1, P.gold[3]).put(6, 1, P.gold[2]);
  // 飘扬的旗：蓝底金星
  grid(
    p,
    [
      "CCCCCB..",
      "CCCCCCCB",
      "CCCsCCBB",
      "CCsssCBB",
      "CCCsCCB.",
      "BBBAAA..",
    ],
    { c: R.gold, d: R.blue },
    7,
    2,
  );
  return outline(p, ink.deep);
};

/** 建设：一摞木板上横放着一把铁锤。 */
const build: Maker = () => {
  const p = canvas();
  const plank = (x: number, y: number, w: number) => {
    p.rect(x, y, w, 1, P.wood[4]);
    p.rect(x, y + 1, w, 1, P.wood[2]);
    p.put(x + w - 1, y, P.sand[3]).put(x + w - 1, y + 1, P.wood[1]);
    for (let i = x + 2; i < x + w - 2; i += 4) p.put(i, y + 1, P.wood[1]);
  };
  plank(2, 9, 12);
  plank(1, 11, 12);
  plank(3, 13, 11);
  // 锤：木柄自左下斜向右上，铁锤头与柄垂直
  p.line(2, 8, 9, 3, P.wood[3]).line(3, 8, 10, 3, P.wood[1]);
  const c = [11, 4];
  const u = [0.6, 0.8];
  const v = [0.8, -0.6];
  const corner = (a: number, b: number): [number, number] => [c[0] + u[0] * a + v[0] * b, c[1] + u[1] * a + v[1] * b];
  shape(p, [corner(-2.6, -1.4), corner(2.6, -1.4), corner(2.6, 1.4), corner(-2.6, 1.4)], [P.iron[0], P.iron[1], P.iron[2], P.iron[3], P.stone[4]]);
  return outline(p, ink.brown);
};

/** 人口：三个人并肩站着，前面的一个大一点。 */
const population: Maker = () => {
  const p = canvas();
  const person = (x: number, y: number, coat: Ramp, hair: Ramp) => {
    grid(
      p,
      [
        ".ccb.",
        "c443b",
        ".443.",
        ".332.",
        "rrqqp",
        "rrqqp",
        "rqqpp",
      ],
      { a: R.skin, b: hair, c: coat },
      x,
      y,
    );
  };
  person(1, 3, R.crimson, R.hairDark);
  person(10, 3, R.green, R.hairBrown);
  grid(
    p,
    [
      "..cccb..",
      ".cbbbba.",
      ".c4443a.",
      "..4x43..",
      "..4443..",
      "...33...",
      ".rrrqqp.",
      "rrrqqqqp",
      "rrqqqqpp",
      "rqqqqppp",
    ],
    { a: R.skin, b: R.hairBrown, c: R.blue },
    4,
    5,
  );
  return outline(p, ink.deep);
};

/** AI 事件：展开的横卷与一支紫羽毛笔，笔尖旁闪着一点星光。 */
const ai_event: Maker = () => {
  const p = canvas();
  grid(
    p,
    [
      ".45.......54.",
      "4554444444453",
      "4554222224453",
      "4554444444453",
      "4554222444453",
      "4554444444453",
      "4554222224453",
      "3443333333342",
      ".33.......32.",
    ],
    { a: R.parch },
    1,
    6,
  );
  // 紫羽毛笔
  leaf(p, 13, 1.5, 7, 8, 4.2, [P.cloth.purple[0], P.cloth.purple[1], P.cloth.purple[2], P.blossom[1], P.blossom[2]], false);
  p.line(13, 2, 6, 9, P.cloth.purple[0]);
  p.put(5, 10, ink.deep).put(6, 9, P.gold[2]);
  // 星光
  p.put(3, 3, P.white).put(2, 3, P.lamp[2]).put(4, 3, P.lamp[2]).put(3, 2, P.lamp[2]).put(3, 4, P.lamp[2]);
  return outline(p, ink.deep);
};

/** 古代遗物：阿尔坎帝国的金面具，额上嵌一颗碧青宝石，眼窝也是碧青色。 */
const relic: Maker = () =>
  outline(
    grid(
      canvas(),
      [
        "...A5555A...",
        "..54sr554A..",
        ".A555qp444A.",
        ".5555544443.",
        ".5A4q444qA3.",
        ".54sp44sp33.",
        ".5554443333.",
        ".5554343332.",
        "..544443332.",
        "..54A22A32..",
        "...433332...",
        "....3232....",
        ".....22.....",
      ],
      { a: R.gold, c: R.teal, d: R.gold },
    ),
    ink.brown,
  );

// ---------------------------------------------------------------- 殖民建筑（与 colony.toml 的 key 对应）

/** 农庄：一块自远而近铺开的田，褐色田垄间一行行绿苗，田头堆着一垛圆顶干草。 */
const cb_farm: Maker = () => {
  const p = canvas();
  shape(
    p,
    [
      [3.5, 5],
      [12.5, 5],
      [14.5, 14.5],
      [1, 14.5],
    ],
    [P.wood[1], P.wood[2], P.wood[3]],
  );
  // 苗行：越近越宽、越亮
  for (const [y, x0, x1, c] of [
    [6, 4, 12, P.leaf[2]],
    [8, 3, 12, P.leaf[2]],
    [10, 2, 13, P.leaf[3]],
    [12, 2, 13, P.leaf[3]],
    [14, 1, 14, P.leaf[4]],
  ] as const) {
    for (let x = x0; x <= x1; x++) p.put(x, y, (x + y) % 2 ? c : P.leaf[1]);
  }
  // 干草垛
  ball(p, 5, 4.2, 3.4, 3, [P.straw[0], P.straw[1], P.straw[2], P.straw[3]]);
  p.hline(2, 8, 6, P.straw[0]);
  p.put(4, 2, P.straw[3]).put(6, 3, P.straw[1]).put(3, 4, P.straw[1]);
  return outline(p, ink.brown);
};

/** 种植园：红土上一行行整齐的灌木，后面一株高高的棕榈。 */
const cb_plantation: Maker = () => {
  const p = canvas();
  shape(
    p,
    [
      [2, 7],
      [14.5, 7],
      [14.5, 14.5],
      [1, 14.5],
    ],
    [P.brick[1], P.brick[2], P.brick[3]],
  );
  p.line(11, 8, 12, 2, P.wood[2]).line(12, 8, 13, 2, P.wood[3]);
  leaf(p, 12.5, 2, 8, 3.5, 2.4, R.leaf, false);
  leaf(p, 12.5, 2, 14.8, 5, 2.2, R.leaf, false);
  for (const [cy, xs, r] of [
    [8, [3, 6, 9], 1.2],
    [10.6, [2.5, 6, 9.5, 13], 1.5],
    [13.2, [2.5, 6.5, 10.5], 1.7],
  ] as const) {
    for (const cx of xs) {
      ball(p, cx, cy, r, r * 0.9, R.leaf);
      p.put(Math.floor(cx), Math.floor(cy + r * 0.9), P.brick[0]);
    }
  }
  // 灌木上的白色棉铃
  p.put(6, 10, P.white).put(2, 13, P.white).put(10, 12, P.white).put(9, 8, P.white);
  return outline(p, ink.brown);
};

/** 伐木场：砍进树桩的斧头，旁边一堆原木。 */
const cb_lumber: Maker = () => {
  const p = canvas();
  const LOG = [".222.", "25542", "25432", ".222."];
  grid(p, LOG, { a: R.wood }, 1, 10);
  grid(p, LOG, { a: R.wood }, 5, 10);
  grid(p, LOG, { a: R.wood }, 3, 7);
  // 树桩：顶面年轮
  grid(
    p,
    [
      ".bcccb.",
      "bcdddcb",
      "cdcbcdc",
      "bcdddcb",
      "3bcccb2",
      "3322222",
      "3322221",
      "3322221",
      "4332221",
    ],
    { a: R.wood, b: [P.wood[1], P.wood[2], P.sand[3], P.sand[4], P.white] },
    8,
    5,
  );
  // 斧头：斧刃砍进桩面，斧柄斜向左上
  p.line(4, 1, 10, 6, P.wood[3]).line(4, 2, 10, 7, P.wood[1]);
  grid(p, ["..4.", ".453", "4553", "4432", ".32."], { a: R.iron }, 9, 3);
  return outline(p, ink.brown);
};

/** 矿坑：岩山上木框撑着的矿洞口，门前一把镐。 */
const cb_mine: Maker = () => {
  const p = canvas();
  shape(
    p,
    [
      [1, 14.5],
      [3, 7],
      [7, 2.5],
      [10, 3],
      [14.5, 9],
      [14.5, 14.5],
    ],
    R.stone,
  );
  // 洞口
  p.rect(5, 8, 6, 7, P.night[0]).rect(6, 9, 4, 6, P.night[1]);
  p.put(7, 11, P.lamp[1]);
  // 木框
  p.rect(4, 8, 1, 7, P.wood[3]).rect(11, 8, 1, 7, P.wood[1]);
  p.rect(3, 7, 10, 1, P.wood[4]).rect(3, 8, 10, 1, P.wood[2]);
  // 岩缝里的矿脉
  p.put(8, 4, P.gold[3]).put(9, 5, P.gold[2]).put(3, 11, P.gold[3]).put(13, 11, P.gold[2]);
  // 镐
  p.line(12, 14, 14, 10, P.wood[3]);
  p.line(11, 9, 14, 10, P.iron[3]).put(14, 11, P.iron[2]).put(10, 9, P.iron[2]);
  return outline(p, ink.deep);
};

/** 渔场：挂在竿上的渔网，网里兜着一条鱼。 */
const cb_fishery: Maker = () => {
  const p = canvas();
  // 竿
  p.line(1, 2, 14, 2, P.wood[3]).line(1, 3, 14, 3, P.wood[1]);
  // 网：菱形网眼
  for (let y = 4; y <= 13; y++) {
    const half = Math.round(6 - Math.max(0, y - 9) * 1.2);
    for (let x = 8 - half; x <= 7 + half; x++) {
      if ((x + y) % 3 === 0 || (x - y + 30) % 3 === 0) p.put(x, y, (x + y) % 2 ? P.straw[3] : P.straw[2]);
    }
  }
  // 鱼
  grid(p, ["2..3443..", "32455443.", "3444x4443", "32333332.", "2..222..."], { a: R.sky }, 4, 8);
  return outline(p, ink.blue);
};

/** 猎场：一张拉满的长弓，搭着一支羽箭。 */
const cb_hunting: Maker = () => {
  const p = canvas();
  // 弓身：一道弧
  for (let y = 1; y <= 14; y++) {
    const t = (y - 7.5) / 6.5;
    const x = Math.round(4 + 4.5 * (1 - t * t));
    p.put(x, y, P.wood[3]).put(x + 1, y, P.wood[1]);
  }
  // 弓弦
  p.vline(3, 1, 14, P.plaster[3]);
  // 箭
  p.line(2, 8, 14, 8, P.wood[4]).line(2, 9, 12, 9, P.wood[2]);
  grid(p, ["..4", ".43", "432", ".32", "..2"], { a: R.iron }, 12, 6);
  p.put(1, 7, P.red[2]).put(2, 7, P.red[3]).put(1, 10, P.red[1]).put(2, 10, P.red[2]);
  return outline(p, ink.brown);
};

/** 酿酒坊：铜蒸馏锅，长颈弯进冷凝盘管，下面接着一只小酒桶。 */
const cb_distillery: Maker = () => {
  const p = canvas();
  disc(p, 5.5, 9.5, 4.5, 4.5, (l) => (l > 0.45 ? COPPER[4] : l > 0 ? COPPER[3] : l > -0.45 ? COPPER[2] : COPPER[1]));
  p.put(3, 7, P.white);
  // 长颈
  p.rect(5, 2, 2, 4, COPPER[3]).put(6, 2, COPPER[2]).put(6, 3, COPPER[2]);
  p.line(6, 2, 11, 3, COPPER[3]).line(6, 3, 11, 4, COPPER[1]);
  // 盘管
  for (const y of [5, 7, 9]) p.hline(10, 13, y, COPPER[3]).hline(10, 13, y + 1, COPPER[1]);
  p.vline(13, 4, 10, COPPER[2]);
  // 小酒桶
  grid(p, [".4432.", "cddccb", "443322", ".3322."], { a: R.wood, b: R.iron }, 9, 11);
  // 炉口的火
  p.put(3, 14, P.lamp[1]).put(4, 14, P.red[3]).put(5, 14, P.lamp[1]);
  return outline(p, ink.brown);
};

/** 糖坊：竖立的石碾轮，中间穿着一根推杆，前面堆着青绿的甘蔗。 */
const cb_sugarmill: Maker = () => {
  const p = canvas();
  // 碾轮：边缘一圈亮、辐射的碾槽、深色的轮毂
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const dx = x + 0.5 - 8;
      const dy = y + 0.5 - 6.5;
      const r = Math.hypot(dx, dy);
      if (r > 5.4) continue;
      const lit = -(dx * 0.62 + dy * 0.78) / 5.4;
      let c = lit > 0.35 ? P.stone[4] : lit > -0.1 ? P.stone[3] : lit > -0.5 ? P.stone[2] : P.stone[1];
      if (r > 4.5) c = lit > 0 ? P.stone[3] : P.stone[1];
      else if (Math.abs(Math.sin(Math.atan2(dy, dx) * 4)) < 0.18 && r > 1.6) c = P.stone[1];
      p.put(x, y, c);
    }
  }
  // 推杆与轮毂
  p.hline(8, 14, 6, P.wood[3]).hline(8, 14, 7, P.wood[1]);
  p.rect(7, 6, 2, 2, P.wood[0]);
  // 甘蔗：三根斜放的绿竿，一节一节
  for (const [x0, y0] of [
    [1, 13],
    [2, 14],
    [3, 12],
  ] as const) {
    for (let i = 0; i < 10; i++) {
      const x = x0 + i;
      const y = y0 - Math.round(i * 0.2);
      p.put(x, y, i % 3 === 2 ? P.leaf[1] : P.leaf[3]);
    }
  }
  leaf(p, 12.5, 11, 14.5, 8.5, 1.8, R.leaf, false);
  return outline(p, ink.brown);
};

/** 仓棚：人字顶的木板仓，两扇大门钉着斜撑。 */
const cb_storehouse: Maker = () =>
  outline(
    grid(
      canvas(),
      [
        "......44......",
        ".....4433.....",
        "....444333....",
        "...44443333...",
        "..4444433333..",
        ".444444333333.",
        "..dcdcdcdcdb..",
        "..dcdcdcdcdb..",
        "..eCCCCCCCCb..",
        "..eDAADDAADb..",
        "..eADDAADDAb..",
        "..eADDAADDAb..",
        "..eDAADDAADb..",
        "..cBBBBBBBBa..",
      ],
      { a: R.slate, b: R.wood, d: [P.wood[0], P.wood[1], P.wood[2], P.wood[3]] },
    ),
    ink.brown,
  );

/** 栅栏堡：一排削尖的原木栅墙，中间是门，旁边瞭望塔上挂着旗。 */
const cb_fort: Maker = () => {
  const p = canvas();
  // 瞭望塔
  p.rect(10, 3, 4, 3, P.wood[3]).rect(10, 5, 4, 1, P.wood[1]);
  p.vline(10, 6, 8, P.wood[2]).vline(13, 6, 8, P.wood[1]);
  p.rect(9, 2, 6, 1, P.wood[4]);
  p.vline(12, 1, 2, P.wood[2]);
  grid(p, ["DC", "C."], { d: R.red }, 13, 1);
  // 栅墙：削尖的原木
  for (let x = 1; x <= 14; x += 2) {
    const top = 7 + ((x >> 1) % 2);
    p.put(x, top, P.wood[4]);
    p.vline(x, top + 1, 14, P.wood[3]);
    p.vline(x + 1, top + 1, 14, P.wood[2]);
    p.put(x + 1, top, P.wood[3]);
  }
  p.hline(1, 14, 10, P.wood[1]);
  // 门
  p.rect(6, 10, 4, 5, P.wood[0]).rect(7, 11, 2, 4, P.wood[1]);
  return outline(p, ink.brown);
};

/** 礼拜堂：白墙小礼拜堂，左边是挂钟的尖顶钟楼，塔尖一颗金球。 */
const cb_chapel: Maker = () => {
  const p = canvas();
  const wall = (x: number, y: number, w: number, h: number) => {
    p.rect(x, y, w, h, P.plaster[2]);
    p.rect(x, y, 1, h, P.plaster[3]);
    p.rect(x + w - 1, y, 1, h, P.plaster[1]);
    p.rect(x, y + h - 1, w, 1, P.plaster[1]);
  };
  // 正厅
  shape(
    p,
    [
      [5.5, 8.5],
      [10, 4],
      [14.5, 8.5],
    ],
    R.slate,
  );
  wall(6, 8, 8, 7);
  p.rect(9, 11, 2, 4, P.wood[0]).put(9, 11, P.wood[1]);
  p.put(9, 9, P.cloth.blue[2]).put(10, 9, P.cloth.blue[1]);
  // 钟楼与尖顶
  wall(2, 6, 4, 9);
  p.rect(3, 7, 2, 2, ink.blue).put(3, 8, P.gold[3]).put(4, 8, P.gold[2]);
  shape(
    p,
    [
      [1.5, 6.5],
      [4, 2],
      [6.5, 6.5],
    ],
    R.slate,
  );
  p.put(4, 1, P.gold[3]).put(4, 2, P.gold[1]);
  return outline(p, ink.brown);
};

/** 殖民地酒馆：两只碰在一起的木酒杯，把手朝外，泡沫溅起。 */
const cb_tavern: Maker = () => {
  const p = canvas();
  const mug = (x: number, y: number, handleLeft: boolean) => {
    // 杯身：木板箍两道铁箍
    for (let yy = 0; yy < 7; yy++) {
      for (let xx = 0; xx < 5; xx++) {
        let c: string = xx === 0 ? P.wood[4] : xx === 4 ? P.wood[1] : xx === 1 ? P.wood[3] : P.wood[2];
        if (yy === 1 || yy === 5) c = xx === 0 ? P.iron[3] : xx === 4 ? P.iron[1] : P.iron[2];
        p.put(x + xx, y + yy, c);
      }
    }
    // 泡沫
    grid(p, [".dcc.", "ddccb"], { b: R.snow }, x, y - 2);
    // 把手
    const hx = handleLeft ? x - 2 : x + 5;
    p.rect(hx, y + 1, 2, 1, P.wood[2]).rect(hx, y + 4, 2, 1, P.wood[1]);
    p.put(handleLeft ? hx : hx + 1, y + 2, P.wood[2]).put(handleLeft ? hx : hx + 1, y + 3, P.wood[1]);
  };
  mug(3, 6, true);
  mug(8, 7, false);
  // 溅起的泡沫
  p.put(7, 2, P.white).put(8, 1, P.snow[2]).put(6, 3, P.snow[2]).put(9, 3, P.white).put(8, 4, P.snow[1]);
  return outline(p, ink.brown);
};

/** 码头：立在水中木桩上的栈桥，桥头一根系着缆绳的系缆桩，桥上一只木箱。 */
const cb_dock: Maker = () => {
  const p = canvas();
  // 水
  p.rect(1, 10, 14, 5, P.sea[2]);
  p.rect(1, 10, 14, 1, P.sea[3]);
  p.rect(1, 14, 14, 1, P.sea[1]);
  p.line(2, 12, 4, 12, P.foam).line(8, 13, 10, 13, P.sea[4]).line(12, 11, 13, 11, P.foam);
  // 木桩
  for (const x of [3, 8, 12]) p.vline(x, 8, 14, P.wood[2]).vline(x + 1, 8, 14, P.wood[0]);
  // 桥面
  p.hline(1, 14, 6, P.wood[4]).hline(1, 14, 7, P.wood[2]).hline(1, 14, 8, P.wood[1]);
  for (const x of [4, 7, 10, 13]) p.put(x, 7, P.wood[1]);
  // 系缆桩与缆绳
  p.rect(11, 3, 2, 3, P.iron[2]).put(11, 3, P.iron[3]).rect(10, 2, 4, 1, P.iron[3]);
  p.line(10, 4, 8, 5, P.straw[2]).line(8, 5, 6, 9, P.straw[2]);
  // 木箱
  grid(p, ["5554", "5433", "4332"], { a: R.wood }, 2, 3);
  return outline(p, ink.deep);
};

/** 住宅区：两座并排的小木屋，红顶、烟囱冒着烟。 */
const cb_housing: Maker = () => {
  const p = canvas();
  const house = (x: number, y: number, w: number, h: number) => {
    const mid = x + w / 2;
    shape(
      p,
      [
        [x, y + 0.5],
        [mid, y - w / 2 + 0.5],
        [x + w, y + 0.5],
      ],
      R.red,
    );
    logWall(p, x, y, w, h);
    p.rect(Math.floor(mid) - 1, y + h - 3, 2, 3, P.wood[0]);
  };
  // 烟囱与烟
  p.rect(10, 2, 2, 4, P.brick[2]).put(10, 2, P.brick[3]);
  p.put(11, 0 + 1, P.stone[3]).put(12, 1, P.stone[2]);
  house(7, 7, 7, 7);
  house(1, 8, 6, 6);
  p.rect(2, 10, 2, 1, P.lamp[1]).rect(8, 9, 2, 1, P.lamp[1]);
  return outline(p, ink.brown);
};

/** 名称 → 画法。 */
export const COLONY_ICONS = {
  colony,
  site,
  discovery,
  fame,
  settler,
  claim,
  build,
  population,
  ai_event,
  relic,
  cb_farm,
  cb_plantation,
  cb_lumber,
  cb_mine,
  cb_fishery,
  cb_hunting,
  cb_distillery,
  cb_sugarmill,
  cb_storehouse,
  cb_fort,
  cb_chapel,
  cb_tavern,
  cb_dock,
  cb_housing,
} as const satisfies Record<string, Maker>;
