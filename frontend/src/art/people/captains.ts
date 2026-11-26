// 主角的 24 种外貌（编号为奇数的是女性、偶数的是男性）。每个都是手工挑选的部件组合：
// 脸型、眼型、眉形、鼻子、嘴与刘海两两搭配不同（五种脸型、七种眼型、六种刘海都用上），
// 船长大衣、三角帽 / 羽饰帽 / 船长帽 / 发冠 / 缠头 / 毛皮帽（不戴帽的两位别着宝石发夹、细金头冠）、佩剑带，各带一种文化风味，
// 一眼能分出彼此，而且都要好看、有船长的气质（其中一位带精灵血统）。
// 编号 0–11 是第一批的 12 种；12 号夹在中间、空缺（不在这里）；
// 13–24 是英雄扩充的 12 种（2026-09-27）：界面默认显示 AI 生成的肖像，这里的程序头像是缺图时的回退，
// 按人物概念取发型、帽饰、肤色与个人配色，任意两位（24 位之间）仍至少有 4 项五官或发型不同。
import type { PortraitSpec } from "./spec";

export type CaptainLook = Partial<Omit<PortraitSpec, "seed" | "role" | "female">>;

const BASE: CaptainLook = {
  outfit: "captain",
  glasses: false,
  earring: false,
  eyepatch: false,
  scar: false,
  pipe: false,
  necklace: "none",
  ornament: "none",
  cape: false,
  sword: true,
  region: null,
  elf: false,
};

