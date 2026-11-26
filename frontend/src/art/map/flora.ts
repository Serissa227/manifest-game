// 海图上的植物：各植被带的树种与灌丛（针叶、阔叶、橄榄与柏树、棕榈、雨林巨树、金合欢、红树、芦苇、灌丛、冻原矮灌），
// 以及它们随季节的配色。树都是字符图（o 描边、h 亮、m 中、d 暗、t 树干、s 雪或树梢、f 花果），贴图时直接写像素。
import { P } from "../palette";
import { Px, rgba, type Rgba } from "../px";
import { mix } from "./noise";

const R = (c: string): Rgba => rgba(c);

// —— 字符图 ——
export const TREE_ROUND = [".ooo.", "ohhmo", "ohmdo", "omddo", ".odo.", "..t.."];
export const TREE_SMALL = [".oo.", "ohmo", "omdo", ".oo.", ".t.."];
export const TREE_BIG = ["..ooo..", ".ohhmo.", "ohhmmdo", "ohmmddo", "omdddo.", ".oddo..", "...t..."];
export const TREE_PINE = ["..o..", ".oso.", ".ohdo", "ohmddo", "ohmmdo", "oooooo", "..t..."];
export const TREE_PINE_SMALL = [".o.", "oso", "ohd", "ohdo", "oooo", ".t.."];
export const TREE_PINE_TALL = ["..o..", ".oso.", ".ohd.", ".ohdo", "ohmdo", "ohmddo", "oooooo", "..t..."];
export const TREE_CYPRESS = [".o.", "oho", "ohd", "ohd", "ohd", "omd", ".t."];
export const TREE_OLIVE = [".oo.o", "ohmmo", "omdmd", ".odo.", "..t.."];
export const TREE_PALM = [".hh.hm.", "hmmhmmd", "m.dtd.d", "...t...", "...t...", "..t....", "..t...."];
export const TREE_PALM_SMALL = ["hh.hm", "mhtmd", "..t..", "..t..", ".t..."];
/** 雨林巨树：宽大的树冠 */
export const TREE_CANOPY = ["..oooo..", ".ohhmmo.", "ohhmmmdo", "ohmmmddo", "omdddddo", ".oddddo.", "...tt..."];
/** 金合欢（稀树草原）：平顶的伞形树冠 */
export const TREE_ACACIA = [".oooooo.", "ohhmmmdo", ".oddddo.", "...t.t..", "....t...", "....t..."];
/** 落叶后的冬树 */
export const TREE_BARE = [".t.t.", "t.tt.", ".ttt.", "..t..", "..t.."];
/** 红树：低矮的树冠与露出水面的支柱根 */
export const TREE_MANGROVE = [".ooo.", "ohhmo", "omddo", "t.t.t"];
/** 灌丛（地中海马基灌丛、半干旱草原） */
export const SHRUB = [".hm.", "hmdd"];
/** 冻原的矮灌与地衣 */
export const TUNDRA_TUFT = ["h.m", ".d."];
/** 草丛 */
export const TUFT = ["h.h", ".m."];
/** 芦苇 */
export const REED = ["h.h.", "hmh.", ".mhd", ".d.."];

/** 树的配色（打包颜色）。 */
export interface TreePal {
  o: Rgba;
  h: Rgba;
  m: Rgba;
  d: Rgba;
  t: Rgba;
  s: Rgba;
  f: Rgba;
}

const treePal = (o: string, h: string, m: string, d: string, t: string, s: string, f: string): TreePal => ({
  o: R(o),
  h: R(h),
  m: R(m),
  d: R(d),
  t: R(t),
  s: R(s),
  f: R(f),
});

/** 由调色板派生的过渡色。 */
export const OLIVE = [mix(P.leaf[1], P.straw[0], 0.45), mix(P.leaf[2], P.straw[1], 0.45), mix(P.leaf[3], P.straw[1], 0.4), mix(P.leaf[4], P.straw[2], 0.45)];
export const OLIVE_LEAF = [mix(P.leaf[1], P.stone[1], 0.3), mix(P.leaf[2], P.stone[3], 0.35), mix(P.leaf[3], P.stone[4], 0.4)];
export const FIR = [mix(P.leaf[0], P.slate[1], 0.3), mix(P.leaf[1], P.slate[2], 0.35), mix(P.leaf[2], P.snow[1], 0.3)];
export const MIRE = [mix(P.jade[1], P.wood[1], 0.5), mix(P.jade[2], P.wood[2], 0.45), mix(P.leaf[3], P.straw[1], 0.5)];

/** 树种。 */
export type TreeKind =
  | "conifer"
  | "conifer-snow"
  | "broad"
  | "broad-south"
  | "olive"
  | "cypress"
  | "palm"
  | "canopy"
  | "acacia"
  | "mangrove"
  | "swamp"
  | "shrub"
  | "tundra"
  | "blossom"
  | "bare"
  /** 秋天的金黄与深红（阔叶林里与橙色的树混着长） */
  | "golden"
  | "crimson";

