// 头模：64×64 画布上的 3/4 侧脸（朝向右前方），动画赛璐璐画法。所有部件都在这套坐标里定位。
//
// 头模的关键坐标（绝对像素，见 HEAD）：
//   颅骨椭圆 x 17..46、y 8..38；下半张脸按脸型逐行手排（女性 FACE_ROWS、男性 MALE_ROWS），下巴底在 y 41（圆脸）..46（长脸）；
//   脸的中线（鼻梁、人中、下巴尖）在 x=35，比颅骨中心偏右——近侧脸颊宽、远侧脸颊窄，这就是 3/4 侧脸；
//   女性的下颌线从耳下收向小下巴；成年男性耳垂下先竖直落下 3 行下颌支，在下颌角转折，再以一条直线收到 4 像素的平下巴；
//   眉 y≈20..24（男性低一行）；眼 y 24..32（近侧眼 x 23..31，远侧眼 x 37..44）；鼻尖 y≈34；嘴按脸型在 y 37..40；
//   耳朵在近侧（左）x 14..19、y 27..35；颈纤细（男 x 29..37，女 x 30..36），颈根向两肩展开。
// 光源在左上。皮肤只用两阶赛璐璐光影：基色 + 一阶暗面（远侧脸颊一窄条、刘海与下巴投下的影），
// 高光只点在近侧颧骨；脸上没有任何抖动。轮廓线用同色系的深一阶（FACE_SKIN 的描边色），而不是统一的近黑。
import { P } from "../palette";
import { Px, rgba } from "../px";
import type { BeardStyle, FaceShape, PortraitSpec } from "./spec";
import { FACE_ROUGE, HAIR, METAL, faceRamp, skinIndex, type FaceRamp } from "./tones";

export type Span = readonly [number, number];

/** 画布尺寸。 */
export const PORTRAIT_SIZE = 64;
const S = PORTRAIT_SIZE;

/** 头模关键点。 */
export const HEAD = {
  top: 8,
  /** 颅骨椭圆 */
  cx: 31.5,
  cy: 23,
  rx: 14.5,
  ry: 15,
  browY: 22,
  /** 眼睛（上睫毛线所在的参考行） */
  eyeY: 27,
  /** 近侧眼左上角（眼白从这一列开始） */
  nearEyeX: 24,
  /** 远侧眼左上角 */
  farEyeX: 38,
  /** 脸的中线（鼻梁、人中、下巴中心） */
  midX: 35,
  /** 鼻尖所在行 */
  noseY: 34,
  earX: 14,
  earY: 27,
} as const;

const MID = HEAD.midX;

/**
 * 下半张脸的逐行轮廓（女性）：从 y=27 起每行 [近侧左缘, 远侧右缘]，最后一行是下巴底。
 * 逐行手排而不是多边形取样，五种脸型的差别落在确定的像素上（1× 下也分得出来）：
 * 鹅蛋居中（下巴 y45）；瓜子在颧骨（y29）最宽、往下收得最快、下巴尖（y46）；圆脸的两颊最宽、一条连续的圆弧收到短下巴（y41）；
 * 方脸两侧在 y35–37 竖直落下、再斜收到 4 像素的平下巴（y45）；长脸靠窄而不是靠长——两颊比鹅蛋窄、下巴在 y46。
 */
const FACE_ROWS: Readonly<Record<FaceShape, readonly Span[]>> = {
  oval: [
    [17, 45], [17, 45], [17, 45], [17, 45], [17, 45], [18, 45], [18, 44], [18, 44], // y27..34
    [19, 44], [19, 43], [20, 43], [21, 42], [22, 42], [23, 41], [26, 40], [28, 40], // y35..42
    [30, 39], [32, 38], [34, 36], // y43..45
  ],
  heart: [
    [17, 45], [17, 45], [17, 45], [18, 44], [18, 44], [19, 43], [19, 43], [20, 42], // y27..34
    [21, 42], [22, 41], [23, 41], [24, 40], [25, 40], [26, 39], [27, 39], [28, 38], // y35..42
    [30, 38], [31, 37], [33, 37], [34, 35], // y43..46
  ],
  round: [
    [17, 46], [17, 46], [17, 46], [17, 46], [17, 46], [17, 46], [16, 46], [16, 46], // y27..34
    [16, 46], [16, 46], [16, 45], [17, 45], [19, 44], [21, 42], [25, 38], // y35..41
  ],
  square: [
    [17, 45], [17, 45], [17, 45], [17, 45], [17, 45], [17, 45], [17, 45], [17, 44], // y27..34
    [17, 44], [17, 44], [17, 44], [18, 43], [20, 42], [22, 41], [24, 40], [26, 39], // y35..42
    [28, 38], [30, 37], [33, 36], // y43..45
  ],
  long: [
    [17, 45], [17, 44], [17, 44], [18, 44], [18, 44], [18, 43], [19, 43], [19, 42], // y27..34
    [20, 42], [20, 42], [21, 41], [21, 41], [22, 40], [23, 40], [24, 39], [25, 39], // y35..42
    [27, 38], [29, 38], [31, 37], [34, 36], // y43..46
  ],
};

