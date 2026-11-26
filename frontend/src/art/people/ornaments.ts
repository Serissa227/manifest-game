// 发饰：不戴帽子时别在头发上的小饰物（原创设计，移植自西幻乙女方案，锚点对齐本方案更大的发壳）。
// 金属用四阶（暗、基、亮、最亮），宝石用点缀色的三阶，左上角一点纯白的闪光——小小几个像素，让人物显得精致；
// 束发布条是干活的人用的一段布带，不带闪光。
// 坐标与头模相同（见 head.ts HEAD）：本方案的发壳比颅骨外扩 2–3.5 像素，头顶约 y 3..6、近侧头侧约 x 13..16，
// 刘海根在 y≈13；所以头冠、珍珠串、星形发针都比原方案上移 / 外移约 2 像素。
import { P } from "../palette";
import { luma, rgba, type Px } from "../px";
import type { PortraitSpec } from "./spec";
import { CLOTH, HAIR, METAL, type ClothColor } from "./tones";

/** 宝石三阶 [暗, 基, 亮]，随点缀色变化：青、翠、紫或红。 */
export function gemRamp(accent: ClothColor): readonly [string, string, string] {
  switch (accent) {
    case "teal":
    case "blue":
    case "navy":
      return [P.teal[1], P.teal[3], P.teal[4]];
    case "green":
    case "jade":
      return [P.jade[1], P.jade[3], P.jade[4]];
    case "purple":
      return [P.cloth.purple[0], P.cloth.purple[1], P.cloth.purple[2]];
    default:
      return [P.red[1], P.red[2], P.red[4]];
  }
}

/**
 * 蝴蝶结与小花、束发布条的布色：从服装的点缀色、主色里挑一个与发色拉得开的（基色明度差 ≥ 30），
 * 两个都太接近发色时，深发配暖红、浅发配宝蓝——不再一律退到酒红。
 */
function clothFor(spec: PortraitSpec): readonly string[] {
  const hair = luma(rgba(HAIR[spec.hairColor][2]));
  const pale: readonly ClothColor[] = ["cream", "white", "sand", "straw"];
  for (const c of [spec.accent, spec.main]) {
    if (pale.includes(c)) continue;
    if (Math.abs(luma(rgba(CLOTH[c][1])) - hair) >= 30) return CLOTH[c];
  }
  return CLOTH[hair < 110 ? "red" : "blue"];
}

/** 只画在头发或皮肤上（细金头冠、珍珠串、蝴蝶结不伸出头的轮廓）。 */
function onFigure(p: Px, x: number, y: number, c: string): void {
  if (p.isOpaque(x, y)) p.set(x, y, c);
}

/** 蝴蝶结（结心）与束发布条的首选位置随发型走：马尾别在马尾根、发髻与丸子别在发髻侧面，其余别在近侧鬓边的头发里。 */
function knotAt(spec: PortraitSpec): readonly [number, number] {
  switch (spec.hair) {
    case "ponytail":
      return [15, 12];
    case "bun":
      return [20, 12];
    case "twinbuns":
      return [19, 9];
    case "updo":
      return [20, 8];
    default:
      return [19, 17];
  }
}

/** 披发的束发布条系在哪一绺上：近侧的鬓发（长发、齐耳短发）、马尾或发辫的中段、极短发后颈的碎发。 */
function tieAt(spec: PortraitSpec): readonly [number, number] {
  switch (spec.hair) {
    case "ponytail":
      return [8, 36];
    case "tied":
      return [12, 38];
    case "braid":
      return [9, 44];
    case "braids":
      return [18, 48];
    case "sidebraid":
      return [21, 50];
    case "pixie":
      return [16, 23];
    default:
      return [16, 34];
  }
}

/** 蝴蝶结的印章：h 左上一格受光、m 基色、d 暗阶（两阶平涂，不逐格交替）。结心在第 3 列第 1 行。 */
const RIBBON: readonly string[] = ["hm...mm", "mmmdmmm", "ddmdmdd", "..d.d.."];

/**
 * 在首选位置附近找一个能让整块印章（连同四周一圈）都压在头发上的锚点（由近到远逐格试，结果确定）；
 * 都放不下时取压住头发最多的一格。蝴蝶结、束发布条因此收在发壳里、不贴着发缘，不会一半浮在背景上、也不会压到脸上。
 */
function anchorOnHair(rows: readonly string[], cx: number, cy: number, ax: number, ay: number, onHair: (x: number, y: number) => boolean): readonly [number, number] {
  const cells: [number, number][] = [];
  rows.forEach((row, r) => [...row].forEach((ch, i) => ch !== "." && cells.push([i - cx, r - cy])));
  const offs: [number, number][] = [];
  for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) offs.push([dx, dy]);
  offs.sort((a, b) => Math.abs(a[0]) + Math.abs(a[1]) - (Math.abs(b[0]) + Math.abs(b[1])) || a[1] - b[1] || a[0] - b[0]);
  let best: readonly [number, number] = [ax, ay];
  let bestN = -1;
  for (const [dx, dy] of offs) {
    const x = ax + dx;
    const y = ay + dy;
    const n = cells.filter(([u, v]) => onHair(x + u, y + v)).length;
    const inside = cells.every(([u, v]) => onHair(x + u - 1, y + v) && onHair(x + u + 1, y + v) && onHair(x + u, y + v - 1) && onHair(x + u, y + v + 1));
    if (inside) return [x, y];
    if (n > bestN) {
      bestN = n;
      best = [x, y];
    }
  }
  return best;
}

