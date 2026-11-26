// 五官：眼、眉、鼻、嘴与年龄痕迹（动画赛璐璐画法）。坐标系与头模相同（见 head.ts HEAD）。
//
// 眼睛是整张脸的重点：大而有神——清楚的上睫毛线（女性粗、外眼角上挑；男性中段 1 像素、只在外眼角两格加粗），
// 虹膜四阶，瞳孔永远是虹膜里最暗的两格；虹膜整个框在眼白里：两侧露出眼白，最底一行用中间色、收窄，
// 最亮的一阶只在倒数第二行、瞳孔旁留一格反光（与白高光相对），外眼角下方一段下睫毛给眼睛一个下边界——
// 不会有两行亮色直接贴在皮肤上、读成眼下一道黄光。眼白偏冷（只有高光是纯白），上沿压一道睫毛投影。
// 高光按眼型与身份区分：圆眼与少女 2×2 外加一点小闪光，凤眼（高光在瞳孔右上）、细长眼、海盗、主角 1×2，老人 1×1。
// 男性的虹膜比女性少一行，顶行是“深角 + 中间色”（读成圆的，不和睫毛连成一片），成年人睫毛上方一道暗面色的眼皮褶。
// 眉毛：男性 2 像素、带轻微眉峰，比女性低一行、靠近眼睛；女性细而有型、比发色浅一阶，眉头不低于眉尾（不皱眉）。
// 鼻子只点一两个像素的影；嘴小而清楚，嘴型的差别在嘴角（女性的抿嘴两角下压、歪嘴一角上扬并延长，中老年男性的微笑两角上扬）。
import { P, ink } from "../palette";
import { luma, rgba, type Px } from "../px";
import { HEAD, ToneMap, mouthY, toneStamp } from "./head";
import type { BrowStyle, EyeStyle, MouthStyle, NoseStyle, PortraitSpec } from "./spec";
import { EYE_PUPIL, HAIR, LIP_TONES, SCLERA, eyeIris, eyePupil, skinIndex, type FaceRamp } from "./tones";

const MID = HEAD.midX;

// ── 眼睛 ──

/** 近侧眼印章的左上角（x 22..32、y 24..32）。 */
const NEAR_EYE = [HEAD.nearEyeX - 2, HEAD.eyeY - 3] as const;
/** 远侧眼印章的左上角（x 36..45、y 24..32）。 */
const FAR_EYE = [HEAD.farEyeX - 2, HEAD.eyeY - 3] as const;

interface EyePair {
  near: readonly string[];
  far: readonly string[];
}

/**
 * 眼睛印章。K 上睫毛线，k 睫毛的淡端（皮肤描边色），c 双眼皮褶（皮肤深影，女性），C 眼皮褶（皮肤暗面，成年男性），
 * w 睫毛下的眼白投影，W 眼白，1/2/3/4 虹膜（最深 → 最亮），L 下眼睑（皮肤暗面），l 下睫毛（皮肤描边色）。
 * 瞳孔与高光不写在印章里，由 drawEyes 按虹膜的位置与眼型、身份统一放置；小闪光落在倒数第二行、瞳孔正下方。
 * 近侧眼第 0 列在 x=22，远侧眼第 0 列在 x=36；第 0 行在 y=24。近侧眼的外眼角在左、远侧眼的外眼角在右。
 * 女性的虹膜比男性多一行。虹膜的最底一行（3 格中间色）两侧不再有眼白，外眼角一侧由两格下睫毛 l 收住。
 */
