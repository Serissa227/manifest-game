// 海上按海域换曲：舰队所在的海区 → 航海曲的地域（纯函数）。
//
// 七种地域各有一首航海曲，都是 6/8 或慢 4/4 的“航行”律动，旋律与配器带各地的风味（见 tracks/）：
// - inner 地中海式的内海：《维斯塔海的风》；north 北方寒冷的海域：《北风与白鲸》；south 沙漠海岸与南方海路：《驼铃与海风》；
// - islands 南洋群岛：《信风群岛》；eastern 东方海域：《瑶华季风》；newworld 新大陆沿岸：《阿斯特里亚的海岸》；ocean 远洋：《晨星洋》。
//
// 海区的归属按 data/world/regions.toml 的顺序写成一张表（那里的 key 只允许追加，编号不会变）：
// 地域是对每片海的“气质”的设定——白鲸海、守望海虽然岸上有埃斯佩兰、范德兰的港口，仍是北方的冷海；
// 巨人之门、晨光海、晨星洋与孤灯海是远离海岸的大洋航线。表里没有的海区（以后追加的）按停泊在那片海的港口多半属于哪种文化推断，
// 只有殖民点时算新大陆，什么都没有时按坐标（旧世界的内海 / 外洋）。后端没有给出海区（旧后端）时也按坐标，与原来的两首一致。
//
// 第九批的世界（FRAMEWORK §15.1）：海区数据的 music 字段（音乐分区）写了就以它为准（seaTrackOf），上面的表与坐标规则只在没写时用——
// 经典世界的海区不写 music，行为不变。music 可以直接写曲目编号（sea_iberia……），也可以写音乐分区的名字（iberia、indian_ocean……，见 MUSIC_ZONE_TRACK）；
// 不认识的名字当没写。还没有专属航海曲的分区先借最接近的一首。
// 港口曲同理（portTrackOf）：势力的建筑风格有专属的新文化港口曲时直接用它，否则经 TOWN_ALIASES 回退到最接近的已有风格。
// 只认风格名与海区的 music，不认任何世界的势力 key、地点 key 或海区 key（FRAMEWORK §2“引擎不认识内容”）：
// 寰宇世界的势力在数据里写文化细名（english、siamese、ottoman_maghreb……，2026-10-11 配乐的数据接线），街景由 TOWN_ALIASES 回退。
// 停泊处所在海区的 music 可以再换一次（portTrackIn）：爱琴海与黎凡特海上地中海与意大利风格的港口——希腊人的岛——放《酒色的海湾》；
// 红海、亚丁湾、波斯湾、阿拉伯海上奥斯曼、伊比利亚与沙漠风格的港口——城里是阿拉伯人——放《乳香与咖啡的码头》。
import { styleOf, townStyleOf, type ArchStyle } from "../art/buildings";
import type { StaticView } from "../ipc/types";
import { phaseOf } from "../time/daylight";
import type { ScenePool } from "./pools";
import { isTrackId, type TrackId } from "./tracks";

/** 航海曲的地域。 */
export type SeaZone = "inner" | "north" | "south" | "islands" | "eastern" | "newworld" | "ocean";

/** 旧世界的范围（EXPANSION.md §3：新区域是 x ≥ 240 或 y ≥ 120）。 */
export const OLD_WORLD = { w: 240, h: 120 } as const;

/** regions.toml 的海区 key（按文件顺序，编号即海区 id）与它的地域。 */
export const REGION_ZONES: readonly (readonly [string, SeaZone])[] = [
  ["frost_west", "north"], // 白鲸海
  ["icespring", "north"], // 伊斯布伦海
  ["pine_sea", "north"], // 法尔克海
  ["north_watch", "north"], // 守望海
  ["cuilan_sea", "inner"], // 埃斯佩兰海
  ["lighthouse", "islands"], // 拉玛塔海（拉玛塔岛、阿卡科拉：群岛议会的港口）
  ["tide_sea", "islands"], // 马纳瓦海
  ["golden_sea", "inner"], // 范德兰海
  ["fog_cape", "inner"], // 布鲁玛海
  ["sand_gate", "south"], // 巴布拉姆海
  ["flame_bay", "south"], // 哈拉海
  ["camel_sea", "south"], // 贾马尔海
  ["giants_gate", "ocean"], // 巨人之门
  ["frost_reach", "north"], // 霜语海
  ["dawn_sea", "ocean"], // 晨光海（去新大陆的北部航道）
  ["silvermist", "newworld"], // 银雾海
  ["emerald", "newworld"], // 翡翠海
  ["red_reef", "newworld"], // 赤礁海
  ["morningstar", "ocean"], // 晨星洋
  ["lonely_sea", "ocean"], // 孤灯海
  ["yaohua_sea", "eastern"], // 瑶华海
  ["yunyu_sea", "eastern"], // 云屿海
  ["south_waste", "south"], // 南荒海（卡迪尔西南的热带海湾）
];

/** 地域 → 航海曲。 */
export const ZONE_TRACK: Readonly<Record<SeaZone, TrackId>> = {
  inner: "sea",
  north: "sea_north",
  south: "sea_south",
  islands: "sea_islands",
  eastern: "sea_east",
  newworld: "sea_new",
  ocean: "ocean",
};

/** 港口的建筑风格（文化）→ 地域（推断表里没有的海区用）。 */
const STYLE_ZONE: Readonly<Record<ArchStyle, SeaZone>> = {
  mediterranean: "inner",
  lowland: "inner",
  nordic: "north",
  desert: "south",
  islands: "islands",
  eastern: "eastern",
  frontier: "newworld",
};

/**
 * 舰队所在处的航海曲地域。region 为舰队所在的海区（概览的 local_weather.region），pos 为舰队的坐标。
 */
