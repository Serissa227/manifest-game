// 头像合成（64×64，胸像构图）：背景 → 后层头发 / 帽子后层 → 颈 → 胸口与衣服（整层下移 BODY_DY，露出一段颈与肩线）→
// 头部皮肤 → 五官与胡须 → 前层头发 → 精灵尖耳 → 帽子（不戴帽时别上发饰）→ 饰物 → 收拾零星叠出的棋盘格，
// 最后给整个人物描一圈外轮廓，贴到按身份着色的背景上。
// 外轮廓用“同色系的深一阶”：挨着皮肤的一圈用皮肤的描边色、挨着头发的用发色最深一阶、挨着衣料的用衣料的深影，
// 已经是描边色的像素外面不再加一圈——整体比统一的近黑描边柔和，又不会糊进背景。
import { P, ink } from "../palette";
import { Px, rgba } from "../px";
import { hatDef } from "./hats";
import { braidBoxes, braidTexture, cleanHairComposite, drawHairTies, hairMasks, paintHair, paintHairBack } from "./hair";
import { ageTones, drawBrows, drawEyes, drawMouth, noseTones } from "./face";
import {
  HEAD,
  PORTRAIT_SIZE,
  ToneMap,
  chestTones,
  drawBeard,
  drawEarring,
  drawElfEar,
  drawEyepatch,
  drawGlasses,
  drawPipe,
  drawScar,
  headTones,
  neckTones,
  skinRouge,
  stubbleTones,
} from "./head";
import { drawOrnament } from "./ornaments";
import { bareArms, bodyMask, drawCape, drawNecklace, drawOutfit, drawRoleProp, drawSwordBelt } from "./outfit";
import type { NpcRole, PortraitSpec } from "./spec";
import { CLOTH, CLOTH_DEEP, FACE_SKIN, HAIR, METAL, OUTLINE, faceRamp, skinIndex, stubbleTone, type ClothColor } from "./tones";

const S = PORTRAIT_SIZE;

/** 衣服与胸口整层下移的像素数：头的大小不变，颈多露出一格、肩线落低，构图是胸像而不是大头贴。 */
export const BODY_DY = 1;

/** 身份背景：[暗, 中, 亮]。 */
export const ROLE_BG: Readonly<Record<NpcRole, readonly [string, string, string]>> = {
  market: [P.gold[0], P.gold[1], P.gold[2]],
  shipyard: [P.wood[0], P.wood[1], P.wood[2]],
  tavern: [P.red[0], P.autumn[0], P.autumn[1]],
  guild: [P.jade[0], P.jade[1], P.jade[2]],
  bank: [P.cloth.purple[0], P.cloth.purple[1], P.cloth.purple[2]],
  exchange: [P.cloth.navy[1], P.cloth.blue[0], P.cloth.blue[1]],
  warehouse: [P.straw[0], P.straw[1], P.straw[2]],
  invest: [P.teal[0], P.teal[1], P.teal[2]],
  office: [P.red[0], P.red[1], P.red[2]],
  mate: [P.sea[0], P.sea[1], P.sea[2]],
  captain: [P.night[1], P.night[2], P.night[3]],
  pirate: [ink.deep, P.red[0], P.red[1]],
  sailor: [P.sky[0], P.sky[1], P.sky[2]],
  townsfolk: [P.stone[0], P.stone[1], P.stone[2]],
};

/** 背景：平涂的赛璐璐底——上方一条暗带、中间色铺底，头后两圈干净的实心光晕（没有抖动）。 */
function background(role: NpcRole): Px {
  const [d, m, l] = ROLE_BG[role];
  const p = new Px(S, S).fill(m);
  p.rect(0, 0, S, 9, d);
  // 暗带下沿一道斜斜的切口，画面不至于太板
  for (let x = 0; x < S; x++) {
    const h = 9 + Math.floor((S - x) / 16);
    p.vline(x, 9, h, d);
  }
  const halo = new Px(S, S).ellipse(31, 26, 21, 21, "#fff");
  const core = new Px(S, S).ellipse(31, 26, 16, 16, "#fff");
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      if (core.isOpaque(x, y)) p.set(x, y, l);
      else if (halo.isOpaque(x, y)) p.set(x, y, m);
    }
  }
  return p;
}

/** 颜色 → 同色系描边色的通用对照表（皮肤、头发、衣料、金属）；不认识的颜色用通用描边色。 */
let lineTable: Map<number, number> | null = null;
function commonLines(): Map<number, number> {
  if (!lineTable) {
    const t = new Map<number, number>();
    const add = (ramp: readonly string[], line: string) => {
      for (const c of ramp) if (!t.has(rgba(c))) t.set(rgba(c), rgba(line));
    };
    for (const r of FACE_SKIN) add(r, r[0]);
    for (const r of Object.values(HAIR)) add(r, r[0]);
    for (const [k, r] of Object.entries(CLOTH)) add([CLOTH_DEEP[k as ClothColor], ...r], CLOTH_DEEP[k as ClothColor]);
    add(METAL.gold, P.gold[0]);
    add(METAL.silver, P.iron[0]);
    lineTable = t;
  }
  return lineTable;
}