const EYES: Readonly<Record<EyeStyle, { f: EyePair; m: EyePair }>> = {
  // 杏眼：标准的美型眼；女性上睫毛线平稳、外眼角一根睫毛向外上方翘起；男性睫毛线 1 像素、外眼角两格加粗
  almond: {
    f: {
      near: ["...........", "K...cccc...", ".KKKKKKKK..", "..K11111Kk.", "..w22222w..", "..W22222W..", "..W33334W..", "..ll333....", "..........."],
      far: ["..........", "...cccc..K", "..KKKKKKK.", ".kK1111K..", "..w2222w..", "..W2222W..", "..W3334W..", "...333ll..", ".........."],
    },
    m: {
      near: ["...........", "...CCCCC...", ".KKKKKKKKk.", ".KKw1331w..", "..WW2222W..", "..WW2224W..", "..ll333....", "...........", "..........."],
      far: ["..........", "...CCCC...", "..KKKKKKK.", ".kw1331KK.", "..W2222W..", "..W2224W..", "...333ll..", "..........", ".........."],
    },
  },
  // 圆眼：眼裂大而圆，上睫毛线拱成弧，虹膜最高
  round: {
    f: {
      near: ["K..cccc....", ".KKKKKKK...", "..K11111K..", "..w22222wk.", "..W22222W..", "..W22222W..", "..W33334W..", "..ll333....", "..........."],
      far: ["...ccc...K", "..KKKKKKK.", ".kK1111K..", "..w2222w..", "..W2222W..", "..W2222W..", "..W3334W..", "...333ll..", ".........."],
    },
    m: {
      near: ["...........", "...CCCCC...", "..KKKKKKKk.", ".KKw1331w..", "..WW2222W..", "..WW2222W..", "..WW3334W..", "..ll333....", "..........."],
      far: ["..........", "...CCCC...", "..KKKKKKK.", ".kw1331KK.", "..W2222W..", "..W2222W..", "..W3334W..", "...333ll..", ".........."],
    },
  },
  // 细长眼：长而平的上睫毛线压低，眼裂窄、眼尾拉长——清冷
  narrow: {
    f: {
      near: ["...........", "...........", "K..cccccc..", "KKKKKKKKKk.", ".Kw11111w..", "..W22222W..", "..W33334W..", "..ll333....", "..........."],
      far: ["..........", "..........", "..ccccc..K", ".kKKKKKKKK", "..w1111w..", "..W2222W..", "..W3334W..", "...333ll..", ".........."],
    },
    m: {
      near: ["...........", "...........", "...CCCCC...", ".KKKKKKKKk.", ".KKw1331w..", "..WW2224W..", "..ll333....", "...........", "..........."],
      far: ["..........", "..........", "...CCCC...", ".kKKKKKKK.", "..w1331KK.", "..W2224W..", "...333ll..", "..........", ".........."],
    },
  },
  // 下垂眼：外眼角的睫毛顺着往下垂——温柔
  droopy: {
    f: {
      near: ["...........", "....cccc...", "..KKKKKKK..", ".KK11111Kk.", "K.w22222w..", "..W22222W..", "..W33334W..", "..ll333....", "..........."],
      far: ["..........", "...ccc....", "..KKKKKK..", ".kK1111KK.", "..w2222w.K", "..W2222W..", "..W3334W..", "...333ll..", ".........."],
    },
    m: {
      near: ["...........", "...CCCCC...", "...KKKKKKk.", ".KKw1331w..", "K.WW2222W..", "..WW2224W..", "..ll333....", "...........", "..........."],
      far: ["..........", "...CCCC...", "..KKKKK...", ".kw1331KK.", "..W2222W.K", "..W2224W..", "...333ll..", "..........", ".........."],
    },
  },
  // 上挑眼（凤眼）：女性外眼角高高挑起；男性睫毛线处处 1 像素、眼尾平收，锐利而不像画了眼线。高光在瞳孔右上、反光在左下
  sharp: {
    f: {
      near: ["K..........", ".KK.ccc....", "..KKKKKKK..", "...K11111Kk", "...w22222w.", "...W22222W.", "...W43333W.", "...ll333...", "..........."],
      far: [".........K", "....ccKK..", "..KKKKKK..", ".kK1111K..", "..w2222w..", "..W2222W..", "..W4333W..", "...333ll..", ".........."],
    },
    m: {
      near: ["...........", "...CCCC....", "..KKKKKKKk.", ".KWw1331w..", "..WW2222W..", "...W4333W..", "..ll333....", "...........", "..........."],
      far: ["..........", "...CCCC...", ".kKKKKKK..", "..w1331WK.", "..W2222W..", "..W4333W..", "...333ll..", "..........", ".........."],
    },
  },
  // 慵懒眼：平直的厚眼睑、眼睑褶贴着睫毛线——慵懒、成熟（只有这一种眼型是半垂的眼皮）；虹膜仍露出四行以上
  sleepy: {
    f: {
      near: ["...........", "..cccccc...", "KKKKKKKKKk.", ".Kw11111w..", "..W22222W..", "..W22222W..", "..W33334W..", "..ll333....", "..........."],
      far: ["..........", "..cccccc..", ".kKKKKKKKK", "..w1111w..", "..W2222W..", "..W2222W..", "..W3334W..", "...333ll..", ".........."],
    },
    m: {
      near: ["...........", "...........", "..CCCCCC...", ".KKKKKKKKk.", ".Kww1111w..", "..WW2222W..", "..WW3334W..", "..ll333....", "..........."],
      far: ["..........", "..........", "..CCCCC...", ".kKKKKKK..", "..w1111wK.", "..W2222W..", "..W3334W..", "...333ll..", ".........."],
    },
  },
  // 单眼皮 / 内双：没有双眼皮褶（女性只在眼尾有一小段内双），上睫毛线平直
  mono: {
    f: {
      near: ["...........", "...........", "c..........", "KKKKKKKKKk.", ".KK11111w..", "..w22222W..", "..W22222W..", "..W33334W..", "..ll333...."],
      far: ["..........", "..........", ".........c", ".kKKKKKKKK", "..K1111w..", "..w2222W..", "..W2222W..", "..W3334W..", "...333ll.."],
    },
    m: {
      near: ["...........", "...........", "...........", ".KKKKKKKKk.", "..Kw1331w..", "..WW2222W..", "...W3334W..", "..ll333....", "..........."],
      far: ["..........", "..........", "..........", ".kKKKKKK..", "..w1331K..", "..W2222W..", "..W3334W..", "...333ll..", ".........."],
    },
  },
};

