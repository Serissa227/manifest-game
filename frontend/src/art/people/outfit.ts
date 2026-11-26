// 服饰：肩膀入画的上半身（64×64 画布的 y≈46..63）。先铺身体轮廓（衣料三阶：左上受光、右侧背光、手臂分缝），
// 再按款式叠领口、翻领、褶领、围裙、条纹、毛领、刺绣等；最后是披风、佩剑带、项链与身份小物件。
// 胸口中线在 x=34（身体随脸微微右转），领口都以此为中心。
import { P } from "../palette";
import { Px, type Pt } from "../px";
import type { PortraitSpec } from "./spec";
import { CLOTH, CLOTH_DEEP, METAL, type Ramp3 } from "./tones";

const S = 64;
const ON = "#ffffffff";
const CX = 34;

/** 身体轮廓（男宽女窄）：斜方肌从颈根斜向肩头，肩头圆润地转进手臂。 */
export function bodyPoly(female: boolean): Pt[] {
  return female
    ? [
        [3, 64],
        [4, 59],
        [7, 56],
        [12, 54],
        [18, 52],
        [24, 50],
        [28, 49],
        [40, 49],
        [44, 50],
        [50, 52],
        [56, 54],
        [59, 56],
        [61, 59],
        [62, 64],
      ]
    : [
        [0, 64],
        [0, 59],
        [3, 56],
        [8, 53.5],
        [15, 51],
        [22, 48.5],
        [27, 47.5],
        [42, 47.5],
        [47, 48.5],
        [54, 51],
        [60, 53.5],
        [63, 56],
        [64, 59],
        [64, 64],
      ];
}

/** 身体轮廓某一列的最上一行（没有则返回 64）。 */
export function bodyTop(body: Px, x: number): number {
  for (let y = 40; y < S; y++) if (body.isOpaque(x, y)) return y;
  return S;
}

export function bodyMask(female: boolean): Px {
  return new Px(S, S).poly(bodyPoly(female), ON);
}

/** 手臂分缝的 x（近侧、远侧）。 */
function armSeams(female: boolean): readonly [number, number] {
  return female ? [13, 55] : [10, 57];
}

/** 按遮罩铺一块有体积的衣料。 */
export function fillCloth(p: Px, mask: Px, ramp: Ramp3, female: boolean, opts: { seams?: boolean } = {}): void {
  const { seams = true } = opts;
  const [sl, sr] = armSeams(female);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      if (!mask.isOpaque(x, y)) continue;
      let c = ramp[1];
      const topEdge = !mask.isOpaque(x, y - 1) || !mask.isOpaque(x, y - 2);
      if (topEdge && x < CX - 4) c = ramp[2];
      if (!mask.isOpaque(x + 1, y) || !mask.isOpaque(x + 2, y)) c = ramp[0];
      // 远侧手臂整块落在暗面（平涂，不抖动）
      if (x >= sr + 2) c = ramp[0];
      if (seams && y >= 55 && (x === sl || x === sr)) c = ramp[0];
      if (seams && y >= 56 && x === sl - 1) c = ramp[2];
      p.set(x, y, c);
    }
  }
}

/** 用某色填一个多边形并按同样规则打光。 */
function panel(p: Px, pts: readonly Pt[], ramp: Ramp3, female: boolean, seams = false): Px {
  const m = new Px(S, S).poly(pts, ON);
  fillCloth(p, m, ramp, female, { seams });
  return m;
}

/** 某遮罩与身体轮廓的交。 */
function clipToBody(m: Px, body: Px): Px {
  for (let i = 0; i < m.data.length; i++) if (!(body.data[i] & 0xff)) m.data[i] = 0;
  return m;
}

/** 领口：把衣服层在多边形内已画的部分挖空，露出下面的颈与胸口。之后再画的领尖、领巾不受影响。 */
function neckline(c: OutfitCtx, pts: readonly Pt[]): void {
  const m = new Px(S, S).poly(pts, ON);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) if (m.isOpaque(x, y)) c.p.set(x, y, null);
}

export interface OutfitCtx {
  /** 衣服层（单独一层，领口处挖空，露出下面已经画好的颈与胸口） */
  p: Px;
  spec: PortraitSpec;
  /** 身体轮廓遮罩 */
  body: Px;
}

function ramps(spec: PortraitSpec): { main: Ramp3; acc: Ramp3 } {
  return { main: CLOTH[spec.main], acc: CLOTH[spec.accent] };
}

// ── 领口与内衬 ──

/** 白衬衫的 V 领（开到胸口）。 */
function shirtV(c: OutfitCtx, shirt: Ramp3, depth = 54): void {
  const f = c.spec.female;
  const l = f ? 28 : 27;
  const r = f ? 40 : 41;
  panel(c.p, [[l - 3, 46], [r + 3, 46], [r + 6, 64], [l - 6, 64]], shirt, f);
  neckline(c, [
    [l, 45],
    [r, 45],
    [CX, depth],
  ]);
  // 敞开的衬衫领尖
  c.p.poly(
    [
      [l - 3, 45],
      [l + 1, 45],
      [CX - 1, depth - 1],
      [l + 1, 51],
    ],
    shirt[2],
  );
  c.p.poly(
    [
      [r - 1, 45],
      [r + 3, 45],
      [r, 51],
      [CX + 1, depth - 1],
    ],
    shirt[1],
  );
  c.p.line(l + 1, 51, CX - 1, depth - 1, shirt[0]);
  c.p.line(r, 51, CX + 1, depth - 1, shirt[0]);
}

/** 领巾：在喉下打结，两角垂下。 */
function neckerchief(c: OutfitCtx, cloth: Ramp3, y = 47): void {
  c.p.poly(
    [
      [CX - 7, y - 1],
      [CX + 7, y - 1],
      [CX + 1, y + 7],
    ],
    cloth[1],
  );
  c.p.hline(CX - 7, CX + 6, y - 1, cloth[2]);
  c.p.rect(CX - 2, y, 4, 3, cloth[2]);
  c.p.set(CX + 1, y + 2, cloth[0]);
  c.p.poly(
    [
      [CX - 1, y + 3],
      [CX + 3, y + 3],
      [CX + 4, y + 11],
      [CX, y + 10],
    ],
    cloth[1],
  );
  c.p.vline(CX + 3, y + 4, y + 10, cloth[0]);
  c.p.line(CX - 1, y + 4, CX, y + 9, cloth[2]);
}

