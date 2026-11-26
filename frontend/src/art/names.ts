// 人名生成（原创姓名表，可替换）：给设施掌柜、路人、海盗头目、随机船长等没有数据文件定义的 NPC 起名。
// 同一个种子（与相同的性别、文化）永远得到同一个名字。
//
// 双语（EXPANSION.md §12.2、§12.3）：每个名字是一对 [英文原形, 中文音译]——名字的正名是拉丁字母原形，中文是它的音译。
// 同一个种子在两种语言下挑中同一对，所以中文“奥斯瓦·阿尔滕”对应英文 “Osva Alten”。中文按原规则拼写，结果与只有中文时完全相同。
// 替换或增删名字时成对修改；新增的名字放在列表末尾，已有名字的顺序不要动（否则同一个种子会换成别的名字）。
//
// 名字按文化（即建筑风格 ArchStyle）取自各自的风味名池，全部为原创：
//   地中海（埃斯佩兰）——意大利 / 西班牙风，舒展的多音节名，姓氏常带“德·”（de）；北地（诺德海姆）——斯堪的纳维亚风，短促硬朗，
//   姓氏多“-兰、-维克”；低地（范德兰）——荷兰 / 佛兰德风，“范·”（van）“德·”（de）开头的姓；沙漠（卡迪尔）——阿拉伯 / 波斯风，
//   “伊本·”（ibn）“阿尔-”（al-）的家名；群岛（马纳瓦）——波利尼西亚风，元音绵长；东方（瑶华）——汉语拼音，单姓复姓与两字名；
//   开拓者殖民地——英语殖民地风的拓荒者名字，并混入各地移民。
// 中文：西方各文化用“名·姓”（中间一个间隔号），东方用“姓名”（不加间隔号）。
// 英文：西方各文化用 “Given Surname”，东方用 “Surname Given”（拼音，如 “Chen Mingyuan”）。
// 各港口都有外来的商人与水手：指定文化时约五分之一的名字取自港口通用的西方名池。
// 不指定文化时，名字取自港口通用的西方名池（混合各地风味）。
// 中文名字（含间隔号）最长 12 个字，与主角姓名上限一致（随机船长名直接取自这里；英文的随机船长名见 start/captain.ts）。
// 寰宇（真实地球）的港口另按势力的细风格取“名字文化”（cultureNames.ts）：十六世纪当地常见的名字，不混入上面的原创西洋名。
import type { ArchStyle } from "./buildings";
import { CULTURE_NAMES, NAME_CULTURE_OF } from "./cultureNames";
import { rng } from "./rng";

/** 一个名字：[英文原形, 中文音译]。 */
export type { NamePair } from "./cultureNames";
import type { NamePair } from "./cultureNames";

// ── 港口通用的西方名池（混合各地风味） ──

/** 通用姓氏（西方，混合风味）。 */
const SURNAME_PAIRS: readonly NamePair[] = [
  ["Alten", "阿尔滕"], ["Bertan", "贝尔坦"], ["Castel", "卡斯泰尔"], ["Delacou", "德拉库"], ["Evron", "埃弗隆"],
  ["Falcon", "法尔孔"], ["Garrett", "加雷特"], ["Holst", "霍尔斯特"], ["Ivendale", "伊文代尔"], ["Jacan", "雅坎"],
  ["Kestel", "凯斯特尔"], ["Lovell", "洛维尔"], ["Marel", "马雷尔"], ["Nortan", "诺尔坦"], ["Auberan", "奥贝兰"],
  ["Pelleg", "佩莱格"], ["Rossel", "罗瑟尔"], ["St. Clair", "圣克莱"], ["Talbot", "塔尔博"], ["Urdin", "乌尔丁"],
  ["Varenne", "瓦雷恩"], ["Weston", "韦斯顿"], ["Isterlin", "伊斯特林"], ["Zeland", "泽兰"], ["Amont", "阿蒙特"],
  ["Brechaud", "布雷肖"], ["Corwin", "科尔温"], ["Durand", "杜兰德"], ["Escou", "埃斯库"], ["Frenna", "弗伦纳"],
  ["Grevaux", "格雷沃"], ["Haffen", "哈芬"], ["Lennard", "莱纳德"], ["Montfort", "蒙福尔"], ["Navarre", "纳瓦尔"],
  ["Ordin", "奥尔丁"], ["Picaron", "皮卡隆"], ["Questel", "奎斯特"], ["Regnier", "雷尼耶"], ["Sorel", "索雷尔"],
  ["Treva", "特雷瓦"], ["Walz", "瓦尔茨"], ["Winter", "温特"], ["Brenner", "布伦纳"], ["Dewar", "德瓦尔"],
];