/**
 * 男性的脸（逐行手排）：远侧颧骨收 1 像素（y 28..33 的右缘最多到 44）；近侧从耳垂下先竖直落下 3 行（下颌支，y35–37），
 * 在下颌角转折，再以一条笔直的斜线收到 4 像素的平下巴——有棱角的成年男性下颌，而不是一路斜台阶收成少年的尖下巴。
 * 五种脸型的差别：方脸下颌支最靠外、远侧也竖直落下；鹅蛋居中；圆脸两颊最宽、下巴最短；瓜子与长脸的下颌支靠内，长脸下巴最长。
 */
const MALE_ROWS: Readonly<Record<FaceShape, readonly Span[]>> = {
  oval: [
    [17, 45], [17, 44], [17, 44], [17, 44], [17, 44], [18, 44], [18, 44], [18, 44], // y27..34
    [18, 44], [18, 43], [18, 43], [20, 43], [22, 43], [24, 42], [26, 42], [28, 41], // y35..42
    [30, 40], [32, 39], [33, 36], // y43..45
  ],
  heart: [
    [17, 45], [17, 44], [17, 44], [18, 44], [18, 44], [19, 43], [19, 43], [20, 42], // y27..34
    [20, 42], [20, 41], [20, 41], [22, 40], [24, 40], [26, 39], [28, 39], [30, 38], // y35..42
    [31, 38], [32, 37], [33, 36], // y43..45
  ],
  round: [
    [17, 45], [17, 44], [17, 44], [17, 44], [17, 44], [17, 44], [16, 44], [16, 45], // y27..34
    [16, 46], [16, 46], [16, 45], [17, 45], [19, 44], [22, 42], [26, 39], // y35..41
  ],
  square: [
    [17, 45], [17, 44], [17, 44], [17, 44], [17, 44], [17, 44], [17, 44], [17, 44], // y27..34
    [17, 44], [17, 44], [17, 44], [18, 43], [20, 42], [22, 41], [24, 40], [26, 39], // y35..42
    [28, 38], [30, 37], [33, 36], // y43..45
  ],
  long: [
    [17, 45], [17, 44], [17, 44], [18, 44], [18, 44], [18, 43], [19, 43], [19, 42], // y27..34
    [19, 42], [19, 42], [19, 41], [21, 41], [23, 40], [24, 40], [26, 39], [27, 39], // y35..42
    [29, 37], [30, 37], [32, 36], [33, 36], // y43..46
  ],
};

/** 下颌轮廓从这一行开始逐行手排（以上是颅骨椭圆）。 */
const JAW_Y0 = 27;

/** 嘴所在行（唇缝）：嘴底到下巴描边至少隔 2 行；圆脸下巴短，嘴也高一些。男女相同。 */
const MOUTH_Y: Readonly<Record<FaceShape, number>> = { oval: 39, heart: 39, round: 37, square: 39, long: 40 };

/**
 * 各脸型的明暗：远侧脸颊暗面的宽度、腮红的位置。
 * 圆脸的腮红低、暗面窄；长脸与方脸的远侧暗面宽一点，读起来更立体。
 */
interface FaceTone {
  /** 远侧脸颊暗面在颧骨以下的宽度（像素，不含轮廓线） */
  farBand: number;
  /** 腮红左上角（近侧）与远侧腮红的起点 */
  blushAt: readonly [number, number];
  farBlush: readonly [number, number];
}

const FACE_TONES: Readonly<Record<FaceShape, FaceTone>> = {
  oval: { farBand: 1, blushAt: [24, 33], farBlush: [40, 33] },
  heart: { farBand: 1, blushAt: [24, 33], farBlush: [40, 33] },
  round: { farBand: 1, blushAt: [23, 33], farBlush: [40, 33] },
  square: { farBand: 2, blushAt: [24, 33], farBlush: [40, 33] },
  long: { farBand: 2, blushAt: [24, 34], farBlush: [40, 34] },
};

const headCache = new Map<string, Map<number, Span>>();

/** 头部每行的左右边界（y → span）：颅骨椭圆（y < 27）与逐行手排的下半张脸；male 为 true 时用男性的下颌。 */
export function headRows(face: FaceShape, male = false): Map<number, Span> {
  const key = `${face}-${male ? "m" : "f"}`;
  const hit = headCache.get(key);
  if (hit) return hit;
  const m = new Px(S, S);
  m.ellipse(HEAD.cx, HEAD.cy, HEAD.rx, HEAD.ry, "#fff");
  const rows = new Map<number, Span>();
  for (let y = 0; y < JAW_Y0; y++) {
    let l = -1;
    let r = -1;
    for (let x = 0; x < S; x++) {
      if (!m.isOpaque(x, y)) continue;
      if (l < 0) l = x;
      r = x;
    }
    if (l >= 0) rows.set(y, [l, r]);
  }
  const lower = male ? MALE_ROWS[face] : FACE_ROWS[face];
  lower.forEach((s, i) => rows.set(JAW_Y0 + i, s));
  headCache.set(key, rows);
  return rows;
}