/**
 * 本人的描边对照：先查本人的皮肤、发色与灰发（深肤色的暗面与别的肤色的描边是同一个颜色，
 * 按本人查才不会把深肤色的颈侧当成“已经是描边”），再查通用表。
 */
function linesFor(spec: PortraitSpec): (v: number) => number {
  const own = new Map<number, number>();
  const add = (ramp: readonly string[], line: string) => {
    for (const c of ramp) if (!own.has(rgba(c))) own.set(rgba(c), rgba(line));
  };
  const i = skinIndex(spec.skin);
  const ramp = FACE_SKIN[i];
  add([...ramp, stubbleTone(spec.skin, spec.hairColor), ...skinRouge(spec.skin)], ramp[0]);
  add(HAIR[spec.hairColor], HAIR[spec.hairColor][0]);
  add(HAIR.gray, HAIR.gray[0]);
  const common = commonLines();
  const fallback = rgba(OUTLINE);
  return (v) => own.get(v) ?? common.get(v) ?? fallback;
}

/** 给人物加 1 像素外轮廓（只描透明像素，结果仍是 64×64）；挨着的像素已经是描边色时不再加。 */
function outline(fig: Px, lineOf: (v: number) => number): Px {
  const out = new Px(S, S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      if (fig.isOpaque(x, y)) continue;
      // 优先取下方、再左右、最后上方的邻居（头顶的描边跟头发走，脸侧的描边跟皮肤走）
      for (const [dx, dy] of [
        [0, 1],
        [-1, 0],
        [1, 0],
        [0, -1],
      ] as const) {
        if (!fig.isOpaque(x + dx, y + dy)) continue;
        const v = fig.get(x + dx, y + dy);
        const line = lineOf(v);
        if (line !== v) out.put(x, y, line);
        break;
      }
    }
  }
  return out.blit(fig, 0, 0);
}

/**
 * 收拾零星叠出来的棋盘格（安全网，移植自精致 JRPG 方案）：两层 1 像素的光影（胡茬的上沿与法令纹、眼褶与刘海的影、
 * 布料的褶与卷边）在台阶处叠在一起时，会凑出一小块“a b a / b a b”的交替。找到这样的 3×2 或 2×3 交替，
 * 把中间下方的像素改成它左边的颜色，让它连成线。规则的抖动图案在源头就不画；一条 45° 斜线只会凑出 2×2，不受影响。
 */
function dedither(p: Px): void {
  for (let pass = 0; pass < 4; pass++) {
    let changed = false;
    for (let y = 0; y < S - 1; y++) {
      for (let x = 0; x < S - 1; x++) {
        const a = p.get(x, y);
        const b = p.get(x + 1, y);
        if (a === b || !(a & 0xff) || !(b & 0xff)) continue;
        if (p.get(x, y + 1) !== b || p.get(x + 1, y + 1) !== a) continue;
        const wide = p.get(x + 2, y) === a && p.get(x + 2, y + 1) === b;
        const tall = p.get(x, y + 2) === a && p.get(x + 1, y + 2) === b;
        if (!wide && !tall) continue;
        p.put(x + 1, y + 1, b);
        changed = true;
      }
    }
    if (!changed) break;
  }
}