/** 通用男名（西方，混合风味）。 */
const GIVEN_M_PAIRS: readonly NamePair[] = [
  ["Adric", "阿德里克"], ["Bartolo", "巴托罗"], ["Caspar", "卡斯帕"], ["Damian", "达米安"], ["Elian", "埃利安"],
  ["Fabian", "法比安"], ["Grigo", "格里戈"], ["Horace", "霍拉斯"], ["Isidor", "伊西多"], ["Julian", "朱利安"],
  ["Cassian", "卡西安"], ["Leander", "利安德"], ["Matthias", "马蒂亚斯"], ["Nicolan", "尼科兰"], ["Osva", "奥斯瓦"],
  ["Perrin", "佩兰"], ["Quentin", "昆廷"], ["Renard", "雷纳德"], ["Sebarin", "塞巴林"], ["Trian", "特里安"],
  ["Urban", "乌尔班"], ["Valen", "瓦伦"], ["Vikran", "维克兰"], ["Xavier", "泽维尔"], ["Aldin", "阿尔丁"],
  ["Benedict", "贝内迪克"], ["Clement", "克莱门"], ["Desiran", "德西兰"], ["Elwin", "埃尔文"], ["Fredrik", "弗雷德里"],
  ["Gilbert", "吉尔伯"], ["Hilarion", "希拉里恩"], ["Ignac", "伊格纳"], ["Janos", "雅诺斯"], ["Leon", "莱昂"],
  ["Maxim", "马克西"], ["Norbert", "诺伯特"], ["Aurel", "奥雷尔"], ["Prosper", "普罗斯珀"], ["Rodrian", "罗德里安"],
  ["Sylvan", "西尔万"], ["Tadeo", "塔德奥"], ["Hubert", "于贝尔"], ["Valentin", "瓦伦丁"], ["Sioran", "西奥兰"],
];

/** 通用女名（西方，混合风味）。 */
const GIVEN_F_PAIRS: readonly NamePair[] = [
  ["Adeline", "阿德琳"], ["Beatris", "贝阿丽斯"], ["Celeste", "塞莱斯特"], ["Daphline", "达芙琳"], ["Eliane", "埃莉安"],
  ["Fiora", "菲奥拉"], ["Gisela", "吉塞拉"], ["Helena", "海伦娜"], ["Isaline", "伊莎琳"], ["Justine", "茱丝汀"],
  ["Carissa", "卡丽莎"], ["Leonora", "莉奥诺拉"], ["Madeline", "玛德琳"], ["Nicolet", "妮科莱"], ["Audrina", "奥德莉娜"],
  ["Penella", "佩内拉"], ["Rosanne", "罗莎妮"], ["Sabina", "萨宾娜"], ["Tamira", "塔米拉"], ["Ulrica", "乌丽卡"],
  ["Violet", "薇奥莱"], ["Yvette", "伊薇特"], ["Zelina", "泽琳娜"], ["Aslyn", "阿丝琳"], ["Blanca", "布兰卡"],
  ["Corinna", "科琳娜"], ["Delphina", "德尔菲娜"], ["Evelyn", "艾薇琳"], ["Flora", "弗洛拉"], ["Greta", "格蕾塔"],
  ["Hermina", "赫米娜"], ["Irina", "伊琳娜"], ["Joceline", "约瑟琳"], ["Laurel", "劳蕾尔"], ["Mireille", "米蕾耶"],
  ["Nora", "诺拉"], ["Olivia", "奥莉维娅"], ["Priscilla", "普丽西拉"], ["Rovella", "罗薇拉"], ["Silvia", "西尔维娅"],
  ["Theresia", "特蕾西娅"], ["Valerie", "瓦莱丽"], ["Veronica", "薇洛妮卡"], ["Carlotta", "卡洛塔"], ["Merian", "梅丽安"],
];

