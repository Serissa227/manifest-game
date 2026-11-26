// 头像参数：身份、文化与各部件的选择。由种子确定性生成（rng.ts），同一个种子永远得到同一张脸。
// 文化即建筑风格（ArchStyle）：地中海、北地、低地、沙漠、群岛、东方、开拓者殖民地，各有服饰、肤色与发色的分布。
import type { Facility } from "../../store/game";
import type { ArchStyle } from "../buildings";
import { hash32, rng, type Rng } from "../rng";
import type { ClothColor, HairColor } from "./tones";

/** 人物身份：决定服饰与背景色。设施名表示该设施的掌柜 / 职员。 */
export type NpcRole = Facility | "mate" | "captain" | "pirate" | "sailor" | "townsfolk";

export const NPC_ROLES: readonly NpcRole[] = [
  "market",
  "shipyard",
  "tavern",
  "guild",
  "bank",
  "exchange",
  "warehouse",
  "invest",
  "office",
  "mate",
  "captain",
  "pirate",
  "sailor",
  "townsfolk",
];

/** 年龄段：0 青年 1 中年 2 老年。 */
export type Age = 0 | 1 | 2;

/** 脸型：鹅蛋、方、圆、长、瓜子。轮廓与下巴、颧骨的明暗都随脸型变化（见 head.ts）。 */
export type FaceShape = "oval" | "square" | "round" | "long" | "heart";
export const FACE_SHAPES: readonly FaceShape[] = ["oval", "square", "round", "long", "heart"];

/**
 * 眼型（都带高光）：圆眼、杏眼、细长眼、下垂眼、上挑眼（凤眼）、慵懒眼（厚眼睑）、单眼皮 / 内双。
 * 每种眼型男女各有一套像素造型（见 face.ts）。
 */
export type EyeStyle = "round" | "almond" | "narrow" | "droopy" | "sharp" | "sleepy" | "mono";
export const EYE_STYLES: readonly EyeStyle[] = ["round", "almond", "narrow", "droopy", "sharp", "sleepy", "mono"];

/** 眉形：细眉、浓眉、挑眉、压眉、粗乱眉、平眉、剑眉。 */
export type BrowStyle = "thin" | "thick" | "arched" | "stern" | "bushy" | "straight" | "sword";
export const BROW_STYLES: readonly BrowStyle[] = ["thin", "thick", "arched", "stern", "bushy", "straight", "sword"];

/** 鼻子：小巧、挺直、鹰钩、宽鼻、小翘鼻。 */
export type NoseStyle = "small" | "straight" | "hooked" | "broad" | "button";
export const NOSE_STYLES: readonly NoseStyle[] = ["small", "straight", "hooked", "broad", "button"];

/** 嘴：中性、微笑、歪嘴笑、抿嘴、露齿笑、丰唇。 */
export type MouthStyle = "line" | "smile" | "smirk" | "frown" | "grin" | "lips";
export const MOUTH_STYLES: readonly MouthStyle[] = ["line", "smile", "smirk", "frown", "grin", "lips"];

/** 胡须：none 为不留胡子；trim 为沿下颌修整的短须。 */
export type BeardStyle = "none" | "stubble" | "mustache" | "goatee" | "full" | "long" | "chops" | "trim";
export const BEARD_STYLES: readonly BeardStyle[] = ["none", "stubble", "mustache", "goatee", "full", "long", "chops", "trim"];

/**
 * 刘海：齐刘海、中分、侧分（发缝在近侧，发束扫向远侧额角）、斜刘海（从远侧斜盖过近侧眉梢）、
 * 无刘海后梳、碎发、卷发刘海。与发型独立选择；某种发型不适合时画成该发型允许的第一种（见 hair.ts bangsFor）。
 */
export type BangStyle = "blunt" | "center" | "side" | "swept" | "none" | "wispy" | "curly";
export const BANG_STYLES: readonly BangStyle[] = ["blunt", "center", "side", "swept", "none", "wispy", "curly"];

/** 白发比例：0 无，1 鬓角花白，2 花白夹杂（整绺发束变白）。发色本身是灰或白时不再叠加。 */
export type Grizzle = 0 | 1 | 2;

/** 发型。 */
export type HairStyle =
  // 男式
  | "bald" // 光头
  | "crop" // 短寸
  | "side" // 侧分
  | "messy" // 蓬乱短发
  | "tied" // 束发（脑后扎低马尾）
  | "topknot" // 头顶发髻
  | "curly" // 卷发
  | "long" // 披肩长发
  | "slick" // 向后梳
  | "braid" // 脑后长辫
  // 女式
  | "straight" // 直长发
  | "ponytail" // 高马尾
  | "bun" // 脑后发髻
  | "braids" // 双辫
  | "bob" // 齐耳短发
  | "curls" // 长卷发
  | "sidebraid" // 侧编辫
  | "updo" // 盘发插簪
  | "pixie" // 极短发
  | "twinbuns" // 双髻
  | "wavy" // 波浪长发（地中海）
  | "crownbraid"; // 盘在头顶的辫冠（北地）

export const MALE_HAIR: readonly HairStyle[] = ["bald", "crop", "side", "messy", "tied", "topknot", "curly", "long", "slick", "braid"];
export const FEMALE_HAIR: readonly HairStyle[] = [
  "straight",
  "ponytail",
  "bun",
  "braids",
  "bob",
  "curls",
  "sidebraid",
  "updo",
  "pixie",
  "twinbuns",
  "wavy",
  "crownbraid",
];