const LOOKS: readonly CaptainLook[] = [
  // 0 男：年轻的船长——鹅蛋脸、剑眉、琥珀褐的杏眼、挺直的鼻梁、带着笑；栗色侧分短发；黑色金边三角帽、藏青大衣
  { age: 0, skin: 1, face: "oval", eyes: "almond", eyeColor: 1, brows: "sword", nose: "straight", mouth: "smile", beard: "none", hair: "side", bangs: "side", hairColor: "brown", grizzle: 0, hat: "tricorn", hatColor: "black", main: "navy", accent: "gold" },
  // 1 女：地中海的红发女船长——瓜子脸、翠绿圆眼、柳叶挑眉、小翘鼻、丰唇；中分波浪长发；酒红羽饰宽檐帽与酒红大衣，金耳环
  { age: 0, skin: 0, face: "heart", eyes: "round", eyeColor: 3, brows: "arched", nose: "button", mouth: "lips", beard: "none", hair: "wavy", bangs: "center", hairColor: "auburn", grizzle: 0, hat: "plumed", hatColor: "crimson", main: "crimson", accent: "gold", earring: true, region: "mediterranean" },
  // 2 男：沉稳的水手长——方脸、细长眼、浓眉、宽鼻、抿着嘴；修整的黑色短须、鬓角花白、后梳短发；硬檐船长帽、黑大衣
  { age: 1, skin: 3, face: "square", eyes: "narrow", eyeColor: 0, brows: "thick", nose: "broad", mouth: "frown", beard: "trim", hair: "crop", bangs: "none", hairColor: "black", grizzle: 1, hat: "cap", hatColor: "black", main: "black", accent: "gold" },
  // 3 女：独行的剑客——古铜肤色、鹅蛋脸、琥珀金的上挑眼、平眉、歪嘴一笑、脸上一道疤；黑色高马尾配斜刘海、鬓边一枚宝石发夹；藏青大衣配酒红披风
  { age: 0, skin: 2, face: "oval", eyes: "sharp", eyeColor: 5, brows: "straight", nose: "small", mouth: "smirk", beard: "none", hair: "ponytail", bangs: "swept", hairColor: "black", grizzle: 0, hat: "none", hatColor: "navy", main: "navy", accent: "crimson", cape: true, scar: true, ornament: "clip" },
  // 4 男：低地的贵公子——长脸、温柔的下垂眼、平眉、挺直的鼻梁、山羊胡；金色中分束发；藏青三角帽、宝蓝大衣
  { age: 0, skin: 0, face: "long", eyes: "droopy", eyeColor: 2, brows: "straight", nose: "straight", mouth: "smirk", beard: "goatee", hair: "tied", bangs: "center", hairColor: "blond", grizzle: 0, hat: "tricorn", hatColor: "navy", main: "blue", accent: "gold", region: "lowland" },
  // 5 女：精灵血统的领航者——瓜子脸、紫色杏眼、细眉、小巧的鼻子、浅浅的笑、尖耳；银色齐刘海长直发、额前一圈细金头冠；碧青大衣、翠玉吊坠
  { age: 0, skin: 0, face: "heart", eyes: "almond", eyeColor: 6, brows: "thin", nose: "small", mouth: "smile", beard: "none", hair: "straight", bangs: "blunt", hairColor: "silver", grizzle: 0, hat: "none", hatColor: "teal", main: "teal", accent: "gold", necklace: "pendant", ornament: "circlet", elf: true },
  // 6 男：老练的海狼——方脸、光头、上挑眼、粗乱眉、宽鼻、咧嘴大笑；赤褐大胡子、眼罩、金耳环；酒红大衣
  { age: 1, skin: 1, face: "square", eyes: "sharp", eyeColor: 5, brows: "bushy", nose: "broad", mouth: "grin", beard: "full", hair: "bald", bangs: "none", hairColor: "auburn", grizzle: 0, hat: "none", hatColor: "black", main: "crimson", accent: "gold", eyepatch: true, earring: true },
  // 7 女：深肤色的女船长——圆脸、琥珀下垂眼、柳叶挑眉、小翘鼻、微笑；棕色中分长卷发；黑色三角帽、黑大衣、金项链
  { age: 0, skin: 4, face: "round", eyes: "droopy", eyeColor: 5, brows: "arched", nose: "button", mouth: "smile", beard: "none", hair: "curls", bangs: "center", hairColor: "dark", grizzle: 0, hat: "tricorn", hatColor: "black", main: "black", accent: "gold", necklace: "gold" },
  // 8 男：瑶华的舰长——长脸、单眼皮、剑眉、挺直的鼻梁、平静的嘴、修整的八字胡；黑发后梳束髻戴金冠；玉绿大衣、酒红披风
  { age: 1, skin: 1, face: "long", eyes: "mono", eyeColor: 0, brows: "sword", nose: "straight", mouth: "line", beard: "mustache", hair: "topknot", bangs: "none", hairColor: "black", grizzle: 0, hat: "crown", hatColor: "jade", main: "jade", accent: "gold", cape: true, region: "eastern" },
  // 9 女：北地的女船长——圆脸、蓝色圆眼、细眉、小翘鼻、露齿笑；金色双辫配碎发刘海；白狐毛皮帽、石板蓝大衣
  { age: 0, skin: 0, face: "round", eyes: "round", eyeColor: 2, brows: "thin", nose: "button", mouth: "grin", beard: "none", hair: "braids", bangs: "wispy", hairColor: "blond", grizzle: 0, hat: "fur", hatColor: "white", main: "slate", accent: "gold", region: "nordic" },
  // 10 男：沙漠商路的船长——鹅蛋脸、慵懒的厚眼睑、浓眉、鹰钩鼻、微笑；白色缠头、连鬓胡、金耳环；紫色大衣
  { age: 1, skin: 3, face: "oval", eyes: "sleepy", eyeColor: 5, brows: "thick", nose: "hooked", mouth: "smile", beard: "chops", hair: "curly", bangs: "curly", hairColor: "black", grizzle: 0, hat: "turban", hatColor: "white", main: "purple", accent: "gold", earring: true, region: "desert" },
  // 11 女：群岛的女船长——长脸、琥珀色杏眼、柳叶挑眉、小巧的鼻子、丰唇；侧分侧编辫、鬓边红花、花环；碧青大衣
  { age: 0, skin: 3, face: "long", eyes: "almond", eyeColor: 1, brows: "arched", nose: "small", mouth: "lips", beard: "none", hair: "sidebraid", bangs: "side", hairColor: "black", grizzle: 0, hat: "flower", hatColor: "coral", main: "teal", accent: "gold", necklace: "lei", region: "islands" },
];

