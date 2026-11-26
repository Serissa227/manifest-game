// 街头行人：约 10×18 的小人，面朝右。画布固定 12×24（含 1 像素外轮廓，并给高帽、顶在头上的货箱留出余量），
// 脚踩在 y = GROUND 行（倒数第二行），调用方按底边对齐即可。
// 4 帧行走循环：迈步 → 并步（身体上浮 1 像素）→ 换腿迈步 → 并步。颜色与头像参数一致。
// 不同身份轮廓不同：水手喇叭裤、官员及踝长袍与高帽、商贩挑担、仓库伙计头顶货箱、船长大衣与三角帽……
// 各文化的服饰也简化地体现出来：羽饰帽与褶领、高顶帽与白领、缠头与面纱、花环、发冠、软宽檐帽；精灵血统的人露出一点尖耳。
import type { ArchStyle } from "../buildings";
import { P } from "../palette";
import { Px } from "../px";
import type { PortraitSpec } from "./spec";
import { CLOTH, METAL, OUTLINE, SKIN_TONES, hair3, type Ramp3 } from "./tones";

/** 官帽的布色，按文化（与头像的官帽一致；未指定时按地中海）。 */
const OFFICIAL_HAT: Readonly<Record<ArchStyle, Ramp3>> = {
  mediterranean: CLOTH.black,
  nordic: CLOTH.slate,
  lowland: CLOTH.black,
  desert: CLOTH.cream,
  islands: CLOTH.teal,
  eastern: CLOTH.black,
  frontier: CLOTH.navy,
};

export const WALKER_W = 12;
export const WALKER_H = 24;
/** 脚底所在行。 */
export const GROUND = 22;

/** 行人的轮廓类别。 */
type Build = "robe" | "coat" | "dress" | "pants";

function buildOf(spec: PortraitSpec): Build {
  if (spec.outfit === "official" || spec.outfit === "robe" || spec.outfit === "wide" || spec.outfit === "banker") return "robe";
  if (spec.female && (spec.outfit === "bodice" || spec.outfit === "wool")) return "dress";
  if (spec.outfit === "captain" || spec.outfit === "coat" || spec.outfit === "fur" || spec.outfit === "wool" || spec.outfit === "buckskin") return "coat";
  if (spec.female && (spec.outfit === "dress" || spec.outfit === "apron" || spec.outfit === "island" || spec.outfit === "tunic" || spec.outfit === "vest"))
    return "dress";
  return "pants";
}

/** 携带物。 */
type Carry = "none" | "pole" | "crate" | "sack" | "basket" | "book" | "sword" | "pack";

function carryOf(spec: PortraitSpec): Carry {
  const k = spec.seed % 7;
  switch (spec.role) {
    case "market":
      return "pole";
    case "warehouse":
      return "crate";
    case "sailor":
      return k < 3 ? "sack" : "none";
    case "townsfolk":
      return spec.female ? (k < 3 ? "basket" : "none") : k < 2 ? "pack" : k < 3 ? "basket" : "none";
    case "pirate":
    case "captain":
      return "sword";
    case "guild":
    case "bank":
    case "exchange":
    case "invest":
    case "office":
      return "book";
    case "mate":
      return k < 2 ? "sword" : "none";
    default:
      return "none";
  }
}

export interface Pose {
  /** 近侧脚、远侧脚的鞋尖 x */
  near: number;
  far: number;
  /** 近侧手相对肩的水平位移（远侧手相反） */
  hand: number;
  /** 身体上浮（负数向上） */
  lift: number;
}

const WALK: readonly Pose[] = [
  { near: 9, far: 3, hand: -2, lift: 0 },
  { near: 6, far: 5, hand: 0, lift: -1 },
  { near: 3, far: 9, hand: 2, lift: 0 },
  { near: 5, far: 6, hand: 0, lift: -1 },
];
const IDLE: Pose = { near: 7, far: 5, hand: 0, lift: 0 };

/** 腿：从髋 (x=6, hipY) 到鞋尖 (fx, GROUND)，两像素宽，鞋子向前长出一像素。 */
function leg(p: Px, hipY: number, fx: number, cloth: string, shoe: string): void {
  const hx = 6;
  for (let y = hipY; y <= GROUND - 1; y++) {
    const t = (y - hipY) / Math.max(1, GROUND - 1 - hipY);
    const x = Math.round(hx + (fx - 1 - hx) * t);
    p.set(x, y, cloth);
    p.set(x - 1, y, cloth);
  }
  p.hline(fx - 2, fx, GROUND, shoe);
}