/** 某种眼型的印章（男女各一套）。 */
export function eyeStamp(style: EyeStyle, female: boolean): EyePair {
  return EYES[style][female ? "f" : "m"];
}

/** 深肤色（棕褐、深褐）上的虹膜最深一阶：比皮肤暗面更暗的同色系近黑，眼形不会融进皮肤。下标与 EYE_IRIS 相同。 */
const DEEP_IRIS: readonly string[] = [P.hair.dark[0], ink.brown, ink.blue, ink.blue, ink.blue, ink.brown, ink.deep, ink.blue];

/**
 * 睫毛色：浅发色的人用发色最深一阶（不是纯黑），其余一律近黑；浅肤色的老人用皮肤描边色，柔和一些；
 * 深肤色一律近黑，免得眼形融进皮肤。
 */
function lashColor(spec: PortraitSpec, ramp: FaceRamp): string {
  if (skinIndex(spec.skin) >= 3) return P.hair.black[0];
  const lightHair = spec.hairColor === "blond" || spec.hairColor === "white" || spec.hairColor === "silver";
  if (spec.age === 2) return ramp[0];
  return lightHair ? HAIR[spec.hairColor][0] : P.hair.black[0];
}

/** 高光的大小：老人 1×1；凤眼、细长眼、海盗、主角 1×2；圆眼与少女 2×2（外加一点小闪光）；其余 1×2。 */
type Glint = "1x1" | "1x2" | "2x2";
export function glintOf(spec: PortraitSpec): Glint {
  if (spec.age === 2) return "1x1";
  if (spec.eyes === "sharp" || spec.eyes === "narrow" || spec.role === "pirate" || spec.role === "captain") return "1x2";
  if (spec.eyes === "round" || (spec.female && spec.age === 0)) return "2x2";
  return "1x2";
}

const IRIS_CH = "1234";

/**
 * 画两只眼睛；patchFar 为 true 时远侧眼被眼罩盖住。
 * 年长者上眼睑更沉：睫毛线下移一行（盖住虹膜最上一行），原来的睫毛线变成一道眼睑褶、原来的双眼皮褶去掉；
 * 老年女性的虹膜再少一行（最底一行变回皮肤），不留少女的大眼睛。
 * 瞳孔（两格）放在虹膜中线偏右（人物朝右前方看）、虹膜顶下一行起；高光贴着虹膜的上沿（凤眼在瞳孔右上，其余在左上）。
 * 古铜以下的肤色：虹膜最底一行的明度不超过皮肤基色的 1.1 倍（太亮就换成暗一阶），不会在眼下读成一道亮带。
 */
