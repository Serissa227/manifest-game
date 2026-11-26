// 发型（动画赛璐璐画法）：先画成遮罩（前层压在脸上，后层在头与身体之后），再统一上色。
// 前层由“发壳”（头顶，比颅骨外扩、后脑更鼓）与一绺绺“发束”（刘海、鬓角、尖发梢、发团）组成，每一绺记下编号：
// 发束之间一道暗缝、左缘挨着另一绺的一列受光、贴描边的右缘一列压暗，发梢与远侧整块暗面，外缘一圈发色最深阶的描边；
// 头顶下方顺着轮廓一道“天使环”光泽带（下缘成排的尖齿）。全程平涂，不用任何抖动或平铺纹理。
// 色阶见 tones.ts HAIR：[描边, 暗, 基, 亮, 光泽]。
import { Px, rgba, type Pt } from "../px";
import { inHead } from "./head";
import { bangsFor, type BangStyle, type HairStyle, type PortraitSpec } from "./spec";
import { CLOTH, HAIR } from "./tones";

const W = 64;
const ON = "#ffffffff";

/** 头发遮罩：前层与后层，以及前层每个像素所属的发束编号（0 为头顶发壳）。 */
export interface HairMasks {
  front: Px;
  back: Px;
  ids: Int16Array;
  /** 发髻、丸子等“发梢”的发束编号（花白夹杂时保持原发色） */
  keep: ReadonlySet<number>;
  /** 发旋（刘海分缝的位置；决定天使环尖齿的相位） */
  part: readonly [number, number];
  /** 光泽带的深度参数（天使环离头顶约 sheen/2.4 行）；0 表示不画光泽带 */
  sheen: number;
  /** 额前需要加发影的列 → 该列发际线下一行的 y，用于在额头上画一行阴影 */
  fringe: Map<number, number>;
  /** 头顶被帽子压住（不画天使环） */
  clipped: boolean;
}

class Build {
  readonly front = new Px(W, W);
  readonly back = new Px(W, W);
  readonly ids = new Int16Array(W * W);
  part: [number, number] = [26, 7];
  /** 光泽带（“天使环”）的深度参数：天使环顺着头顶轮廓、离头顶约 sheen/2.4 行 */
  sheen = 9.5;
  /** 不画光泽带（卷发用每一卷自己的高光） */
  noSheen = false;
  /** 发髻、丸子、辫冠这类“发梢”的发束编号：花白夹杂时保持原来的发色 */
  readonly keep = new Set<number>();
  private next = 1;

  /** 头顶发壳：颅骨外扩 pad 像素，头顶比两侧更蓬，后脑（近侧、画面左边）比前额更鼓——动画式的发量。 */
  shell(pad: number): this {
    this.front.ellipse(31.5 - pad * 0.3, 22 - pad * 0.6, 14.5 + pad, 14 + pad * 1.25, ON);
    return this;
  }

  /** 发壳外缘的一簇尖发梢（三角形）：(x, y) 为发根中点，(tx, ty) 为发尖，w 为发根宽。 */
  tuft(x: number, y: number, tx: number, ty: number, w: number): this {
    const dx = tx - x;
    const dy = ty - y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = (-dy / len) * (w / 2);
    const ny = (dx / len) * (w / 2);
    return this.lock([
      [x - nx, y - ny],
      [tx, ty],
      [x + nx, y + ny],
    ]);
  }

  /** 把发壳在折线 f 以下的部分裁掉（x 为列，返回该列头发最低能到的 y）。 */
  cut(f: (x: number) => number): this {
    for (let x = 0; x < W; x++) {
      const b = f(x);
      for (let y = 0; y < W; y++) if (y > b) this.front.set(x, y, null);
    }
    this.clearIds();
    return this;
  }

  /** 露出近侧耳朵。 */
  freeEar(): this {
    for (let y = 27; y <= 36; y++) for (let x = 13; x <= 19; x++) this.front.set(x, y, null);
    this.clearIds();
    return this;
  }

  private clearIds(): void {
    for (let i = 0; i < this.ids.length; i++) if (!(this.front.data[i] & 0xff)) this.ids[i] = 0;
  }

  private stampLock(m: Px): void {
    const id = this.next++;
    for (let i = 0; i < m.data.length; i++) {
      if (m.data[i] & 0xff) {
        this.front.data[i] = 0xffffffff;
        this.ids[i] = id;
      }
    }
  }

  /** 一绺发束（多边形），编号自增；后画的压在先画的上面。 */
  lock(pts: readonly Pt[]): this {
    this.stampLock(new Px(W, W).poly(pts, ON));
    return this;
  }

  /** 一绺弯曲的鬓发：沿折线 path 从 w0 宽渐细到发尖。 */
  strand(path: readonly Pt[], w0: number, w1 = 0.6): this {
    const left: Pt[] = [];
    const right: Pt[] = [];
    const n = path.length;
    for (let i = 0; i < n; i++) {
      const [x, y] = path[i];
      const [ax, ay] = path[Math.max(0, i - 1)];
      const [bx, by] = path[Math.min(n - 1, i + 1)];
      const dx = bx - ax;
      const dy = by - ay;
      const len = Math.hypot(dx, dy) || 1;
      const w = (w0 + (w1 - w0) * (i / (n - 1))) / 2;
      left.push([x - (dy / len) * w, y + (dx / len) * w]);
      right.push([x + (dy / len) * w, y - (dx / len) * w]);
    }
    return this.lock([...left, ...right.reverse()]);
  }

  /** 后层：多边形。 */
  backPoly(pts: readonly Pt[]): this {
    this.back.poly(pts, ON);
    return this;
  }