const zhOf = (list: readonly NamePair[]): readonly string[] => list.map((p) => p[1]);

/** 通用姓氏（中文，西方混合风味）。 */
export const SURNAMES: readonly string[] = zhOf(SURNAME_PAIRS);
/** 通用男名（中文，西方混合风味）。 */
export const GIVEN_M: readonly string[] = zhOf(GIVEN_M_PAIRS);
/** 通用女名（中文，西方混合风味）。 */
export const GIVEN_F: readonly string[] = zhOf(GIVEN_F_PAIRS);

// ── 各文化的风味名池 ──

interface Culture {
  /** 男名、女名 */
  given: readonly [readonly NamePair[], readonly NamePair[]];
  surnames: readonly NamePair[];
  /** true：“姓名”（东方）；false：“名·姓” */
  eastern: boolean;
}

const CULTURES: Readonly<Record<ArchStyle, Culture>> = {
  // 地中海（埃斯佩兰王国）：阳光、石拱与葡萄园——意大利 / 西班牙风
  mediterranean: {
    given: [
      [
        ["Alvario", "阿尔瓦里奥"], ["Bernardo", "贝尔纳多"], ["Casimiro", "卡斯米罗"], ["Darios", "达里奥斯"], ["Esteban", "埃斯特班诺"],
        ["Felicio", "费利西奥"], ["Garceran", "加尔塞兰"], ["Isardo", "伊萨尔多"], ["Lorencio", "洛伦西奥"], ["Mariano", "马里亚诺"],
        ["Nicanor", "尼卡诺尔"], ["Aurelio", "奥雷利奥"], ["Peraldo", "佩拉尔多"], ["Ramondo", "拉蒙多"], ["Severino", "塞韦里诺"],
        ["Tomasino", "托马西诺"], ["Valencio", "瓦伦西奥"], ["Javiran", "哈维兰"], ["Enrico", "恩里科斯"], ["Ignarro", "伊格纳罗"],
      ],
      [
        ["Amaranta", "阿玛兰塔"], ["Berenice", "贝雷尼丝"], ["Casilda", "卡西尔达"], ["Doloreta", "多洛蕾塔"], ["Estela", "艾丝特拉"],
        ["Floriana", "弗洛丽安娜"], ["Graciela", "格拉西拉"], ["Inesita", "伊内丝塔"], ["Lucienda", "露西恩达"], ["Maricela", "玛丽塞拉"],
        ["Nivia", "妮维娅"], ["Orose", "奥罗丝"], ["Paloma", "帕洛玛"], ["Rosalba", "罗莎尔芭"], ["Celestina", "塞莱斯蒂娜"],
        ["Teresita", "特蕾西塔"], ["Vicenta", "维森塔"], ["Jacinta", "哈辛塔"], ["Isavela", "伊莎维拉"], ["Consuelo", "孔苏埃洛"],
      ],
    ],
    surnames: [
      ["de Villamor", "德·维拉莫"], ["Alcazar", "阿尔卡萨"], ["Belmonte", "贝尔蒙特"], ["Castellano", "卡斯特拉诺"], ["de la Rocca", "德·拉·罗卡"],
      ["Espasa", "埃斯帕萨"], ["Ferreras", "费雷拉斯"], ["Galvez", "加尔韦斯"], ["Ibarra", "伊巴拉"], ["Lozano", "洛萨诺"],
      ["Montalvo", "蒙塔尔沃"], ["Navarrete", "纳瓦雷特"], ["Olivera", "奥利韦拉"], ["Penarrosa", "佩尼亚罗萨"], ["Quiroga", "基罗加"],
      ["Saldana", "萨尔达尼亚"], ["Tavares", "塔瓦雷斯"], ["de Sores", "德·索雷斯"],
    ],
    eastern: false,
  },
  // 北地（诺德海姆公国）：峡湾、雪松与长船——斯堪的纳维亚风
  nordic: {
    given: [
      [
        ["Asvel", "阿斯韦尔"], ["Brennor", "布伦诺尔"], ["Dagvid", "达格维德"], ["Einar", "埃纳尔"], ["Frodi", "弗罗迪"],
        ["Gunnar", "古纳尔"], ["Halvard", "哈尔瓦德"], ["Ingvir", "英维尔"], ["Ketil", "凯蒂尔"], ["Leif", "莱夫斯"],
        ["Magnar", "马格纳尔"], ["Nilsten", "尼尔斯坦"], ["Oddvar", "奥德瓦尔"], ["Ragvar", "拉格瓦尔"], ["Sveind", "斯韦恩德"],
        ["Thorgrin", "索尔格林"], ["Ulf", "乌尔夫"], ["Vigge", "维格斯"],
      ],
      [
        ["Astra", "阿斯特拉"], ["Brynda", "布琳妲"], ["Dagny", "达格尼"], ["Elvi", "艾尔薇"], ["Frida", "芙丽达"],
        ["Gudrun", "古德伦"], ["Hildga", "希尔德加"], ["Ingrid", "英格丽德"], ["Karin", "卡丽恩"], ["Liv", "莉芙"],
        ["Martina", "玛尔蒂娜"], ["Signe", "西格妮"], ["Tove", "托薇"], ["Vigdis", "薇格迪丝"], ["Solvei", "索尔薇"],
        ["Ranhild", "兰希尔"], ["Irma", "伊尔玛"], ["Svana", "斯瓦娜"],
      ],
    ],
    surnames: [
      ["Holmstrand", "霍尔姆斯特兰"], ["Strand", "斯特兰德"], ["Lundberg", "伦德贝里"], ["Valdal", "瓦尔达尔"], ["Skagne", "斯卡格奈"],
      ["Nordvik", "诺德维克"], ["Bergren", "贝格伦"], ["Lindholm", "林德霍姆"], ["Isford", "伊斯福德"], ["Gunnarson", "冈纳松"],
      ["Frosta", "弗罗斯塔"], ["Helmo", "海尔莫"], ["Kjelstad", "谢尔斯塔"], ["Osterbe", "奥斯特贝"], ["Viklund", "维克伦"],
      ["Sundholm", "松德霍尔"],
    ],
    eastern: false,
  },
  // 低地（范德兰联省）：运河、风车与账簿——荷兰 / 佛兰德风
  lowland: {
    given: [
      [
        ["Barend", "巴伦德"], ["Cornelis", "科内利斯"], ["Dirk", "德克"], ["Evert", "埃弗特"], ["Floris", "弗洛里斯"],
        ["Gerrit", "赫里特"], ["Hendrik", "亨德里克"], ["Jans", "扬斯"], ["Kasper", "卡斯珀"], ["Laurens", "劳伦斯"],
        ["Maarten", "马腾"], ["Rutger", "鲁特格"], ["Simoen", "西蒙恩"], ["Thijs", "蒂斯"], ["Wout", "沃特"],
        ["Auke", "奥克"], ["Huybert", "许贝特"], ["Jeroen", "耶伦"],
      ],
      [
        ["Anneke", "安妮克"], ["Bertje", "贝尔特耶"], ["Katrijn", "卡特琳"], ["Diwina", "迪威娜"], ["Ester", "埃斯特尔"],
        ["Fleur", "弗莱尔"], ["Geertruy", "赫特鲁伊"], ["Ilse", "伊尔瑟"], ["Jorien", "约里恩"], ["Liesbet", "莉斯贝特"],
        ["Marieke", "玛丽克"], ["Nele", "内勒"], ["Rosmarijn", "罗斯玛丽恩"], ["Saskia", "萨斯琪"], ["Tineke", "蒂内克"],
        ["Willemien", "维勒米恩"], ["Hanneke", "汉内克"], ["Mient", "米恩特"],
      ],
    ],
    surnames: [
      ["van der Molen", "范·德·莫伦"], ["van Brekel", "范·布雷克尔"], ["de Haaf", "德·哈弗"], ["Hooghland", "霍赫兰德"], ["van Lint", "范·林特"],
      ["Stenwijk", "斯滕维克"], ["de Kleine", "德·克莱纳"], ["van Oster", "范·奥斯特"], ["Broekaert", "布鲁卡特"], ["van Hems", "范·赫姆斯"],
      ["Westerling", "韦斯特林"], ["van Duren", "范·杜伦"], ["Konings", "科宁斯"], ["de Boer", "德·博尔"], ["van Ack", "范·阿克"],
      ["Mertens", "梅尔滕斯"],
    ],
    eastern: false,
  },
  // 沙漠（卡迪尔苏丹国）：驼队、香料与星空——阿拉伯 / 波斯风
  desert: {
    given: [
      [
        ["Adil", "阿迪尔"], ["Bashir", "巴希尔"], ["Dawud", "达乌德"], ["Faris", "法里斯"], ["Hashim", "哈希姆"],
        ["Idris", "伊德里斯"], ["Jamil", "贾米尔"], ["Karim", "卡里姆"], ["Mahdi", "马赫迪"], ["Nadir", "纳迪尔"],
        ["Rashid", "拉希德"], ["Samir", "萨米尔"], ["Tariq", "塔里克"], ["Yusuf", "优素夫"], ["Zayd", "扎伊德"],
        ["Azlan", "阿兹兰"], ["Khalid", "哈里德"], ["Murad", "穆拉德"],
      ],
      [
        ["Amira", "阿米拉"], ["Bashira", "巴希拉"], ["Dalia", "达莉亚"], ["Farida", "法丽达"], ["Hania", "哈妮娅"],
        ["Jana", "贾娜"], ["Karima", "卡丽玛"], ["Laila", "莱拉"], ["Mina", "米娜"], ["Nahid", "纳希德"],
        ["Safiya", "萨菲娅"], ["Tara", "塔拉"], ["Lubna", "露卜娜"], ["Zahra", "扎赫拉"], ["Nur", "努尔"],
        ["Hanan", "哈娜恩"], ["Suraya", "苏拉雅"], ["Wafiya", "瓦菲雅"],
      ],
    ],
    surnames: [
      ["ibn Salim", "伊本·萨利姆"], ["al-Hadi", "阿尔-哈迪"], ["ben Azra", "本·阿兹拉"], ["al-Falah", "阿尔-法拉赫"], ["Sabri", "萨布里"],
      ["Qadiri", "卡迪里"], ["al-Maz", "阿尔-马兹"], ["Najjar", "纳贾尔"], ["ibn Rashi", "伊本·拉希"], ["al-Zuhair", "阿尔-祖海尔"],
      ["Hamdan", "哈姆丹"], ["Bakri", "巴克里"], ["al-Sadi", "阿尔-萨迪"], ["ibn Hasan", "伊本·哈桑"], ["Maghri", "马格里"],
      ["al-Qasim", "阿尔-卡西姆"],
    ],
    eastern: false,
  },
  // 群岛（马纳瓦群岛议会）：潮汐、珊瑚与星辰航路——波利尼西亚风
  islands: {
    given: [
      [
        ["Akano", "阿卡诺"], ["Ikai", "伊卡伊"], ["Kahanu", "卡哈努"], ["Keloa", "凯洛阿"], ["Malu", "马卢"],
        ["Noaka", "诺亚卡"], ["Pakai", "帕卡伊"], ["Tane", "塔内"], ["Weka", "韦卡"], ["Hoku", "霍库"],
        ["Laukai", "劳卡伊"], ["Kimo", "基莫"], ["Makana", "马卡纳"], ["Keawe", "凯阿维"], ["Tika", "蒂卡"],
        ["Olu", "奥卢"],
      ],
      [
        ["Alani", "阿拉尼"], ["Ilima", "伊莉玛"], ["Kelani", "凯拉尼"], ["Leialu", "莱娅卢"], ["Malana", "玛拉娜"],
        ["Noelani", "诺埃拉尼"], ["Pania", "帕尼娅"], ["Talia", "塔丽娅"], ["Wena", "韦娜"], ["Kanoa", "卡诺娅"],
        ["Hokulani", "霍库拉尼"], ["Pua", "普阿"], ["Laulani", "劳拉妮"], ["Malia", "马莉娅"], ["Kiana", "基阿娜"],
        ["Oheli", "奥赫莉"],
      ],
    ],
    surnames: [
      ["Kahale", "卡哈莱"], ["Makaa", "马卡阿"], ["Wailua", "瓦伊卢阿"], ["Nalu", "纳卢"], ["Hoola", "霍奥拉"],
      ["Kealu", "凯阿卢"], ["Puanui", "普阿努伊"], ["Kaima", "卡伊马"], ["Ahui", "阿胡伊"], ["Laumana", "劳马纳"],
      ["Palaka", "帕拉卡"], ["Tavere", "塔韦雷"], ["Mokai", "莫凯"], ["Iolani", "伊奥拉尼"],
    ],
    eastern: false,
  },
  // 东方（瑶华帝国）：山水、丝绸与瓷器——中文“姓名”，不加间隔号；英文为汉语拼音 “Surname Given”
  eastern: {
    given: [
      [
        ["Yuan", "远"], ["Zhou", "舟"], ["Chuan", "川"], ["Haisheng", "海生"], ["Mingyuan", "明远"],
        ["Wenxuan", "文轩"], ["Zihang", "子航"], ["Boyan", "伯言"], ["Zhongda", "仲达"], ["Shuping", "叔平"],
        ["Jingxing", "景行"], ["Huai'an", "怀安"], ["Zhiyuan", "志远"], ["Chengzong", "承宗"], ["Dechang", "德昌"],
        ["Shouzhuo", "守拙"], ["Licheng", "立诚"], ["Jingzhi", "敬之"], ["Yunfan", "云帆"], ["Changfeng", "长风"],
        ["Wangshu", "望舒"], ["Ruogu", "若谷"], ["Bowen", "博文"], ["Zhensheng", "振声"], ["Mingqi", "鸣岐"],
        ["Chongli", "崇礼"], ["Boyong", "伯庸"], ["Dingshan", "定山"], ["Pengcheng", "鹏程"], ["Jihe", "季和"],
        ["Hong", "宏"], ["Jun", "峻"], ["Yue", "越"], ["Heng", "衡"], ["Yan", "岩"],
        ["Xiang", "翔"], ["Jun", "骏"], ["Lang", "朗"], ["Yi", "毅"], ["Heng", "恒"],
        ["Cuisong", "翠松"], ["Lanshan", "岚山"], ["Qingyuan", "清远"], ["Wenyuan", "文渊"], ["Yayan", "雅言"],
        ["Xiuzhu", "修竹"], ["Moqing", "墨卿"], ["Songnian", "松年"],
      ],
      [
        ["Lan", "岚"], ["Xi", "汐"], ["Heng", "蘅"], ["Suyun", "素云"], ["Wanqing", "婉清"],
        ["Ruolan", "若兰"], ["Mengdie", "梦蝶"], ["Yingyue", "映月"], ["Lin", "琳"], ["Yao", "瑶"],
        ["Jing", "婧"], ["Xuan", "璇"], ["Zhi", "芷"], ["Yin", "茵"], ["Jia", "葭"],
        ["Rong", "蓉"], ["Lian", "莲"], ["Hui", "蕙"], ["Ling", "菱"], ["Ping", "萍"],
        ["Fei", "霏"], ["Yue'e", "月娥"], ["Qiushui", "秋水"], ["Ningxiang", "凝香"], ["Nianci", "念慈"],
        ["Ruyi", "如意"], ["Caiwei", "采薇"], ["Qingge", "清歌"], ["Wanqing", "晚晴"], ["Huaping", "画屏"],
        ["Jinshu", "锦书"], ["Hongxiao", "红绡"], ["Bitao", "碧桃"], ["Wan", "宛"], ["Tang", "棠"],
        ["Xing", "杏"], ["Ling", "苓"], ["Dai", "黛"], ["Yu", "钰"], ["Ling", "翎"],
        ["Cuiwei", "翠微"], ["Lanyan", "岚烟"], ["Qingdai", "青黛"], ["Yayin", "雅音"], ["Bixiao", "碧箫"],
        ["Zhujun", "竹君"], ["Lanxin", "兰心"], ["Yuzan", "玉簪"],
      ],
    ],
    surnames: [
      ["Chen", "陈"], ["Lin", "林"], ["Shen", "沈"], ["Gu", "顾"], ["Su", "苏"],
      ["Zhou", "周"], ["Wu", "吴"], ["Zheng", "郑"], ["Wang", "王"], ["Li", "李"],
      ["Zhang", "张"], ["Liu", "刘"], ["Yang", "杨"], ["Zhao", "赵"], ["Huang", "黄"],
      ["He", "何"], ["Gao", "高"], ["Luo", "罗"], ["Liang", "梁"], ["Song", "宋"],
      ["Tang", "唐"], ["Xu", "许"], ["Han", "韩"], ["Feng", "冯"], ["Deng", "邓"],
      ["Cao", "曹"], ["Peng", "彭"], ["Zeng", "曾"], ["Xiao", "萧"], ["Tian", "田"],
      ["Dong", "董"], ["Pan", "潘"], ["Yuan", "袁"], ["Cai", "蔡"], ["Jiang", "蒋"],
      ["Yu", "余"], ["Du", "杜"], ["Ye", "叶"], ["Cheng", "程"], ["Wei", "魏"],
      ["Liu", "柳"], ["Wen", "温"], ["Ji", "纪"], ["Chu", "楚"], ["Yue", "岳"],
      ["Ouyang", "欧阳"], ["Situ", "司徒"], ["Shangguan", "上官"], ["Murong", "慕容"], ["Yuwen", "宇文"],
    ],
    eastern: true,
  },
  // 开拓者殖民地：新大陆的拓荒者——英语殖民地风（另有一半名字来自各地移民，见 npcNameParts）
  frontier: {
    given: [
      [
        ["Elias", "伊莱亚斯"], ["Silas", "塞拉斯"], ["Jed", "杰德"], ["Caleb", "卡勒布"], ["Orin", "奥林"],
        ["Ward", "沃德"], ["Brigg", "布里格"], ["Hollo", "霍洛"], ["Ezlin", "埃兹林"], ["Nathaniel", "纳撒尼"],
        ["Rufus", "鲁弗斯"], ["Cyran", "西拉恩"], ["Hannes", "汉尼斯"], ["Lothran", "卢瑟兰"], ["Tobiah", "托比亚"],
        ["Morris", "莫里斯"],
      ],
      [
        ["Maisie", "梅茜"], ["Odella", "奥黛拉"], ["Roslyn", "萝丝琳"], ["Vera", "薇拉"], ["Hannah", "汉娜"],
        ["Jessamy", "杰西米"], ["Polly", "珀莉"], ["Lillian", "莉莉安"], ["Clara", "克莱拉"], ["Bessie", "贝茜"],
        ["Millie", "米莉"], ["Rosna", "露丝娜"], ["Adaline", "艾达琳"], ["Mabel", "梅布尔"], ["Opal", "奥珀"],
        ["Winnie", "温妮"],
      ],
    ],
    surnames: [
      ["Stonefield", "斯通菲尔德"], ["Holloway", "霍洛韦"], ["Wheeler", "惠勒"], ["Hartwell", "哈特维尔"], ["Finchley", "芬奇利"],
      ["Oakes", "奥克斯"], ["Ryder", "莱德"], ["Whitmore", "惠特莫尔"], ["Waterfell", "沃特菲尔"], ["Blackthorn", "布莱克索恩"],
      ["Cragg", "克拉格"], ["Millward", "米尔沃德"], ["Ashburn", "艾什伯恩"], ["Barrows", "巴罗斯"],
    ],
    eastern: false,
  },
};