export function drawEyes(p: Px, spec: PortraitSpec, ramp: FaceRamp, patchFar: boolean): void {
  const pair = eyeStamp(spec.eyes, spec.female);
  const old = spec.age === 2;
  const si = skinIndex(spec.skin);
  const dark = si >= 3;
  const lash = lashColor(spec, ramp);
  const iris = eyeIris(spec.eyeColor);
  const ci = ((Math.trunc(spec.eyeColor) % EYE_PUPIL.length) + EYE_PUPIL.length) % EYE_PUPIL.length;
  const deepest = dark ? DEEP_IRIS[ci] : iris[0];
  const pupil = dark ? P.hair.black[0] : eyePupil(spec.eyeColor);
  // 底行：取不比皮肤基色亮 10% 以上的最亮一阶；连最深的一阶都太亮（深褐肤色配琥珀眼）时，用最深一阶并收窄到 2 格
  const limit = luma(rgba(ramp[3])) * 1.1;
  const fit = si >= 2 ? [iris[2], iris[1], iris[0]].find((c) => luma(rgba(c)) <= limit) : iris[2];
  const bottom = fit ?? iris[0];
  const narrowBottom = fit === undefined;
  const key: Record<string, string | null> = {
    K: lash,
    k: ramp[0],
    c: ramp[1],
    C: ramp[2],
    W: SCLERA[1],
    w: SCLERA[0],
    // 男性（浅肤色）的虹膜上沿不压到最深：睫毛线下面再压一行近黑，眼睛会显得眯着、没精神
    "1": spec.female || dark ? deepest : iris[1],
    "2": iris[1],
    "3": iris[2],
    "4": iris[3],
    L: ramp[2],
    l: ramp[0],
  };
  const glint = glintOf(spec);
  const eye = (rows: readonly string[], ox: number, oy: number, far: boolean) => {
    const top = rows.findIndex((row) => [...row].some((ch) => IRIS_CH.includes(ch)));
    let last = -1;
    rows.forEach((row, r) => {
      if ([...row].some((ch) => IRIS_CH.includes(ch))) last = r;
    });
    const grid = rows.map((row, r) =>
      [...row].map((ch, i) => {
        if (!old || top < 0) return ch;
        if (ch === "K" && r === top - 1 && "1234wWK".includes(rows[r + 1]?.[i] ?? ".")) return "c";
        if (r === top && "1234wW".includes(ch)) return "K";
        if ((ch === "c" || ch === "C") && r < top - 1) return ".";
        if (spec.female && r === last && IRIS_CH.includes(ch)) return ".";
        return ch;
      }),
    );
    const isIris = (i: number, r: number) => IRIS_CH.includes(grid[r]?.[i] ?? ".");
    // 虹膜的范围：最上、最下一行与左右两列
    let r0 = -1;
    let r1 = -1;
    let c0 = 99;
    let c1 = -1;
    grid.forEach((row, r) =>
      row.forEach((_, i) => {
        if (!isIris(i, r)) return;
        if (r0 < 0) r0 = r;
        r1 = r;
        c0 = Math.min(c0, i);
        c1 = Math.max(c1, i);
      }),
    );
    // 收窄底行：去掉外眼角一侧（近侧眼的左端、远侧眼的右端）的一格
    if (narrowBottom && r1 >= 0) {
      const row = grid[r1];
      const idx = far ? row.lastIndexOf("3") : row.indexOf("3");
      if (idx >= 0) row[idx] = ".";
    }
    grid.forEach((row, r) =>
      row.forEach((ch, i) => {
        let c = key[ch];
        if (ch === "3" && r === r1) c = bottom;
        if (c) p.set(ox + i, oy + r, c);
      }),
    );
    if (r0 < 0) return;
    const w = c1 - c0 + 1;
    const pc = c0 + (w >= 5 ? 3 : 2);
    // 瞳孔：虹膜里最暗的两格（虹膜顶下一行起，竖着两格；下面没有虹膜时往上挪）
    const pr = isIris(pc, r0 + 2) ? r0 + 1 : r0;
    for (const r of [pr, pr + 1]) if (isIris(pc, r)) p.set(ox + pc, oy + r, pupil);
    // 高光：落在虹膜的上半部；凤眼在瞳孔右上，其余在左上；远侧眼小一号
    const size: Glint = far && glint === "2x2" ? "1x2" : glint;
    const gx = spec.eyes === "sharp" ? pc + 1 : pc - 1;
    const cells: (readonly [number, number])[] =
      size === "2x2"
        ? [
            [pc - 2, r0],
            [pc - 1, r0],
            [pc - 2, r0 + 1],
            [pc - 1, r0 + 1],
          ]
        : size === "1x2"
          ? [
              [gx, r0],
              [gx, r0 + 1],
            ]
          : [[gx, r0]];
    for (const [i, r] of cells) if (isIris(i, r)) p.set(ox + i, oy + r, P.white);
    // 圆眼与少女：倒数第二行、瞳孔正下方一点小闪光，眼睛水亮
    const sr = r1 - 1;
    if (glint === "2x2" && sr > pr + 1 && isIris(pc, sr)) p.set(ox + pc, oy + sr, P.white);
  };
  eye(pair.near, NEAR_EYE[0], NEAR_EYE[1], false);
  if (!patchFar) eye(pair.far, FAR_EYE[0], FAR_EYE[1], true);
}