/** 某点是否在头部轮廓内。 */
export function inHead(face: FaceShape, x: number, y: number, male = false): boolean {
  const s = headRows(face, male).get(y);
  return !!s && x >= s[0] && x <= s[1];
}

/** 下巴最低一行的 y。 */
export function chinY(face: FaceShape, male = false): number {
  return JAW_Y0 + (male ? MALE_ROWS[face] : FACE_ROWS[face]).length - 1;
}

/** 嘴所在行（唇线），男女相同。 */
export function mouthY(face: FaceShape): number {
  return MOUTH_Y[face];
}

/** 某一列头部的最低一行（下颌线）；该列不在头部时返回 -1。 */
export function jawBottom(face: FaceShape, x: number, male = false): number {
  let b = -1;
  for (const [y, [l, r]] of headRows(face, male)) if (x >= l && x <= r) b = Math.max(b, y);
  return b;
}

/**
 * 皮肤色调图：0 空，1 深影，2 暗面，3 基色，4 高光，5 腮红，6 轮廓线，7 腮红下沿，8 胡茬。
 */
export class ToneMap {
  readonly t = new Uint8Array(S * S);
  get(x: number, y: number): number {
    return x < 0 || y < 0 || x >= S || y >= S ? 0 : this.t[y * S + x];
  }
  set(x: number, y: number, v: number): void {
    if (x < 0 || y < 0 || x >= S || y >= S) return;
    this.t[y * S + x] = v;
  }
  /** 只改已有皮肤的像素。 */
  shade(x: number, y: number, v: number): void {
    if (this.get(x, y)) this.set(x, y, v);
  }
  /** 只改基色与高光像素（不压掉轮廓线、腮红与已有的影）。 */
  soft(x: number, y: number, v: number): void {
    const t = this.get(x, y);
    if (t === 3 || t === 4) this.set(x, y, v);
  }
  paint(p: Px, ramp: FaceRamp, rouge: readonly [string, string], stubble: string = ramp[2]): void {
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const v = this.t[y * S + x];
        if (!v) continue;
        p.set(x, y, v === 5 ? rouge[0] : v === 7 ? rouge[1] : v === 6 ? ramp[0] : v === 8 ? stubble : ramp[v]);
      }
    }
  }
}

/** 皮肤色调印章：字符 1–7 写入色调图（only：只改已有皮肤）。 */
export function toneStamp(tm: ToneMap, rows: readonly string[], x: number, y: number, only = false): void {
  rows.forEach((row, r) => {
    for (let i = 0; i < row.length; i++) {
      const c = row[i];
      if (c < "1" || c > "7") continue;
      if (only) tm.shade(x + i, y + r, Number(c));
      else tm.set(x + i, y + r, Number(c));
    }
  });
}

/** 颈的左右边界：纤细的颈，女性更细。 */
export function neckSpan(female: boolean): Span {
  return female ? [30, 36] : [29, 37];
}

/**
 * 颈（头模坐标，先于胸口与衣服画）：纤细的颈从下巴后面一直入画，下颌在颈上投下一道与下颌线平行的赛璐璐影，
 * 颈的远侧两列背光。颈根的展开与锁骨属于胸口（见 chestTones），合成时随衣服整层下移 BODY_DY。
 */
export function neckTones(tm: ToneMap, spec: PortraitSpec): void {
  const [x0, x1] = neckSpan(spec.female);
  const male = !spec.female;
  for (let y = 34; y <= 63; y++) {
    for (let x = x0; x <= x1; x++) tm.set(x, y, x >= x1 - 1 ? 2 : 3);
  }
  // 下颌投在颈上的影：每列从下颌线往下 3 行（远侧 4 行），下沿与下颌线平行
  for (let x = x0; x <= x1; x++) {
    const b = jawBottom(spec.face, x, male);
    if (b < 0) continue;
    const depth = x >= MID - 2 ? 4 : 3;
    for (let y = b + 1; y <= b + depth; y++) tm.set(x, y, 2);
  }
  // 男性：近侧一道胸锁乳突肌的淡影、颈侧一列暗面，颈显得结实
  if (male) {
    const b = jawBottom(spec.face, x0 + 1, male);
    for (let y = Math.max(b + 4, 45); y <= 48; y++) tm.set(x0 + 1 + Math.floor((y - 45) / 2), y, 2);
    for (let y = jawBottom(spec.face, x0, male) + 1; y <= 63; y++) tm.set(x0, y, 2);
  }
}

/**
 * 胸口（服饰坐标，合成时与衣服一起下移 BODY_DY，露出一段颈与肩线——胸像而不是大头贴）：
 * 颈根向两肩展开成斜方肌的弧；近侧锁骨是一道受光的细线（下面一行暗面），远侧锁骨落在暗面里；胸骨上窝一点影。
 */