/** 名字的组成：名、姓，以及是否按东方的“姓名”顺序书写；中文与英文各一套。 */
export interface NameParts {
  given: string;
  surname: string;
  eastern: boolean;
  /** 最终显示的中文姓名（“名·姓”或“姓名”） */
  text: string;
  /** 英文原形：名、姓与最终显示的姓名（“Given Surname”或东方的 “Surname Given”） */
  en: { given: string; surname: string; text: string };
}

/** 同一个人的中文名与英文名（BiName 的两行）。 */
export interface NamePairText {
  zh: string;
  en: string;
}

function unique(list: readonly string[]): string[] {
  return [...new Set(list)];
}

/** 某性别、某文化可用的全部名字（中文；港口通用名池 + 该文化的风味名池），用于测试与编辑参考。 */
export function givenPool(female: boolean, region?: ArchStyle): readonly string[] {
  const base = female ? GIVEN_F : GIVEN_M;
  return region ? unique(base.concat(zhOf(CULTURES[region].given[female ? 1 : 0]))) : base;
}

/** 某文化可用的全部姓氏（中文；港口通用 + 该文化）。 */
export function surnamePool(region?: ArchStyle): readonly string[] {
  return region ? unique(SURNAMES.concat(zhOf(CULTURES[region].surnames))) : SURNAMES;
}