  /** 发辫：一串交错的小椭圆（从 (x0,y0) 到 (x1,y1)），画在前层或后层。 */
  braid(x0: number, y0: number, x1: number, y1: number, r: number, front: boolean): this {
    const n = Math.max(2, Math.round(Math.hypot(x1 - x0, y1 - y0) / 3.2));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const rr = r * (1 - t * 0.35);
      const x = x0 + (x1 - x0) * t;
      const y = y0 + (y1 - y0) * t;
      if (front) this.stampLock(new Px(W, W).ellipse(x, y, rr, 1.9, ON));
      else this.back.ellipse(x, y, rr, 1.9, ON);
    }
    return this;
  }

  /** 圆形发团（卷发刘海），计入前层。 */
  blob(x: number, y: number, rx: number, ry = rx): this {
    this.stampLock(new Px(W, W).ellipse(x, y, rx, ry, ON));
    return this;
  }

  /** 发髻、丸子、辫冠的一团：和 blob 一样，但记为“发梢”（花白夹杂时不变灰）。 */
  knot(x: number, y: number, rx: number, ry = rx): this {
    this.keep.add(this.next);
    return this.blob(x, y, rx, ry);
  }

  /** 卷发的外轮廓：沿 (cx, cy) 为心、半径 (r, ry) 的弧，每隔 step 度一个半径 br 的小半圆凸起（只进遮罩，不计发束）。 */
  bumps(cx: number, cy: number, r: number, ry: number, a0: number, a1: number, step: number, br: number): this {
    for (let a = a0; a <= a1 + 0.01; a += step) {
      const rad = (a * Math.PI) / 180;
      this.front.circle(cx + Math.cos(rad) * r, cy + Math.sin(rad) * ry, br, ON);
    }
    return this;
  }
}

/** 折线函数：按控制点线性插值（两端外延为常数）。 */
function pl(pts: readonly Pt[]): (x: number) => number {
  return (x) => {
    if (x <= pts[0][0]) return pts[0][1];
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1];
      const [x1, y1] = pts[i];
      if (x <= x1) return Math.round(y0 + ((y1 - y0) * (x - x0)) / (x1 - x0));
    }
    return pts[pts.length - 1][1];
  };
}

/**
 * 额前发际线与两侧的外轮廓（x 为列，返回该列头发最低能到的 y）。side / far：近侧、远侧鬓发垂到的高度。
 * 刘海决定额前的发际线：后梳露出整个额头（发际线高、正中一点美人尖），中分在正中抬高，其余由刘海盖住。
 */
function frontCut(kind: BangStyle, side: number, far: number): (x: number) => number {
  switch (kind) {
    case "none":
      return pl([
        [12, side],
        [19, side],
        [20.5, 19],
        [22.5, 15.5],
        [26, 13.5],
        [31, 13],
        [33, 14],
        [35, 13],
        [40, 13.5],
        [43.5, 15.5],
        [45.5, 19],
        [47.5, far],
        [51, far],
      ]);
    case "center":
      return pl([
        [12, side],
        [19, side],
        [21, 21],
        [25, 16],
        [30, 12],
        [36, 12],
        [41, 16],
        [45, 21],
        [48, far],
        [51, far],
      ]);
    default:
      return pl([
        [12, side],
        [19, side],
        [21, 19],
        [24, 16],
        [40, 16],
        [45, 20],
        [48, far],
        [51, far],
      ]);
  }
}

/** 披下来的长发在身后的部分：近侧从耳后垂到肩后，远侧沿脖子露出一条；下缘是几簇尖尖的发梢。 */
function longBack(b: Build, bottom: number, spread = 0): void {
  b.backPoly([
    [14, 16],
    [22, 24],
    [23, 42],
    [22, bottom - 5],
    [20, bottom - 1],
    [18.5, bottom - 4],
    [16, bottom],
    [14, bottom - 4],
    [11.5 - spread, bottom - 1],
    [9 - spread, bottom - 5],
    [9 - spread, 42],
    [11 - spread, 26],
  ]);
  b.backPoly([
    [41, 14],
    [48 + spread / 2, 20],
    [50 + spread, 36],
    [50.5 + spread, bottom - 7],
    [48.5, bottom - 10],
    [47, bottom - 5],
    [45, bottom - 9],
    [42, 44],
    [44, 30],
  ]);
}

/** 鬓角：近侧一绺垂在耳前、远侧一绺沿脸颊垂下，把脸框住（短发也有），发尖收成一点。 */
function temples(b: Build, near: number, far: number): void {
  b.strand(
    [
      [22.5, 13],
      [20.8, 19],
      [20.2, 24],
      [20.6, near],
    ],
    4.2,
    0.7,
  );
  if (far <= 0) return;
  b.strand(
    [
      [43.5, 13],
      [45.6, 19],
      [46.4, far],
    ],
    3.6,
    0.7,
  );
}

/** 后脑向外支棱的几簇尖发梢（男式短发的轮廓），n 为簇数。 */
function backTufts(b: Build, n: number, reach = 0): void {
  const all: readonly (readonly [number, number, number, number, number])[] = [
    [18, 10, 12 - reach, 6 - reach, 6],
    [15.5, 16, 10 - reach, 14, 6],
    [15.5, 22, 11 - reach, 23, 5],
    [24, 6, 21, 1 - reach, 6],
  ];
  for (let i = 0; i < Math.min(n, all.length); i++) {
    const [x, y, tx, ty, w] = all[i];
    b.tuft(x, y, tx, ty, w);
  }
}

/** 近侧垂下的一绺鬓发，盖住耳朵（长发、齐耳短发）。 */
function sideLock(b: Build, bottom: number, wave = 0): void {
  b.strand(
    [
      [19, 13],
      [16.5, 22],
      [16 - wave, 30],
      [17 + wave, 38],
      [18, bottom],
    ],
    8,
    2,
  );
  b.strand(
    [
      [23, 15],
      [21, 23],
      [21 + wave, 32],
      [22, bottom - 5],
    ],
    5,
    1,
  );
}

/** 远侧沿脸颊垂下的细鬓发。 */
function farLock(b: Build, bottom: number): void {
  b.strand(
    [
      [44, 15],
      [46.5, 24],
      [47.5, 32],
      [46.5, bottom],
    ],
    5,
    1.2,
  );
}