export function chestTones(tm: ToneMap, spec: PortraitSpec): void {
  const [x0, x1] = neckSpan(spec.female);
  for (let y = 47; y <= 63; y++) {
    // 颈根展开：y 47..49 每行各外扩一点（斜方肌的起点），y≥50 为胸口（只在衣领挖空处露出来）
    const flare = y < 50 ? [1, 2, 4][y - 47] : 14;
    for (let x = x0 - flare; x <= x1 + flare; x++) {
      let v = 3;
      if (x >= x1 - 1 && x <= x1 + 1 && y < 51) v = 2;
      if (x > x1 + 1) v = x > x1 + 6 ? 2 : 3;
      tm.set(x, y, v);
    }
  }
  // 锁骨：从胸骨上窝向两肩微微上扬；近侧上沿一道受光，下面一行暗面
  const cx = Math.round((x0 + x1) / 2);
  const cl = spec.female ? 6 : 8;
  for (let i = 1; i <= cl; i++) {
    const x = cx - 1 - i;
    const y = 50 - Math.floor(i / 4);
    tm.set(x, y, 4);
    tm.set(x, y + 1, 2);
  }
  for (let i = 1; i <= cl - 2; i++) tm.set(cx + 1 + i, 50 - Math.floor(i / 4) + 1, 2);
  // 胸骨上窝
  tm.set(cx, 50, 2);
  tm.set(cx, 51, 2);
}

/** 头部皮肤：轮廓 + 赛璐璐阴影 + 耳朵 + 腮红。 */
export function headTones(tm: ToneMap, spec: PortraitSpec): void {
  const face = spec.face;
  const male = !spec.female;
  const cy = chinY(face, male);
  const ft = FACE_TONES[face];
  // 老年女性：近侧下颌在嘴角高度多 1 像素松弛的转折（只影响脸的轮廓，不影响别的部件的定位）
  const rows = new Map(headRows(face, male));
  if (spec.female && spec.age === 2) {
    const jy = mouthY(face) + 1;
    const s = rows.get(jy);
    const up = rows.get(jy - 1);
    if (s && up && s[0] > up[0]) rows.set(jy, [up[0], s[1]]);
  }
  const within = (x: number, y: number) => {
    const s = rows.get(y);
    return !!s && x >= s[0] && x <= s[1];
  };
  for (const [y, [l, r]] of rows) for (let x = l; x <= r; x++) tm.set(x, y, 3);

  // 远侧脸颊的暗面：颧骨以下沿轮廓一窄条，到下巴前收掉（光头时太阳穴一段也有）
  for (const [y, [, r]] of rows) {
    if (y < 29 || y > cy - 2) continue;
    const band = y < 33 ? 1 : y < cy - 4 ? ft.farBand : 1;
    for (let x = r - band; x < r; x++) tm.set(x, y, 2);
  }
  // 下巴底下一行的暗面（下颌的厚度）：女性只在远侧半边；男性横贯整个下巴，下颌更有分量
  for (let x = MID - (male ? 3 : 1); x <= MID + 6; x++) {
    const b = jawBottom(face, x, male);
    if (b > 0 && b >= cy - 3) tm.shade(x, b - 1, 2);
  }
  // 脸的轮廓线：头部边缘一圈（被头发、帽子盖住的部分看不见）
  for (const [y, [l, r]] of rows) {
    for (let x = l; x <= r; x++) {
      if (!within(x - 1, y) || !within(x + 1, y) || !within(x, y + 1) || !within(x, y - 1)) tm.set(x, y, 6);
    }
  }
  // 光头：头顶左上一块高光，后脑一道暗面
  if (spec.hair === "bald") {
    toneStamp(tm, ["..44..", ".4444.", "4444..", "44...."], 21, 10, true);
    for (let y = 13; y <= 25; y++) tm.soft(18 + (y < 16 ? 1 : 0), y, 2);
    for (let y = 11; y <= 28; y++) {
      const s = rows.get(y);
      if (s) tm.soft(s[1] - 1, y, 2);
    }
  }

  // 耳朵：近侧（左），简洁的 C 形耳廓，耳甲腔一块暗面；描边用皮肤的轮廓色
  const ex = HEAD.earX;
  const ey = HEAD.earY;
  toneStamp(tm, ["..666.", ".63346", "634436", "634236", "634236", "63423.", ".6333.", "..663."], ex, ey);
  // 耳前的一道影，把耳朵与脸颊分开
  tm.soft(ex + 5, ey + 1, 2);
  tm.soft(ex + 5, ey + 5, 2);

  blushTones(tm, spec, ft);
}

/**
 * 腮红（位置随脸型，与下睫毛之间隔一行肤色）：
 * 男性——留胡须、中年以上、带笑唇（微笑、开怀笑）的一律不画；年轻、不留胡子、不笑的只在近侧颧骨淡淡一横 2 像素。
 * 女性——两颊一抹；深肤色（古铜以下）是与基色同明度的单行（近侧 4、远侧 2 像素），不成块；
 * 老年女性只留近侧 1 格；主角（船长）只留近侧 2 格，不显稚气；有刀疤的一侧（近侧）不画。
 */