/** 某树种某季节的配色（season：0 春 1 夏 2 秋 3 冬）。 */
export function treePalette(kind: TreeKind, season: number): TreePal {
  const trunk = P.wood[1];
  const winter = season === 3;
  const autumn = season === 2;
  switch (kind) {
    case "conifer":
      return treePal(P.leaf[0], FIR[2], FIR[1], FIR[0], trunk, winter ? P.snow[3] : FIR[2], P.snow[3]);
    case "conifer-snow":
      return treePal(P.leaf[0], P.snow[3], FIR[1], FIR[0], trunk, P.snow[3], P.snow[3]);
    case "broad":
      if (autumn) return treePal(P.autumn[0], P.autumn[3], P.autumn[2], P.autumn[1], trunk, P.autumn[2], P.red[3]);
      if (winter) return treePal(P.wood[0], P.wood[2], P.wood[1], P.wood[0], trunk, P.snow[3], P.snow[3]);
      if (season === 0) return treePal(P.leaf[1], P.leaf[4], P.leaf[3], P.leaf[2], trunk, P.leaf[3], P.blossom[2]);
      return treePal(P.leaf[0], P.leaf[3], P.leaf[2], P.leaf[1], trunk, P.leaf[2], P.blossom[2]);
    case "broad-south":
      // 暖温带的常绿阔叶：四季常绿，秋天只略带黄
      if (autumn) return treePal(P.leaf[0], P.straw[3], P.leaf[3], P.leaf[1], trunk, P.leaf[3], P.autumn[3]);
      return treePal(P.leaf[0], P.leaf[3], P.leaf[2], P.leaf[1], trunk, P.leaf[2], P.blossom[2]);
    case "olive":
      return treePal(OLIVE[0], OLIVE_LEAF[2], OLIVE_LEAF[1], OLIVE_LEAF[0], P.wood[2], OLIVE_LEAF[1], P.plaster[3]);
    case "cypress":
      return treePal(P.leaf[0], P.leaf[2], P.leaf[1], P.leaf[0], trunk, P.leaf[1], P.leaf[2]);
    case "palm":
      return treePal(P.jade[0], P.leaf[4], P.jade[3], P.jade[1], P.straw[1], P.jade[3], P.gold[3]);
    case "canopy":
      return treePal(P.jade[0], mix(P.leaf[3], P.jade[3], 0.5), P.jade[2], P.jade[1], P.wood[2], P.jade[3], P.red[3]);
    case "acacia":
      if (season === 0) return treePal(P.leaf[0], P.leaf[4], P.leaf[3], P.leaf[2], P.wood[1], P.leaf[3], P.gold[3]);
      return treePal(P.leaf[0], mix(P.leaf[3], P.straw[2], 0.45), mix(P.leaf[2], P.straw[1], 0.35), P.leaf[1], P.wood[1], P.leaf[2], P.gold[3]);
    case "mangrove":
      return treePal(P.jade[0], P.leaf[3], P.jade[2], P.jade[1], P.wood[1], P.jade[2], P.leaf[4]);
    case "swamp":
      return treePal(P.jade[0], P.leaf[3], MIRE[1], MIRE[0], P.wood[1], MIRE[1], P.leaf[4]);
    case "shrub":
      if (season === 1 || autumn) return treePal(OLIVE[0], OLIVE[3], OLIVE[1], OLIVE[0], OLIVE[0], OLIVE[2], P.blossom[2]);
      return treePal(OLIVE[0], P.leaf[3], OLIVE[2], OLIVE[1], OLIVE[0], OLIVE[2], P.blossom[2]);
    case "tundra":
      if (autumn) return treePal(P.red[1], P.autumn[2], P.red[2], P.red[1], P.wood[1], P.autumn[2], P.autumn[3]);
      return treePal(P.leaf[1], mix(P.leaf[3], P.stone[3], 0.4), mix(P.leaf[2], P.stone[2], 0.4), P.leaf[1], P.wood[1], P.stone[3], P.snow[2]);
    case "blossom":
      return treePal(P.blossom[0], P.blossom[3], P.blossom[2], P.blossom[1], trunk, P.blossom[2], P.white);
    case "bare":
      return treePal(P.wood[0], P.wood[2], P.wood[1], P.wood[0], P.wood[1], P.snow[3], P.snow[3]);
    case "golden":
      return treePal(P.straw[0], P.gold[4], P.gold[3], P.gold[2], trunk, P.gold[3], P.autumn[3]);
    case "crimson":
      return treePal(P.red[0], P.red[3], P.red[2], P.red[1], trunk, P.red[2], P.autumn[3]);
  }
}

/** 贴一棵树（树的颜色都不透明，直接写像素，不做混合）。 */
export function stampTree(p: Px, rows: readonly string[], x: number, y: number, pal: TreePal, flip = false): void {
  const key = pal as unknown as Record<string, Rgba>;
  const d = p.data;
  for (let r = 0; r < rows.length; r++) {
    const yy = y + r;
    if (yy < 0 || yy >= p.h) continue;
    const row = rows[r];
    const n = row.length;
    for (let i = 0; i < n; i++) {
      const col = key[row[i]];
      if (col === undefined) continue;
      const xx = flip ? x + n - 1 - i : x + i;
      if (xx >= 0 && xx < p.w) d[yy * p.w + xx] = col;
    }
  }
}

/** 竹丛：几根带节的竹竿，顶上与节间伸出竹叶。(x, y) 为竹丛底部中点。 */
export function bamboo(p: Px, x: number, y: number, seed: number, season: number, rnd: (a: number, b: number, s: number) => number): void {
  const stalk = season === 3 ? P.straw[2] : P.jade[3];
  const node = P.jade[1];
  const leaf = season === 2 ? P.straw[3] : P.leaf[4];
  const leafDark = P.jade[2];
  const n = 2 + Math.floor(rnd(x, y, seed) * 2);
  for (let k = 0; k < n; k++) {
    const sx = x - n + 1 + k * 2;
    const h = 5 + Math.floor(rnd(x + k, y, seed + 1) * 3);
    for (let r = 0; r < h; r++) p.set(sx, y - r, (r + k) % 3 === 2 ? node : stalk);
    const top = y - h + 1;
    p.set(sx - 1, top, leaf).set(sx + 1, top - 1, leaf).set(sx, top - 1, leafDark);
    p.set(sx + 1, top + 2, leafDark);
  }
}