/** 画一张 64×64 头像。 */
export function renderPortrait(spec: PortraitSpec): Px {
  const ramp = faceRamp(spec.skin);
  const rouge = skinRouge(spec.skin);
  const stubble = stubbleTone(spec.skin, spec.hairColor);
  const hat = hatDef(spec.hat);
  const hm = hairMasks(spec, hat?.clipY ?? 0, hat?.keepBack ?? true);
  const fig = new Px(S, S);

  // 1. 身后的长发、马尾、辫子；帽子的后层
  paintHairBack(fig, hm.back, spec);
  for (const [x0, x1, y0, y1, front] of braidBoxes(spec)) if (!front) braidTexture(fig, hm.back, spec, x0, x1, y0, y1);
  hat?.back?.(fig, spec);

  // 2. 颈（头模坐标，从下巴下方一直入画）
  const neckTM = new ToneMap();
  neckTones(neckTM, spec);
  const neckPx = new Px(S, S);
  neckTM.paint(neckPx, ramp, rouge);
  fig.blit(neckPx, 0, 0);

  // 3. 胸口与衣服（服饰坐标，整层下移 BODY_DY；领口处挖空露出皮肤与锁骨；群岛披布露出肩臂）
  const body = bodyMask(spec.female);
  const bodyTM = new ToneMap();
  if (bareArms(spec)) {
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        if (!body.isOpaque(x, y)) continue;
        const topEdge = !body.isOpaque(x, y - 1);
        bodyTM.set(x, y, x > 48 ? 2 : topEdge && x < 26 ? 4 : 3);
      }
    }
  }
  chestTones(bodyTM, spec);
  const torso = new Px(S, S);
  bodyTM.paint(torso, ramp, rouge);
  const cloth = new Px(S, S);
  drawOutfit({ p: cloth, spec, body });
  if (spec.cape) drawCape(cloth, spec);
  if (spec.sword) drawSwordBelt(cloth, spec);
  drawNecklace(cloth, spec);
  drawRoleProp(cloth, spec);
  // 胸口只露在领口里：身体轮廓以外的皮肤不要（颈根展开的三行除外）
  for (let y = 50; y < S; y++) for (let x = 0; x < S; x++) if (!body.isOpaque(x, y)) torso.set(x, y, null);
  torso.blit(cloth, 0, 0);
  fig.blit(torso, 0, BODY_DY);

  // 4. 头部皮肤：体积、鼻子、年龄痕迹、头发与帽檐投在额头的影子
  const tm = new ToneMap();
  headTones(tm, spec);
  noseTones(tm, spec);
  ageTones(tm, spec);
  for (const [x, y] of hm.fringe) tm.soft(x, y, 2);
  for (const y of hat?.shadeRows ?? []) for (let x = 20; x <= 46; x++) tm.soft(x, y, 2);
  // 胡茬只改皮肤色调（平涂的胡茬色），要在上色前完成
  if (spec.beard === "stubble") stubbleTones(tm, spec);
  const headPx = new Px(S, S);
  tm.paint(headPx, ramp, rouge, stubble);
  fig.blit(headPx, 0, 0);

  // 5. 五官
  drawEyes(fig, spec, ramp, spec.eyepatch);
  drawBrows(fig, spec);
  drawMouth(fig, spec, ramp);
  drawBeard(fig, spec);
  if (spec.scar) drawScar(fig, spec);

  // 6. 前层头发与发辫纹路
  const hairPx = new Px(S, S);
  paintHair(hairPx, hm, spec, { curls: spec.hair === "curly" || spec.hair === "curls" });
  for (const [x0, x1, y0, y1, front] of braidBoxes(spec)) if (front) braidTexture(hairPx, hm.front, spec, x0, x1, y0, y1);
  fig.blit(hairPx, 0, 0);
  drawHairTies(fig, spec, hm);
  cleanHairComposite(fig, hm, spec);

  // 7. 精灵尖耳：从头发里探出来（被兜帽、头纱、毛皮帽盖住时不画）
  if (spec.elf && !hat?.coversEars) drawElfEar(fig, spec);

  // 8. 帽子与头饰；不戴帽子（头巾、面纱、兜帽、发簪都算帽子）、不是光头时别上发饰
  hat?.front(fig, spec);
  if (!hat && spec.ornament !== "none" && spec.hair !== "bald") {
    // 发饰只压在露出来的头发上（后层被脸、衣服挡住的地方不算）
    const hairTones = new Set([...HAIR[spec.hairColor], ...HAIR.gray].map((c) => rgba(c)));
    drawOrnament(fig, spec, (x, y) => (hm.front.isOpaque(x, y) || hm.back.isOpaque(x, y)) && hairTones.has(fig.get(x, y)));
  }

  // 9. 脸上的饰物
  if (spec.eyepatch) drawEyepatch(fig);
  if (spec.glasses) drawGlasses(fig, spec.role === "bank" || spec.role === "guild");
  // 耳环只在耳朵露出来时画（长发、护耳、兜帽会盖住耳朵）
  const earShown = !hm.front.isOpaque(HEAD.earX + 2, HEAD.earY + 7) && !hat?.coversEars;
  if (spec.earring && earShown) drawEarring(fig, spec.region === "desert" || spec.region === "islands");
  if (spec.pipe) drawPipe(fig, spec);

  // 10. 安全网：收拾两层光影偶然叠出的棋盘格
  dedither(fig);

  // 描边之后再收拾一遍（大耳环的环洞、发梢的缝隙描上边以后也可能凑出交替）
  const lined = outline(fig, linesFor(spec));
  dedither(lined);
  // 描上外轮廓以后，头发边缘可能又剩下被轮廓围住的单格，最后再收拾一遍
  cleanHairComposite(lined, hm, spec);
  return background(spec.role).blit(lined, 0, 0);
}