/** 褶饰领巾（船长、银行家）：白色层叠褶边。 */
function jabot(c: OutfitCtx, y = 46): void {
  const w = CLOTH.white;
  for (let i = 0; i < 5; i++) {
    const yy = y + i * 2;
    const half = i === 0 ? 3 : i === 4 ? 2 : 4;
    c.p.hline(CX - half, CX + half, yy, w[2]);
    c.p.hline(CX - half + 1, CX + half, yy + 1, w[1]);
    c.p.set(CX + half, yy + 1, w[0]);
    c.p.set(CX - half, yy + 1, w[2]);
  }
  c.p.set(CX, y + 1, METAL.gold[2]);
  c.p.set(CX, y + 2, METAL.gold[1]);
}

/** 纽扣一列。 */
function buttons(c: OutfitCtx, x: number, y0: number, y1: number, metal: readonly string[] = METAL.gold, step = 4): void {
  for (let y = y0; y <= y1; y += step) {
    c.p.set(x, y, metal[2]);
    c.p.set(x + 1, y, metal[0]);
    c.p.set(x, y + 1, metal[0]);
  }
}

/** 大衣：翻领 V 形开襟。trim 为翻领边饰色。 */
function coat(c: OutfitCtx, main: Ramp3, lining: Ramp3, trim: string | null, inner: () => void): void {
  const f = c.spec.female;
  fillCloth(c.p, c.body, main, f);
  inner();
  const lap = f ? 0 : 1;
  // 近侧翻领（受光）
  c.p.poly(
    [
      [22 - lap, 46],
      [28, 46],
      [CX - 1, 61],
      [CX - 4, 64],
      [19 - lap, 51],
    ],
    main[2],
  );
  // 翻领边缘露出的一窄条衬里
  c.p.poly(
    [
      [19 - lap, 51],
      [22 - lap, 50],
      [CX - 5, 64],
      [CX - 8, 64],
    ],
    lining[1],
  );
  // 远侧翻领（背光）
  c.p.poly(
    [
      [40, 46],
      [45 + lap, 47],
      [47 + lap, 52],
      [CX + 3, 64],
      [CX + 1, 61],
    ],
    main[0],
  );
  if (trim) {
    c.p.line(28, 46, CX - 1, 61, trim);
    c.p.line(40, 46, CX + 1, 61, trim);
    c.p.line(19 - lap, 51, 24, 64, trim);
    c.p.line(47 + lap, 52, CX + 7, 64, trim);
  } else {
    c.p.line(28, 46, CX - 1, 61, main[0]);
  }
}

/** 褶领（地中海）：套在颈上的一圈白色风琴褶，上下两道褶边。 */
function ruff(c: OutfitCtx, y = 45, half = 11): void {
  const w = CLOTH.white;
  const m = new Px(S, S).ellipse(CX + 1, y + 2, half, 3.5, ON);
  for (let yy = 0; yy < S; yy++) {
    for (let x = 0; x < S; x++) {
      if (!m.isOpaque(x, yy)) continue;
      const k = (x + (yy % 2)) % 3;
      let col: string = k === 0 ? w[0] : k === 1 ? w[2] : w[1];
      if (!m.isOpaque(x, yy + 1)) col = w[0];
      if (x > CX + 6 && col === w[2]) col = w[1];
      c.p.set(x, yy, col);
    }
  }
  // 褶领上缘一道亮边
  for (let x = CX - half + 2; x <= CX + half - 2; x++) if (m.isOpaque(x, y - 1)) c.p.set(x, y - 1, w[2]);
}

/** 泡泡袖：肩头鼓起的一团（近侧受光），带两道开衩露出衬里。 */
function puffSleeve(c: OutfitCtx, x: number, y: number, cloth: Ramp3, lining: Ramp3, near: boolean): void {
  const m = new Px(S, S).ellipse(x, y, 6.5, 4.5, ON);
  clipToBody(m, c.body);
  for (let yy = 0; yy < S; yy++) {
    for (let xx = 0; xx < S; xx++) {
      if (!m.isOpaque(xx, yy)) continue;
      let col: string = cloth[1];
      if (near && (!m.isOpaque(xx, yy - 1) || (xx < x - 2 && yy < y))) col = cloth[2];
      if (!m.isOpaque(xx, yy + 1) || !m.isOpaque(xx + 1, yy) || (!near && xx > x + 1)) col = cloth[0];
      c.p.set(xx, yy, col);
    }
  }
  // 开衩：露出里层的衣料
  for (const dx of [-3, 0, 3]) {
    const top = bodyTop(m, x + dx);
    if (top >= S) continue;
    c.p.vline(x + dx, top + 1, y + 3, lining[1]);
    c.p.set(x + dx, top + 1, lining[2]);
  }
}
/** 刺绣：在遮罩内按菱形网格点缀金线。 */
function embroider(c: OutfitCtx, m: Px, thread: readonly string[]): void {
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      if (!m.isOpaque(x, y) || !c.p.isOpaque(x, y)) continue;
      const u = (x + y) % 6;
      const v = (x - y + 60) % 6;
      if (u === 0 && v === 0) c.p.set(x, y, thread[2]);
      else if ((u === 0 || v === 0) && (x + y) % 2 === 0 && x < 50) c.p.set(x, y, thread[1]);
    }
  }
}

// ── 各款式 ──