// ── 眉毛 ──

interface BrowPair {
  near: readonly string[];
  far: readonly string[];
}

/**
 * 眉毛印章：B 眉身，b 只有男性才画的加粗部分（男性的眉毛 2 像素、带轻微的眉峰），T 眉尾（浅一阶）。
 * 近侧眉第 0 列在 x=21，远侧眉第 0 列在 x=36；女性第 0 行在 y=20，男性在 y=21（压低一行、靠近眼睛，眉骨更有深度）。
 * 眉头在近侧眉的右端、远侧眉的左端。每一段横向至少 2 像素、段与段斜着相接：不论男女、近侧远侧，都没有断开的单像素。
 * female 为女性专用的画法（缺省与男性共用同一个印章、只读 B 与 T）。
 */
const BROWS: Readonly<Record<BrowStyle, BrowPair & { female?: BrowPair }>> = {
  // 细眉：一道细弧，眉峰在外三分之一处；女性的眉头与眉尾同高、眉头一段水平，台阶只往眉尾方向下降
  thin: {
    near: ["...........", "....BBBB...", "..TTbbbbBB.", "..........."],
    far: ["..........", "..BBBTT...", "BBbbb.....", ".........."],
    female: {
      near: ["...........", "...BBB.....", ".TT...BBBB.", "..........."],
      far: ["..........", "....BBB...", "BBBB...TT.", ".........."],
    },
  },
  // 挑眉（柳叶弯眉）：眉峰高挑，眉尾细长；女性的眉头比眉尾高一行
  arched: {
    near: [".....BBB...", "...TBbbbBB.", ".TT......BB", "..........."],
    far: ["..BB......", "BBbbBT....", "......TT..", ".........."],
    female: {
      near: ["...BBB.....", ".TT...BBBB.", "TT.........", "..........."],
      far: ["....BBB...", "BBBB...TT.", "........TT", ".........."],
    },
  },
  // 浓眉：眉头方而有力、眉尾收细；男性两行、眉峰处略高
  thick: {
    near: [".....bb....", "..TBBBBBBB.", "...bbbbBBB.", "..........."],
    far: ["...bb.....", "BBBBBBT...", "BBbbbb....", ".........."],
  },
  // 压眉：眉尾平、眉头一段略略压低，显得沉稳
  stern: {
    near: ["...........", "..TBBBBB...", "...bbbbBBB.", ".......bbb."],
    far: ["..........", "...BBBBT..", "BBBBbbb...", "bbb......."],
  },
  // 粗乱眉：宽而蓬，边缘参差（年长男性），整块而不是零散的点
  bushy: {
    near: ["....BB.BB..", "..TBBBBBBB.", ".TTBBBBBBBB", "...bbbbbb.."],
    far: ["..BB.BB...", "BBBBBBBT..", "BBBBBBBTT.", ".bbbbb...."],
  },
  // 平眉：几乎水平的一字眉，眉头略粗
  straight: {
    near: ["...........", "...........", "..TBBBBBBB.", "...bbbbbbb."],
    far: ["..........", "..........", "BBBBBBT...", "bbbbb....."],
  },
  // 剑眉：男性眉头平直有力，向外斜斜上扬、眉尾收成锋；女性是一道平直的长眉、眉头略粗，眉尾轻轻落下一格——英气而不皱眉
  sword: {
    near: ["...........", ".TB........", "...BBBBbbb.", "......BBBB."],
    far: ["..........", ".......BT.", "..bbbBBB..", ".BBBB....."],
    female: {
      near: ["...........", "...BBBBBBB.", ".TT......B.", "..........."],
      far: ["..........", "BBBBBB....", "B.....TT..", ".........."],
    },
  },
};