/** 全部名字（两性、所有文化）的数量，用于检查名字表的规模。 */
export function nameTableSize(): { surnames: number; male: number; female: number } {
  const all = Object.values(CULTURES);
  return {
    surnames: new Set(SURNAMES.concat(...all.map((c) => zhOf(c.surnames)))).size,
    male: new Set(GIVEN_M.concat(...all.map((c) => zhOf(c.given[0])))).size,
    female: new Set(GIVEN_F.concat(...all.map((c) => zhOf(c.given[1])))).size,
  };
}

/** 全部成对的名字（按名池分组），用于测试英文原形的格式与编辑参考。 */
export function namePairTables(): { pool: string; eastern: boolean; pairs: readonly NamePair[] }[] {
  const out: { pool: string; eastern: boolean; pairs: readonly NamePair[] }[] = [
    { pool: "surnames", eastern: false, pairs: SURNAME_PAIRS },
    { pool: "given.m", eastern: false, pairs: GIVEN_M_PAIRS },
    { pool: "given.f", eastern: false, pairs: GIVEN_F_PAIRS },
  ];
  for (const [style, c] of Object.entries(CULTURES)) {
    out.push({ pool: `${style}.surnames`, eastern: c.eastern, pairs: c.surnames });
    out.push({ pool: `${style}.given.m`, eastern: c.eastern, pairs: c.given[0] });
    out.push({ pool: `${style}.given.f`, eastern: c.eastern, pairs: c.given[1] });
  }
  return out;
}