/** 画一帧行人。 */
export function renderWalker(spec: PortraitSpec, pose: Pose): Px {
  const p = new Px(WALKER_W, WALKER_H);
  const skin = SKIN_TONES[Math.max(0, Math.min(SKIN_TONES.length - 1, spec.skin))];
  const hair = hair3(spec.hairColor);
  const main = CLOTH[spec.main];
  const acc = CLOTH[spec.accent];
  const build = buildOf(spec);
  const carry = carryOf(spec);
  const L = pose.lift;
  const striped = spec.outfit === "striped";
  const pants: Ramp3 = spec.role === "sailor" ? CLOTH.white : spec.role === "captain" ? CLOTH.cream : spec.outfit === "island" ? CLOTH.sand : CLOTH.brown;
  const shoe = P.wood[0];
  const hy = 5 + L; // 头顶
  const topY = 11 + L; // 肩
  const shoulderY = 12 + L;
  const hipY = 17 + L;

  // 远侧手臂（身后，最暗）
  const farHand = 6 - pose.hand;
  if (carry !== "crate" && carry !== "pole") {
    p.line(6, shoulderY, farHand, shoulderY + 3, main[0]);
    p.set(farHand, shoulderY + 4, skin[1]);
  }

  // 腿 / 下摆
  if (build === "robe") {
    // 及踝长袍：只露出交替的鞋尖，下摆随步子摆动
    const sway = pose.hand === 0 ? 0 : pose.hand > 0 ? -1 : 1;
    p.poly(
      [
        [4, hipY - 1],
        [8, hipY - 1],
        [9 + (sway > 0 ? 1 : 0), GROUND],
        [3 + (sway < 0 ? -1 : 0), GROUND],
      ],
      main[1],
    );
    p.vline(8, hipY, GROUND - 1, main[0]);
    p.set(4, hipY + 1, main[2]);
    p.hline(3, 9, GROUND - 1, spec.accent === spec.main ? main[0] : acc[1]);
    const nx = Math.min(pose.near, 10);
    p.hline(nx - 1, nx, GROUND, shoe);
    if (pose.far !== pose.near) p.set(Math.max(2, Math.min(pose.far, 10)) - 1, GROUND, P.wood[1]);
  } else {
    leg(p, hipY, pose.far, pants[0], shoe);
    leg(p, hipY, pose.near, pants[1], shoe);
    if (spec.role === "sailor") {
      // 喇叭裤口
      p.set(pose.near - 3, GROUND - 1, pants[1]);
      p.set(pose.far - 3, GROUND - 1, pants[0]);
    }
    if (build === "dress") {
      // 过膝的 A 字裙
      p.poly(
        [
          [4, hipY - 2],
          [8, hipY - 2],
          [10, GROUND - 2],
          [2, GROUND - 2],
        ],
        main[1],
      );
      p.hline(2, 9, GROUND - 2, main[0]);
      p.vline(9, hipY, GROUND - 3, main[0]);
      p.set(4, hipY, main[2]);
      if (spec.outfit === "apron" || spec.role === "tavern" || spec.role === "market") p.rect(7, hipY - 1, 3, 4, CLOTH.white[2]);
    } else if (build === "coat") {
      // 大衣后摆到膝
      p.poly(
        [
          [3, hipY - 1],
          [8, hipY - 1],
          [8, GROUND - 3],
          [2, GROUND - 3],
        ],
        main[1],
      );
      p.vline(2, hipY, GROUND - 3, main[0]);
      if (spec.role === "captain") p.hline(2, 8, GROUND - 3, METAL.gold[2]);
      if (spec.outfit === "fur") p.hline(2, 8, GROUND - 3, P.snow[2]);
    }
  }

  // 身体
  const torso: Ramp3 = spec.outfit === "smith" || spec.outfit === "apron" || spec.outfit === "vest" ? CLOTH.white : spec.outfit === "leather" ? CLOTH.leather : main;
  p.rect(4, topY, 5, hipY - topY, torso[1]);
  p.vline(4, topY + 1, hipY - 1, torso[2]);
  p.vline(8, topY, hipY - 1, torso[0]);
  p.hline(5, 7, topY, torso[2]);
  if (striped) for (let y = topY + 1; y < hipY; y += 2) p.hline(4, 8, y, main[1]);
  if (spec.outfit === "vest" || spec.outfit === "smith" || spec.outfit === "apron") {
    // 马甲 / 围裙：前胸一块主色
    const front = spec.outfit === "smith" ? CLOTH.leather : main;
    p.rect(6, topY + 1, 3, hipY - topY + (spec.outfit === "vest" ? -1 : 2), front[1]);
    p.vline(8, topY + 1, hipY + 1, front[0]);
  }
  // 腰带
  if (build !== "dress" && build !== "robe") p.hline(4, 8, hipY - 1, spec.role === "pirate" ? P.red[2] : P.wood[1]);
  if (build === "robe") p.hline(4, 8, hipY - 1, acc[1]);
  if (spec.outfit === "fur") p.hline(4, 8, topY, P.snow[2]);
  if (spec.role === "captain") {
    p.vline(7, topY + 1, hipY - 2, METAL.gold[2]);
    p.set(8, topY + 1, CLOTH.white[2]);
  }
  if (spec.outfit === "official") p.set(7, topY + 2, METAL.gold[2]);
  if (spec.outfit === "coat" || spec.outfit === "jacket" || spec.outfit === "striped") p.set(7, topY, acc[1]);
  if (spec.necklace === "shell") p.set(7, topY + 1, P.blossom[3]);
  if (spec.necklace === "lei") p.hline(5, 8, topY, P.red[2]).set(6, topY, P.gold[3]);
  // 文化服饰的小标记：褶领、白色大平领、胸衣的绣片、围巾、金绣
  if (spec.outfit === "doublet") {
    p.hline(4, 8, topY, CLOTH.white[2]);
    p.set(7, topY + 2, METAL.gold[2]);
    p.set(7, topY + 4, METAL.gold[2]);
  }
  if (spec.outfit === "wool") p.hline(4, 8, topY, CLOTH.white[2]).set(6, topY + 1, CLOTH.white[1]);
  if (spec.outfit === "bodice") p.set(6, topY + 1, acc[2]).set(6, topY + 2, METAL.gold[2]).hline(4, 8, topY, CLOTH.cream[1]);
  if (spec.outfit === "buckskin") p.hline(5, 8, topY, acc[1]).set(8, topY + 1, acc[0]);

  // 头：后脑头发 + 朝右的脸
  const bald = spec.hair === "bald";
  const rows = [".hhh.", "hhhhh", "hhsss", "hhses", ".ssss", "..SS."];
  rows.forEach((row, r) => {
    for (let i = 0; i < row.length; i++) {
      const ch = row[i];
      const x = 4 + i;
      const y = hy + r;
      if (ch === "h") p.set(x, y, bald ? skin[r === 0 || i === 0 ? 1 : 2] : r === 0 || i === 0 ? hair[0] : hair[1]);
      else if (ch === "s") p.set(x, y, skin[2]);
      else if (ch === "S") p.set(x, y, skin[1]);
      else if (ch === "e") p.set(x, y, P.hair.black[0]);
    }
  });
  if (!bald) p.set(5, hy, hair[2]);
  else p.set(6, hy, skin[3]);
  // 胡子
  if (spec.beard === "full" || spec.beard === "long" || spec.beard === "goatee" || spec.beard === "chops" || spec.beard === "trim") {
    p.set(7, hy + 4, hair[1]);
    p.set(8, hy + 4, hair[1]);
    if (spec.beard === "long") p.set(7, hy + 5, hair[0]);
  }
  if (spec.eyepatch) p.set(7, hy + 3, P.cloth.black[0]);
  // 女性长发 / 马尾 / 辫子垂在脑后
  const longHair = spec.female && !["pixie", "bun", "updo", "twinbuns", "crownbraid"].includes(spec.hair);
  if (longHair || spec.hair === "long" || spec.hair === "tied" || spec.hair === "braid") {
    const len = spec.hair === "braid" || spec.hair === "ponytail" || spec.hair === "braids" ? 5 : 3;
    for (let y = hy + 2; y < hy + 2 + len; y++) p.set(3, y, hair[0]);
    p.set(4, hy + 4, hair[1]);
  }
  if (spec.hair === "bun" || spec.hair === "topknot" || spec.hair === "updo" || spec.hair === "twinbuns") {
    p.set(3, hy + 1, hair[1]);
    p.set(3, hy, hair[0]);
  }
  // 精灵血统：后脑旁探出一点尖耳
  if (spec.elf && spec.hat !== "hood" && spec.hat !== "veil" && spec.hat !== "fur") {
    p.set(4, hy + 2, skin[2]);
    p.set(3, hy + 1, skin[2]);
  }

  // 帽子
  drawWalkerHat(p, spec, hy);

  // 近侧手臂（最前）
  const sleeve = spec.outfit === "island" ? skin[2] : torso === main ? main[2] : CLOTH.white[1];
  const armNear = (dx: number) => {
    const hx = 6 + dx;
    p.line(6, shoulderY, hx, shoulderY + 3, sleeve);
    p.set(hx, shoulderY + 4, skin[3]);
  };

  // 携带物
  switch (carry) {
    case "pole": {
      // 扁担横在近侧肩上，两头挂筐；两手扶着扁担
      const y = topY;
      p.hline(0, 11, y, P.wood[3]);
      p.hline(0, 11, y + 1, P.wood[1]);
      for (const bx of [0, 9]) {
        p.vline(bx + 1, y + 2, y + 4, P.straw[0]);
        p.rect(bx, y + 5, 3, 3, P.straw[2]);
        p.hline(bx, bx + 2, y + 5, P.straw[3]);
        p.set(bx + 1, y + 4, spec.seed % 2 ? P.red[2] : P.leaf[3]);
      }
      p.set(7, y + 2, sleeve);
      p.set(8, y + 1, skin[3]);
      break;
    }
    case "crate": {
      // 头顶的木箱，近侧手举起扶着
      const cy = hy - 5;
      p.rect(3, cy, 7, 5, P.wood[2]);
      p.hline(3, 9, cy, P.wood[3]);
      p.vline(9, cy + 1, cy + 4, P.wood[1]);
      p.hline(3, 9, cy + 4, P.wood[1]);
      p.line(3, cy + 1, 8, cy + 3, P.wood[1]);
      p.line(6, shoulderY, 9, hy + 1, sleeve);
      p.set(9, hy, skin[3]);
      break;
    }
    case "sack": {
      // 背后的水手袋
      p.ellipse(3, topY + 2, 2, 3, CLOTH.cream[1]);
      p.set(2, topY, CLOTH.cream[2]);
      p.vline(1, topY + 1, topY + 4, CLOTH.cream[0]);
      p.line(3, topY - 1, 6, topY + 1, P.wood[1]);
      armNear(pose.hand);
      break;
    }
    case "pack": {
      p.rect(2, topY + 1, 3, 5, P.wood[2]);
      p.vline(2, topY + 1, topY + 5, P.wood[1]);
      p.hline(2, 4, topY + 1, P.wood[3]);
      armNear(pose.hand);
      break;
    }
    case "basket": {
      armNear(1);
      p.rect(7, shoulderY + 4, 4, 3, P.straw[2]);
      p.hline(7, 10, shoulderY + 4, P.straw[3]);
      p.set(8, shoulderY + 3, spec.seed % 2 ? P.red[2] : P.leaf[3]);
      p.set(9, shoulderY + 3, P.gold[3]);
      break;
    }
    case "book": {
      armNear(1);
      p.rect(7, shoulderY + 1, 2, 4, acc === main ? P.red[1] : acc[0]);
      p.set(7, shoulderY + 1, P.paper);
      break;
    }
    case "sword": {
      // 腰间佩剑，剑鞘斜向后方
      p.line(4, hipY, 1, hipY + 3, P.iron[1]);
      p.set(5, hipY - 1, METAL.gold[2]);
      armNear(pose.hand);
      break;
    }
    default:
      armNear(pose.hand);
  }

  return withOutline(p);
}