function blushTones(tm: ToneMap, spec: PortraitSpec, ft: FaceTone): void {
  const [bx, by] = ft.blushAt;
  const [fx, fy] = ft.farBlush;
  if (!spec.female) {
    const smiling = spec.mouth === "smile" || spec.mouth === "grin";
    if (spec.age === 0 && spec.beard === "none" && !smiling && !spec.scar) toneStamp(tm, ["55"], bx + 1, by + 1, true);
    return;
  }
  const near = !spec.scar;
  if (spec.age === 2) {
    if (near) toneStamp(tm, ["5"], bx + 2, by, true);
    return;
  }
  if (spec.role === "captain") {
    if (near) toneStamp(tm, ["55"], bx + 1, by + 1, true);
    return;
  }
  if (skinIndex(spec.skin) >= 2) {
    if (near) toneStamp(tm, ["5555"], bx, by + 1, true);
    toneStamp(tm, ["55"], fx, fy + 1, true);
    return;
  }
  if (near) toneStamp(tm, [".5555", "5555."], bx, by, true);
  toneStamp(tm, ["55", "5."], fx, fy, true);
}

/** 精灵耳：从近侧耳朵向左上方伸出的尖耳（画在头发之上，耳尖穿过发丝露出来）。 */
export function drawElfEar(p: Px, spec: PortraitSpec): void {
  const ramp = faceRamp(spec.skin);
  const ex = HEAD.earX;
  const ey = HEAD.earY;
  const rows = [
    "e.......",
    "ee......",
    ".e4e....",
    ".e34e...",
    "..e34e..",
    "..e334e.",
    "...e334e",
    "...e2334",
    "....e233",
    "....e233",
    "....ee23",
    ".....ee2",
  ];
  p.stamp(rows, { e: ramp[0], "2": ramp[2], "3": ramp[3], "4": ramp[4] }, ex - 5, ey - 5);
}

/**
 * 胡茬：只改皮肤色调（色调 8，胡茬色见 tones.ts stubbleTone），要在上色前调用。
 * 画成“五点钟的胡影”而不是一整块面膜：沿下颌描边以内 3 格的一条带（从耳垂高度起，上缘顺着颧骨下方的弧线、越靠近嘴角越低），
 * 加上上唇一行与嘴周、下巴一块——嘴周连成一片，不留肤色的孤岛；颧骨以下的脸颊露出基色，下颌的描边保留。
 */
export function stubbleTones(tm: ToneMap, spec: PortraitSpec): void {
  const male = !spec.female;
  const rows = headRows(spec.face, male);
  const my = mouthY(spec.face);
  const within = (x: number, y: number) => inHead(spec.face, x, y, male);
  // 上缘：近侧从耳垂高度（y35）顺着颧骨下方的弧线降到嘴角外（唇线），远侧从嘴角外缓缓升回 y36
  const top = (x: number) => {
    if (x < MID - 4) {
      const t = Math.max(0, (x - 19) / (MID - 4 - 19));
      return 35 + (my - 35) * t * t;
    }
    if (x <= MID + 4) return my - 1;
    const t = Math.min(1, (x - MID - 4) / 5);
    return my - 1 - (my - 1 - 36) * t;
  };
  for (const [y, [l, r]] of rows) {
    if (y < 34) continue;
    for (let x = Math.max(l, 18); x <= r; x++) {
      const nearJaw = !within(x, y + 3) || !within(x - 3, y) || !within(x + 2, y);
      const mouth = Math.abs(x - MID) <= 4 && y >= my - 1;
      if ((nearJaw || mouth) && y >= Math.round(top(x))) tm.soft(x, y, 8);
    }
  }
}

/**
 * 胡须（胡茬以外）：画在皮肤与五官之上，但在头发之下。
 * 花白：鬓角花白时络腮胡两侧与下巴尖先白，花白夹杂时整片换灰——描边换成灰的暗阶、暗缝与基色换成灰的基色、受光换成灰的亮阶，
 * 不是一一对应到灰色的暗阶（花白的长者不会变成黑胡子）。灰、白、银发的胡子外圈用发色暗阶收边（不用近黑的铁灰），
 * 里面的暗缝与须丝也提到基色——白胡子读作白胡子，不是一把深灰。
 */