// ── 刘海 ──
// 刘海的坐标按“垂到 y=22”设计，low 让整排刘海按比例伸缩（短发的刘海短一些）。

/** 把设计坐标（刘海垂到 22）按 low 伸缩：发根（y≤13）不动，越往下伸缩越多。 */
function stretch(low: number): (p: Pt) => Pt {
  const k = (low - 13) / 9;
  return ([x, y]) => [x, y <= 13 ? y : 13 + (y - 13) * k];
}

/** 沿路径的发束（按 low 伸缩）。 */
function strandAt(b: Build, low: number, path: readonly Pt[], w0: number, w1: number): void {
  b.strand(path.map(stretch(low)), w0, w1);
}

/** 齐刘海：一排宽发束，下缘几乎齐平（正中略长、两侧顺着额头收短），发束之间一道道竖直的暗缝。 */
function bluntBangs(b: Build, low: number): void {
  const f = stretch(low);
  const locks: readonly (readonly [number, number, number])[] = [
    [20.6, 19, 5],
    [25.3, 21.4, 5.2],
    [30.3, 22.4, 5.2],
    [35.3, 22.2, 5.2],
    [40.3, 21.2, 5.2],
    [44.8, 18.6, 4.6],
  ];
  for (const [x, y, w] of locks) {
    b.lock(
      (
        [
          [x - w / 2, 13],
          [x + w / 2, 13],
          [x + w / 2 - 0.2, y - 0.8],
          [x + 0.8, y + 0.5],
          [x - w / 2 + 0.3, y],
        ] as const
      ).map(f),
    );
  }
  b.part = [31, 4];
  b.sheen = 10;
}

/** 碎发：细而尖的发束，长短参差，发尖之间露出一点额头。 */
function wispyBangs(b: Build, low: number): void {
  const f = stretch(low);
  const tips: readonly (readonly [number, number, number])[] = [
    [20, 17.5, 3.2],
    [23.4, 20.5, 3.6],
    [26.8, 22.5, 3.2],
    [30.2, 20, 3.6],
    [33.6, 23, 3.2],
    [37, 21, 3.6],
    [40.4, 22.2, 3.2],
    [43.6, 19.2, 3.2],
    [46.2, 16, 2.6],
  ];
  for (const [x, y, w] of tips) {
    const my = (13 + y) / 2;
    b.lock(
      (
        [
          [x - w / 2 - 0.6, 13],
          [x + w / 2 - 0.6, 13],
          [x + w * 0.3, my + 1],
          [x + 0.6, y + 0.5],
          [x - w * 0.3, my],
        ] as const
      ).map(f),
    );
  }
  b.part = [29, 5];
  b.sheen = 9;
}

/** 侧分：发缝在近侧（x≈24），几绺宽发束从发缝一齐扫向远侧额角；发缝另一侧一小绺垂向近侧鬓角。 */
function sideBangs(b: Build, low: number): void {
  strandAt(
    b,
    low,
    [
      [24, 9],
      [30, 11.5],
      [37, 14],
      [43, 17],
      [46.5, 21.5],
    ],
    6.5,
    2,
  );
  strandAt(
    b,
    low,
    [
      [24, 11],
      [29, 14.5],
      [35, 17.5],
      [40, 20],
      [43.5, 22.5],
    ],
    6,
    1.4,
  );
  strandAt(
    b,
    low,
    [
      [24, 13],
      [27.5, 16.5],
      [32, 19.5],
      [36.5, 21.5],
    ],
    5.5,
    1,
  );
  strandAt(
    b,
    low,
    [
      [23.5, 14.5],
      [25.5, 18],
      [28.5, 20.5],
    ],
    4,
    0.8,
  );
  strandAt(
    b,
    low,
    [
      [22.5, 10],
      [20.8, 14],
      [19.6, 19],
      [19.4, 23],
    ],
    5,
    1.6,
  );
  b.part = [23, 6];
  b.sheen = 9;
}

/** 斜刘海：发缝在远侧（x≈41），长发束斜斜扫过额头、盖住近侧眉梢；远侧一小绺垂向鬓角。 */
function sweptBangs(b: Build, low: number): void {
  strandAt(
    b,
    low,
    [
      [41, 9],
      [35, 12],
      [28, 15.5],
      [22.5, 19.5],
      [19.5, 24],
    ],
    7,
    1.6,
  );
  strandAt(
    b,
    low,
    [
      [41, 11],
      [36, 14.5],
      [30, 18],
      [25.5, 21.5],
      [23, 24.5],
    ],
    6,
    1.2,
  );
  strandAt(
    b,
    low,
    [
      [42, 13],
      [38.5, 17],
      [34, 20.5],
      [30.5, 22.5],
    ],
    5,
    1,
  );
  strandAt(
    b,
    low,
    [
      [43, 14.5],
      [41.5, 18.5],
      [39, 21.5],
    ],
    4,
    0.9,
  );
  strandAt(
    b,
    low,
    [
      [42.5, 10],
      [45, 14],
      [46.5, 19.5],
    ],
    4,
    1.4,
  );
  b.part = [41, 6];
  b.sheen = 10;
}

/** 中分：发缝在正中，两片“八字”帘幕向两侧分开，露出额头中间。 */
function centerBangs(b: Build, low: number): void {
  strandAt(
    b,
    low,
    [
      [32, 9],
      [28, 12.5],
      [24, 17],
      [21.5, 22],
      [20.5, 26],
    ],
    6,
    2,
  );
  strandAt(
    b,
    low,
    [
      [31, 11],
      [27.5, 15],
      [25, 19.5],
      [24, 23],
    ],
    4.5,
    1,
  );
  strandAt(
    b,
    low,
    [
      [34, 9],
      [38.5, 12.5],
      [42.5, 17],
      [45, 22],
      [46, 26],
    ],
    5,
    2,
  );
  strandAt(
    b,
    low,
    [
      [35.5, 11],
      [39, 15],
      [41, 19.5],
      [41.5, 22],
    ],
    3.5,
    1,
  );
  b.part = [33, 4];
  b.sheen = 9.5;
}