/** 行人的帽子（简化版，与头像的帽子同色同形）。 */
function drawWalkerHat(p: Px, spec: PortraitSpec, hy: number): void {
  const hat = CLOTH[spec.hatColor];
  switch (spec.hat) {
    case "tricorn": {
      const k = spec.role === "captain" ? CLOTH[spec.hatColor === "gold" ? "black" : spec.hatColor] : hat;
      p.hline(2, 10, hy + 1, k[1]);
      p.hline(4, 8, hy, k[1]);
      p.set(2, hy, k[1]);
      p.set(10, hy, k[0]);
      p.hline(4, 8, hy - 1, k[0]);
      if (spec.role === "captain" || spec.role === "pirate") p.hline(3, 9, hy + 1, METAL.gold[2]);
      break;
    }
    case "cap":
      p.hline(4, 8, hy - 1, CLOTH.navy[1]);
      p.hline(4, 8, hy, CLOTH.navy[2]);
      p.hline(6, 10, hy + 1, CLOTH.black[0]);
      p.set(7, hy, METAL.gold[2]);
      break;
    case "bandana":
    case "kerchief":
    case "beanie":
    case "scholar":
      p.hline(4, 8, hy, hat[1]);
      p.hline(4, 8, hy + 1, hat[spec.hat === "beanie" ? 0 : 1]);
      p.set(5, hy - 1, hat[2]);
      p.set(6, hy - 1, hat[1]);
      p.set(7, hy - 1, hat[1]);
      if (spec.hat === "bandana" || spec.hat === "kerchief") {
        p.set(3, hy + 1, hat[1]);
        p.set(2, hy + 2, hat[0]);
      }
      break;
    case "straw": {
      const s = P.straw;
      p.hline(1, 11, hy + 1, s[2]);
      p.hline(4, 8, hy, s[3]);
      p.hline(5, 7, hy - 1, s[2]);
      p.hline(4, 8, hy + 1, s[1]);
      break;
    }
    case "fur": {
      const fur =
        spec.hatColor === "white" || spec.hatColor === "cream" || spec.hatColor === "slate"
          ? P.snow
          : spec.hatColor === "iron" || spec.hatColor === "navy" || spec.hatColor === "black"
            ? P.stone
            : P.wood.slice(1);
      p.hline(3, 9, hy, fur[2]);
      p.hline(3, 9, hy + 1, fur[1]);
      p.hline(4, 8, hy - 1, CLOTH[spec.main][1]);
      p.vline(3, hy + 2, hy + 3, fur[1]);
      break;
    }
    case "turban":
    case "hood": {
      p.hline(3, 9, hy, hat[1]);
      p.hline(4, 8, hy - 1, hat[2]);
      p.hline(3, 9, hy + 1, hat[0]);
      if (spec.hat === "turban") p.hline(4, 7, hy - 2, hat[1]);
      if (spec.hat === "hood") p.vline(3, hy + 2, hy + 6, hat[0]);
      break;
    }
    case "official": {
      // 官帽随文化变化，帽色与头像一致；未指定文化时按地中海
      const own = spec.region ?? "mediterranean";
      const col = OFFICIAL_HAT[own];
      if (own === "desert") {
        // 高缠头 + 白羽
        p.rect(3, hy - 2, 7, 3, col[1]);
        p.hline(4, 8, hy - 3, col[2]);
        p.hline(3, 9, hy, col[0]);
        p.set(8, hy - 4, P.white);
        p.set(6, hy - 1, P.red[2]);
        break;
      }
      if (own === "islands") {
        // 羽冠
        for (let x = 3; x <= 9; x++) p.set(x, hy - 1 - (x % 2), x % 3 ? P.teal[3] : P.gold[3]);
        p.hline(3, 9, hy, P.straw[2]);
        break;
      }
      if (own === "mediterranean") {
        // 丝绒扁帽 + 白羽垂向脑后
        p.hline(3, 9, hy, col[1]);
        p.hline(4, 8, hy - 1, col[2]);
        p.hline(1, 3, hy - 1, P.white);
        p.set(1, hy, P.snow[1]);
        p.set(7, hy - 1, METAL.gold[2]);
        break;
      }
      if (own === "frontier") {
        // 两角帽
        p.hline(2, 10, hy, col[1]);
        p.hline(4, 8, hy - 1, col[1]);
        p.set(2, hy - 1, col[1]);
        p.set(10, hy - 1, col[0]);
        p.hline(3, 9, hy, METAL.gold[2]);
        break;
      }
      p.rect(4, hy - 2, 5, 3, col[1]);
      p.vline(8, hy - 2, hy, col[0]);
      p.hline(4, 8, hy - 2, col[2]);
      if (own === "eastern") {
        p.hline(1, 3, hy - 1, col[1]);
        p.hline(9, 11, hy - 2, col[0]);
      }
      if (own === "lowland") p.hline(2, 10, hy + 1, col[1]);
      if (own === "nordic") p.hline(3, 9, hy, P.white);
      p.set(7, hy, METAL.gold[2]);
      break;
    }
    case "visor":
      p.hline(6, 10, hy + 1, P.jade[3]);
      break;
    case "headband":
      p.hline(4, 8, hy + 1, hat[1]);
      p.set(3, hy + 2, hat[0]);
      break;
    case "flower":
    case "wreath":
      p.set(4, hy + 1, P.red[2]);
      p.set(5, hy, P.blossom[2]);
      break;
    case "plumed": {
      // 宽檐 + 白羽
      const k = CLOTH[spec.hatColor === "white" || spec.hatColor === "cream" ? "black" : spec.hatColor];
      p.hline(1, 11, hy + 1, k[1]);
      p.hline(4, 8, hy, k[1]);
      p.hline(4, 8, hy - 1, k[2]);
      p.hline(2, 5, hy - 2, P.white);
      p.set(1, hy - 1, P.white);
      break;
    }
    case "mantilla":
      // 高梳 + 垂在脑后的黑纱
      p.hline(4, 7, hy - 2, P.wood[2]);
      p.hline(4, 7, hy - 1, P.wood[1]);
      p.vline(3, hy, hy + 7, P.cloth.black[1]);
      p.vline(2, hy + 2, hy + 8, P.cloth.black[0]);
      break;
    case "capotain": {
      // 高顶宽边帽
      const k = CLOTH.black;
      p.rect(4, hy - 3, 5, 4, k[1]);
      p.vline(8, hy - 3, hy, k[0]);
      p.hline(2, 10, hy + 1, k[1]);
      p.set(6, hy, METAL.silver[2]);
      break;
    }
    case "lacecap":
      p.hline(3, 7, hy, CLOTH.white[2]);
      p.hline(3, 6, hy - 1, CLOTH.white[1]);
      p.vline(3, hy + 1, hy + 3, CLOTH.white[1]);
      break;
    case "crown":
      p.set(4, hy - 2, METAL.gold[2]);
      p.set(5, hy - 2, METAL.gold[3]);
      p.set(4, hy - 1, METAL.gold[1]);
      break;
    case "hairpin":
      p.set(2, hy - 1, METAL.gold[2]);
      p.set(3, hy, METAL.gold[1]);
      break;
    case "slouch": {
      // 软宽檐帽：前低后翘
      const k = CLOTH[spec.hatColor === "white" || spec.hatColor === "cream" || spec.hatColor === "gold" ? "brown" : spec.hatColor];
      p.hline(2, 11, hy + 1, k[1]);
      p.set(1, hy, k[1]);
      p.hline(4, 8, hy, k[0]);
      p.hline(4, 8, hy - 1, k[1]);
      p.set(6, hy - 1, k[0]);
      break;
    }
    case "veil":
      // 包头纱 + 遮住下半张脸的面纱
      p.hline(3, 9, hy, hat[1]);
      p.hline(4, 8, hy - 1, hat[2]);
      p.hline(3, 9, hy + 1, hat[0]);
      p.vline(3, hy + 2, hy + 6, hat[0]);
      p.hline(6, 8, hy + 4, CLOTH.white[1]);
      p.set(7, hy + 5, CLOTH.white[1]);
      break;
    default:
      break;
  }
}
/** 加 1 像素外轮廓（不改变画布尺寸）。 */
function withOutline(p: Px): Px {
  const out = new Px(p.w, p.h);
  for (let y = 0; y < p.h; y++) {
    for (let x = 0; x < p.w; x++) {
      if (p.isOpaque(x, y)) continue;
      if (p.isOpaque(x - 1, y) || p.isOpaque(x + 1, y) || p.isOpaque(x, y - 1) || p.isOpaque(x, y + 1)) out.put(x, y, OUTLINE);
    }
  }
  return out.blit(p, 0, 0);
}

export function walkPose(frame: number): Pose {
  const n = WALK.length;
  return WALK[((Math.floor(frame) % n) + n) % n];
}

export function idlePose(): Pose {
  return IDLE;
}