/** 各发型允许的刘海（第一种为缺省）：短寸不留齐刘海、后梳与光头没有刘海、卷发配卷发刘海…… */
export const HAIR_BANGS: Readonly<Record<HairStyle, readonly BangStyle[]>> = {
  bald: ["none"],
  crop: ["wispy", "none", "side", "center"],
  side: ["side", "swept"],
  messy: ["wispy", "swept", "side"],
  tied: ["none", "center", "side"],
  topknot: ["none", "center"],
  curly: ["curly"],
  long: ["center", "side", "wispy", "none"],
  slick: ["none"],
  braid: ["none", "side", "center"],
  straight: ["blunt", "center", "side", "swept", "wispy", "none"],
  ponytail: ["swept", "side", "blunt", "wispy", "center", "none"],
  bun: ["side", "swept", "blunt", "center", "wispy", "none"],
  braids: ["blunt", "center", "side", "wispy"],
  bob: ["blunt", "swept", "side", "wispy", "center"],
  curls: ["curly", "center", "side"],
  sidebraid: ["swept", "side", "center", "none"],
  updo: ["center", "none", "side", "swept", "wispy"],
  pixie: ["swept", "wispy", "side"],
  twinbuns: ["blunt", "wispy", "center"],
  wavy: ["center", "side", "swept", "curly"],
  crownbraid: ["none", "side", "center", "swept"],
};

/** 实际画出的刘海：发型不允许时取该发型的缺省刘海。 */
export function bangsFor(hair: HairStyle, bangs: BangStyle): BangStyle {
  const ok = HAIR_BANGS[hair];
  return ok.includes(bangs) ? bangs : ok[0];
}

/** 帽子与头饰（原创设计）。 */
export type HatKind =
  | "none"
  | "tricorn" // 三角帽
  | "cap" // 船长帽：硬檐平顶帽
  | "bandana" // 海盗 / 水手头巾（脑后打结）
  | "kerchief" // 包头巾（酒馆老板娘）
  | "official" // 官帽（随文化变化）
  | "straw" // 宽檐草帽
  | "fur" // 毛皮帽
  | "turban" // 缠头布
  | "flower" // 鬓边花饰
  | "beanie" // 水手毛线帽
  | "visor" // 账房遮光帽檐
  | "scholar" // 方巾软帽
  | "headband" // 发带
  | "hood" // 兜帽 / 头巾（沙漠女子的包头纱）
  | "wreath" // 花环
  | "plumed" // 羽饰宽檐帽（地中海）
  | "mantilla" // 高梳头纱（地中海）
  | "capotain" // 高顶宽边帽（低地）
  | "lacecap" // 蕾丝帽（低地）
  | "crown" // 发冠（东方）
  | "hairpin" // 发簪（东方）
  | "slouch" // 软宽檐帽（开拓者）
  | "veil"; // 头纱与面纱（沙漠）

export const HAT_KINDS: readonly HatKind[] = [
  "none",
  "tricorn",
  "cap",
  "bandana",
  "kerchief",
  "official",
  "straw",
  "fur",
  "turban",
  "flower",
  "beanie",
  "visor",
  "scholar",
  "headband",
  "hood",
  "wreath",
  "plumed",
  "mantilla",
  "capotain",
  "lacecap",
  "crown",
  "hairpin",
  "slouch",
  "veil",
];

/** 服饰款式。 */
export type OutfitKind =
  | "captain" // 船长大衣：金边翻领、领巾
  | "coat" // 大衣
  | "jacket" // 短水手夹克
  | "vest" // 马甲 + 衬衫
  | "apron" // 布围裙
  | "smith" // 皮围裙（船厂）
  | "robe" // 交领长袍（东方）
  | "wide" // 长袍束带（沙漠）
  | "tunic" // 粗布短衫
  | "striped" // 条纹水手衫
  | "fur" // 毛皮披肩（北地）
  | "island" // 纹样披布（群岛）
  | "dress" // 方领连衣裙
  | "official" // 官服（胸前徽章）
  | "banker" // 高领礼服
  | "doublet" // 绣花紧身上衣 + 褶领（地中海）
  | "bodice" // 胸衣与长裙、泡袖（地中海女装）
  | "wool" // 黑呢外套 + 白色大翻领（低地）
  | "leather" // 皮甲（北地、开拓者）
  | "buckskin"; // 流苏皮外套 + 围巾（开拓者）

export const OUTFIT_KINDS: readonly OutfitKind[] = [
  "captain",
  "coat",
  "jacket",
  "vest",
  "apron",
  "smith",
  "robe",
  "wide",
  "tunic",
  "striped",
  "fur",
  "island",
  "dress",
  "official",
  "banker",
  "doublet",
  "bodice",
  "wool",
  "leather",
  "buckskin",
];

/**
 * 发饰（不戴帽子时别在头发上，金属有高光、宝石随点缀色、带一点白色闪光）：
 * 蝴蝶结、宝石发夹、细金头冠（额前一颗宝石）、珍珠串、星形发针、小花发夹，以及干活的人用的束发布条（布，没有闪光）。
 * 用单独的随机序列抽取（见 ornamentFor），不改变已有部件的抽取结果。
 */
export type Ornament = "none" | "ribbon" | "clip" | "circlet" | "pearls" | "star" | "blossom" | "tie";
export const ORNAMENTS: readonly Ornament[] = ["none", "ribbon", "clip", "circlet", "pearls", "star", "blossom", "tie"];