/** 无刘海、向后梳：额头全露，几道发束从发际线向头顶与脑后梳去，发丝都朝后。 */
function backBangs(b: Build): void {
  b.strand(
    [
      [44.5, 17],
      [40, 12.5],
      [33, 9.5],
      [25, 9],
      [18, 12],
    ],
    3.5,
    2,
  );
  b.strand(
    [
      [40.5, 14.5],
      [34, 12.2],
      [27, 12.4],
      [20.5, 16],
    ],
    3,
    1.5,
  );
  b.strand(
    [
      [34.5, 13.5],
      [29, 14.2],
      [23.5, 17],
    ],
    2.4,
    1,
  );
  b.part = [15, 17];
  b.sheen = 13;
}

/** 卷发刘海：两排小发卷沿发际线错开排着（每一卷自己打光），中间垂得最低——一个个小卷，不是一排大圆球。 */
function curlyBangs(b: Build, low: number): void {
  const f = stretch(low);
  for (const [x, y] of [
    [21.5, 16.5],
    [25.5, 18],
    [29.5, 18.5],
    [33.5, 18.5],
    [37.5, 18],
    [41.5, 17],
    [45, 15.5],
  ] as const) {
    const [, yy] = f([x, y]);
    b.blob(x, yy, 2.3, 2.1);
  }
  for (const [x, y] of [
    [19.5, 19.5],
    [23.5, 21],
    [27.5, 21.8],
    [31.5, 22],
    [35.5, 21.8],
    [39.5, 21],
    [43.5, 19.5],
  ] as const) {
    const [, yy] = f([x, y]);
    b.blob(x, yy, 2.3, 2.1);
  }
  b.part = [31, 5];
  b.sheen = 8.5;
}

/** 按刘海种类画刘海；low 为刘海大约垂到的行。 */
function bangs(b: Build, kind: BangStyle, low: number): void {
  switch (kind) {
    case "blunt":
      return bluntBangs(b, low);
    case "wispy":
      return wispyBangs(b, low);
    case "side":
      return sideBangs(b, low);
    case "swept":
      return sweptBangs(b, low);
    case "center":
      return centerBangs(b, low);
    case "none":
      return backBangs(b);
    case "curly":
      return curlyBangs(b, low);
  }
}

