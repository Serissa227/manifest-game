// 人物用色：皮肤、头发、眼睛、衣料的色阶。全部取自共享调色板（palette.ts），不另造颜色。
// 色阶一律由暗到亮：下标 0 最暗（描边、深影），末位最亮（高光）。
import { P, ink } from "../palette";

/** 皮肤色阶：[深影, 暗面, 基色, 受光面]。 */
export type SkinRamp = readonly [string, string, string, string];

/** 肤色从浅到深共 5 档（下标即 PortraitSpec.skin）。 */
export const SKIN_TONES: readonly SkinRamp[] = [
  [P.skin[1], P.skin[2], P.skin[3], P.skin[4]], // 0 白皙
  [P.skin[0], P.skin[1], P.skin[2], P.skin[3]], // 1 小麦
  [P.skinDark[1], P.skinDark[2], P.skinDark[3], P.skinDark[4]], // 2 古铜
  [P.skinDark[0], P.skinDark[1], P.skinDark[2], P.skinDark[3]], // 3 棕褐
  [ink.brown, P.skinDark[0], P.skinDark[1], P.skinDark[2]], // 4 深褐
];

/** 皮肤的轮廓色（脸的外缘、下颌线），比深影再暗一阶，让脸与背景、头发分开而不显得生硬。 */
export const SKIN_EDGE: readonly string[] = [P.skin[0], ink.brown, P.skinDark[0], ink.brown, ink.deep];

/** 腮红与嘴唇：[腮红, 唇（深）, 唇（浅）, 唇高光]。 */
export const SKIN_ROUGE: readonly (readonly [string, string, string, string])[] = [
  [P.red[4], P.red[2], P.red[3], P.red[4]],
  [P.red[4], P.red[1], P.brick[3], P.red[4]],
  [P.brick[3], P.red[1], P.brick[2], P.brick[3]],
  [P.brick[2], P.red[0], P.brick[1], P.brick[2]],
  [P.brick[1], P.red[0], P.brick[1], P.brick[2]],
];

/**
 * 女性嘴唇四阶：[唇缝, 上唇（背光、较深）, 下唇（受光、较浅）, 下唇高光]。
 * 浅肤色偏粉、深肤色偏砖红与酒红，都取自共享调色板。
 */
export const LIP_TONES: readonly (readonly [string, string, string, string])[] = [
  [P.red[1], P.blossom[0], P.blossom[1], P.blossom[2]],
  [P.red[1], P.brick[2], P.blossom[1], P.blossom[2]],
  [P.red[0], P.brick[1], P.brick[2], P.brick[3]],
  [P.red[0], P.brick[0], P.brick[1], P.brick[2]],
  [ink.deep, P.red[0], P.brick[0], P.brick[1]],
];

export function skinRamp(skin: number): SkinRamp {
  return SKIN_TONES[Math.max(0, Math.min(SKIN_TONES.length - 1, Math.trunc(skin)))];
}

/**
 * 头像（动画赛璐璐画法）的皮肤五阶：[描边, 深影, 赛璐璐暗面, 基色, 高光]。
 * 深肤色（古铜、棕褐、深褐）的深影、暗面、基色与行人的 SKIN_TONES 完全相同，只多出一阶高光（受光面的一两格），
 * 描边取 SKIN_EDGE（深褐用暖色近黑）——肤色的深浅与街上的行人一致，族裔一眼可辨；
 * 只有白皙、小麦两档用偏粉的暗面与更亮的基色（动画式的通透感），小麦的基色介于行人的 skin[2] 与 skin[3] 之间，
 * 五档之间的间距与行人相当。深影（第 1 阶）只用于鼻孔、嘴角与年龄纹路，小麦肤色的深影与 skinRamp(1)[1] 相同。
 */