export function seaZoneOf(region: number | null | undefined, pos: { x: number; y: number } | null | undefined, statics: StaticView | null): SeaZone {
  if (typeof region === "number" && Number.isInteger(region) && region >= 0) {
    if (region < REGION_ZONES.length) return REGION_ZONES[region][1];
    const guess = cultureZone(region, statics);
    if (guess) return guess;
  }
  const old = !pos || (pos.x < OLD_WORLD.w && pos.y < OLD_WORLD.h);
  return old ? "inner" : "ocean";
}

/**
 * 表里没有的海区：停泊在这片海的港口与城市多半属于哪种文化（殖民点算新大陆）；票数相同时取先出现的（按地点顺序，结果确定）。
 * 这片海没有任何停泊处时为 null。
 */
function cultureZone(region: number, statics: StaticView | null): SeaZone | null {
  if (!statics) return null;
  const votes = new Map<SeaZone, number>();
  for (const loc of statics.locations) {
    if (loc.region !== region) continue;
    let zone: SeaZone;
    if (loc.kind === "site") zone = "newworld";
    else {
      const f = statics.factions[loc.faction];
      zone = STYLE_ZONE[styleOf(f?.key, f?.style)];
    }
    votes.set(zone, (votes.get(zone) ?? 0) + 1);
  }
  let best: SeaZone | null = null;
  let most = 0;
  for (const [zone, n] of votes) {
    if (n > most) {
      best = zone;
      most = n;
    }
  }
  return best;
}

/**
 * 音乐分区的名字（海区数据的 music 字段，TERRA16 §3.2 的十二个分区与经典世界的七种地域）→ 航海曲。
 * 同一个分区收几种常见的写法；还没有专属航海曲的分区（斯瓦希里海岸）先借最接近的一首。
 */
export const MUSIC_ZONE_TRACK: Readonly<Record<string, TrackId>> = {
  // 经典世界的七种地域（与 ZONE_TRACK 相同）
  inner: "sea",
  north: "sea_north",
  south: "sea_south",
  islands: "sea_islands",
  eastern: "sea_east",
  newworld: "sea_new",
  ocean: "ocean",
  // 伊比利亚与大西洋沿岸
  iberia: "sea_iberia",
  iberian: "sea_iberia",
  atlantic: "sea_iberia",
  // 阿拉伯海与印度洋（季风）
  indian_ocean: "sea_monsoon",
  indian: "sea_monsoon",
  arabian_sea: "sea_monsoon",
  monsoon: "sea_monsoon",
  // 明的沿海（东海、南海北部）
  china: "sea_ming",
  chinese: "sea_ming",
  ming: "sea_ming",
  // 日本的内海与南海路
  japan: "sea_japan",
  japanese: "sea_japan",
  // 东海与黄海（第二阶段·东亚宫廷）：《瑶华季风》的地方乐器重编《东海的季风》；经典世界的 eastern 地域照旧是《瑶华季风》
  east_china_sea: "sea_east_china",
  donghai: "sea_east_china",
  yellow_sea: "sea_east_china",
  huanghai: "sea_east_china",
  bohai: "sea_east_china",
  east_asia: "sea_east_china",
  // 意大利与地中海（第二轮）
  mediterranean: "sea_med",
  italy: "sea_med",
  adriatic: "sea_med",
  aegean: "sea_med",
  // 北海与波罗的海（第二轮；经典世界的 north 地域照旧是《北风与白鲸》）
  hansa: "sea_hansa",
  baltic: "sea_hansa",
  north_sea: "sea_hansa",
  nordic: "sea_hansa",
  // 奥斯曼与黎凡特的海岸（第二轮；寰宇里黎凡特海、爱琴海、黑海、马尔马拉海写 levant）
  levant: "sea_levant",
  ottoman: "sea_levant",
  // 阿拉伯的海（地方特色第二阶段）：红海、亚丁湾、阿拉伯海、波斯湾（寰宇里写 arabic）原来也借《雪松与珊瑚》，
  // 那首由黎凡特的布祖克与爱琴海的里拉琴领奏，在这几片海不对，改成乌德琴、奈伊笛、克曼切领奏的《星与三角帆》
  arabic: "sea_arabic",
  red_sea: "sea_arabic",
  aden: "sea_arabic",
  persian_gulf: "sea_arabic",
  // 东南亚（第二轮）
  nusantara: "sea_nusantara",
  malacca: "sea_nusantara",
  java: "sea_nusantara",
  moluccas: "sea_nusantara",
  southeast_asia: "sea_nusantara",
  malay: "sea_nusantara",
  // 加勒比与中美（第二轮）
  caribbean: "sea_caribbean",
  yucatan: "sea_caribbean",
  antilles: "sea_caribbean",
  maya: "sea_caribbean",
  mesoamerica: "sea_caribbean",
  // 安第斯的太平洋沿岸（第二轮）
  andes: "sea_andes",
  andean: "sea_andes",
  peru: "sea_andes",
  // 远洋的太平洋（第二轮；地方特色第二阶段补上美拉尼西亚、密克罗尼西亚与大洋洲的写法）
  pacific: "sea_pacific",
  polynesia: "sea_pacific",
  micronesia: "sea_pacific",
  melanesia: "sea_pacific",
  oceania: "sea_pacific",
  // 黑暗之海与亚特兰蒂斯的外围（第二轮）
  dark_sea: "sea_dark",
  atlantis: "sea_dark",
  // 彼界：亚特兰蒂斯深处、精灵的七岛（第三轮）
  realm: "realm_elves",
  seven_isles: "realm_elves",
  elves: "realm_elves",
  // 印度沿岸的海（地方特色第二阶段）：马拉巴尔海岸、科罗曼德尔海岸、孟加拉湾与锡兰有自己的《雨季的船歌》；
  // 阿拉伯海与印度洋的远洋照旧是《季风之路》（上面的 indian_ocean、arabian_sea）。
  // 只写了笼统的 indian / indian_ocean / monsoon 的海区按停泊的港口再分（INDIAN_OCEAN_ZONES 与 indiaCoastOf，见下面）
  india: "sea_india",
  indian_coast: "sea_india",
  malabar: "sea_india",
  coromandel: "sea_india",
  bengal: "sea_india",
  bay_of_bengal: "sea_india",
  ceylon: "sea_india",
  // 斯瓦希里海岸还没有专属的航海曲：先借印度洋的一首
  swahili: "sea_monsoon",
  east_africa: "sea_monsoon",
  // 最北的海路（地方特色第二阶段）：挪威海、北角、巴伦支海与白海——《北风与白鲸》的旋律换成北方的地方乐器（sea_arctic）；
  // 经典世界的 north 地域照旧是《北风与白鲸》本身
  arctic: "sea_arctic",
  arctic_ocean: "sea_arctic",
  white_sea: "sea_arctic",
  barents: "sea_arctic",
  barents_sea: "sea_arctic",
  norwegian_sea: "sea_arctic",
  north_cape: "sea_arctic",
  // 非洲西岸与南大西洋的非洲一侧（地方特色第二阶段）：佛得角、几内亚湾、刚果河口外、安哥拉与本格拉。
  // 寰宇的 regions.toml（C12）里 cape_verde、guinea_gulf、angola、benguela 四个海区写 music = "west_africa"（2026-10-11 由 atlantic 改过来）；
  // 下面几个名字都认（也可以写海区自己的 key）。
  west_africa: "sea_guinea",
  west_african: "sea_guinea",
  cape_verde: "sea_guinea",
  senegambia: "sea_guinea",
  guinea: "sea_guinea",
  guinea_gulf: "sea_guinea",
  gulf_of_guinea: "sea_guinea",
  gold_coast: "sea_guinea",
  kongo: "sea_guinea",
  angola: "sea_guinea",
  benguela: "sea_guinea",
  african_atlantic: "sea_guinea",
  // 菲律宾南部的海（地方特色第二阶段：库林唐锣乐领奏的《苏禄海的锣》）；不写时这一带仍按“东南亚”走《丁香群岛的铜锣》
  sulu: "sea_sulu",
  sulu_sea: "sea_sulu",
  celebes_sea: "sea_sulu",
  philippines: "sea_sulu",
  philippine: "sea_sulu",
  mindanao: "sea_sulu",
  visayas: "sea_sulu",
  // 巴西沿岸（第二阶段·美洲）：《巴西海流》，图皮人划独木舟的歌（图皮的乐器领奏）；经典世界的 newworld 照旧是《阿斯特里亚的海岸》
  brazil: "sea_brazil",
  brazilian: "sea_brazil",
  brazil_current: "sea_brazil",
};