/**
 * 由种子生成姓名的组成部分（中文与英文）；同一个种子（与相同的性别、文化）永远得到同一个结果。
 * 指定文化时约五分之一是外来者（港口通用的西方名）；开拓者殖民地有一半是各地来的移民。
 */
export function npcNameParts(seed: string | number, female = false, region?: ArchStyle, style?: string | null): NameParts {
  const r = rng(`name-${seed}`);
  const g = female ? 1 : 0;
  // 寰宇的名字文化：按势力的细风格取当地名字池，不混入外来者
  const local = nameCulture(style);
  let culture: Culture | null = local ?? (region ? CULTURES[region] : null);
  if (local) {
    // 照用
  } else if (region === "frontier") culture = r.chance(0.5) ? culture : null;
  else if (culture && r.chance(0.2)) culture = null;
  const [givenEn, given] = culture ? r.pick(culture.given[g]) : r.pick(female ? GIVEN_F_PAIRS : GIVEN_M_PAIRS);
  const [surnameEn, surname] = culture ? r.pick(culture.surnames) : r.pick(SURNAME_PAIRS);
  const eastern = culture?.eastern ?? false;
  return {
    given,
    surname,
    eastern,
    text: eastern ? surname + given : `${given}·${surname}`,
    en: { given: givenEn, surname: surnameEn, text: eastern ? `${surnameEn} ${givenEn}` : `${givenEn} ${surnameEn}` },
  };
}