export type FaceRamp = readonly [string, string, string, string, string];
const FS = P.faceSkin;
export const FACE_SKIN: readonly FaceRamp[] = [
  [FS.fair[0], FS.fair[1], FS.fair[2], P.skin[4], FS.fair[3]], // 0 白皙
  [P.skin[0], P.skin[1], FS.wheat[0], FS.wheat[1], P.skin[3]], // 1 小麦
  [SKIN_EDGE[2], P.skinDark[1], P.skinDark[2], P.skinDark[3], P.skinDark[4]], // 2 古铜（基色 #c7875e）
  [SKIN_EDGE[3], P.skinDark[0], P.skinDark[1], P.skinDark[2], P.skinDark[3]], // 3 棕褐（基色 #9a5e3e）
  [ink.brown, ink.brown, P.skinDark[0], P.skinDark[1], P.skinDark[2]], // 4 深褐（基色 #6e3e28；描边用暖色的近黑，不用唇缝的紫黑）
];

/**
 * 头像腮红：[腮红, 腮红边缘（更深一点，只在大块腮红的下沿）]。
 * 深肤色（古铜、棕褐、深褐）的腮红与皮肤基色同明度、只把色相往红偏——不比基色暗，不会读成淤青或黑眼圈。
 */
export const FACE_ROUGE: readonly (readonly [string, string])[] = [
  [FS.rouge[0], P.red[4]],
  [P.red[4], FS.rouge[1]],
  [FS.rougeDeep[0], FS.rougeDeep[0]],
  [FS.rougeDeep[1], FS.rougeDeep[1]],
  [FS.rougeDeep[2], FS.rougeDeep[2]],
];

/**
 * 胡茬色（深色头发），下标是肤色档位：色相取皮肤暗面、往发色暗阶混约三成，饱和度不降（不是灰米色的“石膏”）；
 * 白皙、小麦、古铜的明度介于基色与暗面之间，比基色低 15% 以上；棕褐、深褐比暗面再冷、再暗半阶，不和暗面混在一起。
 */
export const STUBBLE: readonly string[] = FS.stubble;
/** 红发的胡茬色（古铜以下偏红）。 */
export const STUBBLE_RED: readonly string[] = FS.stubbleRed;

/** 某人的胡茬色：红发偏红；金发、白发、灰发、银发在浅肤色上直接用皮肤暗面（深肤色仍用冷一阶的胡茬色）。 */
export function stubbleTone(skin: number, hairColor: HairColor): string {
  const i = skinIndex(skin);
  if (hairColor === "auburn") return STUBBLE_RED[i];
  const pale = hairColor === "blond" || hairColor === "white" || hairColor === "gray" || hairColor === "silver";
  if (pale && i <= 2) return FACE_SKIN[i][2];
  return STUBBLE[i];
}

/** 眼白：[上沿的睫毛投影, 眼白]，偏冷，让纯白的高光跳出来。 */
export const SCLERA: readonly [string, string] = [FS.sclera[0], FS.sclera[1]];

export function faceRamp(skin: number): FaceRamp {
  return FACE_SKIN[skinIndex(skin)];
}

export function skinIndex(skin: number): number {
  return Math.max(0, Math.min(SKIN_TONES.length - 1, Math.trunc(skin)));
}

/** 发色 key（前七种与 P.hair 对应；silver 为精灵常见的银灰发）。 */
export type HairColor = keyof typeof P.hair | "silver";
export const HAIR_COLORS: readonly HairColor[] = ["black", "dark", "brown", "auburn", "blond", "gray", "white", "silver"];

/**
 * 头发五阶：[描边, 暗, 基, 亮, 光泽]。光泽一阶只用在头顶的一圈高光（“天使环”）上，
 * 黑发的光泽偏蓝、金发偏白、红发偏橙，让头发有丝缎感。
 */