/** 海区数据的 music 字段规整成查表用的名字：不区分大小写，“-”与空格当“_”；没写时为 null。 */
function musicKey(music: string | null | undefined): string | null {
  if (typeof music !== "string" || !music.trim()) return null;
  return music.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

/** 海区数据的 music 字段 → 航海曲：曲目编号原样用，分区名查表（不区分大小写，“-”与空格当“_”）；不认识或没写时为 null。 */
export function musicTrackOf(music: string | null | undefined): TrackId | null {
  if (typeof music !== "string" || !music.trim()) return null;
  const raw = music.trim();
  if (isTrackId(raw)) return raw;
  const key = musicKey(raw);
  return key !== null && Object.prototype.hasOwnProperty.call(MUSIC_ZONE_TRACK, key) ? MUSIC_ZONE_TRACK[key] : null;
}

/**
 * 笼统的“印度洋”分区名（地方特色第二阶段·印度）：只写 music = "indian" 一类的海区，只按分区名查就放不到《雨季的船歌》
 * （terra16 的古吉拉特海、马拉巴尔海、锡兰海、孟加拉湾原来如此，2026-10-11 起在数据里写明 indian_coast、malabar、ceylon、bengal；
 * 斯瓦希里海、莫桑比克海峡、南印度洋等仍写 indian）。
 * 写这几个名字的海区再看停泊的港口（indiaCoastOf）：印度诸国的港口占多数时换成《雨季的船歌》，否则照表（《季风之路》）。
 * 写了更细的分区名（malabar、bengal……）、别的分区名（arabian_sea、swahili……）或直接写曲目编号的海区不再细分。
 */
export const INDIAN_OCEAN_ZONES: readonly string[] = ["indian", "indian_ocean", "monsoon"];

/** 印度诸国的港口曲（按风格名分到的三首：indian、北方宫廷与德干、南印度与锡兰）：停在这些港口的海算印度沿岸。 */
const INDIA_PORT_TRACKS: readonly TrackId[] = ["port_india", "port_mughal", "port_malabar"];

/**
 * 这片海的停泊处（港口与城市；殖民点不算，它不代表岸上的文化）里，港口曲是印度诸国那三首的是否多过其他的（相同时不算）。
 * 葡萄牙人占着的果阿、第乌、巴塞因按葡萄牙算——terra16 的古吉拉特海、马拉巴尔海、锡兰海、孟加拉湾仍是印度的港口占多数；
 * 马尔代夫（海岛风格）、安达曼海（东吁的勃固）、斯瓦希里海岸与没有港口的远洋都不是。
 */
export function indiaCoastOf(region: number, statics: StaticView): boolean {
  let india = 0;
  let other = 0;
  for (const loc of statics.locations) {
    if (loc.region !== region || loc.kind === "site") continue;
    const f = statics.factions[loc.faction];
    if (INDIA_PORT_TRACKS.includes(portTrackOf(f?.key, f?.style))) india++;
    else other++;
  }
  return india > other;
}

/**
 * 舰队所在处的航海曲：海区数据写了认得的 music 时用它，否则照经典的规则（seaZoneOf → ZONE_TRACK）。
 * 写的是笼统的印度洋（INDIAN_OCEAN_ZONES）而停泊的多半是印度诸国的港口时，放印度沿岸的《雨季的船歌》。
 */
export function seaTrackOf(region: number | null | undefined, pos: { x: number; y: number } | null | undefined, statics: StaticView | null): TrackId {
  if (typeof region === "number" && Number.isInteger(region) && region >= 0 && statics) {
    const view = statics.regions.find((r) => r.id === region);
    const track = musicTrackOf(view?.music);
    if (track) {
      const key = musicKey(view?.music);
      if (key !== null && INDIAN_OCEAN_ZONES.includes(key) && indiaCoastOf(region, statics)) return "sea_india";
      return track;
    }
  }
  return ZONE_TRACK[seaZoneOf(region, pos, statics)];
}

/**
 * 新文化的港口曲（城镇风格名 → 曲目）：六种文化城镇风格（TownStyle：日本、明、奥斯曼、斯瓦希里、马来、玛雅）各一首，
 * 另有几种还没有专属街景、但有专属港口曲的文化（印度与莫卧儿、安第斯与印加；地方特色第二阶段的伊比利亚、意大利、北欧诸地、
 * 阿拉伯与马穆鲁克、波斯、马格里布、暹罗、缅甸、菲律宾与大越、朝鲜、琉球、女真与满洲、阿兹特克、加勒比的泰诺、巴西的图皮、太平洋的岛民……街景照旧借最接近的风格，经典世界的势力不写这些风格名，经典的港口曲不变）。表里的名字直接用它的港口曲；
 * 不在表里的细名（爪哇、摩鹿加……）先经 TOWN_ALIASES 换成城镇风格再查一次（爪哇、摩鹿加 → 马来）。
 */
export const PORT_STYLE_TRACK: Readonly<Record<string, TrackId>> = {
  japanese: "port_japan",
  ming: "port_ming",
  ottoman: "port_ottoman",
  swahili: "port_swahili",
  malay: "port_malay",
  maya: "port_maya",
  // 街景借奥斯曼与玛雅，港口曲有自己的一首
  indian: "port_india",
  // 第二阶段：北印度的宫廷（莫卧儿、德干的苏丹国：德鲁帕德）与南印度（马拉巴尔、泰米尔海岸：卡纳提克）各有一首；锡兰先借南印度的一首。
  // hindustani 是北印度宫廷文化的通名（寰宇里苏尔王朝的德里与阿格拉写它——苏尔是赶走莫卧儿的王朝，不写 mughal）。
  // 这几个细名的街景都经 TOWN_ALIASES 借奥斯曼，与 indian 相同
  mughal: "port_mughal",
  hindustani: "port_mughal",
  deccan: "port_mughal",
  malabar: "port_malabar",
  kerala: "port_malabar",
  tamil: "port_malabar",
  south_indian: "port_malabar",
  carnatic: "port_malabar",
  sinhalese: "port_malabar",
  andean: "port_andes",
  inca: "port_andes",
  // 第二阶段（文艺复兴的伊比利亚与意大利）：街景照旧借地中海，港口曲各有一首
  iberian: "port_iberia",
  spanish: "port_iberia",
  portuguese: "port_iberia",
  italian: "port_italy",
  venetian: "port_italy",
  genoese: "port_italy",
  // 地方特色第二阶段（北欧）：这些细名以前经 TOWN_ALIASES 回退到低地 / 北地的经典港口曲，现在各有一首。
  // 只认第九批的细名；经典的风格名（lowland、nordic）与经典世界的势力照旧走经典的港口曲。
  flemish: "port_flanders",
  dutch: "port_flanders",
  low_countries: "port_flanders",
  english: "port_england",
  french: "port_france",
  hanseatic: "port_hansa",
  baltic: "port_hansa",
  scandinavian: "port_hansa",
  // 寰宇世界的风格表里还有一个笼统的 northern（北方），先按汉萨与斯堪的纳维亚算
  northern: "port_hansa",
  russian: "port_russia",
  // 地方特色第二阶段：街景照旧借“沙漠”（TOWN_ALIASES），港口曲各有一首——阿拉伯与马穆鲁克的埃及、波斯、马格里布。
  // 这几个是通用的细名（以后的世界或模组可以直接写）。寰宇世界里萨法维、霍尔木兹写 persian，摩洛哥、哈夫斯写 maghreb；
  // 阿拉伯人的港口多在奥斯曼、葡萄牙治下，按停泊处的海换（PORT_SEA_TRACK 的 arabic 一组）。
  arabic: "port_arabia",
  arabian: "port_arabia",
  mamluk: "port_arabia",
  persian: "port_persia",
  maghreb: "port_maghreb",
  // 奥斯曼治下的马格里布（阿尔及尔、的黎波里两个摄政领）：街景照奥斯曼画（TOWN_ALIASES：ottoman_maghreb → ottoman），
  // 海战照奥斯曼算（BATTLE_STYLE_TRACK），可城里人是马格里布人与从安达卢斯逃来的摩里斯科人，听的是安达卢斯的努巴
  // （阿尔及尔的“桑阿”、的黎波里的“马鲁夫”）与格纳瓦一类的兄弟会音乐，所以港口曲是马格里布的一首
  ottoman_maghreb: "port_maghreb",
  // 希腊与黎凡特（地方特色第二阶段）：街景借地中海（greek 经 TOWN_ALIASES 回退到 mediterranean），港口曲有自己的一首
  greek: "port_levant",
  levant: "port_levant",
  levantine: "port_levant",
  syrian: "port_levant",
  // 非洲（地方特色第二阶段）：街景还借沙漠或拓荒者（TOWN_ALIASES），港口曲各有一首
  ethiopian: "port_ethiopia",
  abyssinian: "port_ethiopia",
  amhara: "port_ethiopia",
  kongo: "port_kongo",
  ndongo: "port_kongo",
  mbundu: "port_kongo",
  angolan: "port_kongo",
  // 曼丁与塞内冈比亚（科拉琴、巴拉丰的《鼓语与金沙》）——只收这三个名字；“guinea”可以指整个几内亚湾（连贝宁湾在内），
  // 太宽，不收（评审后改）
  west_african: "port_guinea",
  mande: "port_guinea",
  senegambia: "port_guinea",
  // 贝宁湾：埃多、约鲁巴，以及同样有象牙号、铁双铃与说话鼓的阿坎（《胡椒与铜手镯》）
  edo: "port_benin",
  benin: "port_benin",
  yoruba: "port_benin",
  akan: "port_benin",
  // 地方特色第二阶段：中南半岛与菲律宾。街景照旧借马来（TOWN_ALIASES：siamese、burmese、philippine → malay），港口曲有自己的一首
  siamese: "port_siam",
  burmese: "port_burma",
  philippine: "port_philippines",
  // 大越：街景借明（TOWN_ALIASES：vietnamese、dai_viet → ming），港口曲有自己的一首（寰宇的莫朝、后黎—郑氏写 vietnamese）。
  // 占婆（champa）不在这里：占族是南岛语族，乐器（saranai 双簧管、ginang 与 baranưng 鼓）与京族的丝竹不同，
  // 在有自己的一首之前经 TOWN_ALIASES（champa → malay）回退到马来的港口曲，与街景一致。
  vietnamese: "port_vietnam",
  dai_viet: "port_vietnam",
  // 地方特色第二阶段：朝鲜、琉球、女真与满洲（街景借明与经典的 eastern，港口曲各有一首；文化名的几种写法都收）
  korean: "port_korea",
  joseon: "port_korea",
  ryukyu: "port_ryukyu",
  ryukyuan: "port_ryukyu",
  jurchen: "port_jurchen",
  manchu: "port_jurchen",
  // 第二阶段·美洲（街景仍按 TOWN_ALIASES 借玛雅与 frontier）：阿兹特克与纳瓦人、加勒比的泰诺、巴西的图皮
  aztec: "port_aztec",
  mesoamerican: "port_aztec",
  mexica: "port_aztec",
  nahua: "port_aztec",
  caribbean: "port_caribbean",
  taino: "port_caribbean",
  tupi: "port_brazil",
  tupinamba: "port_brazil",
  brazilian: "port_brazil",
  // 太平洋的岛民（地方特色第二阶段）：波利尼西亚、密克罗尼西亚（查莫罗）、美拉尼西亚都先用《潟湖的鼓声》。
  // 只认这些细名——粗分的 islands（经典世界的碧潮群岛，寰宇里的马尔代夫、帝汶也写 islands）照旧是《珊瑚潮》。
  // 现在的数据里用到这首的只有塔希提（波利尼西亚势力写 polynesian）与关岛（查莫罗势力写 chamorro），曲子按这两处写（奥特阿是塔希提的）；
  // melanesian、fijian 两个细名只是先占位，数据里还没有这样的港口——真有了，应该给它们写用昆杜、加拉穆特、拉利的专属港口曲。
  polynesian: "port_polynesia",
  hawaiian: "port_polynesia",
  tahitian: "port_polynesia",
  samoan: "port_polynesia",
  tongan: "port_polynesia",
  maori: "port_polynesia",
  micronesian: "port_polynesia",
  chamorro: "port_polynesia",
  melanesian: "port_polynesia",
  fijian: "port_polynesia",
};

function hasKey<T>(table: Readonly<Record<string, T>>, key: string | null | undefined): key is string {
  return typeof key === "string" && Object.prototype.hasOwnProperty.call(table, key);
}

/**
 * 停在城市 / 港口时的港口曲（按势力的风格名，不认势力 key）：
 * 1. 风格名在 PORT_STYLE_TRACK 里：用它（数据明写的文化优先）；
 * 2. 否则按 TOWN_ALIASES 换成城镇风格后再查一次（爪哇、摩鹿加 → 马来……）；
 * 3. 都没有时按粗分的建筑风格（经典世界的七种港口曲：经典世界的势力不写 style 或只写粗分的风格，由势力 key 经 FACTION_STYLE 得到粗类，
 *    结果与第九批之前完全一样）。
 * 寰宇世界的势力在数据里写文化细名（2026-10-11 配乐的数据接线：英格兰 english、阿瑜陀耶 siamese、阿尔及尔 ottoman_maghreb……），
 * 原来按势力 key 写死的几张表（PORT_FACTION_FIRST / FALLBACK / REFINE / TRACK）与按地点 key 的 PORT_PLACE_TRACK 都删了，见 docs/DECISIONS.md。
 */
export function portTrackOf(factionKey: string | undefined, style?: string | null, table: Readonly<Record<string, TrackId>> = PORT_STYLE_TRACK): TrackId {
  if (hasKey(table, style)) return table[style];
  const town = townStyleOf(factionKey, style);
  if (hasKey(table, town)) return table[town];
  return `port_${styleOf(factionKey, style)}`;
}

/**
 * 港口曲的海区变体（地方特色第二阶段）：停泊处所在海区的 music（原名，规整同 musicKey）→ { 按势力风格得出的港口曲 → 换成的港口曲 }。
 * 键是音乐分区的名字（与 MUSIC_ZONE_TRACK 同一套词），不是哪个世界的海区 key。统治者与城里人文化不同、而这只能从停泊的海看出来的两种港口：
 * - 爱琴海与黎凡特海（levant、aegean）：地中海与意大利风格的港口——寰宇里威尼斯的坎迪亚、法马古斯塔与热那亚的希俄斯，城里是希腊人——放《酒色的海湾》。
 *   威尼斯、热那亚在亚得里亚海与第勒尼安海的港口照旧是意大利的一首；奥斯曼的伊斯坦布尔、士麦那、罗得岛照旧是《金角湾的集市》。
 * - 红海、亚丁湾、波斯湾与阿拉伯海（arabic、red_sea、aden、persian_gulf：《星与三角帆》的几个分区名）：奥斯曼、伊比利亚与沙漠风格的港口——
 *   寰宇里奥斯曼治下的苏伊士、吉达、摩卡、亚丁、巴士拉，葡萄牙只占着堡垒的马斯喀特，阿达尔的泽拉——城里是阿拉伯人（泽拉是与也门、汉志往来的穆斯林商港），
 *   放《乳香与咖啡的码头》（开罗的塔赫特、红海的西姆西米亚琴、海湾的米尔瓦斯与陶罐）。波斯风格的霍尔木兹王国（霍尔木兹岛）照旧是《霍尔木兹的丝毯》，
 *   埃塞俄比亚的马萨瓦照旧是《盐砖与乳香》。
 *   原来按地点 key 认的另外五处，这条规则认不出来，现在随势力放：开罗（内陆城市，不靠海）、亚历山大（停在黎凡特海）放《金角湾的集市》，
 *   霍尔木兹王国的佐法尔、尤尔法、巴林（与霍尔木兹岛同一个波斯风格的势力、同一片海）放《霍尔木兹的丝毯》——
 *   要再细分得等后端把地点自己的文化（港口数据的 style 或 culture）给到前端（见 docs/DECISIONS.md）。
 * 经典世界的海区不写 music，结果不变。
 */
const ARAB_TOWNS: Readonly<Partial<Record<TrackId, TrackId>>> = { port_ottoman: "port_arabia", port_iberia: "port_arabia", port_desert: "port_arabia" };
const GREEK_TOWNS: Readonly<Partial<Record<TrackId, TrackId>>> = { port_mediterranean: "port_levant", port_italy: "port_levant" };
export const PORT_SEA_TRACK: Readonly<Record<string, Readonly<Partial<Record<TrackId, TrackId>>>>> = {
  levant: GREEK_TOWNS,
  aegean: GREEK_TOWNS,
  arabic: ARAB_TOWNS,
  red_sea: ARAB_TOWNS,
  aden: ARAB_TOWNS,
  persian_gulf: ARAB_TOWNS,
};

/**
 * 停在城市 / 港口时的港口曲，带上停泊处所在海区的 music（配乐导演用）：先按势力风格（portTrackOf），再看 PORT_SEA_TRACK 里这片海有没有换的。
 * music 没写、不认识，或这片海不换这一首时与 portTrackOf 完全一样。
 */
export function portTrackIn(factionKey: string | undefined, style: string | null | undefined, music: string | null | undefined): TrackId {
  const base = portTrackOf(factionKey, style);
  const key = musicKey(music);
  const swap = key !== null && Object.prototype.hasOwnProperty.call(PORT_SEA_TRACK, key) ? PORT_SEA_TRACK[key][base] : undefined;
  return swap ?? base;
}

/**
 * 海战曲的地方变奏（地方特色第二阶段）：这片海的航海曲 → 海战曲。黎凡特（sea_levant）与红海、海湾（sea_arabic）上的敌人多半是奥斯曼的舰队
 * （苏伊士的红海舰队，第乌、霍尔木兹与阿曼湾的海战）。
 * 只有第九批的世界会用到（经典世界的海区不写 music）。
 */
export const BATTLE_SEA_TRACK: Readonly<Partial<Record<TrackId, TrackId>>> = {
  sea_levant: "battle_ottoman",
  sea_arabic: "battle_ottoman",
};

/**
 * 海战曲的地方变奏：停泊在交战海区的港口多半属于哪种势力风格（势力数据的 style 原样比较，不经 TOWN_ALIASES——
 * 印度与莫卧儿的街景借奥斯曼，但那里的敌人不是奥斯曼）→ 海战曲。奥斯曼写 ottoman；它治下的阿尔及尔、的黎波里写 ottoman_maghreb
 * （港口曲是马格里布的一首，巴巴里海盗本来就是奥斯曼的舰队，海战照旧算奥斯曼）。
 */
export const BATTLE_STYLE_TRACK: Readonly<Record<string, TrackId>> = {
  ottoman: "battle_ottoman",
  ottoman_maghreb: "battle_ottoman",
};

/** 是否为海战曲（《黑帆》或它的地方变奏）：海战时不奏短乐句。 */
export function isBattleTrack(id: TrackId): boolean {
  return id === "battle" || id.startsWith("battle_");
}

/**
 * 遭遇海盗、海战进行中的海战曲（纯函数）。内核的遭遇只有“海盗”，不带势力，所以按交战处推断敌人多半是谁：
 * 1. 海区数据写了认得的 music，而这片海的航海曲在 BATTLE_SEA_TRACK 里：用对应的变奏（黎凡特与红海 → 《新月的战鼓》）；
 * 2. 否则看停泊在这片海的港口与城市多半属于哪种势力风格（殖民点不算；票数相同时取先出现的），风格在 BATTLE_STYLE_TRACK 里时用它；
 * 3. 都不是时是《黑帆》。经典世界的海区没有 music、势力也没有这些风格，结果总是《黑帆》，与原来完全一样。
 */
export function battleTrackOf(region: number | null | undefined, statics: StaticView | null): TrackId {
  if (typeof region !== "number" || !Number.isInteger(region) || region < 0 || !statics) return "battle";
  const view = statics.regions.find((r) => r.id === region);
  const sea = musicTrackOf(view?.music);
  const bySea = sea ? BATTLE_SEA_TRACK[sea] : undefined;
  if (bySea) return bySea;
  // 有海战变奏的风格按变奏合成一票（奥斯曼与它治下的马格里布摄政领 ottoman_maghreb 都是奥斯曼的舰队，与数据改写之前同算一票），
  // 其余按风格名分开计；没写风格的势力也投一票（算作“没有变奏”），免得一个奥斯曼港口压过一片别的港口
  const votes = new Map<string, { n: number; track: TrackId }>();
  for (const loc of statics.locations) {
    if (loc.region !== region || loc.kind === "site") continue;
    const style = statics.factions[loc.faction]?.style ?? "";
    const variant = hasKey(BATTLE_STYLE_TRACK, style) ? BATTLE_STYLE_TRACK[style] : null;
    const key = variant ?? `style:${style}`;
    const v = votes.get(key) ?? { n: 0, track: variant ?? "battle" };
    votes.set(key, { n: v.n + 1, track: v.track });
  }
  let best: TrackId = "battle";
  let most = 0;
  for (const { n, track } of votes.values()) {
    if (n > most) {
      best = track;
      most = n;
    }
  }
  return best;
}

// ───────────────────────────── 曲目池（第九批 A01，2026-11-11；轮换的规矩见 pools.ts）
//
// 每个情境（一片海、一座港口、风暴、雾、海战）对一个曲目池：primary 是上面那些函数原来的结果（没有轮换时放它），
// tracks 是有轮换时轮着放的曲子。只有数据明写了的世界才有不止一首的池：海上要海区写了认得的 music，港口要势力写了 style——
// 经典世界两样都不写，池里只有 primary，行为与原来完全一样。

/** 远洋轮着放的几首（纯管弦）：《长浪》《南十字下》与经典的《晨星洋》。 */
const OPEN_OCEAN: readonly TrackId[] = ["sea_swell", "sea_night", "ocean"];

/**
 * 航海曲的曲目池：这片海原来的那一首（seaTrackOf）→ 轮着放的曲子，第一首先放。表里没有的航海曲只有它自己。
 * 印度洋（《季风之路》）与太平洋（《星路》）的远洋另轮三首远洋的曲子；各片近海各有第二首（地方乐器领奏）。
 */
export const SEA_TRACK_POOL: Readonly<Partial<Record<TrackId, readonly TrackId[]>>> = {
  sea_iberia: ["sea_iberia", "sea_canaries"],
  sea_med: ["sea_med", "sea_tyrrhenian"],
  sea_levant: ["sea_levant", "sea_aegean"],
  sea_arabic: ["sea_arabic", "sea_gulf"],
  sea_hansa: ["sea_hansa", "sea_channel"],
  sea_north: ["sea_north", "sea_banks"],
  sea_japan: ["sea_japan", "sea_kuroshio"],
  sea_ming: ["sea_ming", "sea_lanterns"],
  sea_east_china: ["sea_east_china", "sea_lanterns"],
  sea_nusantara: ["sea_nusantara", "sea_malacca"],
  sea_caribbean: ["sea_caribbean", "sea_treasure"],
  sea_india: ["sea_india", "sea_bengal"],
  sea_monsoon: ["sea_monsoon", ...OPEN_OCEAN],
  sea_pacific: ["sea_pacific", ...OPEN_OCEAN],
};

/** 斯瓦希里海岸的海轮着放的曲子：《达乌船的归期》与原来借的《季风之路》。 */
export const SWAHILI_SEA_POOL: readonly TrackId[] = ["sea_swahili", "sea_monsoon"];

/**
 * 按音乐分区的名字另有安排的池（优先于 SEA_TRACK_POOL）：
 * - atlantic（大西洋的远洋）：原来借伊比利亚沿岸的《圣文森特角的帆》（MUSIC_ZONE_TRACK 里照旧，没有轮换时仍是它），
 *   有轮换时放自己的《信风带》与三首远洋的曲子，不再放那首沿岸的；
 * - swahili / east_africa：《达乌船的归期》打头。寰宇的斯瓦希里海写的是笼统的 indian，由 swahiliCoastOf 按停泊的港口认（见 seaPoolOf）。
 */
export const SEA_ZONE_POOL: Readonly<Record<string, readonly TrackId[]>> = {
  atlantic: ["sea_atlantic", ...OPEN_OCEAN],
  swahili: SWAHILI_SEA_POOL,
  east_africa: SWAHILI_SEA_POOL,
};

/** 这片海的停泊处（港口与城市；殖民点不算）里，斯瓦希里的港口（港口曲是《珊瑚石的城》）是否多过其他的。 */
export function swahiliCoastOf(region: number, statics: StaticView): boolean {
  let swahili = 0;
  let other = 0;
  for (const loc of statics.locations) {
    if (loc.region !== region || loc.kind === "site") continue;
    const f = statics.factions[loc.faction];
    if (portTrackOf(f?.key, f?.style) === "port_swahili") swahili++;
    else other++;
  }
  return swahili > other;
}

/** 这片海写了认得的音乐分区时：分区名（规整过的）与按名字对到的航海曲；没写、不认识或没有静态数据时为 null。 */
function zoneOf(region: number | null | undefined, statics: StaticView | null): { key: string; sea: TrackId } | null {
  if (typeof region !== "number" || !Number.isInteger(region) || region < 0 || !statics) return null;
  const view = statics.regions.find((r) => r.id === region);
  const sea = musicTrackOf(view?.music);
  const key = musicKey(view?.music);
  return sea && key !== null ? { key, sea } : null;
}

/**
 * 舰队所在处的航海曲的曲目池。海区没写认得的 music 时只有 seaTrackOf 的那一首（经典世界）。
 * 写了笼统的印度洋（INDIAN_OCEAN_ZONES）而停泊的多半是斯瓦希里的港口时，是斯瓦希里海岸的池。
 */
export function seaPoolOf(region: number | null | undefined, pos: { x: number; y: number } | null | undefined, statics: StaticView | null): ScenePool {
  const primary = seaTrackOf(region, pos, statics);
  const zone = zoneOf(region, statics);
  if (!zone || !statics || typeof region !== "number") return { primary, tracks: [primary], kind: "sea" };
  if (primary !== "sea_india" && INDIAN_OCEAN_ZONES.includes(zone.key) && swahiliCoastOf(region, statics)) return { primary, tracks: SWAHILI_SEA_POOL, kind: "sea" };
  const tracks = (hasKey(SEA_ZONE_POOL, zone.key) ? SEA_ZONE_POOL[zone.key] : undefined) ?? SEA_TRACK_POOL[primary] ?? [primary];
  return { primary, tracks, kind: "sea" };
}

/** 夏秋有台风的海（按分区名对到的航海曲）：明的沿海、东海与黄海、日本的海、菲律宾一带。 */
const TYPHOON_SEAS: readonly TrackId[] = ["sea_ming", "sea_east_china", "sea_japan", "sea_sulu"];

/**
 * 暴风雨的曲目池：primary 总是《怒涛》。海区写了认得的 music 时，东亚的几片海是《台风》与《怒涛》，别处是《怒涛》与《烈风》；
 * 没写时只有《怒涛》。
 */
export function stormPoolOf(region: number | null | undefined, statics: StaticView | null): ScenePool {
  const zone = zoneOf(region, statics);
  if (!zone) return { primary: "storm", tracks: ["storm"], kind: "storm" };
  return { primary: "storm", tracks: TYPHOON_SEAS.includes(zone.sea) ? ["storm_typhoon", "storm"] : ["storm", "storm_gale"], kind: "storm" };
}

/**
 * 海上起雾时的曲目池：海区写了认得的 music 时是《雾号》（primary 仍是这片海的航海曲——没有轮换时雾天照旧放航海曲）；
 * 没写时为 null（雾天照旧放航海曲）。
 */
export function fogPoolOf(region: number | null | undefined, pos: { x: number; y: number } | null | undefined, statics: StaticView | null): ScenePool | null {
  if (!zoneOf(region, statics)) return null;
  return { primary: seaTrackOf(region, pos, statics), tracks: ["sea_fog"], kind: "sea" };
}

/** 海战放《海上的战鼓》的海（按分区名对到的航海曲）：明的沿海、东海与黄海、日本的海。 */
const EAST_BATTLE_SEAS: readonly TrackId[] = ["sea_ming", "sea_east_china", "sea_japan"];

/**
 * 海战的曲目池：primary 是 battleTrackOf 的结果。海区写了认得的 music、而原来是《黑帆》时：东亚的几片海是《海上的战鼓》与《黑帆》，
 * 别处是《黑帆》与《舷炮》；奥斯曼的变奏《新月的战鼓》照旧只有它自己。
 */
export function battlePoolOf(region: number | null | undefined, statics: StaticView | null): ScenePool {
  const primary = battleTrackOf(region, statics);
  const zone = zoneOf(region, statics);
  if (!zone || primary !== "battle") return { primary, tracks: [primary], kind: "battle" };
  return { primary, tracks: EAST_BATTLE_SEAS.includes(zone.sea) ? ["battle_east", "battle"] : ["battle", "battle_broadside"], kind: "battle" };
}

/**
 * 港口曲的曲目池：原来的那一首（portTrackIn）→ 轮着放的曲子。港口最多的几种文化各有第二首：
 * 伊比利亚、日本、明、奥斯曼、马来、意大利、法兰西、斯瓦希里，新大陆沿岸的城镇（frontier）与北方、中欧的城镇（nordic）。
 */
export const PORT_TRACK_POOL: Readonly<Partial<Record<TrackId, readonly TrackId[]>>> = {
  port_iberia: ["port_iberia", "port_iberia_eve"],
  port_frontier: ["port_frontier", "port_indies"],
  port_japan: ["port_japan", "port_japan_eve"],
  port_ming: ["port_ming", "port_ming_tea"],
  port_ottoman: ["port_ottoman", "port_ottoman_cafe"],
  port_malay: ["port_malay", "port_malay_night"],
  port_nordic: ["port_nordic", "port_town"],
  port_italy: ["port_italy", "port_lagoon"],
  port_france: ["port_france", "port_estuary"],
  port_swahili: ["port_swahili", "port_taarab"],
};

/** 写的是傍晚与夜里的港口曲：天黑以后（黄昏、夜晚）进港时排在池的最前面。 */
export const EVENING_PORT_TRACKS: readonly TrackId[] = ["port_iberia_eve", "port_japan_eve", "port_malay_night"];

/**
 * 停在城市 / 港口时的港口曲的曲目池。势力没写风格名（经典世界）时只有 portTrackIn 的那一首。
 * minute 是当天的时刻（Overview.minute，0–1439；手动航行的世界在港时间不走，停在进港的那一刻）：黄昏与夜里，池里写傍晚的那一首排到最前面。
 */
export function portPoolIn(factionKey: string | undefined, style: string | null | undefined, music: string | null | undefined, minute?: number | null): ScenePool {
  const primary = portTrackIn(factionKey, style, music);
  const pool = typeof style === "string" && style.trim() ? PORT_TRACK_POOL[primary] : undefined;
  if (!pool) return { primary, tracks: [primary], kind: "port" };
  const phase = typeof minute === "number" && Number.isFinite(minute) ? phaseOf(minute) : "day";
  if (phase === "dusk" || phase === "night") {
    const evening = pool.filter((id) => EVENING_PORT_TRACKS.includes(id));
    if (evening.length > 0) return { primary, tracks: [...evening, ...pool.filter((id) => !EVENING_PORT_TRACKS.includes(id))], kind: "port" };
  }
  return { primary, tracks: pool, kind: "port" };
}