export function drawBeard(p: Px, spec: PortraitSpec): void {
  const style: BeardStyle = spec.beard;
  if (style === "none" || style === "stubble") return;
  const layer = new Px(S, S);
  beardLayer(layer, spec, style);
  const from = HAIR[spec.hairColor];
  const pale = spec.hairColor === "gray" || spec.hairColor === "white" || spec.hairColor === "silver";
  const gray = HAIR.gray;
  // 原发色的下标 → 花白后的颜色：描边→灰暗阶，暗→灰基色，基→灰基色，亮→灰亮阶
  const toGray = [gray[1], gray[2], gray[2], gray[3], gray[4]];
  const cy = chinY(spec.face, !spec.female);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      if (!layer.isOpaque(x, y)) continue;
      const v = layer.get(x, y);
      const k = from.findIndex((c) => rgba(c) === v);
      if (k < 0) continue;
      const pick = spec.grizzle === 2 || (spec.grizzle === 1 && (y > cy - 1 || x < 22));
      if (pick) layer.set(x, y, toGray[k]);
      else if (pale && k === 0) layer.set(x, y, from[1]);
      else if (pale && k === 1) layer.set(x, y, from[2]);
    }
  }
  p.blit(layer, 0, 0);
}

/** 八字胡的胡尖怎么收：抿嘴、或严肃（压眉）的平嘴才下垂；微笑、开怀笑上翘；其余平收。 */
function mustacheTips(spec: PortraitSpec): -1 | 0 | 1 {
  if (spec.mouth === "frown" || (spec.mouth === "line" && spec.brows === "stern")) return 1;
  if (spec.mouth === "smile" || spec.mouth === "grin") return -1;
  return 0;
}