export const HAIR: Readonly<Record<HairColor, readonly [string, string, string, string, string]>> = {
  black: [P.hair.black[0], P.hair.black[1], P.hair.black[2], P.cloth.black[2], P.slate[2]],
  dark: [P.hair.dark[0], P.hair.dark[1], P.hair.dark[2], P.wood[2], P.wood[3]],
  brown: [ink.brown, P.hair.brown[0], P.hair.brown[1], P.hair.brown[2], P.wood[4]],
  auburn: [ink.brown, P.hair.auburn[0], P.hair.auburn[1], P.hair.auburn[2], P.autumn[2]],
  blond: [P.gold[0], P.hair.blond[0], P.hair.blond[1], P.hair.blond[2], P.gold[4]],
  gray: [P.iron[1], P.hair.gray[0], P.hair.gray[1], P.hair.gray[2], P.stone[4]],
  white: [P.stone[1], P.hair.white[0], P.hair.white[1], P.white, P.snow[3]],
  silver: [P.stone[0], P.stone[1], P.stone[2], P.stone[3], P.stone[4]],
};

/** 三阶发色 [暗, 基, 亮]（行人、眉毛、胡须用）。 */
export function hair3(c: HairColor): readonly [string, string, string] {
  const h = HAIR[c];
  return [h[1], h[2], h[3]];
}

/** 三阶色：[暗, 基, 亮]。 */
export type Ramp3 = readonly [string, string, string];

/** 衣料色 key：前九种来自 P.cloth，其余由材质色阶截取三阶。 */
export type ClothColor =
  | keyof typeof P.cloth
  | "teal"
  | "jade"
  | "red"
  | "gold"
  | "slate"
  | "sand"
  | "brick"
  | "leather"
  | "coral"
  | "straw"
  | "white"
  | "iron";

const three = (r: readonly string[], a: number): Ramp3 => [r[a], r[a + 1], r[a + 2]];

export const CLOTH: Readonly<Record<ClothColor, Ramp3>> = {
  navy: P.cloth.navy,
  blue: P.cloth.blue,
  purple: P.cloth.purple,
  crimson: P.cloth.crimson,
  green: P.cloth.green,
  ochre: P.cloth.ochre,
  cream: P.cloth.cream,
  black: P.cloth.black,
  brown: P.cloth.brown,
  teal: three(P.teal, 1),
  jade: three(P.jade, 1),
  red: three(P.red, 1),
  gold: three(P.gold, 1),
  slate: three(P.slate, 1),
  sand: three(P.sand, 2),
  brick: three(P.brick, 1),
  leather: three(P.wood, 1),
  coral: [P.blossom[0], P.blossom[1], P.blossom[2]],
  straw: three(P.straw, 1),
  white: [P.plaster[2], P.plaster[3], P.white],
  iron: three(P.iron, 1),
};

/** 衣料最深的一阶（深褶、衣摆下的投影），比三阶的暗面再暗一些。 */
export const CLOTH_DEEP: Readonly<Record<ClothColor, string>> = {
  navy: P.night[1],
  blue: P.cloth.navy[0],
  purple: ink.deep,
  crimson: P.red[0],
  green: P.leaf[0],
  ochre: P.gold[0],
  cream: P.plaster[0],
  black: ink.deep,
  brown: P.wood[0],
  teal: P.teal[0],
  jade: P.jade[0],
  red: P.red[0],
  gold: P.gold[0],
  slate: P.slate[0],
  sand: P.sand[1],
  brick: P.brick[0],
  leather: P.wood[0],
  coral: P.red[1],
  straw: P.straw[0],
  white: P.plaster[1],
  iron: P.iron[0],
};