/**
 * 画眉：男性用发色暗阶；女性比发色浅一阶（柔和）。金发的男女都用暗阶，免得眉毛看不见。
 * 灰、白、银发与花白夹杂的男性：眉身用灰（或本发色）的基色、下沿一行用暗阶——花白的长者眉毛也是花白的，不是炭黑。
 */
export function drawBrows(p: Px, spec: PortraitSpec): void {
  const b = browStamp(spec.brows, spec.female);
  const h = HAIR[spec.hairColor];
  const pale = spec.hairColor === "white" || spec.hairColor === "gray" || spec.hairColor === "silver";
  const blond = spec.hairColor === "blond";
  const y0 = spec.female ? 20 : 21;
  const grayMale = !spec.female && (pale || spec.grizzle === 2);
  const g = pale ? h : HAIR.gray;
  const on = (rows: readonly string[], x: number, y: number) => {
    const c = rows[y]?.[x];
    return c === "B" || c === "T" || (!spec.female && c === "b");
  };
  const paint = (rows: readonly string[], ox: number) => {
    rows.forEach((row, y) =>
      [...row].forEach((_, x) => {
        if (!on(rows, x, y)) return;
        const tail = row[x] === "T";
        let c: string;
        if (spec.female) c = pale || blond ? h[tail ? 2 : 1] : h[tail ? 3 : 2];
        else if (grayMale) c = on(rows, x, y + 1) ? g[2] : g[1];
        else c = h[tail ? 2 : 1];
        p.set(ox + x, y0 + y, c);
      }),
    );
  };
  paint(b.near, 21);
  paint(b.far, 36);
}

/** 眉毛印章（测试用：检查每种眉形没有孤立的像素）；female 为 true 时取女性专用的画法（没有时与男性共用）。 */
export function browStamp(style: BrowStyle, female = false): BrowPair {
  const b = BROWS[style];
  return female && b.female ? b.female : { near: b.near, far: b.far };
}

// ── 鼻子 ──

/**
 * 鼻子色调印章（左上角 x=34、y=30）：4 鼻尖的一点高光，2 鼻子的侧影（赛璐璐暗面），1 鼻孔。
 * 动画式的鼻子只点出鼻尖右下的一两个像素；鼻型的差别在鼻梁的侧影与鼻底的宽窄。
 */
const NOSES: Readonly<Record<NoseStyle, readonly string[]>> = {
  // 小巧：鼻尖一个像素的影，旁边一点高光
  small: ["....", "....", "....", ".4..", "..2.", "...."],
  // 挺直：鼻梁一道细细的侧影一路到鼻尖
  straight: ["..2.", "..2.", "..2.", ".4..", "..22", "...."],
  // 鹰钩：鼻梁中段隆起，鼻尖下勾
  hooked: ["..2.", "...2", "...2", ".4.2", "..21", "...."],
  // 宽鼻：鼻翼宽、鼻底一道影
  broad: ["....", "....", "..2.", ".4..", ".212", "...."],
  // 小翘鼻：鼻尖圆而上翘，鼻底一小点深影
  button: ["....", "....", "....", ".44.", "..1.", "...."],
};

export function noseTones(tm: ToneMap, spec: PortraitSpec): void {
  toneStamp(tm, NOSES[spec.nose], MID - 1, 30, true);
}

// ── 嘴 ──