function beardLayer(p: Px, spec: PortraitSpec, style: BeardStyle): void {
  const male = true;
  const face = spec.face;
  const cy = chinY(face, male);
  const my = mouthY(face);
  const [edge, dark, base, light] = HAIR[spec.hairColor];
  const rows = headRows(face, male);
  const within = (x: number, y: number) => inHead(face, x, y, male);
  const mustache = () => {
    // 八字胡：上沿平直、两撇与中段齐平（笑时胡尖上翘 1 像素，只有抿嘴或严肃时下垂 1 像素）；
    // 胡子下面留一行皮肤，再是唇线——嘴露出来，不是一张撇嘴的苦脸。近侧上沿受光、下沿一行暗阶。
    const y1 = my - 2;
    const y0 = Math.max(my - 3, 35);
    const tips = mustacheTips(spec);
    const m = new Px(S, S);
    for (let y = y0; y <= y1; y++) m.hline(MID - 4, MID + 3, y, "#fff");
    m.set(MID - 5, y1 + tips, "#fff");
    m.set(MID + 4, y1 + tips, "#fff");
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        if (!m.isOpaque(x, y)) continue;
        let c = x > MID + 1 ? dark : base;
        if (y === y0 && x < MID && y0 < y1) c = light;
        if (y === y1 && y0 < y1) c = dark;
        if (x === MID - 5 || x === MID + 4) c = edge;
        p.set(x, y, c);
      }
    }
  };
  /**
   * 整块的胡子：主体用发色基色平涂（读作一整块浓密、但颜色就是本人发色的胡子），近侧上沿与左缘受光一窄条，
   * 下沿描边上面一行暗阶的暗缝，发色最深一阶只画最外一圈——花白的长者是灰白的胡子，红发的海盗是红胡子。
   */
  const solid = (m: Px) => {
    const out = (x: number, y: number) => !m.isOpaque(x, y) && !within(x, y);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        if (!m.isOpaque(x, y)) continue;
        let c = base;
        // 最外一圈（挨着头部以外的背景）才用描边色；挨着脸上皮肤的边（嘴周、上沿）不描黑框
        if (out(x, y + 1) || out(x + 1, y) || out(x - 1, y)) c = edge;
        else if (!m.isOpaque(x, y + 1) || !m.isOpaque(x, y + 2)) c = dark;
        else if (x < MID - 1 && (!m.isOpaque(x, y - 1) || !m.isOpaque(x - 1, y))) c = light;
        p.set(x, y, c);
      }
    }
  };
  if (style === "mustache") {
    mustache();
    return;
  }
  if (style === "goatee") {
    // 山羊胡：八字胡 + 下唇下一撮 + 下巴上修成尖的一块
    mustache();
    const m = new Px(S, S);
    m.set(MID, my + 2, "#fff");
    for (let y = my + 3; y <= cy + 2; y++) {
      const w = y >= cy + 1 ? 1 : 2;
      for (let x = MID - w; x <= MID + w - 1; x++) m.set(x, y, "#fff");
    }
    m.set(MID, cy + 3, "#fff");
    solid(m);
    return;
  }
  if (style === "trim") {
    // 修整短须：沿下颌 3 像素宽的一圈，从鬓角经下颌绕到下巴、下巴上一整块，上缘是一条利落的斜线；嘴周刮净（与络腮鬓分开）
    const m = new Px(S, S);
    const cheek = (x: number) => (x <= MID ? 30 + ((x - 16) * (my + 2 - 30)) / (MID - 16) : my + 2 - ((x - MID) * (my + 2 - 32)) / (47 - MID));
    for (let y = HEAD.earY + 1; y <= cy; y++) {
      const s = rows.get(y);
      if (!s) continue;
      for (let x = s[0]; x <= s[1]; x++) {
        if (y < cheek(x)) continue;
        const nearEdge = x - s[0] <= 2 || s[1] - x <= 1 || !within(x, y + 3);
        const chin = y >= my + 2 && Math.abs(x - MID) <= 4;
        if (nearEdge || chin) m.set(x, y, "#fff");
      }
    }
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        if (!m.isOpaque(x, y)) continue;
        let c = x >= 41 ? dark : base;
        if (!m.isOpaque(x, y - 1) && x < MID) c = light;
        if (!within(x, y + 1)) c = edge;
        p.set(x, y, c);
      }
    }
    mustache();
    return;
  }
  if (style === "chops") {
    // 络腮鬓：从耳前沿下颌到嘴角 3–4 像素宽的一条，到嘴角向上收成一个明确的钩，下巴刮净，再接上八字胡；
    // 贴着脸的内侧一列用发色亮阶的受光边，把胡子与脸的外轮廓分开（深肤色上不会和轮廓线连成一条粗线）
    const m = new Px(S, S);
    for (let y = HEAD.earY - 1; y <= cy - 1; y++) {
      const s = rows.get(y);
      if (!s) continue;
      const w = y < 33 ? 2 : 3;
      for (let x = s[0]; x <= Math.min(s[0] + w, MID - 4); x++) m.set(x, y, "#fff");
    }
    // 钩：嘴角外侧向上卷起两格，接到八字胡的胡尖下面
    for (const [x, y] of [
      [MID - 4, my + 1],
      [MID - 5, my + 1],
      [MID - 4, my],
      [MID - 5, my],
      [MID - 5, my - 1],
    ] as const)
      m.set(x, y, "#fff");
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        if (!m.isOpaque(x, y)) continue;
        let c = base;
        if ((!m.isOpaque(x - 1, y) && !within(x - 1, y)) || !m.isOpaque(x, y + 1)) c = edge;
        else if (!m.isOpaque(x + 1, y)) c = light;
        p.set(x, y, c);
      }
    }
    mustache();
    return;
  }
  // 络腮胡、长须：鬓角沿脸缘垂下，两颊下半、下颌与下巴整块盖住（嘴周留出来），读作一整块浓密的胡子；
  // 络腮胡在下巴以下多出三行、长须收成倒三角垂到胸前，下缘几簇须梢。
  const long = style === "long";
  const m = new Px(S, S);
  const top = (x: number) => {
    if (x <= 21) return HEAD.earY;
    if (x < MID - 3) return 33 + ((x - 21) * (my - 3 - 33)) / (MID - 3 - 21);
    if (x <= MID + 3) return my - 2;
    return my - 3 - ((x - MID - 3) * (my - 3 - 34)) / (46 - MID - 3);
  };
  for (let y = HEAD.earY; y <= cy; y++) {
    const s = rows.get(y);
    if (!s) continue;
    for (let x = s[0]; x <= s[1]; x++) {
      if (y < Math.round(top(x))) continue;
      // 鬓角只是贴着脸缘的一条（不盖住耳前的脸颊）
      if (y < 32 && x > s[0] + 2) continue;
      if (y >= my - 1 && y <= my + 1 && Math.abs(x - MID) <= 2) continue;
      m.set(x, y, "#fff");
    }
  }
  const hang = long ? 14 : 3;
  for (let d = 1; d <= hang; d++) {
    const y = cy + d;
    const half = long ? 7 - d * 0.45 : 6.5 - d * 1.6;
    for (let x = 20; x <= 50; x++) {
      if (Math.abs(x - (MID + 0.5)) > half) continue;
      // 最下面一行隔列留空：须梢一簇簇参差
      if (d === hang && x % 2 === 0) continue;
      m.set(x, y, "#fff");
    }
  }
  solid(m);
  // 须丝：两道顺着下巴往下的暗阶细线，分出一簇簇胡须
  for (const [x0, y0, x1, y1] of [
    [MID - 3, my + 3, MID - 2, cy + (long ? 8 : 1)],
    [MID + 3, my + 3, MID + 2, cy + (long ? 6 : 1)],
  ] as const) {
    const line = new Px(S, S).line(x0, y0, x1, y1, "#fff");
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        if (line.isOpaque(x, y) && m.isOpaque(x, y) && m.isOpaque(x + 1, y) && m.isOpaque(x - 1, y) && m.isOpaque(x, y + 2)) p.set(x, y, dark);
      }
    }
  }
  mustache();
  // 嘴留出来：唇缝一道深影，下唇一格暗面
  const ramp = faceRamp(spec.skin);
  p.hline(MID - 1, MID + 1, my, ramp[1]);
  p.set(MID, my + 1, ramp[2]);
}

/**
 * 伤疤：近侧从眉上斜贯到脸颊的一条连续的 1 像素斜线，被眼睛挡住的地方断开，但两端落在同一条斜线上；
 * 颜色是愈合的疤——白皙肤色用暗一阶的粉、小麦肤色用偏粉的浅色，深肤色用比皮肤亮一阶的受光色，不配深色的伴随线（不像正在流血的新伤）。
 */