const OUTFITS: Readonly<Record<string, (c: OutfitCtx) => void>> = {
  captain: (c) => {
    const { main } = ramps(c.spec);
    const gold = METAL.gold[2];
    // 翻领内衬用白色（深色大衣）或藏青（浅色大衣），边上压金线
    const facing = c.spec.main === "white" || c.spec.main === "cream" ? CLOTH.navy : CLOTH.white;
    const vest = c.spec.main === "crimson" || c.spec.main === "red" ? CLOTH.navy : CLOTH.crimson;
    coat(c, main, facing, gold, () => {
      shirtV(c, CLOTH.white, 53);
      // 马甲
      panel(c.p, [[CX - 7, 53], [CX + 7, 53], [CX + 8, 64], [CX - 8, 64]], vest, c.spec.female);
      c.p.hline(CX - 7, CX + 7, 53, vest[2]);
      jabot(c, 45);
    });
    buttons(c, CX + 5, 55, 63);
    buttons(c, CX - 6, 55, 63);
    // 近侧肩章：沿肩线斜放的深色肩板 + 金边 + 一排垂下的金穗
    const x0 = c.spec.female ? 9 : 4;
    for (let x = x0; x <= x0 + 11; x++) {
      const t = bodyTop(c.body, x);
      c.p.set(x, t, METAL.gold[3]);
      c.p.set(x, t + 1, METAL.gold[1]);
      c.p.set(x, t + 2, main[0]);
      if ((x - x0) % 2 === 0) {
        c.p.set(x, t + 3, METAL.gold[2]);
        c.p.set(x, t + 4, METAL.gold[0]);
      }
    }
  },
  coat: (c) => {
    const { main, acc } = ramps(c.spec);
    coat(c, main, acc, null, () => {
      shirtV(c, CLOTH.cream, 52);
      neckerchief(c, acc, 47);
    });
    buttons(c, CX + 7, 56, 63, METAL.silver);
  },
  jacket: (c) => {
    const { main, acc } = ramps(c.spec);
    const f = c.spec.female;
    fillCloth(c.p, c.body, main, f);
    shirtV(c, CLOTH.cream, 52);
    // 立起的短翻领
    panel(c.p, [[21, 46], [28, 45], [31, 52], [24, 53]], main, f);
    c.p.line(28, 45, 31, 52, main[2]);
    panel(c.p, [[40, 45], [46, 46], [44, 53], [38, 52]], main, f);
    // 门襟与双排扣
    c.p.line(CX + 1, 55, CX + 1, 63, main[0]);
    buttons(c, CX - 4, 56, 63, METAL.silver);
    buttons(c, CX + 5, 56, 63, METAL.silver);
    neckerchief(c, acc, 48);
  },
  vest: (c) => {
    const { main, acc } = ramps(c.spec);
    const f = c.spec.female;
    // 衬衫铺满，马甲只在胸前
    fillCloth(c.p, c.body, CLOTH.white, f);
    neckline(c, [
      [28, 45],
      [40, 45],
      [CX, 49],
    ]);
    c.p.poly(
      [
        [25, 45],
        [30, 45],
        [CX, 50],
        [29, 50],
      ],
      CLOTH.white[2],
    );
    c.p.poly(
      [
        [38, 45],
        [43, 45],
        [40, 50],
        [CX + 1, 50],
      ],
      CLOTH.white[1],
    );
    panel(
      c.p,
      [
        [f ? 17 : 14, 51],
        [24, 47],
        [CX - 1, 56],
        [CX + 1, 56],
        [44, 47],
        [f ? 49 : 51, 51],
        [f ? 49 : 51, 64],
        [f ? 17 : 14, 64],
      ],
      main,
      f,
    );
    c.p.line(24, 47, CX - 1, 56, main[2]);
    c.p.line(44, 47, CX + 1, 56, main[0]);
    buttons(c, CX, 58, 63);
    // 领结
    c.p.rect(CX - 3, 48, 3, 3, acc[1]);
    c.p.rect(CX + 1, 48, 3, 3, acc[0]);
    c.p.set(CX - 3, 48, acc[2]);
    c.p.set(CX, 49, acc[2]);
    // 袖箍
    if (c.spec.role === "exchange") {
      const [sl, sr] = armSeams(f);
      c.p.hline(sl - 7, sl - 1, 60, acc[0]);
      c.p.hline(sr + 1, sr + 6, 60, acc[0]);
    }
  },
  apron: (c) => {
    const { main, acc } = ramps(c.spec);
    const f = c.spec.female;
    fillCloth(c.p, c.body, acc, f);
    neckline(c, [
      [26, 45],
      [41, 45],
      [CX, 51],
    ]);
    c.p.line(26, 45, CX, 51, acc[0]);
    // 围裙胸片与背带
    panel(c.p, [[CX - 8, 53], [CX + 8, 53], [CX + 9, 64], [CX - 9, 64]], main, f);
    c.p.hline(CX - 8, CX + 8, 53, main[2]);
    c.p.line(CX - 8, 53, f ? 20 : 17, 47, main[0]);
    c.p.line(CX - 7, 53, f ? 21 : 18, 47, main[1]);
    c.p.line(CX + 8, 53, 45, 47, main[0]);
    // 口袋
    c.p.hline(CX - 4, CX + 3, 58, main[0]);
    c.p.vline(CX - 4, 58, 63, main[0]);
    c.p.vline(CX + 3, 58, 63, main[0]);
    // 插在口袋里的笔
    c.p.vline(CX - 2, 55, 58, P.wood[3]);
    c.p.set(CX - 2, 54, P.hair.black[1]);
  },
  smith: (c) => {
    const f = c.spec.female;
    const shirt = CLOTH[c.spec.accent];
    fillCloth(c.p, c.body, shirt, f);
    shirtV(c, shirt, 54);
    // 皮围裙
    const lea = CLOTH.leather;
    panel(c.p, [[CX - 9, 55], [CX + 9, 55], [CX + 10, 64], [CX - 10, 64]], lea, f);
    c.p.hline(CX - 9, CX + 9, 55, lea[2]);
    c.p.line(CX - 9, 55, f ? 19 : 16, 47, lea[0]);
    c.p.line(CX - 8, 55, f ? 20 : 17, 47, lea[1]);
    c.p.line(CX + 9, 55, 46, 47, lea[0]);
    c.p.set(CX - 8, 56, METAL.silver[3]);
    c.p.set(CX + 8, 56, METAL.silver[2]);
    // 皮面上的缝线
    for (let y = 57; y < 64; y += 2) c.p.set(CX - 8, y, lea[2]);
  },
  robe: (c) => {
    const { main, acc } = ramps(c.spec);
    const f = c.spec.female;
    fillCloth(c.p, c.body, main, f);
    neckline(c, [
      [27, 45],
      [40, 45],
      [CX - 1, 51],
    ]);
    // 交领：内领（远侧）先画，外领（近侧压右）从左肩斜到右下，宽领缘用点缀色
    c.p.poly(
      [
        [38, 45],
        [42, 45],
        [CX + 1, 55],
        [CX - 1, 53],
      ],
      acc[1],
    );
    const band: Pt[] = [
      [23, 46],
      [27, 45],
      [CX + 2, 53],
      [48, 64],
      [43, 64],
      [CX - 2, 56],
    ];
    c.p.poly(band, acc[2]);
    c.p.line(27, 45, CX + 2, 53, acc[1]);
    c.p.line(CX + 2, 53, 47, 63, acc[0]);
    c.p.line(23, 46, CX - 2, 56, acc[1]);
    // 里层白领一道
    c.p.line(28, 45, CX + 1, 51, CLOTH.white[2]);
    // 官员：胸前一块刺绣方补
    if (c.spec.role === "office") {
      const g = METAL.gold;
      c.p.rect(18, 53, 9, 8, CLOTH[c.spec.main === "navy" ? "crimson" : "navy"][1]);
      c.p.stroke(18, 53, 9, 8, g[1]);
      c.p.circle(22, 56, 1.5, g[2]);
      c.p.hline(19, 25, 59, P.teal[3]);
      c.p.set(20, 58, P.white);
      c.p.set(24, 58, P.white);
    }
  },
  wide: (c) => {
    const { main, acc } = ramps(c.spec);
    const f = c.spec.female;
    fillCloth(c.p, c.body, main, f);
    neckline(c, [
      [26, 45],
      [41, 45],
      [CX, 55],
    ]);
    // 宽领口的绣边：金线 + 一排青色小菱
    c.p.line(26, 45, CX, 55, acc[2]);
    c.p.line(25, 45, CX - 1, 56, acc[1]);
    c.p.line(41, 45, CX + 1, 55, acc[1]);
    c.p.line(42, 45, CX + 1, 56, acc[0]);
    c.p.line(24, 46, CX - 2, 57, METAL.gold[2]);
    for (let y = 47; y <= 55; y += 3) c.p.set(26 + Math.floor((y - 45) * 0.8) - 2, y, P.teal[3]);
    // 斜披的肩巾（带流苏）
    c.p.poly(
      [
        [f ? 8 : 3, 55],
        [f ? 15 : 10, 50],
        [f ? 24 : 21, 48],
        [CX - 4, 58],
        [CX - 5, 64],
        [f ? 6 : 1, 64],
      ],
      acc[1],
    );
    c.p.line(f ? 15 : 10, 50, CX - 4, 58, acc[2]);
    c.p.line(f ? 12 : 7, 55, CX - 7, 62, acc[0]);
    for (let x = f ? 7 : 2; x < CX - 5; x += 3) {
      c.p.set(x, 63, acc[0]);
      c.p.set(x + 1, 62, METAL.gold[1]);
    }
    // 腰间的彩条腰带
    c.p.hline(36, 50, 62, P.red[2]);
    c.p.hline(36, 50, 63, METAL.gold[1]);
  },
  tunic: (c) => {
    const { main, acc } = ramps(c.spec);
    const f = c.spec.female;
    fillCloth(c.p, c.body, main, f);
    neckline(c, [
      [28, 45],
      [38, 45],
      [38, 47],
      [CX + 1, 52],
      [CX - 1, 52],
      [28, 47],
    ]);
    // 领口的滚边（只在两侧，不横过脖子）
    c.p.vline(27, 46, 47, main[0]);
    c.p.vline(39, 46, 47, main[0]);
    // 领口系绳
    c.p.set(CX - 2, 48, acc[2]);
    c.p.set(CX + 1, 49, acc[2]);
    c.p.set(CX - 1, 50, acc[1]);
    c.p.set(CX, 52, acc[1]);
    c.p.set(CX + 1, 53, acc[0]);
    c.p.set(CX, 54, acc[0]);
    // 近侧肩上的布补丁
    c.p.rect(f ? 15 : 10, 52, 4, 4, main[0]);
    c.p.hline(f ? 15 : 10, f ? 18 : 13, 52, main[2]);
  },
  striped: (c) => {
    const { main, acc } = ramps(c.spec);
    const f = c.spec.female;
    const white = CLOTH.white;
    fillCloth(c.p, c.body, white, f);
    for (let y = 48; y < 64; y++) {
      if (y % 4 === 0 || y % 4 === 1) continue;
      for (let x = 0; x < S; x++) {
        if (!c.body.isOpaque(x, y)) continue;
        const shade = x >= (f ? 55 : 57) ? main[0] : x <= (f ? 12 : 9) ? main[2] : main[1];
        c.p.set(x, y, shade);
      }
    }
    neckline(c, [
      [25, 45],
      [42, 45],
      [41, 47],
      [CX, 49],
      [26, 47],
    ]);
    c.p.line(26, 47, CX - 1, 49, white[0]);
    c.p.line(41, 47, CX + 1, 49, white[0]);
    if (c.spec.role !== "pirate" || c.spec.accent !== "gold") neckerchief(c, acc, 48);
  },
  fur: (c) => {
    const { main } = ramps(c.spec);
    const f = c.spec.female;
    fillCloth(c.p, c.body, main, f);
    // 斗篷的前襟
    c.p.vline(CX + 1, 55, 63, CLOTH_DEEP[c.spec.main]);
    c.p.vline(CX, 55, 63, main[2]);
    // 厚毛皮披肩：沿肩线铺一圈，颈前堆得更厚；与毛皮帽一样成簇平涂——每 4 列一簇，簇的上半受光、
    // 簇与簇之间下半一道暗缝，下缘是一个个扇贝形的圆弧（簇中间两列多垂一行），外缘一圈最深阶。没有棋盘格。
    const fur =
      c.spec.accent === "white" || c.spec.accent === "cream"
        ? [P.snow[0], P.snow[1], P.snow[2], P.white]
        : c.spec.accent === "gold" || c.spec.accent === "sand" || c.spec.accent === "ochre"
          ? [P.wood[1], P.wood[2], P.wood[3], P.wood[4]]
          : [P.stone[0], P.stone[1], P.stone[2], P.stone[3]];
    const [x0, x1] = f ? [5, 61] : [0, 63];
    for (let x = x0; x <= x1; x++) {
      const neck = x >= 26 && x <= 43;
      const t = neck ? 45 : bodyTop(c.body, x) - 1;
      if (t >= S) continue;
      const u = (((x - 1) % 4) + 4) % 4;
      const depth = (Math.abs(x - CX) < 10 ? 6 : 4) + (u === 1 || u === 2 ? 1 : 0);
      for (let k = 0; k <= depth; k++) {
        const y = t + k;
        let col = fur[2];
        if (k === 0) col = x < CX + 6 ? fur[3] : fur[2];
        else if (k <= 2 && (u === 1 || u === 2) && x < CX + 6) col = fur[3];
        else if (u === 0 && k >= depth - 3) col = fur[1];
        if (k === depth) col = fur[0];
        if (x > CX + 12 && col !== fur[0]) col = col === fur[3] ? fur[2] : fur[1];
        c.p.set(x, y, col);
      }
    }
    // 圆形银扣
    const s = METAL.silver;
    c.p.circle(CX + 1, 53, 2, s[2]);
    c.p.ring(CX + 1, 53, 2, 2, s[0]);
    c.p.set(CX, 52, s[3]);
  },
  island: (c) => {
    const { main, acc } = ramps(c.spec);
    const f = c.spec.female;
    // 纹样：一排三角与点
    const pattern = (m: Px) => {
      for (let y = 0; y < S; y++) {
        for (let x = 0; x < S; x++) {
          if (!m.isOpaque(x, y)) continue;
          const band = (y + 1) % 5;
          if (band === 0) c.p.set(x, y, acc[2]);
          else if (band === 2 && x % 4 === 0) c.p.set(x, y, acc[0]);
          else if (band === 3 && x % 4 === 1) c.p.set(x, y, acc[1]);
        }
      }
    };
    if (f) {
      // 单肩裹身披布：盖住近侧肩膀，远侧肩膀露出
      const m = panel(c.p, [[12, 52], [18, 50], [26, 49], [CX + 7, 52], [48, 54], [50, 64], [12, 64]], main, f);
      pattern(m);
      c.p.line(26, 49, CX + 7, 52, main[2]);
      c.p.line(CX + 7, 52, 48, 54, main[0]);
      // 斜挎的纱巾
      c.p.poly(
        [
          [18, 50],
          [24, 48],
          [46, 64],
          [38, 64],
        ],
        acc[1],
      );
      c.p.line(24, 48, 46, 64, acc[2]);
    } else {
      // 敞开的短褂：两片前襟，中间露出胸膛
      const l = panel(c.p, [[7, 52], [19, 48], [28, 56], [28, 64], [6, 64]], main, f);
      const r = panel(c.p, [[40, 56], [46, 48], [53, 50], [56, 64], [40, 64]], main, f);
      pattern(l);
      pattern(r);
      c.p.line(19, 48, 28, 56, main[2]);
      c.p.line(46, 48, 40, 56, main[0]);
      // 腰间系带
      c.p.hline(27, 41, 62, acc[1]);
      c.p.hline(27, 41, 63, acc[0]);
    }
  },
  dress: (c) => {
    const { main, acc } = ramps(c.spec);
    const f = true;
    // 泡泡袖（奶白）+ 方领紧身胸衣
    fillCloth(c.p, c.body, CLOTH.cream, f);
    panel(c.p, [[19, 51], [49, 51], [49, 64], [18, 64]], main, f);
    c.p.hline(19, 49, 51, main[2]);
    neckline(c, [
      [23, 45],
      [45, 45],
      [45, 50],
      [23, 50],
    ]);
    // 方领的衬边
    c.p.hline(20, 48, 50, CLOTH.white[2]);
    c.p.hline(21, 47, 51, CLOTH.white[1]);
    // 胸衣系带
    for (let y = 53; y <= 63; y += 2) {
      c.p.set(CX - 1, y, acc[2]);
      c.p.set(CX + 1, y + 1, acc[2]);
      c.p.set(CX, y, acc[0]);
    }
  },
  official: (c) => {
    const { main } = ramps(c.spec);
    const f = c.spec.female;
    fillCloth(c.p, c.body, main, f);
    // 圆立领
    c.p.poly(
      [
        [24, 45],
        [42, 45],
        [43, 48],
        [CX, 50],
        [23, 48],
      ],
      main[2],
    );
    c.p.hline(24, 42, 48, main[0]);
    // 胸前圆形徽章：金环里一颗四角罗盘星
    const g = METAL.gold;
    const field = CLOTH[c.spec.main === "navy" ? "crimson" : "navy"];
    c.p.circle(CX, 56, 5, field[1]);
    c.p.ring(CX, 56, 5, 5, g[1]);
    c.p.set(CX - 4, 53, g[3]);
    c.p.vline(CX, 52, 60, g[2]);
    c.p.hline(CX - 4, CX + 4, 56, g[2]);
    for (const [dx, dy] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ] as const)
      c.p.set(CX + dx, 56 + dy, g[1]);
    c.p.set(CX, 56, g[3]);
    // 腰带
    c.p.rect(8, 63, 48, 1, g[1]);
  },
  banker: (c) => {
    const { main } = ramps(c.spec);
    const f = c.spec.female;
    fillCloth(c.p, c.body, main, f);
    // 白色高立领
    const w = CLOTH.white;
    c.p.poly(
      [
        [26, 39],
        [39, 39],
        [40, 46],
        [CX, 48],
        [25, 46],
      ],
      w[2],
    );
    c.p.line(39, 39, 40, 46, w[0]);
    c.p.line(CX, 48, 40, 46, w[1]);
    jabot(c, 47);
    // 翻领
    c.p.poly(
      [
        [21, 47],
        [28, 47],
        [CX - 3, 63],
        [20, 56],
      ],
      main[2],
    );
    c.p.poly(
      [
        [40, 47],
        [46, 48],
        [46, 56],
        [CX + 3, 63],
      ],
      main[0],
    );
    // 怀表链
    const g = METAL.gold;
    c.p.line(CX + 4, 58, CX + 11, 61, g[2]);
    c.p.set(CX + 12, 61, g[1]);
    c.p.set(CX + 12, 62, g[3]);
  },
  doublet: (c) => {
    const { main, acc } = ramps(c.spec);
    const f = c.spec.female;
    fillCloth(c.p, c.body, main, f);
    // 前胸的刺绣片（倒三角），中缝一排金扣
    const front = new Px(S, S).poly(
      [
        [24, 47],
        [44, 47],
        [CX + 2, 64],
        [CX - 2, 64],
      ],
      ON,
    );
    clipToBody(front, c.body);
    embroider(c, front, METAL.gold);
    c.p.line(24, 47, CX - 2, 64, METAL.gold[1]);
    c.p.line(44, 47, CX + 2, 64, METAL.gold[0]);
    buttons(c, CX, 52, 63, METAL.gold, 3);
    // 肩头的开衩袖卷：露出点缀色衬里
    const [sl, sr] = armSeams(f);
    for (const x of [sl - 7, sl - 4, sl - 1]) {
      c.p.vline(x, 55, 63, acc[1]);
      c.p.set(x, 55, acc[2]);
    }
    for (const x of [sr + 2, sr + 5]) c.p.vline(x, 56, 63, acc[0]);
    c.p.hline(sl - 9, sl + 1, 54, METAL.gold[1]);
    // 褶领
    ruff(c, 45, f ? 9 : 11);
    // 官员：胸前的金链（链节交错）与垂下的徽章
    if (c.spec.role === "office") {
      const g = METAL.gold;
      for (let x = 18; x <= 50; x++) {
        const y = 51 + Math.round(((x - CX) * (x - CX)) / 60);
        c.p.set(x, y, x % 2 ? g[2] : g[0]);
      }
      c.p.circle(CX, 58, 2.5, g[2]);
      c.p.set(CX - 1, 57, g[3]);
      c.p.set(CX + 1, 59, g[0]);
      c.p.set(CX, 58, P.red[2]);
    }
  },
  bodice: (c) => {
    const { main, acc } = ramps(c.spec);
    const f = true;
    // 贴身胸衣：方形低领，领口一道白色蕾丝边；泡泡袖；胸前三角形的绣片（胸饰）
    fillCloth(c.p, c.body, main, f);
    neckline(c, [
      [23, 45],
      [45, 45],
      [45, 52],
      [23, 52],
    ]);
    const w = CLOTH.white;
    c.p.hline(21, 47, 52, w[2]);
    for (let x = 21; x <= 47; x += 2) c.p.set(x, 53, w[1]);
    const stomacher = new Px(S, S).poly(
      [
        [27, 53],
        [42, 53],
        [CX + 1, 64],
        [CX - 1, 64],
      ],
      ON,
    );
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) if (stomacher.isOpaque(x, y)) c.p.set(x, y, x < CX ? acc[2] : acc[1]);
    embroider(c, stomacher, METAL.gold);
    c.p.line(27, 53, CX - 1, 64, METAL.gold[2]);
    c.p.line(42, 53, CX + 1, 64, METAL.gold[1]);
    // 泡泡袖
    puffSleeve(c, 13, 56, CLOTH.cream, main, true);
    puffSleeve(c, 55, 57, CLOTH.cream, main, false);
  },
  wool: (c) => {
    const { main } = ramps(c.spec);
    const f = c.spec.female;
    // 扣到领口的黑呢外套（女性为黑呢长裙的上身）+ 盖住两肩的白色大平领（左右两片圆角）
    fillCloth(c.p, c.body, main, f);
    buttons(c, CX, 56, 63, METAL.silver, 3);
    const w = CLOTH.white;
    for (const [lc, lo, hi] of [
      [CX - 7.5, CX - 15, CX - 1],
      [CX + 7.5, CX, CX + 14],
    ] as const) {
      for (let x = lo; x <= hi; x++) {
        const neck = x >= 27 && x <= 42;
        const t = neck ? 45 : bodyTop(c.body, x) - 1;
        const d = Math.max(0, 1 - ((x - lc) / 8) ** 2);
        const h = 2 + Math.round(6 * Math.sqrt(d));
        for (let k = 0; k <= h; k++) {
          const y = t + k;
          let col: string = w[1];
          if (x < CX && k < h - 1) col = w[2];
          if (k === h) col = w[0];
          if (x > CX + 8 && col === w[1]) col = x > CX + 11 ? w[0] : w[1];
          c.p.set(x, y, col);
        }
        // 平领在衣服上的投影
        if (c.p.isOpaque(x, t + h + 1)) c.p.set(x, t + h + 1, CLOTH_DEEP[c.spec.main]);
      }
    }
    // 中间的开缝与两根系带
    c.p.vline(CX, 45, 51, w[0]);
    c.p.vline(CX - 1, 50, 54, w[2]);
    c.p.vline(CX + 1, 50, 55, w[1]);
    c.p.set(CX - 1, 55, w[1]);
    // 女性：白围裙的上缘
    if (f) {
      c.p.rect(24, 61, 21, 3, w[2]);
      c.p.hline(24, 44, 61, w[1]);
    }
  },
  leather: (c) => {
    const f = c.spec.female;
    const lea = CLOTH.leather;
    const { acc } = ramps(c.spec);
    // 内衬的粗布短衫
    const under = CLOTH[c.spec.main === "leather" ? "brown" : c.spec.main];
    fillCloth(c.p, c.body, under, f);
    neckline(c, [
      [28, 45],
      [40, 45],
      [CX, 49],
    ]);
    // 皮胸甲：上缘圆弧，两道横向的接缝（缝线一针一针地亮），中间一道脊线
    const plate = new Px(S, S).poly(
      [
        [f ? 17 : 14, 64],
        [f ? 18 : 15, 55],
        [24, 50.5],
        [CX, 49.5],
        [44, 50.5],
        [f ? 51 : 53, 55],
        [f ? 52 : 54, 64],
      ],
      ON,
    );
    clipToBody(plate, c.body);
    fillCloth(c.p, plate, lea, f, { seams: false });
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        if (!plate.isOpaque(x, y)) continue;
        if (!plate.isOpaque(x, y - 1) || !plate.isOpaque(x - 1, y)) c.p.set(x, y, lea[2]);
        if (!plate.isOpaque(x + 1, y)) c.p.set(x, y, CLOTH_DEEP.leather);
        if (y === 57 || y === 61) c.p.set(x, y, lea[0]);
        if ((y === 56 || y === 60) && x % 3 === 0) c.p.set(x, y, lea[2]);
      }
    }
    c.p.vline(CX, 50, 63, lea[0]);
    c.p.vline(CX - 1, 51, 63, lea[2]);
    for (const [x, y] of [
      [24, 52],
      [44, 52],
      [21, 58],
      [47, 58],
    ] as const) {
      c.p.set(x, y, METAL.silver[3]);
      c.p.set(x + 1, y + 1, METAL.silver[0]);
    }
    // 近侧肩甲：沿肩线叠起的三片弧形皮板，每片下缘一道深色、一枚铆钉
    const x0 = f ? 5 : 1;
    for (let i = 2; i >= 0; i--) {
      for (let x = x0 + i; x <= x0 + 15 - i; x++) {
        const t = bodyTop(c.body, x) - 1 + i * 3;
        for (let k = 0; k < 4; k++) {
          const y = t + k;
          let col: string = k === 0 ? lea[2] : lea[1];
          if (k === 3) col = CLOTH_DEEP.leather;
          if (x > x0 + 11 - i && k > 0) col = lea[0];
          c.p.set(x, y, col);
        }
      }
      const rx = x0 + 3 + i;
      c.p.set(rx, bodyTop(c.body, rx) + 1 + i * 3, METAL.silver[3]);
    }
    // 斜挎的皮带与铜扣
    c.p.line(20, 52, 46, 64, acc[0]);
    c.p.line(21, 52, 47, 64, CLOTH_DEEP.leather);
    c.p.rect(30, 56, 3, 3, METAL.gold[1]);
    c.p.set(30, 56, METAL.gold[3]);
  },
  buckskin: (c) => {
    const { main, acc } = ramps(c.spec);
    const f = c.spec.female;
    fillCloth(c.p, c.body, main, f);
    neckline(c, [
      [28, 45],
      [40, 45],
      [CX, 51],
    ]);
    // 胸前育克（覆肩）一道缝线，下缘一排流苏
    for (let x = f ? 9 : 5; x <= (f ? 58 : 60); x++) {
      const y = 53 + Math.round(Math.abs(x - CX) / 9);
      if (!c.body.isOpaque(x, y)) continue;
      c.p.set(x, y, main[0]);
      if (x % 2 === 0) {
        c.p.set(x, y + 1, main[2]);
        c.p.set(x, y + 2, main[1]);
        c.p.set(x, y + 3, main[0]);
      }
    }
    // 门襟
    c.p.vline(CX + 1, 51, 63, main[0]);
    // 打结的围巾：绕颈一圈，结在近侧，两个角垂下
    const sc = acc;
    c.p.poly(
      [
        [26, 44],
        [42, 44],
        [43, 48],
        [CX, 50],
        [25, 48],
      ],
      sc[1],
    );
    c.p.hline(26, 42, 44, sc[2]);
    c.p.line(CX, 50, 43, 48, sc[0]);
    c.p.circle(28, 49, 2, sc[1]);
    c.p.set(27, 48, sc[2]);
    c.p.poly(
      [
        [26, 50],
        [29, 50],
        [27, 57],
        [24, 56],
      ],
      sc[1],
    );
    c.p.line(29, 50, 27, 57, sc[0]);
    c.p.poly(
      [
        [29, 50],
        [31, 51],
        [32, 56],
        [30, 55],
      ],
      sc[0],
    );
  },
};