/** 势力的细风格 → 名字文化的名池（中国用东方名池）；没有名字文化时为 null。 */
export function nameCulture(style: string | null | undefined): Culture | null {
  const key = style && Object.prototype.hasOwnProperty.call(NAME_CULTURE_OF, style) ? NAME_CULTURE_OF[style] : null;
  if (!key) return null;
  if (key === "chinese") return CULTURES.eastern;
  const c = Object.prototype.hasOwnProperty.call(CULTURE_NAMES, key) ? CULTURE_NAMES[key] : null;
  return c ? { given: [c.given_m, c.given_f], surnames: c.surnames, eastern: c.eastern } : null;
}

/** 由种子生成一个中文姓名；同一个种子（与相同的性别、文化）永远得到同一个名字。 */
export function npcName(seed: string | number, female = false, region?: ArchStyle): string {
  return npcNameParts(seed, female, region).text;
}

/** 由种子生成一个英文姓名（npcName 的拉丁字母原形）。 */
export function npcNameEn(seed: string | number, female = false, region?: ArchStyle): string {
  return npcNameParts(seed, female, region).en.text;
}

/** 同一个种子的中文名与英文名（给 BiName 显示：中文界面两行，英文界面只显示英文）。 */
export function npcNamePair(seed: string | number, female = false, region?: ArchStyle, style?: string | null): NamePairText {
  const p = npcNameParts(seed, female, region, style);
  return { zh: p.text, en: p.en.text };
}