/** 各发型的构造：发壳、两侧与身后的头发、发髻与发辫；刘海由 bangs() 按 spec.bangs 另画。 */
const STYLES: Readonly<Record<HairStyle, (b: Build, spec: PortraitSpec, k: BangStyle) => void>> = {
  bald: (b, spec) => {
    // 老年光头：耳后顺着颅骨的弧线往上收尖的一簇头发（下缘两三个小锯齿，上端贴着头皮渐细），不是一块直角的补丁
    if (spec.age === 2) {
      b.lock([
        [19.8, 17.2],
        [16.5, 19.5],
        [13.5, 23],
        [11, 27.5],
        [9.6, 32],
        [9.8, 36.2],
        [11.2, 34],
        [12.4, 37],
        [13.4, 34.2],
        [14.8, 37.2],
        [15.6, 33.6],
        [14.6, 29],
        [15.4, 25],
        [17.4, 21.4],
      ]);
      // 耳朵露出来（只让开耳廓本身）
      for (let y = 27; y <= 34; y++) for (let x = 14; x <= 19; x++) b.front.set(x, y, null);
    }
    b.part = [14, 18];
    b.noSheen = true;
  },
  crop: (b, _s, k) => {
    // 短寸：紧贴头皮的圆顶，轮廓光滑、没有发梢；鬓角短而齐，刘海只到额头上沿
    b.shell(1).cut(frontCut(k, 26, 21)).freeEar();
    temples(b, 24, 22);
    bangs(b, k, 17.5);
  },
  side: (b, _s, k) => {
    // 侧分：头顶蓬起一个顺滑的弧、后脑圆润地收下来（没有尖发梢），发缝一侧的发束扫向远侧
    b.shell(2.5).cut(frontCut(k, 27, 24)).freeEar();
    b.strand(
      [
        [27, 4.5],
        [20, 6.5],
        [15.5, 11],
        [14, 17],
        [15, 22],
      ],
      6,
      3,
    );
    temples(b, 28, 27);
    bangs(b, k, 21);
  },
  messy: (b, _s, k) => {
    b.shell(3).cut(frontCut(k, 27, 24)).freeEar();
    backTufts(b, 3, 1);
    // 头顶支棱的发梢
    for (const [x, y, dx] of [
      [17, 7, -3],
      [22, 3, -2],
      [28, 1, 0],
      [34, 2, 2],
      [40, 5, 3],
      [45, 10, 4],
    ] as const) {
      b.lock([
        [x - 3, y + 7],
        [x + dx, y - 1],
        [x + 4, y + 7],
      ]);
    }
    temples(b, 29, 28);
    bangs(b, k, 21.5);
  },
  tied: (b, _s, k) => {
    b.shell(2).cut(frontCut(k, 27, 22)).freeEar();
    temples(b, 28, 26);
    bangs(b, k, 19);
    // 脑后的低马尾，发梢收成两簇尖
    b.backPoly([
      [11, 24],
      [17, 23],
      [16, 38],
      [14, 47],
      [12.5, 44],
      [10.5, 48],
      [9, 42],
      [9, 34],
    ]);
  },
  topknot: (b, _s, k) => {
    b.shell(2).cut(frontCut(k, 27, 22)).freeEar();
    temples(b, 27, 25);
    bangs(b, k, 18);
    b.knot(27, 3.5, 5, 4);
    b.lock([
      [23, 7],
      [31, 7],
      [29, 9],
      [25, 9],
    ]);
  },
  curly: (b, _s, k) => {
    // 短卷发：发壳外一圈小半圆凸起（每 3–4 像素一个），宽出颅骨 3–4 像素；近侧鬓边再垂两团小卷，不是一顶头盔
    b.shell(1);
    b.bumps(31, 20.5, 15.8, 15.4, 186, 354, 15, 1.9);
    for (const [x, y] of [
      [15, 23.5],
      [14.6, 27],
      [47.2, 22.5],
    ] as const)
      b.front.circle(x, y, 2.2, ON);
    b.cut(frontCut(k, 30, 26)).freeEar();
    bangs(b, k, 19);
    b.noSheen = true;
  },
  long: (b, _s, k) => {
    b.shell(2.5).cut(frontCut(k, 40, 36));
    sideLock(b, 44);
    farLock(b, 40);
    bangs(b, k, 20.5);
    longBack(b, 58);
  },
  slick: (b) => {
    // 后梳：贴着头型梳到脑后，后颈一小撮向后翘
    b.shell(1.5).cut(frontCut("none", 27, 21)).freeEar();
    b.tuft(16, 22, 12, 26, 4);
    backBangs(b);
    // 鬓角两道向后的发丝
    b.strand(
      [
        [22, 22],
        [19, 17],
        [17, 14],
      ],
      2.5,
      1,
    );
  },
  braid: (b, _s, k) => {
    b.shell(2).cut(frontCut(k, 27, 22)).freeEar();
    temples(b, 28, 26);
    bangs(b, k, 19);
    b.braid(14, 25, 9, 56, 2.8, false);
  },
  straight: (b, _s, k) => {
    b.shell(2.5).cut(frontCut(k, 46, 40));
    sideLock(b, 50);
    farLock(b, 46);
    bangs(b, k, 22);
    longBack(b, 63, 1);
  },
  ponytail: (b, _s, k) => {
    b.shell(2).cut(frontCut(k, 28, 23)).freeEar();
    temples(b, 31, 0);
    bangs(b, k, 22);
    farLock(b, 34);
    // 马尾：在后脑高处扎起，先向后翘再垂到肩后，发梢分成几簇尖
    b.backPoly([
      [13, 9],
      [18, 11],
      [16, 17],
      [12, 26],
      [11, 38],
      [10, 51],
      [8.5, 46],
      [6.5, 50],
      [5.5, 43],
      [4.5, 32],
      [7, 20],
      [9, 13],
    ]);
  },
  bun: (b, _s, k) => {
    b.shell(2).cut(frontCut(k, 28, 23)).freeEar();
    temples(b, 31, 0);
    bangs(b, k, 21);
    farLock(b, 33);
    // 后脑偏上的圆髻
    b.knot(16.5, 9.5, 5.5, 5);
  },
  braids: (b, _s, k) => {
    b.shell(2).cut(frontCut(k, 32, 30));
    bangs(b, k, 21);
    // 近侧辫子搭到胸前，远侧辫子垂在身后
    b.braid(19, 33, 18, 60, 2.8, true);
    b.braid(45, 30, 49, 54, 2.6, false);
  },
  bob: (b, _s, k) => {
    b.shell(3).cut(frontCut(k, 41, 39));
    sideLock(b, 42);
    farLock(b, 41);
    bangs(b, k, 22);
  },
  curls: (b, _s, k) => {
    // 长卷发：发壳外一整圈小半圆凸起，身后的卷发一团团垂到肩上，外缘也是一个个凸起
    b.shell(1);
    b.bumps(31, 19.5, 16.2, 15.8, 0, 345, 15, 1.9);
    b.cut(frontCut(k, 46, 42));
    sideLock(b, 48, 1.5);
    farLock(b, 44);
    bangs(b, k, k === "curly" ? 20 : 23);
    longBack(b, 60, 2);
    for (const [x, y, r] of [
      [10, 30, 3.4],
      [8.5, 36, 3.6],
      [9, 42.5, 3.6],
      [8.5, 49, 3.6],
      [10.5, 55, 3.4],
      [15.5, 58, 3.2],
      [20.5, 58.5, 2.8],
      [50, 28, 3.2],
      [51.5, 34, 3.4],
      [51.5, 40.5, 3.4],
      [51, 47, 3.2],
      [48.5, 52.5, 3],
      [44.5, 53.5, 2.6],
    ] as const)
      b.back.circle(x, y, r, ON);
  },
  sidebraid: (b, _s, k) => {
    b.shell(2.5).cut(frontCut(k, 34, 28));
    bangs(b, k, 22);
    farLock(b, 36);
    b.braid(19, 32, 23, 62, 3, true);
  },
  updo: (b, _s, k) => {
    b.shell(2).cut(frontCut(k, 28, 23)).freeEar();
    temples(b, 32, 31);
    bangs(b, k, 23);
    // 盘在头顶偏后的发髻
    b.knot(22, 4.5, 7.5, 4.5);
    b.knot(16.5, 8, 4, 4);
  },
  pixie: (b, _s, k) => {
    // 极短发：后颈两小撮向下收的碎发（柔和，不是男式的尖发梢）
    b.shell(2.5).cut(frontCut(k, 28, 24)).freeEar();
    b.tuft(16.5, 21, 14, 27, 4);
    b.tuft(19, 23, 18, 29, 3);
    temples(b, 29, 28);
    bangs(b, k, 21);
  },
  twinbuns: (b, _s, k) => {
    b.shell(2).cut(frontCut(k, 28, 23)).freeEar();
    temples(b, 31, 30);
    bangs(b, k, 21);
    b.knot(16.5, 5.5, 5, 5);
    b.knot(41, 3.5, 5, 5);
  },
  wavy: (b, _s, k) => {
    b.shell(3).cut(frontCut(k, 48, 42));
    sideLock(b, 52, 3);
    farLock(b, 46);
    bangs(b, k, 24);
    longBack(b, 63, 3);
  },
  crownbraid: (b, _s, k) => {
    b.shell(2).cut(frontCut(k, 28, 23)).freeEar();
    temples(b, 30, 29);
    bangs(b, k, 21);
    // 绕头顶一圈的辫冠
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      const x = 17 + t * 30;
      const y = 9.5 - Math.sin(t * Math.PI) * 5 + t * 1;
      b.blob(x, y, 2.4, 2);
    }
  },
};