/**
 * 画发饰（调用方保证没有戴帽子、不是光头）。onHair 告诉蝴蝶结与束发布条哪里是头发（缺省时只要求落在人物上）。
 */
export function drawOrnament(p: Px, spec: PortraitSpec, onHair: (x: number, y: number) => boolean = (x, y) => p.isOpaque(x, y)): void {
  const g = METAL.gold;
  const gem = gemRamp(spec.accent);
  switch (spec.ornament) {
    case "ribbon": {
      // 蝴蝶结：结心压在头发里（锚点收进发壳，四周至少压住发缘两像素），两只布耳朵、结心、两条短飘带；
      // 两阶平涂（基色、暗阶）加左上一格受光，不逐格交替
      const c = clothFor(spec);
      const [ax, ay] = knotAt(spec);
      const [kx, ky] = anchorOnHair(RIBBON, 3, 1, ax, ay, onHair);
      RIBBON.forEach((row, r) =>
        [...row].forEach((ch, i) => {
          const col = ch === "h" ? P.white : ch === "m" ? c[1] : ch === "d" ? c[0] : null;
          if (col && onHair(kx - 3 + i, ky - 1 + r)) p.set(kx - 3 + i, ky - 1 + r, col);
        }),
      );
      break;
    }
    case "clip": {
      // 宝石发夹：斜别在近侧刘海上的金色细夹（上亮下暗），夹头一颗菱形宝石带白色闪光
      p.line(23, 13, 27, 11, g[3]);
      p.line(23, 14, 27, 12, g[1]);
      p.set(28, 11, g[2]);
      p.set(21, 12, gem[1]);
      p.set(20, 13, P.white);
      p.set(21, 13, gem[1]);
      p.set(22, 13, gem[0]);
      p.set(21, 14, gem[0]);
      break;
    }
    case "circlet": {
      // 细金头冠：一圈细金线绕过额前（近侧亮、远侧暗），额前正中垂一颗水滴形宝石
      for (let x = 16; x <= 47; x++) {
        const y = Math.round(13 - ((x - 33) * (x - 33)) / 70);
        onFigure(p, x, y, x < 29 ? g[3] : x > 40 ? g[1] : g[2]);
      }
      p.set(31, 13, g[3]);
      p.set(35, 13, g[1]);
      p.set(33, 13, g[2]);
      p.set(32, 14, P.white);
      p.set(33, 14, gem[1]);
      p.set(34, 14, gem[0]);
      p.set(33, 15, gem[0]);
      break;
    }
    case "pearls": {
      // 珍珠串：沿 2:1 的斜度连续排开的一粒粒 1 像素珍珠（白与浅银相间），下方一列发色暗阶的投影，末端垂一颗水滴珍珠
      const shadow = HAIR[spec.hairColor][1];
      for (let i = 0; i <= 12; i++) {
        const x = 17 + i;
        const y = 14 - Math.floor((i + 1) / 2);
        onFigure(p, x, y + 1, shadow);
        onFigure(p, x, y, i % 2 === 0 ? P.white : P.snow[2]);
      }
      p.set(17, 15, P.white);
      p.set(17, 16, P.snow[1]);
      break;
    }
    case "star": {
      // 星形发针：别在近侧的金色小星，四角尖、中心最亮带白色闪光，下方露出一截针
      p.set(19, 6, g[2]);
      p.set(19, 7, g[3]);
      p.set(17, 8, g[2]);
      p.set(18, 8, g[3]);
      p.set(19, 8, P.white);
      p.set(20, 8, g[2]);
      p.set(21, 8, g[1]);
      p.set(19, 9, g[1]);
      p.set(19, 10, g[0]);
      p.set(21, 10, g[1]);
      p.set(22, 11, g[0]);
      break;
    }
    case "blossom": {
      // 小花发夹：近侧鬓边一朵五瓣小花（点缀色，花心金色带白色闪光），旁边一片小叶
      const c = clothFor(spec);
      p.stamp([".lm.", "lmkd", "mkkd", ".dd."], { l: c[2], m: c[1], d: c[0], k: g[3] }, 17, 11);
      p.set(19, 12, P.white);
      p.set(21, 14, P.leaf[3]);
      p.set(22, 15, P.leaf[2]);
      break;
    }
    case "tie": {
      // 束发布条：服装主色（或与发色拉得开的点缀色）的一段两像素宽的布带，系在发髻根部；披发的系在近侧那绺鬓发上
      const c = clothFor(spec);
      const knot = spec.hair === "bun" || spec.hair === "twinbuns" || spec.hair === "updo";
      // 发髻根部斜系一道；披发系在近侧那绺鬓发上（横着一道）
      const rows = knot ? ["...m", "..md", ".md.", "md..", "d..."] : ["mmmm", "dddd"];
      const [ax, ay] = knot ? knotAt(spec) : tieAt(spec);
      const [kx, ky] = anchorOnHair(rows, 1, 1, ax, ay, onHair);
      rows.forEach((row, r) =>
        [...row].forEach((ch, i) => {
          const col = ch === "m" ? c[1] : ch === "d" ? c[0] : null;
          if (col && onHair(kx - 1 + i, ky - 1 + r)) p.set(kx - 1 + i, ky - 1 + r, col);
        }),
      );
      break;
    }
    default:
      break;
  }
}
