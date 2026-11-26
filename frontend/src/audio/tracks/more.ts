// 第九批 A01 多写的曲目：编号与合成版的曲谱。管弦版在 ../orchestra/tracks/more.ts，
// 两套一一对应。它们怎么进选曲见 ../pools.ts（每片海、每种文化的港口、风暴、海战、养成的事件各有一个曲目池，轮着放）。
// index.ts 把这里的编号接在原有曲目之后（“曲目”下拉框里排在最后）。
import type { TrackDef } from "../score";
import { BATTLE_BROADSIDE } from "./battleBroadside";
import { BATTLE_EAST } from "./battleEast";
import { PORT_IBERIA_EVE } from "./portIberiaEve";
import { PORT_ESTUARY } from "./portEstuary";
import { PORT_INDIES } from "./portIndies";
import { PORT_JAPAN_EVE } from "./portJapanEve";
import { PORT_LAGOON } from "./portLagoon";
import { PORT_MALAY_NIGHT } from "./portMalayNight";
import { PORT_MING_TEA } from "./portMingTea";
import { PORT_OTTOMAN_CAFE } from "./portOttomanCafe";
import { PORT_TAARAB } from "./portTaarab";
import { PORT_TOWN } from "./portTown";
import { SEA_AEGEAN } from "./seaAegean";
import { SEA_ATLANTIC } from "./seaAtlantic";
import { SEA_BANKS } from "./seaBanks";
import { SEA_BENGAL } from "./seaBengal";
import { SEA_CANARIES } from "./seaCanaries";
import { SEA_CHANNEL } from "./seaChannel";
import { SEA_FOG } from "./seaFog";
import { SEA_GULF } from "./seaGulf";
import { SEA_KUROSHIO } from "./seaKuroshio";
import { SEA_LANTERNS } from "./seaLanterns";
import { SEA_MALACCA } from "./seaMalacca";
import { SEA_NIGHT } from "./seaNight";
import { SEA_SWAHILI } from "./seaSwahili";
import { SEA_SWELL } from "./seaSwell";
import { SEA_TREASURE } from "./seaTreasure";
import { SEA_TYRRHENIAN } from "./seaTyrrhenian";
import { STORM_GALE } from "./stormGale";
import { STORM_TYPHOON } from "./stormTyphoon";
import { UB_AUTUMN } from "./ubAutumn";
import { UB_FINAL } from "./ubFinal";
import { UB_FOOTSTEPS } from "./ubFootsteps";
import { UB_HEART_WALK } from "./ubHeartWalk";
import { UB_LAMP_OUT } from "./ubLampOut";
import { UB_SPRING } from "./ubSpring";
import { UB_SUMMER } from "./ubSummer";
import { UB_WINTER } from "./ubWinter";

/** 多写的曲目的编号（顺序即下拉框里的顺序）。 */
export const MORE_TRACK_IDS = [
  // 航海曲：远洋的三首（大西洋的信风带、长浪、夜航）
  "sea_atlantic",
  "sea_swell",
  "sea_night",
  // 航海曲：各片海的第二首
  "sea_canaries",
  "sea_tyrrhenian",
  "sea_aegean",
  "sea_gulf",
  "sea_swahili",
  "sea_channel",
  "sea_banks",
  "sea_kuroshio",
  "sea_lanterns",
  "sea_malacca",
  "sea_treasure",
  "sea_bengal",
  // 海上起雾
  "sea_fog",
  // 暴风雨的第二首与东亚的海上的一首
  "storm_gale",
  "storm_typhoon",
  // 海战的第二首与东亚的海上的一首
  "battle_broadside",
  "battle_east",
  // 港口曲：港口多的十种文化的第二首
  "port_iberia_eve",
  "port_indies",
  "port_japan_eve",
  "port_ming_tea",
  "port_ottoman_cafe",
  "port_malay_night",
  "port_town",
  "port_lagoon",
  "port_estuary",
  "port_taarab",
  // 养成篇：四季的平时曲
  "ub_spring",
  "ub_summer",
  "ub_autumn",
  "ub_winter",
  // 养成篇：事件的第二首（心动、悲伤、紧张、比赛）
  "ub_heart_walk",
  "ub_lamp_out",
  "ub_footsteps",
  "ub_final",
] as const;
export type MoreTrackId = (typeof MORE_TRACK_IDS)[number];

export const MORE_TRACKS: Readonly<Record<MoreTrackId, TrackDef>> = {
  sea_atlantic: SEA_ATLANTIC,
  sea_swell: SEA_SWELL,
  sea_night: SEA_NIGHT,
  sea_canaries: SEA_CANARIES,
  sea_tyrrhenian: SEA_TYRRHENIAN,
  sea_aegean: SEA_AEGEAN,
  sea_gulf: SEA_GULF,
  sea_swahili: SEA_SWAHILI,
  sea_channel: SEA_CHANNEL,
  sea_banks: SEA_BANKS,
  sea_kuroshio: SEA_KUROSHIO,
  sea_lanterns: SEA_LANTERNS,
  sea_malacca: SEA_MALACCA,
  sea_treasure: SEA_TREASURE,
  sea_bengal: SEA_BENGAL,
  sea_fog: SEA_FOG,
  storm_gale: STORM_GALE,
  storm_typhoon: STORM_TYPHOON,
  battle_broadside: BATTLE_BROADSIDE,
  battle_east: BATTLE_EAST,
  port_iberia_eve: PORT_IBERIA_EVE,
  port_indies: PORT_INDIES,
  port_japan_eve: PORT_JAPAN_EVE,
  port_ming_tea: PORT_MING_TEA,
  port_ottoman_cafe: PORT_OTTOMAN_CAFE,
  port_malay_night: PORT_MALAY_NIGHT,
  port_town: PORT_TOWN,
  port_lagoon: PORT_LAGOON,
  port_estuary: PORT_ESTUARY,
  port_taarab: PORT_TAARAB,
  ub_spring: UB_SPRING,
  ub_summer: UB_SUMMER,
  ub_autumn: UB_AUTUMN,
  ub_winter: UB_WINTER,
  ub_heart_walk: UB_HEART_WALK,
  ub_lamp_out: UB_LAMP_OUT,
  ub_footsteps: UB_FOOTSTEPS,
  ub_final: UB_FINAL,
};