/** 画服饰（身体色调图中的皮肤会按领口裁剪）。 */
export function drawOutfit(c: OutfitCtx): void {
  const fn = OUTFITS[c.spec.outfit] ?? OUTFITS.tunic;
  fn(c);
}

/** 服饰是否露出肩膀与手臂（群岛披布）。 */
export function bareArms(spec: PortraitSpec): boolean {
  return spec.outfit === "island";
}

// ── 身上的饰物 ──

/** 披风：从两肩垂下，领口一枚金扣。 */
export function drawCape(p: Px, spec: PortraitSpec): void {
  const f = spec.female;
  const dark = spec.main === "navy" || spec.main === "black" || spec.main === "blue" || spec.main === "purple" || spec.main === "slate";
  const cape = CLOTH[dark ? "crimson" : "navy"];
  const deep = CLOTH_DEEP[dark ? "crimson" : "navy"];
  const left: Pt[] = f
    ? [
        [3, 64],
        [4, 58],
        [8, 54.5],
        [18, 51],
        [25, 49],
        [17, 56],
        [12, 64],
      ]
    : [
        [0, 64],
        [0, 57],
        [4, 53.5],
        [15, 49.5],
        [23, 47],
        [13, 56],
        [9, 64],
      ];
  const right: Pt[] = f
    ? [
        [41, 49],
        [49, 51],
        [56, 54],
        [60, 58],
        [61, 64],
        [52, 64],
        [48, 56],
      ]
    : [
        [43, 47],
        [52, 49.5],
        [60, 53],
        [64, 57],
        [64, 64],
        [53, 64],
        [49, 55],
      ];
  p.poly(left, cape[1]);
  p.poly(right, cape[0]);
  // 左肩受光与褶
  p.line(left[2][0], left[2][1], left[3][0], left[3][1], cape[2]);
  p.line(left[1][0] + 1, left[1][1], left[3][0], left[3][1], cape[2]);
  p.line(left[3][0] - 4, left[3][1] + 4, left[5][0] - 3, left[5][1] + 7, deep);
  p.line(right[1][0], right[1][1] + 3, right[5][0] + 1, right[5][1] - 1, deep);
  // 金扣链
  const g = METAL.gold;
  p.line(23, 48, 42, 48, g[1]);
  p.circle(f ? 24 : 23, 48, 1.5, g[2]);
  p.circle(42, 48, 1.5, g[1]);
  p.set(f ? 23 : 22, 47, g[3]);
}
/** 斜挎佩剑带：近侧肩到远侧腰，一枚铁扣。 */
export function drawSwordBelt(p: Px, spec: PortraitSpec): void {
  const f = spec.female;
  const lea = CLOTH.leather;
  // 剑带从翻领下穿过：衣襟开口（衬衫、褶饰）内不画
  const opening = new Px(S, S).poly(
    [
      [25, 43],
      [43, 43],
      [CX + 3, 64],
      [CX - 4, 64],
    ],
    ON,
  );
  const x0 = f ? 17 : 14;
  for (let i = 0; i < 3; i++) {
    const tmp = new Px(S, S).line(x0 + i, 51, 41 + i, 64, i === 0 ? lea[2] : i === 2 ? lea[0] : lea[1]);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) if (tmp.isOpaque(x, y) && !opening.isOpaque(x, y)) p.put(x, y, tmp.get(x, y));
  }
  // 铜扣
  const g = METAL.gold;
  p.rect(x0 + 3, 53, 3, 3, g[1]);
  p.set(x0 + 3, 53, g[3]);
  p.set(x0 + 4, 54, lea[0]);
}