/** 生成发型遮罩。clipY：帽子压住的高度，这一行以上的头发（包括后层）被裁掉；0 表示不裁。 */
export function hairMasks(spec: PortraitSpec, clipY: number, keepBack = true): HairMasks {
  const b = new Build();
  STYLES[spec.hair](b, spec, bangsFor(spec.hair, spec.bangs));
  if (clipY > 0) {
    for (let y = 0; y < clipY; y++) {
      for (let x = 0; x < W; x++) {
        b.front.set(x, y, null);
        b.ids[y * W + x] = 0;
        b.back.set(x, y, null);
      }
    }
  }
  if (!keepBack) b.back.clear();
  const fringe = new Map<number, number>();
  for (let x = 20; x <= 46; x++) {
    let low = -1;
    for (let y = 6; y <= 26; y++) if (b.front.isOpaque(x, y)) low = y;
    if (low >= 0 && !b.front.isOpaque(x, low + 1)) fringe.set(x, low + 1);
  }
  return { front: b.front, back: b.back, ids: b.ids, keep: b.keep, part: b.part, sheen: b.noSheen ? 0 : b.sheen, fringe, clipped: clipY > 0 };
}

/** 卷发的发卷单元：4×4 一卷、隔行错开两格（砖砌式），不排成整齐的横纹或鱼鳞。 */
const CURL_G = 4;

/**
 * 某像素在所属发卷里的位置：返回 1 右下的暗缝、3 左上的受光、2 其余，以及发卷的编号（花白夹杂按卷换灰）。
 * 每一卷是 4×4 的单元：左上一段 Γ 形的 3 像素亮弧、右下一段 ˩ 形的暗缝——两阶平涂，没有单独的亮点或暗点。
 * （3×3 的单元在 64 像素里排出来是一道道横纹，读不成一个个小卷，所以放大到 4×4。）
 */
function curlAt(x: number, y: number): { t: 1 | 2 | 3; cell: number } {
  const row = Math.floor(y / CURL_G);
  const off = (row & 1) * 2;
  const col = Math.floor((x + off) / CURL_G);
  const u = x + off - col * CURL_G;
  const v = y - row * CURL_G;
  const cell = row * 97 + col;
  if ((v === 0 && u <= 1) || (v === 1 && u === 0)) return { t: 3, cell };
  if ((v === 3 && u >= 1) || (v === 2 && u === 3)) return { t: 1, cell };
  return { t: 2, cell };
}

/**
 * 孤立像素清理（只在头发的遮罩里）：四邻里没有同色的格，改成四邻中的多数色——发卷被外缘、暗面切碎后剩下的单格亮点、暗点
 * 不会在 2× 下读成迷彩噪点。描边的像素不动、也不参与投票（外缘的轮廓要完整）；四邻全是描边的一格并进描边。
 */
function cleanIsolated(dst: Px, mask: Px, keepAt: (x: number, y: number) => boolean): void {
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      if (!mask.isOpaque(x, y) || keepAt(x, y)) continue;
      const v = dst.get(x, y);
      const ns: number[] = [];
      const votes: number[] = [];
      for (const [dx, dy] of [
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
      ] as const) {
        if (!mask.isOpaque(x + dx, y + dy)) continue;
        ns.push(dst.get(x + dx, y + dy));
        if (!keepAt(x + dx, y + dy)) votes.push(dst.get(x + dx, y + dy));
      }
      if (ns.length === 0 || ns.includes(v)) continue;
      const count = new Map<number, number>();
      // 四邻全是描边时（被轮廓围住的一格），就并进描边
      for (const n of votes.length ? votes : ns) count.set(n, (count.get(n) ?? 0) + 1);
      let best = -1;
      let bn = 0;
      for (const [c, n] of count) {
        if (n > bn) {
          bn = n;
          best = c;
        }
      }
      if (best !== -1) dst.put(x, y, best);
    }
  }
}

/** 花白夹杂时是否换灰：每三绺发束一绺、发壳上每三道发丝一道（发髻、丸子等发梢保持原发色）。 */
function streak(h: HairMasks, x: number, y: number, id: number, curls: boolean): boolean {
  if (curls) return ((curlAt(x, y).cell % 3) + 3) % 3 === 0;
  if (id > 0) return !h.keep.has(id) && id % 3 === 0;
  const sector = Math.floor((Math.atan2(y - h.part[1], x - h.part[0]) * 180) / Math.PI / 7);
  return ((sector % 3) + 3) % 3 === 0;
}

/**
 * 鬓角带：贴着脸（或耳朵上方）的一条约 3 像素宽的头发，从帽檐下沿（或发际线）一直到耳垂（y≤35），
 * 远侧是贴着脸缘的 2 像素。返回该像素离露出来的皮肤有几格（1..3），不在鬓角带上返回 0。
 */
function templeBand(h: HairMasks, spec: PortraitSpec, x: number, y: number): number {
  const male = !spec.female;
  const skin = (sx: number, sy: number) => !h.front.isOpaque(sx, sy) && (inHead(spec.face, sx, sy, male) || earAt(sx, sy));
  if (y < 15 || y > 35) return 0;
  if (x <= 26) {
    for (let k = 1; k <= 3; k++) if (skin(x + k, y)) return k;
    // 耳朵上方的一段
    if (x >= 13 && x <= 20) for (let k = 1; k <= 3; k++) if (earAt(x, y + k) && !h.front.isOpaque(x, y + k)) return k;
    return 0;
  }
  if (x >= 40 && y <= 31) for (let k = 1; k <= 2; k++) if (skin(x - k, y)) return k;
  return 0;
}