/** 项链。 */
export type Necklace = "none" | "shell" | "gold" | "beads" | "pendant" | "lei";
export const NECKLACES: readonly Necklace[] = ["none", "shell", "gold", "beads", "pendant", "lei"];

/** 头像参数（全部为可序列化的普通字段）。 */
export interface PortraitSpec {
  seed: number;
  role: NpcRole;
  female: boolean;
  /** 文化风味（影响帽饰与服装）；null 表示港口常见的混合打扮 */
  region: ArchStyle | null;
  age: Age;
  /** 肤色档位，见 SKIN_TONES */
  skin: number;
  face: FaceShape;
  eyes: EyeStyle;
  /** 虹膜颜色，见 EYE_RAMPS */
  eyeColor: number;
  brows: BrowStyle;
  nose: NoseStyle;
  mouth: MouthStyle;
  beard: BeardStyle;
  hair: HairStyle;
  /** 刘海（与发型独立；发型不适合时按 hair.ts 的规则改画） */
  bangs: BangStyle;
  hairColor: HairColor;
  /** 白发比例 */
  grizzle: Grizzle;
  hat: HatKind;
  hatColor: ClothColor;
  outfit: OutfitKind;
  /** 服饰主色 */
  main: ClothColor;
  /** 点缀色（衬里、腰带、领巾） */
  accent: ClothColor;
  glasses: boolean;
  earring: boolean;
  eyepatch: boolean;
  scar: boolean;
  pipe: boolean;
  necklace: Necklace;
  /** 发饰（只在不戴帽子、不是光头时画出来） */
  ornament: Ornament;
  /** 披风（船长、官员） */
  cape: boolean;
  /** 斜挎佩剑带 */
  sword: boolean;
  /** 精灵血统：尖耳（约 8% 的人物） */
  elf: boolean;
}

export interface SpecOpts {
  female?: boolean;
  region?: ArchStyle;
  age?: Age;
  /** 强制有无精灵血统（缺省按约 8% 的概率随机）；影响发色与眼睛颜色的分布 */
  elf?: boolean;
}

// ── 身份的服饰规则 ──

interface RoleRule {
  outfits: readonly OutfitKind[];
  /** 女性专用服饰候选（缺省同上） */
  outfitsF?: readonly OutfitKind[];
  mains: readonly ClothColor[];
  accents: readonly ClothColor[];
  /** 帽子候选及权重 */
  hats: readonly (readonly [HatKind, number])[];
  /** 女性专用帽子候选（缺省同上） */
  hatsF?: readonly (readonly [HatKind, number])[];
  /** 年龄权重 [青年, 中年, 老年] */
  ages: readonly [number, number, number];
}

const RULES: Readonly<Record<NpcRole, RoleRule>> = {
  market: {
    outfits: ["apron", "vest"],
    mains: ["green", "blue", "brown", "teal"],
    accents: ["cream", "white", "ochre"],
    hats: [
      ["none", 5],
      ["scholar", 2],
      ["headband", 1],
    ],
    hatsF: [
      ["none", 4],
      ["kerchief", 2],
    ],
    ages: [2, 4, 2],
  },
  shipyard: {
    outfits: ["smith"],
    mains: ["leather", "brown"],
    accents: ["cream", "white", "sand"],
    hats: [
      ["none", 3],
      ["headband", 3],
      ["beanie", 1],
      ["bandana", 1],
    ],
    ages: [2, 4, 2],
  },
  tavern: {
    outfits: ["vest", "apron"],
    outfitsF: ["vest", "apron", "dress", "dress"],
    mains: ["crimson", "brown", "green", "ochre"],
    accents: ["cream", "white", "gold"],
    hats: [
      ["none", 5],
      ["headband", 1],
    ],
    hatsF: [
      ["kerchief", 4],
      ["none", 2],
      ["flower", 1],
    ],
    ages: [2, 4, 2],
  },
  guild: {
    outfits: ["coat", "robe"],
    mains: ["jade", "green", "navy", "purple"],
    accents: ["gold", "cream"],
    hats: [
      ["scholar", 3],
      ["none", 3],
    ],
    ages: [1, 4, 3],
  },
  bank: {
    outfits: ["banker"],
    mains: ["black", "navy", "purple"],
    accents: ["gold", "white"],
    hats: [
      ["none", 5],
      ["scholar", 1],
    ],
    ages: [1, 4, 3],
  },
  exchange: {
    outfits: ["vest"],
    mains: ["blue", "navy", "slate", "brown"],
    accents: ["white", "cream"],
    hats: [
      ["visor", 5],
      ["none", 3],
    ],
    ages: [3, 4, 1],
  },
  warehouse: {
    outfits: ["tunic", "jacket"],
    mains: ["brown", "ochre", "slate", "leather"],
    accents: ["cream", "sand"],
    hats: [
      ["beanie", 3],
      ["none", 3],
      ["headband", 2],
      ["straw", 1],
    ],
    ages: [3, 4, 2],
  },
  invest: {
    outfits: ["robe", "coat"],
    mains: ["teal", "jade", "navy"],
    accents: ["gold", "cream", "white"],
    hats: [
      ["scholar", 3],
      ["none", 3],
    ],
    ages: [2, 4, 2],
  },
  office: {
    outfits: ["official"],
    mains: ["crimson", "navy", "purple"],
    accents: ["gold"],
    hats: [["official", 1]],
    ages: [1, 4, 3],
  },
  mate: {
    outfits: ["jacket", "coat", "striped", "vest"],
    mains: ["navy", "blue", "brown", "green", "crimson", "slate"],
    accents: ["cream", "white", "red", "gold"],
    hats: [
      ["none", 6],
      ["bandana", 2],
      ["tricorn", 1],
      ["headband", 1],
      ["beanie", 1],
    ],
    ages: [4, 4, 1],
  },
  captain: {
    outfits: ["captain"],
    mains: ["navy", "crimson", "black", "blue"],
    accents: ["gold"],
    hats: [
      ["tricorn", 4],
      ["cap", 2],
      ["none", 2],
    ],
    ages: [3, 3, 1],
  },
  pirate: {
    outfits: ["striped", "jacket", "coat", "tunic"],
    mains: ["crimson", "black", "brown", "red"],
    accents: ["red", "gold", "cream"],
    hats: [
      ["bandana", 5],
      ["tricorn", 2],
      ["none", 2],
    ],
    ages: [2, 4, 2],
  },
  sailor: {
    outfits: ["striped", "jacket", "tunic"],
    mains: ["navy", "blue", "slate", "teal"],
    accents: ["red", "white", "cream"],
    hats: [
      ["beanie", 3],
      ["bandana", 2],
      ["none", 3],
      ["straw", 1],
    ],
    ages: [4, 3, 1],
  },
  townsfolk: {
    outfits: ["tunic", "vest"],
    outfitsF: ["tunic", "dress", "vest", "dress"],
    mains: ["brown", "ochre", "green", "blue", "crimson", "cream"],
    accents: ["cream", "white", "brown"],
    hats: [
      ["none", 6],
      ["straw", 1],
      ["headband", 1],
    ],
    hatsF: [
      ["none", 5],
      ["kerchief", 2],
      ["flower", 1],
    ],
    ages: [3, 3, 2],
  },
};