/** 项链。 */
export function drawNecklace(p: Px, spec: PortraitSpec): void {
  const f = spec.female;
  const y = f ? 49 : 48;
  const curve = (x: number, k: number, d: number) => y + d + Math.round(((x - CX) * (x - CX)) / -k);
  switch (spec.necklace) {
    case "shell": {
      // 贝壳串：细绳 + 三枚贝壳
      for (let x = 27; x <= 41; x++) p.set(x, curve(x, 16, 4), P.wood[2]);
      for (const [x, yy] of [
        [29, y + 2],
        [CX, y + 4],
        [39, y + 2],
      ] as const) {
        p.rect(x - 1, yy, 3, 3, P.blossom[3]);
        p.set(x, yy + 2, P.blossom[1]);
        p.set(x + 1, yy + 1, P.blossom[1]);
        p.set(x - 1, yy, P.white);
      }
      break;
    }
    case "gold": {
      for (let x = 27; x <= 41; x++) p.set(x, curve(x, 16, 4), x % 2 ? METAL.gold[2] : METAL.gold[1]);
      for (let x = 29; x <= 39; x++) if (x % 3 === 0) p.set(x, curve(x, 16, 5), METAL.gold[1]);
      p.rect(CX - 1, y + 5, 3, 3, METAL.gold[2]);
      p.set(CX - 1, y + 5, METAL.gold[3]);
      p.set(CX, y + 6, P.red[2]);
      break;
    }
    case "beads": {
      const cols = [P.red[2], P.teal[3], P.gold[3], P.jade[3]];
      for (let x = 27; x <= 41; x++) p.set(x, curve(x, 16, 4), cols[x % cols.length]);
      break;
    }
    case "pendant": {
      for (let x = 28; x <= 40; x++) p.set(x, curve(x, 13, 3), P.wood[1]);
      p.rect(CX - 1, y + 4, 3, 4, P.jade[3]);
      p.set(CX - 1, y + 4, P.jade[4]);
      p.set(CX + 1, y + 7, P.jade[1]);
      p.set(CX, y + 3, METAL.gold[2]);
      break;
    }
    case "lei": {
      // 花环：绕颈一圈的鲜花，两端垂到胸前
      const cols = [
        [P.red[1], P.red[2], P.red[3]],
        [P.gold[1], P.gold[2], P.gold[3]],
        [P.blossom[0], P.blossom[1], P.blossom[2]],
        [P.plaster[2], P.plaster[3], P.white],
      ];
      let i = 0;
      for (let x = 24; x <= 44; x += 3) {
        const yy = curve(x, 12, 3);
        const col = cols[i++ % cols.length];
        p.circle(x, yy, 1.5, col[1]);
        p.set(x - 1, yy - 1, col[2]);
        p.set(x + 1, yy + 1, col[0]);
        p.set(x, yy, P.gold[3]);
      }
      p.set(25, 48, P.leaf[3]);
      p.set(43, 48, P.leaf[2]);
      break;
    }
    default:
      break;
  }
}

