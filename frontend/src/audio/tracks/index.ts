// 全部曲目。场景与曲目的对应见 director.ts，海区与航海曲的对应见 zones.ts，养成中的选曲见 upbringing.ts；短乐句另在 jingles.ts。
import type { TrackDef } from "../score";
import { AC_ANTWERP } from "./acAntwerp";
import { AC_AZHAR } from "./acAzhar";
import { AC_FEZ } from "./acFez";
import { AC_GENERIC } from "./acGeneric";
import { AC_GIRI } from "./acGiri";
import { AC_KYOTO } from "./acKyoto";
import { AC_MERIDA } from "./acMerida";
import { AC_SEVILLE } from "./acSeville";
import { AC_SHIP } from "./acShip";
import { AC_ZHANGZHOU } from "./acZhangzhou";
import { BATTLE } from "./battle";
import { BATTLE_OTTOMAN } from "./battleOttoman";
import { DESERT } from "./desert";
import { EASTERN } from "./eastern";
import { FRONTIER } from "./frontier";
import { ISLANDS } from "./islands";
import { LOWLAND } from "./lowland";
import { MEDITERRANEAN } from "./mediterranean";
import { NORDIC } from "./nordic";
import { OCEAN } from "./ocean";
import { PORT_ANDES } from "./portAndes";
import { PORT_IBERIA } from "./portIberia";
import { PORT_ARABIA } from "./portArabia";
import { PORT_BENIN } from "./portBenin";
import { PORT_ETHIOPIA } from "./portEthiopia";
import { PORT_GUINEA } from "./portGuinea";
import { PORT_BURMA } from "./portBurma";
import { PORT_AZTEC } from "./portAztec";
import { PORT_BRAZIL } from "./portBrazil";
import { PORT_CARIBBEAN } from "./portCaribbean";
import { PORT_INDIA } from "./portIndia";
import { PORT_ITALY } from "./portItaly";
import { PORT_JAPAN } from "./portJapan";
import { PORT_MAGHREB } from "./portMaghreb";
import { PORT_LEVANT } from "./portLevant";
import { PORT_KONGO } from "./portKongo";
import { PORT_JURCHEN } from "./portJurchen";
import { PORT_KOREA } from "./portKorea";
import { PORT_MALAY } from "./portMalay";
import { PORT_MALABAR } from "./portMalabar";
import { PORT_MAYA } from "./portMaya";
import { PORT_MING } from "./portMing";
import { PORT_MUGHAL } from "./portMughal";
import { PORT_OTTOMAN } from "./portOttoman";
import { PORT_PERSIA } from "./portPersia";
import { PORT_PHILIPPINES } from "./portPhilippines";
import { PORT_SIAM } from "./portSiam";
import { PORT_RYUKYU } from "./portRyukyu";
import { PORT_POLYNESIA } from "./portPolynesia";
import { PORT_SWAHILI } from "./portSwahili";
import { PORT_VIETNAM } from "./portVietnam";
import { REALM_ELVES } from "./realmElves";
import { SEA } from "./sea";
import { SEA_ANDES } from "./seaAndes";
import { SEA_ARABIC } from "./seaArabic";
import { SEA_BRAZIL } from "./seaBrazil";
import { SEA_CARIBBEAN } from "./seaCaribbean";
import { SEA_DARK } from "./seaDark";
import { SEA_EAST } from "./seaEast";
import { SEA_GUINEA } from "./seaGuinea";
import { SEA_EAST_CHINA } from "./seaEastChina";
import { SEA_HANSA } from "./seaHansa";
import { SEA_IBERIA } from "./seaIberia";
import { SEA_INDIA } from "./seaIndia";
import { SEA_ISLANDS } from "./seaIslands";
import { SEA_JAPAN } from "./seaJapan";
import { SEA_LEVANT } from "./seaLevant";
import { SEA_MED } from "./seaMed";
import { SEA_MING } from "./seaMing";
import { SEA_MONSOON } from "./seaMonsoon";
import { SEA_NEW } from "./seaNew";
import { SEA_NORTH } from "./seaNorth";
import { SEA_NUSANTARA } from "./seaNusantara";
import { SEA_PACIFIC } from "./seaPacific";
import { SEA_SOUTH } from "./seaSouth";
import { SEA_SULU } from "./seaSulu";
import { STORM } from "./storm";
import { TITLE } from "./title";
import { UB_ACADEMY } from "./ubAcademy";
import { UB_CONTEST } from "./ubContest";
import { UB_FESTIVAL } from "./ubFestival";
import { UB_GRADUATION } from "./ubGraduation";
import { UB_HEART } from "./ubHeart";
import { UB_HOME } from "./ubHome";
import { UB_LANTERN } from "./ubLantern";
import { UB_LETTER } from "./ubLetter";
import { UB_MATSURI } from "./ubMatsuri";
import { UB_MYSTIC } from "./ubMystic";
import { UB_SAD } from "./ubSad";
import { UB_TENSE } from "./ubTense";
// 第九批：养成平时的轮换——九首“家乡的日常”与三首通用的平时曲（2026-11-02）
import { UB_HOME_IBERIA } from "./ubHomeIberia";
import { UB_HOME_LOWLANDS } from "./ubHomeLowlands";
import { UB_HOME_MAGHREB } from "./ubHomeMaghreb";
import { UB_HOME_GULF } from "./ubHomeGulf";
import { UB_HOME_SWAHILI } from "./ubHomeSwahili";
import { UB_HOME_MAYA } from "./ubHomeMaya";
import { UB_HOME_MING } from "./ubHomeMing";
import { UB_HOME_JAPAN } from "./ubHomeJapan";
import { UB_HOME_MOLUCCAS } from "./ubHomeMoluccas";
import { UB_STUDY } from "./ubStudy";
import { UB_DUSK } from "./ubDusk";
import { UB_BREEZE } from "./ubBreeze";
// 地方特色第二阶段（北欧）
import { PORT_ENGLAND } from "./portEngland";
import { PORT_FLANDERS } from "./portFlanders";
import { PORT_FRANCE } from "./portFrance";
import { PORT_HANSA } from "./portHansa";
import { PORT_RUSSIA } from "./portRussia";
import { SEA_ARCTIC } from "./seaArctic";
// 第九批 A01（2026-11-11）多写的曲目
import { MORE_TRACK_IDS, MORE_TRACKS } from "./more";