// 英雄扩充的 12 种（编号 13–24）。人物概念（完整的设计要点见 art-src/portraits.json 的 captain-13…24）：
const MORE_LOOKS: readonly CaptainLook[] = [
  // 13 女：瑶华的追风船长——长脸、上挑的凤眼、浓眉、无所畏惧的大笑；黑色高马尾系红绳、几缕湿发贴在脸颊；朱红大衣、草金衬里、肩披蓑衣
  { age: 0, skin: 1, face: "long", eyes: "sharp", eyeColor: 0, brows: "thick", nose: "straight", mouth: "grin", beard: "none", hair: "ponytail", bangs: "wispy", hairColor: "black", grizzle: 0, hat: "none", hatColor: "crimson", main: "crimson", accent: "straw", cape: true, ornament: "tie", region: "eastern" },
  // 14 男：生在新大陆的斥候船长——方脸、眯着的榛色眼、压眉、断过的宽鼻梁、歪嘴半笑、几天没刮的胡茬；蓬乱深棕发；软宽檐帽、鹿皮黄大衣、森林绿披风
  { age: 0, skin: 2, face: "square", eyes: "narrow", eyeColor: 1, brows: "stern", nose: "broad", mouth: "smirk", beard: "stubble", hair: "messy", bangs: "swept", hairColor: "dark", grizzle: 0, hat: "slouch", hatColor: "brown", main: "ochre", accent: "green", cape: true, region: "frontier" },
  // 15 女：交易所最年轻的经纪人——瓜子脸、清澈的绿色圆眼、挑眉、小巧的鼻子、犀利的笑；草莓金发收在宽翼白亚麻帽里；黑大衣、赤褐衬里
  { age: 0, skin: 0, face: "heart", eyes: "round", eyeColor: 3, brows: "arched", nose: "small", mouth: "smirk", beard: "none", hair: "bob", bangs: "swept", hairColor: "auburn", grizzle: 0, hat: "lacecap", hatColor: "white", main: "black", accent: "brick", region: "lowland" },
  // 16 男：爱笑的巨人领航酋长——深棕肤色、圆脸、亮黑的圆眼、浓眉、宽鼻、雪白的大笑、短而浓的黑胡；长卷发束成顶髻；深靛大衣、奶白衬里、贝壳吊坠
  { age: 1, skin: 3, face: "round", eyes: "round", eyeColor: 0, brows: "thick", nose: "broad", mouth: "grin", beard: "trim", hair: "topknot", bangs: "none", hairColor: "black", grizzle: 0, hat: "none", hatColor: "navy", main: "navy", accent: "cream", necklace: "shell", region: "islands" },
  // 17 女：南岸的蒙面女海盗——暖橄榄棕肤色、鹅蛋脸、描黑眼线的榛色杏眼、挑眉、直鼻、狡黠的抿嘴笑；深色短发藏在午夜蓝兜帽下；午夜蓝大衣、沙色衬里、金耳饰
  { age: 0, skin: 2, face: "oval", eyes: "almond", eyeColor: 1, brows: "arched", nose: "straight", mouth: "smirk", beard: "none", hair: "pixie", bangs: "swept", hairColor: "dark", grizzle: 0, hat: "hood", hatColor: "navy", main: "navy", accent: "sand", earring: true, region: "desert" },
  // 18 男（美少年型）：弃了科举去航海的书生——白皙、瓜子脸、长睫凤眼、细长眉、秀挺的鼻梁、促狭一笑、不留须；黑长发半束、插白玉簪；淡紫大衣、朱红衬里
  { age: 0, skin: 0, face: "heart", eyes: "sharp", eyeColor: 0, brows: "thin", nose: "straight", mouth: "smirk", beard: "none", hair: "tied", bangs: "side", hairColor: "black", grizzle: 0, hat: "hairpin", hatColor: "white", main: "purple", accent: "crimson", region: "eastern" },
  // 19 女：可可海岸的走私船长——暖古铜肤色、圆脸、棕色圆眼、平眉、小巧的鼻子、大嘴露齿笑；蜜棕色蓬乱波浪长发；宽草帽、橄榄绿大衣、猩红衬里
  { age: 0, skin: 2, face: "round", eyes: "round", eyeColor: 1, brows: "straight", nose: "small", mouth: "grin", beard: "none", hair: "wavy", bangs: "swept", hairColor: "brown", grizzle: 0, hat: "straw", hatColor: "straw", main: "green", accent: "crimson", region: "frontier" },
  // 20 男：沉默的冰海领航人——白皙、清癯的长脸、锐利的浅灰细长眼、压眉、直鼻、不笑、修短的深色胡；齐肩黑发、鬓边细辫；炭灰大衣、深松绿衬里、厚斗篷
  { age: 1, skin: 0, face: "long", eyes: "narrow", eyeColor: 4, brows: "stern", nose: "straight", mouth: "line", beard: "trim", hair: "braid", bangs: "center", hairColor: "black", grizzle: 0, hat: "none", hatColor: "slate", main: "slate", accent: "green", cape: true, region: "nordic" },
  // 21 女：守寡的女海军统帅——浅橄榄肤色、鹅蛋脸、锐利的黑色细长眼、压眉、挺直的鹰钩鼻、淡淡的讽刺笑；严整的低髻、鬓边一道白发、珍珠发饰；黑大衣、深梅紫衬里、金链
  { age: 1, skin: 1, face: "oval", eyes: "narrow", eyeColor: 0, brows: "stern", nose: "hooked", mouth: "smirk", beard: "none", hair: "bun", bangs: "center", hairColor: "black", grizzle: 1, hat: "none", hatColor: "black", main: "black", accent: "purple", necklace: "gold", ornament: "pearls", region: "mediterranean" },
  // 22 男：南岸的绘图王子——深黑肤色、清瘦的长脸、沉静的慵懒眼、平眉、宽鼻、平静的嘴、修整的短须；奶白头巾；深靛大衣、赤陶衬里、琥珀珠串
  { age: 1, skin: 4, face: "long", eyes: "sleepy", eyeColor: 0, brows: "straight", nose: "broad", mouth: "line", beard: "trim", hair: "slick", bangs: "none", hairColor: "black", grizzle: 0, hat: "turban", hatColor: "cream", main: "navy", accent: "brick", necklace: "beads", region: "desert" },
  // 23 女：宝船队退下来的老领航——浅肤色、柔和的鹅蛋脸、温和的下垂眼、细眉、小巧的鼻子、温和的笑；乌发夹着银丝、低挽雅髻插银簪；石板藏青大衣、胡桃褐衬里
  { age: 1, skin: 1, face: "oval", eyes: "droopy", eyeColor: 0, brows: "thin", nose: "small", mouth: "smile", beard: "none", hair: "updo", bangs: "center", hairColor: "black", grizzle: 2, hat: "none", hatColor: "navy", main: "navy", accent: "brown", region: "eastern" },
  // 24 男：赌徒私掠船长——橄榄肤色、俊俏的瓜子脸、狡黠的慵懒眼、挑眉、直鼻、歪嘴笑、细卷八字胡、银耳环；乌黑及颌长发；插羽的宽帽、芥黄大衣、锈红衬里
  { age: 0, skin: 1, face: "heart", eyes: "sleepy", eyeColor: 0, brows: "arched", nose: "straight", mouth: "smirk", beard: "mustache", hair: "long", bangs: "wispy", hairColor: "black", grizzle: 0, hat: "plumed", hatColor: "black", main: "ochre", accent: "brick", earring: true, region: "mediterranean" },
];

/** 普通外貌的编号，按开局界面的排列顺序：第一批 0–11，跳过空缺的 12，接着英雄扩充的 13–24。 */
export const CAPTAIN_LOOK_IDS: readonly number[] = [...LOOKS.map((_, i) => i), ...MORE_LOOKS.map((_, i) => LOOKS.length + 1 + i)];

/** 与 CAPTAIN_LOOK_IDS 一一对应的外貌参数。 */
export const CAPTAIN_LOOKS: readonly CaptainLook[] = [...LOOKS, ...MORE_LOOKS].map((l) => ({ ...BASE, ...l }));