// ── 文化：肤色、发色、眼睛颜色的分布 ──

type Weights<T> = readonly (readonly [T, number])[];

interface Culture {
  /** 肤色 0..4 的权重 */
  skin: readonly number[];
  hair: Weights<HairColor>;
  eyes: Weights<number>;
}

/** 文化 → 外貌分布；none 为港口的混合人群。 */
const CULTURES: Readonly<Record<ArchStyle | "none", Culture>> = {
  mediterranean: {
    skin: [2, 4, 3, 1, 0],
    hair: [
      ["black", 3],
      ["dark", 4],
      ["brown", 3],
      ["auburn", 1],
    ],
    eyes: [
      [0, 4],
      [1, 3],
      [3, 2],
      [5, 1],
    ],
  },
  nordic: {
    skin: [6, 3, 1, 0, 0],
    hair: [
      ["blond", 4],
      ["brown", 2],
      ["auburn", 3],
      ["dark", 1],
    ],
    eyes: [
      [2, 4],
      [4, 3],
      [3, 2],
      [1, 1],
    ],
  },
  lowland: {
    skin: [5, 4, 1, 0, 0],
    hair: [
      ["brown", 4],
      ["blond", 3],
      ["dark", 2],
      ["auburn", 1],
    ],
    eyes: [
      [2, 3],
      [4, 2],
      [1, 3],
      [3, 1],
    ],
  },
  desert: {
    skin: [0, 1, 4, 4, 2],
    hair: [
      ["black", 5],
      ["dark", 3],
      ["auburn", 1],
    ],
    eyes: [
      [0, 5],
      [5, 2],
      [3, 1],
      [1, 2],
    ],
  },
  islands: {
    skin: [0, 1, 3, 4, 3],
    hair: [
      ["black", 5],
      ["dark", 3],
      ["brown", 1],
    ],
    eyes: [
      [0, 5],
      [1, 2],
      [7, 1],
    ],
  },
  eastern: {
    skin: [4, 5, 2, 0, 0],
    hair: [
      ["black", 6],
      ["dark", 3],
    ],
    eyes: [
      [0, 6],
      [1, 2],
    ],
  },
  frontier: {
    skin: [3, 3, 3, 2, 1],
    hair: [
      ["brown", 3],
      ["dark", 3],
      ["black", 2],
      ["blond", 2],
      ["auburn", 2],
    ],
    eyes: [
      [0, 3],
      [1, 3],
      [2, 2],
      [3, 2],
      [4, 1],
    ],
  },
  none: {
    skin: [2, 3, 3, 2, 1],
    hair: [
      ["black", 3],
      ["dark", 3],
      ["brown", 3],
      ["auburn", 1],
      ["blond", 1],
    ],
    eyes: [
      [0, 5],
      [1, 3],
      [5, 1],
      [2, 1],
      [3, 1],
    ],
  },
};

/** 精灵血统的发色与眼色：银、白金、金、黑，眼睛常带紫或碧青。 */
const ELF_HAIR: Weights<HairColor> = [
  ["silver", 4],
  ["blond", 3],
  ["white", 2],
  ["black", 2],
  ["auburn", 1],
];
const ELF_EYES: Weights<number> = [
  [6, 3],
  [7, 3],
  [3, 2],
  [2, 2],
  [5, 1],
];

/** 不会被“文化服饰”替换的身份（统一制服）。 */
function uniformed(s: PortraitSpec): boolean {
  return s.role === "captain" || s.role === "pirate" || s.role === "office";
}