/** 近侧耳朵的范围（与 head.ts 的耳朵印章一致）。 */
function earAt(x: number, y: number): boolean {
  return x >= 14 && x <= 19 && y >= 27 && y <= 34;
}

/**
 * 给前层上色：每绺发束左缘与上缘受光、右缘与下方交界压暗（相邻发束的交界成一道暗缝），
 * 发壳上的发丝从发旋放射，下缘（发尖）与远侧压暗；光泽带是一道绕发旋的弧，随刘海的分法移动，
 * 近侧最亮、被发丝的暗缝打断成一段段；远侧外缘里侧一道侧逆光的亮边（只在头发上）。
 * 卷发按发卷格子逐卷上色（左上受光、下沿暗缝），不画光泽带。
 * 花白：1 鬓角带用灰色两阶平涂（外缘保留原发色描边）；2 鬓角带 + 两鬓（近侧连着后脑）整片灰 + 头顶每三绺一绺灰
 * （发髻、丸子等发梢保持原发色）。
 */
export function paintHair(dst: Px, h: HairMasks, spec: PortraitSpec, opts: { curls?: boolean } = {}): void {
  const ramp = HAIR[spec.hairColor];
  const m = h.front;
  const curls = !!opts.curls;
  const on = (x: number, y: number) => m.isOpaque(x, y);
  const id = (x: number, y: number) => (x < 0 || y < 0 || x >= W || y >= W || !on(x, y) ? -1 : h.ids[y * W + x]);
  const px = h.part[0];
  const male = !spec.female;
  const onFace = (x: number, y: number) => inHead(spec.face, x, y, male);
  const tone = new Uint8Array(W * W);
  // 每一列头发的最上一行（算“离头顶多远”用）
  const top = new Int16Array(W).fill(-1);
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < W; y++) {
      if (on(x, y)) {
        top[x] = y;
        break;
      }
    }
  }
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      if (!on(x, y)) continue;
      let t = 2;
      const i = id(x, y);
      const r = id(x + 1, y);
      const l = id(x - 1, y);
      const dn = id(x, y + 1);
      if (curls) {
        // 卷发逐卷上色；头顶近侧的几卷受光处用光泽色，卷发也有光
        t = curlAt(x, y).t;
        if (t === 3 && x < 32 && y < 16) t = 4;
      } else if (i > 0) {
        // 发束：右侧与下方另一绺的交界是一道暗缝，左缘挨着另一绺的一列受光
        if ((r > 0 && r !== i) || (dn > 0 && dn !== i)) t = 1;
        else if (l > 0 && l !== i && x < 42) t = 3;
        // 发梢：离下缘两行以内、偏右半边压暗，发尖读作一簇一簇
        else if (!on(x, y + 2) && (r < 0 || !on(x + 1, y + 1))) t = 1;
        // 发束贴着描边的右缘一列压暗，一绺绺更有体积（远侧留给侧逆光）
        else if (!on(x + 2, y) && on(x + 1, y) && y > 14 && x < 40) t = 1;
      }
      // 远侧（右）背光：一大块平涂的暗面
      if (x >= 44 && t === 2) t = 1;
      if (x >= 44 && t === 3 && curls) t = 2;
      // 头顶左上沿一窄条受光
      if (!curls && t === 2 && x < 32 && y - top[x] <= 1 && y < 14) t = 3;
      // 侧逆光：远侧外缘里侧一列亮边（外缘挨着背景，不挨着脸），只在头发上
      if (x >= 41 && y >= top[x] + 2 && y <= 34 && on(x + 1, y) && !on(x + 2, y) && !onFace(x + 2, y) && (t === 1 || t === 2)) t = 3;
      // 描边：挨着非头发的像素（外缘、发梢、与脸的交界）用发色最深一阶
      if (!on(x - 1, y) || !on(x + 1, y) || !on(x, y + 1) || !on(x, y - 1)) t = 0;
      tone[y * W + x] = t;
    }
  }
  if (h.sheen > 0 && !curls && !h.clipped) {
    // 天使环：顺着头顶轮廓、在头顶下方 ring 行处的一道光泽带，上沿用光泽色、下沿用亮阶；
    // 下沿每隔三列向下伸出一个尖齿，读起来是一绺绺发丝上的光，而不是一条死板的线。两端收细。
    const ring = Math.max(3, Math.round(h.sheen / 2.4));
    let left = W;
    for (let x = 0; x < W; x++) if (top[x] >= 0) left = Math.min(left, x);
    for (let x = left + 2; x <= 42; x++) {
      if (top[x] < 0) continue;
      const tooth = (x + px) % 3 === 0 ? 1 : 0;
      const end = x <= left + 3 || x >= 40;
      const y0 = top[x] + ring;
      const rows = end ? 1 : 2 + tooth;
      for (let k = 0; k < rows; k++) {
        const y = y0 + k;
        if (!on(x, y) || tone[y * W + x] === 0 || tone[y * W + x] === 1) continue;
        tone[y * W + x] = k === 0 && !end ? 4 : 3;
      }
    }
  }
  const gray = HAIR.gray;
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      if (!on(x, y)) continue;
      const t = tone[y * W + x];
      let c: string = ramp[t];
      if (spec.grizzle > 0) {
        const band = templeBand(h, spec, x, y);
        // 外缘挨着背景的描边保留原发色；挨着脸的一侧用深一阶的灰收边
        const rim = t === 0 && ((!on(x - 1, y) && !onFace(x - 1, y) && !earAt(x - 1, y)) || !on(x, y - 1) || (!on(x, y + 1) && !onFace(x, y + 1)));
        if (band > 0 && !rim) {
          const far = x >= 40;
          c = far ? gray[t >= 3 ? 3 : t === 0 ? 1 : 2] : band === 1 || t <= 1 ? gray[2] : gray[3];
        } else if (spec.grizzle === 2 && t > 0 && (((x <= 23 || x >= 43) && y >= 10 && !h.keep.has(id(x, y))) || streak(h, x, y, id(x, y), curls))) {
          // 花白夹杂：两鬓（近侧连着后脑、远侧的鬓发）先白，头顶每三绺一绺灰
          c = gray[t];
        }
      }
      dst.set(x, y, c);
    }
  }
  cleanIsolated(dst, m, (x, y) => tone[y * W + x] === 0);
}