/**
 * 嘴印章（左上角 x=32、第 0 行在唇线上一行）。
 * 女：D 唇线（上唇色），Z 唇缝（最深），u 上唇，l 下唇，h 下唇的一格高光（柔粉），d 皮肤深影，s 皮肤暗面。
 *     中性是唇缝色的一道短线（不加粉色高光）；微笑两角上扬；歪嘴一角上扬并延长一格、另一角平；抿嘴两角各下压一格；
 *     开怀笑两角上扬并露出整条下唇；丰唇多一格上唇。
 * 男：D 嘴线（皮肤描边色），d 嘴角（皮肤深影），l 下唇，h 下唇的受光，s 下唇下的影。没有粉色的下唇格。
 */
const MOUTHS: Readonly<Record<MouthStyle, { f: readonly string[]; m: readonly string[] }>> = {
  // 中性：闭合、平静
  line: {
    f: [".......", "..DZD..", "...l...", "......."],
    m: [".......", "..DDD..", "...s...", "......."],
  },
  // 微笑：女性嘴角上扬成一道浅浅的弧；青年男性是 4 像素的平直嘴线、只抬近侧一个嘴角（中老年见 MATURE_SMILE）
  smile: {
    f: [".D...D.", "..DDD..", "...h...", "......."],
    m: [".D.....", "..DDDD.", "...s...", "......."],
  },
  // 歪嘴笑：近侧平、远侧嘴角挑起并延长一格
  smirk: {
    f: [".....DD", "..DDD..", "...h...", "......."],
    m: [".....d.", ".dDDD..", "...s...", "......."],
  },
  // 抿嘴：女性唇线两角各下压一格、不加高光；男性唇线平、两角压一点深影
  frown: {
    f: [".......", "..DDD..", ".D...D.", "......."],
    m: [".......", ".DDDD..", "d....d.", "..ss..."],
  },
  // 开怀笑：带唇形的微笑张口——女性两角上扬、下唇整条露出来；男性宽嘴线两角上扬、下唇一格暗面（都不露一排牙）
  grin: {
    f: [".D...D.", "..DDD..", "..lhl..", "......."],
    m: ["D.....D", ".DDDDD.", "...s...", "......."],
  },
  // 丰唇：上唇多一格，下唇一格高光
  lips: {
    f: ["...u...", "..DDD..", "...h...", "......."],
    m: [".......", ".dDDDd.", "...l...", "..sss.."],
  },
};

/** 中年以上男性的微笑：4 像素唇线、两端各上扬 1 像素——含蓄的笑，不是少年式的弯嘴，也不是一条板着的直线。 */
const MATURE_SMILE: readonly string[] = [".D....D", "..DDDD.", "...s...", "......."];

/**
 * 老年女性的嘴：3 像素唇线、嘴角上扬 1 像素，不加下唇高光（慈祥，不是少女的粉唇）。
 * 中性只抬近侧一角、微笑两角上扬、开怀笑再露出一格下唇（不是高光）、丰唇两角上扬并多一格上唇；抿嘴、歪嘴保留自己的嘴角。
 */
const OLD_F: Readonly<Record<MouthStyle, readonly string[]>> = {
  line: [".D.....", "..DDD..", ".......", "......."],
  smile: [".D...D.", "..DDD..", ".......", "......."],
  grin: [".D...D.", "..DDD..", "...l...", "......."],
  lips: [".D.u.D.", "..DDD..", ".......", "......."],
  smirk: [".....DD", "..DDD..", ".......", "......."],
  frown: [".......", "..DDD..", ".D...D.", "......."],
};

/** 实际画出的嘴型印章（测试与预览用）。 */
export function mouthStamp(spec: PortraitSpec): readonly string[] {
  if (spec.female) {
    // 主角（船长）的开怀笑改成闭口微笑，不显稚气
    const m: MouthStyle = spec.role === "captain" && spec.mouth === "grin" ? "smile" : spec.mouth;
    return spec.age === 2 ? OLD_F[m] : MOUTHS[m].f;
  }
  return spec.mouth === "smile" && spec.age >= 1 ? MATURE_SMILE : MOUTHS[spec.mouth].m;
}