/**
 * 文化对服饰与帽子的改写（北地毛皮、沙漠缠头与长袍、群岛花环与贝壳、东方交领长袍与发冠……）。
 * 官员一律换成本文化的官服与官帽（官帽的样子随文化变化，见 hats.ts）。
 */
function cultureTouch(s: PortraitSpec, r: Rng): void {
  const civil = !uniformed(s);
  const keep = s.hat === "official" || s.hat === "visor";
  switch (s.region) {
    case "mediterranean":
      if (s.role === "office") {
        s.outfit = "doublet";
        s.cape = r.chance(0.5);
        break;
      }
      if (civil && s.outfit !== "smith" && s.outfit !== "banker") {
        if (s.female && r.chance(0.55)) s.outfit = "bodice";
        else if (!s.female && r.chance(0.45)) s.outfit = "doublet";
      }
      if (!keep && s.role !== "pirate") {
        if (s.female && r.chance(0.4)) s.hat = r.chance(0.7) ? "mantilla" : "flower";
        else if (!s.female && r.chance(s.role === "captain" ? 0.35 : 0.3)) s.hat = "plumed";
      }
      if (s.female && s.hair !== "wavy" && r.chance(0.35)) s.hair = "wavy";
      break;
    case "nordic":
      if (civil && s.outfit !== "smith" && s.outfit !== "banker" && r.chance(0.55)) s.outfit = "fur";
      else if ((civil || s.role === "pirate") && !s.female && s.outfit !== "banker" && r.chance(0.3)) s.outfit = "leather";
      if (!keep && r.chance(s.role === "captain" ? 0.3 : 0.45)) s.hat = "fur";
      if (s.outfit === "fur") s.main = r.pick(["slate", "brown", "navy", "iron", "crimson"] as const);
      if (s.female && r.chance(0.5)) s.hair = r.pick(["braids", "sidebraid", "crownbraid", "crownbraid"] as const);
      else if (!s.female && s.hair !== "bald" && r.chance(0.3)) s.hair = r.pick(["braid", "long", "tied"] as const);
      break;
    case "lowland":
      if (s.role === "office") {
        s.outfit = "wool";
        break;
      }
      if (civil && s.outfit !== "smith" && r.chance(0.45)) s.outfit = "wool";
      if (!keep && s.role !== "pirate") {
        if (s.female && r.chance(0.45)) s.hat = "lacecap";
        else if (!s.female && r.chance(0.35)) s.hat = "capotain";
        else if (civil && s.hat === "none" && r.chance(0.2)) s.hat = "straw";
      }
      if (s.outfit === "wool") s.main = r.pick(["black", "black", "navy", "brown", "slate"] as const);
      break;
    case "desert":
      if (civil && s.outfit !== "smith" && r.chance(0.55)) s.outfit = "wide";
      if (!keep && s.hat !== "tricorn" && r.chance(0.6)) s.hat = s.female ? (r.chance(0.55) ? "hood" : "veil") : "turban";
      if (s.outfit === "wide") s.main = r.pick(["sand", "white", "red", "teal", "ochre", "purple"] as const);
      if (r.chance(s.female ? 0.6 : 0.3)) s.earring = true;
      if (s.female && s.necklace === "none" && r.chance(0.45)) s.necklace = "gold";
      break;
    case "islands":
      if (civil && s.outfit !== "banker" && r.chance(0.5)) s.outfit = "island";
      if (!keep && r.chance(0.55)) s.hat = s.female ? r.pick(["flower", "wreath", "flower"] as const) : r.pick(["flower", "straw", "headband"] as const);
      if (r.chance(0.6)) s.necklace = r.chance(0.5) ? "lei" : "shell";
      if (s.outfit === "island") s.main = r.pick(["teal", "coral", "straw", "white", "red"] as const);
      break;
    case "eastern":
      if (s.role === "office") {
        s.outfit = "robe";
        s.main = r.pick(["crimson", "jade", "navy", "purple"] as const);
        break;
      }
      if (civil && s.outfit !== "smith" && s.outfit !== "banker" && r.chance(0.5)) s.outfit = "robe";
      if (s.outfit === "robe") s.main = r.pick(["jade", "white", "teal", "green", "navy", "purple"] as const);
      if (s.female) {
        if (!keep && r.chance(0.55)) {
          s.hat = "hairpin";
          s.hair = r.pick(["bun", "updo", "twinbuns", "updo"] as const);
        }
      } else if (!keep && s.role !== "pirate" && r.chance(0.35)) {
        s.hat = "crown";
        s.hair = "topknot";
      }
      break;
    case "frontier":
      if (civil && s.outfit !== "smith" && s.outfit !== "banker" && r.chance(0.6)) s.outfit = s.female && r.chance(0.25) ? "dress" : "buckskin";
      else if (civil && !s.female && r.chance(0.25)) s.outfit = "leather";
      if (!keep && r.chance(s.female ? 0.35 : 0.55)) s.hat = s.female && r.chance(0.4) ? "kerchief" : "slouch";
      if (r.chance(0.3)) s.necklace = "pendant";
      if (s.outfit === "buckskin") s.main = r.pick(["leather", "brown", "sand", "ochre"] as const);
      break;
    default:
      break;
  }
  // 女性不穿男式紧身上衣、男性不穿胸衣与连衣裙
  if (s.female && s.outfit === "doublet") s.outfit = "bodice";
  if (!s.female && (s.outfit === "bodice" || s.outfit === "dress")) s.outfit = "vest";
}