/** 曲目编号（顺序即“曲目”下拉框里的顺序）。 */
export const TRACK_IDS = [
  "title",
  "sea",
  "sea_north",
  "sea_south",
  "sea_islands",
  "sea_east",
  "sea_new",
  "ocean",
  "sea_iberia",
  "sea_monsoon",
  "sea_india",
  "sea_ming",
  "sea_japan",
  "sea_east_china",
  "sea_med",
  "sea_hansa",
  "sea_levant",
  "sea_arabic",
  "sea_nusantara",
  "sea_sulu",
  "sea_caribbean",
  "sea_andes",
  // 第二阶段·美洲：巴西沿岸（寰宇世界里《阿斯特里亚的海岸》的重编）
  "sea_brazil",
  "sea_pacific",
  "sea_dark",
  "sea_arctic",
  "sea_guinea",
  "realm_elves",
  "storm",
  "port_mediterranean",
  "port_nordic",
  "port_lowland",
  "port_desert",
  "port_islands",
  "port_eastern",
  "port_frontier",
  "port_japan",
  "port_ming",
  "port_ottoman",
  "port_swahili",
  "port_malay",
  "port_maya",
  "port_andes",
  "port_india",
  // 第九批配乐·地方特色第二阶段：文艺复兴的伊比利亚与意大利
  "port_iberia",
  "port_italy",
  "port_flanders",
  "port_england",
  "port_france",
  "port_hansa",
  "port_russia",
  "port_arabia",
  "port_persia",
  "port_maghreb",
  "port_levant",
  "port_ethiopia",
  "port_kongo",
  "port_guinea",
  "port_benin",
  "port_malabar",
  "port_mughal",
  "port_siam",
  "port_burma",
  "port_vietnam",
  "port_philippines",
  // 第九批配乐·地方特色第二阶段：朝鲜、琉球、女真与满洲
  "port_korea",
  "port_ryukyu",
  "port_jurchen",
  // 第二阶段·美洲：阿兹特克、加勒比、巴西
  "port_aztec",
  "port_caribbean",
  "port_brazil",
  "port_polynesia",
  "battle",
  "battle_ottoman",
  "ub_home",
  "ub_academy",
  "ub_festival",
  "ub_matsuri",
  "ub_lantern",
  "ub_heart",
  "ub_tense",
  "ub_sad",
  "ub_mystic",
  "ub_contest",
  "ub_graduation",
  "ub_letter",
  // 第九批：养成平时的轮换——九首“家乡的日常”与三首通用的平时曲（只起了中文名）
  "ub_home_iberia",
  "ub_home_lowlands",
  "ub_home_maghreb",
  "ub_home_gulf",
  "ub_home_swahili",
  "ub_home_maya",
  "ub_home_ming",
  "ub_home_japan",
  "ub_home_moluccas",
  "ub_study",
  "ub_dusk",
  "ub_breeze",
  "ac_kyoto",
  "ac_antwerp",
  "ac_ship",
  "ac_zhangzhou",
  "ac_merida",
  "ac_seville",
  "ac_fez",
  "ac_giri",
  "ac_azhar",
  "ac_generic",
  // 第九批 A01（2026-11-11）多写的曲目：编号与曲谱在 more.ts
  ...MORE_TRACK_IDS,
] as const;
export type TrackId = (typeof TRACK_IDS)[number];

