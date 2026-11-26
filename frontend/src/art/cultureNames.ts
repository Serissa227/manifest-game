// 寰宇（第九批的真实地球）的“名字文化”：势力的细风格（数据里势力的 style，如 japanese、portuguese、swahili）
// → 十六世纪当地常见的平民 / 商人名字池，给掌柜、情报贩子这些程序起名的港口人物用。
// 有名字池的文化不再混入港口通用的西洋“外来者”名；经典世界的势力不带细风格，照旧用 names.ts 的七种风味名池。
// 日本名字池由 Claude（Opus）写，中国沿用 names.ts 的东方名池，其余文化的名池在 cultureNamePools.ts（Haiku 写、Claude 审）。
import { CULTURE_NAME_POOLS } from "./cultureNamePools";

export type NamePair = readonly [en: string, zh: string];

export interface CultureNames {
  /** true：姓在前、名在后，不加间隔点（汉字文化圈）；false：“名·姓” */
  eastern: boolean;
  given_m: readonly NamePair[];
  given_f: readonly NamePair[];
  /** 姓；没有固定姓的文化写常见称号、籍贯式别称或父名 */
  surnames: readonly NamePair[];
}

/** 日本：港町的町人、商人、船户。姓一栏用屋号（避开今井、茶屋、岛井这些有名的大商家，免得与历史人物撞名）。 */
const JAPANESE: CultureNames = {
  eastern: true,
  given_m: [
    ["Yosaburo", "与三郎"], ["Tobei", "藤兵卫"], ["Yashichi", "弥七"], ["Jinroku", "甚六"],
    ["Genjiro", "源次郎"], ["Magoemon", "孙右卫门"], ["Matashiro", "又四郎"], ["Shinpachi", "新八"],
    ["Seibei", "清兵卫"], ["Hikotaro", "彦太郎"], ["Soemon", "宗右卫门"], ["Kihei", "喜兵卫"],
    ["Kanjuro", "勘十郎"], ["Ichisuke", "市助"], ["Kyusaku", "久作"], ["Hanzaemon", "半左卫门"],
  ],
  given_f: [
    ["Omatsu", "阿松"], ["Otake", "阿竹"], ["Oume", "阿梅"], ["Okiku", "阿菊"],
    ["Okame", "阿龟"], ["Ofuku", "阿福"], ["Oharu", "阿春"], ["Onatsu", "阿夏"],
    ["Oichi", "阿市"], ["Otsuru", "阿鹤"], ["Otatsu", "阿辰"], ["Oiwa", "阿岩"],
    ["Otane", "阿种"], ["Ohisa", "阿久"], ["Ogin", "阿吟"], ["Ochiyo", "阿千代"],
  ],
  surnames: [
    ["Sumiya", "角屋"], ["Naya", "纳屋"], ["Izumiya", "和泉屋"], ["Hiranoya", "平野屋"],
    ["Sumiyoshiya", "住吉屋"], ["Sakaiya", "堺屋"], ["Iseya", "伊势屋"], ["Daikokuya", "大黑屋"],
    ["Uoya", "鱼屋"], ["Aburaya", "油屋"], ["Komeya", "米屋"], ["Shioya", "盐屋"],
    ["Okeya", "桶屋"], ["Kiya", "木屋"], ["Matsuya", "松屋"], ["Hamadaya", "浜田屋"],
  ],
};

/** 势力的细风格 → 名字文化（没有列出的风格、经典世界的七种粗风格都没有名字文化，照旧用风味名池）。 */
export const NAME_CULTURE_OF: Readonly<Record<string, string>> = {
  japanese: "japanese",
  ming: "chinese",
  chinese: "chinese",
  korean: "korean",
  ryukyu: "ryukyuan",
  vietnamese: "vietnamese",
  dai_viet: "vietnamese",
  jurchen: "jurchen",
  malay: "malay",
  javanese: "malay",
  moluccan: "malay",
  champa: "malay",
  philippine: "tagalog",
  siamese: "thai",
  burmese: "burmese",
  indian: "indian",
  hindustani: "indian",
  deccan: "indian",
  carnatic: "tamil",
  malabar: "tamil",
  sinhalese: "sinhalese",
  persian: "persian",
  mughal: "persian",
  arabic: "arabic",
  arabian: "arabic",
  maghreb: "arabic",
  mamluk: "arabic",
  ottoman_maghreb: "arabic",
  ottoman: "turkish",
  swahili: "swahili",
  ethiopian: "ethiopian",
  kongo: "kongo",
  ndongo: "kongo",
  edo: "edo",
  west_african: "edo",
  maya: "nahua_maya",
  aztec: "nahua_maya",
  mesoamerican: "nahua_maya",
  andean: "quechua",
  inca: "quechua",
  spanish: "spanish",
  iberian: "spanish",
  caribbean: "spanish",
  colonial: "spanish",
  portuguese: "portuguese",
  italian: "italian",
  venetian: "italian",
  genoese: "italian",
  greek: "greek",
  atlantis: "greek",
  french: "french",
  english: "english",
  dutch: "dutch",
  low_countries: "dutch",
  flemish: "dutch",
  hanseatic: "german",
  baltic: "german",
  scandinavian: "scandinavian",
  northern: "scandinavian",
  russian: "russian",
  polynesian: "polynesian",
  tupi: "tupi",
  chamorro: "chamorro",
};

/** 名字文化 → 名字池（chinese 由 names.ts 用东方名池补上，这里不列）。 */
export const CULTURE_NAMES: Readonly<Record<string, CultureNames>> = { japanese: JAPANESE, ...CULTURE_NAME_POOLS };