export function drawScar(p: Px, spec: PortraitSpec): void {
  const i = skinIndex(spec.skin);
  // 白皙：比皮肤暗一阶的粉（赛璐璐暗面）；小麦：偏粉的浅色；古铜以下：比皮肤亮一阶的受光色
  const c = i === 0 ? faceRamp(spec.skin)[2] : i === 1 ? FACE_ROUGE[0][0] : faceRamp(spec.skin)[4];
  for (const [x, y] of scarPoints()) p.set(x, y, c);
}

/** 刀疤经过的像素：从眉上 (29, 18) 斜到颊 (23, 37) 的一条直线，眼睛所在的几行（y 24..32）断开。 */
export function scarPoints(): readonly (readonly [number, number])[] {
  const out: [number, number][] = [];
  for (let y = 18; y <= 37; y++) {
    if (y >= HEAD.eyeY - 3 && y <= HEAD.eyeY + 5) continue;
    out.push([29 - Math.floor(((y - 18) * 6) / 19), y]);
  }
  return out;
}

/** 眼罩：盖住远侧眼睛，系带斜过额头。 */
export function drawEyepatch(p: Px): void {
  const k = P.cloth.black;
  const x = HEAD.farEyeX;
  const y = HEAD.eyeY;
  p.line(17, 19, x, y - 3, k[0]);
  p.line(17, 20, x, y - 2, k[1]);
  p.rect(x - 1, y - 2, 8, 7, k[1]);
  p.hline(x, x + 5, y + 5, k[1]);
  p.hline(x - 1, x + 6, y - 2, k[0]);
  p.set(x, y - 1, k[2]);
  p.set(x + 1, y - 1, k[2]);
  p.hline(x - 1, x + 6, y + 4, k[0]);
  p.set(x + 6, y + 5, k[0]);
}

/** 眼镜：细圆框（1 像素），镜片上一点反光，眼睛仍然看得见。 */
export function drawGlasses(p: Px, gold: boolean): void {
  const m = gold ? METAL.gold : ([METAL.silver[1], METAL.silver[2], METAL.silver[3], P.white] as const);
  const y = HEAD.eyeY;
  const nx = HEAD.nearEyeX - 1;
  const fx = HEAD.farEyeX - 1;
  // 近侧镜框
  p.hline(nx, nx + 8, y - 3, m[1]);
  p.hline(nx, nx + 8, y + 6, m[0]);
  p.vline(nx - 1, y - 2, y + 5, m[1]);
  p.vline(nx + 9, y - 2, y + 5, m[0]);
  // 鼻梁
  p.hline(nx + 10, fx - 2, y - 1, m[1]);
  // 远侧镜框（透视变窄）
  p.hline(fx, fx + 6, y - 3, m[1]);
  p.hline(fx, fx + 6, y + 6, m[0]);
  p.vline(fx - 1, y - 2, y + 5, m[0]);
  p.vline(fx + 7, y - 2, y + 5, m[0]);
  // 镜腿
  p.line(nx - 2, y - 1, 19, y - 2, m[1]);
  // 反光
  p.set(nx + 1, y + 4, m[3]);
  p.set(nx + 2, y + 5, m[3]);
}

/** 耳环：近侧耳垂上的金环；desert 风格为大金环。 */
export function drawEarring(p: Px, big = false): void {
  const g = METAL.gold;
  const x = HEAD.earX + 2;
  const y = HEAD.earY + 8;
  if (big) {
    p.ring(x, y + 3, 2, 2.5, g[1]);
    p.set(x - 2, y + 2, g[2]);
    p.set(x - 1, y + 5, g[3]);
    return;
  }
  p.set(x, y, g[1]);
  p.set(x, y + 1, g[2]);
  p.set(x + 1, y + 2, g[1]);
  p.set(x - 1, y + 1, g[0]);
  p.set(x, y + 2, g[3]);
}

/** 烟斗：从远侧嘴角伸出，斗钵在脸外。 */
export function drawPipe(p: Px, spec: PortraitSpec): void {
  const my = mouthY(spec.face);
  const x = MID + 2;
  const w = P.wood;
  p.hline(x, x + 6, my + 1, w[1]);
  p.hline(x + 1, x + 5, my + 2, w[0]);
  p.set(x + 1, my + 1, w[2]);
  p.rect(x + 6, my - 2, 4, 5, w[2]);
  p.vline(x + 9, my - 2, my + 2, w[1]);
  p.hline(x + 6, x + 9, my + 3, w[0]);
  p.hline(x + 6, x + 9, my - 2, P.iron[1]);
  p.set(x + 6, my - 1, w[3]);
  // 一缕烟
  p.set(x + 7, my - 4, P.stone[3]);
  p.set(x + 8, my - 5, P.stone[4]);
  p.set(x + 7, my - 6, P.stone[3]);
  p.set(x + 8, my - 7, P.stone[3]);
}

/** 皮肤的腮红色（两阶）。 */
export function skinRouge(skin: number): readonly [string, string] {
  return FACE_ROUGE[skinIndex(skin)];
}