export const TRACKS: Readonly<Record<TrackId, TrackDef>> = {
  title: TITLE,
  sea: SEA,
  sea_north: SEA_NORTH,
  sea_south: SEA_SOUTH,
  sea_islands: SEA_ISLANDS,
  sea_east: SEA_EAST,
  sea_new: SEA_NEW,
  ocean: OCEAN,
  sea_iberia: SEA_IBERIA,
  sea_monsoon: SEA_MONSOON,
  sea_india: SEA_INDIA,
  sea_ming: SEA_MING,
  sea_japan: SEA_JAPAN,
  sea_east_china: SEA_EAST_CHINA,
  sea_med: SEA_MED,
  sea_hansa: SEA_HANSA,
  sea_levant: SEA_LEVANT,
  sea_arabic: SEA_ARABIC,
  sea_nusantara: SEA_NUSANTARA,
  sea_sulu: SEA_SULU,
  sea_caribbean: SEA_CARIBBEAN,
  sea_andes: SEA_ANDES,
  sea_brazil: SEA_BRAZIL,
  sea_pacific: SEA_PACIFIC,
  sea_dark: SEA_DARK,
  sea_arctic: SEA_ARCTIC,
  sea_guinea: SEA_GUINEA,
  realm_elves: REALM_ELVES,
  storm: STORM,
  port_mediterranean: MEDITERRANEAN,
  port_nordic: NORDIC,
  port_lowland: LOWLAND,
  port_desert: DESERT,
  port_islands: ISLANDS,
  port_eastern: EASTERN,
  port_frontier: FRONTIER,
  port_japan: PORT_JAPAN,
  port_ming: PORT_MING,
  port_ottoman: PORT_OTTOMAN,
  port_swahili: PORT_SWAHILI,
  port_malay: PORT_MALAY,
  port_maya: PORT_MAYA,
  port_andes: PORT_ANDES,
  port_india: PORT_INDIA,
  port_iberia: PORT_IBERIA,
  port_italy: PORT_ITALY,
  port_flanders: PORT_FLANDERS,
  port_england: PORT_ENGLAND,
  port_france: PORT_FRANCE,
  port_hansa: PORT_HANSA,
  port_russia: PORT_RUSSIA,
  port_arabia: PORT_ARABIA,
  port_persia: PORT_PERSIA,
  port_maghreb: PORT_MAGHREB,
  port_levant: PORT_LEVANT,
  port_ethiopia: PORT_ETHIOPIA,
  port_kongo: PORT_KONGO,
  port_guinea: PORT_GUINEA,
  port_benin: PORT_BENIN,
  port_malabar: PORT_MALABAR,
  port_mughal: PORT_MUGHAL,
  port_siam: PORT_SIAM,
  port_burma: PORT_BURMA,
  port_vietnam: PORT_VIETNAM,
  port_philippines: PORT_PHILIPPINES,
  port_korea: PORT_KOREA,
  port_ryukyu: PORT_RYUKYU,
  port_jurchen: PORT_JURCHEN,
  port_aztec: PORT_AZTEC,
  port_caribbean: PORT_CARIBBEAN,
  port_brazil: PORT_BRAZIL,
  port_polynesia: PORT_POLYNESIA,
  battle: BATTLE,
  battle_ottoman: BATTLE_OTTOMAN,
  ub_home: UB_HOME,
  ub_academy: UB_ACADEMY,
  ub_festival: UB_FESTIVAL,
  ub_matsuri: UB_MATSURI,
  ub_lantern: UB_LANTERN,
  ub_heart: UB_HEART,
  ub_tense: UB_TENSE,
  ub_sad: UB_SAD,
  ub_mystic: UB_MYSTIC,
  ub_contest: UB_CONTEST,
  ub_graduation: UB_GRADUATION,
  ub_letter: UB_LETTER,
  ub_home_iberia: UB_HOME_IBERIA,
  ub_home_lowlands: UB_HOME_LOWLANDS,
  ub_home_maghreb: UB_HOME_MAGHREB,
  ub_home_gulf: UB_HOME_GULF,
  ub_home_swahili: UB_HOME_SWAHILI,
  ub_home_maya: UB_HOME_MAYA,
  ub_home_ming: UB_HOME_MING,
  ub_home_japan: UB_HOME_JAPAN,
  ub_home_moluccas: UB_HOME_MOLUCCAS,
  ub_study: UB_STUDY,
  ub_dusk: UB_DUSK,
  ub_breeze: UB_BREEZE,
  ac_kyoto: AC_KYOTO,
  ac_antwerp: AC_ANTWERP,
  ac_ship: AC_SHIP,
  ac_zhangzhou: AC_ZHANGZHOU,
  ac_merida: AC_MERIDA,
  ac_seville: AC_SEVILLE,
  ac_fez: AC_FEZ,
  ac_giri: AC_GIRI,
  ac_azhar: AC_AZHAR,
  ac_generic: AC_GENERIC,
  ...MORE_TRACKS,
};

/** 是否为已知的曲目编号。 */
export function isTrackId(v: unknown): v is TrackId {
  return typeof v === "string" && (TRACK_IDS as readonly string[]).includes(v);
}