/** 由种子生成头像参数：同一个种子（与相同选项）永远得到同一张脸。 */
export function makeSpec(seed: string | number, role: NpcRole, opts: SpecOpts = {}): PortraitSpec {
  const s32 = hash32(seed);
  const r = rng(`portrait-${s32}`);
  const rule = RULES[role];
  const female = opts.female ?? (s32 & 1) === 1;
  const region = opts.region ?? null;
  const culture = CULTURES[region ?? "none"];
  const age: Age =
    opts.age ??
    r.weighted<Age>([
      [0, rule.ages[0]],
      [1, rule.ages[1]],
      [2, rule.ages[2]],
    ]);
  // 精灵血统：各地都有少量，不随文化变化（强制时也照常抽一次，其余部件的随机序列不受影响）
  const rolled = r.chance(0.08);
  const elf = opts.elf ?? rolled;

  const skin = r.weighted(culture.skin.map((w, i) => [i, w] as const));
  let hairColor = r.weighted(elf ? ELF_HAIR : culture.hair);
  // 老年人多半花白，但保留一部分原来的发色，免得满屏白头
  if (age === 2)
    hairColor = r.weighted<HairColor>([
      ["white", 3],
      ["gray", 4],
      [hairColor, 2],
    ]);
  else if (age === 1 && r.chance(0.1)) hairColor = "gray";

  // 五官的抽取次数与旧版一致（每项一次），后面服饰与帽子的随机序列因此不变
  const face: FaceShape = r.weighted<FaceShape>(
    female
      ? [
          ["oval", 3],
          ["heart", 3],
          ["round", 2],
          ["long", 1],
          ["square", 1],
        ]
      : [
          ["oval", 2],
          ["square", 3],
          ["long", 2],
          ["round", 1.5],
          ["heart", 1],
        ],
  );
  const femaleHair = FEMALE_HAIR.filter((h) => h !== "wavy" && h !== "crownbraid");
  const hair = female ? r.pick(femaleHair) : r.weighted<HairStyle>(MALE_HAIR.map((h) => [h, h === "bald" ? (age === 2 ? 3 : 1) : 2] as const));

  let beard: BeardStyle = "none";
  if (!female) {
    const bw: (readonly [BeardStyle, number])[] = [
      ["none", age === 0 ? 8 : 3],
      ["stubble", role === "pirate" || role === "sailor" ? 3 : 1],
      ["mustache", 2],
      ["goatee", 2],
      // 络腮胡与长须只给中年以上的男性（大胡子的长者、老将才显得威严；年轻人留整块大胡子显得邋遢）
      ["full", age === 0 ? 0 : role === "pirate" || role === "shipyard" ? 3 : 1.5],
      ["long", age === 2 ? 3 : age === 1 ? 0.3 : 0],
      ["chops", 1],
      ["trim", age === 0 ? 1.5 : 2.5],
    ];
    beard = r.weighted(bw);
  }

  const hats = female && rule.hatsF ? rule.hatsF : rule.hats;
  const outfit: OutfitKind = r.pick(female && rule.outfitsF ? rule.outfitsF : rule.outfits);

  const spec: PortraitSpec = {
    seed: s32,
    role,
    female,
    region,
    age,
    skin,
    face,
    eyes: r.weighted<EyeStyle>(
      female
        ? [
            ["almond", 3],
            ["round", 3.5],
            ["droopy", 2.5],
            ["sharp", 1.5],
            ["narrow", 0.8],
            ["mono", 1.5],
            ["sleepy", age === 0 ? 0.5 : 1.2],
          ]
        : [
            ["almond", 3],
            ["sharp", 3],
            ["narrow", 2],
            ["droopy", 1.5],
            ["mono", 2],
            ["round", age === 0 ? 1.5 : 0.7],
            ["sleepy", age === 0 ? 0.5 : 1.2],
          ],
    ),
    eyeColor: r.weighted(elf ? ELF_EYES : culture.eyes),
    brows: r.weighted<BrowStyle>(
      female
        ? [
            ["thin", 3],
            ["arched", 3],
            ["straight", 2.5],
            ["thick", 1],
            ["sword", 0.6],
          ]
        : age === 2
          ? [
              ["bushy", 3],
              ["thick", 2],
              ["stern", 2],
              ["straight", 1],
            ]
          : [
              ["thick", 3],
              ["sword", 3],
              ["straight", 2],
              ["stern", age === 0 ? 1 : 2],
              ["arched", 0.5],
              ["thin", 0.5],
              ["bushy", age === 0 ? 0.3 : 1],
            ],
    ),
    nose: r.weighted<NoseStyle>(
      female
        ? [
            ["small", 4],
            ["button", 3],
            ["straight", 2],
            ["hooked", 0.4],
            ["broad", 0.6],
          ]
        : [
            ["straight", 4],
            ["small", 1.5],
            ["hooked", 2],
            ["broad", 2],
            ["button", 0.6],
          ],
    ),
    mouth: r.weighted<MouthStyle>(
      female
        ? [
            ["lips", 3],
            ["smile", 3],
            ["line", 2],
            ["smirk", 1.5],
            ["frown", 1.5],
            ["grin", 1],
          ]
        : [
            ["line", 3],
            ["smile", 2],
            ["smirk", 2],
            ["frown", 2],
            ["grin", 1],
            ["lips", 0.5],
          ],
    ),
    beard,
    hair,
    bangs: HAIR_BANGS[hair][0],
    hairColor,
    grizzle: 0,
    hat: r.weighted(hats),
    hatColor: r.pick(rule.accents.concat(rule.mains)),
    outfit,
    main: r.pick(rule.mains),
    accent: r.pick(rule.accents),
    glasses: role === "bank" ? r.chance(0.8) : role === "exchange" || role === "guild" || role === "invest" ? r.chance(0.3) : r.chance(age === 2 ? 0.15 : 0.04),
    earring: role === "pirate" ? r.chance(0.6) : r.chance(female ? 0.4 : 0.1),
    eyepatch: role === "pirate" ? r.chance(0.35) : role === "sailor" || role === "mate" ? r.chance(0.04) : false,
    scar: role === "pirate" ? r.chance(0.5) : role === "sailor" || role === "shipyard" || role === "mate" ? r.chance(0.12) : false,
    pipe: !female && (role === "sailor" || role === "mate" || role === "warehouse" || role === "shipyard" || role === "pirate") ? r.chance(0.15) : false,
    necklace: female ? r.pick(["none", "none", "beads", "pendant", "gold"] as const) : role === "pirate" ? r.pick(["none", "gold", "beads"] as const) : "none",
    ornament: "none",
    cape: role === "office" ? r.chance(0.3) : false,
    sword: role === "pirate" ? r.chance(0.5) : role === "mate" ? r.chance(0.2) : false,
    elf,
  };
  if (spec.hat === "bandana" && role !== "pirate" && role !== "sailor") spec.hatColor = spec.accent;
  if (role === "pirate" && spec.hat === "bandana") spec.hatColor = r.pick(["red", "crimson", "black", "navy"] as const);
  cultureTouch(spec, r);
  // 光头配软帽显得怪：光头一律不戴包头巾与兜帽
  if (spec.hair === "bald" && (spec.hat === "kerchief" || spec.hat === "hood" || spec.hat === "hairpin")) spec.hat = "none";
  // 发冠只戴在发髻上
  if (spec.hat === "crown" && spec.hair !== "topknot") spec.hair = "topknot";
  // 眼罩与眼镜不同时出现；面纱遮住下半张脸，就不叼烟斗、不留胡子
  if (spec.eyepatch) spec.glasses = false;
  if (spec.hat === "veil") {
    spec.pipe = false;
    spec.beard = "none";
  }
  hairDetails(spec, rng(`portrait-hair-${s32}`));
  spec.ornament = ornamentFor(spec, rng(`portrait-ornament-${s32}`));
  return spec;
}