export function drawMouth(p: Px, spec: PortraitSpec, ramp: FaceRamp): void {
  const rows = mouthStamp(spec);
  const i = skinIndex(spec.skin);
  const lip = LIP_TONES[i];
  const y = mouthY(spec.face) - 1;
  const key: Record<string, string> = spec.female
    ? { D: lip[1], Z: lip[0], u: lip[2], l: lip[2], h: lip[3], d: ramp[1], s: ramp[2] }
    : // 男性的唇色更淡：年轻人的丰唇带一点血色，其余只用皮肤的明暗
      { D: ramp[0], d: ramp[1], l: spec.age === 0 ? lip[3] : ramp[2], h: spec.age === 0 ? lip[3] : ramp[2], s: ramp[2] };
  p.stamp(rows, key, MID - 3, y);
}

// ── 年龄 ──

/**
 * 年龄痕迹（改皮肤色调，上色前调用）：
 * 中年——只有近侧外眼角一条短短的眼尾细纹（深影）；
 * 老年女性——外眼角一笔 2 像素的斜向笑纹、鼻翼连到嘴角的 3 像素法令纹（都用深影，白皙肤色上也看得见）、下眼睑下一道卧蚕（暗面）；
 * 老年男性——法令纹、嘴角下的木偶纹、两道鱼尾纹、额头的抬头纹（被刘海盖住时看不到），用深影，威严；不点零散的点。
 * 带笑的中老年男性在外眼角再添一格笑纹（鱼尾纹向下弯），读得出和蔼。
 * 线条都连成一笔，而不是零散的点。眼皮的沉（睫毛线下移、原线变成眼皮褶）见 drawEyes。
 */
export function ageTones(tm: ToneMap, spec: PortraitSpec): void {
  if (spec.age === 0) return;
  const male = !spec.female;
  const my = mouthY(spec.face);
  const ex = HEAD.nearEyeX;
  const ey = HEAD.eyeY;
  const DEEP = 1;
  const SHADE = 2;
  const smiling = male && (spec.mouth === "smile" || spec.mouth === "grin");
  if (spec.age === 1) {
    // 眼尾细纹：近侧外眼角外下方一道两像素的短斜线
    tm.soft(ex - 3, ey + 2, DEEP);
    tm.soft(ex - 4, ey + 3, DEEP);
    if (smiling) tm.soft(ex - 3, ey + 4, DEEP);
    return;
  }
  if (spec.female) {
    // 笑纹：外眼角向外下方一笔 2 像素的斜线
    tm.soft(ex - 3, ey + 2, DEEP);
    tm.soft(ex - 4, ey + 3, DEEP);
    // 法令纹：鼻翼外下方连到嘴角外的 3 像素
    tm.soft(MID - 4, my - 3, DEEP);
    tm.soft(MID - 5, my - 2, DEEP);
    tm.soft(MID - 5, my - 1, DEEP);
    // 近侧下眼睑下一道浅浅的弧（卧蚕，暗面色）：眼睛像在微笑
    for (let x = ex + 1; x <= ex + 4; x++) tm.soft(x, ey + 5, SHADE);
    return;
  }
  // 男性：法令纹、远侧法令纹、木偶纹、两道鱼尾纹、抬头纹——威严而不邋遢
  tm.soft(MID - 4, my - 3, DEEP);
  tm.soft(MID - 5, my - 2, DEEP);
  tm.soft(MID - 5, my - 1, DEEP);
  tm.soft(MID + 3, my - 2, DEEP);
  tm.soft(MID + 3, my - 1, DEEP);
  // 木偶纹：近侧嘴角外斜下两格
  tm.soft(MID - 4, my + 1, DEEP);
  tm.soft(MID - 4, my + 2, DEEP);
  // 两道鱼尾纹（带笑时下面一道向下弯）
  tm.soft(ex - 3, ey + 2, DEEP);
  tm.soft(ex - 4, ey + 3, DEEP);
  tm.soft(ex - 3, ey, DEEP);
  tm.soft(ex - 4, ey - 1, DEEP);
  if (smiling) tm.soft(ex - 3, ey + 4, DEEP);
  // 抬头纹
  for (let x = 24; x <= 33; x++) tm.soft(x, 17, DEEP);
  for (let x = 26; x <= 36; x++) tm.soft(x, 14, DEEP);
}