/** 身份小物件：交易所掌柜手边的算盘、酒馆老板肩上的布巾、仓库管事的货箱、船厂的木工尺。 */
export function drawRoleProp(p: Px, spec: PortraitSpec): void {
  if (spec.role === "market") {
    // 算盘（左下角入画）：木框、横梁、竖档，档上串着扁圆的算珠；框内是深色的空隙，算珠才显得出来
    const w = P.wood;
    p.rect(0, 50, 22, 14, w[1]);
    p.hline(0, 21, 50, w[3]);
    p.hline(0, 21, 51, w[2]);
    p.vline(21, 51, 63, w[0]);
    p.rect(0, 52, 20, 12, P.wood[0]);
    p.hline(0, 19, 55, w[2]);
    p.hline(0, 19, 56, w[1]);
    const bead = (x: number, y: number) => {
      p.hline(x, x + 2, y, P.red[2]);
      p.set(x, y, P.red[3]);
      p.hline(x, x + 2, y + 1, P.red[1]);
      p.set(x + 2, y + 1, P.red[0]);
    };
    for (let x = 1; x <= 17; x += 4) {
      // 竖档
      p.vline(x + 1, 52, 63, w[2]);
      // 梁上一粒、梁下三粒（有的拨上去贴着横梁）
      const up = (x * 7 + spec.seed) % 3 === 0;
      bead(x, up ? 53 : 52);
      const y0 = up ? 57 : 58;
      bead(x, y0);
      bead(x, y0 + 2);
      bead(x, y0 + 4);
    }
  } else if (spec.role === "tavern" && !spec.female) {
    // 搭在近侧肩上的红白格子布巾
    const cloth = new Px(S, S).poly(
      [
        [5, 51],
        [15, 47],
        [19, 48],
        [15, 64],
        [8, 64],
      ],
      ON,
    );
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        if (!cloth.isOpaque(x, y)) continue;
        const check = (Math.floor(x / 2) + Math.floor(y / 2)) % 2 === 0;
        let c: string = check ? P.red[2] : CLOTH.white[2];
        if (!cloth.isOpaque(x + 1, y)) c = check ? P.red[1] : CLOTH.white[0];
        p.set(x, y, c);
      }
    }
    p.line(15, 47, 6, 51, CLOTH.white[2]);
  } else if (spec.role === "warehouse") {
    // 左下角入画的木货箱：横板 + 斜撑 + 喷印的记号
    const w = P.wood;
    p.rect(0, 52, 17, 12, w[2]);
    p.hline(0, 16, 52, w[3]);
    p.hline(0, 16, 57, w[1]);
    p.vline(16, 53, 63, w[1]);
    p.line(1, 63, 15, 53, w[1]);
    p.set(0, 53, w[3]);
    p.rect(5, 59, 4, 3, P.red[1]);
    p.set(5, 59, P.red[2]);
  } else if (spec.role === "shipyard") {
    // 别在围裙上的木工尺
    p.rect(44, 56, 3, 8, P.gold[2]);
    p.vline(46, 56, 63, P.gold[1]);
    for (let y = 57; y < 64; y += 2) p.set(45, y, P.gold[0]);
  }
}