/** 干粗活的身份（海盗、船厂、码头）：只用束发布条把发髻扎住，或者不戴——不戴蝴蝶结之类装饰性的发饰。 */
const PLAIN_ROLES: readonly NpcRole[] = ["pirate", "shipyard", "sailor", "warehouse"];
/** 蝴蝶结只给市民、酒馆与交易所（柜台后面、街上的姑娘）。 */
const RIBBON_ROLES: readonly NpcRole[] = ["townsfolk", "tavern", "exchange"];
/** 有发髻、丸子可扎的发型（束发布条系在发髻根部；马尾与发辫本身已经系着发绳）。 */
const KNOT_HAIR: readonly HairStyle[] = ["bun", "updo", "twinbuns"];

/** 各文化偏爱的发饰（权重倍数）：群岛偏小花、北地偏细金头冠、内海（地中海）偏珍珠串…… */
const ORNAMENT_TASTE: Readonly<Partial<Record<ArchStyle, Partial<Record<Ornament, number>>>>> = {
  islands: { blossom: 5, star: 1.5 },
  nordic: { circlet: 4 },
  mediterranean: { pearls: 3 },
  eastern: { clip: 2 },
  lowland: { ribbon: 2 },
  desert: { circlet: 1.5, pearls: 1.5 },
  frontier: { ribbon: 2 },
};

/**
 * 发饰：用单独的随机序列（在文化改写与发型确定之后），新增部件不打乱原有部件的随机序列。
 * 只在不戴帽子（头巾、面纱、兜帽、东方的发簪都算帽子）、不是光头时佩戴；
 * 青年女性约一半、中年少一些、老年更少；男性只有精裔偶尔戴细金头冠；
 * 海盗、船厂、码头的身份只在发髻上系一条束发布条（别的发型不戴）；蝴蝶结只给市民、酒馆、交易所。
 */
function ornamentFor(s: PortraitSpec, g: Rng): Ornament {
  const roll = g.next();
  const pick = g.next();
  if (s.hat !== "none" || s.hair === "bald") return "none";
  const chance = s.female ? [0.5, 0.4, 0.2][s.age] : s.elf ? 0.3 : 0;
  if (roll >= chance) return "none";
  if (!s.female) return "circlet";
  if (PLAIN_ROLES.includes(s.role)) return KNOT_HAIR.includes(s.hair) ? "tie" : "none";
  const taste = (s.region && ORNAMENT_TASTE[s.region]) || {};
  const items: (readonly [Ornament, number])[] = [
    ["ribbon", RIBBON_ROLES.includes(s.role) ? (s.age === 0 ? 3 : 1) : 0],
    ["clip", 3],
    ["circlet", s.elf ? 5 : 1.2],
    ["pearls", 2],
    ["star", 1.5],
    ["blossom", 1],
  ];
  const weighted = items.map(([o, w]) => [o, w * (taste[o] ?? 1)] as const);
  const total = weighted.reduce((a, [, w]) => a + w, 0);
  let r = pick * total;
  for (const [o, w] of weighted) {
    r -= w;
    if (r < 0) return o;
  }
  return weighted[weighted.length - 1][0];
}