/** 眼睛（虹膜）三阶：[上方阴影, 基, 下方反光]。下标即 PortraitSpec.eyeColor。 */
export const EYE_RAMPS: readonly (readonly [string, string, string])[] = [
  [P.hair.dark[0], P.hair.dark[2], P.wood[2]], // 0 深褐
  [P.wood[0], P.wood[2], P.wood[3]], // 1 琥珀褐
  [P.cloth.navy[1], P.cloth.blue[1], P.sky[2]], // 2 蓝
  [P.jade[0], P.jade[2], P.jade[3]], // 3 绿
  [P.slate[0], P.slate[2], P.slate[3]], // 4 灰蓝
  [P.gold[0], P.gold[1], P.gold[2]], // 5 琥珀金
  [P.cloth.purple[0], P.cloth.purple[1], P.cloth.purple[2]], // 6 紫（精灵）
  [P.teal[0], P.teal[2], P.teal[3]], // 7 碧青（精灵、群岛）
];

/**
 * 动画式虹膜四阶：[最深（贴着上睫毛的一带）, 暗, 基, 下沿的亮光]，上暗下亮。下标与 EYE_RAMPS 相同。
 * 另配一个瞳孔色：暗色眼睛用近黑，浅色眼睛用该色系最深的一阶，免得瞳孔像个黑洞。
 */
export const EYE_IRIS: readonly (readonly [string, string, string, string])[] = [
  [P.hair.dark[0], P.hair.dark[1], P.hair.dark[2], P.wood[2]], // 0 深褐
  [P.wood[0], P.wood[1], P.wood[2], P.wood[3]], // 1 琥珀褐
  [P.cloth.navy[0], P.cloth.navy[2], P.cloth.blue[1], P.sky[2]], // 2 蓝
  [P.jade[0], P.jade[1], P.jade[2], P.jade[3]], // 3 绿
  [P.slate[0], P.slate[1], P.slate[2], P.slate[3]], // 4 灰蓝
  [P.gold[0], P.gold[1], P.gold[2], P.gold[3]], // 5 琥珀金
  [P.cloth.purple[0], P.cloth.purple[1], P.cloth.purple[2], P.stone[3]], // 6 紫（精灵）
  [P.teal[0], P.teal[1], P.teal[2], P.teal[3]], // 7 碧青（精灵、群岛）
];

export function eyeIris(i: number): readonly [string, string, string, string] {
  return EYE_IRIS[eyeIndex(i)];
}

function eyeIndex(i: number): number {
  return ((Math.trunc(i) % EYE_IRIS.length) + EYE_IRIS.length) % EYE_IRIS.length;
}

/**
 * 瞳孔色：比虹膜最深一阶更暗的同色系近黑（琥珀眼用深褐、蓝眼与灰蓝眼用夜蓝、紫眼用深紫），
 * 瞳孔永远是虹膜里最暗的两格——琥珀、金色的浅眼睛也读得出瞳孔。下标与 EYE_IRIS 相同。
 */
export const EYE_PUPIL: readonly string[] = [
  P.hair.black[0], // 0 深褐
  P.hair.black[0], // 1 琥珀褐
  P.night[0], // 2 蓝
  P.night[0], // 3 绿
  P.night[0], // 4 灰蓝
  ink.brown, // 5 琥珀金
  ink.deep, // 6 紫
  P.night[0], // 7 碧青
];

export function eyePupil(i: number): string {
  return EYE_PUPIL[eyeIndex(i)];
}

/** 眼睛颜色（虹膜基色，兼容旧接口）。 */
export const EYE_COLORS: readonly string[] = EYE_RAMPS.map((r) => r[1]);

export function eyeRamp(i: number): readonly [string, string, string] {
  return EYE_RAMPS[((Math.trunc(i) % EYE_RAMPS.length) + EYE_RAMPS.length) % EYE_RAMPS.length];
}

/** 金属与小饰物。 */
export const METAL = {
  gold: [P.gold[1], P.gold[2], P.gold[3], P.gold[4]] as const,
  silver: [P.iron[1], P.iron[2], P.iron[3], P.stone[4]] as const,
  iron: [P.iron[0], P.iron[1], P.iron[2], P.iron[3]] as const,
};

/** 描边：人物外轮廓。 */
export const OUTLINE = ink.deep;