/**
 * 合成后的头发再收拾一遍：前层压在后层上、发绳与发辫纹路画上去之后，交界处可能又凑出单格的亮点或暗点。
 * 只看头发遮罩里、四邻都是头发颜色的格（挨着脸、衣服、背景的不动），描边色不动。
 */
export function cleanHairComposite(fig: Px, h: HairMasks, spec: PortraitSpec): void {
  const ramp = HAIR[spec.hairColor];
  const tones = new Set([...ramp, ...HAIR.gray].map((c) => rgba(c)));
  const lines = new Set([rgba(ramp[0]), rgba(HAIR.gray[0])]);
  const mask = new Px(W, W);
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) if (h.front.isOpaque(x, y) || h.back.isOpaque(x, y)) mask.put(x, y, 0xffffffff);
  cleanIsolated(fig, mask, (x, y) => {
    const v = fig.get(x, y);
    if (!tones.has(v) || lines.has(v)) return true;
    // 挨着脸、衣服的不动；挨着透明处（之后会描上发色的外轮廓）照常清理
    return [fig.get(x - 1, y), fig.get(x + 1, y), fig.get(x, y - 1), fig.get(x, y + 1)].some((n) => (n & 0xff) !== 0 && !tones.has(n));
  });
}

/**
 * 给后层上色：整体一大块暗面，左缘受光一窄条，一圈描边；发梢的尖在遮罩形状里（见 hairMasks）。
 * 长卷发的身后也逐卷上色。花白夹杂时每三道发丝一道灰（马尾、发辫这类发梢保持原发色）。
 */
export function paintHairBack(dst: Px, mask: Px, spec: PortraitSpec): void {
  const ramp = HAIR[spec.hairColor];
  const curls = spec.hair === "curls";
  const tone = new Uint8Array(W * W);
  const ends = spec.hair === "ponytail" || spec.hair === "tied" || spec.hair === "braid" || spec.hair === "braids" || spec.hair === "sidebraid";
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      if (!mask.isOpaque(x, y)) continue;
      let t = 1;
      if (curls) {
        // 身后的卷发：发卷左上受光一阶、下沿暗缝压到描边色
        const c = curlAt(x, y).t;
        t = c === 3 ? 2 : c === 1 ? 0 : 1;
      } else if (!mask.isOpaque(x - 2, y) || !mask.isOpaque(x - 3, y)) t = 2;
      if (!mask.isOpaque(x, y + 1) || !mask.isOpaque(x + 1, y) || !mask.isOpaque(x - 1, y)) t = 0;
      const gray = spec.grizzle === 2 && !ends && t > 0 && (curls ? ((curlAt(x, y).cell % 3) + 3) % 3 === 0 : Math.floor(x / 2) % 3 === 0);
      dst.set(x, y, gray ? HAIR.gray[t] : ramp[t]);
      tone[y * W + x] = t;
    }
  }
  cleanIsolated(dst, mask, (x, y) => tone[y * W + x] === 0);
}
/** 发辫的编结纹路：在辫子遮罩上每隔三行加一道暗缝与一点高光。 */
export function braidTexture(dst: Px, mask: Px, spec: PortraitSpec, x0: number, x1: number, y0: number, y1: number): void {
  const [, dark, , light] = HAIR[spec.hairColor];
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (!mask.isOpaque(x, y)) continue;
      const k = (y - y0 + Math.floor((x - x0) / 3)) % 3;
      if (k === 0) dst.set(x, y, dark);
      else if (k === 1 && !mask.isOpaque(x - 1, y)) dst.set(x, y, light);
    }
  }
}

/** 发辫所在的区域（用于编结纹路）：[x0, x1, y0, y1, 是否前层]。 */
export function braidBoxes(spec: PortraitSpec): readonly (readonly [number, number, number, number, boolean])[] {
  switch (spec.hair) {
    case "braid":
      return [[5, 18, 24, 60, false]];
    case "braids":
      return [
        [14, 23, 32, 63, true],
        [42, 53, 29, 58, false],
      ];
    case "sidebraid":
      return [[15, 28, 31, 63, true]];
    case "crownbraid":
      return [[14, 50, 3, 14, true]];
    default:
      return [];
  }
}

/** 发绳与发带：马尾根部、辫梢系一段点缀色的布带。 */
export function drawHairTies(p: Px, spec: PortraitSpec, h: HairMasks): void {
  const c = CLOTH[spec.accent === "cream" || spec.accent === "white" ? "red" : spec.accent];
  const hasHair = (x: number, y: number) => h.back.isOpaque(x, y) || h.front.isOpaque(x, y);
  const tie = (x0: number, y0: number, x1: number, y1: number) => {
    // 只画在头发上（被帽子裁掉的地方不画）
    const band = new Px(W, W).line(x0, y0, x1, y1, c[2]).line(x0, y0 + 1, x1, y1 + 1, c[0]);
    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) if (band.isOpaque(x, y) && hasHair(x, y)) p.set(x, y, band.get(x, y));
  };
  switch (spec.hair) {
    case "ponytail":
      tie(11, 14, 17, 11);
      break;
    case "tied":
      tie(10, 27, 16, 26);
      break;
    case "braids":
      tie(16, 57, 20, 57);
      tie(47, 52, 51, 52);
      break;
    case "sidebraid":
      tie(21, 58, 25, 58);
      break;
    case "braid":
      tie(7, 52, 11, 52);
      break;
    default:
      break;
  }
}