/** 头像里比较“撞脸”的五项：发型、发色、头饰（帽子或发饰）、肤色、脸型。返回两人相同的项数。 */
export function lookalike(a: PortraitSpec, b: PortraitSpec): number {
  const head = (s: PortraitSpec) => (s.hat !== "none" ? `hat:${s.hat}` : `orn:${s.ornament}`);
  return [a.hair === b.hair, a.hairColor === b.hairColor, head(a) === head(b), a.skin === b.skin, a.face === b.face].filter(Boolean).length;
}

/**
 * 同一港口的掌柜“撞脸”时换一换：用掌柜专用的随机子序列（keeper-<种子>-<次数>）重抽发色、脸型与发型，
 * 刘海、白发与发饰随之重排；性别、年龄、身份、服饰与帽子都不动（姓名与头像的性别一致）。发冠只戴在发髻上，所以戴发冠的不换发型。
 */
export function keeperVariant(s: PortraitSpec, key: string, attempt: number): PortraitSpec {
  const g = rng(`keeper-${key}-${attempt}`);
  const culture = CULTURES[s.region ?? "none"];
  const out: PortraitSpec = { ...s };
  let hairColor = g.weighted(s.elf ? ELF_HAIR : culture.hair);
  if (s.age === 2) hairColor = g.weighted<HairColor>([
    ["white", 3],
    ["gray", 4],
    [hairColor, 2],
  ]);
  out.hairColor = hairColor;
  out.face = g.pick(FACE_SHAPES);
  if (s.hat !== "crown") {
    const pool = s.female ? FEMALE_HAIR.filter((h) => h !== "wavy" && h !== "crownbraid") : MALE_HAIR;
    let hair = g.pick(pool);
    // 光头不配软帽
    if (hair === "bald" && (s.hat === "kerchief" || s.hat === "hood" || s.hat === "hairpin" || s.hat === "veil")) hair = "crop";
    out.hair = hair;
  }
  hairDetails(out, rng(`keeper-hair-${key}-${attempt}`));
  out.ornament = ornamentFor(out, rng(`keeper-ornament-${key}-${attempt}`));
  return out;
}

/**
 * 随机重抽仍然撞脸时的兜底：按固定顺序逐个试脸型 × 发色 × 发型，取第一个与前面每一位都至少有三项不同的组合；
 * 发冠锁着发型、怎么换都撞时，摘掉发冠再试；本文化的发色只有两三种、实在错不开时，最后才在本文化出现的肤色里换一档。
 * 结果确定（不用随机数）。
 */
export function keeperFallback(s: PortraitSpec, others: readonly PortraitSpec[], key: string): PortraitSpec {
  const culture = CULTURES[s.region ?? "none"];
  const colors: HairColor[] = [...new Set<HairColor>([...culture.hair.map(([c]) => c), ...(s.age === 0 ? [] : (["gray", "white"] as const))])];
  const pool = s.female ? FEMALE_HAIR.filter((h) => h !== "wavy" && h !== "crownbraid") : MALE_HAIR;
  const skins = [s.skin, ...culture.skin.map((w, i) => (w > 0 && i !== s.skin ? i : -1)).filter((i) => i >= 0)];
  for (const skin of skins) {
    for (const hat of s.hat === "crown" ? [s.hat, "none" as const] : [s.hat]) {
      const hairs = hat === "crown" ? (["topknot"] as const) : pool.filter((h) => !(h === "bald" && (hat === "kerchief" || hat === "hood" || hat === "hairpin" || hat === "veil")));
      for (const face of FACE_SHAPES) {
        for (const hairColor of colors) {
          for (const hair of hairs) {
            const t: PortraitSpec = { ...s, skin, hat, face, hairColor, hair };
            hairDetails(t, rng(`keeper-hair-${key}-fallback`));
            t.ornament = ornamentFor(t, rng(`keeper-ornament-${key}-fallback`));
            if (others.every((o) => lookalike(o, t) < 3)) return t;
          }
        }
      }
    }
  }
  return s;
}

/** 摘掉头饰后重新挑发饰（东方港的同款发簪只留给一位掌柜，其余的人换成不戴、别上自己的发饰）。 */
export function withoutHairpin(s: PortraitSpec, key: string): PortraitSpec {
  const out: PortraitSpec = { ...s, hat: "none" };
  out.ornament = ornamentFor(out, rng(`keeper-ornament-${key}-pin`));
  return out;
}

/**
 * 刘海与白发比例：用单独的随机序列（在文化改写之后，按最终的发型挑刘海），
 * 这样新增的部件不会打乱原有部件的随机序列。
 */
function hairDetails(s: PortraitSpec, g: Rng): void {
  s.bangs = g.pick(HAIR_BANGS[s.hair]);
  const grayHair = s.hairColor === "gray" || s.hairColor === "white" || s.hairColor === "silver";
  const roll = g.next();
  if (grayHair || s.age === 0) s.grizzle = 0;
  else if (s.age === 1) s.grizzle = roll < (s.female ? 0.15 : 0.3) ? 1 : 0;
  else s.grizzle = roll < 0.6 ? 2 : 1;
}
